import { TargusError } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { ExecError, type Exec, type ExecOptions } from './exec.adapter.ts';
import { isProcessAlive, SimctlDriver, simctlTimeoutsMs } from './simctl.adapter.ts';

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

describe('SimctlDriver timeouts', () => {
  it('gives every simctl call a timeout, minutes for boot and install', async () => {
    const fake = fakeExec();
    const driver = new SimctlDriver({ udid, exec: fake.exec });

    await driver.boot();
    await driver.install('/apps/ExampleApp.app');
    await driver.launch('co.example', {});
    await driver.shutdown();

    expect(fake.calls.map((call) => [call.args[1], call.options?.timeoutMs])).toEqual([
      ['list', 30_000],
      ['boot', 60_000],
      ['bootstatus', 300_000],
      ['install', 180_000],
      ['terminate', 30_000],
      ['launch', 60_000],
      ['shutdown', 60_000],
    ]);
    expect(Object.values(simctlTimeoutsMs).every((ms) => ms > 0)).toBe(true);
  });

  it('does not mistake a timeout for an already-booted device', async () => {
    const timedOut = new TargusError('internal', 'xcrun simctl boot did not finish within 1m');
    const exec: Exec = () => Promise.reject(timedOut);

    await expect(new SimctlDriver({ udid, exec }).boot()).rejects.toBe(timedOut);
  });
});

describe('SimctlDriver', () => {
  it('boots and waits for bootstatus', async () => {
    const fake = fakeExec();

    await new SimctlDriver({ udid, exec: fake.exec }).boot();

    expect(fake.argv()).toEqual([
      ['xcrun', 'simctl', 'list', 'devices', '--json'],
      ['xcrun', 'simctl', 'boot', udid],
      ['xcrun', 'simctl', 'bootstatus', udid, '-b'],
    ]);
  });

  it('tolerates a device that is already booted', async () => {
    const fake = fakeExec({ boot: 'Unable to boot device in current state: Booted' });

    await new SimctlDriver({ udid, exec: fake.exec }).boot();

    expect(fake.calls).toHaveLength(3);
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
    expect(fake.calls[1]?.options).toEqual({
      env: { SIMCTL_CHILD_MODE: 'targus' },
      timeoutMs: simctlTimeoutsMs.launch,
    });
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

describe('SimctlDriver setContentSize', () => {
  it('sets the preferred content size category with simctl ui', async () => {
    const fake = fakeExec();
    const driver = new SimctlDriver({ udid, exec: fake.exec });

    await driver.setContentSize('accessibility-extra-extra-extra-large');
    await driver.setContentSize('large');

    expect(fake.argv()).toEqual([
      ['xcrun', 'simctl', 'ui', udid, 'content_size', 'accessibility-extra-extra-extra-large'],
      ['xcrun', 'simctl', 'ui', udid, 'content_size', 'large'],
    ]);
  });
});

describe('SimctlDriver setAppearance', () => {
  it('sets the appearance with simctl ui', async () => {
    const fake = fakeExec();
    const driver = new SimctlDriver({ udid, exec: fake.exec });

    await driver.setAppearance('dark');
    await driver.setAppearance('light');

    expect(fake.argv()).toEqual([
      ['xcrun', 'simctl', 'ui', udid, 'appearance', 'dark'],
      ['xcrun', 'simctl', 'ui', udid, 'appearance', 'light'],
    ]);
    expect(fake.calls[0]?.options?.timeoutMs).toBe(30_000);
  });
});

describe('SimctlDriver isAppRunning', () => {
  it('checks the pid simctl launch printed', async () => {
    const fake = fakeExec({}, Buffer.from('co.example: 4242\n'));
    const checked: number[] = [];
    let alive = true;
    const driver = new SimctlDriver({
      udid,
      exec: fake.exec,
      isAlive: (pid) => {
        checked.push(pid);
        return alive;
      },
    });

    await driver.launch('co.example', {});
    expect(await driver.isAppRunning('co.example')).toBe(true);
    alive = false;
    expect(await driver.isAppRunning('co.example')).toBe(false);
    expect(checked).toEqual([4242, 4242]);
  });

  it('answers true when no pid is known', async () => {
    const fake = fakeExec({}, Buffer.from('launched\n'));
    const driver = new SimctlDriver({ udid, exec: fake.exec, isAlive: () => false });

    expect(await driver.isAppRunning('co.example')).toBe(true);
    await driver.launch('co.example', {});
    expect(await driver.isAppRunning('co.example')).toBe(true);
  });
});

describe('isProcessAlive', () => {
  const failWith = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };

  it('is true for this process and for one it may not signal', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(1, failWith('EPERM'))).toBe(true);
  });

  it('is false only when the process does not exist', () => {
    expect(isProcessAlive(4242, failWith('ESRCH'))).toBe(false);
    expect(
      isProcessAlive(4242, () => {
        throw new Error('odd');
      }),
    ).toBe(true);
  });
});

describe('SimctlDriver shutdown', () => {
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
