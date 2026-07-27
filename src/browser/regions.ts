/**
 * Phase 2.3 — page region classification (pure, no browser required).
 *
 * Region inference combines explicit ARIA/role signals with positional
 * heuristics relative to the viewport. The pure function is fully unit-testable
 * and is used by the read-only explorer to tag discovered controls and links.
 */

export type PageRegion =
  | 'header'
  | 'sidebar'
  | 'main'
  | 'menu'
  | 'tab'
  | 'dialog'
  | 'drawer'
  | 'table'
  | 'unknown';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionInput extends Rect {
  role?: string;
  ariaLabel?: string;
  tagName?: string;
  text?: string;
  viewport?: { width: number; height: number };
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

export function classifyRegion(input: RegionInput): PageRegion {
  const haystack = [input.role, input.ariaLabel, input.text]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  if (
    input.role === 'menu' ||
    input.role === 'menubar' ||
    haystack.includes('menu') ||
    haystack.includes('menubar') ||
    haystack.includes('导航') ||
    haystack.includes('菜单') ||
    haystack.includes('nav')
  ) {
    return 'menu';
  }
  if (
    input.role === 'dialog' ||
    input.role === 'alertdialog' ||
    haystack.includes('dialog') ||
    haystack.includes('模态') ||
    haystack.includes('弹窗') ||
    haystack.includes('对话框')
  ) {
    return 'dialog';
  }
  if (
    input.role === 'tab' ||
    input.role === 'tablist' ||
    haystack.includes('tab') ||
    haystack.includes('选项卡') ||
    haystack.includes('标签')
  ) {
    return 'tab';
  }
  if (
    input.role === 'table' ||
    input.tagName === 'table' ||
    haystack.includes('table') ||
    haystack.includes('表格') ||
    haystack.includes('列表数据')
  ) {
    return 'table';
  }

  const viewport = input.viewport ?? DEFAULT_VIEWPORT;
  const top = input.y;
  const left = input.x;
  const right = input.x + input.width;
  const bottom = input.y + input.height;

  if (top <= viewport.height * 0.15 && input.width >= viewport.width * 0.5) {
    return 'header';
  }
  if (left <= viewport.width * 0.2 && input.height >= viewport.height * 0.4) {
    return 'sidebar';
  }
  if (right >= viewport.width * 0.8 && input.height >= viewport.height * 0.4) {
    return 'drawer';
  }
  if (top > viewport.height * 0.15 && bottom < viewport.height * 0.95) {
    return 'main';
  }
  return 'unknown';
}
