#!/usr/bin/env bash
# The nightly archive of the hub's data directory (deploy/README.md, "Backup and restore").
#
# This script is untested on the maintainer's server: it was written against GNU tar, coreutils and util-linux on
# Linux and has not been run there. Run it by hand once, then deploy/restore-test.sh on its archive, before trusting
# it to a timer.
#
# Usage:   deploy/backup.sh <data dir> <destination dir> [--allow-root]
#
# What one archive (<destination>/copperflow-<UTC time>.tar.gz, mode 600) holds:
#   hub.db          a consistent copy of the database taken while the hub runs (`copperflow hub backup`, which uses
#                   the hub's own node:sqlite; never a file copy of the live database)
#   counts.json     that copy's users, projects and unused invite codes, for the restore test
#   ticket-key.pem  the hub's ticket key (a secret: the archive is as sensitive as the data directory)
#   projects/       every project folder, read as it is at that moment; links are stored as links, never followed;
#                   modes and numeric owners and groups are kept
# Next to it: the archive's .sha256 and a .log of what tar could not read. The newest 14 archives this script made are
# kept; other files in the destination are never touched. The destination is made mode 700 when it does not exist;
# one that group or others may open, or that another user owns, is refused.
#
# Who runs what. As the hub's user (the data directory's owner), everything runs as that user; files a workspace made
# readable to itself only cannot be read then, and tar skips them, says so in the .log, and the script counts them.
# As root, only with --allow-root: `copperflow hub backup` still runs as the data directory's owner (through runuser;
# the script refuses if runuser is missing), so root never opens the live database; root is used only for tar, which
# then reads every project file.
#
# The rule for root: it never opens, creates, reads or redirects to a path inside a directory the hub's user or the
# workspace user can write (the data directory, the staging folder in it), except through tar reading the data
# directory with links stored as links. Everything in the staging folder is done by the owner, root receives the
# database copy as a tar stream on standard output and the counts as captured text, and root writes only into the
# destination, which must be owned by the invoking user with mode 700, with noclobber on every redirection.
#
# COPPERFLOW names the command that runs copperflow (default: copperflow):
#   arrangement A (Compose):  COPPERFLOW="docker exec copperflow-hub node --no-warnings /app/dist/cli.js"
#   arrangement B (systemd):  COPPERFLOW="node --no-warnings /opt/copperflow/dist/cli.js"
set -euo pipefail
umask 077

readonly KEEP=14
readonly STALE_MINUTES=1440

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

# The destination: made owner-only when missing; refused when group or others may open it.
if [[ ! -e $dest ]]; then
  mkdir -m 700 -p -- "$dest"
fi
if [[ ! -d $dest ]]; then
  echo "$dest is not a folder." >&2
  exit 1
fi
dest_mode=$(stat -c %a -- "$dest")
if [[ $(( 8#$dest_mode & 8#077 )) -ne 0 ]]; then
  echo "$dest has mode $dest_mode: group or others may open it. Run chmod 700 on it." >&2
  exit 1
fi
# Only the invoking user may write there, so nothing can be planted where the archive is written.
if [[ $(stat -c %u -- "$dest") -ne $(id -u) ]]; then
  echo "$dest must be owned by the user running this script (uid $(id -u)), mode 700." >&2
  exit 1
fi

# Outside the data directory, compared by real paths (no .. or link can hide it).
real_data=$(realpath -e -- "$data")
real_dest=$(realpath -e -- "$dest")
case "$real_dest/" in
  "$real_data"/*)
    echo "The destination must be outside the data directory." >&2
    exit 1
    ;;
esac

read -r -a copperflow <<< "${COPPERFLOW:-copperflow}"

# As root, copperflow (and the staging folder it writes into) runs as the data directory's owner.
as_owner=()
if [[ $(id -u) -eq 0 ]]; then
  if ! command -v runuser > /dev/null; then
    echo "Running as root needs runuser (util-linux) to run copperflow as the data directory's owner." >&2
    exit 1
  fi
  owner=$(stat -c %U -- "$data")
  if [[ $owner == "root" || $owner == "UNKNOWN" ]]; then
    echo "$data is owned by '$owner', not by the hub's user." >&2
    exit 1
  fi
  as_owner=(runuser -u "$owner" --)
fi

# Staging folders a killed run left behind (each holds a full copy of the database) go after a day (as the owner).
"${as_owner[@]}" find "$data" -mindepth 1 -maxdepth 1 -type d -name '.backup-*' -mmin "+$STALE_MINUTES" -exec rm -rf -- {} +

stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="copperflow-$stamp"
# Files root creates live only in the destination, which only the invoking user can write; noclobber (set -C) makes
# every redirection there fail rather than follow anything already in place.
set -C
projects_part="$dest/.$name.projects.tar"
db_part="$dest/.$name.db.tar"
gz_part="$dest/.$name.tar.gz.part"
staging=""

cleanup() {
  if [[ -n $staging ]]; then
    "${as_owner[@]}" rm -rf -- "$staging"
  fi
  rm -f -- "$projects_part" "$db_part" "$gz_part"
}
trap cleanup EXIT

# Everything in the staging folder is done by the owner: making it, the database copy, counts.json, and the small tar
# of the two that root receives on standard output. Root never opens a path inside it.
staging=$("${as_owner[@]}" mktemp -d "$data/.backup-XXXXXXXX")
counts=$("${as_owner[@]}" "${copperflow[@]}" hub backup --data "$data" --to "$staging/hub.db")
"${as_owner[@]}" sh -c 'printf "%s\n" "$1" > "$0"' "$staging/counts.json" "$counts"
"${as_owner[@]}" tar --create --file - -C "$staging" hub.db counts.json > "$db_part"

members=(ticket-key.pem)
if [[ -d $data/projects ]]; then
  members+=(projects)
fi

# Root's one read in the data directory: tar, without --dereference, so a link is archived as a link and never
# followed. Exit 1 means a file changed while it was read (a running workspace); anything above 1 is a failure.
: > "$projects_part"
set +e
tar --create --file "$projects_part" --numeric-owner --one-file-system --ignore-failed-read \
  -C "$data" "${members[@]}" 2> "$dest/$name.log"
tar_status=$?
set -e
if [[ $tar_status -gt 1 ]]; then
  echo "tar failed with status $tar_status; see $dest/$name.log" >&2
  exit 1
fi
tar --concatenate --file "$projects_part" "$db_part"
gzip -n -c -- "$projects_part" > "$gz_part"

mv -- "$gz_part" "$dest/$name.tar.gz"
(cd -- "$dest" && sha256sum -- "$name.tar.gz" > "$name.tar.gz.sha256")

skipped=$(grep -c -e "Cannot open" -e "Cannot stat" -- "$dest/$name.log" || true)
echo "Wrote $dest/$name.tar.gz ($counts)."
if [[ $skipped -gt 0 ]]; then
  echo "Warning: $skipped file(s) could not be read and are not in the archive; see $dest/$name.log." >&2
fi

# Keep the newest $KEEP archives this script made: exactly its own names (fixed-width UTC times, so they sort by name),
# with their .sha256 and .log. Nothing else in the destination is touched.
mapfile -t archives < <(find "$dest" -maxdepth 1 -type f -regextype posix-extended -regex '.*/copperflow-[0-9]{8}T[0-9]{6}Z\.tar\.gz' -printf '%f\n' | sort -r)
for old in "${archives[@]:KEEP}"; do
  rm -f -- "$dest/$old" "$dest/$old.sha256" "$dest/${old%.tar.gz}.log"
done
