import { describe, expect, it } from 'vitest';

import {
  CreateInstallationProjectRequest,
  InstallationId,
  ListInstallationsResponse,
} from './installation.ts';

describe('InstallationId', () => {
  it('reads a positive integer from path text', () => {
    expect(InstallationId.parse('42')).toBe(42);
    for (const text of ['0', '-1', '1.5', 'abc', '']) {
      expect(InstallationId.safeParse(text).success).toBe(false);
    }
  });
});

describe('CreateInstallationProjectRequest', () => {
  it('takes a repository as owner/name', () => {
    expect(CreateInstallationProjectRequest.parse({ repo: 'acme/web' })).toEqual({
      repo: 'acme/web',
    });
    expect(CreateInstallationProjectRequest.safeParse({ repo: 'web' }).success).toBe(false);
    expect(CreateInstallationProjectRequest.safeParse({}).success).toBe(false);
  });
});

describe('ListInstallationsResponse', () => {
  it('carries an install link or null', () => {
    const installations = [{ installationId: 7, account: 'acme' }];
    for (const installUrl of ['https://github.com/apps/x/installations/new', null]) {
      const response = { installations, installUrl };
      expect(ListInstallationsResponse.parse(response)).toEqual(response);
    }
    expect(ListInstallationsResponse.safeParse({ installations, installUrl: 'nope' }).success).toBe(
      false,
    );
  });
});
