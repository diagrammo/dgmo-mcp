#!/usr/bin/env bash
# publish-registry.sh <version> — publish server.json to the MCP registry once
# npm actually serves @diagrammo/dgmo-mcp@<version>. Run by release.yml.
#
# The registry validates the server against npm, so publishing before npm
# serves the version is refused with "version '<v>' was not found (status:
# 404)". npm can take ~10 minutes to serve a version after `npm publish`
# reports success (0.59.0, 2026-09-30), and the old 60-second wait that
# "proceeded anyway" failed the 0.29.7 release (run 37800247169) and needed a
# manual re-dispatch (diagrammo/diagrammo#1164). So:
#
#   1. poll `npm view` until it answers — bounded, and FAIL if it never does;
#   2. log in and publish, retrying only the registry's not-found 404, because
#      its npm read can lag the one `npm view` sees.
#
# Login sits inside the retry loop: the github-oidc token lasts about five
# minutes, so a login made before a long wait would expire under it.
#
# Knobs (environment), defaults sized for npm's ~10-minute lag:
#   NPM_POLL_ATTEMPTS (60) × NPM_POLL_SECONDS (20)   — up to 20 minutes
#   PUBLISH_ATTEMPTS  (5)  × PUBLISH_RETRY_SECONDS (60)
#   MCP_PUBLISHER (./mcp-publisher)

set -u

VERSION=${1:?usage: publish-registry.sh <version>}
PACKAGE="@diagrammo/dgmo-mcp"
NPM_POLL_ATTEMPTS=${NPM_POLL_ATTEMPTS:-60}
NPM_POLL_SECONDS=${NPM_POLL_SECONDS:-20}
PUBLISH_ATTEMPTS=${PUBLISH_ATTEMPTS:-5}
PUBLISH_RETRY_SECONDS=${PUBLISH_RETRY_SECONDS:-60}
MCP_PUBLISHER=${MCP_PUBLISHER:-./mcp-publisher}

i=1
until npm view "$PACKAGE@$VERSION" version >/dev/null 2>&1; do
  if [ "$i" -ge "$NPM_POLL_ATTEMPTS" ]; then
    echo "::error::npm did not serve $PACKAGE@$VERSION after $NPM_POLL_ATTEMPTS checks, ${NPM_POLL_SECONDS}s apart — not publishing to the MCP registry. Re-dispatch once \`npm view $PACKAGE@$VERSION version\` answers."
    exit 1
  fi
  echo "Waiting for npm to serve $VERSION... ($i/$NPM_POLL_ATTEMPTS)"
  i=$((i + 1))
  sleep "$NPM_POLL_SECONDS"
done
echo "✓ npm serves $PACKAGE@$VERSION"

attempt=1
while :; do
  "$MCP_PUBLISHER" login github-oidc || exit 1
  out=$("$MCP_PUBLISHER" publish 2>&1)
  rc=$?
  printf '%s\n' "$out"
  [ "$rc" -eq 0 ] && exit 0
  case "$out" in
    *"was not found (status: 404)"*) ;;
    *) exit "$rc" ;;
  esac
  if [ "$attempt" -ge "$PUBLISH_ATTEMPTS" ]; then
    echo "::error::the MCP registry still could not see $PACKAGE@$VERSION on npm after $PUBLISH_ATTEMPTS attempts"
    exit "$rc"
  fi
  echo "Registry cannot see $VERSION on npm yet — retrying in ${PUBLISH_RETRY_SECONDS}s ($attempt/$PUBLISH_ATTEMPTS)"
  attempt=$((attempt + 1))
  sleep "$PUBLISH_RETRY_SECONDS"
done
