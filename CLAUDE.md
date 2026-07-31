# dgmo-mcp — @diagrammo/dgmo-mcp

The MCP server that gives Claude Code, Claude Desktop, Cursor and any MCP client the ability to author, validate and render DGMO over stdio. Published to npm as `@diagrammo/dgmo-mcp`, listed on the MCP registry as `io.github.diagrammo/dgmo-mcp`, and shipped as a `.mcpb` bundle on the GitHub release.

## Commands

```bash
pnpm build            # tsup — 4 ESM entries + .d.ts
pnpm test             # vitest run
pnpm check:all        # deadcode + duplication + deps + test — what CI runs, and the gate before a release
pnpm check:triggers   # drift guard: triggers.json vs dgmo-content/registry.json — NOT in check:all, NOT in CI
./preflight.sh        # version sync, pack, fresh-install MCP probe. Runs on tag push (.githooks/pre-push). Runs NO tests
pnpm studio           # guidance studio (the README's `pnpm hub` / `pnpm harness` scripts do not exist)
```

## Depending on dgmo

It consumes the **published** `@diagrammo/dgmo` from npm, never the workspace checkout — there is no symlink here, unlike the app. Workspace dgmo edits are invisible until dgmo is published and the dep bumped, or until `pnpm link ../dgmo` (see CONTRIBUTING.md; `pnpm install` undoes it). At runtime `resolveLanguageReference()` / `resolveGalleryPath()` read `docs/language-reference.md` and `gallery/fixtures/` **out of the installed package**, falling back to `../dgmo/` only in this workspace.

🔴 **The tests pair two generations on purpose**: `chartTypes` comes from the installed package, `language-reference.md` from the workspace source. A chart type added, renamed or consolidated in dgmo source turns `pnpm test` red here — that is real published-vs-source skew, not a stale expectation. Fix it by releasing dgmo and bumping the dep, never by editing dgmo source back. Suite green at 162 tests, verified 2026-07-31.

## Tool surface

`src/index.ts` holds one `server.tool(...)` per tool — `grep -n '^server.tool(' src/index.ts` is the live list; `manifest.json`'s `tools` array is hand-maintained and already lags it, so update it when you add one.

- Chart-type **selection** (`src/suggest/`, `triggers.json`) lives here, not in dgmo — it is AI-authoring-only and no renderer needs it
- Every output tool funnels through `renderPipeline()` in `render-helpers.ts`, a **hard color gate**: hex and CSS color names are refused via `INVALID_COLOR_CODE` even where the library merely warns, so an authoring model is forced to correct rather than silently take a fallback color
- Per-type reference slicing (`reference.ts`) keys on the `<!-- TYPE:id -->` / `<!-- TYPE-ALIASES: -->` anchors dgmo's generator writes; the universal color, title and categorize rules are prepended to every slice because the slice omits the shared core
- `DGMO_MCP_TEST` (set by `vitest.config.ts`) skips the stdio bootstrap so tests drive the server over an in-memory transport

## Releasing

The version lives in **four slots** — `package.json`, `manifest.json`, `server.json` top-level *and* `server.json` `packages[0].version`. Preflight and the workflow both hard-fail on a mismatch. A release publishes to npm, publishes to the MCP registry, and attaches `dgmo-mcp.mcpb` (built by `scripts/bundle.sh`, which re-resolves dgmo from npm so the bundle never carries the linked source) to the GitHub release.

- `release.yml`'s tag trigger was disabled 2026-07-22 to cut Actions minutes — it is `workflow_dispatch` only, so pushing a tag ships nothing. Use the workspace local-publish path. (The reason recorded at the time, "the org npm token is broken", was a **wrong diagnosis** — retracted 2026-07-31 after reading the failing run's own log, which says `You cannot publish over the previously published versions`. The token authenticates; its real risk is the 90-day expiry, ~2026-08-15)
- In that local flow the publish precedes the tag, so preflight's "already on npm" guard fires; `ALLOW_PUBLISHED=1` downgrades that one check while keeping the rest
- Registry login is **interactive** — the gitignored `.mcpregistry_*` files are its output, and the registry JWT it mints lasts about five minutes (measured from a stored token's `iat`/`exp`, 2026-07-31). It can never be a stored secret; log in immediately before publishing. CI's `login github-oidc` path is the only credential-free one
- 🔴 **Never hardcode a chart-type count.** Four surfaces state one — `package.json`, `server.json`, `manifest.json` and the README — and they disagreed until 2026-07-31, when "35+" in three of them was aligned to **"40+"** against a registry holding 50 descriptors. Keep the open form: these are npm and registry listings where no command can run, so an exact count is stale on the next release. `mcp__dgmo__list_chart_types` is the live source. If you change one of the four, change all four
