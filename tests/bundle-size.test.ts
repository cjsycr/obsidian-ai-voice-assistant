/**
 * Bundle-size guard rails
 * -----------------------
 * Ensure production bundles don't silently balloon.
 * Thresholds are set generously (~50% headroom over current size) so normal
 * feature work does not bump them; only large regressions or accidental
 * dependency inclusions should trigger a failure.
 *
 * If a feature legitimately requires more room, INTENTIONALLY bump the
 * threshold in the same PR that grows the bundle, and update README.md
 * "Bundle size budget" section.
 *
 * Current baseline (v0.6.0 / 2026-07-20):
 *   main.js    ≈ 136 KB   → limit 160 KB   (+24 KB / ~17% headroom)
 *   styles.css ≈ 54 KB    → limit 80 KB    (+26 KB / ~48% headroom)
 */
import { describe, it, expect } from "vitest";
import { statSync, existsSync } from "fs";
import { resolve } from "path";

const MAX_MAIN_JS_KB = 160;      // hard ceiling for main.js
const MAX_STYLES_CSS_KB = 80;    // hard ceiling for styles.css

function kb(bytes: number): number {
  return Math.round((bytes / 1024) * 10) / 10;
}

describe("bundle size guard", () => {
  it(`main.js must be ≤ ${MAX_MAIN_JS_KB} KB (see README > 打包体积上限)`, () => {
    const p = resolve("main.js");
    if (!existsSync(p)) {
      // pre-build test: skip gracefully rather than fail
      console.warn("[bundle-size] main.js not built; skipping. Run `npm run build` first.");
      return;
    }
    const size = kb(statSync(p).size);
    console.log(`[bundle-size] main.js = ${size} KB   (limit ${MAX_MAIN_JS_KB} KB)`);
    expect(size).toBeLessThanOrEqual(MAX_MAIN_JS_KB);
  });

  it(`styles.css must be ≤ ${MAX_STYLES_CSS_KB} KB (see README > 打包体积上限)`, () => {
    const p = resolve("styles.css");
    if (!existsSync(p)) {
      console.warn("[bundle-size] styles.css not built; skipping. Run `npm run build` first.");
      return;
    }
    const size = kb(statSync(p).size);
    console.log(`[bundle-size] styles.css = ${size} KB   (limit ${MAX_STYLES_CSS_KB} KB)`);
    expect(size).toBeLessThanOrEqual(MAX_STYLES_CSS_KB);
  });
});
