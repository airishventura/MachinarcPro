import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { BRAND_ARC_PATH, BRAND_COLORS, BRAND_MACHINE_PATH } from "../src/lib/brand";

const root = path.resolve(__dirname, "../public");
const brand = path.join(root, "brand");
const { ink, ivory, amber } = BRAND_COLORS;
const mark = (color = ivory, accent = amber) => `<path d="${BRAND_MACHINE_PATH}" fill="${color}"/><path d="${BRAND_ARC_PATH}" fill="${accent}"/>`;
// Preserve the existing custom vector lettering; exports require no installed font.
const letters = ["M0 10V0L3.5 5L7 0V10", "M10 10L13.5 0L17 10M11.1 7H15.9", "M27 1L26 0H22L20 2V8L22 10H26L27 9", "M30 0V10M37 0V10M30 5H37", "M41 0H46M43.5 0V10M41 10H46", "M50 10V0L57 10V0", "M60 10L63.5 0L67 10M61.1 7H65.9", "M70 10V0H75L77 2V4L75 6H70M74 6L77 10", "M87 1L86 0H82L80 2V8L82 10H86L87 9"];
const lockup = (color = ivory, accent = amber) => `${mark(color, accent)}<g transform="translate(46 8) scale(1.6)" fill="none" stroke="${color}" stroke-width="1" stroke-linejoin="miter" stroke-linecap="square">${letters.map(d => `<path d="${d}"/>`).join("")}</g>`;
const svg = (w: number, h: number, content: string, title: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title"><title id="title">${title}</title>${content}</svg>\n`;
const icon = svg(32, 32, `<rect width="32" height="32" rx="6" fill="${ink}"/>${mark()}`, "MachinArc");
async function main() {
  await mkdir(brand, { recursive: true });
  await writeFile(path.join(root, "icon.svg"), icon);
  for (const [suffix, color, accent] of [["", ivory, amber], ["-light", ink, ink], ["-mono", ivory, ivory]] as const) {
    await writeFile(path.join(brand, `machinarc-mark${suffix}.svg`), svg(32, 32, mark(color, accent), "MachinArc symbol"));
    await writeFile(path.join(brand, `machinarc-logo${suffix}.svg`), svg(200, 32, lockup(color, accent), "MachinArc"));
  }
  const pngs: Buffer[] = [];
  for (const size of [16, 32, 48]) {
    const png = await sharp(Buffer.from(icon)).resize(size, size).png().toBuffer();
    pngs.push(png);
    if (size !== 48) await writeFile(path.join(root, `favicon-${size}.png`), png);
  }
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = [16, 32, 48][index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await writeFile(path.join(root, "favicon.ico"), Buffer.concat([header, ...pngs]));
  const touch = svg(180, 180, `<rect width="180" height="180" fill="${ink}"/><g transform="translate(26 26) scale(4)">${mark()}</g>`, "MachinArc app icon");
  await sharp(Buffer.from(touch)).png().toFile(path.join(root, "apple-touch-icon.png"));

  const text = (x: number, y: number, value: string, size = 16, color = ivory) => `<text x="${x}" y="${y}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}">${value}</text>`;
  const board = svg(1200, 850, `
  <rect width="1200" height="850" fill="${ink}"/>
  ${text(56, 56, "MACHINARC / IDENTITY SYSTEM", 14, amber)}
  ${text(56, 107, "A machine. An arc. A deliberate direction.", 32)}
  ${text(56, 145, "Precision for the people building and operating accountable AI Machines.", 18, "#8d908e")}
  <g transform="translate(62 207) scale(5.4)">${lockup()}</g>
  <path d="M56 423H1144" stroke="#252726"/>
  <rect x="56" y="455" width="344" height="210" rx="8" fill="${ivory}"/>
  ${text(78, 487, "LIGHT / SINGLE INK", 12, ink)}
  <g transform="translate(193 510) scale(2.2)">${mark(ink, ink)}</g>
  <rect x="428" y="455" width="344" height="210" rx="8" fill="#191a1a"/>
  ${text(450, 487, "DARK / MONOCHROME", 12, "#8d908e")}
  <g transform="translate(565 510) scale(2.2)">${mark(ivory, ivory)}</g>
  <rect x="800" y="455" width="344" height="210" rx="8" fill="#151616"/>
  ${text(822, 487, "MICRO / ACTUAL PIXEL SIZES", 12, "#8d908e")}
  ${[16, 24, 32, 48].map((size, i) => `<g transform="translate(${841 + i * 72} ${566 - size / 2}) scale(${size / 32})">${mark()}</g>${text(837 + i * 72, 620, `${size}px`, 12, "#8d908e")}`).join("")}
  ${text(56, 718, "GROUNDED M", 13, amber)}
  ${text(56, 747, "Weight, structure, operator control.", 17)}
  ${text(428, 718, "OPEN ARC", 13, amber)}
  ${text(428, 747, "Work moving through a defined system.", 17)}
  ${text(800, 718, "ONE SILHOUETTE", 13, amber)}
  ${text(800, 747, "Recognizable without effects or color.", 17)}
  ${text(56, 809, "IVORY  #F1EFEA     /     AMBER  #D9C9A8     /     INK  #090909", 12, "#8d908e")}
  `, "MachinArc logo design presentation: primary, light, monochrome and small-size applications");
  await writeFile(path.join(brand, "identity-preview.svg"), board);
  await sharp(Buffer.from(board)).png().toFile(path.join(brand, "identity-preview.png"));
  console.log("Generated MachinArc SVG system, app icons, and identity preview.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
