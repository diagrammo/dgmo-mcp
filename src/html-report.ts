import type { PaletteConfig } from '@diagrammo/dgmo/internal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreviewHtmlOptions {
  svg: string;
  title?: string;
  dgmoSource?: string;
  palette: PaletteConfig;
  shareUrl?: string;
}

export interface ReportSection {
  title: string;
  description?: string;
  /** SVG string, or null if rendering failed */
  svg: string | null;
  dgmoSource?: string;
  /** Error message when svg is null */
  error?: string;
}

export interface ReportHtmlOptions {
  title: string;
  subtitle?: string;
  sections: ReportSection[];
  palette: PaletteConfig;
  includeSource: boolean;
  shareUrl?: string;
}

// ---------------------------------------------------------------------------
// CSS
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
    .diagram-wrapper { margin: 1rem 0; overflow-x: auto; width: 100%; }
    .diagram-wrapper svg { max-width: none; height: auto; display: block; }
    .description { color: var(--text-muted); margin-bottom: 0.75rem; }
    details { margin: 0.75rem 0; }
    summary { cursor: pointer; color: var(--text-muted); font-size: 0.85rem; user-select: none; }
    summary:hover { color: var(--primary); }
    .source-header { display: flex; align-items: center; justify-content: space-between; margin-top: 0.5rem; }
    .copy-btn {
      background: var(--surface); border: 1px solid var(--border);
      color: var(--text-muted); border-radius: 4px;
      padding: 0.2rem 0.5rem; cursor: pointer; font-size: 0.75rem;
    }
    .copy-btn:hover { border-color: var(--primary); color: var(--primary); }
    pre {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
      overflow-x: auto;
      font-size: 0.8rem;
      line-height: 1.5;
      margin-top: 0.5rem;
    }
    code { font-family: 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .error-placeholder {
      border: 2px solid var(--destructive);
      border-radius: 6px;
      padding: 1rem 1.25rem;
      color: var(--destructive);
      margin: 1rem 0;
    }
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
      .diagram-wrapper { break-inside: avoid; }
    }
  `;
}

// ---------------------------------------------------------------------------
// Copy button script
// ---------------------------------------------------------------------------

const COPY_SCRIPT = `
<script>
(function() {
  document.addEventListener('click', function(e) {
    var copyBtn = e.target.closest('.copy-btn');
    if (!copyBtn) return;
    var id = copyBtn.getAttribute('data-copy');
    var pre = document.getElementById(id);
    if (!pre) return;
    var text = pre.textContent || '';
    navigator.clipboard.writeText(text).then(function() {
      var orig = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(function() { copyBtn.textContent = orig; }, 1500);
    });
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

function sourceBlock(dgmoSource: string): string {
  const id = `src-${Math.random().toString(36).slice(2, 8)}`;
  return `<details><summary>DGMO source</summary><div class="source-header"><span></span><button class="copy-btn" data-copy="${id}">Copy</button></div><pre id="${id}"><code>${escapeHtml(dgmoSource)}</code></pre></details>`;
}

function errorPlaceholder(error: string): string {
  return `<div class="error-placeholder">⚠ Render error: ${escapeHtml(error)}</div>`;
}

// ---------------------------------------------------------------------------
// buildPreviewHtml
// ---------------------------------------------------------------------------

export function buildPreviewHtml(options: PreviewHtmlOptions): string {
  const { svg, title, dgmoSource, palette, shareUrl } = options;
  const pageTitle = title || 'Diagram Preview';
  const openLink = shareUrl
    ? `<a class="open-link" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener">Open at diagrammo.app ↗</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<style>${buildCss(palette)}
.preview-root { display: flex; flex-direction: column; min-height: 100vh; padding: 1rem; }
.preview-diagram { flex: 1; overflow: auto; display: flex; align-items: flex-start; justify-content: flex-start; }
.preview-diagram svg { max-width: none; height: auto; display: block; }
.preview-source { flex-shrink: 0; }
</style>
</head>
<body>
${openLink}
<div class="preview-root">
<div class="preview-diagram">${svg}</div>
${dgmoSource ? `<div class="preview-source">${sourceBlock(dgmoSource)}</div>` : ''}
</div>
${COPY_SCRIPT}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// buildReportHtml
// ---------------------------------------------------------------------------

export function buildReportHtml(options: ReportHtmlOptions): string {
  const { title, subtitle, sections, palette, includeSource, shareUrl } =
    options;
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
        ? `<div class="diagram-wrapper">${s.svg}</div>`
        : errorPlaceholder(s.error || 'Unknown render error');
      const source =
        includeSource && s.dgmoSource ? sourceBlock(s.dgmoSource) : '';
      return `<section id="${id}"><h2>${escapeHtml(s.title)}</h2>${desc}${diagram}${source}</section>`;
    })
    .join('\n');

  const now = new Date().toLocaleString();
  const openLink = shareUrl
    ? `<a class="open-link" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener">Open at diagrammo.app ↗</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
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
${COPY_SCRIPT}
</body>
</html>`;
}
