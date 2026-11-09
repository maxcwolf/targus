import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadProjectConfig,
  parsePlatformList,
  selectPlatforms,
  ViewportText,
  type ProjectConfig,
} from './project-config.ts';

const cwd = '/repo';

function reader(files: Record<string, string>) {
  return (file: string): Promise<string> => {
    const text = files[file];
    if (text !== undefined) return Promise.resolve(text);
    return Promise.reject(Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' }));
  };
}

describe('loadProjectConfig', () => {
  it('is null when there is no targus.config.json and none was asked for', async () => {
    await expect(loadProjectConfig({ cwd, read: reader({}) })).resolves.toBeNull();
  });

  it('reads targus.config.json, resolving paths against its directory', async () => {
    const config = await loadProjectConfig({
      cwd,
      read: reader({
        '/repo/targus.config.json': JSON.stringify({
          $schema: 'https://example.com/schema.json',
          platforms: {
            ios: { app: 'build/App.app', deviceName: 'iPhone 16', appearance: 'dark' },
            web: { storybook: 'storybook-static', viewport: '1280x720', pixelRatio: 2 },
          },
        }),
      }),
    });
    expect(config?.platforms).toEqual({
      ios: {
        app: path.resolve('/repo/build/App.app'),
        deviceName: 'iPhone 16',
        appearance: 'dark',
      },
      web: {
        storybook: path.resolve('/repo/storybook-static'),
        viewport: { width: 1280, height: 720 },
        pixelRatio: 2,
      },
    });
  });
});

describe('loadProjectConfig paths', () => {
  it('keeps a Storybook URL and settings without paths as they are', async () => {
    const config = await loadProjectConfig({
      cwd,
      file: 'ci/targus.json',
      read: reader({
        '/repo/ci/targus.json': JSON.stringify({
          platforms: { ios: { udid: 'SIM' }, web: { storybook: 'https://sb.example.com' } },
        }),
      }),
    });
    expect(config?.platforms).toEqual({
      ios: { udid: 'SIM' },
      web: { storybook: 'https://sb.example.com' },
    });
    const noStorybook = await loadProjectConfig({
      cwd,
      read: reader({ '/repo/targus.config.json': '{"platforms":{"web":{"pixelRatio":1}}}' }),
    });
    expect(noStorybook?.platforms).toEqual({ web: { pixelRatio: 1 } });
  });
});

describe('loadProjectConfig errors', () => {
  it('requires a --config file to exist, and reports other read errors', async () => {
    await expect(loadProjectConfig({ cwd, file: 'nope.json', read: reader({}) })).rejects.toThrow(
      `cannot read the targus config ${path.resolve('/repo/nope.json')}`,
    );
    const denied = () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(loadProjectConfig({ cwd, read: denied })).rejects.toThrow(/cannot read/);
  });

  it('rejects invalid JSON and invalid settings, naming the file and the field', async () => {
    const file = '/repo/targus.config.json';
    await expect(loadProjectConfig({ cwd, read: reader({ [file]: '{' }) })).rejects.toThrow(
      `${path.resolve(file)} is not valid JSON`,
    );
    for (const [text, issue] of [
      ['{"platforms":{}}', 'platforms: name at least one platform'],
      ['{"platforms":{"android":{}}}', 'platforms: Unrecognized key: "android"'],
      ['{"platforms":{"web":{"viewport":"big"}}}', 'platforms.web.viewport: expected WIDTHxHEIGHT'],
      ['{"platforms":{"ios":{"appearance":"blue"}}}', 'platforms.ios.appearance'],
    ] as const) {
      await expect(loadProjectConfig({ cwd, read: reader({ [file]: text }) })).rejects.toThrow(
        issue,
      );
    }
  });

  it('reads from disk by default', async () => {
    await expect(
      loadProjectConfig({ cwd: path.join(import.meta.dirname, 'no-such-dir') }),
    ).resolves.toBeNull();
  });
});

describe('ViewportText', () => {
  it('parses WIDTHxHEIGHT', () => {
    expect(ViewportText.parse('1200x900')).toEqual({ width: 1200, height: 900 });
    expect(ViewportText.safeParse('0x900').success).toBe(false);
    expect(ViewportText.safeParse('1200 x 900').success).toBe(false);
  });
});

describe('parsePlatformList', () => {
  it('answers known platforms in run order, without duplicates', () => {
    expect(parsePlatformList('web')).toEqual(['web']);
    expect(parsePlatformList('web, ios,web')).toEqual(['ios', 'web']);
  });

  it('refuses unknown and empty lists', () => {
    expect(() => parsePlatformList('ios,android')).toThrow(
      '--platform takes ios, web or a comma-separated list of them, not android',
    );
    expect(() => parsePlatformList(' , ')).toThrow(
      '--platform takes ios, web or a comma-separated list of them',
    );
  });
});

describe('selectPlatforms', () => {
  const both: ProjectConfig = { platforms: { web: {}, ios: {} } };

  it('prefers the flag, then the config, then ios', () => {
    expect(selectPlatforms(['web'], both)).toEqual(['web']);
    expect(selectPlatforms(undefined, both)).toEqual(['ios', 'web']);
    expect(selectPlatforms(undefined, { platforms: { web: {} } })).toEqual(['web']);
    expect(selectPlatforms(undefined, null)).toEqual(['ios']);
  });
});
