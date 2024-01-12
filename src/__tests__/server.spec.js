import { createServer } from '../server';

import { describe, it, expect } from 'vitest';

describe('server', () => {
  it('should export `createServer`', () => {
    expect(typeof createServer).toBe('function');
  });
});
