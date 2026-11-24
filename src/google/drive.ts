export const BACKUP_NAME = 'smart-mindmap.json';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export class DriveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveError';
  }
}

type FetchLike = (input: string, init?: RequestInit & { headers?: Record<string, string> }) => Promise<Response>;

/** Empty, blank or placeholder values mean "Google is not configured". */
export function getGoogleClientId(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): string {
  const id = env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
  return id === '' || id.startsWith('YOUR_') ? '' : id;
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) throw new DriveError(`HTTP ${res.status}`);
  return res;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function findBackup(fetchImpl: FetchLike, token: string): Promise<string | null> {
  const q = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${BACKUP_NAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: '1',
  });
  const res = await check(await fetchImpl(`https://www.googleapis.com/drive/v3/files?${q}`, { headers: auth(token) }));
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

export async function uploadBackup(fetchImpl: FetchLike, token: string, content: string, fileId: string | null): Promise<string> {
  const boundary = `mm${Math.random().toString(36).slice(2)}`;
  const metadata = fileId ? { name: BACKUP_NAME } : { name: BACKUP_NAME, parents: ['appDataFolder'] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
  const res = await check(
    await fetchImpl(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: { ...auth(token), 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }),
  );
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function downloadBackup(fetchImpl: FetchLike, token: string, fileId: string): Promise<string> {
  const res = await check(
    await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: auth(token) }),
  );
  return res.text();
}
