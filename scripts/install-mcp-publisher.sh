#!/usr/bin/env bash
# Install the mcp-publisher binary that release.yml runs, pinned to one version
# and refused unless its sha256 matches (diagrammo/diagrammo#1501).
#
# It used to be curled from `releases/latest` and run unchecked, inside a job
# holding `id-token: write` — so whatever upstream tagged as latest that day ran
# with the power to mint this repo's OIDC tokens for npm and the MCP registry.
#
# To move the pin: take the version from
#   gh release list -R modelcontextprotocol/registry
# — one at least a day old, the hold pnpm-workspace.yaml applies to npm — and
# its checksum from that release's `registry_<version>_checksums.txt`, line
# `mcp-publisher_linux_amd64.tar.gz`. Check it against the tarball itself:
#   gh release download <tag> -R modelcontextprotocol/registry \
#     -p mcp-publisher_linux_amd64.tar.gz && sha256sum mcp-publisher_linux_amd64.tar.gz
#
# Usage: bash scripts/install-mcp-publisher.sh [dest-dir]   (default: .)
# Leaves an executable `mcp-publisher` in dest-dir, where publish-registry.sh
# looks for it.

set -euo pipefail

MCP_PUBLISHER_VERSION="v1.8.1"
MCP_PUBLISHER_SHA256="a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc"

DEST="${1:-.}"
URL="https://github.com/modelcontextprotocol/registry/releases/download/${MCP_PUBLISHER_VERSION}/mcp-publisher_linux_amd64.tar.gz"
TARBALL="$DEST/mcp-publisher.tar.gz"

curl -fsSL -o "$TARBALL" "$URL"

if ! echo "$MCP_PUBLISHER_SHA256  $TARBALL" | sha256sum -c --status -; then
  echo "::error::mcp-publisher $MCP_PUBLISHER_VERSION checksum mismatch — expected $MCP_PUBLISHER_SHA256, got $(sha256sum "$TARBALL" | cut -d' ' -f1). Not installed." >&2
  rm -f "$TARBALL"
  exit 1
fi

tar -xzf "$TARBALL" -C "$DEST" mcp-publisher
rm -f "$TARBALL"
chmod +x "$DEST/mcp-publisher"
"$DEST/mcp-publisher" --version || true
