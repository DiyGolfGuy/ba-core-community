#!/usr/bin/env bash
# Build a Pi release from a reviewed commit in the separate Community repository.
set -euo pipefail

fail() {
    printf 'BA Core release: %s\n' "$*" >&2
    exit 1
}

repo_dir=$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
commit=$(git -C "$repo_dir" rev-parse --verify --end-of-options "${1:-HEAD}^{commit}")
output_dir=${2:-"$repo_dir/dist"}
archive=ba-core-pi5-arm64.tar.gz
required=(install.sh packaging/ba-core.service package.json package-lock.json server.js)

for path in "${required[@]}"; do
    git -C "$repo_dir" cat-file -e "$commit:$path" ||
        fail "Missing $path in the selected commit. Use the reviewed Community source."
done

files=()
while IFS= read -r -d '' record; do
    path=${record#*$'\t'}
    mode=${record%% *}

    # Generated state and private material stay out even if accidentally tracked.
    case "${path,,}" in
        .*|*/.*|*customer*data*|*fixture*|*secret*.json|*credential*.json|*private*key*|*signing*key*| \
        *.db|*.db-*|*.sqlite*|*.bak|*.baenc|*.pem|*.key|*.log|*.tar|*.tar.gz|*.tgz|*.zip| \
        */config.json|*/unit.env.json|*/license.json|*/bootstrap-password.txt| \
        services/license.js|services/update.js|services/updatelist.js| \
        */uploads/*|*/icons/*|*/staff-icon.png|*/backups/*|*/signed/*|*/fleet/*|*/data/*)
            continue ;;
    esac

    case "$path" in
        install.sh|packaging/ba-core.service|packaging/ba-core-broadlink.service|packaging/ba-core-mcp|mcp/ba-core-mcp.js|mcp/owner-actions.json| \
        README.md|SECURITY.md|LICENSE|LICENSE.txt|NOTICE| \
        package.json|package-lock.json|server.js|VERSION| \
        broadlink-bridge.py| \
        scripts/gen-icons.py|scripts/gen-renditions.py|scripts/gen-owner-actions.js|routes/*.js|services/*.js| \
        services/assistant/*.js|services/assistant/areas/*.js|services/assistant/playbooks/*.md| \
        services/assistant/screens/*.md|services/assistant/words-en.txt|services/assistant/words-en.COPYRIGHT.txt| \
        templates/session-monitor.py.template|public/*.html|public/*.css|public/*.js| \
        public/vendor/pdfjs/LICENSE|public/vendor/pdfjs/README.md|public/vendor/pdfjs/*.mjs| \
        public/vendor/pdfjs/standard_fonts/*.pfb|public/vendor/pdfjs/standard_fonts/*.ttf| \
        public/vendor/pdfjs/standard_fonts/LICENSE_FOXIT|public/vendor/pdfjs/standard_fonts/LICENSE_LIBERATION| \
        docs/HOW-IT-WORKS.md|docs/RELEASE-REVIEW.md|docs/customer-guides-current/*)
            [[ $mode == 100644 || $mode == 100755 ]] || fail "Unexpected file type: $path"
            files+=("$path")
            ;;
    esac
done < <(git -C "$repo_dir" ls-tree -rz "$commit")

mkdir -p -- "$output_dir"
stage=$(mktemp -d "$output_dir/.release.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT

git -C "$repo_dir" --literal-pathspecs archive --format=tar --prefix=ba-core/ "$commit" -- "${files[@]}" |
    gzip -n >"$stage/$archive"

tar -tzf "$stage/$archive" >"$stage/contents.txt"
for path in "${required[@]}"; do
    grep -Fxq "ba-core/$path" "$stage/contents.txt" || fail "Archive is missing $path."
done

(
    cd -- "$stage"
    sha256sum -- "$archive" >"$archive.sha256"
    sha256sum --check --strict "$archive.sha256"
)
mv -f -- "$stage/$archive" "$stage/$archive.sha256" "$output_dir/"
printf 'Built %s and %s.sha256 from %s\n' "$output_dir/$archive" "$archive" "$commit"
