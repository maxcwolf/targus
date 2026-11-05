import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readCaptureManifest } from '../capture/manifest.js';
import { readPngSize } from '../capture/png.js';
import { simulatorTestTarget } from '../config.js';
import { defaultCaptureDeps, runCapture } from './capture.js';

// Opt-in: runs against a real booted-or-bootable simulator and a Storybook app built with the
// websocket channel enabled. Set TARGUS_SIMULATOR_UDID and TARGUS_APP to run it.
const target = simulatorTestTarget();

describe.skipIf(target === null)('targus capture on a real simulator', () => {
  it('captures five stories into PNGs with a valid manifest', { timeout: 180_000 }, async () => {
    if (target === null) return;
    const out = await mkdtemp(path.join(tmpdir(), 'targus-simulator-'));
    try {
      await runCapture(
        {
          udid: target.udid,
          app: target.app,
          out,
          port: 7007,
          settle: 300,
          stabilityGap: 150,
          renderTimeout: 10_000,
          attempts: 3,
          connectTimeout: 60_000,
          limit: 5,
        },
        defaultCaptureDeps,
      );

      const pngs = (await readdir(out)).filter((file) => file.endsWith('.png'));
      const manifest = await readCaptureManifest(out);
      expect(pngs).toHaveLength(5);
      expect(manifest.summary).toMatchObject({ storyCount: 5, captured: 5, failed: 0 });
      for (const story of manifest.stories) {
        expect(story.width).toBeGreaterThan(0);
        expect(story.height).toBeGreaterThan(story.width);
      }
      const first = manifest.stories[0];
      if (first?.file == null) throw new Error('expected a captured story');
      const png = new Uint8Array(await readFile(path.join(out, first.file)));
      expect(readPngSize(png)).toEqual({ width: first.width, height: first.height });
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
