/** Trigger a browser file download for ZIP bytes without uploading. */
export function downloadZipBytes(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Delay revoke so browsers that download asynchronously still see the blob.
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export function voicePackZipFilename(addonDirectory: string): string {
  return `${addonDirectory}.zip`;
}
