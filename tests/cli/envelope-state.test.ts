import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CliOutput } from '../../src/cli/output.js';

function captureStd() {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  return { out, err, outSpy, errSpy, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('CliOutput envelope state & identity (Phase 1.2)', () => {
  let cap: ReturnType<typeof captureStd>;
  beforeEach(() => {
    cap = captureStd();
  });
  afterEach(() => {
    cap.outSpy.mockRestore();
    cap.errSpy.mockRestore();
  });

  it('includes operationId, state and derived nextActions', () => {
    const out = new CliOutput({ json: true, quiet: false, operationId: 'op_123' });
    out.setContext({ projectId: 'project_x', planId: 'plan_9' });
    out.result({ foo: 'bar' }, 'plan_proposed');
    const env = JSON.parse(cap.stdout());
    expect(env.ok).toBe(true);
    expect(env.operationId).toBe('op_123');
    expect(env.projectId).toBe('project_x');
    expect(env.planId).toBe('plan_9');
    expect(env.state).toBe('plan_proposed');
    expect(env.nextActions).toEqual([
      { action: 'approve', arguments: { planId: 'plan_9' } },
      { action: 'run', arguments: { planId: 'plan_9' } },
    ]);
    expect(env.foo).toEqual('bar');
  });

  it('omits state and nextActions when no state is given', () => {
    const out = new CliOutput({ json: true, quiet: false, operationId: 'op_1' });
    out.result({ foo: 'bar' });
    const env = JSON.parse(cap.stdout());
    expect(env.state).toBeUndefined();
    expect(env.nextActions).toEqual([]);
  });

  it('keeps stdout clean of logs in JSON mode', () => {
    const out = new CliOutput({ json: true, quiet: false, operationId: 'op_1' });
    out.info('working');
    out.result({ x: 1 }, 'discovered');
    expect(cap.stdout()).toContain('"state":"discovered"');
    expect(cap.stderr()).toContain('working');
  });
});
