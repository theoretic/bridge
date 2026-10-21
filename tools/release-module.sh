#!/usr/bin/env bash
# Publish modules/AdminThemeBridge/ as the module-only repository the ProcessWire modules
# directory installs from (https://github.com/theoretic/AdminThemeBridge): the directory reads
# the module file from the repository root and takes the repository name as the class name, so
# the theme cannot be listed from this repository, where it lives two levels down.
#
# The module folder's history is split off with `git subtree split` (each release commit of this
# repository that touched modules/AdminThemeBridge/ becomes a commit there, same message and
# author) and pushed to that repository's main branch, with a tag v<version> from getModuleInfo().
#
# Usage (Git Bash):  bash tools/release-module.sh [--dry-run]
#   first time: create the empty public repository theoretic/AdminThemeBridge on GitHub (no README,
#   no licence: both come from modules/AdminThemeBridge/), then run this.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
REMOTE_URL="https://github.com/theoretic/AdminThemeBridge.git"
REMOTE=module
PREFIX=modules/AdminThemeBridge
BRANCH=module-dist
DRY=${1:-}

[ -z "$(git status --porcelain -- "$PREFIX")" ] || { echo "uncommitted changes under $PREFIX: commit first"; exit 1; }
git remote get-url "$REMOTE" >/dev/null 2>&1 || git remote add "$REMOTE" "$REMOTE_URL"

version=$(sed -nE "s/^[[:space:]]*'version' => '([0-9.]+)',.*/\1/p" "$PREFIX/AdminThemeBridge.module.php" | head -1)
[ -n "$version" ] || { echo "no version in getModuleInfo()"; exit 1; }

echo "splitting $PREFIX (AdminThemeBridge $version)"
git subtree split --prefix="$PREFIX" -b "$BRANCH" >/dev/null
for f in AdminThemeBridge.module.php README.md LICENSE; do
	git cat-file -e "$BRANCH:$f" 2>/dev/null || { echo "$f missing at the root of the split"; exit 1; }
done
echo "$(git rev-list --count "$BRANCH") commits, top: $(git log -1 --format='%h %s' "$BRANCH")"

if [ "$DRY" = "--dry-run" ]; then
	echo "dry run: would push $BRANCH to $REMOTE main and tag v$version"
	exit 0
fi
git push "$REMOTE" "$BRANCH:main"
# the tag lives only there (no local tag that could clash with this repository's own)
git push -f "$REMOTE" "$BRANCH:refs/tags/v$version"
echo "published AdminThemeBridge $version to $REMOTE_URL"
