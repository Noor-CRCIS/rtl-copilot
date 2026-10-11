param(
    [Parameter(Mandatory = $true)]
    [string]$Manifest,
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'
$document = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
if ($document.version -ne 1 -or -not $document.entries) {
    throw 'Invalid RTL Copilot write manifest.'
}

$root = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath (Join-Path $root 'product.json') -PathType Leaf)) {
    throw 'The selected VS Code application root is invalid.'
}
$rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
$items = @()
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

foreach ($entry in $document.entries) {
    $target = [IO.Path]::GetFullPath([string]$entry.path)
    if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Target is outside the VS Code application: $target"
    }
    $fileName = [IO.Path]::GetFileName($target)
    if ($fileName.EndsWith('.rtl-backup', [StringComparison]::OrdinalIgnoreCase)) {
        $fileName = $fileName.Substring(0, $fileName.Length - '.rtl-backup'.Length)
    }
    if ($fileName -notin @('product.json', 'workbench.html', 'workbench.esm.html', 'workbench.desktop.main.js', 'rtl-copilot-runtime.js')) {
        throw "Unsupported VS Code patch target: $target"
    }
    if (-not $seen.Add($target)) {
        throw "Duplicate target: $target"
    }
    if ($entry.operation -notin @('write', 'delete')) {
        throw "Unsupported operation for $target"
    }

    $parent = [IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($target))
    if ($parent -eq $root) {
        $relativeParent = '.'
    } elseif ($parent.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        $relativeParent = $parent.Substring($rootPrefix.Length)
    } else {
        throw "Target directory is outside the VS Code application: $parent"
    }
    $current = $root
    if ($relativeParent -ne '.') {
        foreach ($part in $relativeParent.Split([IO.Path]::DirectorySeparatorChar, [StringSplitOptions]::RemoveEmptyEntries)) {
            $current = Join-Path $current $part
            $directory = Get-Item -LiteralPath $current -Force
            if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw "Target traverses an unsupported directory: $current"
            }
        }
    }
    if (Test-Path -LiteralPath $target) {
        $existing = Get-Item -LiteralPath $target -Force
        if ($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Target is not a regular file: $target"
        }
    }

    $content = if ($entry.operation -eq 'write') {
        [Convert]::FromBase64String([string]$entry.content)
    } else {
        $null
    }
    $fileExists = [IO.File]::Exists($target)
    $original = if ($fileExists) { [IO.File]::ReadAllBytes($target) } else { $null }
    $items += [PSCustomObject]@{
        Path = $target
        Operation = [string]$entry.operation
        Content = $content
        Existed = $fileExists
        Original = $original
    }
}

function Write-Atomic([string]$Target, [byte[]]$Bytes) {
    $temporary = "$Target.rtl-elevated-$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllBytes($temporary, $Bytes)
        if ([IO.File]::Exists($Target)) {
            [IO.File]::Replace($temporary, $Target, $null)
        } else {
            [IO.File]::Move($temporary, $Target)
        }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

$applied = 0
try {
    foreach ($item in $items) {
        if ($item.Operation -eq 'delete') {
            if ([IO.File]::Exists($item.Path)) { [IO.File]::Delete($item.Path) }
        } else {
            Write-Atomic $item.Path $item.Content
        }
        $applied++
    }
} catch {
    $writeError = $_
    $rollbackFailures = @()
    for ($index = $applied - 1; $index -ge 0; $index--) {
        $item = $items[$index]
        try {
            if ($item.Existed) {
                Write-Atomic $item.Path $item.Original
            } elseif ([IO.File]::Exists($item.Path)) {
                [IO.File]::Delete($item.Path)
            }
        } catch {
            $rollbackFailures += "$($item.Path): $($_.Exception.Message)"
        }
    }
    if ($rollbackFailures.Count -gt 0) {
        throw "$($writeError.Exception.Message) Rollback failed for: $($rollbackFailures -join '; ')"
    }
    throw $writeError
}
