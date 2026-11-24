import { useState } from 'react';
import type { MessageKey } from '../i18n';

interface Props {
  mapId: string;
  title: string;
  t: (key: MessageKey) => string;
  onRename(title: string): void;
}

/** Editable title shown above the map. An empty title is never stored. */
export function MapTitle({ mapId, title, t, onRename }: Props) {
  const [draft, setDraft] = useState<{ mapId: string; value: string } | null>(null);
  const value = draft && draft.mapId === mapId ? draft.value : title;

  return (
    <input
      className="map-title"
      type="text"
      maxLength={200}
      aria-label={t('maps.rename')}
      value={value}
      onChange={(e) => {
        setDraft({ mapId, value: e.target.value });
        if (e.target.value.trim() !== '') onRename(e.target.value);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
