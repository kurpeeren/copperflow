#!/usr/bin/env bash
# The restore test for one archive made by deploy/backup.sh (deploy/README.md, "Backup and restore"): it restores the
# archive into a scratch directory exactly as the README's restore does (as root, owners, groups and modes kept), runs
# `copperflow hub check-data` on it (owners, groups, modes and links the hub relies on), then `copperflow hub status
# --json`, and compares the users, projects and unused invite codes with the counts the backup recorded. The live data
# directory is never touched.
#
# This script is untested on the maintainer's server: it was written against GNU tar, coreutils and util-linux on
# Linux and has not been run there.
#
# Usage:   CF_WORKSPACE_GID=<gid> deploy/restore-test.sh <archive> --allow-root
#
# Run it as root with --allow-root: only root can give the restored files their owners and groups back, and a
# restore without them is exactly what the test must catch. Without root it still runs, and check-data then reports
# every entry in the wrong group. copperflow itself always runs as the restored data directory's owner (runuser), never
# as root. CF_WORKSPACE_GID is the workspace group's gid (as in hub.env).
#
# COPPERFLOW names the command that runs copperflow (default: copperflow); arrangement B:
#   COPPERFLOW="node --no-warnings /opt/copperflow/dist/cli.js"
# Arrangement A: set COPPERFLOW_IMAGE to the hub's image instead (for example copperflow-hub:1); the script runs it with
# `docker run` as the data directory's owner and group, with the workspace group added and the scratch directory
# mounted at the same path. RESTORE_PARENT chooses where the scratch directory goes (default: $TMPDIR or /tmp).
set -euo pipefail
umask 077

usage() {
  echo "usage: CF_WORKSPACE_GID=<gid> $0 <archive> [--allow-root]" >&2
  exit 2
}

[[ $# -ge 1 && $# -le 2 ]] || usage
archive=$1
allow_root=no
if [[ $# -eq 2 ]]; then
  [[ $2 == "--allow-root" ]] || usage
  allow_root=yes
fi

if [[ $(id -u) -eq 0 && $allow_root != "yes" ]]; then
  echo "Refusing to run as root without --allow-root." >&2
  exit 1
fi
if [[ ! ${CF_WORKSPACE_GID:-} =~ ^[1-9][0-9]*$ ]]; then
  echo "Set CF_WORKSPACE_GID to the workspace group's gid." >&2
  exit 2
fi
if [[ ! -f $archive ]]; then
  echo "$archive does not exist." >&2
  exit 1
fi
if [[ -f $archive.sha256 ]]; then
  (cd -- "$(dirname -- "$archive")" && sha256sum --check --quiet -- "$(basename -- "$archive").sha256")
fi

scratch=$(mktemp -d "${RESTORE_PARENT:-${TMPDIR:-/tmp}}/copperflow-restore.XXXXXX")
cleanup() {
  rm -rf -- "$scratch"
}
trap cleanup EXIT
data="$scratch/data"
mkdir -m 700 -- "$data"

if [[ $(id -u) -eq 0 ]]; then
  tar --extract --gzip --file "$archive" --directory "$data" --same-owner --numeric-owner --preserve-permissions
else
  echo "Not root: owners and groups cannot be restored, so check-data will report them." >&2
  tar --extract --gzip --file "$archive" --directory "$data" --numeric-owner --preserve-permissions
fi
for required in hub.db counts.json ticket-key.pem; do
  if [[ ! -f $data/$required ]]; then
    echo "The archive has no $required." >&2
    exit 1
  fi
done
expected=$(cat -- "$data/counts.json")
rm -f -- "$data/counts.json"

# The data directory itself is not in the archive: it gets the owner of the database, as on the server.
owner_ids=$(stat -c %u:%g -- "$data/hub.db")
copperflow_cmd=()
if [[ $(id -u) -eq 0 ]]; then
  chown -- "$owner_ids" "$data"
  chmod 711 -- "$scratch"
fi
if [[ -n ${COPPERFLOW_IMAGE:-} ]]; then
  copperflow_cmd=(docker run --rm --user "$owner_ids" --group-add "$CF_WORKSPACE_GID" -v "$scratch:$scratch" "$COPPERFLOW_IMAGE")
else
  read -r -a copperflow <<< "${COPPERFLOW:-copperflow}"
  if [[ $(id -u) -eq 0 ]]; then
    if ! command -v runuser > /dev/null; then
      echo "Running as root needs runuser (util-linux) to run copperflow as the data directory's owner." >&2
      exit 1
    fi
    copperflow_cmd=(runuser -u "$(stat -c %U -- "$data/hub.db")" -- "${copperflow[@]}")
  else
    copperflow_cmd=("${copperflow[@]}")
  fi
fi

if ! "${copperflow_cmd[@]}" hub check-data --data "$data" --workspace-group "$CF_WORKSPACE_GID"; then
  echo "check-data found problems in the restored copy (above)." >&2
  exit 1
fi

actual=$("${copperflow_cmd[@]}" hub status --json --data "$data")

# One number from a one-line JSON object made by copperflow itself (no spaces, fixed key names).
field() {
  sed -n "s/.*\"$1\":\([0-9][0-9]*\).*/\1/p" <<< "$2"
}

failed=no
for key in users projects unusedInvites; do
  want=$(field "$key" "$expected")
  got=$(field "$key" "$actual")
  if [[ -z $want || $want != "$got" ]]; then
    echo "$key: the backup recorded '$want', the restored copy has '$got'." >&2
    failed=yes
  fi
done
if [[ $failed == "yes" ]]; then
  exit 1
fi
echo "Restore test passed for $archive: $expected."
