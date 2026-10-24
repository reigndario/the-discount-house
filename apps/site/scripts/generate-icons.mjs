// Renders the PWA and browser icons from the TDH house logo (public/tdh-logo.png) on the site's paper color.
// Run from apps/site after changing the logo: node scripts/generate-icons.mjs
// Uses sharp, which ships with Next.js. The logo is a 768px transparent cutout made by scripts/cutout-logo.mjs, so
// every icon size is rendered down from it, never upscaled.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const LOGO = "public/tdh-logo.png";
const PAPER = "#f4f1ea";

// `scale` is the share of the tile the logo spans. Maskable icons keep the logo inside the central 80% safe zone.
async function icon(size, scale, path, { rounded = false } = {}) {
  const logoSize = Math.round(size * scale);
  const logo = await sharp(LOGO)
    .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const radius = rounded ? Math.round(size * 0.22) : 0;
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" fill="${PAPER}"/></svg>`,
  );
  await sharp(tile)
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path);
}

await mkdir("public/icons", { recursive: true });

// Browser tab icon (Next.js serves src/app/icon.png automatically).
await icon(64, 0.84, "src/app/icon.png", { rounded: true });
// iOS home screen; iOS applies its own corner mask, so the tile is square.
await icon(180, 0.7, "src/app/apple-icon.png");
// Web app manifest icons.
await icon(192, 0.72, "public/icons/icon-192.png", { rounded: true });
await icon(512, 0.72, "public/icons/icon-512.png", { rounded: true });
await icon(512, 0.58, "public/icons/icon-maskable-512.png");

console.log("Icons written.");
