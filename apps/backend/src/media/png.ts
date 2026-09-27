/**
 * 手写 8-bit PNG（测试与缩略图解码）。不依赖原生图片库。
 */
import { crc32, deflateSync, inflateSync } from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  const crcInput = Buffer.concat([typeBuf, Buffer.from(data)]);
  crcBuf.writeUInt32BE(crc32(crcInput) >>> 0);
  return Buffer.concat([len, crcInput, crcBuf]);
}

export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  if (width < 1 || height < 1 || rgba.length !== width * height * 4) {
    throw new Error("png size");
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    const src = y * width * 4;
    raw.set(rgba.subarray(src, src + width * 4), rowStart + 1);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src] ?? 0;
    src += 1;
    const dest = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i] ?? 0;
      const a = i >= bpp ? (out[dest + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (out[dest - stride + i] ?? 0) : 0;
      const c = y > 0 && i >= bpp ? (out[dest - stride + i - bpp] ?? 0) : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = x;
          break;
        case 1:
          v = (x + a) & 255;
          break;
        case 2:
          v = (x + b) & 255;
          break;
        case 3:
          v = (x + ((a + b) >> 1)) & 255;
          break;
        case 4:
          v = (x + paeth(a, b, c)) & 255;
          break;
        default:
          throw new Error("png filter");
      }
      out[dest + i] = v;
    }
    src += stride;
  }
  return out;
}

export type DecodedRgba = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

export function decodePngRgba(bytes: Uint8Array): DecodedRgba {
  if (bytes.length < 8 || !PNG_SIG.equals(Buffer.from(bytes.subarray(0, 8)))) {
    throw new Error("png sig");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idats: Buffer[] = [];
  let palette: Uint8Array | null = null;
  let trans: Uint8Array | null = null;
  while (offset + 12 <= bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) {
      throw new Error("png chunk");
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (data.length < 13) {
        throw new Error("ihdr");
      }
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = view.getUint32(0);
      height = view.getUint32(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (type === "PLTE") {
      palette = Uint8Array.from(data);
    } else if (type === "tRNS") {
      trans = Uint8Array.from(data);
    } else if (type === "IDAT") {
      idats.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (width < 1 || height < 1 || bitDepth !== 8 || interlace !== 0) {
    throw new Error("png format");
  }
  const inflated = inflateSync(Buffer.concat(idats));
  let bpp: number;
  if (colorType === 6) {
    bpp = 4;
  } else if (colorType === 2) {
    bpp = 3;
  } else if (colorType === 0) {
    bpp = 1;
  } else if (colorType === 4) {
    bpp = 2;
  } else if (colorType === 3) {
    bpp = 1;
  } else {
    throw new Error("png color");
  }
  const expected = height * (1 + width * bpp);
  if (inflated.length < expected) {
    throw new Error("png idat");
  }
  const samples = unfilter(inflated.subarray(0, expected), width, height, bpp);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    if (colorType === 6) {
      rgba[o] = samples[i * 4] ?? 0;
      rgba[o + 1] = samples[i * 4 + 1] ?? 0;
      rgba[o + 2] = samples[i * 4 + 2] ?? 0;
      rgba[o + 3] = samples[i * 4 + 3] ?? 0;
    } else if (colorType === 2) {
      rgba[o] = samples[i * 3] ?? 0;
      rgba[o + 1] = samples[i * 3 + 1] ?? 0;
      rgba[o + 2] = samples[i * 3 + 2] ?? 0;
      rgba[o + 3] = 255;
    } else if (colorType === 0) {
      const g = samples[i] ?? 0;
      rgba[o] = g;
      rgba[o + 1] = g;
      rgba[o + 2] = g;
      rgba[o + 3] = 255;
    } else if (colorType === 4) {
      const g = samples[i * 2] ?? 0;
      rgba[o] = g;
      rgba[o + 1] = g;
      rgba[o + 2] = g;
      rgba[o + 3] = samples[i * 2 + 1] ?? 0;
    } else if (colorType === 3) {
      if (palette === null) {
        throw new Error("png plte");
      }
      const idx = samples[i] ?? 0;
      rgba[o] = palette[idx * 3] ?? 0;
      rgba[o + 1] = palette[idx * 3 + 1] ?? 0;
      rgba[o + 2] = palette[idx * 3 + 2] ?? 0;
      rgba[o + 3] = trans?.[idx] ?? 255;
    }
  }
  return { width, height, rgba };
}
