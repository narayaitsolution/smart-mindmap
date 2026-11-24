interface Props {
  label: string;
  theme: 'light' | 'dark';
  onToggle(next: 'light' | 'dark'): void;
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

/** Icon-only theme switch. The sun shows in light theme, the moon in dark theme. */
export function ThemeToggle({ label, theme, onToggle }: Props) {
  const dark = theme === 'dark';
  return (
    <button type="button" className="icon" aria-label={label} aria-pressed={dark} onClick={() => onToggle(dark ? 'light' : 'dark')}>
      {dark ? (
        <svg className="icon-moon" {...svgProps}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : (
        <svg className="icon-sun" {...svgProps}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
