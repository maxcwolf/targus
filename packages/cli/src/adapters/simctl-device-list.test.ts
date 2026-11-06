import { TargusError } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { describeError } from '../errors/describe-error.ts';
import { parseDeviceList } from './simctl-device-list.ts';

function rejection(output: string): TargusError {
  try {
    parseDeviceList(output);
  } catch (error) {
    if (error instanceof TargusError) return error;
    throw error;
  }
  throw new Error('expected the list to be rejected');
}

describe('parseDeviceList', () => {
  it('lists every device of every runtime', () => {
    const output = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
          { udid: 'A', name: 'iPhone 16', state: 'Shutdown' },
        ],
        'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [{ udid: 'B', name: 'iPhone SE' }],
        'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [],
      },
    });

    expect(parseDeviceList(output)).toEqual([
      { udid: 'A', name: 'iPhone 16' },
      { udid: 'B', name: 'iPhone SE' },
    ]);
  });

  it('accepts an empty device map', () => {
    expect(parseDeviceList('{"devices":{}}\n')).toEqual([]);
  });

  it.each([
    ['', '`xcrun simctl list devices --json` printed nothing'],
    [' \n', '`xcrun simctl list devices --json` printed nothing'],
    ['oops', 'its output is not JSON (it starts with "oops")'],
    [`${'w'.repeat(70)}\n{}`, `its output is not JSON (it starts with "${'w'.repeat(60)}...")`],
    ['[]', 'its JSON has no "devices" object mapping each runtime to a list of devices'],
    [
      '{"devices":{"r":{}}}',
      'its JSON has no "devices" object mapping each runtime to a list of devices',
    ],
    [
      '{"devices":{"r":[{"udid":"A","name":7}]}}',
      'a device under "r" has no string "udid" and "name"',
    ],
  ])('rejects %j plainly', (output, reason) => {
    const error = rejection(output);

    expect(error.code).toBe('internal');
    expect(error.message.split('\n')[0]).toBe(`could not read the simulator list: ${reason}`);
    expect(error.message).toContain('xcode-select -p');
  });

  it('keeps the parser detail and the output for TARGUS_DEBUG only', () => {
    const error = rejection('{"devices":{"r":[{"uuid":"A"}]}}');

    expect(describeError(error, { debug: false }).message).not.toContain('uuid');
    const debug = describeError(error, { debug: true }).message;
    expect(debug).toContain('caused by: Error:');
    expect(debug).toContain('"uuid":"A"');
    expect(debug).toContain('udid');
  });
});
