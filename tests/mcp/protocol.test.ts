import { describe, expect, it } from 'vitest';
import { errorResult, jsonResult } from '../../src/mcp/protocol.js';

/**
 * Narrow one content block to its text.
 *
 * MCP content is a union (text / image / resource / …), so `.text` is only
 * available after narrowing. Asserting here keeps the expectations below about
 * the payload rather than about type plumbing, and fails loudly if a helper
 * ever starts emitting a non-text block.
 */
function textOf(result: { content: Array<{ type: string }> }, index = 0): string {
  const block = result.content[index];
  expect(block).toBeDefined();
  expect(block!.type).toBe('text');
  return (block as { type: 'text'; text: string }).text;
}

describe('mcp protocol helpers', () => {
  it('jsonResult serializes values as pretty JSON text', () => {
    const result = jsonResult({ a: 1, b: 'two' });
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(textOf(result))).toEqual({ a: 1, b: 'two' });
  });

  it('jsonResult passes strings through untouched', () => {
    const result = jsonResult('plain text');
    expect(textOf(result)).toBe('plain text');
  });

  it('errorResult marks the result as an error with the message', () => {
    const result = errorResult(new Error('boom'));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('boom');
  });

  it('errorResult stringifies non-Error causes', () => {
    const result = errorResult('string cause');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('string cause');
  });
});
