#!/bin/sh
# Formats and lints Python (ruff) and TypeScript/CSS (biome).
# With no arguments, covers every non-ignored file in the repo; otherwise only
# the files given.
set -eu

repo_root=$(cd "$(dirname "$0")" && pwd)

if [ "$#" -eq 0 ]; then
    whole_repo=1
    # shellcheck disable=SC2046
    set -- $(git -C "$repo_root" ls-files --cached --others --exclude-standard | sed "s|^|$repo_root/|")
else
    whole_repo=0
fi

py_files=""
web_files=""

for file in "$@"; do
    case "$file" in
        /*) path="$file" ;;
        *) path="$PWD/$file" ;;
    esac

    # a tracked file can be missing from the worktree because it was deleted,
    # which is only a mistake if the caller named it themselves
    if [ ! -f "$path" ]; then
        [ "$whole_repo" -eq 1 ] || { echo "format.sh: no such file: $file" >&2; exit 1; }
        continue
    fi

    case "$path" in
        *.py) py_files="$py_files $path" ;;
        *.ts|*.tsx|*.css) web_files="$web_files $path" ;;
        *) [ "$whole_repo" -eq 1 ] || echo "format.sh: no formatter for $file" >&2 ;;
    esac
done

status=0

if [ -n "$py_files" ]; then
    # shellcheck disable=SC2086
    uv run ruff format -- $py_files || status=1
    # shellcheck disable=SC2086
    uv run ruff check --fix -- $py_files || status=1
fi

if [ -n "$web_files" ]; then
    # shellcheck disable=SC2086
    "$repo_root/node_modules/.bin/biome" check --write --config-path="$repo_root" -- $web_files || status=1
fi

exit $status
