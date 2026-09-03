export function copyToArrayBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function toUint8Array(
  data: Blob | ArrayBuffer | ArrayBufferView | Uint8Array,
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (isBlobLike(data)) {
    return blobToUint8Array(data);
  }
  throw new Error(`Unsupported binary payload: ${Object.prototype.toString.call(data)}`);
}

function isBlobLike(value: unknown): value is Blob {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Blob).size === "number" &&
    typeof (value as Blob).type === "string"
  );
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    try {
      const buffer = await blob.arrayBuffer();
      if (buffer.byteLength > 0 || blob.size === 0) {
        return new Uint8Array(buffer);
      }
    } catch {
      // Fall through for incomplete Blob implementations in tests.
    }
  }

  if (typeof blob.stream === "function") {
    const reader = blob.stream().getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (out.byteLength > 0 || blob.size === 0) return out;
  }

  if (typeof Blob !== "undefined" && blob instanceof Blob) {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob."));
      reader.readAsArrayBuffer(blob);
    });
  }

  throw new Error("Unsupported binary payload.");
}

export function bytesToMpegBlob(bytes: Uint8Array, mimeType = "audio/mpeg"): Blob {
  return new Blob([copyToArrayBuffer(bytes)], { type: mimeType });
}

export function restoreBinaryBlob(
  stored: unknown,
  mimeType = "audio/mpeg",
): Blob | null {
  if (stored instanceof Blob) {
    return stored.size > 0 ? stored : null;
  }
  if (stored instanceof ArrayBuffer) {
    return stored.byteLength > 0 ? new Blob([stored], { type: mimeType }) : null;
  }
  if (ArrayBuffer.isView(stored)) {
    const bytes = new Uint8Array(
      stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength),
    );
    return bytes.byteLength > 0 ? bytesToMpegBlob(bytes, mimeType) : null;
  }
  if (stored && typeof stored === "object" && "byteLength" in stored) {
    const view = stored as ArrayBuffer | ArrayBufferView;
    if (view instanceof ArrayBuffer) {
      return view.byteLength > 0 ? new Blob([view], { type: mimeType }) : null;
    }
    if (ArrayBuffer.isView(view)) {
      const bytes = new Uint8Array(
        view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
      );
      return bytes.byteLength > 0 ? bytesToMpegBlob(bytes, mimeType) : null;
    }
  }
  return null;
}
