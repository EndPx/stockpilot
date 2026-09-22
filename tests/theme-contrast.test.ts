import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../apps/web/app/globals.css", import.meta.url), "utf8");
function token(name: string) {
  const value = css.match(new RegExp(`--${name}: (#[a-f0-9]{6});`))?.[1];
  assert.ok(value, `Missing ${name}`);
  return value;
}
function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(foreground: string, background: string) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("dark-theme text tokens retain AA normal-text contrast on operational surfaces", () => {
  for (const background of ["canvas", "surface", "canvas-raised", "accent-pale"]) {
    for (const foreground of ["ink", "muted", "faint", "accent-text", "danger", "success"]) {
      assert.ok(contrast(token(foreground), token(background)) >= 4.5, `${foreground} on ${background}`);
    }
  }
});

test("CTA labels and input/focus boundaries meet contrast thresholds", () => {
  for (const background of ["accent", "accent-hover"]) {
    assert.ok(contrast("#ffffff", token(background)) >= 4.5, `white on ${background}`);
  }
  assert.ok(contrast(token("line-strong"), token("surface")) >= 3);
  assert.ok(contrast(token("accent-text"), token("surface")) >= 3);
});
