#!/usr/bin/env bash
# Copy this staging directory into the git repo that actually deploys.
#
# Dry run by default so you can see what would change:
#   tools/sync_to_repo.sh
# Apply it:
#   tools/sync_to_repo.sh --apply
#
# .git is never touched. Everything else in the destination is made to match
# this directory, including deletions, so a file removed here is removed there.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${DEST:-$HOME/Documents/Work/zblauser.github.io}"

if [ ! -d "$DEST/.git" ]; then
  echo "No git repo at: $DEST" >&2
  echo "Set DEST=/path/to/repo and rerun." >&2
  exit 1
fi

MODE=(--dry-run)
LABEL="DRY RUN — nothing written"
if [ "${1:-}" = "--apply" ]; then
  MODE=()
  LABEL="APPLIED"
fi

rsync -av --delete "${MODE[@]}" \
  --exclude '.git/' \
  --exclude '.DS_Store' \
  --exclude '_frame.html' \
  --exclude '_probe.html' \
  "$SRC"/ "$DEST"/

echo
echo "$LABEL"
echo
echo "Destination git status:"
git -C "$DEST" status --short
