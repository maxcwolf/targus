import { describe, expect, it } from 'vitest';

import { ExecError, type Exec, type ExecOptions } from './exec.adapter.js';
import { SimctlDriver } from './simctl.adapter.js';

const udid = 'SIM-UDID';

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: ExecOptions | undefined;
}

/** An `Exec` that records calls and fails those whose argv contains a key of `failures`. */
function fakeExec(failures: Record<string, string> = {}, stdout = Buffer.alloc(0)) {
  const calls: Call[] = [];
  const exec: Exec = (file, args, options) => {
    calls.push({ file, args, options });
    const failure = Object.entries(failures).find(([verb]) => args.includes(verb));
    if (failure) return Promise.reject(new ExecError(`${verb(args)} failed`, failure[1]));
    return Promise.resolve({ stdout, stderr: '' });
  };
  return { exec, calls, argv: () => calls.map((call) => [call.file, ...call.args]) };
}

function verb(args: readonly string[]): string {
  return args[1] ?? '';
}

describe('SimctlDriver', () => {
  it('boots and waits for bootstatus', async () => {
    const fake = fakeExec();

    await new SimctlDriver({ udid, exec: fake.exec }).boot();

    expect(fake.argv()).toEqual([
      ['xcrun', 'simctl', 'boot', udid],
      ['xcrun', 'simctl', 'bootstatus', udid, '-b'],
    ]);
  });

  it('tolerates a device that is already booted', async () => {
    const fake = fakeExec({ boot: 'Unable to boot device in current state: Booted' });

    await new SimctlDriver({ udid, exec: fake.exec }).boot();

    expect(fake.calls).toHaveLength(2);
  });

  it('propagates any other boot failure', async () => {
    const fake = fakeExec({ boot: 'Invalid device: SIM-UDID' });

    await expect(new SimctlDriver({ udid, exec: fake.exec }).boot()).rejects.toThrow('failed');
  });

  it('installs the app', async () => {
    const fake = fakeExec();

    await new SimctlDriver({ udid, exec: fake.exec }).install('/apps/ExampleApp.app');

    expect(fake.argv()).toEqual([['xcrun', 'simctl', 'install', udid, '/apps/ExampleApp.app']]);
  });
});

describe('SimctlDriver launch and status bar', () => {
  it('terminates, then launches with env as SIMCTL_CHILD_ variables', async () => {
    const fake = fakeExec({ terminate: 'found nothing to terminate' });

    await new SimctlDriver({ udid, exec: fake.exec }).launch('co.example', { MODE: 'targus' });

    expect(fake.argv()).toEqual([
      ['xcrun', 'simctl', 'terminate', udid, 'co.example'],
      ['xcrun', 'simctl', 'launch', udid, 'co.example'],
    ]);
    expect(fake.calls[1]?.options).toEqual({ env: { SIMCTL_CHILD_MODE: 'targus' } });
  });

  it('overrides the status bar', async () => {
    const fake = fakeExec();

    await new SimctlDriver({ udid, exec: fake.exec }).setStatusBar({
      time: '9:41',
      batteryLevel: 100,
      cellularBars: 4,
    });

    expect(fake.argv()).toEqual([
      [
        'xcrun',
        'simctl',
        'status_bar',
        udid,
        'override',
        '--time',
        '9:41',
        '--batteryState',
        'charged',
        '--batteryLevel',
        '100',
        '--cellularBars',
        '4',
        '--dataNetwork',
        'wifi',
        '--wifiMode',
        'active',
        '--wifiBars',
        '3',
      ],
    ]);
  });
});

describe('SimctlDriver screenshot and shutdown', () => {
  it('returns screenshot bytes from stdout', async () => {
    const fake = fakeExec({}, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const png = await new SimctlDriver({ udid, exec: fake.exec }).screenshot();

    expect([...png]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(fake.argv()).toEqual([['xcrun', 'simctl', 'io', udid, 'screenshot', '--type=png', '-']]);
  });

  it('shuts down and tolerates a device that is already shut down', async () => {
    const fake = fakeExec({ shutdown: 'Unable to shutdown device in current state: Shutdown' });

    await new SimctlDriver({ udid, exec: fake.exec }).shutdown();

    expect(fake.argv()).toEqual([['xcrun', 'simctl', 'shutdown', udid]]);
  });

  it('rethrows errors that are not ExecErrors', async () => {
    const exec: Exec = () => Promise.reject(new Error('spawn xcrun ENOENT'));

    await expect(new SimctlDriver({ udid, exec }).shutdown()).rejects.toThrow('ENOENT');
  });
});

describe('SimctlDriver deviceName', () => {
  const list = {
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
        { udid: 'OTHER', name: 'iPhone SE' },
        { udid, name: 'iPhone 16' },
      ],
    },
  };

  it('looks the UDID up in simctl list', async () => {
    const fake = fakeExec({}, Buffer.from(JSON.stringify(list)));

    expect(await new SimctlDriver({ udid, exec: fake.exec }).deviceName()).toBe('iPhone 16');
    expect(fake.argv()).toEqual([['xcrun', 'simctl', 'list', 'devices', '--json']]);
  });

  it('returns null for an unknown UDID', async () => {
    const fake = fakeExec({}, Buffer.from(JSON.stringify(list)));

    expect(await new SimctlDriver({ udid: 'NOPE', exec: fake.exec }).deviceName()).toBeNull();
  });
});
