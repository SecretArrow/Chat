#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# OctraChat Git Sync Script
# ──────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/git-sync.sh pull   — pull latest at session start
#   ./scripts/git-sync.sh push   — push current state at session end
#   ./scripts/git-sync.sh status — show current sync status
#
# The GitHub token is read from env var GH_TOKEN or ~/.git-octrachat-token.
# NEVER commit the token — it's excluded in .gitignore.
# ──────────────────────────────────────────────────────────────

set -euo pipefail

REPO="SecretArrow/Chat"
BRANCH="main"
TOKEN_FILE="$HOME/.git-octrachat-token"

# Get token from env or file (never echoed, never committed)
get_token() {
  if [ -n "${GH_TOKEN:-}" ]; then
    echo "$GH_TOKEN"
  elif [ -f "$TOKEN_FILE" ]; then
    head -1 "$TOKEN_FILE" | tr -d '[:space:]'
  else
    echo ""
  fi
}

TOKEN=$(get_token)
if [ -z "$TOKEN" ]; then
  echo "⚠️  No GitHub token found."
  echo "   Set GH_TOKEN env var or save token to $TOKEN_FILE"
  echo "   Example: echo 'ghp_xxx' > $TOKEN_FILE && chmod 600 $TOKEN_FILE"
  exit 1
fi

# Configure remote with token (token stays in .git/config, never committed)
setup_remote() {
  cd "$(dirname "$0")/.."
  if ! git remote get-url origin &>/dev/null; then
    git remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
  else
    git remote set-url origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
  fi
}

case "${1:-status}" in
  pull)
    echo "📥 Pulling latest from ${REPO}:${BRANCH}..."
    setup_remote
    git fetch origin "$BRANCH"
    git pull origin "$BRANCH" --no-rebase || {
      echo "⚠️  Pull failed — there may be local conflicts."
      echo "   Resolve manually then run: ./scripts/git-sync.sh push"
    }
    echo "✓ Pull complete"
    ;;

  push)
    echo "📤 Pushing current state to ${REPO}:${BRANCH}..."
    setup_remote
    cd "$(dirname "$0")/.."

    # Stage all changes (except gitignored)
    git add -A

    # Check if there are changes to commit
    if git diff --staged --quiet; then
      echo "✓ No changes to push"
      exit 0
    fi

    # Show what will be committed
    echo "Changes to push:"
    git diff --staged --stat

    # Verify no secrets are being committed
    if git diff --staged --name-only | grep -iE '\.env$|\.env\.local|\.key$|\.pem$|token|secret|wallet\.oct|wallet\.json'; then
      echo "⚠️  WARNING: Potential secret file detected in staged changes!"
      echo "   Review the files above before pushing."
      echo "   Aborting push for safety."
      exit 1
    fi

    # Commit and push
    git commit -m "Sync: $(date -u +'%Y-%m-%d %H:%M:%S UTC')

    Files changed: $(git diff --staged --name-only | wc -l)"

    git push origin "$BRANCH"
    echo "✓ Push complete"
    ;;

  status)
    echo "📊 OctraChat Git Status"
    echo "   Repo: ${REPO}"
    echo "   Branch: ${BRANCH}"
    setup_remote
    cd "$(dirname "$0")/.."

    # Check if we're in a git repo
    if [ ! -d .git ]; then
      echo "   Status: NOT a git repository"
      exit 1
    fi

    # Show current branch
    echo "   Current branch: $(git branch --show-current 2>/dev/null || echo 'none')"

    # Show uncommitted changes
    CHANGES=$(git status --porcelain | wc -l)
    echo "   Uncommitted changes: $CHANGES"

    if [ "$CHANGES" -gt 0 ]; then
      echo ""
      echo "   Modified files:"
      git status --porcelain | head -20
    fi

    # Show last commit
    echo ""
    echo "   Last commit:"
    git log --oneline -1 2>/dev/null || echo "   (no commits yet)"
    ;;

  init)
    echo "🔧 Initializing git repository..."
    cd "$(dirname "$0")/.."

    if [ ! -d .git ]; then
      git init
      git checkout -b "$BRANCH"
    fi

    setup_remote

    git add -A
    git commit -m "Initial commit: OctraChat — E2E encrypted messenger on Octra network

    - Crypto core: Ed25519, Curve25519 ECDH, XSalsa20-Poly1305, AES-256-GCM, Paillier FHE
    - Circle protocol: members, slots, storage, outbox, transport
    - Stealth addressing: ephemeral Curve25519 + view tags
    - Octra HD derivation: HMAC-SHA512(\"Octra seed\", master_seed)[0:32]
    - Transaction builder: faithful port of tx_builder.hpp
    - Circle contract interaction: deploy, join, post, read
    - Local-first hybrid sync: IndexedDB + on-chain
    - UI: Next.js 16 + Tailwind 4 + shadcn-style components
    - Docs: docs.md with full architecture guide"

    git push -u origin "$BRANCH"
    echo "✓ Initial push complete"
    ;;

  *)
    echo "Usage: $0 {pull|push|status|init}"
    echo ""
    echo "Commands:"
    echo "  pull   — Pull latest from GitHub (run at session start)"
    echo "  push   — Push current state to GitHub (run at session end)"
    echo "  status — Show current git status"
    echo "  init   — Initialize repo and push first commit"
    exit 1
    ;;
esac
