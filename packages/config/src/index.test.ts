import { describe, expect, it } from 'vitest';

import { createApplicationConfig } from './index';

describe('createApplicationConfig', () => {
  it('provides production-safe defaults', () => {
    expect(createApplicationConfig()).toEqual({
      environment: 'production',
      logLevel: 'info',
    });
  });

  it('rejects an unsupported log level', () => {
    expect(() => createApplicationConfig({ logLevel: 'trace' as 'info' })).toThrow();
  });
});
