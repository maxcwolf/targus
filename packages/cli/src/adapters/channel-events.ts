import {
  parseStoryParameters,
  StoryParametersPayload,
  storyParametersEvent,
  type StorySelection,
} from '@targus/core';
import { z } from 'zod';

/** One message on the Storybook channel: plain JSON `{ type, args }` (ADR 0008). */
export const ChannelEvent = z.object({ type: z.string(), args: z.array(z.unknown()).default([]) });
export type ChannelEvent = z.infer<typeof ChannelEvent>;

const StoryErrorPayload = z.object({ storyId: z.string(), message: z.string() });
const StoryIdPayload = z.object({ storyId: z.string() });

/** How Storybook answered a selection: it rendered the story, or the story was already shown. */
type RenderSignal = 'rendered' | 'unchanged';

const renderSignals = new Map<string, RenderSignal>([
  ['storyRendered', 'rendered'],
  ['storyUnchanged', 'unchanged'],
]);

/** Events only the `withTargus` decorator sends; seeing one means the app runs it. */
export function isTargusEvent(event: ChannelEvent): boolean {
  return event.type.startsWith('targus/');
}

/** `storyRendered`/`storyUnchanged` for `storyId`; the id comes as a string or `{ storyId }`. */
function renderSignalFor(event: ChannelEvent, storyId: string): RenderSignal | undefined {
  const signal = renderSignals.get(event.type);
  return signal !== undefined && eventStoryId(event.args[0]) === storyId ? signal : undefined;
}

/** What the decorator reported from inside a story: its render error or its parameters. */
interface TargusReport {
  readonly storyId: string;
  /** `rendered` with validated parameters, or `error` for a render error or bad parameters. */
  readonly selection: StorySelection;
}

function storyErrorReport(event: ChannelEvent): TargusReport | undefined {
  if (event.type !== 'targus/storyError') return undefined;
  const error = StoryErrorPayload.safeParse(event.args[0]);
  if (!error.success) return undefined;
  return { storyId: error.data.storyId, selection: { kind: 'error', message: error.data.message } };
}

/**
 * Storybook's channel serialises with telejson, which has no `undefined` and sends it as this
 * string instead (an app on an older decorator sends `targus: undefined` for every story that
 * sets no parameters). Put the value back before validating.
 */
const telejsonUndefined = '_undefined_';

function fromTelejson(value: unknown): unknown {
  if (value === telejsonUndefined) return undefined;
  if (Array.isArray(value)) return value.map(fromTelejson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromTelejson(item)]));
}

function parametersReport(event: ChannelEvent): TargusReport | undefined {
  if (event.type !== storyParametersEvent) return undefined;
  const payload = StoryParametersPayload.safeParse(event.args[0]);
  if (!payload.success) return undefined;
  const parsed = parseStoryParameters(fromTelejson(payload.data.targus));
  return {
    storyId: payload.data.storyId,
    selection: parsed.ok
      ? { kind: 'rendered', parameters: parsed.parameters }
      : { kind: 'error', message: parsed.message },
  };
}

/** A `targus/storyError` or `targus/storyParameters` report for any story. */
export function targusReport(event: ChannelEvent): TargusReport | undefined {
  return storyErrorReport(event) ?? parametersReport(event);
}

/** The decorator's report for `storyId`, if `event` is one. */
export function targusReportFor(event: ChannelEvent, storyId: string): StorySelection | undefined {
  const report = targusReport(event);
  return report?.storyId === storyId ? report.selection : undefined;
}

const RenderPhasePayload = z.object({ storyId: z.string(), newPhase: z.string() });
const ThrownPayload = z.object({ message: z.string().min(1) });

/** Storybook saying it is running `storyId`'s play function, on a device that runs them. */
function startsPlaying(event: ChannelEvent, storyId: string): boolean {
  if (event.type !== 'storyRenderPhaseChanged') return false;
  const phase = RenderPhasePayload.safeParse(event.args[0]);
  return phase.success && phase.data.storyId === storyId && phase.data.newPhase === 'playing';
}

/**
 * A play function that threw. `playFunctionThrewException` carries the error and no story id;
 * Storybook runs one play function at a time, so it belongs to the selection that is waiting.
 */
function playFailure(event: ChannelEvent): StorySelection | undefined {
  if (event.type !== 'playFunctionThrewException') return undefined;
  const thrown = ThrownPayload.safeParse(event.args[0]);
  const message = thrown.success ? thrown.data.message : 'it threw without a message';
  return { kind: 'error', message: `play function: ${message}` };
}

/** What ends the wait of a selection: a render signal, or the story's outcome itself. */
type SelectionAnswer = RenderSignal | StorySelection;

/**
 * The events that answer a selection of `storyId`, as a function to call with each event in
 * order. Without a play function the first of `storyRendered` and the decorator's report
 * answers. A story with a play function (ADR 0047) reports its parameters when it mounts, which
 * is before the play function has finished, so once Storybook says the story is playing only
 * `storyRendered`, which follows the play function, or an error answers.
 */
export function selectionAnswers(
  storyId: string,
): (event: ChannelEvent) => SelectionAnswer | undefined {
  let playing = false;
  return (event) => {
    playing ||= startsPlaying(event, storyId);
    const failure = playFailure(event);
    if (failure !== undefined) return failure;
    const signal = renderSignalFor(event, storyId);
    if (signal !== undefined) return signal;
    const report = targusReportFor(event, storyId);
    return playing && report?.kind !== 'error' ? undefined : report;
  };
}

function eventStoryId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const parsed = StoryIdPayload.safeParse(value);
  return parsed.success ? parsed.data.storyId : null;
}
