import sharp from "sharp";

export interface SubtitleChunk { text: string; start: number; end: number }

/** Splits narration into short readable phrases and times them across the spoken duration. */
export function chunkNarration(text: string, spokenSeconds: number, maxWords = 8, leadIn = 0.15): SubtitleChunk[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?;:]+[.!?;:]*/g) ?? [clean];
  const phrases: string[] = [];
  for (const sentence of sentences) {
    const words = sentence.trim().split(" ").filter(Boolean);
    const parts = Math.max(1, Math.ceil(words.length / maxWords));
    const size = Math.ceil(words.length / parts);
    for (let i = 0; i < words.length; i += size) phrases.push(words.slice(i, i + size).join(" "));
  }
  const total = phrases.reduce((a, p) => a + p.length, 0);
  const span = Math.max(0.5, spokenSeconds - leadIn);
  let cursor = leadIn;
  return phrases.map((p) => {
    const d = (p.length / total) * span;
    const chunk = { text: p, start: +cursor.toFixed(2), end: +(cursor + d).toFixed(2) };
    cursor += d;
    return chunk;
  });
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Renders a subtitle card to a transparent PNG (FFmpeg builds without libass/freetype can still burn it in). */
export async function renderSubtitlePng(text: string, videoWidth: number, videoHeight: number): Promise<{ png: Buffer; width: number; height: number }> {
  const base = Math.min(videoWidth, videoHeight);
  const fontSize = Math.round(base * 0.048);
  const maxChars = Math.floor((videoWidth * 0.86) / (fontSize * 0.55));
  const lines = wrap(text, maxChars);
  const lineH = Math.round(fontSize * 1.3);
  const padX = Math.round(fontSize * 0.7);
  const padY = Math.round(fontSize * 0.45);
  const width = Math.min(videoWidth, Math.round(Math.max(...lines.map((l) => l.length)) * fontSize * 0.55 + padX * 2));
  const height = lines.length * lineH + padY * 2;
  const tspans = lines
    .map((l, i) => `<text x="${width / 2}" y="${padY + lineH * i + fontSize}" text-anchor="middle">${escapeXml(l)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" rx="${Math.round(fontSize * 0.35)}" fill="rgba(0,0,0,0.62)"/>
    <g font-family="Helvetica, Arial, 'DejaVu Sans', sans-serif" font-size="${fontSize}" font-weight="600" fill="#fff">${tspans}</g>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { png, width, height };
}
