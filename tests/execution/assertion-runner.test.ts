import { describe, expect, it } from 'vitest';
import { compareValues, describeComparator } from '../../src/execution/assertion-runner.js';

describe('compareValues', () => {
  it('equals compares deep JSON equality', () => {
    expect(compareValues({ a: 1 }, { a: 1 }, 'equals')).toBe(true);
    expect(compareValues('x', 'y', 'equals')).toBe(false);
  });

  it('contains checks substring', () => {
    expect(compareValues('hello world', 'world', 'contains')).toBe(true);
    expect(compareValues('hello', 'world', 'contains')).toBe(false);
  });

  it('matches applies a regex', () => {
    expect(compareValues('abc123', '\\d+', 'matches')).toBe(true);
    expect(compareValues('abc', '\\d+', 'matches')).toBe(false);
  });

  it('greater-than / less-than compare numerically', () => {
    expect(compareValues(5, 3, 'greater-than')).toBe(true);
    expect(compareValues(2, 3, 'less-than')).toBe(true);
    expect(compareValues(3, 3, 'greater-than')).toBe(false);
  });

  it('handles undefined expected for contains/matches', () => {
    expect(compareValues('abc', undefined, 'contains')).toBe(true);
    expect(compareValues('abc', undefined, 'matches')).toBe(true);
  });
});

describe('describeComparator', () => {
  it('produces readable labels', () => {
    expect(describeComparator('greater-than')).toBe('greater than');
    expect(describeComparator('equals')).toBe('equals');
  });
});
