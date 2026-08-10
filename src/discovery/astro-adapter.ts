/**
 * Astro framework adapter.
 *
 * Astro routes are file-system based under `src/pages/` (or `pages/` at the
 * project root) with the following conventions:
 *
 *   src/pages/index.astro              -> "/"
 *   src/pages/_index.astro             -> "/"           (directory index)
 *   src/pages/about.astro              -> "/about"
 *   src/pages/blog/[slug].astro        -> "/blog/:slug"
 *   src/pages/blog/[...page].astro     -> "/blog/*page"  (rest / catch-all)
 *   src/pages/blog/[[...page]].astro   -> "/blog/*page"  (optional catch-all)
 *   src/pages/_components/Header.astro -> (ignored; leading underscore)
 *   src/pages/404.astro                -> (ignored)
 *
 * Supported extensions: .astro, .md, .mdx, .ts, .tsx, .js, .jsx. Everything
 * else (including frontmatter and route config exports) is left for the
 * generic AST pass.
 */

const ASTRO_PAGE_EXTENSIONS = ["astro", "md", "mdx", "ts", "tsx", "js", "jsx"] as const;
const ASTRO_IGNORED_BASENAMES = new Set(["404", "500", "sitemap", "robots"]);
const ASTRO_PARTIAL_PREFIX = "_";

/**
 * Convert an Astro page file path (relative to the project root) into a
 * route path. Returns undefined when the file is not a routable page.
 *
 * The output uses the same `:param` / `*rest` shape used by Next/React Router
 * so downstream layers (planner, runner) do not need framework-aware logic.
 */
export function astroFileRoutePath(relativePath: string): string | undefined {
  const normalized = relativePath.replaceAll("\\", "/");
  const pagesMatch = /^(?:src\/)?pages\/(.+)\.([^.]+)$/.exec(normalized);
  if (pagesMatch === null) return undefined;

  const inner = pagesMatch[1] ?? "";
  const extension = pagesMatch[2] ?? "";

  if (!ASTRO_PAGE_EXTENSIONS.includes(extension as (typeof ASTRO_PAGE_EXTENSIONS)[number])) {
    return undefined;
  }

  const rawSegments = inner.split("/").filter((segment) => segment.length > 0);
  if (rawSegments.length === 0) return undefined;

  // The top-level `pages/api/` directory is Astro's API-endpoint convention
  // (see `src/discovery/apis.ts`); those files are not page routes.
  if (rawSegments[0] === "api") return undefined;

  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (segment === "_index" || segment === "index") {
      continue;
    }
    if (segment.startsWith(ASTRO_PARTIAL_PREFIX) && segment !== "_index") {
      return undefined;
    }
    if (ASTRO_IGNORED_BASENAMES.has(segment)) {
      return undefined;
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return "/";
  }

  return convertAstroSegments(segments);
}

function convertAstroSegments(segments: string[]): string {
  const converted: string[] = [];
  for (const segment of segments) {
    if (/^\[\[\.\.\.(.+)\]\]$/.test(segment)) {
      converted.push(`*${segment.slice(5, -2)}`);
    } else if (/^\[\.\.\.(.+)\]$/.test(segment)) {
      converted.push(`*${segment.slice(4, -1)}`);
    } else if (/^\[(.+)\]$/.test(segment)) {
      converted.push(`:${segment.slice(1, -1)}`);
    } else {
      converted.push(segment);
    }
  }
  return normalizeRoutePath(`/${converted.join("/")}`);
}

function normalizeRoutePath(value: string): string {
  const normalized = `/${value}`.replace(/\/{2,}/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

/** True when the file lives under a `pages/` directory recognised by Astro. */
export function isAstroPageFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return /^(?:src\/)?pages\//.test(normalized);
}
