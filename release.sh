#!/usr/bin/env bash
# Release pipeline for @diagrammo/dgmo-mcp.
#
# Validates version sync + dependency hygiene, builds, smoke-tests the packed
# tarball end-to-end (install → MCP introspection), then publishes to npm,
# pushes server.json to the Anthropic MCP registry, and rebuilds the .mcpb
# bundle for Claude Desktop distribution.
#
# Usage:
#   ./release.sh           # full release pipeline (asks before publishing)
#   ./release.sh --dry-run # validate + build + smoke test, stop before publish

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
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
for cmd in pnpm npm node mcp-publisher git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    red "✗ missing: $cmd"
    exit 1
  fi
done
green "✓ pnpm npm node mcp-publisher git all present"

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
  red "✗ link:/file:/workspace: deps would break npm consumers (exactly today's bug)"
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
node scripts/smoke.mjs "$TARBALL"

# ──────────────────────────────────────────────────────────────────
# 4. Publish (or stop, if --dry-run)
# ──────────────────────────────────────────────────────────────────

if [[ $DRY_RUN -eq 1 ]]; then
  yellow "▸ --dry-run: stopping before publish"
  yellow "  tarball preserved at: $TARBALL"
  exit 0
fi

step "Confirm publish"
echo "  Will publish:"
echo "    @diagrammo/dgmo-mcp@$PKG_VER → npm"
echo "    server.json (v$PKG_VER) → Anthropic MCP registry"
echo "    rebuild dgmo-mcp.mcpb"
echo "    git tag v$PKG_VER + push"
read -rp "Proceed? [y/N] " ans
[[ "$ans" =~ ^[Yy]$ ]] || { yellow "aborted"; rm -f "$TARBALL"; exit 1; }

step "npm publish"
npm publish "$TARBALL"

step "Push server.json to Anthropic MCP registry"
mcp-publisher publish

step "Rebuild .mcpb bundle (Claude Desktop extension)"
bash scripts/bundle.sh

step "Tag + push"
git tag -a "v$PKG_VER" -m "Release v$PKG_VER"
git push --tags

# ──────────────────────────────────────────────────────────────────
# 5. Cleanup + next steps
# ──────────────────────────────────────────────────────────────────

rm -f "$TARBALL"

green ""
green "✓ released @diagrammo/dgmo-mcp@$PKG_VER"
green ""
echo "Next:"
echo "  1. Verify install: npx -y @diagrammo/dgmo-mcp@$PKG_VER (from a temp dir)"
echo "  2. Smoke-test the funnel — Claude Desktop → make a sequence diagram → click share link"
echo "  3. If Glama listing exists, the score badge auto-refreshes"
