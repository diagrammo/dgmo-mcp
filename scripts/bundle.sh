#!/usr/bin/env bash
# Build a clean MCPB bundle for submission/distribution.
#
# The dev workspace uses `link:../dgmo` which pulls the entire dgmo source +
# devDeps when packed directly (~422MB). This script assembles a minimal
# bundle dir with only runtime essentials, then runs `mcpb pack` against that.
#
# 🔴 @diagrammo/dgmo is deliberately NOT a dependency of the bundle. Since
# 2026-08-07 it is a devDependency that tsup INLINES into dist/, so declaring it
# here would make npm fetch a second, never-loaded copy of the library — the
# 17 MB this package moved to the bundler to avoid. The script used to read the
# range out of `.dependencies` and inject it; after the move that lookup returned
# JSON null and the bundle asked npm to install a version literally named
# "null", which failed the release run for 0.20.0.
#
# Output: dgmo-mcp.mcpb in the repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="$ROOT/bundle"

echo "→ Cleaning bundle/"
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

echo "→ Building dist/"
(cd "$ROOT" && pnpm build > /dev/null)

echo "→ Copying runtime files"
cp -r "$ROOT/dist" "$BUNDLE_DIR/dist"
cp -r "$ROOT/icons" "$BUNDLE_DIR/icons"
cp "$ROOT/manifest.json" "$BUNDLE_DIR/"
cp "$ROOT/README.md" "$BUNDLE_DIR/"
[ -f "$ROOT/LICENSE" ] && cp "$ROOT/LICENSE" "$BUNDLE_DIR/"

echo "→ Writing bundle/package.json (prod deps; dgmo is compiled in, not declared)"
# ESM-safe: assembled with jq (no `node -e`/`require`). `type` is carried over
# so the bundled ESM `dist/index.js` is loaded as a module, not CommonJS.
jq '{
  name,
  version,
  description,
  type,
  main,
  bin,
  author,
  license,
  dependencies
}' "$ROOT/package.json" > "$BUNDLE_DIR/package.json"

# Guard the mistake this file just made in the other direction: a bundle that
# names the library is one that will unpack it at install time.
if jq -e '.dependencies["@diagrammo/dgmo"]' "$BUNDLE_DIR/package.json" > /dev/null; then
  echo "✗ bundle/package.json declares @diagrammo/dgmo — it is inlined, not a dep." >&2
  exit 1
fi

echo "→ Installing prod deps with npm (no workspace resolution)"
(cd "$BUNDLE_DIR" && npm install --omit=dev --no-audit --no-fund --silent)

echo "→ Packing .mcpb"
(cd "$ROOT" && npx mcpb pack bundle/ dgmo-mcp.mcpb)

echo ""
echo "✓ Bundle ready: $ROOT/dgmo-mcp.mcpb"
ls -lh "$ROOT/dgmo-mcp.mcpb"
