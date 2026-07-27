import { describe, it, expect } from 'vitest';
import { findMenuCandidates, isMenuLike } from '../../src/browser/menu-explorer.js';
import type { DiscoveredControl, DiscoveredLink } from '../../src/browser/types.js';

describe('isMenuLike', () => {
  it('matches menu roles', () => {
    expect(isMenuLike(undefined, 'menu')).toBe(true);
    expect(isMenuLike(undefined, 'menubar')).toBe(true);
  });
  it('matches menu keywords in text', () => {
    expect(isMenuLike('用户导航菜单', undefined)).toBe(true);
    expect(isMenuLike('Home', undefined)).toBe(false);
  });
});

describe('findMenuCandidates', () => {
  const controls: DiscoveredControl[] = [
    { tagName: 'nav', text: '主导航', risk: 'read', riskReason: '' },
    { tagName: 'button', text: '提交', risk: 'read', riskReason: '' },
  ];
  const links: DiscoveredLink[] = [
    { text: '侧边菜单', url: '/menu', risk: 'read', riskReason: '', followed: false },
    { text: '登录', url: '/login', risk: 'read', riskReason: '', followed: false },
  ];

  it('collects menu-like controls and links', () => {
    const menus = findMenuCandidates(controls, links);
    const labels = menus.map((m) => m.label);
    expect(labels).toContain('主导航');
    expect(labels).toContain('侧边菜单');
    expect(labels).not.toContain('提交');
    expect(labels).not.toContain('登录');
  });

  it('dedupes by label and tags source', () => {
    const menus = findMenuCandidates(controls, links);
    expect(menus.filter((m) => m.label === '主导航')).toHaveLength(1);
    for (const menu of menus) expect(menu.region).toBe('menu');
  });
});
