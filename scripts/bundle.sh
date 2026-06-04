#!/usr/bin/env bash
# Build a clean MCPB bundle for submission/distribution.
#
# The dev workspace uses `link:../dgmo` which pulls the entire dgmo source +
# devDeps when packed directly (~422MB). This script assembles a minimal
# bundle dir with only runtime essentials and the published @diagrammo/dgmo
# from npm, then runs `mcpb pack` against that.
#
# Output: dgmo-mcp.mcpb in the repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="$ROOT/bundle"
# Default to the @diagrammo/dgmo range already declared in package.json so the
# bundled version can't drift behind the dependency. Override with DGMO_VERSION.
DGMO_VERSION="${DGMO_VERSION:-}"

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

echo "→ Writing bundle/package.json (prod deps, npm-resolved dgmo)"
DGMO_VERSION="$DGMO_VERSION" node -e "
  const pkg = require('$ROOT/package.json');
  const dgmoVersion = process.env.DGMO_VERSION || pkg.dependencies['@diagrammo/dgmo'];
  const out = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: pkg.main,
    bin: pkg.bin,
    license: pkg.license,
    dependencies: { ...pkg.dependencies, '@diagrammo/dgmo': dgmoVersion },
  };
  require('fs').writeFileSync('$BUNDLE_DIR/package.json', JSON.stringify(out, null, 2));
"

echo "→ Installing prod deps with npm (no workspace resolution)"
(cd "$BUNDLE_DIR" && npm install --omit=dev --no-audit --no-fund --silent)

echo "→ Packing .mcpb"
(cd "$ROOT" && npx mcpb pack bundle/ dgmo-mcp.mcpb)

echo ""
echo "✓ Bundle ready: $ROOT/dgmo-mcp.mcpb"
ls -lh "$ROOT/dgmo-mcp.mcpb"
