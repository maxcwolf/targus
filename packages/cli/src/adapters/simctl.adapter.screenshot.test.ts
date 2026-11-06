import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExecError, type Exec } from './exec.adapter.ts';
import { SimctlDriver } from './simctl.adapter.ts';

const udid = 'SIM-UDID';
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface FakeSimctl {
  /** What simctl leaves at the output path: bytes, nothing, or a directory (unreadable). */
  readonly writes?: Buffer | 'nothing' | 'directory';
  readonly stderr?: string;
  readonly fail?: string;
}

/** An `Exec` that behaves like `simctl io screenshot <path>` and records the argv it got. */
function fakeSimctl({ writes = pngBytes, stderr = '', fail }: FakeSimctl = {}) {
  const argv: string[][] = [];
  const exec: Exec = async (file, args) => {
    argv.push([file, ...args]);
    const out = args.at(-1) ?? '';
    if (writes === 'directory') await mkdir(out);
    else if (writes !== 'nothing') await writeFile(out, writes);
    if (fail !== undefined) throw new ExecError(`xcrun simctl io failed: ${fail}`, fail);
    return { stdout: Buffer.alloc(0), stderr };
  };
  return { exec, argv };
}

let tempRoot = '';

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'targus-simctl-test-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

const driver = (exec: Exec) => new SimctlDriver({ udid, exec, tempRoot });

describe('SimctlDriver screenshot', () => {
  it('asks simctl for a file in a fresh temp directory, reads it and removes it', async () => {
    const fake = fakeSimctl();

    const png = await driver(fake.exec).screenshot();

    expect(Buffer.from(png)).toEqual(pngBytes);
    const [call] = fake.argv;
    expect(call?.slice(0, -1)).toEqual(['xcrun', 'simctl', 'io', udid, 'screenshot', '--type=png']);
    const out = call?.at(-1) ?? '';
    expect(path.dirname(path.dirname(out))).toBe(tempRoot);
    expect(path.basename(out)).toBe('screenshot.png');
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('removes the temp file when simctl fails', async () => {
    const fake = fakeSimctl({ fail: 'Invalid device: SIM-UDID' });

    await expect(driver(fake.exec).screenshot()).rejects.toThrow('Invalid device: SIM-UDID');
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('removes the temp directory when reading the file fails', async () => {
    const fake = fakeSimctl({ writes: 'directory' });

    await expect(driver(fake.exec).screenshot()).rejects.toThrow('EISDIR');
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('gives concurrent captures distinct paths', async () => {
    const fake = fakeSimctl();
    const sim = driver(fake.exec);

    await Promise.all([sim.screenshot(), sim.screenshot(), sim.screenshot()]);

    const paths = new Set(fake.argv.map((call) => call.at(-1)));
    expect(paths.size).toBe(3);
    expect(await readdir(tempRoot)).toEqual([]);
  });
});

describe('SimctlDriver screenshot without an image', () => {
  it('reports an empty file as its own error, with simctl stderr', async () => {
    const fake = fakeSimctl({ writes: Buffer.alloc(0), stderr: 'Detected file type PNG\n' });

    await expect(driver(fake.exec).screenshot()).rejects.toThrow(
      'simctl exited 0 but wrote no screenshot (0 bytes): Detected file type PNG',
    );
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('reports a missing file as its own error', async () => {
    const fake = fakeSimctl({ writes: 'nothing' });

    await expect(driver(fake.exec).screenshot()).rejects.toThrow(
      /^simctl exited 0 but wrote no screenshot file$/,
    );
    expect(await readdir(tempRoot)).toEqual([]);
  });
});
