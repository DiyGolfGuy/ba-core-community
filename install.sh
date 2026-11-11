#!/usr/bin/env bash
# Installs the Community Pi release, or upgrades an existing Community install
# to this release. The facility's settings, bookings and files are preserved.
set -euo pipefail
umask 077

fail() {
    printf 'BA Core install: %s\n' "$*" >&2
    exit 1
}

[[ $EUID == 0 ]] || fail 'Run this installer with sudo.'
[[ $(uname -m) == aarch64 && $(dpkg --print-architecture) == arm64 ]] ||
    fail 'Use a 64-bit Raspberry Pi OS install on a Pi 5.'
[[ -d /run/systemd/system ]] || fail 'This installer needs a booted systemd host.'

release_dir=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
unit_source="$release_dir/packaging/ba-core.service"
bridge_unit_source="$release_dir/packaging/ba-core-broadlink.service"
service_user=ba-core
state_root=/var/lib/ba-core
app_dir="$state_root/app"
install_marker="$state_root/.community-install"
release_list="$state_root/.release-files"
unit_path=/etc/systemd/system/ba-core.service
bridge_unit_path=/etc/systemd/system/ba-core-broadlink.service
mcp_source="$release_dir/mcp/ba-core-mcp.js"
mcp_wrapper="$release_dir/packaging/ba-core-mcp"
mcp_guide_reader="$release_dir/services/installed-guides.js"
mcp_lib=/usr/local/lib/ba-core
mcp_bin=/usr/local/bin/ba-core-mcp

node_version=v26.13.0
node_archive="node-$node_version-linux-arm64.tar.xz"
# https://nodejs.org/dist/v26.13.0/SHASUMS256.txt
node_sha=406fe3fbde1c054adff8b297c16fdb5af6659db327c1ac8acd46b56ef1af9a92
runtime_parent=/opt/ba-core
node_root="$runtime_parent/node-$node_version"
node_bin="$node_root/bin/node"

# What a release puts in the app directory. Everything else found there belongs
# to the facility (settings, the database, backups, waivers, uploads, the hosted
# AI connection, the tunnel's files) and is carried across an upgrade untouched.
release_entries=(server.js package.json package-lock.json VERSION broadlink-bridge.py
    docs public routes scripts services templates)

for file in "$release_dir/server.js" "$release_dir/package.json" \
    "$release_dir/package-lock.json" "$unit_source"; do
    [[ -f $file ]] || fail 'Run install.sh from the extracted BA Core release.'
done

exec 9>/run/ba-core-install.lock
flock -n 9 || fail 'Another BA Core installation is running.'
[[ ! -L $state_root && ! -L $runtime_parent ]] ||
    fail 'The service or runtime directory is a symbolic link.'

# 1 while an upgrade replaces the files of the release before it.
replace_existing=0
upgrade_keep=

install_mcp_file() {
    local source_file=$1 dest=$2 mode=$3
    [[ -f $source_file && ! -L $source_file ]] || fail "Missing or invalid diagnostics file: $source_file."
    if [[ -e $dest || -L $dest ]]; then
        [[ -f $dest && ! -L $dest ]] || fail "An unexpected file type exists at $dest."
        if cmp -s -- "$source_file" "$dest"; then return; fi
        [[ $replace_existing == 1 ]] || fail "A different diagnostics file already exists at $dest."
    fi
    install -o root -g root -m "$mode" "$source_file" "$dest"
}

install_mcp() {
    if [[ ! -f $mcp_source && ! -f $mcp_wrapper ]]; then return; fi
    [[ ! -L $mcp_lib && ! -L $mcp_lib/guides ]] || fail 'The diagnostics directory is a symbolic link.'
    install -d -o root -g root -m 0755 "$mcp_lib" "$mcp_lib/guides"
    # The SSH user runs root-owned code and reads copies from the reviewed release,
    # independently of the app files writable by the service user.
    local guide
    if [[ $replace_existing == 1 ]]; then
        # Guides a newer release no longer ships are removed with the release before it.
        for guide in "$mcp_lib"/guides/*.md; do
            if [[ -f $guide && ! -e "$release_dir/docs/customer-guides-current/${guide##*/}" ]]; then rm -f -- "$guide"; fi
        done
    fi
    for guide in "$release_dir"/docs/customer-guides-current/*.md; do
        install_mcp_file "$guide" "$mcp_lib/guides/${guide##*/}" 0644
    done
    install_mcp_file "$mcp_guide_reader" "$mcp_lib/installed-guides.js" 0644
    install_mcp_file "$mcp_source" "$mcp_lib/ba-core-mcp.js" 0644
    if [[ -f $release_dir/mcp/owner-actions.json ]]; then
        install_mcp_file "$release_dir/mcp/owner-actions.json" "$mcp_lib/owner-actions.json" 0644
    fi
    install_mcp_file "$mcp_wrapper" "$mcp_bin" 0755
}

# Answers 0 once the service is active and its local setup state reads correctly.
wait_healthy() {
    local state attempt
    for attempt in {1..60}; do
        if systemctl is-active --quiet ba-core.service &&
            state=$(curl --fail --silent --max-time 2 --max-filesize 1024 --noproxy '*' \
                http://127.0.0.1:3001/api/auth/setup/state) &&
            "$node_bin" -e 'try {
                const state = JSON.parse(process.argv[1]);
                if (state.local === true && typeof state.setup_complete === "boolean" &&
                    state.lan_ready === state.setup_complete) process.exit(0);
            } catch {}
            process.exit(1);' "$state"; then
            return 0
        fi
        sleep 1
    done
    return 1
}

start_service() {
    systemctl daemon-reload
    systemctl enable --now ba-core.service
    wait_healthy ||
        fail 'BA Core did not respond on port 3001. Check sudo journalctl -u ba-core -n 60 --no-pager, then retry.'
}

verify_runtime() {
    local package_manifest=$1
    [[ -x $node_bin && $("$node_bin" --version) == "$node_version" && $("$node_bin" -p 'process.arch') == arm64 ]] ||
        fail 'The installed Node runtime must report the expected version and ARM64 architecture.'
    [[ $("$node_bin" -p 'require(process.argv[1]).engines.node' "$package_manifest") == "${node_version#v}" ]] ||
        fail 'This release declares a different Node version than its installer provides.'
}

stage=
runtime_stage=
cleanup() {
    if [[ -n $stage ]]; then rm -rf -- "$stage"; fi
    if [[ -n $runtime_stage ]]; then rm -rf -- "$runtime_stage"; fi
}
trap cleanup EXIT

# The pinned Node build, verified against its published checksum. A release with a
# newer pin installs beside the one in use; the earlier runtime stays for a rollback.
install_runtime() {
    install -d -o root -g root -m 0755 "$runtime_parent"
    if [[ -e $node_root || -L $node_root ]]; then
        [[ -d $node_root && ! -L $node_root && -x $node_bin ]] ||
            fail 'An unrecognised Node runtime directory already exists.'
    else
        runtime_stage=$(mktemp -d "$runtime_parent/.install.XXXXXXXX")
        curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
            --retry 3 --connect-timeout 15 --max-time 240 \
            --output "$runtime_stage/$node_archive" "https://nodejs.org/dist/$node_version/$node_archive"
        (
            cd -- "$runtime_stage"
            printf '%s  %s\n' "$node_sha" "$node_archive" | sha256sum --check --strict -
            tar -xJf "$node_archive" --no-same-owner
            mv -T -- "node-$node_version-linux-arm64" "$node_root"
        )
    fi
    verify_runtime "$release_dir/package.json"
}

# Copies this release into a staging directory and installs its dependencies there.
stage_app() {
    local entry
    stage=$(mktemp -d "$state_root/.install.XXXXXXXX")
    chmod 0711 "$stage"
    install -d -o "$service_user" -g "$service_user" -m 0750 "$stage/app" "$stage/npm-cache"
    for entry in "${release_entries[@]}"; do
        if [[ -e $release_dir/$entry ]]; then
            cp -a -- "$release_dir/$entry" "$stage/app/"
        fi
    done
    chown -R -- "$service_user:$service_user" "$stage/app"
    (
        cd -- "$stage/app"
        runuser -u "$service_user" -- env npm_config_cache="$stage/npm-cache" \
            "$node_bin" "$node_root/lib/node_modules/npm/bin/npm-cli.js" \
            ci --omit=dev --ignore-scripts --no-audit --no-fund
    )
}

# BroadLink infrared control is optional. Its bridge needs two Python modules from
# the system packages; without them BA Core runs and only the BroadLink cards stay idle.
install_bridge() {
    if [[ ! -f $bridge_unit_source || ! -f $app_dir/broadlink-bridge.py ]]; then return 0; fi
    if ! python3 -c 'import flask, broadlink' >/dev/null 2>&1; then
        apt-get install -y --no-install-recommends python3-flask python3-broadlink >/dev/null 2>&1 || true
    fi
    if python3 -c 'import flask, broadlink' >/dev/null 2>&1; then
        install -o root -g root -m 0644 "$bridge_unit_source" "$bridge_unit_path"
        systemctl daemon-reload
        systemctl enable ba-core-broadlink.service >/dev/null 2>&1 || true
        systemctl restart ba-core-broadlink.service ||
            printf 'BroadLink IR: the bridge did not start. Check sudo journalctl -u ba-core-broadlink -n 30 --no-pager.\n'
    else
        printf 'BroadLink IR is not available: the python3-flask and python3-broadlink system packages could not be installed. Everything else works; BroadLink devices stay idle until they are.\n'
    fi
}

# True when every file this release ships is already installed unchanged.
same_release() {
    local entry file
    for entry in "${release_entries[@]}"; do
        [[ -e $release_dir/$entry ]] || continue
        while IFS= read -r -d '' file; do
            cmp -s -- "$file" "$app_dir/${file#"$release_dir"/}" || return 1
        done < <(find "$release_dir/$entry" -type f -print0)
    done
    return 0
}

# Records which files the installed release shipped, so the next upgrade can tell a
# page the release dropped from a file the facility added.
write_release_list() {
    local entry
    (
        cd -- "$release_dir"
        for entry in "${release_entries[@]}"; do
            if [[ -e $entry ]]; then find "$entry" -type f -print; fi
        done | LC_ALL=C sort
    ) >"$release_list.new"
    chmod 0600 "$release_list.new"
    mv -f -- "$release_list.new" "$release_list"
}

# True when the release installed before this one shipped the given path under public/.
shipped_before() {
    [[ -f $release_list ]] && grep -q -e "^public/$1\$" -e "^public/$1/" "$release_list"
}

is_release_entry() {
    local name=$1 entry
    for entry in "${release_entries[@]}" node_modules; do
        if [[ $name == "$entry" ]]; then return 0; fi
    done
    return 1
}

# Carries the facility's own files from the running install into the staged one.
# Files are copied; directories are linked file by file so a large backup or
# upload folder costs no extra room and the earlier install stays whole.
carry_data() {
    local from=$1 to=$2 item name
    shopt -s dotglob nullglob
    for item in "$from"/*; do
        name=${item##*/}
        if is_release_entry "$name"; then continue; fi
        if [[ -d $item && ! -L $item && $name != tunnel ]]; then
            cp -al -- "$item" "$to/"
        else
            cp -a -- "$item" "$to/"
        fi
    done
    # Under public/, what neither this release nor the one before it shipped is the
    # facility's own (uploads, generated icons, the staff icon).
    for item in "$from"/public/*; do
        name=${item##*/}
        if [[ -e $release_dir/public/$name ]] || shipped_before "$name"; then continue; fi
        if [[ -d $item && ! -L $item ]]; then
            cp -al -- "$item" "$to/public/"
        else
            cp -a -- "$item" "$to/public/"
        fi
    done
    shopt -u dotglob nullglob
}

rollback_upgrade() {
    local previous=$1 failed=$2
    printf 'BA Core install: the new release did not start. Putting the earlier version back.\n' >&2
    systemctl stop ba-core.service >/dev/null 2>&1 || true
    mv -T -- "$app_dir" "$failed"
    mv -T -- "$previous" "$app_dir"
    if [[ -f $upgrade_keep/ba-core.service ]]; then
        install -o root -g root -m 0644 "$upgrade_keep/ba-core.service" "$unit_path"
    fi
    if [[ -d $upgrade_keep/mcp-lib ]]; then
        rm -rf -- "$mcp_lib"
        cp -a -- "$upgrade_keep/mcp-lib" "$mcp_lib"
    fi
    if [[ -f $upgrade_keep/ba-core-mcp ]]; then
        install -o root -g root -m 0755 "$upgrade_keep/ba-core-mcp" "$mcp_bin"
    fi
    systemctl daemon-reload
    systemctl start ba-core.service >/dev/null 2>&1 || true
    fail "The upgrade was undone and the earlier version restarted. The release that failed is kept at $failed for inspection; your data was not changed."
}

upgrade() {
    local stamp previous failed from_version to_version old
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    previous="$state_root/app.previous-$stamp"
    failed="$state_root/app.failed-$stamp"
    upgrade_keep="$state_root/.upgrade-$stamp"
    from_version=$("$node_bin" -p 'require(process.argv[1]).version' "$app_dir/package.json" 2>/dev/null || echo unknown)

    install_runtime
    to_version=$("$node_bin" -p 'require(process.argv[1]).version' "$release_dir/package.json")
    stage_app

    # Everything above ran with the facility still open. From here it is closed
    # until the new release answers, or the earlier one is back.
    systemctl stop ba-core-broadlink.service >/dev/null 2>&1 || true
    systemctl stop ba-core.service
    install -d -o root -g root -m 0700 "$upgrade_keep"
    # A root-only copy of the small files a facility cannot lose, taken before anything moves.
    shopt -s nullglob
    for old in "$app_dir"/config.json "$app_dir"/*.db "$app_dir"/owner-ai-secrets.json; do
        cp -a -- "$old" "$upgrade_keep/"
    done
    shopt -u nullglob
    if [[ -f $unit_path && ! -L $unit_path ]]; then cp -a -- "$unit_path" "$upgrade_keep/ba-core.service"; fi
    if [[ -d $mcp_lib && ! -L $mcp_lib ]]; then cp -a -- "$mcp_lib" "$upgrade_keep/mcp-lib"; fi
    if [[ -f $mcp_bin && ! -L $mcp_bin ]]; then cp -a -- "$mcp_bin" "$upgrade_keep/ba-core-mcp"; fi

    carry_data "$app_dir" "$stage/app"
    mv -T -- "$app_dir" "$previous"
    mv -T -- "$stage/app" "$app_dir"
    install -o root -g root -m 0644 "$unit_source" "$unit_path"
    replace_existing=1
    install_mcp
    systemctl daemon-reload
    systemctl enable ba-core.service >/dev/null 2>&1 || true
    systemctl start ba-core.service || true
    if ! wait_healthy; then
        rollback_upgrade "$previous" "$failed"
    fi
    write_release_list
    install_bridge

    # One earlier version is kept; older ones, and older safety copies, go.
    shopt -s nullglob
    for old in "$state_root"/app.previous-* "$state_root"/app.failed-* "$state_root"/.upgrade-*; do
        if [[ $old == "$previous" || $old == "$upgrade_keep" ]]; then continue; fi
        rm -rf -- "$old"
    done
    shopt -u nullglob

    printf '\nBA Core was upgraded from %s to %s. Settings, bookings and files were kept.\n' "$from_version" "$to_version"
    printf 'The earlier version is at %s and a copy of its settings and database at %s.\n' "$previous" "$upgrade_keep"
    printf 'Once you are happy with the new release you can remove both:\n  sudo rm -rf %s %s\n' "$previous" "$upgrade_keep"
}

if [[ -e $app_dir || -L $app_dir ]]; then
    [[ -f $install_marker && ! -L $app_dir && -f $app_dir/server.js ]] ||
        fail 'An unrecognised install already exists. Preserve it and choose a clean Pi.'
    if same_release; then
        verify_runtime "$app_dir/package.json"
        if [[ -e $unit_path || -L $unit_path ]]; then
            [[ -f $unit_path && ! -L $unit_path ]] && cmp -s -- "$unit_source" "$unit_path" ||
                fail 'An existing service file differs from this release. Its settings were preserved.'
        else
            install -o root -g root -m 0644 "$unit_source" "$unit_path"
        fi
        if [[ -f $app_dir/services/installed-guides.js ]]; then install_mcp; fi
        start_service 9>&-
        write_release_list
        install_bridge
        printf 'This BA Core release is already installed. It was started; its files and settings were preserved.\n'
        exit 0
    fi
    upgrade 9>&-
    exit 0
fi
if systemctl cat ba-core.service >/dev/null 2>&1; then
    fail 'A BA Core service already exists. Preserve it and use a clean Pi.'
fi
[[ ! -e $unit_path && ! -L $unit_path ]] ||
    fail 'A BA Core unit file already exists. Preserve it and use a clean Pi.'

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl iproute2 \
    iputils-ping libatomic1 libstdc++6 python3 python3-pil unzip xz-utils zip
listen_state=$(ss -ltnH 'sport = :3001') || fail 'Could not inspect local port 3001.'
[[ -z $listen_state ]] ||
    fail 'Port 3001 is already in use. Identify the current service before installing BA Core.'

if id "$service_user" >/dev/null 2>&1; then
    IFS=: read -r _ _ _ _ _ existing_home existing_shell < <(getent passwd "$service_user")
    [[ $existing_home == "$state_root" && $existing_shell == /usr/sbin/nologin &&
        $(id -gn "$service_user") == "$service_user" ]] ||
        fail 'An unrelated ba-core account already exists.'
else
    useradd --system --user-group --home-dir "$state_root" --no-create-home \
        --shell /usr/sbin/nologin "$service_user"
fi
install -d -o root -g "$service_user" -m 0750 "$state_root"

install_runtime
stage_app

# Commit the complete app at once. Once committed, a retry only starts it.
install -o root -g root -m 0600 /dev/null "$install_marker"
mv -T -- "$stage/app" "$app_dir"
install -o root -g root -m 0644 "$unit_source" "$unit_path"
install_mcp
start_service 9>&-
write_release_list
install_bridge

printf '\nBA Core is running. On your computer, forward port 33001 to the Pi using SSH.\n'
printf '  ssh -o ExitOnForwardFailure=yes -N -L 127.0.0.1:33001:127.0.0.1:3001 YOUR_PI_USER@YOUR_PI_HOST\n'
printf 'Open http://127.0.0.1:33001/setup on that computer.\n'
printf '\nBuilt by BA Custom Products LLC. https://www.bacustomproducts.com/\n'
