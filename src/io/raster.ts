import { buildPdf } from './pdf';
import { renderMapSvg } from './svg';
import type { Mindmap } from '../model/mindmap';

export const MAX_SIDE = 8000;

/** Browsers refuse canvases past a few thousand pixels; shrink the scale instead of failing. */
export function clampScale(width: number, height: number, scale: number): number {
  return Math.min(scale, MAX_SIDE / Math.max(width, height));
}

export function dataUrlToBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render the mindmap image'));
    img.src = src;
  });
}

/** The one SVG every export format (SVG, PNG, JPG, PDF) is built from, so notes are included in all of them. */
export const rasterSvgInput = (map: Mindmap) => renderMapSvg(map, { background: '#ffffff' });

async function renderCanvas(map: Mindmap, scale = 2) {
  const { svg, width, height } = rasterSvgInput(map);
  const s = clampScale(width, height, scale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * s));
  canvas.height = Math.max(1, Math.round(height * s));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, width, height };
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type, quality),
  );

export async function mapToPng(map: Mindmap): Promise<Blob> {
  return toBlob((await renderCanvas(map)).canvas, 'image/png');
}

export async function mapToJpg(map: Mindmap): Promise<Blob> {
  return toBlob((await renderCanvas(map)).canvas, 'image/jpeg', 0.92);
}

export function mapToSvg(map: Mindmap): Blob {
  return new Blob([rasterSvgInput(map).svg], { type: 'image/svg+xml' });
}

export async function mapToPdf(map: Mindmap): Promise<Blob> {
  const { canvas, width, height } = await renderCanvas(map);
  const jpeg = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92));
  // 1 CSS px = 0.75 pt keeps the printed size close to the on-screen size.
  const bytes = buildPdf({
    jpeg,
    width: canvas.width,
    height: canvas.height,
    pageWidth: Math.round(width * 0.75),
    pageHeight: Math.round(height * 0.75),
  });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
