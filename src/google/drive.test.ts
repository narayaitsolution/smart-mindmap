import { describe, expect, it, vi } from 'vitest';
import { DriveError, downloadBackup, findBackup, getGoogleClientId, uploadBackup } from './drive';

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => String(body) }) as unknown as Response;

describe('google config', () => {
  it('treats missing, blank and placeholder client ids as not configured', () => {
    expect(getGoogleClientId({})).toBe('');
    expect(getGoogleClientId({ VITE_GOOGLE_CLIENT_ID: '   ' })).toBe('');
    expect(getGoogleClientId({ VITE_GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID' })).toBe('');
    expect(getGoogleClientId({ VITE_GOOGLE_CLIENT_ID: 'abc.apps.googleusercontent.com' })).toBe('abc.apps.googleusercontent.com');
  });
});

describe('drive backup', () => {
  it('finds the backup file with a bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ files: [{ id: 'f1' }] }));
    expect(await findBackup(fetchImpl, 'tok')).toBe('f1');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('https://www.googleapis.com/drive/v3/files?');
    expect(decodeURIComponent(String(url).replace(/\+/g, ' '))).toContain("name = 'smart-mindmap.json'");
    expect(String(url)).toContain('spaces=appDataFolder');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('returns null when no backup exists', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ files: [] }));
    expect(await findBackup(fetchImpl, 'tok')).toBeNull();
  });

  it('creates with POST and updates with PATCH using multipart', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ id: 'f9' }));
    expect(await uploadBackup(fetchImpl, 'tok', '{"a":1}', null)).toBe('f9');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(String(url)).toContain('/upload/drive/v3/files?uploadType=multipart');
    expect(init.headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    expect(init.body).toContain('"name":"smart-mindmap.json"');
    expect(init.body).toContain('{"a":1}');

    await uploadBackup(fetchImpl, 'tok', '{}', 'f9');
    const [url2, init2] = fetchImpl.mock.calls[1];
    expect(init2.method).toBe('PATCH');
    expect(String(url2)).toContain('/upload/drive/v3/files/f9?uploadType=multipart');
  });

  it('downloads file content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('{"x":1}'));
    expect(await downloadBackup(fetchImpl, 'tok', 'f1')).toBe('{"x":1}');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/drive/v3/files/f1?alt=media');
  });

  it('throws DriveError on http failure without leaking the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' } as unknown as Response);
    const err = await findBackup(fetchImpl, 'secret-token').catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(String(err.message)).not.toContain('secret-token');
  });
});
