#!/usr/bin/env bash
# The restore test for one archive made by deploy/backup.sh (deploy/README.md, "Backup and restore"): it restores the
# archive into a scratch directory, runs `copperflow hub status --json` on it, and compares the users, projects and
# unused invite codes with the counts the backup recorded. The live data directory is never touched.
#
# This script is untested on the maintainer's server: it was written against GNU tar and coreutils on Linux and has
# not been run there.
#
# Usage:   deploy/restore-test.sh <archive> [--allow-root]
#
# Run it as the hub's user. COPPERFLOW names the command that runs copperflow (default: copperflow). With the hub in a
# container, run the hub's image with the scratch parent mounted at the same path, for example:
#   RESTORE_PARENT=/var/tmp COPPERFLOW="docker run --rm --user 999:999 -v /var/tmp:/var/tmp copperflow-hub:1" \
#     deploy/restore-test.sh /srv/backup/copperflow-20261112T020000Z.tar.gz
set -euo pipefail
umask 077

usage() {
  echo "usage: $0 <archive> [--allow-root]" >&2
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
  echo "Refusing to run as root: run as the hub's user, or add --allow-root." >&2
  exit 1
fi
if [[ ! -f $archive ]]; then
  echo "$archive does not exist." >&2
  exit 1
fi
if [[ -f $archive.sha256 ]]; then
  (cd -- "$(dirname -- "$archive")" && sha256sum --check --quiet -- "$(basename -- "$archive").sha256")
fi

read -r -a copperflow <<< "${COPPERFLOW:-copperflow}"

scratch=$(mktemp -d "${RESTORE_PARENT:-${TMPDIR:-/tmp}}/copperflow-restore.XXXXXX")
cleanup() {
  rm -rf -- "$scratch"
}
trap cleanup EXIT
data="$scratch/data"
mkdir -m 700 -- "$data"

tar --extract --gzip --file "$archive" --directory "$data" --preserve-permissions --numeric-owner
for required in hub.db counts.json ticket-key.pem; do
  if [[ ! -f $data/$required ]]; then
    echo "The archive has no $required." >&2
    exit 1
  fi
done
expected=$(cat -- "$data/counts.json")
rm -f -- "$data/counts.json"

key_mode=$(stat -c %a -- "$data/ticket-key.pem")
if [[ $key_mode != "600" ]]; then
  echo "ticket-key.pem came back with mode $key_mode, not 600." >&2
  exit 1
fi

actual=$("${copperflow[@]}" hub status --json --data "$data")

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
