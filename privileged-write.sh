#!/bin/bash
set -euo pipefail

if [[ $# -ne 2 || ! -f "$1" || ! -d "$2" ]]; then
    echo "A write manifest and VS Code application root are required." >&2
    exit 2
fi

manifest=$1
root=$2
declare -a operations=()
declare -a targets=()
declare -a payloads=()
declare -a existed=()
declare -a snapshots=()
temp_dir=$(mktemp -d)
macos=0
if [[ $(uname -s) == Darwin ]]; then macos=1; fi

canonical() {
    local parent
    parent=$(cd -P "$(dirname "$1")" && pwd) || return 1
    printf '%s/%s' "$parent" "$(basename "$1")"
}

sign_bundle() {
    if (( macos )); then
        /usr/bin/codesign --force --deep --sign - --preserve-metadata=entitlements,requirements,flags,runtime "$(dirname "$(dirname "$(dirname "$root")")")"
    fi
}
applying=0

cleanup() {
    status=$?
    trap - EXIT
    if (( status != 0 && applying )); then
        for ((index=${#targets[@]}-1; index>=0; index--)); do
            if [[ ${existed[index]} == 1 ]]; then
                temporary="${targets[index]}.rtl-rollback.$$"
                if cp -p "${snapshots[index]}" "$temporary" && mv -f "$temporary" "${targets[index]}"; then
                    :
                else
                    echo "Rollback failed for ${targets[index]}." >&2
                    rm -f "$temporary"
                fi
            else
                rm -f "${targets[index]}"
            fi
        done
    fi
    if (( status != 0 && applying )); then sign_bundle || echo "Rollback signing failed." >&2; fi
    rm -rf "$temp_dir"
    exit "$status"
}
trap cleanup EXIT

decode() {
    if (( macos )); then
        printf '%s' "$1" | base64 -D
    else
        printf '%s' "$1" | base64 --decode
    fi
}

while IFS=$'\t' read -r operation first second; do
    [[ -n "$operation" ]] || continue
    if [[ "$operation" == WRITE || "$operation" == DELETE ]]; then
        operations+=("$operation")
        targets+=("$(decode "$first")")
        payloads+=("$second")
    else
        echo "Unsupported manifest operation." >&2
        exit 2
    fi
done < "$manifest"

[[ "$root" != *$'\n'* ]] || { echo "Invalid application root." >&2; exit 2; }
root=$(cd -P "$root" && pwd)
[[ -f "$root/product.json" ]] || { echo "Invalid VS Code application root." >&2; exit 2; }
if (( macos )); then
    [[ "$root" == *.app/Contents/Resources/app ]] || { echo "Invalid macOS app bundle root." >&2; exit 2; }
fi

for ((index=0; index<${#targets[@]}; index++)); do
    target=${targets[index]}
    [[ "$target" != *$'\n'* ]] || { echo "Invalid target path." >&2; exit 2; }
    [[ ! -L "$target" ]] || { echo "Symbolic link target is forbidden: $target" >&2; exit 2; }
    target=$(canonical "$target")
    targets[index]=$target
    [[ "$target" == "$root/"* ]] || { echo "Target is outside the VS Code application: $target" >&2; exit 2; }
    name=$(basename "$target")
    name=${name%.rtl-backup}
    case "$name" in
        product.json|workbench.html|workbench.esm.html|workbench.desktop.main.js|rtl-copilot-runtime.js) ;;
        *) echo "Unsupported VS Code patch target: $target" >&2; exit 2 ;;
    esac
    for ((prior=0; prior<index; prior++)); do
        [[ "${targets[prior]}" != "$target" ]] || { echo "Duplicate target: $target" >&2; exit 2; }
    done
    [[ -d "$(dirname "$target")" ]] || { echo "Target directory is missing: $target" >&2; exit 2; }
    if [[ -e "$target" && ! -f "$target" ]]; then
        echo "Target is not a regular file: $target" >&2
        exit 2
    fi
    if [[ -e "$target" ]]; then
        existed[index]=1
        snapshots[index]="$temp_dir/original.$index"
        cp -p "$target" "${snapshots[index]}"
    else
        existed[index]=0
        snapshots[index]=
    fi
done

applying=1
for ((index=0; index<${#targets[@]}; index++)); do
    target=${targets[index]}
    if [[ ${operations[index]} == DELETE ]]; then
        rm -f "$target"
        continue
    fi
    temporary=$(mktemp "${target}.rtl-elevated.XXXXXX")
    if ! decode "${payloads[index]}" > "$temporary"; then
        rm -f "$temporary"
        exit 1
    fi
    if [[ ${existed[index]} == 1 ]]; then
        if (( macos )); then
            chmod "$(stat -f '%Lp' "${snapshots[index]}")" "$temporary"
        else
            chmod --reference="${snapshots[index]}" "$temporary"
        fi
    fi
    mv -f "$temporary" "$target"
done
sign_bundle
applying=0
