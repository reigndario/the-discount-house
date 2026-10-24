// Cuts the TDH house out of its dark studio background and writes a transparent, trimmed, square PNG.
// Usage (from apps/site): node scripts/cutout-logo.mjs <source.png> [out.png] [size]
//
// The source is a render of the house on a near-black background with a faint glow. The background is found by flood
// filling from the image border over dark pixels, so the black window cutouts, which are sealed off by the silver rim,
// stay solid black. The mask is then eroded one pixel to drop edge pixels blended with the background, and softened.
import sharp from "sharp";

const [, , source, out = "public/tdh-logo.png", sizeArg = "1024"] = process.argv;
if (!source) {
  console.error("Usage: node scripts/cutout-logo.mjs <source.png> [out.png] [size]");
  process.exit(1);
}
const size = Number(sizeArg);
const DARK = 85; // the glow peaks near 75 at the roof; the rim edge starts above 100

const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const outside = new Uint8Array(W * H);
const isDark = (p) => Math.max(data[p * 3], data[p * 3 + 1], data[p * 3 + 2]) <= DARK;

const queue = new Int32Array(W * H);
let head = 0;
let tail = 0;
const push = (p) => {
  if (!outside[p] && isDark(p)) {
    outside[p] = 1;
    queue[tail++] = p;
  }
};
for (let x = 0; x < W; x++) {
  push(x);
  push((H - 1) * W + x);
}
for (let y = 0; y < H; y++) {
  push(y * W);
  push(y * W + W - 1);
}
while (head < tail) {
  const p = queue[head++];
  const x = p % W;
  if (p >= W) push(p - W);
  if (p < W * (H - 1)) push(p + W);
  if (x > 0) push(p - 1);
  if (x < W - 1) push(p + 1);
}

// Erode the house by one pixel: anything touching the outside becomes outside.
const eroded = Uint8Array.from(outside);
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    if (!outside[p] && (outside[p - 1] || outside[p + 1] || outside[p - W] || outside[p + W])) eroded[p] = 1;
  }
}

// Keep only the largest connected piece (drops glow specks), then fill each row between its outermost pixels. The
// house is a convex shape, so this restores the dark underside of the base, which the flood fill cannot tell from
// the background.
const label = new Int32Array(W * H);
let best = 0;
let bestSize = 0;
let next = 0;
for (let start = 0; start < W * H; start++) {
  if (eroded[start] || label[start]) continue;
  next++;
  let size = 0;
  let h = 0;
  let t = 0;
  queue[t++] = start;
  label[start] = next;
  while (h < t) {
    const p = queue[h++];
    size++;
    const x = p % W;
    for (const q of [p >= W ? p - W : -1, p < W * (H - 1) ? p + W : -1, x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1]) {
      if (q >= 0 && !eroded[q] && !label[q]) {
        label[q] = next;
        queue[t++] = q;
      }
    }
  }
  if (size > bestSize) {
    best = next;
    bestSize = size;
  }
}
const solid = new Uint8Array(W * H);
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) {
  let lo = -1;
  let hi = -1;
  for (let x = 0; x < W; x++) {
    if (label[y * W + x] === best) {
      if (lo < 0) lo = x;
      hi = x;
    }
  }
  if (lo < 0) continue;
  for (let x = lo; x <= hi; x++) solid[y * W + x] = 1;
  if (lo < minX) minX = lo;
  if (hi > maxX) maxX = hi;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
}
const side = Math.round(Math.max(maxX - minX, maxY - minY) * 1.04);
const left = Math.round((minX + maxX) / 2 - side / 2);
const top = Math.round((minY + maxY) / 2 - side / 2);

const alpha = Buffer.alloc(W * H);
for (let p = 0; p < W * H; p++) alpha[p] = solid[p] ? 255 : 0;
const softAlpha = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } })
  .blur(0.8)
  .extractChannel(0) // sharp hands back three channels after a blur; keep one
  .raw()
  .toBuffer();
if (softAlpha.length !== W * H) throw new Error(`unexpected mask size ${softAlpha.length}, wanted ${W * H}`);

const rgba = Buffer.alloc(W * H * 4);
for (let p = 0; p < W * H; p++) {
  rgba[p * 4] = data[p * 3];
  rgba[p * 4 + 1] = data[p * 3 + 1];
  rgba[p * 4 + 2] = data[p * 3 + 2];
  rgba[p * 4 + 3] = softAlpha[p];
}

await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .extract({ left: Math.max(0, left), top: Math.max(0, top), width: Math.min(side, W - Math.max(0, left)), height: Math.min(side, H - Math.max(0, top)) })
  .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`Wrote ${out} (${size}px, house bounds ${maxX - minX}x${maxY - minY} in a ${W}x${H} source).`);
