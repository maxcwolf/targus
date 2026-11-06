import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isTargusError } from '@targus/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createExecFileBuffer, ExecError, execFileBuffer } from './exec.adapter.js';

const node = process.execPath;

describe('execFileBuffer', () => {
  it('returns stdout as raw bytes and passes extra env on top of the inherited one', async () => {
    const script =
      'process.stdout.write(Buffer.from([0x89, 0x50, 0x00, 0xff]));' +
      'process.stderr.write(process.env.TARGUS_EXEC_TEST + ":" + typeof process.env.PATH)';

    const { stdout, stderr } = await execFileBuffer(node, ['-e', script], {
      env: { TARGUS_EXEC_TEST: 'yes' },
    });

    expect([...stdout]).toEqual([0x89, 0x50, 0x00, 0xff]);
    expect(stderr).toBe('yes:string');
  });

  it('rejects with an ExecError carrying stderr on a non-zero exit', async () => {
    const failing = execFileBuffer(node, [
      '-e',
      'console.error("Unable to boot"); process.exit(3)',
    ]);

    await expect(failing).rejects.toBeInstanceOf(ExecError);
    await expect(failing).rejects.toMatchObject({
      stderr: 'Unable to boot\n',
      message: expect.stringContaining('failed: Unable to boot') as unknown,
    });
  });
});

/** Resolves once `pid` no longer exists, polling every few milliseconds. */
async function exited(pid: number): Promise<void> {
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function pidFrom(file: string): Promise<number> {
  for (;;) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (text !== '') return Number(text);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('execFileBuffer timeouts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'targus-exec-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('kills a program that outlives its timeout and names the command', async () => {
    const pidFile = path.join(dir, 'pid');
    const script = `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;

    const hung = execFileBuffer(node, ['-e', script], { timeoutMs: 1000 });

    await expect(hung).rejects.toSatisfy(isTargusError);
    await expect(hung).rejects.toThrow(/^.+ -e .+ did not finish within 1s and was stopped$/);
    await exited(await pidFrom(pidFile));
  });

  it('sends SIGKILL to a program that ignores SIGTERM', async () => {
    const pidFile = path.join(dir, 'pid');
    const script =
      'process.on("SIGTERM", () => {});' +
      `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));` +
      'setInterval(() => {}, 1000)';
    const exec = createExecFileBuffer({ killGraceMs: 50 });

    const stubborn = exec(node, ['-e', script], { timeoutMs: 1000 });

    await expect(stubborn).rejects.toThrow('did not finish within 1s');
    await exited(await pidFrom(pidFile));
  });

  it('leaves a quick program alone', async () => {
    const { stdout } = await execFileBuffer(node, ['-e', 'process.stdout.write("ok")'], {
      timeoutMs: 10_000,
    });

    expect(stdout.toString()).toBe('ok');
  });
});
