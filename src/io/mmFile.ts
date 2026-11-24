/** Minimal File System Access API surface used by the app. Feature-detected; absent in Firefox and Safari. */
export interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface FileHandleLike {
  readonly name: string;
  createWritable(): Promise<WritableLike>;
  getFile(): Promise<File>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<string>;
}

interface PickerWindow {
  showSaveFilePicker?: (options: unknown) => Promise<FileHandleLike>;
  showOpenFilePicker?: (options: unknown) => Promise<FileHandleLike[]>;
}

const w = () => window as unknown as PickerWindow;

export const supportsSavePicker = () => typeof w().showSaveFilePicker === 'function';
export const supportsOpenPicker = () => typeof w().showOpenFilePicker === 'function';

/** The user dismissed a picker. This is not an error. */
export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export async function pickSaveHandle(suggestedName: string): Promise<FileHandleLike | null> {
  const picker = w().showSaveFilePicker;
  if (!picker) return null;
  try {
    return await picker.call(window, {
      suggestedName,
      types: [{ description: 'FreeMind mindmap', accept: { 'text/xml': ['.mm'] } }],
    });
  } catch (e) {
    if (isAbortError(e)) return null;
    throw e;
  }
}

export async function pickOpenHandle(): Promise<FileHandleLike | null> {
  const picker = w().showOpenFilePicker;
  if (!picker) return null;
  try {
    const [handle] = await picker.call(window, {
      multiple: false,
      types: [{ description: 'Mindmap files', accept: { 'text/xml': ['.mm'], 'application/json': ['.json'] } }],
    });
    return handle ?? null;
  } catch (e) {
    if (isAbortError(e)) return null;
    throw e;
  }
}

/** True when the handle can be written. Asks the user at most once, and only when permission is not yet granted. */
export async function ensureWritable(handle: FileHandleLike): Promise<boolean> {
  if (!handle.queryPermission) return true;
  try {
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    if (!handle.requestPermission) return false;
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

export async function writeText(handle: FileHandleLike, text: string): Promise<void> {
  const stream = await handle.createWritable();
  try {
    await stream.write(text);
    await stream.close();
  } catch (e) {
    await stream.abort?.().catch(() => undefined);
    throw e;
  }
}
