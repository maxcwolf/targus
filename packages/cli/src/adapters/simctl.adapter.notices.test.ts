import { TargusError } from '@targus/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExecError, type Exec, type ExecOptions } from './exec.adapter.ts';
import { noticeServices, SimctlDriver, simctlTimeoutsMs } from './simctl.adapter.ts';

const udid = 'SIM-UDID';
const noProcess = 'Boot-out failed: 3: No such process';
const notFound = 'Boot-out failed: 113: Could not find specified service';
const refused = 'Boot-out failed: 1: Operation not permitted';

interface Call {
  readonly args: readonly string[];
  readonly options: ExecOptions | undefined;
}

type Answer = (args: readonly string[]) => Error | string | null;

/** An `Exec` that records calls; `answer` returns an error to throw, stdout, or null for none. */
function fakeExec(answer: Answer = () => null) {
  const calls: Call[] = [];
  const exec: Exec = (_file, args, options) => {
    calls.push({ args, options });
    const result = answer(args);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({ stdout: Buffer.from(result ?? ''), stderr: '' });
  };
  return { exec, calls, verbs: () => calls.map((call) => call.args.slice(1, 2).join('')) };
}

function deviceList(device: Record<string, unknown>): string {
  return JSON.stringify({ devices: { 'iOS-26-2': [{ udid, name: 'iPhone 16', ...device }] } });
}

function launchctl(subcommand: string): string[][] {
  return noticeServices.flatMap((service) =>
    ['user/foreground', 'system'].map((domain) => [
      'simctl',
      'spawn',
      udid,
      'launchctl',
      subcommand,
      `${domain}/${service}`,
    ]),
  );
}

describe('SimctlDriver.silenceSystemNotices', () => {
  it('disables both notice services in both domains, then boots them out', async () => {
    const fake = fakeExec();

    await new SimctlDriver({ udid, exec: fake.exec }).silenceSystemNotices();

    expect(noticeServices).toEqual(['com.apple.generativeexperiencesd', 'com.apple.followupd']);
    expect(fake.calls.map((call) => call.args)).toEqual([
      ...launchctl('disable'),
      ...launchctl('bootout'),
    ]);
    expect(fake.calls.every((call) => call.options?.timeoutMs === simctlTimeoutsMs.spawn)).toBe(
      true,
    );
  });

  it.each([noProcess, notFound])(
    'accepts a bootout that finds nothing running: %s',
    async (stderr) => {
      const fake = fakeExec((args) =>
        args.includes('bootout') ? new ExecError('launchctl bootout failed', stderr) : null,
      );
      const warn = vi.fn();

      await new SimctlDriver({ udid, exec: fake.exec, warn }).silenceSystemNotices();

      expect(warn).not.toHaveBeenCalled();
    },
  );
});

describe('SimctlDriver bootout refusals', () => {
  it('warns about any other bootout refusal and carries on', async () => {
    const fake = fakeExec((args) => {
      if (!args.includes('bootout')) return null;
      const stderr = args.at(-1) === 'system/com.apple.followupd' ? refused : '';
      return new ExecError('launchctl bootout failed', stderr);
    });
    const warn = vi.fn();

    await new SimctlDriver({ udid, exec: fake.exec, warn }).silenceSystemNotices();

    expect(warn.mock.calls.flat()).toEqual([
      ...Array<string>(3).fill(expect.stringContaining('launchctl bootout failed') as string),
      `warning: could not stop system/com.apple.followupd; its notices may reach screenshots: ${refused}`,
    ]);
  });

  it('warns on stderr by default', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const fake = fakeExec((args) =>
      args.includes('bootout') ? new ExecError('launchctl bootout failed', refused) : null,
    );

    await new SimctlDriver({ udid, exec: fake.exec }).silenceSystemNotices();

    expect(write).toHaveBeenCalledWith(expect.stringContaining(`${refused}\n`));
  });

  it('propagates a bootout that times out', async () => {
    const timedOut = new TargusError('internal', 'xcrun simctl spawn did not finish within 30s');
    const fake = fakeExec((args) => (args.includes('bootout') ? timedOut : null));

    await expect(new SimctlDriver({ udid, exec: fake.exec }).silenceSystemNotices()).rejects.toBe(
      timedOut,
    );
  });

  it('propagates a failed disable without booting anything out', async () => {
    const fake = fakeExec((args) =>
      args.includes('disable') ? new ExecError('launchctl disable failed', 'Invalid device') : null,
    );

    await expect(
      new SimctlDriver({ udid, exec: fake.exec }).silenceSystemNotices(),
    ).rejects.toThrow('launchctl disable failed');
    expect(fake.calls.some((call) => call.args.includes('bootout'))).toBe(false);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SimctlDriver first boot', () => {
  it('silences the notice services and reboots a simulator that never booted', async () => {
    const fake = fakeExec((args) => (args.includes('list') ? deviceList({}) : null));

    await new SimctlDriver({ udid, exec: fake.exec }).boot();

    expect(fake.verbs()).toEqual([
      'list',
      'boot',
      'bootstatus',
      ...Array<string>(8).fill('spawn'),
      'shutdown',
      'boot',
      'bootstatus',
    ]);
  });

  it('boots once a simulator that booted before', async () => {
    const booted = deviceList({ lastBootedAt: '2026-11-07T22:47:10Z' });
    const fake = fakeExec((args) => (args.includes('list') ? booted : null));

    await new SimctlDriver({ udid, exec: fake.exec }).boot();

    expect(fake.verbs()).toEqual(['list', 'boot', 'bootstatus']);
  });

  it('boots once when simctl does not list the simulator', async () => {
    const other = JSON.stringify({ devices: { 'iOS-26-2': [{ udid: 'OTHER', name: 'iPhone' }] } });
    const fake = fakeExec((args) => (args.includes('list') ? other : null));

    await new SimctlDriver({ udid, exec: fake.exec }).boot();

    expect(fake.verbs()).toEqual(['list', 'boot', 'bootstatus']);
  });

  it('boots once when the simulator list cannot be read', async () => {
    const fake = fakeExec((args) =>
      args.includes('list') ? new ExecError('simctl list failed', 'CoreSimulator is busy') : null,
    );

    await new SimctlDriver({ udid, exec: fake.exec }).boot();

    expect(fake.verbs()).toEqual(['list', 'boot', 'bootstatus']);
  });
});

describe('SimctlDriver first boot edge cases', () => {
  it('reads a null lastBootedAt as never booted', async () => {
    const fake = fakeExec((args) =>
      args.includes('list') ? deviceList({ lastBootedAt: null }) : null,
    );

    await new SimctlDriver({ udid, exec: fake.exec }).boot();

    expect(fake.verbs().filter((verb) => verb === 'bootstatus')).toHaveLength(2);
  });

  it.each([
    ['succeeds', null],
    ['fails too', new ExecError('simctl shutdown failed', 'CoreSimulator is busy')],
  ])(
    'shuts down after a failed silence, and says how to retry, when shutdown %s',
    async (_, down) => {
      const denied = new ExecError('launchctl disable failed', 'Invalid device');
      const fake = fakeExec((args) => {
        if (args.includes('list')) return deviceList({});
        if (args.includes('disable')) return denied;
        return args.includes('shutdown') ? down : null;
      });

      const booting = new SimctlDriver({ udid, exec: fake.exec }).boot();

      await expect(booting).rejects.toThrow(TargusError);
      await expect(booting).rejects.toMatchObject({
        message: expect.stringContaining(`xcrun simctl shutdown ${udid}`) as string,
        cause: denied,
      });
      expect(fake.verbs()).toEqual([
        'list',
        'boot',
        'bootstatus',
        ...Array<string>(4).fill('spawn'),
        'shutdown',
      ]);
    },
  );
});
