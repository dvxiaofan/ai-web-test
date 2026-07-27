import type { DiscoveredControl, DiscoveredLink } from './types.js';

export interface RoleFlow {
  role: string;
  flows: string[];
}

/**
 * Keyword → role mapping used to infer which user roles a discovered surface
 * exposes. Kept as data so it is easy to extend and unit-test.
 */
const ROLE_KEYWORDS: Record<string, string[]> = {
  guest: ['home', '首页', 'about', '关于', 'login', '登录', '注册', 'sign up'],
  authenticated: ['dashboard', '仪表盘', 'profile', '个人', 'account', '账户', 'settings', '设置'],
  admin: ['admin', '管理员', 'users', '用户管理', 'billing', '账单', 'config', '配置', '后台'],
  buyer: ['cart', '购物车', 'checkout', '结算', 'order', '订单', 'product', '商品', '收藏'],
};

export function mapFlowsToRoles(flows: { name: string; text: string }[]): RoleFlow[] {
  const byRole = new Map<string, Set<string>>();
  for (const flow of flows) {
    const haystack = `${flow.name} ${flow.text}`.toLowerCase();
    for (const [role, keywords] of Object.entries(ROLE_KEYWORDS)) {
      if (keywords.some((keyword) => haystack.includes(keyword))) {
        if (!byRole.has(role)) byRole.set(role, new Set());
        byRole.get(role)!.add(flow.name);
      }
    }
  }
  return [...byRole.entries()].map(([role, set]) => ({ role, flows: [...set] }));
}

/**
 * Read-only inference of the roles implied by discovered controls and links.
 */
export function inferRolesFromObservation(
  controls: DiscoveredControl[],
  links: DiscoveredLink[],
): string[] {
  const flows = [
    ...controls.map((control) => ({
      name: control.text,
      text: `${control.ariaLabel ?? ''} ${control.title ?? ''} ${control.text}`,
    })),
    ...links.map((link) => ({ name: link.text, text: link.text })),
  ];
  return mapFlowsToRoles(flows).map((roleFlow) => roleFlow.role);
}
