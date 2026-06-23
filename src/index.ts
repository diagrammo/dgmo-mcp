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
  parseDgmo,
  parseDgmoChartType,
  formatDgmoError,
  encodeDiagramUrl,
  getPalette,
  chartTypes,
  CHART_TYPE_DESCRIPTIONS,
  INVALID_COLOR_CODE,
} from '@diagrammo/dgmo/advanced';
// Render-to-raster path, single-sourced in ./render-helpers so the dev-only
// guidance studio can reuse the EXACT same pipeline (it dynamic-imports the
// built helper). Re-exported below to preserve the prior public surface.
import { svgToPngBase64, renderPipeline } from './render-helpers.js';
export { renderPipeline } from './render-helpers.js';
import { validateFlowchartStructure } from './flowchart-structure.js';
// Public entry: the shared resolve·fallback·warn seam (Story 110.2). Imported
// here so the MCP layer can surface the palette-fallback warning that render()
// would otherwise swallow.
import { resolvePaletteOrFallback } from '@diagrammo/dgmo';
// Chart-type SELECTION lives HERE, not in the dgmo render library — it is
// AI-authoring functionality only this MCP server (and the eval harness) needs.
import { suggestChartTypes } from './suggest/scoring.js';
import type { ChartTypeScore } from './suggest/scoring.js';
import { buildPreviewHtml, buildReportHtml } from './html-report.js';
import type { ReportSection } from './html-report.js';
import { openInBrowser } from './open-browser.js';
import {
  extractSection,
  extractColorRule,
  extractTitleRule,
  extractCategorizeRule,
} from './reference.js';
import { version as PACKAGE_VERSION } from '../package.json';

// ---------------------------------------------------------------------------
// Chart-type schema
// ---------------------------------------------------------------------------

// Runtime-safe validator for chart-type ids. Using z.string().refine avoids
// the z.enum([...] as [string, ...string[]]) cast footgun (throws on empty
// arrays, loses literal types) and lets us ship a helpful error message
// that lists every valid id.
const chartTypeIdSet = new Set(chartTypes.map((c) => c.id));
const chartTypeIdSchema = z.string().refine(
  (v) => chartTypeIdSet.has(v),
  (v) => ({
    message: `Unknown chart type '${v}'. Valid: ${[...chartTypeIdSet].join(', ')}`,
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    const workspacePath = join(
      __dirname,
      '..',
      '..',
      'dgmo',
      'docs',
      'language-reference.md'
    );
    return readFileSync(workspacePath, 'utf-8');
  }
}

// Per-type reference slicing lives in ./reference.ts (pure + unit-tested).

/**
 * Slice a chart type's reference block and prepend the universal color rule.
 * Per-type slices omit the ANTIPATTERNS core, so without this the model never
 * sees the closed 11-name palette / no-hex / no-CSS-color contract when it
 * fetches (or is handed) a single type. Returns null when the type has no
 * documented block.
 */
function sliceWithColorRule(content: string, chartType: string): string | null {
  const raw = extractSection(content, chartType);
  if (!raw) return null;
  // Strip the TIPS delimiter comments (keep the guidance prose) so no structural
  // HTML-comment scaffolding rides along to the model — it would echo such a
  // comment verbatim into the generated diagram. The opening TYPE marker is
  // already excluded by extractSection.
  const section = raw.replace(/[ \t]*<!--\s*TIPS (?:start|end)\s*-->[ \t]*\n?/g, '');
  // Universal rules that ride EVERY slice (the STYLING core itself does not):
  // the closed-set color contract, the always-title rule, and the
  // categorize-and-color rule.
  const universal = [
    extractColorRule(content),
    extractTitleRule(content),
    extractCategorizeRule(content),
  ].filter(Boolean);
  return universal.length
    ? `${universal.join('\n\n')}\n\n---\n\n${section}`
    : section;
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

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

// Exported so the test harness can connect it to an in-memory transport
// (tests/tools.test.ts) instead of stdio. The stdio bootstrap at the bottom is
// guarded by DGMO_MCP_TEST so importing this module in Vitest does not grab
// stdin and hang.
export const server = new McpServer({
  name: 'dgmo',
  version: PACKAGE_VERSION,
});

// --- Tool 1: render_diagram ---

server.tool(
  'render_diagram',
  'Render DGMO markup to SVG or PNG. Returns SVG text or base64 PNG image. When format is "png", also saves the image to a temp file and returns the path. For DGMO syntax call get_language_reference (e.g. color a label with a trailing color name: "Sales red").',
  {
    dgmo: z
      .string()
      .describe(
        'DGMO diagram markup. Color a label by appending a lowercase color name as the trailing token (e.g. "Sales red"); capitalize ("Red") to use a color word as literal text.'
      ),
    format: z.enum(['svg', 'png']).default('svg').describe('Output format'),
    theme: z
      .enum(['light', 'dark', 'transparent'])
      .default('light')
      .describe('Color theme'),
    palette: z
      .string()
      .default('slate')
      .describe(
        'Color palette (slate, atlas, blueprint, tidewater, nord, catppuccin, tokyo-night)'
      ),
  },
  {
    title: 'Render Diagram',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  },
  async ({ dgmo, format, theme, palette }) => {
    // Resolve the palette here (not only inside render) so the fallback warning
    // that render() swallows is surfaced to the caller (Story 110.2 AC3).
    const paletteNotes: { type: 'text'; text: string }[] = [];
    const paletteColors = resolvePaletteOrFallback(palette, (message) =>
      paletteNotes.push({ type: 'text' as const, text: message })
    );

    const result = await renderPipeline(dgmo, { theme, palette });
    if (result.error !== null) {
      // Parse errors keep the "Diagram has errors:" lead-in; a render failure
      // (empty svg / thrown) surfaces its raw message.
      const hasParseErrors = result.diagnostics.some(
        (d) => d.severity === 'error'
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: hasParseErrors
              ? 'Diagram has errors:\n' + result.error
              : result.error,
          },
        ],
        isError: true,
      };
    }
    const svg = result.svg;

    if (format === 'png') {
      const bg =
        theme === 'transparent'
          ? undefined
          : paletteColors[theme === 'dark' ? 'dark' : 'light'].bg;
      const base64 = svgToPngBase64(svg, bg);
      const pngPath = writeTempPng(base64);
      return {
        content: [
          ...paletteNotes,
          {
            type: 'image' as const,
            data: base64,
            mimeType: 'image/png' as const,
          },
          { type: 'text' as const, text: `PNG saved to: ${pngPath}` },
        ],
      };
    }

    return {
      content: [...paletteNotes, { type: 'text' as const, text: svg }],
    };
  }
);

// --- Tool 2: share_diagram ---

server.tool(
  'share_diagram',
  'Generate a shareable diagrammo.app URL for a DGMO diagram.',
  {
    dgmo: z.string().describe('DGMO diagram markup'),
  },
  {
    title: 'Share Diagram',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
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
  }
);

// --- Tool 3: open_in_app ---

server.tool(
  'open_in_app',
  'Open a DGMO diagram in the Diagrammo desktop app (macOS only). Falls back to browser preview if the app is not installed.',
  {
    dgmo: z.string().describe('DGMO diagram markup'),
  },
  {
    title: 'Open in Diagrammo App',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
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
      // exec's callback is sync-typed; wrap the async body in a void IIFE
      // so the Promise return doesn't violate @typescript-eslint/no-misused-promises.
      exec(`open ${JSON.stringify(deepLink)}`, (error) => {
        void (async () => {
          if (error) {
            // Fallback: render to SVG and open in browser
            try {
              const rendered = await renderPipeline(dgmo, {
                theme: 'light',
                palette: 'slate',
              });
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
              const paletteConfig = getPalette('slate');
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
        })();
      });
    });
  }
);

// --- Tool 4: list_chart_types ---

server.tool(
  'list_chart_types',
  'List all supported DGMO chart types with descriptions.',
  {},
  {
    title: 'List Chart Types',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  },
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
  }
);

// --- Tool 5: get_language_reference ---

server.tool(
  'get_language_reference',
  'Get the DGMO language reference documentation. Optionally filter by chart type.',
  {
    chart_type: chartTypeIdSchema
      .optional()
      .describe(
        'Optional chart type to get reference for (e.g. "sequence", "flowchart", "bar")'
      ),
  },
  {
    title: 'Get DGMO Language Reference',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
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
      const section = sliceWithColorRule(content, chart_type);
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
  }
);

// --- Tool 6: preview_diagram ---

server.tool(
  'preview_diagram',
  'Render one or more DGMO diagrams and open an HTML preview in the browser. Supports theme toggle and optional source display. For DGMO syntax call get_language_reference (e.g. color a label with a trailing color name: "Sales red").',
  {
    diagrams: z
      .array(
        z.object({
          title: z
            .string()
            .optional()
            .describe('Optional title for this diagram'),
          dgmo: z
            .string()
            .describe(
              'DGMO diagram markup. Color a label by appending a lowercase color name as the trailing token (e.g. "Sales red"); capitalize ("Red") to use a color word as literal text.'
            ),
        })
      )
      .min(1)
      .describe('One or more diagrams to preview'),
    theme: z.enum(['light', 'dark']).default('dark').describe('Color theme'),
    palette: z.string().default('slate').describe('Color palette'),
    include_source: z
      .boolean()
      .default(true)
      .describe('Show DGMO source in collapsible blocks'),
  },
  {
    title: 'Preview Diagram',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  async ({ diagrams, theme, palette, include_source }) => {
    // Surface the palette fallback warning rather than dropping it (110.2 AC3).
    const paletteNotes: string[] = [];
    const paletteConfig = resolvePaletteOrFallback(palette, (m) =>
      paletteNotes.push(m)
    );
    const results = await Promise.all(
      diagrams.map(async (d) => {
        const { svg, error } = await renderPipeline(d.dgmo, { theme, palette });
        return { title: d.title, dgmo: d.dgmo, svg, error };
      })
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
              failures
                .map((f) => `- ${f.title || 'untitled'}: ${f.error}`)
                .join('\n'),
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
        failures
          .map((f) => `- ${f.title || 'untitled'}: ${f.error}`)
          .join('\n');
    }
    if (paletteNotes.length > 0) {
      message += '\n\n' + paletteNotes.join('\n');
    }

    return {
      content: [{ type: 'text' as const, text: message }],
    };
  }
);

// --- Tool 7: generate_report ---

server.tool(
  'generate_report',
  'Generate a polished HTML report with multiple DGMO diagrams, table of contents, and optional source blocks. Opens in browser by default. For DGMO syntax call get_language_reference (e.g. color a label with a trailing color name: "Sales red").',
  {
    title: z.string().describe('Report title'),
    subtitle: z.string().optional().describe('Optional subtitle'),
    sections: z
      .array(
        z.object({
          title: z.string().describe('Section title'),
          description: z
            .string()
            .optional()
            .describe('Optional section description'),
          dgmo: z
            .string()
            .describe(
              'DGMO diagram markup. Color a label by appending a lowercase color name as the trailing token (e.g. "Sales red"); capitalize ("Red") to use a color word as literal text.'
            ),
        })
      )
      .min(1)
      .describe('Report sections, each with a diagram'),
    theme: z.enum(['light', 'dark']).default('dark').describe('Color theme'),
    palette: z.string().default('slate').describe('Color palette'),
    include_source: z
      .boolean()
      .default(true)
      .describe('Show DGMO source in collapsible blocks'),
    open: z.boolean().default(true).describe('Open the report in the browser'),
  },
  {
    title: 'Generate Report',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  async ({
    title,
    subtitle,
    sections: inputSections,
    theme,
    palette,
    include_source,
    open,
  }) => {
    const paletteConfig = getPalette(palette);
    const results = await Promise.all(
      inputSections.map(async (s) => {
        const { svg, error } = await renderPipeline(s.dgmo, { theme, palette });
        return { ...s, svg, error };
      })
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
  }
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
    // Flowcharts get an extra structural gate (orphan nodes, one-way decisions),
    // mirroring the render gate so validate and render agree.
    if (chartType === 'flowchart') {
      diagnostics.push(...validateFlowchartStructure(dgmo));
    }
    // Invalid colors (hex/CSS) are blocking here even when the library classed
    // them a warning — named palette colors are mandatory (see render gate).
    const isBlocking = (d: (typeof diagnostics)[number]) =>
      d.severity === 'error' || d.code === INVALID_COLOR_CODE;
    const errors = diagnostics.filter(isBlocking);
    const warnings = diagnostics.filter((d) => !isBlocking(d));

    if (errors.length === 0 && warnings.length === 0) {
      const typeLabel = chartType ? `${chartType} diagram` : 'diagram';
      return {
        content: [
          {
            type: 'text' as const,
            text: `Valid ${typeLabel} — no errors or warnings.`,
          },
        ],
      };
    }

    const typeLabel = chartType ? ` in ${chartType} diagram` : '';
    const parts: string[] = [];

    if (errors.length > 0) {
      parts.push(
        `${errors.length} error${errors.length > 1 ? 's' : ''}${warnings.length > 0 ? `, ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}${typeLabel}\n`
      );
      parts.push('Errors:');
      for (const e of errors) parts.push(`  ${formatDgmoError(e)}`);
    }

    if (warnings.length > 0) {
      if (errors.length === 0) {
        parts.push(
          `Valid with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}${typeLabel}\n`
        );
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
  }
);

// --- Tool 9: suggest_chart_type ---

/** Option labels for the ASK-THE-USER choice lists. */
const OPTION_LETTERS = 'ABCDEFGH';

/**
 * Format ranked candidates for Claude. Locked-in layout so the tool output
 * is easy to parse at a glance and remains stable across releases.
 *
 * The output is also the enforcement point for the "ask, don't guess" flow:
 * when the scorer is not confident (no real trigger matched → `fellBack`, or
 * the top two are equally plausible → `ambiguous`) it returns a directive that
 * tells the caller to present the candidates to the user and WAIT, instead of
 * silently picking one. This rides the MCP tool text so it reaches every
 * client, not just surfaces that load the skill.
 */
export function formatSuggestions(
  ranked: readonly ChartTypeScore[],
  fellBack: boolean,
  confidenceBanner: 'high' | 'medium' | 'ambiguous'
): string {
  // No real trigger fired — we genuinely don't know. Ask the user; never guess.
  if (ranked.length === 0 || fellBack) {
    const fallbacks = chartTypes.filter((c) => c.fallback);
    return [
      '⚠️ ASK THE USER — no chart type clearly matches this request.',
      'Do not guess a type. Ask the user which of these general-purpose options fits, or to describe their data/intent in more detail:',
      '',
      ...fallbacks.map((c, i) => `  [${OPTION_LETTERS[i]}] ${c.id} — ${c.description}`),
      '',
      'If none fit, call `mcp__dgmo__list_chart_types` for the full list. Wait for the user to choose before generating any diagram.',
    ].join('\n');
  }

  const top3 = ranked.slice(0, 3);

  // Two or more types are equally plausible — present the choice, don't pick one.
  if (confidenceBanner === 'ambiguous') {
    const lines = [
      '⚠️ ASK THE USER — these chart types are equally plausible; do not pick one yourself.',
      'Present these options to the user and wait for their choice before generating:',
      '',
    ];
    for (const [i, r] of top3.entries()) {
      lines.push(`  [${OPTION_LETTERS[i]}] ${r.type.id} — ${r.type.description}`);
      if (r.matched.length) lines.push(`      matched: ${r.matched.join(', ')}`);
    }
    lines.push('');
    lines.push(
      "Once the user chooses, call mcp__dgmo__get_examples('<id>') for a starter template."
    );
    return lines.join('\n');
  }

  // Confident enough to proceed with the top match.
  const banner =
    confidenceBanner === 'high'
      ? 'Confidence: high — use the top match below.'
      : 'Confidence: medium — use the top match below; the runner-up is also plausible if the context points that way.';

  const lines: string[] = [banner, ''];
  for (const [i, r] of top3.entries()) {
    const label = i === 0 ? 'Top match' : 'Secondary';
    lines.push(`${label}: ${r.type.id}`);
    lines.push(`  Description: ${r.type.description}`);
    lines.push(
      `  Matched triggers: ${r.matched.join(', ') || '(none — secondary score from description)'}`
    );
    lines.push(
      `  For a starter template, call mcp__dgmo__get_examples('${r.type.id}').`
    );
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

server.tool(
  'suggest_chart_type',
  "Suggest the best DGMO chart type for a user's plain-English diagram request.\n\nALWAYS CALL THIS FIRST when creating a new diagram — it prevents guessing and is the authoritative selection mechanism.\n\nReturns one of two shapes: (1) a confident pick (high/medium) with the top match's syntax, or (2) an '⚠️ ASK THE USER' directive when the choice is ambiguous or nothing matched. On an ASK-THE-USER directive, do NOT pick a type yourself — present the listed candidates to the user and wait for their choice before generating.",
  {
    prompt: z
      .string()
      .trim()
      .min(3)
      .max(5000)
      .describe("User's plain-English diagram request"),
  },
  async ({ prompt }) => {
    const { ranked, confidence, fellBack } = suggestChartTypes(prompt);
    let text = formatSuggestions(ranked, fellBack, confidence);

    // Workflow-driven fetch (AC14/ADR-5): since this tool is "ALWAYS CALL
    // FIRST", ride that step to deliver the chosen type's syntax. Append the
    // top match's per-type reference block so the model gets it without a
    // separate get_language_reference round-trip it might skip. Skip it when the
    // choice is ambiguous — we're asking the user to pick, so there is no single
    // "top match" syntax to deliver yet (they fetch it after choosing).
    if (!fellBack && confidence !== 'ambiguous' && ranked.length > 0) {
      try {
        const section = sliceWithColorRule(
          resolveLanguageReference(),
          ranked[0].type.id
        );
        if (section) {
          text += `\n\n---\nLanguage reference for ${ranked[0].type.id} (Tier 1):\n\n${section}`;
        }
      } catch {
        // reference unavailable — suggestions alone are still useful
      }
    }

    return {
      content: [{ type: 'text' as const, text }],
    };
  }
);

// --- Tool 10: get_examples ---

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
    const workspacePath = join(
      __dirname,
      '..',
      '..',
      'dgmo',
      'gallery',
      'fixtures'
    );
    return workspacePath;
  }
}

server.tool(
  'get_examples',
  'Get example DGMO diagrams for a chart type. Returns real-world examples from the gallery that demonstrate syntax patterns. Use these as few-shot references when generating new diagrams.',
  {
    chart_type: chartTypeIdSchema
      .optional()
      .describe(
        'Chart type to get examples for (e.g. "sequence", "infra", "bar"). Omit to list all available example names.'
      ),
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
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Skip the stdio bootstrap under test (the harness drives the server over an
// in-memory transport). DGMO_MCP_TEST is set by vitest.config.ts.
if (!process.env['DGMO_MCP_TEST']) {
  main().catch((err) => {
    console.error('Failed to start dgmo MCP server:', err);
    process.exit(1);
  });
}
