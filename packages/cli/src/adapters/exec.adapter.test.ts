import { describe, expect, it } from 'vitest';

import { ExecError, execFileBuffer } from './exec.adapter.js';

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
