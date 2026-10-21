import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONVERTER_VERSION } from './version';

describe('CONVERTER_VERSION', () => {
  it('is the version package.json gives', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(CONVERTER_VERSION).toBe(pkg.version);
  });
});
