import { describe, expect, it } from 'vitest';
import { errorResult, jsonResult } from '../../src/mcp/protocol.js';

describe('mcp protocol helpers', () => {
  it('jsonResult serializes values as pretty JSON text', () => {
    const result = jsonResult({ a: 1, b: 'two' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({ a: 1, b: 'two' });
  });

  it('jsonResult passes strings through untouched', () => {
    const result = jsonResult('plain text');
    expect(result.content[0].text).toBe('plain text');
  });

  it('errorResult marks the result as an error with the message', () => {
    const result = errorResult(new Error('boom'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('boom');
  });

  it('errorResult stringifies non-Error causes', () => {
    const result = errorResult('string cause');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('string cause');
  });
});
