#!/usr/bin/env bash
# The nightly archive of the hub's data directory (deploy/README.md, "Backup and restore").
#
# This script is untested on the maintainer's server: it was written against GNU tar and coreutils on Linux and has
# not been run there. Run it by hand once, then deploy/restore-test.sh on its archive, before trusting it to a timer.
#
# Usage:   deploy/backup.sh <data dir> <destination dir> [--allow-root]
#
# What one archive (<destination>/copperflow-<UTC time>.tar.gz, mode 600) holds:
#   hub.db          a consistent copy of the database taken while the hub runs (`copperflow hub backup`, which uses
#                   the hub's own node:sqlite; never a file copy of the live database)
#   counts.json     that copy's users, projects and unused invite codes, for the restore test
#   ticket-key.pem  the hub's ticket key (a secret: the archive is as sensitive as the data directory)
#   projects/       every project folder, read as it is at that moment; links are stored as links, never followed;
#                   modes and numeric owners are kept
# Next to it: the archive's .sha256 and a .log of what tar could not read. The newest 14 archives are kept.
#
# Run it as the hub's user (it owns the data directory). Files a workspace made readable to itself only cannot be read
# by that user; tar skips them, says so in the .log, and the script reports how many. Root reads everything; it is
# refused unless --allow-root is given.
#
# COPPERFLOW names the command that runs copperflow (default: copperflow). With the hub in a container (Compose):
#   COPPERFLOW="docker exec copperflow-hub node /app/dist/cli.js" deploy/backup.sh /var/lib/copperflow /srv/backup
set -euo pipefail
umask 077

readonly KEEP=14

usage() {
  echo "usage: $0 <data dir> <destination dir> [--allow-root]" >&2
  exit 2
}

[[ $# -ge 2 && $# -le 3 ]] || usage
data=${1%/}
dest=${2%/}
allow_root=no
if [[ $# -eq 3 ]]; then
  [[ $3 == "--allow-root" ]] || usage
  allow_root=yes
fi

if [[ $(id -u) -eq 0 && $allow_root != "yes" ]]; then
  echo "Refusing to run as root: run as the hub's user, or add --allow-root." >&2
  exit 1
fi
if [[ $data != /* || $dest != /* ]]; then
  echo "Both paths must be absolute." >&2
  exit 2
fi
if [[ ! -f $data/hub.db || ! -f $data/ticket-key.pem ]]; then
  echo "$data is not a hub data directory (no hub.db or ticket-key.pem)." >&2
  exit 1
fi
if [[ ! -d $dest ]]; then
  echo "$dest does not exist." >&2
  exit 1
fi
case "$dest/" in
  "$data"/*)
    echo "The destination must be outside the data directory." >&2
    exit 1
    ;;
esac

read -r -a copperflow <<< "${COPPERFLOW:-copperflow}"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="copperflow-$stamp"
staging="$data/.backup-$stamp"
part="$dest/.$name.tar.gz.part"

cleanup() {
  rm -rf -- "$staging"
  rm -f -- "$part"
}
trap cleanup EXIT

mkdir -m 700 -- "$staging"
# As root (--allow-root) the staging folder is given to the data directory's owner, so the hub's user can write in it.
if [[ $(id -u) -eq 0 ]]; then
  chown --reference="$data" -- "$staging"
fi

"${copperflow[@]}" hub backup --data "$data" --to "$staging/hub.db" > "$staging/counts.json"

members=(ticket-key.pem)
if [[ -d $data/projects ]]; then
  members+=(projects)
fi

# No --dereference: links are archived as links. Exit 1 means a file changed while it was read (a running workspace);
# anything above 1 is a failure.
set +e
tar --create --gzip --file "$part" --numeric-owner --one-file-system --ignore-failed-read \
  -C "$staging" hub.db counts.json \
  -C "$data" "${members[@]}" 2> "$dest/$name.log"
tar_status=$?
set -e
if [[ $tar_status -gt 1 ]]; then
  echo "tar failed with status $tar_status; see $dest/$name.log" >&2
  exit 1
fi

mv -- "$part" "$dest/$name.tar.gz"
(cd -- "$dest" && sha256sum -- "$name.tar.gz" > "$name.tar.gz.sha256")

skipped=$(grep -c -e "Cannot open" -e "Cannot stat" -- "$dest/$name.log" || true)
echo "Wrote $dest/$name.tar.gz ($(cat -- "$staging/counts.json"))."
if [[ $skipped -gt 0 ]]; then
  echo "Warning: $skipped file(s) could not be read and are not in the archive; see $dest/$name.log." >&2
fi

# Keep the newest $KEEP archives. The names are fixed-width UTC times, so they sort by name.
mapfile -t archives < <(find "$dest" -maxdepth 1 -type f -name 'copperflow-*.tar.gz' -printf '%f\n' | sort -r)
for old in "${archives[@]:KEEP}"; do
  rm -f -- "$dest/$old" "$dest/$old.sha256" "$dest/${old%.tar.gz}.log"
done
