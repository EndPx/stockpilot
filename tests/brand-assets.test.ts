import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function dimensions(png: Buffer) {
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test("generated brand PNGs have the intended native sizes", () => {
  for (const [path, size] of [
    ["public/brand/stockpilot-logo-master.png", 1254],
    ["public/brand/stockpilot-mark.png", 128],
    ["public/brand/icon-192.png", 192],
    ["public/brand/icon-512.png", 512],
    ["app/icon.png", 48],
    ["app/apple-icon.png", 180],
  ] as const) {
    assert.deepEqual(dimensions(readFileSync(new URL(`../apps/web/${path}`, import.meta.url))), [size, size]);
  }
});

test("favicon contains complete 16, 32 and 48px PNG frames", () => {
  const ico = readFileSync(new URL("../apps/web/app/favicon.ico", import.meta.url));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  let offset = 54;
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], size);
    assert.equal(ico[entry + 1], size);
    assert.equal(ico.readUInt32LE(entry + 12), offset);
    const length = ico.readUInt32LE(entry + 8);
    const frame = ico.subarray(offset, offset + length);
    assert.equal(frame.length, length);
    assert.deepEqual(dimensions(frame), [size, size]);
    assert.equal(frame[25], 6, "ICO PNGs must use RGBA for Next's image decoder");
    offset += length;
  }
  assert.equal(offset, ico.length);
});
