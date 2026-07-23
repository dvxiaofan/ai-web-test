import { describe, expect, it } from 'vitest';

import { runResultExitCode } from '../../src/cli.js';

describe('CLI run exit status', () => {
  it('keeps JSON output independent from shell failure status', () => {
    expect(runResultExitCode('passed')).toBe(0);
    expect(runResultExitCode('failed')).toBe(1);
    expect(runResultExitCode('blocked')).toBe(1);
    expect(runResultExitCode('error')).toBe(1);
    expect(runResultExitCode('cancelled')).toBe(1);
  });
});
