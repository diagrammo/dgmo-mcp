// ============================================================
// font-coverage.test.ts — a non-Latin label must reach the PNG.
//
// Until 80b54d6 (2026-08-07) resvg ran with `loadSystemFonts` off whenever the
// bundled Inter was found, so every script Inter lacks rasterised to NOTHING:
// no glyphs, no box, no warning. Reverting that one line left the whole suite
// green (diagrammo/diagrammo#968). This pins both halves of the fix through the
// exact path `render_diagram` takes for PNG: `renderPipeline` → `svgToPngBase64`
// for the pixels, and `fontCoverageWarning` for the note it attaches.
// ============================================================

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import {
  renderPipeline,
  svgToPngBase64,
  fontCoverageWarning,
} from '../src/render-helpers.js';

const BG = '#ffffff';

/**
 * Whether this machine has a system font that can draw Japanese. The fix lets
 * resvg FIND one; it cannot conjure one. GitHub's ubuntu-latest image ships no
 * CJK font (its apt list has fonts-noto-color-emoji and nothing else), so the
 * pixel half can only be asserted where one is installed — anchor, where the
 * pre-push gate runs, has Noto Sans CJK.
 */
function hasJapaneseSystemFont(): boolean {
  try {
    return (
      execFileSync('fc-list', [':lang=ja', 'family'], {
        encoding: 'utf-8',
      }).trim() !== ''
    );
  } catch {
    return false;
  }
}

/** Decode resvg's PNG (8-bit RGB/RGBA, non-interlaced) to raw pixels. */
function decodePng(base64: string): {
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array;
} {
  const buf = Buffer.from(base64, 'base64');
  let off = 8; // signature
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8], 'bit depth').toBe(8);
      expect(data[12], 'interlace').toBe(0);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(channels, `colour type ${data[9]}`).not.toBe(0);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c =
        x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = (line[x] + pred) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/** Pixels that are visibly not the white background. */
function inkPixels(base64: string): number {
  const { width, height, channels, pixels } = decodePng(base64);
  let ink = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    if (pixels[o] + pixels[o + 1] + pixels[o + 2] < 3 * 200) ink++;
  }
  return ink;
}

async function svgFor(title: string): Promise<string> {
  const result = await renderPipeline(`bar ${title}\n\nNorth 850\nSouth 620`, {
    theme: 'light',
    palette: 'slate',
  });
  expect(result.error).toBeNull();
  return result.svg as string;
}

describe('a non-Latin label in a PNG render (#968)', () => {
  it.skipIf(!hasJapaneseSystemFont())(
    'draws the 日本語 title instead of rasterising it to nothing',
    async () => {
      // The reference title is three ZERO-WIDTH SPACES: a title is present,
      // so the chart lays out the same, but it draws no ink — exactly what
      // 日本語 did before the fix. So the only ink one has and the other
      // lacks is the title's glyphs. Not unassigned codepoints: macOS ships
      // LastResort.otf, which draws a box for every codepoint, so there the
      // reference drew as much ink as 日本語 (2026-10-08, diff 15 vs 1000).
      const japanese = inkPixels(svgToPngBase64(await svgFor('日本語'), BG));
      const nothing = inkPixels(
        svgToPngBase64(await svgFor('\u200B\u200B\u200B'), BG)
      );
      expect(japanese - nothing).toBeGreaterThan(1000);
    }
  );

  it('names the characters the bundled Inter cannot draw, and only those', async () => {
    const warning = fontCoverageWarning(await svgFor('日本語'));
    expect(warning).toBeDefined();
    for (const ch of '日本語') expect(warning).toContain(ch);

    expect(fontCoverageWarning(await svgFor('Revenue'))).toBeUndefined();
  });
});
