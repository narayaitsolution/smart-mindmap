import { useEffect, useState } from 'react';
import type { MessageKey } from '../i18n';

interface Props {
  t: (key: MessageKey) => string;
  onError(text: string): void;
}

const svgProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

const supported = () => typeof document !== 'undefined' && document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';

/** Icon-only fullscreen switch. The browser owns the state: the button follows `fullscreenchange`. */
export function FullscreenToggle({ t, onError }: Props) {
  const [active, setActive] = useState(() => document.fullscreenElement != null);
  const can = supported();

  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      onError(t('fullscreen.failed'));
    }
  };

  const label = !can ? t('fullscreen.unsupported') : active ? t('fullscreen.exit') : t('fullscreen.enter');
  return (
    <button type="button" className="icon" aria-label={label} title={label} disabled={!can} aria-pressed={can ? active : undefined} onClick={() => void toggle()}>
      {active ? (
        <svg className="icon-collapse" {...svgProps}>
          <path d="M9 3v4a2 2 0 0 1-2 2H3M21 9h-4a2 2 0 0 1-2-2V3M3 15h4a2 2 0 0 1 2 2v4M15 21v-4a2 2 0 0 1 2-2h4" />
        </svg>
      ) : (
        <svg className="icon-expand" {...svgProps}>
          <path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4" />
        </svg>
      )}
    </button>
  );
}
