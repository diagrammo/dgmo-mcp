#!/usr/bin/env bash
# Pre-flight checks for @diagrammo/dgmo-mcp.
#
# Run this before tagging a new version — the tag-driven CI workflow does the
# actual npm publish via OIDC trusted publishing, so this script is read-only.
# It validates version sync, dependency hygiene, and end-to-end installability
# (build → pack → install in a fresh dir → MCP introspection probe).
#
# Exits non-zero on any failure. Run from the repo root or via `./preflight.sh`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
step()   { printf "\n\033[1;34m▸ %s\033[0m\n" "$*"; }

# ──────────────────────────────────────────────────────────────────
# 1. Pre-flight checks
# ──────────────────────────────────────────────────────────────────

step "Pre-flight: working tree clean?"
if [[ -n "$(git status --porcelain)" ]]; then
  red "✗ working tree has uncommitted changes — commit or stash first"
  git status --short
  exit 1
fi
green "✓ working tree clean"

step "Pre-flight: required tooling?"
for cmd in pnpm npm node git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    red "✗ missing: $cmd"
    exit 1
  fi
done
green "✓ pnpm npm node git all present"

step "Pre-flight: version sync across package.json / manifest.json / server.json"
PKG_VER=$(node -p "require('./package.json').version")
MAN_VER=$(node -p "require('./manifest.json').version")
SRV_VER=$(node -p "require('./server.json').version")
SRV_PKG_VER=$(node -p "require('./server.json').packages[0].version")

echo "  package.json:                  $PKG_VER"
echo "  manifest.json:                 $MAN_VER"
echo "  server.json (top):             $SRV_VER"
echo "  server.json (packages[0]):     $SRV_PKG_VER"

if [[ "$PKG_VER" != "$MAN_VER" || "$PKG_VER" != "$SRV_VER" || "$PKG_VER" != "$SRV_PKG_VER" ]]; then
  red "✗ versions are out of sync"
  exit 1
fi
green "✓ all four version slots agree on $PKG_VER"

step "Pre-flight: no link:/file: deps in package.json"
if node -e "
  const d = require('./package.json').dependencies || {};
  const bad = Object.entries(d).filter(([,v]) => /^(link|file|portal|workspace):/.test(v));
  if (bad.length) { console.error(bad); process.exit(1); }
"; then
  green "✓ all deps are real version ranges"
else
  red "✗ link:/file:/workspace: deps would break npm consumers"
  exit 1
fi

step "Pre-flight: not already published at this version"
if npm view "@diagrammo/dgmo-mcp@$PKG_VER" version 2>/dev/null | grep -q .; then
  red "✗ @diagrammo/dgmo-mcp@$PKG_VER is already on npm — bump first"
  exit 1
fi
green "✓ $PKG_VER is unpublished"

# ──────────────────────────────────────────────────────────────────
# 2. Build
# ──────────────────────────────────────────────────────────────────

step "Install + typecheck + build"
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
green "✓ build clean"

# ──────────────────────────────────────────────────────────────────
# 3. Pack + smoke test
# ──────────────────────────────────────────────────────────────────

step "Pack tarball"
TARBALL="$(npm pack 2>/dev/null | tail -1)"
TARBALL="$ROOT/$TARBALL"
echo "  tarball: $TARBALL"

step "Smoke test (install in fresh dir, MCP introspection probe)"
trap 'rm -f "$TARBALL"' EXIT
node scripts/smoke.mjs "$TARBALL"

green ""
green "✓ pre-flight passed for $PKG_VER"
green ""
echo "Next:  git tag v$PKG_VER && git push --tags  (CI publishes)"
