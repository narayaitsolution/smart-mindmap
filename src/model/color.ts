const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Only hex colors are accepted anywhere colors enter from outside (imports, storage). */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

export function readableTextColor(bg: string | undefined): string {
  if (!isHexColor(bg)) return '#000000';
  let h = bg.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.179 ? '#000000' : '#ffffff';
}

/** Default palette offered as one-click swatches. `id` keys the translated color name. */
export const SWATCHES = [
  { id: 'black', hex: '#000000' },
  { id: 'gray', hex: '#6b7280' },
  { id: 'red', hex: '#dc2626' },
  { id: 'orange', hex: '#f97316' },
  { id: 'yellow', hex: '#facc15' },
  { id: 'green', hex: '#16a34a' },
  { id: 'teal', hex: '#0d9488' },
  { id: 'blue', hex: '#2563eb' },
  { id: 'purple', hex: '#7c3aed' },
  { id: 'pink', hex: '#ec4899' },
] as const;

export type SwatchId = (typeof SWATCHES)[number]['id'];
