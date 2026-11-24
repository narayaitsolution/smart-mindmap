import { describe, expect, it } from 'vitest';
import config from '../vite.config.ts';

describe('vite config', () => {
  it('binds dev and preview server to all interfaces for NetBird access', () => {
    expect(config.server?.host).toBe('0.0.0.0');
    expect(config.preview?.host).toBe('0.0.0.0');
  });
});
