import { useEffect, useRef } from 'react';
import type { MessageKey } from '../i18n';

interface Props {
  text: string;
  count: number;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  onNodeOnly(): void;
  onSubtree(): void;
  onCancel(): void;
}

export function ConfirmDelete({ text, count, t, onNodeOnly, onSubtree, onCancel }: Props) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-body"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id="delete-title">{t('delete.title')}</h2>
        <p id="delete-body">{t('delete.body', { text, count })}</p>
        <div className="modal-actions">
          <button ref={first} type="button" onClick={onNodeOnly}>
            {t('delete.nodeOnly')}
          </button>
          <button type="button" className="danger" onClick={onSubtree}>
            {t('delete.subtree')}
          </button>
          <button type="button" onClick={onCancel}>
            {t('delete.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
