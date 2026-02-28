# @diagrammo/dgmo-mcp

MCP server for rendering DGMO diagrams. Works with Claude Desktop, Claude Code, and any MCP-compatible AI tool.

## Tools

| Tool | Description |
|------|-------------|
| `render_diagram` | Render DGMO markup to SVG or PNG |
| `share_diagram` | Generate a shareable diagrammo.app URL |
| `open_in_app` | Open diagram in Diagrammo desktop app (macOS) |
| `list_chart_types` | List all 29 supported chart types |
| `get_language_reference` | Get DGMO syntax documentation |

## Setup

### Claude Code

Add to your project's `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "dgmo": {
      "command": "node",
      "args": ["/path/to/dgmo-mcp/dist/index.js"]
    }
  }
}
```

Or with npx (after publishing):

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
      "command": "node",
      "args": ["/path/to/dgmo-mcp/dist/index.js"]
    }
  }
}
```

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
```
