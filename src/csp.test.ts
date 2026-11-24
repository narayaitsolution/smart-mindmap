import { describe, expect, it } from 'vitest';
import { CSP, withCsp } from './csp';
import nginx from '../nginx.conf.example?raw';

const directive = (name: string) => CSP.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

describe('CSP', () => {
  it('blocks inline and eval scripts, plugins and base tag changes', () => {
    expect(directive('script-src')).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'none'");
  });

  it('still allows what the app needs: Google sign-in, Drive and local note images', () => {
    expect(directive('script-src')).toContain('https://accounts.google.com');
    expect(directive('connect-src')).toContain('https://www.googleapis.com');
    expect(directive('img-src')).toMatch(/data:/);
  });

  it('never loads remote images, so notes cannot track readers', () => {
    expect(directive('img-src')).not.toMatch(/https:|http:|\*/);
  });

  it('is served as a header by the nginx example with the same policy', () => {
    const header = nginx.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/)?.[1];
    expect(header).toBeTruthy();
    const dirs = (v: string) => v.split(';').map((d) => d.trim()).filter(Boolean);
    expect(dirs(header as string)).toEqual([...dirs(CSP), "frame-ancestors 'none'"]);
    expect(nginx).toMatch(/X-Content-Type-Options\s+"nosniff"/);
    expect(nginx).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
  });

  it('injects a meta tag first in <head>', () => {
    const html = withCsp('<html><head><meta charset="UTF-8" /></head></html>');
    expect(html).toMatch(/<head><meta http-equiv="Content-Security-Policy" content="[^"]+" \/>/);
    expect(withCsp(html)).toBe(html);
  });
});
