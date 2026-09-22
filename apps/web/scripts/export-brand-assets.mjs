import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Reuse Next's installed image encoder; this script performs no creative editing.
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const sharp = nextRequire("sharp");
const master = new URL("../public/brand/stockpilot-logo-master.png", import.meta.url);
const png = (size) => sharp(fileURLToPath(master))
  .resize(size, size, { fit: "contain" }).ensureAlpha().png().toBuffer();

for (const [size, path] of [
  [128, "public/brand/stockpilot-mark.png"],
  [192, "public/brand/icon-192.png"],
  [512, "public/brand/icon-512.png"],
  [48, "app/icon.png"],
  [180, "app/apple-icon.png"],
]) {
  await writeFile(new URL(`../${path}`, import.meta.url), await png(size));
}

// ICO directory with three embedded PNG frames, for native browser tab sizes.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(png));
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(new URL("../app/favicon.ico", import.meta.url), Buffer.concat([directory, ...frames]));
console.log("Exported StockPilot brand mark, favicon, Apple icon, and app icons.");
