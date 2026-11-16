#!/bin/sh
# Keeps the site's pages equal to site/public on the main branch of the public repository. Run by a timer as an
# unprivileged user: it reads a public repository over HTTPS and writes only the pages, so no key is stored anywhere.
# nginx.conf and compose.yaml are not touched: a change to how the site is served is copied by hand.
set -eu

REPOSITORY=https://github.com/kurpeeren/copperflow.git
SITE=/opt/copperflow-site
CLONE=$SITE/repo
PUBLIC=$SITE/public
DEPLOYED=$SITE/state/deployed

if [ ! -d "$CLONE/.git" ]; then
  git clone --quiet --depth 1 --branch main "$REPOSITORY" "$CLONE"
fi
git -C "$CLONE" fetch --quiet --depth 1 origin main
new=$(git -C "$CLONE" rev-parse FETCH_HEAD)
old=$(cat "$DEPLOYED" 2>/dev/null || true)
[ "$new" = "$old" ] && exit 0

git -C "$CLONE" reset --quiet --hard FETCH_HEAD
# A commit without the home page is not a site: leave what is being served alone.
if [ ! -f "$CLONE/site/public/index.html" ]; then
  echo "site/public/index.html is missing at $new; the pages were left as they are" >&2
  exit 1
fi
# In place (the web server has this folder mounted), without links that lead out of the folder.
rsync -a --delete --safe-links "$CLONE/site/public/" "$PUBLIC/"
chmod -R a+rX "$PUBLIC"
echo "$new" > "$DEPLOYED"
echo "site updated to $new"
