import { useRef, useState } from 'react';
import { requestDriveToken, type DriveToken } from '../google/auth';
import { downloadBackup, findBackup, getGoogleClientId, uploadBackup } from '../google/drive';
import { exportJson, importJson } from '../io/json';
import type { Mindmap } from '../model/mindmap';
import type { MessageKey } from '../i18n';
import { Dropdown } from './Dropdown';

interface Props {
  maps: Mindmap[];
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  onRestore(maps: Mindmap[]): void;
  onNotice(kind: 'info' | 'error', text: string): void;
}

const fetchImpl = (url: string, init?: RequestInit) => fetch(url, init);

export function GoogleDriveMenu({ maps, t, onRestore, onNotice }: Props) {
  const clientId = getGoogleClientId();
  const token = useRef<DriveToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  const withToken = async (id: string): Promise<string> => {
    if (!token.current || token.current.expiresAt < Date.now()) token.current = await requestDriveToken(id);
    return token.current.value;
  };

  const run = async (job: (tok: string) => Promise<void>) => {
    setBusy(true);
    try {
      await job(await withToken(clientId));
      setConnected(true);
    } catch (e) {
      token.current = null;
      setConnected(false);
      onNotice('error', t('google.failed', { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const backup = () =>
    run(async (tok) => {
      const existing = await findBackup(fetchImpl, tok);
      await uploadBackup(fetchImpl, tok, exportJson(maps), existing);
      onNotice('info', t('google.backedUp'));
    });

  const restore = () => {
    if (!window.confirm(t('google.restoreConfirm'))) return;
    return run(async (tok) => {
      const id = await findBackup(fetchImpl, tok);
      if (!id) {
        onNotice('info', t('google.noBackup'));
        return;
      }
      const restored = importJson(await downloadBackup(fetchImpl, tok, id));
      onRestore(restored);
      onNotice('info', t('google.restored', { count: restored.length }));
    });
  };

  return (
    <Dropdown label={t('google.title')} menu={false}>
      {(close) =>
        !clientId ? (
          <p className="muted dropdown-note">{t('google.notConfigured')}</p>
        ) : (
          <>
            {busy && <p className="muted dropdown-note">{t('google.working')}</p>}
            {connected && !busy && <p className="muted dropdown-note">{t('google.connected')}</p>}
            <button type="button" disabled={busy} onClick={() => void run(async () => undefined)}>
              {t('google.signIn')}
            </button>
            <button
              type="button"
              disabled={busy || maps.length === 0}
              onClick={() => {
                close();
                void backup();
              }}
            >
              {t('google.backup')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                close();
                void restore();
              }}
            >
              {t('google.restore')}
            </button>
          </>
        )
      }
    </Dropdown>
  );
}
