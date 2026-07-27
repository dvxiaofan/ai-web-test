import type { Page } from 'playwright';
import type { DiscoveredControl, DiscoveredLink } from './types.js';
import { classifyRegion, type PageRegion } from './regions.js';

export interface MenuCandidate {
  label: string;
  region: PageRegion;
  source: 'control' | 'link';
}

const MENU_KEYWORDS = ['menu', 'menubar', 'navigation', 'nav', '导航', '菜单', '菜单栏'];

export function isMenuLike(text: string | undefined, role: string | undefined): boolean {
  if (role === 'menu' || role === 'menubar') return true;
  const haystack = [role, text].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
  return MENU_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * Statically infer menu candidates from already-discovered controls and links.
 * This is read-only and needs no browser interaction.
 */
export function findMenuCandidates(
  controls: DiscoveredControl[],
  links: DiscoveredLink[],
): MenuCandidate[] {
  const out: MenuCandidate[] = [];
  for (const control of controls) {
    const label = control.ariaLabel ?? control.title ?? control.text;
    if (isMenuLike(label, control.type)) {
      out.push({ label, region: 'menu', source: 'control' });
    }
  }
  for (const link of links) {
    if (isMenuLike(link.text, undefined)) {
      out.push({ label: link.text, region: 'menu', source: 'link' });
    }
  }
  const seen = new Set<string>();
  return out.filter((candidate) => (seen.has(candidate.label) ? false : (seen.add(candidate.label), true)));
}

/**
 * Read-only in-page enumeration of navigational menu containers. It never
 * clicks or mutates the page; it only reads ARIA/menu markup.
 */
export async function exploreMenus(page: Page): Promise<MenuCandidate[]> {
  const raw = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="menu"],[role="menubar"],nav,[aria-label*="menu" i],[aria-label*="导航" i],[aria-label*="菜单" i]',
      ),
    );
    return nodes
      .map((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '').slice(0, 200))
      .filter((label) => label.length > 0)
      .slice(0, 200);
  });
  return raw.map((label) => ({ label, region: classifyRegion({ x: 0, y: 0, width: 0, height: 0, ariaLabel: label }), source: 'control' }));
}
