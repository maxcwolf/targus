import { TargusError } from '@targus/core';
import { z } from 'zod';

/** One simulator from `xcrun simctl list devices --json`, with the fields targus reads. */
export interface ListedDevice {
  readonly udid: string;
  readonly name: string;
}

const Device = z.object({ udid: z.string(), name: z.string() });
const DeviceList = z.object({ devices: z.record(z.string(), z.array(z.unknown())) });

const listCommand = 'xcrun simctl list devices --json';

/** How much of the output an error quotes in its headline, and in its debug detail. */
const quoteLength = 60;
const detailLength = 2000;

/**
 * The output could not be read. The headline says why in words and what to try; the raw output
 * and the parser's own message are the cause, which only `TARGUS_DEBUG=1` prints.
 */
function unreadable(reason: string, output: string, detail: string): TargusError {
  const cause = new Error(`${detail}\noutput of ${listCommand}:\n${output.slice(0, detailLength)}`);
  return new TargusError(
    'internal',
    `could not read the simulator list: ${reason}\n` +
      `  run \`${listCommand}\` yourself to see what it prints, check that \`xcode-select -p\` ` +
      'points at the Xcode you expect, or pass --device-name to skip the lookup',
    { cause },
  );
}

function firstLine(output: string): string {
  const line = output.trimStart().split('\n', 1).join('');
  return line.length > quoteLength ? `${line.slice(0, quoteLength)}...` : line;
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch (error) {
    const reason = `its output is not JSON (it starts with "${firstLine(output)}")`;
    throw unreadable(reason, output, String(error));
  }
}

function devicesOf(runtime: string, entries: readonly unknown[], output: string): ListedDevice[] {
  return entries.map((entry) => {
    const parsed = Device.safeParse(entry);
    if (parsed.success) return parsed.data;
    const reason = `a device under "${runtime}" has no string "udid" and "name"`;
    throw unreadable(reason, output, z.prettifyError(parsed.error));
  });
}

/**
 * Every simulator in the output of `xcrun simctl list devices --json`. Anything else (no output,
 * a warning instead of JSON, JSON of another shape) is one `TargusError` that says so plainly.
 */
export function parseDeviceList(output: string): ListedDevice[] {
  if (output.trim() === '') throw unreadable(`\`${listCommand}\` printed nothing`, output, '');
  const list = DeviceList.safeParse(parseJson(output));
  if (!list.success) {
    const reason = 'its JSON has no "devices" object mapping each runtime to a list of devices';
    throw unreadable(reason, output, z.prettifyError(list.error));
  }
  return Object.entries(list.data.devices).flatMap(([runtime, entries]) =>
    devicesOf(runtime, entries, output),
  );
}
