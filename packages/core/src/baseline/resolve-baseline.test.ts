import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { BuildStatus } from '../contracts/build.js';
import { baselineResolutionCases } from './baseline-resolution-cases.js';
import { baselineShaOrder, resolveBaseline, type BaselineCandidate } from './resolve-baseline.js';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);

describe('baselineShaOrder', () => {
  it('puts the merge base first, then the ancestors in order', () => {
    expect(baselineShaOrder(a, [b, c])).toEqual([a, b, c]);
  });

  it('drops duplicates, keeping the first position', () => {
    expect(baselineShaOrder(a, [a, b, b, c, a])).toEqual([a, b, c]);
  });

  it('is empty without a merge base', () => {
    expect(baselineShaOrder(null, [b, c])).toEqual([]);
  });
});

describe('resolveBaseline', () => {
  it.each(baselineResolutionCases)('$name', (testCase) => {
    const order = baselineShaOrder(testCase.mergeBaseSha, testCase.ancestors);

    expect(resolveBaseline(order, testCase.candidates)?.id ?? null).toBe(testCase.expectedBuildId);
  });

  it('returns the candidate object itself, with any extra fields', () => {
    const candidate = {
      id: 'b1',
      sha: a,
      status: 'passed',
      createdAt: '2026-11-01T00:00:00.000Z',
      number: 7,
    } as const;

    expect(resolveBaseline([a], [candidate])).toBe(candidate);
  });
});

const shaArb = fc.constantFrom(a, b, c, 'd'.repeat(40), 'e'.repeat(40));
const candidateArb: fc.Arbitrary<BaselineCandidate> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 4 }),
  sha: shaArb,
  status: fc.constantFrom(...BuildStatus.options),
  createdAt: fc
    .integer({ min: 0, max: 10 })
    .map((day) => new Date(Date.UTC(2026, 10, 1 + day)).toISOString()),
});
const successful = (candidate: BaselineCandidate): boolean =>
  candidate.status === 'passed' || candidate.status === 'accepted';

describe('resolveBaseline properties', () => {
  it('returns null or a successful candidate on the earliest sha that has one', () => {
    fc.assert(
      fc.property(
        fc.array(shaArb, { maxLength: 6 }),
        fc.array(candidateArb, { maxLength: 12 }),
        (order, candidates) => {
          const chosen = resolveBaseline(order, candidates);
          const firstWithSuccess = order.find((sha) =>
            candidates.some((x) => x.sha === sha && successful(x)),
          );
          // Searched shas: those before the chosen one, or the whole order when none was chosen.
          const searched = chosen === null ? order : order.slice(0, order.indexOf(chosen.sha));

          expect(chosen?.sha).toBe(firstWithSuccess);
          expect(chosen === null || (candidates.includes(chosen) && successful(chosen))).toBe(true);
          expect(candidates.some((x) => searched.includes(x.sha) && successful(x))).toBe(false);
        },
      ),
    );
  });
});
