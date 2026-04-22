#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  render,
  parseDgmo,
  parseDgmoChartType,
  formatDgmoError,
  encodeDiagramUrl,
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
  line: 'Line chart — trends over time; supports era bands (era start -> end Label (color)) for annotating named periods',
  'multi-line': 'Multi-line chart — multiple series trends over time; supports era bands',
  area: 'Area chart — filled line chart; supports era bands',
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
  sitemap: 'Sitemap — navigable UI structure with pages, groups, and cross-link arrows',
  state: 'State diagram — state machine / lifecycle transitions',
  gantt: 'Gantt chart — project scheduling with task dependencies and milestones',
  infra: 'Infrastructure diagram — traffic flow with RPS computation, capacity modeling, and latency analysis',
  'boxes-and-lines': 'Boxes and lines — general-purpose node-edge diagrams with nested groups, tags, and shape inference',
  mindmap: 'Mindmap — radial hierarchy of ideas branching from a central topic',
  wireframe: 'Wireframe — low-fidelity UI layout with panels, controls, and annotations',
  'tech-radar': 'Tech radar — ThoughtWorks-style technology adoption quadrants (adopt/trial/assess/hold)',
  cycle: 'Cycle diagram — cyclical process visualization (PDCA, OODA, DevOps loops)',
  'journey-map': 'Journey map — user experience flow with emotion scores, phases, and annotations',
  pyramid: 'Pyramid diagram — stacked hierarchy of layers with descriptions (Maslow, DIKW, funnels with `inverted`)',
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
  // Match ## or ### headings, with optional numbering (e.g. "## 2. Sequence Diagrams")
  const escaped = chartType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(#{2,3})\\s+(?:\\d+\\.\\s+)?${escaped}\\b.*$`, 'im');
  const match = pattern.exec(markdown);
  if (!match) return null;

  const level = match[1]; // "##" or "###"
  const start = match.index;
  const rest = markdown.slice(start + match[0].length);
  const nextHeading = rest.search(new RegExp(`^${level}(?:#|\\s)`, 'm'));
  const end = nextHeading === -1 ? markdown.length : start + match[0].length + nextHeading;
  return markdown.slice(start, end).trim();
}

/** Write HTML to a temp file and return the path. */
function writeTempHtml(html: string, prefix: string): string {
  const filePath = join(tmpdir(), `${prefix}-${randomUUID()}.html`);
  writeFileSync(filePath, html, 'utf-8');
  return filePath;
}

/** Write PNG buffer to a temp file and return the path. */
function writeTempPng(base64: string): string {
  const filePath = join(tmpdir(), `dgmo-render-${randomUUID()}.png`);
  writeFileSync(filePath, Buffer.from(base64, 'base64'));
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
    const { svg } = await render(dgmo, { theme, palette });
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
  'Render DGMO markup to SVG or PNG. Returns SVG text or base64 PNG image. When format is "png", also saves the image to a temp file and returns the path. IMPORTANT DGMO syntax rules: (1) Parentheses after a label specify color — "Sales (red)" colors it red, the text becomes just "Sales". Never use parentheses for annotation. Use dashes or separate words instead, e.g. "Diagrammo App - TS" not "Diagrammo App (TS)". (2) All element/label names must be unique — if parentheses are stripped as color, two labels like "App (TS)" and "App (Rust)" both become "App" causing a duplicate name error.',
  {
    dgmo: z.string().describe('DGMO diagram markup. Parentheses in labels = color notation (stripped from display name). All labels must be unique after color stripping.'),
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

    const { svg } = await render(dgmo, { theme, palette });
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
      const pngPath = writeTempPng(base64);
      return {
        content: [
          { type: 'image' as const, data: base64, mimeType: 'image/png' as const },
          { type: 'text' as const, text: `PNG saved to: ${pngPath}` },
        ],
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
              shareUrl: url,
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
    const types = Object.keys(CHART_TYPE_DESCRIPTIONS);
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
  'Render one or more DGMO diagrams and open an HTML preview in the browser. Supports theme toggle and optional source display. IMPORTANT: Parentheses in DGMO labels = color notation (stripped from name). All labels must be unique. Use dashes for qualifiers, e.g. "App - TS" not "App (TS)".',
  {
    diagrams: z
      .array(
        z.object({
          title: z.string().optional().describe('Optional title for this diagram'),
          dgmo: z.string().describe('DGMO diagram markup. Parentheses in labels = color notation. All labels must be unique.'),
        }),
      )
      .min(1)
      .describe('One or more diagrams to preview'),
    theme: z.enum(['light', 'dark']).default('dark').describe('Color theme'),
    palette: z.string().default('nord').describe('Color palette'),
    include_source: z.boolean().default(true).describe('Show DGMO source in collapsible blocks'),
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
      const shareResult = encodeDiagramUrl(r.dgmo);
      const shareUrl = shareResult.error ? undefined : shareResult.url;
      html = buildPreviewHtml({
        svg: r.svg!,
        title: r.title,
        dgmoSource: include_source ? r.dgmo : undefined,
        palette: paletteConfig,
        shareUrl,
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
  'Generate a polished HTML report with multiple DGMO diagrams, table of contents, and optional source blocks. Opens in browser by default. IMPORTANT: Parentheses in DGMO labels = color notation (stripped from name). All labels must be unique. Use dashes for qualifiers, e.g. "App - TS" not "App (TS)".',
  {
    title: z.string().describe('Report title'),
    subtitle: z.string().optional().describe('Optional subtitle'),
    sections: z
      .array(
        z.object({
          title: z.string().describe('Section title'),
          description: z.string().optional().describe('Optional section description'),
          dgmo: z.string().describe('DGMO diagram markup. Parentheses in labels = color notation. All labels must be unique.'),
        }),
      )
      .min(1)
      .describe('Report sections, each with a diagram'),
    theme: z.enum(['light', 'dark']).default('dark').describe('Color theme'),
    palette: z.string().default('nord').describe('Color palette'),
    include_source: z.boolean().default(true).describe('Show DGMO source in collapsible blocks'),
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

// --- Tool 8: validate_diagram ---

server.tool(
  'validate_diagram',
  'Validate DGMO markup without rendering. Returns structured parse errors and warnings. Much faster than render_diagram — use this to check syntax before rendering.',
  {
    dgmo: z.string().describe('DGMO diagram markup to validate'),
  },
  async ({ dgmo }) => {
    const chartType = parseDgmoChartType(dgmo);
    const { diagnostics } = parseDgmo(dgmo);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');

    if (errors.length === 0 && warnings.length === 0) {
      const typeLabel = chartType ? `${chartType} diagram` : 'diagram';
      return {
        content: [{ type: 'text' as const, text: `Valid ${typeLabel} — no errors or warnings.` }],
      };
    }

    const typeLabel = chartType ? ` in ${chartType} diagram` : '';
    const parts: string[] = [];

    if (errors.length > 0) {
      parts.push(`${errors.length} error${errors.length > 1 ? 's' : ''}${warnings.length > 0 ? `, ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}${typeLabel}\n`);
      parts.push('Errors:');
      for (const e of errors) parts.push(`  ${formatDgmoError(e)}`);
    }

    if (warnings.length > 0) {
      if (errors.length === 0) {
        parts.push(`Valid with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}${typeLabel}\n`);
      } else {
        parts.push('');
      }
      parts.push('Warnings:');
      for (const w of warnings) parts.push(`  ${formatDgmoError(w)}`);
    }

    return {
      content: [{ type: 'text' as const, text: parts.join('\n') }],
      isError: errors.length > 0,
    };
  },
);

// --- Tool 9: get_examples ---

function resolveGalleryPath(): string {
  // Try 1: resolve from @diagrammo/dgmo package
  try {
    const dgmoMain = require.resolve('@diagrammo/dgmo');
    const pkgRoot = dirname(dirname(dgmoMain));
    const galleryPath = join(pkgRoot, 'gallery', 'fixtures');
    readdirSync(galleryPath); // throws if not found
    return galleryPath;
  } catch {
    // Try 2: resolve from sibling dgmo/ directory (local dev workspace)
    const workspacePath = join(__dirname, '..', '..', 'dgmo', 'gallery', 'fixtures');
    return workspacePath;
  }
}

server.tool(
  'get_examples',
  'Get example DGMO diagrams for a chart type. Returns real-world examples from the gallery that demonstrate syntax patterns. Use these as few-shot references when generating new diagrams.',
  {
    chart_type: z
      .string()
      .optional()
      .describe('Chart type to get examples for (e.g. "sequence", "infra", "bar"). Omit to list all available example names.'),
  },
  async ({ chart_type }) => {
    let galleryPath: string;
    try {
      galleryPath = resolveGalleryPath();
    } catch {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Could not find gallery fixtures. Is @diagrammo/dgmo installed?',
          },
        ],
        isError: true,
      };
    }

    let files: string[];
    try {
      files = readdirSync(galleryPath)
        .filter((f) => f.endsWith('.dgmo'))
        .sort();
    } catch {
      return {
        content: [
          { type: 'text' as const, text: 'Could not read gallery directory.' },
        ],
        isError: true,
      };
    }

    // If no chart_type, return a listing of all available examples
    if (!chart_type) {
      const names = files.map((f) => f.replace('.dgmo', ''));
      return {
        content: [
          {
            type: 'text' as const,
            text: `Available examples (${files.length}):\n\n${names.map((n) => `- ${n}`).join('\n')}\n\nCall get_examples with a chart_type to see the full DGMO source.`,
          },
        ],
      };
    }

    // Filter files matching the chart type prefix
    const matching = files.filter((f) => {
      const base = f.replace('.dgmo', '');
      return base === chart_type || base.startsWith(chart_type + '-');
    });

    if (matching.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No examples found for "${chart_type}". Use get_examples() without arguments to see all available examples.`,
          },
        ],
        isError: true,
      };
    }

    // Cap at 5 examples to avoid overwhelming context
    const toShow = matching.slice(0, 5);
    const parts = toShow.map((f) => {
      const content = readFileSync(join(galleryPath, f), 'utf-8');
      return `## ${f.replace('.dgmo', '')}\n\n\`\`\`dgmo\n${content.trim()}\n\`\`\``;
    });

    let text = parts.join('\n\n---\n\n');
    if (matching.length > 5) {
      text += `\n\n(Showing 5 of ${matching.length} examples)`;
    }

    return {
      content: [{ type: 'text' as const, text }],
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
