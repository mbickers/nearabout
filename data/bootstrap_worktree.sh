#!/bin/sh
set -eu

primary_checkout=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
worktree_root=$(git rev-parse --show-toplevel)
if [ "$worktree_root" != "$primary_checkout" ]; then
    rsync -a "$primary_checkout/public/data/" public/data/
fi
uv sync
npm install
