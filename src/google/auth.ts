import { DRIVE_SCOPE } from './drive';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string }) => void;
      }): TokenClient;
    };
  };
}

const SRC = 'https://accounts.google.com/gsi/client';
let loading: Promise<GoogleGlobal> | null = null;

/** Loaded on demand so a missing or blocked Google script never affects startup. */
function loadGis(): Promise<GoogleGlobal> {
  const w = window as unknown as { google?: GoogleGlobal };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  loading ??= new Promise<GoogleGlobal>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (w.google?.accounts?.oauth2 ? resolve(w.google) : reject(new Error('Google script unavailable')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Google script could not be loaded'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface DriveToken {
  value: string;
  expiresAt: number;
}

/** The token lives in memory only; it is never written to storage. */
export async function requestDriveToken(clientId: string): Promise<DriveToken> {
  const google = await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        if (r.access_token) resolve({ value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 - 60_000 });
        else reject(new Error(r.error ?? 'Sign-in was cancelled'));
      },
      error_callback: (e) => reject(new Error(e.type ?? 'Sign-in was cancelled')),
    });
    client.requestAccessToken();
  });
}
