#!/usr/bin/env python3
"""Apply or restore Persian RTL for VS Code 2.9.18 with selective integrity updates.

This standalone installer delegates patch generation to the packaged JavaScript
engine so the VS Code extension and Windows installer cannot drift apart.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any, Final

VERSION: Final = "2.9.18"
PATCH_START: Final = "<!-- RTL-COPILOT:START -->"
PATCH_END: Final = "<!-- RTL-COPILOT:END -->"
RUNTIME_NAME: Final = "rtl-copilot-runtime.js"
BACKUP_SUFFIX: Final = ".rtl-backup"


def log(level: str, message: str, started_at: float) -> None:
    """Log one structured operation message to the console."""
    elapsed = time.perf_counter() - started_at
    print(f"[{level:<7}] +{elapsed:8.3f}s | {message}")


def sha256_base64(content: str) -> str:
    """Return VS Code's SHA-256/Base64 checksum without padding."""
    digest = hashlib.sha256(content.encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii").rstrip("=")


def find_product_json(html_path: Path) -> tuple[Path, Path, dict[str, Any]]:
    """Find only the product.json ancestor belonging to the selected HTML."""
    current = html_path.parent
    for _ in range(16):
        candidate = current / "product.json"
        if candidate.is_file():
            data = json.loads(candidate.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError(f"Invalid product.json object: {candidate}")
            return candidate, current, data
        if current.parent == current:
            break
        current = current.parent
    raise FileNotFoundError("No product.json ancestor was found for the selected workbench HTML")


def checksum_key(app_base: Path, html_path: Path, checksums: dict[str, Any]) -> str:
    """Resolve the checksum key used by the active product.json."""
    relative = html_path.relative_to(app_base).as_posix()
    candidates = (relative, relative.removeprefix("out/"))
    matches: set[str] = set()
    for candidate in candidates:
        if candidate in checksums:
            matches.add(candidate)
    if len(matches) != 1:
        reason = "ambiguous" if matches else "missing"
        raise KeyError(f"Workbench checksum key is {reason}: {relative}")
    return next(iter(matches))


def node_engine(engine_path: Path, action: str, html: str, force_rtl: bool) -> str:
    """Invoke the shared JavaScript generator and return generated content."""
    script = (
        "const fs=require('fs'),e=require(process.argv[1]);"
        "const action=process.argv[2],force=process.argv[3]==='1';"
        "const input=fs.readFileSync(0,'utf8');"
        "const options={mode:force?'forceRtl':'auto'};"
        "let output;"
        "if(action==='apply')output=e.applyPatchToHtml(input,options);"
        "else if(action==='remove')output=e.removePatchFromHtml(input);"
        "else if(action==='runtime')output=e.buildRuntime(options);"
        "else if(action==='bridge-apply')output=e.applyEditorBridge(input);"
        "else if(action==='bridge-remove')output=e.removeEditorBridge(input);"
        "else if(action==='bridge-state')output=e.editorBridgeState(input);"
        "else throw new Error('unknown action');"
        "process.stdout.write(output);"
    )
    completed = subprocess.run(
        ["node", "-e", script, str(engine_path), action, "1" if force_rtl else "0"],
        input=html,
        text=True,
        capture_output=True,
        check=True,
    )
    return completed.stdout


def find_workbench_bundle(html_path: Path) -> Path:
    """Locate the production Monaco workbench bundle beside the app output tree."""
    candidates = (
        html_path.parent.parent.parent.parent / "workbench" / "workbench.desktop.main.js",
        html_path.parent / "workbench.desktop.main.js",
    )
    found = [candidate for candidate in dict.fromkeys(candidates) if candidate.is_file()]
    if len(found) != 1:
        raise FileNotFoundError(f"Expected one workbench.desktop.main.js, found {len(found)}")
    return found[0]


def atomic_write(path: Path, content: str) -> None:
    """Replace a UTF-8 text file without Windows' existing-target rename failure."""
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.rtl-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if os.name == "nt":
            # os.replace/MoveFileEx can raise EPERM for an existing VS Code
            # product.json even when overwriting that file is allowed.
            with path.open("w", encoding="utf-8", newline="") as target:
                target.write(content)
                target.flush()
                os.fsync(target.fileno())
            temporary.unlink(missing_ok=True)
        else:
            os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def create_backup(
    path: Path, source_content: str | None = None, *, refresh: bool = False
) -> Path:
    """Create or refresh a stock-file backup without ever backing up a patch."""
    backup = Path(f"{path}{BACKUP_SUFFIX}")
    if not backup.exists():
        if source_content is None:
            shutil.copy2(path, backup)
        else:
            atomic_write(backup, source_content)
        return backup
    current = path.read_text(encoding="utf-8") if source_content is None else source_content
    previous = backup.read_text(encoding="utf-8")
    if refresh and current != previous:
        atomic_write(backup, current)
    return backup


def update_product(
    product: dict[str, Any], app_base: Path, html_path: Path, html_content: str
) -> tuple[str, dict[str, Any]]:
    """Update one workbench checksum while preserving every other entry."""
    checksums = product.get("checksums")
    if not isinstance(checksums, dict):
        raise ValueError("product.json has no valid checksums map; refusing to disable integrity")
    key = checksum_key(app_base, html_path, checksums)
    updated = dict(product)
    updated_checksums = dict(checksums)
    updated_checksums[key] = sha256_base64(html_content)
    updated["checksums"] = updated_checksums
    return key, updated


def apply_transaction(html_path: Path, force_rtl: bool, started_at: float) -> None:
    """Apply HTML, runtime, native prompt bridge, and integrity updates."""
    engine_path = Path(__file__).with_name("rtl-engine.js")
    if not engine_path.is_file():
        raise FileNotFoundError(f"Shared engine not found: {engine_path}")
    original_html = html_path.read_text(encoding="utf-8")
    product_path, app_base, product = find_product_json(html_path)
    original_product = product_path.read_text(encoding="utf-8")
    runtime_path = html_path.parent / RUNTIME_NAME
    bundle_path = find_workbench_bundle(html_path)
    runtime_existed = runtime_path.exists()
    original_runtime = runtime_path.read_text(encoding="utf-8") if runtime_existed else None
    original_bundle = bundle_path.read_text(encoding="utf-8")

    patched_html = node_engine(engine_path, "apply", original_html, force_rtl)
    runtime = node_engine(engine_path, "runtime", "", force_rtl)
    key, updated_product = update_product(product, app_base, html_path, patched_html)
    patched_bundle = node_engine(engine_path, "bridge-apply", original_bundle, force_rtl)
    bundle_key, updated_product = update_product(updated_product, app_base, bundle_path, patched_bundle)
    product_content = json.dumps(updated_product, ensure_ascii=False, indent=2) + "\n"

    refresh_backups = PATCH_START not in original_html and PATCH_END not in original_html
    create_backup(html_path, original_html, refresh=refresh_backups)
    create_backup(product_path, original_product, refresh=refresh_backups)
    create_backup(bundle_path, original_bundle, refresh=refresh_backups)
    log("INFO", f"Backups ready; checksum keys={key}, {bundle_key}", started_at)
    try:
        atomic_write(runtime_path, runtime)
        atomic_write(html_path, patched_html)
        atomic_write(bundle_path, patched_bundle)
        atomic_write(product_path, product_content)
        actual = json.loads(product_path.read_text(encoding="utf-8"))
        if actual["checksums"].get(key) != sha256_base64(html_path.read_text(encoding="utf-8")):
            raise RuntimeError("Post-write workbench checksum verification failed")
        if actual["checksums"].get(bundle_key) != sha256_base64(bundle_path.read_text(encoding="utf-8")):
            raise RuntimeError("Post-write Monaco bundle checksum verification failed")
        if patched_html.count(PATCH_START) != 1 or patched_html.count(PATCH_END) != 1:
            raise RuntimeError("Post-write patch marker verification failed")
        log("INFO", f"Patch {VERSION} applied with the stable native Monaco prompt bridge", started_at)
    except BaseException:
        atomic_write(html_path, original_html)
        atomic_write(bundle_path, original_bundle)
        atomic_write(product_path, original_product)
        if runtime_existed and original_runtime is not None:
            atomic_write(runtime_path, original_runtime)
        else:
            runtime_path.unlink(missing_ok=True)
        log("ERROR", "Transaction failed and all changed files were rolled back", started_at)
        raise


def restore_transaction(html_path: Path, started_at: float) -> None:
    """Restore HTML, product integrity data, and the runtime asset together."""
    product_path, _, _ = find_product_json(html_path)
    bundle_path = find_workbench_bundle(html_path)
    html_backup = Path(f"{html_path}{BACKUP_SUFFIX}")
    product_backup = Path(f"{product_path}{BACKUP_SUFFIX}")
    bundle_backup = Path(f"{bundle_path}{BACKUP_SUFFIX}")
    if not html_backup.is_file() or not product_backup.is_file() or not bundle_backup.is_file():
        raise FileNotFoundError("A complete HTML, bundle, and product.json backup set is required")
    runtime_path = html_path.parent / RUNTIME_NAME
    originals = {
        target: target.read_text(encoding="utf-8") if target.is_file() else None
        for target in (html_path, bundle_path, product_path, runtime_path)
    }
    try:
        atomic_write(html_path, html_backup.read_text(encoding="utf-8"))
        atomic_write(bundle_path, bundle_backup.read_text(encoding="utf-8"))
        atomic_write(product_path, product_backup.read_text(encoding="utf-8"))
        runtime_path.unlink(missing_ok=True)
    except BaseException:
        for target, content in originals.items():
            if content is None:
                target.unlink(missing_ok=True)
            else:
                atomic_write(target, content)
        raise
    log("INFO", "Original HTML, runtime, and product integrity data restored", started_at)


def verify(html_path: Path, started_at: float) -> bool:
    """Verify HTML, runtime, native prompt bridge, and selective checksums."""
    html = html_path.read_text(encoding="utf-8")
    product_path, app_base, product = find_product_json(html_path)
    checksums = product.get("checksums")
    if not isinstance(checksums, dict):
        log("ERROR", "product.json checksums map is missing or invalid", started_at)
        return False
    key = checksum_key(app_base, html_path, checksums)
    expected = sha256_base64(html)
    actual = checksums.get(key)
    bundle_path = find_workbench_bundle(html_path)
    bundle = bundle_path.read_text(encoding="utf-8")
    bundle_key = checksum_key(app_base, bundle_path, checksums)
    bundle_expected = sha256_base64(bundle)
    bundle_actual = checksums.get(bundle_key)
    engine_path = Path(__file__).with_name("rtl-engine.js")
    bridge = node_engine(engine_path, "bridge-state", bundle, False) == "valid"
    patched = html.count(PATCH_START) == 1 and html.count(PATCH_END) == 1
    runtime_path = html_path.parent / RUNTIME_NAME
    runtime_exists = runtime_path.is_file()
    runtime_valid = False
    if runtime_exists:
        runtime = runtime_path.read_text(encoding="utf-8")
        expected_runtime = node_engine(engine_path, "runtime", "", False)
        runtime_valid = bool(runtime) and runtime == expected_runtime and f"external runtime {VERSION}" in runtime
    log("INFO", f"product={product_path}; checksum keys={key}, {bundle_key}", started_at)
    log("INFO", f"patched={patched}; external_runtime={runtime_valid}; native_prompt_bridge={bridge}; html_checksum={actual == expected}; bundle_checksum={bundle_actual == bundle_expected}", started_at)
    return patched and runtime_valid and bridge and actual == expected and bundle_actual == bundle_expected


def discover_windows_workbenches() -> list[Path]:
    """Discover direct and hash-based Windows workbench installations."""
    roots = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Microsoft VS Code",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Microsoft VS Code Insiders",
        Path(os.environ.get("ProgramFiles", "")) / "Microsoft VS Code",
        Path(os.environ.get("ProgramFiles", "")) / "Microsoft VS Code Insiders",
    ]
    suffixes = (
        Path("resources/app/out/vs/code/electron-browser/workbench/workbench.html"),
        Path("resources/app/out/vs/code/electron-browser/workbench/workbench.esm.html"),
        Path("out/vs/code/electron-browser/workbench/workbench.html"),
        Path("out/vs/code/electron-browser/workbench/workbench.esm.html"),
    )
    found: list[Path] = []
    for root in roots:
        if not root.is_dir():
            continue
        bases = [root, *(entry for entry in root.iterdir() if entry.is_dir() and all(c in "0123456789abcdefABCDEF" for c in entry.name) and len(entry.name) >= 8)]
        for base in bases:
            for suffix in suffixes:
                candidate = base / suffix
                if candidate.is_file() and candidate not in found:
                    found.append(candidate)
    return found


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=f"Persian RTL for VS Code {VERSION} safe installer")
    parser.add_argument("html", nargs="?", type=Path, help="Path to workbench HTML")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--restore", action="store_true", help="Restore complete original files")
    action.add_argument("--verify", action="store_true", help="Verify patch and integrity")
    action.add_argument("--list", action="store_true", help="List discovered workbench files")
    parser.add_argument("--force-rtl", action="store_true", help="Use forceRtl mode")
    return parser.parse_args()


def main() -> int:
    """Run the selected installer operation and return a process exit status."""
    started_at = time.perf_counter()
    args = parse_args()
    candidates = discover_windows_workbenches()
    if args.list:
        for candidate in candidates:
            print(candidate)
        return 0
    html_path = args.html or (candidates[0] if candidates else None)
    if html_path is None or not html_path.is_file():
        log("ERROR", "Workbench HTML was not found; pass its full path explicitly", started_at)
        return 2
    try:
        if args.restore:
            restore_transaction(html_path, started_at)
        elif args.verify:
            return 0 if verify(html_path, started_at) else 1
        else:
            apply_transaction(html_path, args.force_rtl, started_at)
            log("WARNING", "Fully exit every VS Code window before reopening; Reload Window is insufficient", started_at)
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        log("ERROR", f"{type(error).__name__}: {error}", started_at)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
