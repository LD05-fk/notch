#!/usr/bin/env bash
# Publish Notch to GitHub as a public repository and protect its main branch.
#
# For the owner to run by hand, once. It asks before doing anything.
# What it does:
#   1. gh repo create notch --public --source . --push
#   2. Protect main: changes only through pull requests with at least one
#      approving review and a passing `test` check (CI, branch up to date),
#      no force pushes, no deletion. Admins (you) may bypass, so you can
#      still merge your own work.
set -euo pipefail

cd "$(dirname "$0")/.."
NAME=notch

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'Stopped: %s\n' "$*" >&2; exit 1; }

say "Checking prerequisites"
command -v gh >/dev/null || die "the GitHub CLI (gh) is not installed"
gh auth status >/dev/null 2>&1 || die "gh is not logged in; run: gh auth login"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "not on branch main"
[ -z "$(git status --porcelain)" ] || die "there are uncommitted changes"
! git ls-files --error-unmatch config.local.js >/dev/null 2>&1 || die "config.local.js is tracked; it is personal, remove it from git first"
! git remote get-url origin >/dev/null 2>&1 || die "a remote named origin already exists"
OWNER=$(gh api user --jq .login)

cat <<PLAN

This will:
  1. Create the PUBLIC repository github.com/$OWNER/$NAME from this folder
     and push branch main.
  2. Protect main: pull requests only, 1 approving review, the "test" check
     must pass on an up-to-date branch, no force pushes, no deletion,
     admins may bypass.

PLAN
read -r -p "Continue? [y/N] " answer
[ "$answer" = y ] || [ "$answer" = Y ] || die "nothing was done"

say "Creating github.com/$OWNER/$NAME and pushing main"
gh repo create "$NAME" --public --source . --push \
  --description "Learn ten-finger touch typing in small daily steps. Accuracy before speed."

say "Protecting main"
gh api --method PUT "repos/$OWNER/$NAME/branches/main/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["test"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

say "Done: https://github.com/$OWNER/$NAME"
