#!/usr/bin/env bash
# Install this file as opencode-dev in the development root; execute, do not source.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
umask 077
mkdir -p "$root"/{home,data,config/opencode,cache,state,tmp,runtime,workspaces/scratch,tools/bun/bin}

# Start from an allowlist so provider keys, server overrides, shell startup hooks,
# and official OpenCode settings are not silently inherited.
keep=()
for name in PATH USER LOGNAME SHELL TERM COLORTERM TERM_PROGRAM LANG LC_ALL LC_CTYPE TZ \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy \
  SSL_CERT_FILE SSL_CERT_DIR NODE_EXTRA_CA_CERTS; do
  if [[ -v "$name" ]]; then keep+=("$name=${!name}"); fi
done

bin=""
if [[ "${1-}" == "--exec" ]]; then
  shift
  if [[ $# -eq 0 || "$1" != /* ]]; then
    echo 'Usage: opencode-dev --exec /absolute/path/to/program [args...]' >&2
    exit 2
  fi
else
  if [[ "${1-}" == upgrade || "${1-}" == update || "${1-}" == uninstall ]]; then
    echo 'Use the source-build installation/rollback procedure in the guide.' >&2
    exit 2
  fi
  if [[ ! -f "$root/current.txt" ]]; then
    echo 'No development build installed: follow the build and installation steps.' >&2
    exit 2
  fi
  version="$(cat "$root/current.txt")"
  if [[ ! "$version" =~ ^0\.0\.0-local-[0-9]+$ ]]; then
    echo 'Invalid development build in current.txt.' >&2
    exit 2
  fi
  bin="$root/releases/$version/bin"
  if [[ ! -x "$bin/opencode" ]]; then
    echo "Missing executable: $bin/opencode" >&2
    exit 2
  fi
  case "$PWD/" in
    "$root/"*) ;;
    *) cd "$root/workspaces/scratch" ;;
  esac
  set -- "$bin/opencode" "$@"
fi

exec env -i "${keep[@]}" \
  PATH="${bin:+$bin:}$root/tools/bun/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}" \
  HOME="$root/home" PWD="$PWD" \
  XDG_DATA_HOME="$root/data" XDG_CONFIG_HOME="$root/config" \
  XDG_CACHE_HOME="$root/cache" XDG_STATE_HOME="$root/state" XDG_RUNTIME_DIR="$root/runtime" \
  TMPDIR="$root/tmp" TMP="$root/tmp" TEMP="$root/tmp" \
  BUN_INSTALL="$root/tools/bun" BUN_INSTALL_CACHE_DIR="$root/cache/bun" \
  npm_config_cache="$root/cache/npm" npm_config_prefix="$root/tools/npm" \
  npm_config_userconfig="$root/home/.npmrc" \
  OPENCODE_CHANNEL=local OPENCODE_VERSION="0.0.0-local-$(date -u +%Y%m%d%H%M%S)" \
  OPENCODE_CONFIG_DIR="$root/config/opencode" \
  OPENCODE_DB="$root/data/opencode/opencode-local.db" \
  OPENCODE_TUI_CHANNEL=local OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_CONFIG_PROJECT_DISABLE=1 \
  "$@"
