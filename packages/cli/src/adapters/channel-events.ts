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

const renderedEvents = new Set(['storyRendered', 'storyUnchanged']);

/** Events only the `withTargus` decorator sends; seeing one means the app runs it. */
export function isTargusEvent(event: ChannelEvent): boolean {
  return event.type.startsWith('targus/');
}

/** `storyRendered`/`storyUnchanged` for `storyId`; the id comes as a string or `{ storyId }`. */
export function isRenderedFor(event: ChannelEvent, storyId: string): boolean {
  return renderedEvents.has(event.type) && eventStoryId(event.args[0]) === storyId;
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

function eventStoryId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const parsed = StoryIdPayload.safeParse(value);
  return parsed.success ? parsed.data.storyId : null;
}
