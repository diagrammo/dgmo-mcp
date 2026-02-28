#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  render,
  parseDgmo,
  formatDgmoError,
  encodeDiagramUrl,
  DGMO_CHART_TYPE_MAP,
  getPalette,
} from '@diagrammo/dgmo';
import { Resvg } from '@resvg/resvg-js';

// ---------------------------------------------------------------------------
// Chart type descriptions (same as CLI)
// ---------------------------------------------------------------------------

const CHART_TYPE_DESCRIPTIONS: Record<string, string> = {
  bar: 'Bar chart — categorical comparisons',
  line: 'Line chart — trends over time',
  'multi-line': 'Multi-line chart — multiple series trends',
  area: 'Area chart — filled line chart',
  pie: 'Pie chart — part-to-whole proportions',
  doughnut: 'Doughnut chart — ring-style pie chart',
  radar: 'Radar chart — multi-dimensional metrics',
  'polar-area': 'Polar area chart — radial bar chart',
  'bar-stacked': 'Stacked bar chart — multi-series categorical',
  scatter: 'Scatter plot — 2D data points or bubble chart',
  sankey: 'Sankey diagram — flow/allocation visualization',
  chord: 'Chord diagram — circular flow relationships',
  function: 'Function plot — mathematical expressions',
  heatmap: 'Heatmap — matrix intensity visualization',
  funnel: 'Funnel chart — conversion pipeline',
  slope: 'Slope chart — change between two periods',
  wordcloud: 'Word cloud — term frequency visualization',
  arc: 'Arc diagram — network relationships',
  timeline: 'Timeline — events, eras, and date ranges',
  venn: 'Venn diagram — set overlaps',
  quadrant: 'Quadrant chart — 2x2 positioning matrix',
  sequence: 'Sequence diagram — message/interaction flows',
  flowchart: 'Flowchart — decision trees and process flows',
  class: 'Class diagram — UML class hierarchies',
  er: 'ER diagram — database schemas and relationships',
  org: 'Org chart — hierarchical tree structures',
  kanban: 'Kanban board — task/workflow columns',
  c4: 'C4 diagram — system architecture (context, container, component, deployment)',
  'initiative-status': 'Initiative status — project roadmap with dependency tracking',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_FONT_NAME = 'Helvetica';

function svgToPngBase64(svg: string, background?: string): string {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom' as const, value: 2 },
    ...(background ? { background } : {}),
    font: {
      loadSystemFonts: true,
      defaultFontFamily: DEFAULT_FONT_NAME,
      sansSerifFamily: DEFAULT_FONT_NAME,
    },
  });
  const rendered = resvg.render();
  return Buffer.from(rendered.asPng()).toString('base64');
}

function resolveLanguageReference(): string {
  // Try 1: resolve from @diagrammo/dgmo package (works when docs/ is published)
  try {
    const dgmoMain = require.resolve('@diagrammo/dgmo');
    const pkgRoot = dirname(dirname(dgmoMain));
    const docsPath = join(pkgRoot, 'docs', 'language-reference.md');
    return readFileSync(docsPath, 'utf-8');
  } catch {
    // Try 2: resolve from sibling dgmo/ directory (local dev workspace)
    // __dirname is dist/, go up to dgmo-mcp/ then up to workspace root
    const workspacePath = join(__dirname, '..', '..', 'dgmo', 'docs', 'language-reference.md');
    return readFileSync(workspacePath, 'utf-8');
  }
}

function extractSection(markdown: string, chartType: string): string | null {
  // Chart types use ### headings in the language reference
  const escaped = chartType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^###? ${escaped}\\b.*$`, 'im');
  const match = pattern.exec(markdown);
  if (!match) return null;

  const level = match[0].startsWith('### ') ? '### ' : '## ';
  const start = match.index;
  const rest = markdown.slice(start + match[0].length);
  const nextHeading = rest.search(new RegExp(`^${level.replace(/ $/, '')}[# ]`, 'm'));
  const end = nextHeading === -1 ? markdown.length : start + match[0].length + nextHeading;
  return markdown.slice(start, end).trim();
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'dgmo',
  version: '0.1.0',
});

// --- Tool 1: render_diagram ---

server.tool(
  'render_diagram',
  'Render DGMO markup to SVG or PNG. Returns SVG text or base64 PNG image.',
  {
    dgmo: z.string().describe('DGMO diagram markup'),
    format: z.enum(['svg', 'png']).default('svg').describe('Output format'),
    theme: z.enum(['light', 'dark', 'transparent']).default('light').describe('Color theme'),
    palette: z.string().default('nord').describe('Color palette (nord, solarized, catppuccin, rose-pine, gruvbox, tokyo-night, one-dark, bold)'),
  },
  async ({ dgmo, format, theme, palette }) => {
    // Validate first
    const { diagnostics } = parseDgmo(dgmo);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Diagram has errors:\n' + errors.map(formatDgmoError).join('\n'),
          },
        ],
        isError: true,
      };
    }

    const svg = await render(dgmo, { theme, palette, branding: false });
    if (!svg) {
      return {
        content: [{ type: 'text' as const, text: 'Render returned empty SVG.' }],
        isError: true,
      };
    }

    if (format === 'png') {
      const paletteColors = getPalette(palette);
      const bg = theme === 'transparent' ? undefined : paletteColors[theme === 'dark' ? 'dark' : 'light'].bg;
      const base64 = svgToPngBase64(svg, bg);
      return {
        content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' as const }],
      };
    }

    return {
      content: [{ type: 'text' as const, text: svg }],
    };
  },
);

// --- Tool 2: share_diagram ---

server.tool(
  'share_diagram',
  'Generate a shareable diagrammo.app URL for a DGMO diagram.',
  {
    dgmo: z.string().describe('DGMO diagram markup'),
  },
  async ({ dgmo }) => {
    const result = encodeDiagramUrl(dgmo);
    if (result.error === 'too-large') {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Diagram is too large to share via URL. Compressed size: ${result.compressedSize} bytes (limit: ${result.limit} bytes). Try simplifying the diagram.`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text' as const, text: result.url }],
    };
  },
);

// --- Tool 3: open_in_app ---

server.tool(
  'open_in_app',
  'Open a DGMO diagram in the Diagrammo desktop app (macOS only).',
  {
    dgmo: z.string().describe('DGMO diagram markup'),
  },
  async ({ dgmo }) => {
    const result = encodeDiagramUrl(dgmo);
    if (result.error === 'too-large') {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Diagram is too large for URL encoding. Compressed size: ${result.compressedSize} bytes (limit: ${result.limit} bytes).`,
          },
        ],
        isError: true,
      };
    }

    // Extract the hash from the URL and construct a deep link
    const url = result.url;
    const hash = url.split('#')[1] ?? '';
    const deepLink = `diagrammo://open?dgmo=${hash}`;

    return new Promise((resolve) => {
      exec(`open ${JSON.stringify(deepLink)}`, (error) => {
        if (error) {
          resolve({
            content: [
              {
                type: 'text' as const,
                text: `Failed to open Diagrammo app: ${error.message}. Is the app installed?`,
              },
            ],
            isError: true,
          });
        } else {
          resolve({
            content: [
              {
                type: 'text' as const,
                text: 'Opened diagram in Diagrammo app.',
              },
            ],
          });
        }
      });
    });
  },
);

// --- Tool 4: list_chart_types ---

server.tool(
  'list_chart_types',
  'List all supported DGMO chart types with descriptions.',
  {},
  async () => {
    const types = Object.keys(DGMO_CHART_TYPE_MAP);
    const lines = types.map((id) => {
      const desc = CHART_TYPE_DESCRIPTIONS[id];
      return desc ? `- ${id}: ${desc}` : `- ${id}`;
    });
    return {
      content: [
        {
          type: 'text' as const,
          text: `Supported chart types (${types.length}):\n\n${lines.join('\n')}`,
        },
      ],
    };
  },
);

// --- Tool 5: get_language_reference ---

server.tool(
  'get_language_reference',
  'Get the DGMO language reference documentation. Optionally filter by chart type.',
  {
    chart_type: z.string().optional().describe('Optional chart type to get reference for (e.g. "sequence", "flowchart", "bar")'),
  },
  async ({ chart_type }) => {
    let content: string;
    try {
      content = resolveLanguageReference();
    } catch {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Could not find language-reference.md. Is @diagrammo/dgmo installed?',
          },
        ],
        isError: true,
      };
    }

    if (chart_type) {
      const section = extractSection(content, chart_type);
      if (!section) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No section found for chart type "${chart_type}". Use list_chart_types to see available types.`,
            },
          ],
          isError: true,
        };
      }
      return { content: [{ type: 'text' as const, text: section }] };
    }

    return { content: [{ type: 'text' as const, text: content }] };
  },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start dgmo MCP server:', err);
  process.exit(1);
});
