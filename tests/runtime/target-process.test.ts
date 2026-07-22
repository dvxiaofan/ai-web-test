import { describe, expect, it } from 'vitest';

import { startTargetProcess } from '../../src/runtime/target-process.js';

describe('target process lifecycle', () => {
  it('does not start anything when no-start is requested', async () => {
    const handle = await startTargetProcess({
      baseUrl: 'http://127.0.0.1:9',
      startCommand: 'this-command-must-not-run',
      workingDirectory: process.cwd(),
      outputDir: process.cwd(),
      noStart: true,
    });
    expect(handle.started).toBe(false);
    expect(handle.reusedExisting).toBe(false);
    await handle.close();
  });
});
