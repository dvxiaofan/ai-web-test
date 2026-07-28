import type { JsonValue } from '../core/index.js';

export type AssertionComparator = 'equals' | 'contains' | 'matches' | 'greater-than' | 'less-than';

/**
 * Single source of truth for assertion comparison. Both the generated DSL
 * scenarios and adapted Controlled Specs execute through `executePlan`, which
 * calls this function, so their assertion semantics are guaranteed identical
 * (Phase 5B acceptance: unified Run Result).
 */
export function compareValues(
  actual: JsonValue,
  expected: JsonValue | undefined,
  comparator: AssertionComparator,
): boolean {
  switch (comparator) {
    case 'equals':
      return JSON.stringify(actual) === JSON.stringify(expected);
    case 'contains':
      return String(actual).includes(String(expected ?? ''));
    case 'matches':
      return new RegExp(String(expected ?? '')).test(String(actual));
    case 'greater-than':
      return Number(actual) > Number(expected);
    case 'less-than':
      return Number(actual) < Number(expected);
  }
}

/** Human-readable label for a comparator, used in failure messages. */
export function describeComparator(comparator: AssertionComparator): string {
  switch (comparator) {
    case 'equals':
      return 'equals';
    case 'contains':
      return 'contains';
    case 'matches':
      return 'matches';
    case 'greater-than':
      return 'greater than';
    case 'less-than':
      return 'less than';
  }
}
