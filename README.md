# @diagrammo/dgmo-mcp

MCP server for rendering DGMO diagrams. Works with Claude Desktop, Claude Code, and any MCP-compatible AI tool.

## Tools

| Tool | Description |
|------|-------------|
| `render_diagram` | Render DGMO markup to SVG or PNG |
| `share_diagram` | Generate a shareable diagrammo.app URL |
| `open_in_app` | Open diagram in Diagrammo desktop app (falls back to browser if app not installed) |
| `list_chart_types` | List all supported chart types |
| `get_language_reference` | Get DGMO syntax documentation |
| `preview_diagram` | Render one or more diagrams and open an HTML preview in the browser |
| `generate_report` | Generate a polished HTML report with multiple diagrams, ToC, and optional source |

### preview_diagram

Renders one or more DGMO diagrams to SVG and opens a self-contained HTML page in the default browser. The page includes a light/dark theme toggle and responsive SVG layout.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `diagrams` | `[{ title?, dgmo }]` | *(required)* | One or more diagrams to preview |
| `theme` | `'light' \| 'dark'` | `'light'` | Color theme for rendered SVGs |
| `palette` | `string` | `'nord'` | Color palette |
| `include_source` | `boolean` | `false` | Show DGMO source in collapsible blocks |

A single diagram renders as a simple preview page. Multiple diagrams produce a report-style layout with a table of contents (when >3 sections). If some diagrams fail to render, successful ones are shown with error placeholders for the failures.

### generate_report

Generates a polished multi-section HTML report and optionally opens it in the browser. Includes a title, optional subtitle, auto-generated table of contents, per-section descriptions, and a timestamp footer. Suitable for bundling project analysis into a shareable document.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `title` | `string` | *(required)* | Report title |
| `subtitle` | `string` | — | Optional subtitle |
| `sections` | `[{ title, description?, dgmo }]` | *(required)* | Report sections, each with a diagram |
| `theme` | `'light' \| 'dark'` | `'light'` | Color theme for rendered SVGs |
| `palette` | `string` | `'nord'` | Color palette |
| `include_source` | `boolean` | `false` | Show DGMO source in collapsible blocks |
| `open` | `boolean` | `true` | Open the report in the browser |

## Setup

### Claude Code

Add to your project's `.claude/settings.local.json`:

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

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop after saving. The tools appear automatically.

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
```
