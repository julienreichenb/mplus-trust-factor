export function readBits(buf: Uint8Array, bitOffset: number, length: number): { value: number; bitOffset: number } {
  let value = 0;
  let readOffset = 0;
  const firstByteShift = bitOffset % 8;
  const bytesToRead = Math.ceil((length + firstByteShift) / 8);
  while (readOffset < length) {
    const byteIndex = Math.floor((bitOffset + readOffset) / 8);
    const byte = buf[byteIndex] ?? 0;
    let bitsRead = 0;
    if (readOffset === 0) {
      if (bytesToRead === 1) {
        const availableBits = length - readOffset;
        value = (byte >>> firstByteShift) & ((1 << availableBits) - 1);
        bitsRead = length;
      } else {
        value = byte >>> firstByteShift;
        bitsRead = 8 - firstByteShift;
      }
    } else {
      const availableBits = length - readOffset;
      if (availableBits < 8) {
        value += (byte & ((1 << availableBits) - 1)) << readOffset;
        bitsRead = availableBits;
      } else {
        value += byte << readOffset;
        bitsRead = Math.min(8, length);
      }
    }
    readOffset += bitsRead;
  }
  return { value, bitOffset: bitOffset + length };
}

export function writeBits(
  buf: Uint8Array,
  bitOffset: number,
  length: number,
  value: number,
): number {
  let remaining = value >>> 0;
  let offset = bitOffset;
  let left = length;
  while (left > 0) {
    const byteIndex = Math.floor(offset / 8);
    const shift = offset % 8;
    const space = 8 - shift;
    const take = Math.min(space, left);
    const mask = (1 << take) - 1;
    buf[byteIndex] = (buf[byteIndex] ?? 0) | ((remaining & mask) << shift);
    remaining >>>= take;
    offset += take;
    left -= take;
  }
  return offset;
}
