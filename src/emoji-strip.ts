// ============================================================
// emoji-strip.ts — drop emoji from an SVG before resvg rasterises it.
//
// A COPY of the strip in dgmo's src/font-coverage.ts (diagrammo/diagrammo#1423).
// It is duplicated rather than imported because no published @diagrammo/dgmo
// exports it yet; switch to the library's copy once one does.
//
// 🔴 resvg 2.6.2 cannot draw a colour-bitmap emoji font. On macOS fallback
// lands on Apple Color Emoji (sbix) for the WHOLE <text>, so one emoji turns
// every glyph of the label, CJK and Latin included, into a missing-glyph box;
// a separate <tspan> does not help. On Linux (Noto Color Emoji, CBDT) the
// emoji alone draws nothing. Dropping the emoji keeps the text. PNG only.
// ============================================================

/**
 * One emoji: a flag (two regional indicators), a keycap, or a pictograph with
 * its optional skin tone, VS16 and tag run, chained by zero-width joiners.
 * A pictograph counts when it is emoji by default (`Emoji_Presentation`), when
 * VS16 asks for emoji style, or when it sits in U+1F000–U+1FFFF. Text-style
 * symbols (©, ™, ↔, ★, ✔) and a lone joiner (Devanagari uses one) are kept.
 */
const EMOJI_ATOM = [
  '[\\u{1F1E6}-\\u{1F1FF}]{2}',
  '[0-9#*]\\uFE0F?\\u20E3',
  '(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}(?=\\uFE0F)|(?=\\p{Extended_Pictographic})[\\u{1F000}-\\u{1FFFF}])' +
    '[\\u{1F3FB}-\\u{1F3FF}]?\\uFE0F?[\\u{E0020}-\\u{E007F}]*',
].join('|');
const EMOJI = new RegExp(
  `(?:${EMOJI_ATOM})(?:\\u200D(?:${EMOJI_ATOM}))*`,
  'gu'
);

/** The emoji in `text`, deduplicated, in first-seen order. */
export function emojiIn(text: string): string[] {
  return [...new Set(text.match(EMOJI) ?? [])];
}

/** Remove every emoji; a gap that held a space keeps exactly one. */
function closeGaps(text: string): string {
  EMOJI.lastIndex = 0;
  if (!EMOJI.test(text)) return text;
  return text
    .replace(EMOJI, '\0')
    .replace(/[ \0]*\0[ \0]*/g, (gap) => (gap.includes(' ') ? ' ' : ''));
}

/**
 * `svg` with every emoji removed from the text nodes inside `<text>` (and so
 * their `<tspan>`s). Attributes, `<title>` and everything else stay
 * byte-identical.
 */
export function stripEmojiFromSvg(svg: string): string {
  return svg.replace(
    /(<text\b[^>]*>)([\s\S]*?)(<\/text>)/g,
    (_, open: string, inner: string, close: string) =>
      open +
      inner.replace(
        /(^|>)([^<]+)/g,
        (_m, lead: string, node: string) => lead + closeGaps(node)
      ) +
      close
  );
}

/** The note for emoji left out of a PNG, or `undefined` when there are none. */
export function emojiOmittedWarning(text: string): string | undefined {
  const found = emojiIn(text);
  if (found.length === 0) return undefined;
  const sample = found.slice(0, 6).join('');
  const more = found.length > 6 ? ` +${found.length - 6} more` : '';
  return (
    `Emoji are left out of PNG output (${sample}${more}): the PNG renderer cannot draw ` +
    `colour emoji fonts, and on macOS one emoji would turn the whole label into boxes. ` +
    `Export to .svg to keep them.`
  );
}
