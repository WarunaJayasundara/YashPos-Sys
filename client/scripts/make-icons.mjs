// Writes icon-192.png and icon-512.png (no image libraries needed).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };

function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b, a = 255]) => { const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
  const u = size / 64;
  const inRound = (x, y, x0, y0, w, h, r) => {
    if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
    const cx = Math.min(Math.max(x, x0 + r), x0 + w - r), cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const X = x + 0.5, Y = y + 0.5;
    if (!inRound(X, Y, 0, 0, size, size, 14 * u)) { set(x, y, [0, 0, 0, 0]); continue; }
    let c = [15, 61, 145];
    const outer = inRound(X, Y, 19.25 * u, 8.25 * u, 25.5 * u, 43.5 * u, 5.5 * u);
    const inner = inRound(X, Y, 22.75 * u, 11.75 * u, 18.5 * u, 36.5 * u, 2.5 * u);
    if (outer && !inner) c = [255, 255, 255];
    if ((X - 32 * u) ** 2 + (Y - 44 * u) ** 2 <= (2.2 * u) ** 2) c = [255, 255, 255];
    // gold "Y"
    const d = (ax, ay, bx, by) => { const t = Math.max(0, Math.min(1, ((X - ax) * (bx - ax) + (Y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2))); return Math.hypot(X - (ax + t * (bx - ax)), Y - (ay + t * (by - ay))); };
    if (d(26 * u, 18 * u, 32 * u, 26 * u) < 1.75 * u || d(38 * u, 18 * u, 32 * u, 26 * u) < 1.75 * u || d(32 * u, 26 * u, 32 * u, 34 * u) < 1.75 * u) c = [251, 191, 36];
    set(x, y, c);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), icon(s));
console.log('icons written');
