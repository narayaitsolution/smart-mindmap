/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

/** Minimal typing for tests that read source files (no @types/node dependency). */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
