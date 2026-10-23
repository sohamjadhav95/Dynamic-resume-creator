// Font measurements for the page engine. The page uses the PDF standard Helvetica family, whose
// letter widths are the same as Arial's. Measuring with the exact font metrics (instead of the
// browser's text layout) is what makes the screen preview and the downloaded PDF identical.

import { StandardFontEmbedder, StandardFonts } from "pdf-lib";

export type FontKey = "regular" | "bold" | "italic" | "boldItalic";
/** sans = Helvetica (same widths as Arial); serif = Times (same widths as Times New Roman). */
export type Family = "sans" | "serif";

export const PDF_FONT: Record<Family, Record<FontKey, StandardFonts>> = {
  sans: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  },
  serif: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
  },
};

export const SCREEN_FONT: Record<Family, string> = {
  sans: "Helvetica, Arial, 'Liberation Sans', Arimo, sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', Tinos, serif",
};

const embedders = new Map<string, StandardFontEmbedder>();
function embedder(font: FontKey, family: Family = "sans"): StandardFontEmbedder {
  const key = family + font;
  let e = embedders.get(key);
  if (!e) {
    e = StandardFontEmbedder.for(PDF_FONT[family][font] as unknown as Parameters<typeof StandardFontEmbedder.for>[0]);
    embedders.set(key, e);
  }
  return e;
}

const charWidths = new Map<string, number>(); // width of one character at size 1000

/**
 * Width of text as drawn (no kerning). pdf-lib's own width includes kerning pairs ("To", "Py"),
 * but drawText does not apply kerning, so measuring with it would make words overlap the space
 * after them.
 */
export function textWidth(text: string, font: FontKey, size: number, family: Family = "sans"): number {
  let total = 0;
  for (const ch of text) {
    const key = family + font + ch;
    let w = charWidths.get(key);
    if (w === undefined) {
      w = embedder(font, family).widthOfTextAtSize(ch, 1000);
      charWidths.set(key, w);
    }
    total += w;
  }
  return (total * size) / 1000;
}

// Characters the standard PDF fonts cannot draw are swapped for close equivalents.
const REPLACE: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "≤": "<=",
  "≥": ">=",
  "≈": "~",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "―": "-",
  " ": " ",
  " ": " ",
  " ": " ",
  "​": "",
  "✓": "v",
  "✔": "v",
  "●": "•",
  "▪": "•",
  "‣": "•",
  "⁃": "-",
  "": "•",
  "ł": "l",
  "Ł": "L",
  "đ": "d",
  "Đ": "D",
  "ı": "i",
};
const okChar = new Map<string, boolean>();

/** Text the PDF fonts can draw (same function for screen and PDF, so both stay identical). */
export function pdfSafe(text: string): string {
  const e = embedder("regular");
  let out = "";
  for (const ch of (text ?? "").normalize("NFC")) {
    const c = REPLACE[ch] ?? ch;
    if (c.length !== 1) {
      out += c;
      continue;
    }
    let ok = okChar.get(c);
    if (ok === undefined) {
      try {
        e.encodeText(c);
        ok = true;
      } catch {
        ok = false;
      }
      okChar.set(c, ok);
    }
    if (ok) out += c;
    else {
      const plain = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += plain !== c && plain.length === 1 ? plain : "?";
    }
  }
  return out;
}
