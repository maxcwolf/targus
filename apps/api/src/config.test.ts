import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

const vars = {
  APP_VERSION: '1.2.3',
  PUBLIC_URL: 'https://targus.example/',
  DIFF_THRESHOLD: '0.002',
};

describe('loadConfig', () => {
  it('reads vars and treats absent secrets as unset', () => {
    expect(loadConfig(vars)).toEqual({
      version: '1.2.3',
      publicUrl: 'https://targus.example',
      diffThreshold: 0.002,
      adminToken: null,
      githubApp: null,
    });
  });

  it('defaults the diff threshold and treats blank secrets as unset', () => {
    const config = loadConfig({ ...vars, DIFF_THRESHOLD: '', ADMIN_TOKEN: ' ' });

    expect(config.diffThreshold).toBe(0.001);
    expect(config.adminToken).toBeNull();
  });

  it('reads the admin token and GitHub App credentials, restoring PEM newlines', () => {
    const config = loadConfig({
      ...vars,
      ADMIN_TOKEN: 'admin',
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    });

    expect(config.adminToken).toBe('admin');
    expect(config.githubApp).toEqual({
      appId: '123',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });
  });

  it('rejects half-configured GitHub credentials, PKCS#1 keys and bad thresholds', () => {
    expect(() => loadConfig({ ...vars, GITHUB_APP_ID: '123' })).toThrow(/both/);
    expect(() =>
      loadConfig({
        ...vars,
        GITHUB_APP_ID: '123',
        GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----',
      }),
    ).toThrow(/PKCS#8/);
    expect(() => loadConfig({ ...vars, DIFF_THRESHOLD: '2' })).toThrow();
    expect(() => loadConfig({ ...vars, PUBLIC_URL: 'not a url' })).toThrow();
  });
});
