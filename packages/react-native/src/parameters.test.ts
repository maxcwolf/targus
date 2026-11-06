import { maxStoryDelayMs, StoryParameters, storyParametersEvent } from '@targus/core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { TargusParameters } from './parameters.ts';
import { storyParametersEvent as decoratorEvent } from './with-targus.ts';

// The app-side package does not depend on core at run time; these tests keep its copy of the
// wire contract (ADR 0022) equal to core's.
describe('TargusParameters', () => {
  it('is exactly the shape of core’s StoryParameters schema, with the bounds it documents', () => {
    expectTypeOf<TargusParameters>().toEqualTypeOf<Readonly<StoryParameters>>();

    expect(maxStoryDelayMs).toBe(10_000);
    const valid: TargusParameters = { delay: maxStoryDelayMs, skip: true };
    expect(StoryParameters.safeParse(valid).success).toBe(true);
    expect(StoryParameters.safeParse({ delay: maxStoryDelayMs + 1 }).success).toBe(false);
  });
});

describe('storyParametersEvent', () => {
  it('is the event name the CLI listens for', () => {
    expect(decoratorEvent).toBe(storyParametersEvent);
  });
});
