// ============================================================
// emoji-strip.test.ts — an emoji must not wipe out a PNG label.
//
// resvg 2.6.2 cannot draw colour emoji fonts (diagrammo/diagrammo#1423): on
// macOS one emoji turned the whole <text> into missing-glyph boxes, on Linux
// the emoji drew nothing. svgToPngBase64 drops emoji before rasterising.
// ============================================================

import { describe, it, expect } from 'vitest';
import { emojiIn, stripEmojiFromSvg } from '../src/emoji-strip.js';
import { svgToPngBase64, fontCoverageWarning } from '../src/render-helpers.js';

const svg = (text: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40">` +
  `<text x="10" y="28" font-size="20" font-family="Inter, sans-serif">${text}</text></svg>`;
const png = (text: string) => svgToPngBase64(svg(text), '#ffffff');
const PUA = '';

describe('stripEmojiFromSvg', () => {
  it('drops emoji sequences from drawn text only', () => {
    const input =
      '<svg aria-label="a 🏢"><title>a 🏢</title>' +
      '<text>東京 🏢 👩‍💻 🇯🇵 1️⃣ ☀️ x<tspan>🌸 y</tspan></text></svg>';
    expect(stripEmojiFromSvg(input)).toBe(
      '<svg aria-label="a 🏢"><title>a 🏢</title>' +
        '<text>東京 x<tspan> y</tspan></text></svg>'
    );
  });

  it('keeps text-style symbols, digits and a lone joiner', () => {
    const text = '<text>©2026 ™ ★ ✔ ↔ ☀ 123 #1 क्‍ष</text>';
    expect(stripEmojiFromSvg(text)).toBe(text);
  });

  it('lists each emoji once, sequences whole', () => {
    expect(emojiIn('🇯🇵 👩‍💻 🏢 🏢')).toEqual(['🇯🇵', '👩‍💻', '🏢']);
  });
});

describe('svgToPngBase64 drops emoji before rasterising', () => {
  it('Latin plus an emoji rasterises as the Latin alone', () => {
    expect(png('ABC 🏢')).toBe(png('ABC'));
  });

  it('CJK plus an emoji rasterises as the CJK alone, not as missing glyphs', (ctx) => {
    if (png('東京オフィス') === png(PUA)) {
      ctx.skip(
        'no CJK system font on this machine — cannot tell CJK from boxes'
      );
    }
    expect(png('東京オフィス 🏢')).toBe(png('東京オフィス'));
    expect(png('東京オフィス 🏢')).not.toBe(png(`${PUA} 🏢`));
  });

  it('says the emoji were left out of the PNG', () => {
    expect(fontCoverageWarning(svg('ABC 🏢'))).toMatch(
      /^Emoji are left out of PNG output \(🏢\)/
    );
  });
});
