import { describe, it, expect } from 'vitest';
import { classifyRegion } from '../../src/browser/regions.js';

const viewport = { width: 1440, height: 900 };

describe('classifyRegion', () => {
  it('detects menus by role and label', () => {
    expect(classifyRegion({ x: 0, y: 0, width: 0, height: 0, role: 'menu' })).toBe('menu');
    expect(classifyRegion({ x: 0, y: 0, width: 0, height: 0, ariaLabel: '主导航菜单' })).toBe('menu');
  });

  it('detects dialogs', () => {
    expect(classifyRegion({ x: 0, y: 0, width: 0, height: 0, role: 'dialog' })).toBe('dialog');
    expect(classifyRegion({ x: 0, y: 0, width: 0, height: 0, text: '确认对话框' })).toBe('dialog');
  });

  it('detects tabs and tables', () => {
    expect(classifyRegion({ x: 0, y: 0, width: 0, height: 0, role: 'tablist' })).toBe('tab');
    expect(classifyRegion({ x: 0, y: 0, width: 0, height: 0, tagName: 'table' })).toBe('table');
  });

  it('detects header by position', () => {
    expect(classifyRegion({ x: 0, y: 0, width: 1440, height: 80, viewport })).toBe('header');
  });

  it('detects sidebar by left position', () => {
    expect(classifyRegion({ x: 0, y: 80, width: 240, height: 800, viewport })).toBe('sidebar');
  });

  it('detects drawer by right position', () => {
    expect(classifyRegion({ x: 1200, y: 0, width: 240, height: 800, viewport })).toBe('drawer');
  });

  it('falls back to main or unknown when unclassified', () => {
    expect(classifyRegion({ x: 300, y: 300, width: 800, height: 400, viewport })).toBe('main');
    expect(classifyRegion({ x: 0, y: 0, width: 0, height: 0 })).toBe('unknown');
  });
});
