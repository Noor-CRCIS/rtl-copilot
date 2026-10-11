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
applying=0

cleanup() {
    status=$?
    trap - EXIT
    if (( status != 0 && applying )); then
        for ((index=${#targets[@]}-1; index>=0; index--)); do
            if [[ ${existed[index]} == 1 ]]; then
                temporary="${targets[index]}.rtl-rollback.$$"
                if cp -p -- "${snapshots[index]}" "$temporary" && mv -f -- "$temporary" "${targets[index]}"; then
                    :
                else
                    echo "Rollback failed for ${targets[index]}." >&2
                    rm -f -- "$temporary"
                fi
            else
                rm -f -- "${targets[index]}"
            fi
        done
    fi
    rm -rf -- "$temp_dir"
    exit "$status"
}
trap cleanup EXIT

decode() {
    printf '%s' "$1" | base64 --decode
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
root=$(realpath -e -- "$root")
[[ -f "$root/product.json" ]] || { echo "Invalid VS Code application root." >&2; exit 2; }

for ((index=0; index<${#targets[@]}; index++)); do
    target=${targets[index]}
    [[ "$target" != *$'\n'* ]] || { echo "Invalid target path." >&2; exit 2; }
    target=$(realpath -m -- "$target")
    targets[index]=$target
    [[ "$target" == "$root/"* ]] || { echo "Target is outside the VS Code application: $target" >&2; exit 2; }
    name=$(basename -- "$target")
    name=${name%.rtl-backup}
    case "$name" in
        product.json|workbench.html|workbench.esm.html|workbench.desktop.main.js|rtl-copilot-runtime.js) ;;
        *) echo "Unsupported VS Code patch target: $target" >&2; exit 2 ;;
    esac
    for ((prior=0; prior<index; prior++)); do
        [[ "${targets[prior]}" != "$target" ]] || { echo "Duplicate target: $target" >&2; exit 2; }
    done
    [[ -d "$(dirname -- "$target")" ]] || { echo "Target directory is missing: $target" >&2; exit 2; }
    if [[ -e "$target" && ! -f "$target" ]]; then
        echo "Target is not a regular file: $target" >&2
        exit 2
    fi
    if [[ -e "$target" ]]; then
        existed[index]=1
        snapshots[index]="$temp_dir/original.$index"
        cp -p -- "$target" "${snapshots[index]}"
    else
        existed[index]=0
        snapshots[index]=
    fi
done

applying=1
for ((index=0; index<${#targets[@]}; index++)); do
    target=${targets[index]}
    if [[ ${operations[index]} == DELETE ]]; then
        rm -f -- "$target"
        continue
    fi
    temporary=$(mktemp "${target}.rtl-elevated.XXXXXX")
    if ! printf '%s' "${payloads[index]}" | base64 --decode > "$temporary"; then
        rm -f -- "$temporary"
        exit 1
    fi
    if [[ ${existed[index]} == 1 ]]; then
        chmod --reference="${snapshots[index]}" "$temporary"
    fi
    mv -f -- "$temporary" "$target"
done
applying=0
