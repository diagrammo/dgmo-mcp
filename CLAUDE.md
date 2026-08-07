# dgmo-mcp — @diagrammo/dgmo-mcp

The MCP server that gives Claude Code, Claude Desktop, Cursor and any MCP client the ability to author, validate and render DGMO — over stdio, or over streamable HTTP since 0.19.0. Published to npm as `@diagrammo/dgmo-mcp`, listed on the MCP registry as `io.github.diagrammo/dgmo-mcp`, and shipped as a `.mcpb` bundle on the GitHub release.

## Commands

```bash
pnpm build            # tsup — 4 ESM entries + .d.ts
pnpm test             # vitest run
pnpm check:all        # deadcode + duplication + deps + test — what CI runs, and the gate before a release
pnpm check:triggers   # drift guard: triggers.json vs dgmo-content/registry.json — NOT in check:all, NOT in CI
./preflight.sh        # version sync, pack, fresh-install MCP probe. Runs on tag push (.githooks/pre-push). Runs NO tests
pnpm studio           # guidance studio (the README's `pnpm hub` / `pnpm harness` scripts do not exist)
```

✅ **The repo is prettier-clean, and `check:all` now enforces it** — `format:check` runs first in the gate as of 2026-08-06, so `pnpm format` is safe to run bare and drift cannot accumulate again. It had: 47 files under `tools/`, `tests/` and `src/` were failing, and because nothing checked, one `pnpm format` during unrelated work turned an 8-file change into a 55-file one. If `check:all` fails on formatting, run `pnpm format` and commit that **alone** — never as a rider on a feature.

## Depending on dgmo

It consumes the **published** `@diagrammo/dgmo` from npm, never the workspace checkout — there is no symlink here, unlike the app. Workspace dgmo edits are invisible until dgmo is published and the dep bumped, or until `pnpm link ../dgmo` (see CONTRIBUTING.md; `pnpm install` undoes it).

🔴 **Since 2026-08-07 the library is a devDependency and is INLINED into the bundle** (`noExternal` in `tsup.config.ts`), exactly as `@diagrammo/dgmo-cli` does it. Declaring it at runtime meant every install of this server — and every `npm i -g @diagrammo/dgmo-cli`, which spawns it — unpacked the library plus its d3, dagre and lz-string trees: **17,028 KB**, on top of a CLI bundle that already inlines the same library and never loads that copy. A CLI install measured 73,956 KB before and 63,344 KB after.

Two things follow, and both are load-bearing:

- **There is no version tracking any more.** A library fix reaches MCP users only when this package is republished. That cuts both ways: five of the imports here come from `@diagrammo/dgmo/advanced`, which carries no semver guarantee, so tracking meant a library patch could break an already-installed server. The bump discipline below still applies — it is now about what gets *baked in*, not what a consumer resolves.
- **The runtime data files travel with us.** `scripts/stage-assets.mjs` copies the basemaps, the two Inter TTFs, `language-reference.md` and `gallery/fixtures` into `dist/` at build time, and `src/asset-roots.ts` is where `resolveLanguageReference()` / `resolveGalleryPath()` / the font lookup now look — our own `dist/` first, a sibling `../dgmo/` checkout second. 🔴 `map-data` **must** land at `dist/map-data`, because the inlined `load-data.ts` searches directories relative to its own module.

🔴 **`pnpm build` is not enough to know this package works — `node scripts/prepack-mcp.mjs` is.** It renders one gallery fixture per chart type through the built `dist/render-helpers.js`, rasterises one to PNG, and asserts the library is not imported at runtime. It exists because the identical change to the CLI shipped a version that rendered 20 of 20 non-map fixtures and **0 of 18 maps** while the binary ran and `--version` answered (issue #121). It is wired as `prepack`, so `npm publish` cannot get past it.

🔴 **The tests pair two generations on purpose**: `chartTypes` comes from the installed package, `language-reference.md` from the workspace source. A chart type added, renamed or consolidated in dgmo source turns `pnpm test` red here — that is real published-vs-source skew, not a stale expectation. Fix it by releasing dgmo and bumping the dep, never by editing dgmo source back. Suite green at 162 tests, verified 2026-07-31.

🔴 **Every dgmo MINOR needs an explicit bump here — the caret does not do it.** On a `0.x` version `^0.56.0` excludes `0.57.0`, and the committed lockfile pins whatever already satisfied the range, so `pnpm install` keeps reporting success while the dep sits a minor behind. That is exactly what happened: dgmo shipped 0.57.0 and this package stayed resolved at 0.56.0 until it was caught on 2026-07-31. After any bump, check what actually **resolved** (`grep -A2 "'@diagrammo/dgmo'" pnpm-lock.yaml`), not what was declared. The same trap bit all five doc-framework wrappers.

## Tool surface

`src/index.ts` holds one `tool(...)` per tool — `grep -n '^tool(' src/index.ts` is the live list; `manifest.json`'s `tools` array is hand-maintained and already lags it, so update it when you add one.

⚠️ **Those calls RECORD a definition, they do not register it.** `tool()` pushes onto `RECORDED_TOOLS` and `createServer()` replays the list onto a fresh `McpServer`. It reads like an indirection for its own sake and is not: HTTP mode builds **one server per request**, because the SDK throws `Stateless transport cannot be reused across requests` otherwise, and a definition that ran once at import can only ever attach to one server. `export const server` at the bottom is the stdio one, and what the tests drive.

- Chart-type **selection** (`src/suggest/`, `triggers.json`) lives here, not in dgmo — it is AI-authoring-only and no renderer needs it
- Every output tool funnels through `renderPipeline()` in `render-helpers.ts`, a **hard color gate**: hex and CSS color names are refused via `INVALID_COLOR_CODE` even where the library merely warns, so an authoring model is forced to correct rather than silently take a fallback color
- Per-type reference slicing (`reference.ts`) keys on the `<!-- TYPE:id -->` / `<!-- TYPE-ALIASES: -->` anchors dgmo's generator writes; the universal color, title and categorize rules are prepended to every slice because the slice omits the shared core
- `DGMO_MCP_TEST` (set by `vitest.config.ts`) skips the stdio bootstrap so tests drive the server over an in-memory transport

## Transports — stdio, and streamable HTTP since 0.19.0

Added 2026-08-06 for `diagrammo/dgmo-mcp#7`, the only feature request this ecosystem has had from outside it. `--http` (or `MCP_TRANSPORT=http`) serves MCP over streamable HTTP; everything else still defaults to stdio, so no existing client changes.

- 🔴 **Four tools are NOT offered over HTTP** — `open_in_app`, `check_app_installed`, `preview_diagram`, `generate_report`. They launch the desktop app or open a browser, which over a network happens on the **server**, in front of nobody. They are `disable()`d rather than dropped, so calling one returns `Tool <name> disabled` instead of `not found` — a caller learns which tool it cannot have here. The list is `MACHINE_LOCAL_TOOLS` in `src/index.ts`; **a new tool that touches the filesystem, the browser or the desktop app belongs in it.**
- `render_diagram` keeps returning the PNG over HTTP but stops writing the temp file and stops reporting a path, because the path would name the server's disk.
- **Stateless, one server + one transport per request**, torn down with the response. Not a performance choice — see the note under Tool surface above.
- ⚠️ **The Host accept-list is rebuilt after `listen`**, since a Host header carries the port and the bound port is not known until then. Building it from the requested port makes every request fail as a rebinding attempt whenever the two differ (port 0 is the obvious case, and how the tests bind).
- **No authentication, deliberately.** Binds `127.0.0.1`, DNS-rebinding protection on, loopback Host headers always accepted, `--allow-host` for anything else. Binding non-loopback without naming a host warns on stderr. Anyone exposing it to a network puts their own auth in front of it — don't add auth here without deciding that question properly.
- Body cap is `MAX_BODY_BYTES` in `src/http-transport.ts`, refused on the declared `Content-Length` before a byte is read.

## Releasing

The version lives in **four slots** — `package.json`, `manifest.json`, `server.json` top-level _and_ `server.json` `packages[0].version`. Preflight and the workflow both hard-fail on a mismatch. A release publishes to npm, publishes to the MCP registry, and attaches `dgmo-mcp.mcpb` (built by `scripts/bundle.sh`) to the GitHub release.

🔴 **The bundle must NOT declare `@diagrammo/dgmo`** — it is inlined into `dist/`, so naming it makes npm unpack a second, never-loaded copy: precisely the 17 MB the inline move existed to remove. `bundle.sh` used to read the range out of `.dependencies` and inject it; when the library became a devDependency that lookup returned JSON null and the bundle asked npm for a version literally named `"null"`, which is how the 0.20.0 release run died at the *Build .mcpb bundle* step with npm publish already done. The script now carries `dependencies` through untouched and hard-fails if the library reappears in them. Fixed 2026-08-07.

- `release.yml`'s tag trigger was disabled 2026-07-22 to cut Actions minutes — it is `workflow_dispatch` only, so pushing a tag ships nothing. Use the workspace local-publish path. (The reason recorded at the time, "the org npm token is broken", was a **wrong diagnosis** — retracted 2026-07-31 after reading the failing run's own log, which says `You cannot publish over the previously published versions`. The token authenticates; its real risk is the 90-day expiry, ~2026-08-15)
- In that local flow the publish precedes the tag, so preflight's "already on npm" guard fires; `ALLOW_PUBLISHED=1` downgrades that one check while keeping the rest
- Registry login is **interactive** — the gitignored `.mcpregistry_*` files are its output, and the registry JWT it mints lasts about five minutes (measured from a stored token's `iat`/`exp`, 2026-07-31). It can never be a stored secret; log in immediately before publishing. CI's `login github-oidc` path is the only credential-free one
- 🔴 **Never hardcode a chart-type count.** Four surfaces state one — `package.json`, `server.json`, `manifest.json` and the README — and they disagreed until 2026-07-31, when "35+" in three of them was aligned to **"40+"** against a registry holding 50 descriptors. Keep the open form: these are npm and registry listings where no command can run, so an exact count is stale on the next release. `mcp__dgmo__list_chart_types` is the live source. If you change one of the four, change all four
