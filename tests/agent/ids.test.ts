import { describe, it, expect } from 'vitest';
import {
  deriveProjectId,
  generateOperationId,
  idempotencyKey,
  IdempotencyRegistry,
} from '../../src/agent/ids.js';

describe('project/operation ids', () => {
  it('derives a stable project id from target', () => {
    const a = deriveProjectId({ baseUrl: 'http://localhost:3000', rootDir: '/app' });
    const b = deriveProjectId({ baseUrl: 'http://localhost:3000', rootDir: '/app' });
    expect(a).toBe(b);
    expect(a).toMatch(/^project_[0-9a-z]+$/);
  });

  it('varies project id by base url or root dir', () => {
    const a = deriveProjectId({ baseUrl: 'http://localhost:3000', rootDir: '/app' });
    const b = deriveProjectId({ baseUrl: 'http://example.com', rootDir: '/app' });
    const c = deriveProjectId({ baseUrl: 'http://localhost:3000', rootDir: '/other' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('treats missing base url as a distinct seed', () => {
    const a = deriveProjectId({ rootDir: '/app' });
    const b = deriveProjectId({ baseUrl: 'http://localhost:3000', rootDir: '/app' });
    expect(a).not.toBe(b);
  });

  it('generates unique operation ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateOperationId()));
    expect(ids.size).toBe(1000);
    expect([...ids][0]).toMatch(/^op_[0-9a-z]+$/);
  });

  it('builds a stable idempotency key regardless of input order', () => {
    const a = idempotencyKey('ns', { x: 1, y: 2 });
    const b = idempotencyKey('ns', { y: 2, x: 1 });
    expect(a).toBe(b);
    const c = idempotencyKey('ns', { x: 1, y: 3 });
    expect(a).not.toBe(c);
    expect(a.startsWith('ns:')).toBe(true);
  });

  it('registers and dedupes operations by idempotency key', () => {
    const reg = new IdempotencyRegistry(1000);
    const op1 = reg.record('k', 'op_1');
    expect(op1).toBe('op_1');
    const op2 = reg.record('k', 'op_2');
    expect(op2).toBe('op_1');
  });

  it('expires idempotency entries after ttl', () => {
    const reg = new IdempotencyRegistry(-1);
    reg.record('k', 'op_1');
    expect(reg.get('k')).toBeUndefined();
  });
});
