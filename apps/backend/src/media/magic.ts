/**
 * 方案第 9.3 节魔数。声明与魔数不一致时以魔数为准。SVG 拒绝。
 */

export type MagicKind = "image" | "video" | "audio" | "unknown";

export type MagicName =
  | "png"
  | "jpeg"
  | "webp"
  | "gif"
  | "mp4"
  | "webm"
  | "wav"
  | "mp3"
  | "flac"
  | "svg"
  | null;

export type SniffResult = {
  matched: boolean;
  magic: MagicName;
  mimeDetected: string | null;
  kind: MagicKind;
  width: number | null;
  height: number | null;
  svg: boolean;
};

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function startsWith(bytes: Uint8Array, sig: Uint8Array, offset = 0): boolean {
  if (bytes.length < offset + sig.length) {
    return false;
  }
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[offset + i] !== sig[i]) {
      return false;
    }
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) {
    return false;
  }
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function skipWsAndBom(bytes: Uint8Array): number {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  while (i < bytes.length) {
    const b = bytes[i] ?? 0;
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

export function looksLikeSvg(bytes: Uint8Array): boolean {
  const start = skipWsAndBom(bytes);
  const head = Buffer.from(bytes.subarray(start, Math.min(bytes.length, start + 800))).toString("utf8");
  const trimmed = head.trimStart().toLowerCase();
  if (trimmed.startsWith("<svg")) {
    return true;
  }
  if (trimmed.startsWith("<!doctype svg")) {
    return true;
  }
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<!doctype")) {
    return trimmed.includes("<svg");
  }
  return false;
}

function readU16be(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 2) {
    return null;
  }
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU32be(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 4) {
    return null;
  }
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) {
    return null;
  }
  const width = readU32be(bytes, 16);
  const height = readU32be(bytes, 20);
  if (width === null || height === null || width === 0 || height === 0) {
    return null;
  }
  return { width, height };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    while (i < bytes.length && bytes[i] === 0xff) {
      i += 1;
    }
    if (i >= bytes.length) {
      break;
    }
    const marker = bytes[i] ?? 0;
    i += 1;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      continue;
    }
    if (marker === 0x01) {
      continue;
    }
    const len = readU16be(bytes, i);
    if (len === null || len < 2) {
      break;
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (i + 7 >= bytes.length) {
        break;
      }
      const height = readU16be(bytes, i + 3);
      const width = readU16be(bytes, i + 5);
      if (width !== null && height !== null && width > 0 && height > 0) {
        return { width, height };
      }
      break;
    }
    i += len;
  }
  return null;
}

function gifSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) {
    return null;
  }
  const width = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
  const height = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  if (width === 0 || height === 0) {
    return null;
  }
  return { width, height };
}

function readBitsLe(bytes: Uint8Array, bitOffset: number, n: number): number {
  let value = 0;
  for (let i = 0; i < n; i += 1) {
    const bitIndex = bitOffset + i;
    const byte = bytes[Math.floor(bitIndex / 8)] ?? 0;
    const bit = (byte >> (bitIndex % 8)) & 1;
    value |= bit << i;
  }
  return value;
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30 || !asciiAt(bytes, 0, "RIFF") || !asciiAt(bytes, 8, "WEBP")) {
    return null;
  }
  if (asciiAt(bytes, 12, "VP8L")) {
    if (bytes.length < 22 || bytes[20] !== 0x2f) {
      return null;
    }
    const bits = bytes.subarray(21);
    const width = readBitsLe(bits, 0, 14) + 1;
    const height = readBitsLe(bits, 14, 14) + 1;
    return { width, height };
  }
  if (asciiAt(bytes, 12, "VP8X") && bytes.length >= 30) {
    const width =
      1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const height =
      1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    return { width, height };
  }
  if (asciiAt(bytes, 12, "VP8 ") && bytes.length >= 30) {
    const width = (bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8);
    const height = (bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8);
    const w = width & 0x3fff;
    const h = height & 0x3fff;
    if (w === 0 || h === 0) {
      return null;
    }
    return { width: w, height: h };
  }
  return null;
}

function unknown(): SniffResult {
  return {
    matched: false,
    magic: null,
    mimeDetected: null,
    kind: "unknown",
    width: null,
    height: null,
    svg: false,
  };
}

function result(
  magic: Exclude<MagicName, null>,
  mime: string,
  kind: MagicKind,
  size: { width: number; height: number } | null,
): SniffResult {
  return {
    matched: true,
    magic,
    mimeDetected: mime,
    kind,
    width: size?.width ?? null,
    height: size?.height ?? null,
    svg: false,
  };
}

export function sniffMagic(bytes: Uint8Array): SniffResult {
  if (bytes.length === 0) {
    return unknown();
  }
  if (startsWith(bytes, PNG_SIG)) {
    return result("png", "image/png", "image", pngSize(bytes));
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return result("jpeg", "image/jpeg", "image", jpegSize(bytes));
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return result("webp", "image/webp", "image", webpSize(bytes));
  }
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) {
    return result("gif", "image/gif", "image", gifSize(bytes));
  }
  if (asciiAt(bytes, 4, "ftyp")) {
    return result("mp4", "video/mp4", "video", null);
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return result("webm", "video/webm", "video", null);
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE")) {
    return result("wav", "audio/wav", "audio", null);
  }
  if (asciiAt(bytes, 0, "fLaC")) {
    return result("flac", "audio/flac", "audio", null);
  }
  if (asciiAt(bytes, 0, "ID3") || (bytes[0] === 0xff && (((bytes[1] ?? 0) & 0xe0) === 0xe0))) {
    return result("mp3", "audio/mpeg", "audio", null);
  }
  if (looksLikeSvg(bytes)) {
    return {
      matched: false,
      magic: "svg",
      mimeDetected: "image/svg+xml",
      kind: "unknown",
      width: null,
      height: null,
      svg: true,
    };
  }
  return unknown();
}

export const PREVIEW_IMAGE_MAGICS: ReadonlySet<string> = new Set(["png", "jpeg", "webp", "gif"]);
