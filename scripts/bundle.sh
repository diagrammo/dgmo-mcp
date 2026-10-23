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

echo "→ Writing bundle/package.json (dgmo is compiled in, not a runtime dep)"
# ESM-safe: assembled with jq (no `node -e`/`require`). `type` is carried over
# so the bundled ESM `dist/index.js` is loaded as a module, not CommonJS.
# `devDependencies` rides along only so the frozen install below matches the
# lockfile's specifiers; `--prod` installs none of them.
jq '{
  name,
  version,
  description,
  type,
  main,
  bin,
  author,
  license,
  dependencies,
  devDependencies
}' "$ROOT/package.json" > "$BUNDLE_DIR/package.json"

# Guard the mistake this file just made in the other direction: a bundle that
# names the library is one that will unpack it at install time.
if jq -e '.dependencies["@diagrammo/dgmo"]' "$BUNDLE_DIR/package.json" > /dev/null; then
  echo "✗ bundle/package.json declares @diagrammo/dgmo — it is inlined, not a dep." >&2
  exit 1
fi

# 🔴 Installed FROZEN from the repo's own pnpm-lock.yaml, which ships in the
# bundle (diagrammo/diagrammo#1501). This used to be a bare `npm install`: no
# lockfile, so every release resolved its runtime tree afresh that day, outside
# the minimumReleaseAge hold, and shipped versions no test had run against —
# measured 2026-10-23, 38 of 135 packages differed from the lockfile, among
# them @modelcontextprotocol/sdk 1.32.1 for a tested 1.29.0.
# pnpm-workspace.yaml is copied too: it makes bundle/ its own workspace root,
# so pnpm does not walk up and install the repo instead. `hoisted` gives a flat
# npm-style node_modules with no symlinks for `mcpb pack` to trip on.
echo "→ Installing prod deps from pnpm-lock.yaml (frozen)"
cp "$ROOT/pnpm-lock.yaml" "$ROOT/pnpm-workspace.yaml" "$BUNDLE_DIR/"
(cd "$BUNDLE_DIR" && pnpm install --prod --frozen-lockfile \
  --config.node-linker=hoisted --silent)

echo "→ Packing .mcpb"
(cd "$ROOT" && npx mcpb pack bundle/ dgmo-mcp.mcpb)

echo ""
echo "✓ Bundle ready: $ROOT/dgmo-mcp.mcpb"
ls -lh "$ROOT/dgmo-mcp.mcpb"
