import {
  createElement,
  useEffect,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';

import { TargusErrorBoundary, type StoryErrorReport } from './error-boundary.ts';

/** Channel event the CLI listens for to record a story as an error (ADR 0008). */
export const storyErrorEvent = 'targus/storyError';

/**
 * Channel event the decorator emits once a story has committed, carrying its raw
 * `parameters.targus` for the CLI to validate and apply (ADR 0022).
 */
export const storyParametersEvent = 'targus/storyParameters';

/**
 * The `targus/storyParameters` payload. `targus` is forwarded as the story set it, and left out
 * when the story sets none: Storybook's channel serialises with telejson, which would send an
 * `undefined` value as the string `_undefined_`.
 */
export interface StoryParametersReport {
  readonly storyId: string;
  readonly targus?: unknown;
}

/** Sends one event to the CLI over the Storybook channel. */
export interface TargusEmit {
  (event: typeof storyErrorEvent, report: StoryErrorReport): void;
  (event: typeof storyParametersEvent, report: StoryParametersReport): void;
}

/** The part of Storybook's decorator context the decorator reads. */
export interface TargusStoryContext {
  readonly id: string;
  /** The story's merged Storybook parameters; the decorator reads `parameters.targus`. */
  readonly parameters?: unknown;
}

interface ParametersReporterProps {
  readonly storyId: string;
  readonly targus: unknown;
  readonly emit: TargusEmit;
  readonly children: ReactNode;
}

/**
 * Reports the story's parameters after it commits. Storybook RN emits `storyRendered` before
 * React renders the story, so this effect is the first signal that the story is on screen. A
 * child's render error is reported in the commit phase, before this passive effect runs.
 */
function ParametersReporter({ storyId, targus, emit, children }: ParametersReporterProps) {
  useEffect(() => {
    emit(storyParametersEvent, targus === undefined ? { storyId } : { storyId, targus });
  }, [emit, storyId, targus]);
  return children;
}

function targusOf(parameters: unknown): unknown {
  if (typeof parameters !== 'object' || parameters === null) return undefined;
  return Reflect.get(parameters, 'targus');
}

/** A Storybook decorator: `decorators: [withTargus]` in `.rnstorybook/preview.tsx`. */
export type TargusDecorator = (Story: ComponentType, context: TargusStoryContext) => ReactElement;

export interface WithTargusOptions {
  readonly emit: TargusEmit;
}

/**
 * Build the decorator around an `emit` function. It wraps each story in `TargusErrorBoundary`,
 * reports render errors as `targus/storyError`, and reports `parameters.targus` as
 * `targus/storyParameters` once the story commits. Reduced motion and the locked date land with
 * plan.md section 7.
 */
export function createWithTargus({ emit }: WithTargusOptions): TargusDecorator {
  return (Story, context) =>
    createElement(ParametersReporter, {
      storyId: context.id,
      targus: targusOf(context.parameters),
      emit,
      children: createElement(TargusErrorBoundary, {
        storyId: context.id,
        report: (report) => {
          emit(storyErrorEvent, report);
        },
        children: createElement(Story),
      }),
    });
}

/** The subset of a Storybook channel the decorator uses. */
export interface TargusChannel {
  emit(event: string, ...args: unknown[]): void;
}

/** Returns the live Storybook channel, or `undefined` when Storybook is not running. */
export type ChannelResolver = () => TargusChannel | undefined;

/**
 * The store behind `addons` from `storybook/internal/preview-api`. Storybook keeps that singleton
 * on `globalThis` under this key, and `addons.getChannel()` returns the websocket channel once
 * Storybook RN has installed it. Reading the global instead of importing the module keeps this
 * package free of a hard Storybook dependency and resolvable in Metro and in Node tests alike.
 */
const addonsStoreKey = '__STORYBOOK_ADDONS_PREVIEW';

export const resolveStorybookChannel: ChannelResolver = () => {
  const store: unknown = Reflect.get(globalThis, addonsStoreKey);
  if (!hasMethod(store, 'getChannel')) return undefined;
  const channel: unknown = store.getChannel();
  return hasMethod(channel, 'emit') ? channel : undefined;
};

/** An `emit` that looks the channel up at report time, so a late channel swap is honoured. */
export function createChannelEmit(resolve: ChannelResolver = resolveStorybookChannel): TargusEmit {
  return (event: string, report: unknown) => {
    resolve()?.emit(event, report);
  };
}

/** The decorator projects register. It reports through Storybook's own channel. */
export const withTargus: TargusDecorator = createWithTargus({ emit: createChannelEmit() });

function hasMethod<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, (...args: unknown[]) => unknown> {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, key) === 'function'
  );
}
