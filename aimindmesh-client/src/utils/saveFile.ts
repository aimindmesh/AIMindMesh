/**
 * Saves binary data to a file chosen by the user: Tauri save dialog + fs plugin,
 * falling back to a browser download outside Tauri. Returns false if the user cancelled.
 */
export async function saveBinaryFile(data: ArrayBuffer, fileName: string): Promise<boolean> {
  let tauriDialog: typeof import('@tauri-apps/plugin-dialog') | null = null;
  let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null;
  try {
    tauriDialog = await import('@tauri-apps/plugin-dialog');
    tauriFs = await import('@tauri-apps/plugin-fs');
  } catch {
    // Not running inside Tauri
  }

  if (tauriDialog && tauriFs) {
    const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';
    const savePath = await tauriDialog.save({
      defaultPath: fileName,
      filters: ext ? [{ name: fileName, extensions: [ext] }] : undefined,
    });
    if (!savePath) return false;
    await tauriFs.writeFile(savePath, new Uint8Array(data));
    return true;
  }

  const url = URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
