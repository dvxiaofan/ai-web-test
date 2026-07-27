import { describe, it, expect } from 'vitest';
import { mapFlowsToRoles, inferRolesFromObservation } from '../../src/browser/role-explorer.js';
import type { DiscoveredControl, DiscoveredLink } from '../../src/browser/types.js';

describe('mapFlowsToRoles', () => {
  it('maps keywords to roles', () => {
    const roles = mapFlowsToRoles([
      { name: '登录', text: 'login button' },
      { name: '仪表盘', text: 'dashboard link' },
      { name: '后台用户', text: 'admin users' },
    ]);
    const byRole = Object.fromEntries(roles.map((r) => [r.role, r.flows]));
    expect(byRole.guest).toContain('登录');
    expect(byRole.authenticated).toContain('仪表盘');
    expect(byRole.admin).toContain('后台用户');
  });

  it('returns nothing when no keyword matches', () => {
    expect(mapFlowsToRoles([{ name: 'x', text: 'zzz' }])).toEqual([]);
  });
});

describe('inferRolesFromObservation', () => {
  const controls: DiscoveredControl[] = [
    { tagName: 'button', text: '登录', risk: 'read', riskReason: '' },
    { tagName: 'a', text: '购物车', risk: 'read', riskReason: '' },
  ];
  const links: DiscoveredLink[] = [
    { text: '仪表盘', url: '/dashboard', risk: 'read', riskReason: '', followed: false },
    { text: '无关链接', url: '/x', risk: 'read', riskReason: '', followed: false },
  ];

  it('infers roles from discovered controls and links', () => {
    const roles = inferRolesFromObservation(controls, links);
    expect(roles).toContain('guest');
    expect(roles).toContain('authenticated');
    expect(roles).toContain('buyer');
    expect(roles).not.toContain('admin');
  });
});
