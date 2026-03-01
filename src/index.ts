#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  render,
  parseDgmo,
  formatDgmoError,
  encodeDiagramUrl,
  DGMO_CHART_TYPE_MAP,
  getPalette,
} from '@diagrammo/dgmo';
import { Resvg } from '@resvg/resvg-js';
import { buildPreviewHtml, buildReportHtml } from './html-report.js';
import type { ReportSection } from './html-report.js';
import { openInBrowser } from './open-browser.js';

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

/** Write HTML to a temp file and return the path. */
function writeTempHtml(html: string, prefix: string): string {
  const filePath = join(tmpdir(), `${prefix}-${randomUUID()}.html`);
  writeFileSync(filePath, html, 'utf-8');
  return filePath;
}

/** Render a single DGMO string to SVG, returning { svg, error }. */
async function tryRender(
  dgmo: string,
  theme: 'light' | 'dark',
  palette: string,
): Promise<{ svg: string | null; error: string | null }> {
  const { diagnostics } = parseDgmo(dgmo);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    return { svg: null, error: errors.map(formatDgmoError).join('\n') };
  }
  try {
    const svg = await render(dgmo, { theme, palette, branding: false });
    if (!svg) return { svg: null, error: 'Render returned empty SVG.' };
    return { svg, error: null };
  } catch (err) {
    return { svg: null, error: err instanceof Error ? err.message : String(err) };
  }
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
  'Render DGMO markup to SVG or PNG. Returns SVG text or base64 PNG image. IMPORTANT: In DGMO, parentheses after a label specify color — e.g. "Sales (red)" colors the bar red, it does NOT label it "Sales (red)". Never use parentheses in labels for annotation; use dashes, commas, or separate words instead.',
  {
    dgmo: z.string().describe('DGMO diagram markup. Parentheses in labels are color notation — e.g. "Label (blue)" sets color, not text. Avoid parentheses in data labels.'),
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
  'Open a DGMO diagram in the Diagrammo desktop app (macOS only). Falls back to browser preview if the app is not installed.',
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
      exec(`open ${JSON.stringify(deepLink)}`, async (error) => {
        if (error) {
          // Fallback: render to SVG and open in browser
          try {
            const rendered = await tryRender(dgmo, 'light', 'nord');
            if (!rendered.svg) {
              resolve({
                content: [
                  {
                    type: 'text' as const,
                    text: `App not installed and render failed: ${rendered.error}`,
                  },
                ],
                isError: true,
              });
              return;
            }
            const paletteConfig = getPalette('nord');
            const html = buildPreviewHtml({
              svg: rendered.svg,
              title: 'Diagram Preview',
              dgmoSource: dgmo,
              palette: paletteConfig,
            });
            const filePath = writeTempHtml(html, 'dgmo-preview');
            await openInBrowser(filePath);
            resolve({
              content: [
                {
                  type: 'text' as const,
                  text: `Diagrammo app not found — opened preview in browser: ${filePath}`,
                },
              ],
            });
          } catch (fallbackErr) {
            resolve({
              content: [
                {
                  type: 'text' as const,
                  text: `Failed to open Diagrammo app and browser fallback failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
                },
              ],
              isError: true,
            });
          }
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

// --- Tool 6: preview_diagram ---

server.tool(
  'preview_diagram',
  'Render one or more DGMO diagrams and open an HTML preview in the browser. Supports theme toggle and optional source display. IMPORTANT: Parentheses in DGMO labels are color notation — "Label (red)" colors it red. Never use parentheses for annotation in labels.',
  {
    diagrams: z
      .array(
        z.object({
          title: z.string().optional().describe('Optional title for this diagram'),
          dgmo: z.string().describe('DGMO diagram markup. Parentheses in labels are color notation, not text.'),
        }),
      )
      .min(1)
      .describe('One or more diagrams to preview'),
    theme: z.enum(['light', 'dark']).default('light').describe('Color theme'),
    palette: z.string().default('nord').describe('Color palette'),
    include_source: z.boolean().default(false).describe('Show DGMO source in collapsible blocks'),
  },
  async ({ diagrams, theme, palette, include_source }) => {
    const paletteConfig = getPalette(palette);
    const results = await Promise.all(
      diagrams.map(async (d) => {
        const { svg, error } = await tryRender(d.dgmo, theme, palette);
        return { title: d.title, dgmo: d.dgmo, svg, error };
      }),
    );

    const successes = results.filter((r) => r.svg);
    const failures = results.filter((r) => !r.svg);

    if (successes.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              'All diagrams failed to render:\n' +
              failures.map((f) => `- ${f.title || 'untitled'}: ${f.error}`).join('\n'),
          },
        ],
        isError: true,
      };
    }

    let html: string;
    if (diagrams.length === 1 && successes.length === 1) {
      // Single diagram → simple preview
      const r = results[0];
      html = buildPreviewHtml({
        svg: r.svg!,
        title: r.title,
        dgmoSource: include_source ? r.dgmo : undefined,
        palette: paletteConfig,
      });
    } else {
      // Multiple diagrams → report layout
      const sections: ReportSection[] = results.map((r) => ({
        title: r.title || 'Untitled',
        svg: r.svg,
        dgmoSource: r.dgmo,
        error: r.error ?? undefined,
      }));
      html = buildReportHtml({
        title: 'Diagram Preview',
        sections,
        palette: paletteConfig,
        includeSource: include_source,
      });
    }

    const filePath = writeTempHtml(html, 'dgmo-preview');
    await openInBrowser(filePath);

    let message = `Opened preview in browser: ${filePath}`;
    if (failures.length > 0) {
      message +=
        '\n\nWarning — some diagrams failed to render:\n' +
        failures.map((f) => `- ${f.title || 'untitled'}: ${f.error}`).join('\n');
    }

    return {
      content: [{ type: 'text' as const, text: message }],
    };
  },
);

// --- Tool 7: generate_report ---

server.tool(
  'generate_report',
  'Generate a polished HTML report with multiple DGMO diagrams, table of contents, and optional source blocks. Opens in browser by default. IMPORTANT: Parentheses in DGMO labels are color notation — "Label (red)" colors it red. Never use parentheses for annotation in labels.',
  {
    title: z.string().describe('Report title'),
    subtitle: z.string().optional().describe('Optional subtitle'),
    sections: z
      .array(
        z.object({
          title: z.string().describe('Section title'),
          description: z.string().optional().describe('Optional section description'),
          dgmo: z.string().describe('DGMO diagram markup. Parentheses in labels are color notation, not text.'),
        }),
      )
      .min(1)
      .describe('Report sections, each with a diagram'),
    theme: z.enum(['light', 'dark']).default('light').describe('Color theme'),
    palette: z.string().default('nord').describe('Color palette'),
    include_source: z.boolean().default(false).describe('Show DGMO source in collapsible blocks'),
    open: z.boolean().default(true).describe('Open the report in the browser'),
  },
  async ({ title, subtitle, sections: inputSections, theme, palette, include_source, open }) => {
    const paletteConfig = getPalette(palette);
    const results = await Promise.all(
      inputSections.map(async (s) => {
        const { svg, error } = await tryRender(s.dgmo, theme, palette);
        return { ...s, svg, error };
      }),
    );

    const successes = results.filter((r) => r.svg);
    const failures = results.filter((r) => !r.svg);

    if (successes.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              'All sections failed to render:\n' +
              failures.map((f) => `- ${f.title}: ${f.error}`).join('\n'),
          },
        ],
        isError: true,
      };
    }

    const sections: ReportSection[] = results.map((r) => ({
      title: r.title,
      description: r.description,
      svg: r.svg,
      dgmoSource: r.dgmo,
      error: r.error ?? undefined,
    }));

    const html = buildReportHtml({
      title,
      subtitle,
      sections,
      palette: paletteConfig,
      includeSource: include_source,
    });

    const filePath = writeTempHtml(html, 'dgmo-report');

    if (open) {
      await openInBrowser(filePath);
    }

    let message = open
      ? `Opened report in browser: ${filePath}`
      : `Report saved to: ${filePath}`;
    if (failures.length > 0) {
      message +=
        '\n\nWarning — some sections failed to render:\n' +
        failures.map((f) => `- ${f.title}: ${f.error}`).join('\n');
    }

    return {
      content: [{ type: 'text' as const, text: message }],
    };
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
