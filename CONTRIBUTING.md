# Contributing to @diagrammo/dgmo-mcp

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
```

To iterate against an unpublished `@diagrammo/dgmo` checked out in `../dgmo`,
override the npm-resolved dep with a workspace symlink **after** install:

```bash
pnpm install
pnpm link ../dgmo   # symlink node_modules/@diagrammo/dgmo → ../dgmo
pnpm --filter @diagrammo/dgmo build   # ensure dist/ is up to date
```

`pnpm install` will undo the link, so re-run `pnpm link ../dgmo` if deps change.

## Releasing

Releases are tag-driven via `.github/workflows/release.yml`:

1. Bump the version in **all three** files (must match exactly — the workflow
   verifies):
   - `package.json` → `version`
   - `manifest.json` → `version`
   - `server.json` → `version` _and_ `packages[0].version`
2. Commit and tag:
   ```bash
   git commit -am "Release vX.Y.Z"
   git tag vX.Y.Z
   git push && git push --tags
   ```
3. The workflow runs typecheck + build, publishes to npm with provenance,
   bundles the `.mcpb`, publishes to the MCP registry via GitHub OIDC, and
   attaches the `.mcpb` to a GitHub release.

### Required secrets

- `NPM_TOKEN` — npm granular access token scoped to `@diagrammo/*` write.
  Settings → Secrets and variables → Actions → New repository secret.

## Showcase assets

The README hero images in `assets/` are rendered from canonical examples in
`dgmo-content/examples/` with the slate palette:

```bash
node ../dgmo/dist/cli.cjs <example>.dgmo -o assets/<name>.png --palette slate --theme light
```
