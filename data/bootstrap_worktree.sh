#!/bin/sh
set -eu

primary_checkout=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
worktree_root=$(git rev-parse --show-toplevel)
if [ "$worktree_root" != "$primary_checkout" ]; then
    cp -cRn "$primary_checkout/public/data" public/
fi
npm install
