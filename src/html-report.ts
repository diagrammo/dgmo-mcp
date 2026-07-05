import type { PaletteConfig } from '@diagrammo/dgmo/advanced';
import { normalizeSvgForEmbed } from '@diagrammo/dgmo';
import {
  BLOCK_CSS,
  buildDgmoBlockHtml,
  errorBlockHtml,
} from '@diagrammo/dgmo/block';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportTheme = 'light' | 'dark';

export interface PreviewHtmlOptions {
  svg: string;
  title?: string | undefined;
  dgmoSource?: string | undefined;
  palette: PaletteConfig;
  shareUrl?: string | undefined;
  theme?: ReportTheme | undefined;
}

export interface ReportSection {
  title: string;
  description?: string | undefined;
  /** SVG string, or null if rendering failed */
  svg: string | null;
  dgmoSource?: string | undefined;
  /** Error message when svg is null */
  error?: string | undefined;
}

export interface ReportHtmlOptions {
  title: string;
  subtitle?: string | undefined;
  sections: ReportSection[];
  palette: PaletteConfig;
  includeSource: boolean;
  shareUrl?: string | undefined;
  theme?: ReportTheme | undefined;
}

// ---------------------------------------------------------------------------
// CSS — report/page chrome only. All per-diagram chrome (toolbar, source
// panel, error card, highlight roles) comes from the canonical embed block's
// BLOCK_CSS (@diagrammo/dgmo/block, BL-114), inlined below so reports stay
// self-contained.
// ---------------------------------------------------------------------------

function buildCss(palette: PaletteConfig): string {
  const { light, dark } = palette;
  return `
    :root, [data-theme="light"] {
      --bg: ${light.bg};
      --surface: ${light.surface};
      --border: ${light.border};
      --text: ${light.text};
      --text-muted: ${light.textMuted};
      --primary: ${light.primary};
      --destructive: ${light.destructive};
    }
    [data-theme="dark"] {
      --bg: ${dark.bg};
      --surface: ${dark.surface};
      --border: ${dark.border};
      --text: ${dark.text};
      --text-muted: ${dark.textMuted};
      --primary: ${dark.primary};
      --destructive: ${dark.destructive};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem 1.5rem; }
    h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.35rem; margin-top: 2.5rem; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.35rem; }
    .subtitle { color: var(--text-muted); margin-bottom: 1.5rem; }
    .description { color: var(--text-muted); margin-bottom: 0.75rem; }
    .dgmo { margin: 1rem 0; }
    .toc { margin: 1.5rem 0; padding: 1rem 1.25rem; background: var(--surface); border-radius: 6px; }
    .toc h3 { font-size: 0.9rem; margin-bottom: 0.5rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .toc ol { padding-left: 1.25rem; }
    .toc li { margin: 0.25rem 0; }
    .toc a { color: var(--primary); text-decoration: none; }
    .toc a:hover { text-decoration: underline; }
    .open-link {
      position: fixed; top: 1rem; right: 1rem;
      background: var(--surface); border: 1px solid var(--border);
      color: var(--text); border-radius: 6px;
      padding: 0.35rem 0.65rem; font-size: 0.8rem;
      z-index: 100; text-decoration: none; display: inline-block;
    }
    .open-link:hover { border-color: var(--primary); color: var(--primary); }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.8rem; text-align: center; }
    @media print {
      .open-link { display: none; }
      body { background: white; color: black; }
      .toc { break-after: page; }
      h2 { break-after: avoid; }
      .dgmo { break-inside: avoid; }
    }
    ${BLOCK_CSS}
  `;
}

// ---------------------------------------------------------------------------
// Toolbar script — the standard block's client behavior (remark-dgmo's
// bindDgmo is the reference): copy button writes data-dgmo-source to the
// clipboard; clicks on toolbar buttons inside the <summary> must
// preventDefault so they don't also toggle the source panel, which means the
// open-in-editor anchor's navigation is re-issued manually.
// ---------------------------------------------------------------------------

const TOOLBAR_SCRIPT = `
<script>
(function() {
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.dgmo-toolbar-btn');
    if (!btn) return;
    var insideSummary = !!btn.closest('summary');
    if (insideSummary) e.preventDefault();
    if (btn.matches('button.dgmo-copy')) {
      var src = btn.getAttribute('data-dgmo-source') || '';
      navigator.clipboard.writeText(src).then(function() {
        btn.classList.add('dgmo-copy--success');
        setTimeout(function() { btn.classList.remove('dgmo-copy--success'); }, 1500);
      });
      return;
    }
    if (insideSummary && btn.matches('a.dgmo-open') && btn.href) {
      window.open(btn.href, btn.target || '_blank', 'noopener,noreferrer');
    }
  });
})();
</script>
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wrap one rendered diagram in the canonical embed block (BL-114). The MCP
 * renders single-theme through its own renderPipeline (render gate included),
 * so the SVG goes in as a `.dgmo-svg` single-mode wrapper; the source chrome
 * (hover toolbar, hidden source panel, copy, open-in-editor) is the standard
 * block's.
 */
function diagramBlock(
  svg: string,
  dgmoSource: string | undefined,
  title: string | undefined
): string {
  const svgsHtml = `<div class="dgmo-svg">${normalizeSvgForEmbed(svg)}</div>`;
  return buildDgmoBlockHtml(dgmoSource ?? '', svgsHtml, {
    mode: dgmoSource ? 'showcase' : 'diagram',
    ...(title ? { title } : {}),
  });
}

// ---------------------------------------------------------------------------
// buildPreviewHtml
// ---------------------------------------------------------------------------

export function buildPreviewHtml(options: PreviewHtmlOptions): string {
  const {
    svg,
    title,
    dgmoSource,
    palette,
    shareUrl,
    theme = 'light',
  } = options;
  const pageTitle = title || 'Diagram Preview';
  const openLink = shareUrl
    ? `<a class="open-link" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener">Open at diagrammo.app ↗</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<style>${buildCss(palette)}
.preview-root { max-width: 1400px; margin: 0 auto; padding: 1rem 1.5rem; }
</style>
</head>
<body>
${openLink}
<div class="preview-root">
${diagramBlock(svg, dgmoSource, title)}
</div>
${TOOLBAR_SCRIPT}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// buildReportHtml
// ---------------------------------------------------------------------------

export function buildReportHtml(options: ReportHtmlOptions): string {
  const {
    title,
    subtitle,
    sections,
    palette,
    includeSource,
    shareUrl,
    theme = 'light',
  } = options;
  const showToc = sections.length > 3;

  let toc = '';
  if (showToc) {
    const items = sections
      .map(
        (s, i) => `<li><a href="#section-${i}">${escapeHtml(s.title)}</a></li>`
      )
      .join('\n');
    toc = `<nav class="toc"><h3>Contents</h3><ol>${items}</ol></nav>`;
  }

  const sectionHtml = sections
    .map((s, i) => {
      const anchor = `section-${i}`;
      const slug = slugify(s.title);
      const id = showToc ? anchor : slug;
      const desc = s.description
        ? `<p class="description">${escapeHtml(s.description)}</p>`
        : '';
      const diagram = s.svg
        ? diagramBlock(s.svg, includeSource ? s.dgmoSource : undefined, s.title)
        : errorBlockHtml(
            new Error(s.error || 'Unknown render error'),
            s.dgmoSource ?? ''
          );
      return `<section id="${id}"><h2>${escapeHtml(s.title)}</h2>${desc}${diagram}</section>`;
    })
    .join('\n');

  const now = new Date().toLocaleString();
  const openLink = shareUrl
    ? `<a class="open-link" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener">Open at diagrammo.app ↗</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${buildCss(palette)}</style>
</head>
<body>
${openLink}
<div class="container">
<h1>${escapeHtml(title)}</h1>
${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
${toc}
${sectionHtml}
<footer>Generated by Diagrammo &middot; ${escapeHtml(now)}</footer>
</div>
${TOOLBAR_SCRIPT}
</body>
</html>`;
}
