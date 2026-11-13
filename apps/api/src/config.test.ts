import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

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
      sessionSecret: null,
      githubOAuth: null,
      githubAppInstallUrl: null,
      githubOAuthOrigin: 'https://github.com',
      githubApiOrigin: 'https://api.github.com',
      s3: null,
      features: { library: true },
    });
  });

  it('turns features on and off from FEATURES, and refuses a name it does not know', () => {
    expect(loadConfig({ ...vars, FEATURES: 'library=off' }).features).toEqual({ library: false });
    expect(loadConfig({ ...vars, FEATURES: '' }).features).toEqual({ library: true });
    expect(() => loadConfig({ ...vars, FEATURES: 'libary=off' })).toThrow(
      /FEATURES: \\"libary\\" is not a feature/,
    );
    expect(() => loadConfig({ ...vars, FEATURES: 'library' })).toThrow(/FEATURES: /);
  });

  it('builds the App install link from its slug, on the OAuth origin', () => {
    expect(loadConfig({ ...vars, GITHUB_APP_SLUG: 'targus-review' }).githubAppInstallUrl).toBe(
      'https://github.com/apps/targus-review/installations/new',
    );
    const stubbed = { ...vars, GITHUB_APP_SLUG: 'x', GITHUB_OAUTH_ORIGIN: 'http://localhost:9/' };
    expect(loadConfig(stubbed).githubAppInstallUrl).toBe(
      'http://localhost:9/apps/x/installations/new',
    );
    expect(loadConfig({ ...vars, GITHUB_APP_SLUG: '' }).githubAppInstallUrl).toBeNull();
    expect(() => loadConfig({ ...vars, GITHUB_APP_SLUG: 'not/a slug' })).toThrow();
  });

  it('reads the session secret, the OAuth client and GitHub origins without trailing slashes', () => {
    const config = loadConfig({
      ...vars,
      SESSION_SECRET: 'shh',
      GITHUB_CLIENT_ID: 'Iv1.abc',
      GITHUB_CLIENT_SECRET: 'client-secret',
      GITHUB_OAUTH_ORIGIN: 'http://localhost:9999/',
      GITHUB_API_ORIGIN: '',
    });

    expect(config).toMatchObject({
      sessionSecret: 'shh',
      githubOAuth: { clientId: 'Iv1.abc', clientSecret: 'client-secret' },
      githubOAuthOrigin: 'http://localhost:9999',
      githubApiOrigin: 'https://api.github.com',
    });
  });

  it('rejects a half-configured OAuth client and a malformed origin', () => {
    expect(() => loadConfig({ ...vars, GITHUB_CLIENT_ID: 'Iv1.abc' })).toThrow(/CLIENT_SECRET/);
    expect(() => loadConfig({ ...vars, GITHUB_API_ORIGIN: 'nope' })).toThrow();
  });
});

describe('loadConfig secrets and thresholds', () => {
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

describe('loadConfig S3 image store', () => {
  const s3 = {
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'targus',
    S3_ACCESS_KEY_ID: 'minio',
    S3_SECRET_ACCESS_KEY: 'minio-secret',
  };

  it('reads the bucket when every S3 var is set, virtual-hosted unless told otherwise', () => {
    expect(loadConfig({ ...vars, ...s3 }).s3).toEqual({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'targus',
      accessKeyId: 'minio',
      secretAccessKey: 'minio-secret',
      forcePathStyle: false,
    });
    expect(loadConfig({ ...vars, ...s3, S3_FORCE_PATH_STYLE: 'true' }).s3?.forcePathStyle).toBe(
      true,
    );
  });

  it('treats blank S3 vars as unset', () => {
    const blank = { S3_ENDPOINT: '', S3_REGION: ' ', S3_FORCE_PATH_STYLE: '' };
    expect(loadConfig({ ...vars, ...blank }).s3).toBeNull();
  });

  it('rejects a half-configured bucket, a bad endpoint and a bad path-style flag', () => {
    expect(() => loadConfig({ ...vars, ...s3, S3_SECRET_ACCESS_KEY: '' })).toThrow(/or none/);
    expect(() => loadConfig({ ...vars, S3_BUCKET: 'targus' })).toThrow(/S3_ENDPOINT/);
    expect(() => loadConfig({ ...vars, ...s3, S3_ENDPOINT: 'nope' })).toThrow();
    expect(() => loadConfig({ ...vars, ...s3, S3_FORCE_PATH_STYLE: 'yes' })).toThrow();
  });
});
