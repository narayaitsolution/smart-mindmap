/** Content Security Policy injected into the built index.html. Dev keeps Vite's inline HMR scripts working. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com",
  'frame-src https://accounts.google.com',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function withCsp(html: string): string {
  if (html.includes('Content-Security-Policy')) return html;
  return html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
}
