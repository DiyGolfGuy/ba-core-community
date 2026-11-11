#!/usr/bin/env bash
# Runs the long batteries against a throwaway copy of this tree.
#
#   bash batteries/run.sh                 every battery
#   bash batteries/run.sh refunds tax     only test-refunds.js and test-tax.js
#
# A battery starts its own server on fixed ports and writes its own config.json
# and bookings.db where it runs, so it never runs in the working tree: this
# script copies the tree to a temporary folder first. One run at a time per
# machine (the ports are fixed). Run `npm ci` first; the copy links node_modules.
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ -d $repo/node_modules ]] || { echo 'Run npm ci first.' >&2; exit 2; }
exec 9>"${TMPDIR:-/tmp}/ba-core-batteries.lock"
flock -n 9 || { echo 'Another battery run is in progress on this machine.' >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/ba-core-batteries.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
tree="$work/tree"
mkdir -p "$tree"
for entry in server.js package.json package-lock.json broadlink-bridge.py install.sh README.md LICENSE.txt \
    docs mcp packaging public routes scripts services templates test; do
    [[ -e $repo/$entry ]] && cp -a -- "$repo/$entry" "$tree/"
done
ln -s "$repo/node_modules" "$tree/node_modules"
cp -a -- "$repo"/batteries/test-*.js "$tree/"
cp -a -- "$repo/batteries/tools" "$tree/tools"
cp -a -- "$repo/batteries/support" "$tree/battery-support"

if [[ $# -gt 0 ]]; then
    names=(); for name in "$@"; do names+=("test-${name#test-}"); done
    names=("${names[@]%.js}")
else
    names=(); for file in "$tree"/test-*.js; do name=${file##*/}; names+=("${name%.js}"); done
fi

cd -- "$tree"
# Sign-in for the batteries: see batteries/support/header-session.cjs.
export NODE_OPTIONS="--require $tree/battery-support/header-session.cjs"
export BA_CORE_COMMUNITY=1
failed=()
checks=0
for name in "${names[@]}"; do
    [[ -f $name.js ]] || { echo "No battery named $name" >&2; failed+=("$name"); continue; }
    rm -rf config.json config.json.next ./*.db ./*.db-* owner-ai-secrets.json public/uploads backups waivers
    log="$work/$name.log"
    status=0
    timeout 300 node "$name.js" >"$log" 2>&1 || status=$?
    passes=$(grep -c '^PASS' "$log" || true)
    fails=$(grep -c '^FAIL' "$log" || true)
    checks=$((checks + passes))
    if [[ $status -eq 0 && $fails -eq 0 ]]; then
        printf 'ok    %-34s %s checks\n' "$name" "$passes"
    else
        printf 'FAIL  %-34s exit %s, %s passed, %s failed\n' "$name" "$status" "$passes" "$fails"
        grep -m5 '^FAIL' "$log" | cut -c1-300 || true
        tail -n 3 "$log" | cut -c1-300
        failed+=("$name")
    fi
    # a battery that crashed may leave its server behind
    for pid in $(pgrep -f 'node' || true); do
        [[ $(readlink "/proc/$pid/cwd" 2>/dev/null || true) == "$tree" ]] && kill -9 "$pid" 2>/dev/null || true
    done
done

echo
if [[ ${#failed[@]} -eq 0 ]]; then
    printf 'BATTERIES: %s passed, %s checks\n' "${#names[@]}" "$checks"
else
    printf 'BATTERIES: %s of %s FAILED: %s\n' "${#failed[@]}" "${#names[@]}" "${failed[*]}"
    exit 1
fi
