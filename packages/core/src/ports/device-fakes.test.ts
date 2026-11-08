import { describe, expect, it } from 'vitest';

import { createFakeDeviceDriver } from './device-driver.fake.ts';
import { createFakeStorybookChannel } from './storybook-channel.fake.ts';

describe('createFakeDeviceDriver', () => {
  it('records every call in order with its arguments', async () => {
    const driver = createFakeDeviceDriver();
    const overrides = { time: '9:41', batteryLevel: 100, cellularBars: 4 };

    await driver.boot();
    await driver.silenceSystemNotices();
    await driver.setAppearance('dark');
    await driver.install('/apps/ExampleApp.app');
    await driver.launch('co.example', { A: '1' });
    await driver.setStatusBar(overrides);
    await driver.shutdown();

    expect(driver.calls).toEqual([
      { method: 'boot' },
      { method: 'silenceSystemNotices' },
      { method: 'setAppearance', appearance: 'dark' },
      { method: 'install', appPath: '/apps/ExampleApp.app' },
      { method: 'launch', bundleId: 'co.example', env: { A: '1' } },
      { method: 'setStatusBar', overrides },
      { method: 'shutdown' },
    ]);
  });

  it('returns queued screenshots in order and then repeats the last one', async () => {
    const driver = createFakeDeviceDriver();
    const first = Uint8Array.of(1);
    const second = Uint8Array.of(2);
    driver.queueScreenshots(first, second);

    expect(await driver.screenshot()).toBe(first);
    expect(await driver.screenshot()).toBe(second);
    expect(await driver.screenshot()).toBe(second);
    expect(driver.calls).toHaveLength(3);
  });

  it('returns empty bytes when nothing was ever queued', async () => {
    expect(await createFakeDeviceDriver().screenshot()).toEqual(new Uint8Array());
  });

  it('reports the app running until it exits, and running again after a relaunch', async () => {
    const driver = createFakeDeviceDriver();

    expect(await driver.isAppRunning('co.example')).toBe(true);
    driver.exitApp();
    expect(await driver.isAppRunning('co.example')).toBe(false);
    await driver.launch('co.example', {});
    expect(await driver.isAppRunning('co.example')).toBe(true);
    expect(driver.calls).toEqual([{ method: 'launch', bundleId: 'co.example', env: {} }]);
  });
});

describe('createFakeStorybookChannel', () => {
  const index = [{ id: 'button--primary', title: 'Button', name: 'Primary' }];

  it('returns a copy of its index', async () => {
    const channel = createFakeStorybookChannel(index);

    expect(await channel.getIndex()).toEqual(index);
    expect(await createFakeStorybookChannel().getIndex()).toEqual([]);
  });

  it('renders by default and records each selection', async () => {
    const channel = createFakeStorybookChannel(index);

    expect(await channel.selectStory('button--primary', 100)).toEqual({ kind: 'rendered' });
    expect(channel.selected).toEqual(['button--primary']);
  });

  it('plays back scripted errors and timeouts', async () => {
    const channel = createFakeStorybookChannel(index);
    channel.setOutcome('a', { kind: 'error', message: 'No QueryClient set' });
    channel.setOutcome('b', { kind: 'timeout' });

    expect(await channel.selectStory('a', 100)).toEqual({
      kind: 'error',
      message: 'No QueryClient set',
    });
    await expect(channel.selectStory('b', 250)).rejects.toThrow('timeout after 250ms');
  });

  it('disconnects when told to', async () => {
    const channel = createFakeStorybookChannel(index);
    let disconnected = false;
    void channel.whenDisconnected().then(() => (disconnected = true));

    await Promise.resolve();
    expect(disconnected).toBe(false);
    channel.disconnect();
    await channel.whenDisconnected();
    expect(disconnected).toBe(true);
  });

  it('disconnects on a scripted disconnect and leaves that selection to close()', async () => {
    const channel = createFakeStorybookChannel(index);
    channel.setOutcome('button--primary', { kind: 'disconnect' });

    const selection = channel.selectStory('button--primary', 100);
    await channel.whenDisconnected();
    await channel.close();

    await expect(selection).rejects.toThrow('channel closed');
  });

  it('reports whether it was closed', async () => {
    const channel = createFakeStorybookChannel();

    expect(channel.closed).toBe(false);
    await channel.close();
    expect(channel.closed).toBe(true);
  });
});
