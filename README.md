# @diagrammo/dgmo-mcp

**Turn a conversation into a real diagram — without leaving your AI tool.**

[![npm version](https://img.shields.io/npm/v/@diagrammo/dgmo-mcp.svg)](https://www.npmjs.com/package/@diagrammo/dgmo-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@diagrammo/dgmo-mcp.svg)](https://www.npmjs.com/package/@diagrammo/dgmo-mcp)
[![license](https://img.shields.io/npm/l/@diagrammo/dgmo-mcp.svg)](./LICENSE)

This MCP server gives Claude (and any MCP-compatible AI tool) the ability to render
**sequence diagrams, flowcharts, ER diagrams, C4 architecture, gantt charts, and 35+
other chart types** from concise text markup — then hand the result off to a full
editor for refinement. Ask for a diagram in chat; get a real one back.

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/diagrammo/dgmo-mcp/main/assets/sequence.png" alt="Sequence diagram" /></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/diagrammo/dgmo-mcp/main/assets/c4.png" alt="C4 architecture diagram" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/diagrammo/dgmo-mcp/main/assets/gantt.png" alt="Gantt chart" /></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/diagrammo/dgmo-mcp/main/assets/flowchart.png" alt="Flowchart" /></td>
  </tr>
</table>

## What you can do

Ask in plain language — *"diagram the auth flow as a sequence"*, *"chart the Q3 plan as
a gantt"*, *"draw our services as a C4 diagram"* — and Claude writes the markup and
renders it. The markup stays readable and diffable:

```
flowchart Mutiny Resolution
direction-tb

[Sail]     Set sail under the captain
{Trouble?} Discontent in the crew?
{Vote}     Crew vote called
[Mutiny]   Seize the ship

(Sail) -> (Trouble?)
(Trouble?) -Yes-> (Vote)
(Vote) -Mutiny-> (Mutiny)
```

→ renders to the flowchart above. All rendering happens **locally** — no diagram data
leaves your machine.

## Tools

| Tool | What it does |
| --- | --- |
| `render_diagram` | Render DGMO markup to **SVG or PNG** |
| `preview_diagram` | Render one or more diagrams and open an **HTML preview** in the browser |
| `generate_report` | Build a polished **multi-section HTML report** with ToC and optional source |
| `list_chart_types` | List all supported chart types |
| `get_language_reference` | Get DGMO syntax documentation for accurate generation |
| **`share_diagram`** | Get a shareable **diagrammo.app** URL — hand your diagram to the web editor |
| **`open_in_app`** | Open the diagram **straight into the Diagrammo desktop app** for editing |

The last two are the bridge out of chat: a diagram Claude generates becomes something
you can refine, restyle, and embed — see below.

## Beyond the MCP server

The MCP server is one entry point into **[Diagrammo](https://diagrammo.app)** — a whole
ecosystem built on the same DGMO markup. Generate in chat, refine in a real editor,
embed anywhere:

- **[diagrammo.app](https://diagrammo.app)** — the desktop app. `open_in_app` drops an
  AI-generated diagram straight into it, with live preview, palettes, and export.
- **[online.diagrammo.app](https://online.diagrammo.app)** — a full editor in the
  browser, zero install. `share_diagram` URLs open right here.
- **Docs integrations** — drop DGMO fenced code blocks into your docs site:
  [remark-dgmo](https://www.npmjs.com/package/remark-dgmo),
  [astro-dgmo](https://www.npmjs.com/package/astro-dgmo),
  [docusaurus-plugin-dgmo](https://www.npmjs.com/package/docusaurus-plugin-dgmo),
  [fumadocs-dgmo](https://www.npmjs.com/package/fumadocs-dgmo).
- **Obsidian** — the *Diagrammo Diagrams* community plugin renders DGMO in your vault.
- **CLI** — `npx @diagrammo/dgmo file.dgmo -o out.png`, or install via Homebrew.

> **One markup, everywhere.** A diagram you generate here renders identically in the
> app, in your docs, and in Obsidian — because they all speak DGMO.

**[→ Try it free at diagrammo.app](https://diagrammo.app)**

## Setup

### Easiest — one command

Install the [`dgmo`](https://www.npmjs.com/package/@diagrammo/dgmo) CLI and let it wire everything up:

```bash
npm install -g @diagrammo/dgmo   # or: brew install diagrammo/dgmo/dgmo
dgmo install                     # auto-detects Claude Code, Codex, Claude Desktop, Cursor, …
```

`dgmo install` configures each detected assistant non-interactively and points it at `dgmo mcp`, so there's no separate package to install or prompts to answer. Target one surface with `dgmo install claude-code` (or `codex`, `claude-desktop`, …).

### Manual configuration

Prefer to edit configs yourself? Point any MCP client at the server via `npx` (no global install needed):

**Claude Code** — `.claude/settings.local.json`; **Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dgmo": {
      "command": "npx",
      "args": ["-y", "@diagrammo/dgmo-mcp"]
    }
  }
}
```

If you have the `dgmo` CLI installed, `{ "command": "dgmo", "args": ["mcp"] }` works too. Restart the client after saving — the tools appear automatically.

## Privacy

All rendering is **local**. Your diagram markup and the images it produces never leave
your machine, except when you explicitly call `share_diagram` (which encodes the diagram
into a diagrammo.app URL). See the [privacy terms](https://diagrammo.app/terms#mcp-privacy).

## Dev hub (AI-tuning tools)

```bash
pnpm hub
```

One command, one server, one browser tab. The hub opens a tabbed shell over the
three AI-tuning dev tools — switch between them with the top tabs, no separate
ports or commands to remember:

- **Trigger tuning** — edit the phrase/concept vocabulary that drives
  `suggest_chart_type`, score prompts live, save back to `triggers.json`.
- **LLM judge** — judge chart-type descriptions against prompts with `claude -p`.
- **Guidance studio** — author the per-type **styling guidance** the server
  delivers (the `<!-- TIPS -->` blocks in dgmo's `language-reference.md`, sliced
  into `get_language_reference`): pick a type, edit how the AI is told to style
  it, run a prompt against a committed dataset fixture (so inputs never move
  between runs), and see the generated DGMO + rendered image side by side. The
  picker doubles as a coverage bar; "Compare 3×" renders no-guidance vs your
  tips for a by-eye check; Save validates and writes back to
  `language-reference.md`.

These tools are dev-only and never bundled into the published server. (The
standalone `pnpm harness` and `pnpm studio` scripts still run a single tool each
if you ever want one in isolation.)

## Contributing & releases

Development setup and the release workflow live in [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
