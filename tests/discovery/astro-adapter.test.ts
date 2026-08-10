import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  astroFileRoutePath,
  detectFramework,
  fileRoutePath,
  isAstroPageFile,
} from "../../src/discovery/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(here, "fixtures/astro-sample");

describe("astro adapter – astroFileRoutePath", () => {
  it.each([
    // index / _index → "/"
    ["src/pages/index.astro", "/"],
    ["src/pages/_index.astro", "/"],
    ["pages/index.astro", "/"],
    // plain static routes
    ["src/pages/about.astro", "/about"],
    ["src/pages/contact.md", "/contact"],
    ["pages/about.astro", "/about"],
    // dynamic [param]
    ["src/pages/blog/[slug].astro", "/blog/:slug"],
    ["src/pages/posts/[id]/edit.astro", "/posts/:id/edit"],
    // rest catch-all
    ["src/pages/blog/[...page].astro", "/blog/*page"],
    ["src/pages/account/[...rest].astro", "/account/*rest"],
    // optional catch-all
    ["src/pages/blog/[[...page]].astro", "/blog/*page"],
  ])("maps %s -> %s", (input, expected) => {
    expect(astroFileRoutePath(input)).toBe(expected);
  });

  it.each([
    // Astro partials (leading underscore, not _index) are ignored.
    "src/pages/_components/Header.astro",
    // Reserved filenames
    "src/pages/404.astro",
    "src/pages/500.astro",
    // API endpoints live next to pages in Astro; not page routes.
    "src/pages/api/login.ts",
    // Outside any pages/ directory.
    "src/components/Footer.astro",
    "src/layouts/Base.astro",
    // Unsupported extensions
    "src/pages/foo.css",
    "src/pages/foo.svg",
    "src/pages/route.json",
  ])("ignores %s", (input) => {
    expect(astroFileRoutePath(input)).toBeUndefined();
  });

  it("normalizes Windows-style separators", () => {
    expect(astroFileRoutePath("src\\pages\\about.astro")).toBe("/about");
  });
});

describe("astro adapter – isAstroPageFile", () => {
  it("matches files under pages/ or src/pages/", () => {
    expect(isAstroPageFile("src/pages/index.astro")).toBe(true);
    expect(isAstroPageFile("pages/about.astro")).toBe(true);
    expect(isAstroPageFile("src/components/Footer.astro")).toBe(false);
  });
});

describe("astro adapter – wiring through fileRoutePath", () => {
  it("delegates to astroFileRoutePath when framework is astro", () => {
    expect(fileRoutePath("src/pages/blog/[slug].astro", "astro")).toBe("/blog/:slug");
    expect(fileRoutePath("src/pages/_components/Header.astro", "astro")).toBeUndefined();
  });

  it("does not claim Next or Nuxt conventions for the astro framework", () => {
    // next app/ page convention should NOT fire when framework === "astro".
    expect(fileRoutePath("src/app/about/page.tsx", "astro")).toBeUndefined();
    // nuxt's pages/ _-prefix-as-param convention should NOT fire either.
    expect(fileRoutePath("src/pages/_id.vue", "astro")).toBeUndefined();
  });
});

describe("astro adapter – framework detection", () => {
  it("detects astro from the dependency and config file", async () => {
    const detection = await detectFramework(fixtureRoot);
    expect(detection.framework).toBe("astro");
    expect(detection.confidence).toBeGreaterThan(0.7);
    expect(detection.evidence.some((line) => line.includes("astro@"))).toBe(true);
    expect(detection.evidence.some((line) => line.includes("astro.config"))).toBe(true);
  });
});
