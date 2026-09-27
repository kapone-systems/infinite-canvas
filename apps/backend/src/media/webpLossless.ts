/**
 * 进程内 VP8L（无损 WebP）。装不上原生解码库时用它出 thumb-webp-longedge-512-v1。
 * 不经过 ffmpeg。
 */

const NUM_LITERAL_CODES = 256;
const NUM_LENGTH_CODES = 24;
const NUM_DISTANCE_CODES = 40;
const GREEN_ALPHABET = NUM_LITERAL_CODES + NUM_LENGTH_CODES;
const CODE_LENGTH_CODES = 19;
const CODE_LENGTH_CODE_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

class BitWriter {
  private bits = 0;
  private count = 0;
  private readonly bytes: number[] = [];

  writeBits(value: number, n: number): void {
    if (n <= 0) {
      return;
    }
    this.bits |= (value & ((1 << n) - 1)) << this.count;
    this.count += n;
    while (this.count >= 8) {
      this.bytes.push(this.bits & 0xff);
      this.bits >>>= 8;
      this.count -= 8;
    }
  }

  finish(): Buffer {
    if (this.count > 0) {
      this.bytes.push(this.bits & 0xff);
    }
    return Buffer.from(this.bytes);
  }
}

class BitReader {
  private bitOffset = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  readBits(n: number): number {
    if (n <= 0) {
      return 0;
    }
    let value = 0;
    for (let i = 0; i < n; i += 1) {
      const byteIndex = Math.floor(this.bitOffset / 8);
      const byte = this.bytes[byteIndex] ?? 0;
      const bit = (byte >> (this.bitOffset % 8)) & 1;
      value |= bit << i;
      this.bitOffset += 1;
    }
    return value;
  }
}

type HuffSym = { code: number; len: number };

function reverseBits(value: number, n: number): number {
  let r = 0;
  let v = value;
  for (let i = 0; i < n; i += 1) {
    r = (r << 1) | (v & 1);
    v >>= 1;
  }
  return r;
}

function equalLengthCodes(used: boolean[]): number[] {
  const lengths = used.map(() => 0);
  let k = 0;
  let first = -1;
  for (let i = 0; i < used.length; i += 1) {
    if (used[i] === true) {
      k += 1;
      if (first < 0) {
        first = i;
      }
    }
  }
  if (k === 0) {
    lengths[0] = 1;
    return lengths;
  }
  if (k === 1 && first >= 0) {
    lengths[first] = 1;
    return lengths;
  }
  const L = Math.ceil(Math.log2(k));
  for (let i = 0; i < used.length; i += 1) {
    if (used[i] === true) {
      lengths[i] = L;
    }
  }
  return lengths;
}

function lengthsToCodes(lengths: readonly number[]): HuffSym[] {
  const maxLen = lengths.reduce((m, l) => (l > m ? l : m), 0);
  const blCount = new Array<number>(maxLen + 1).fill(0);
  for (const l of lengths) {
    if (l > 0) {
      blCount[l] = (blCount[l] ?? 0) + 1;
    }
  }
  const nextCode = new Array<number>(maxLen + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits += 1) {
    code = (code + (blCount[bits - 1] ?? 0)) << 1;
    nextCode[bits] = code;
  }
  return lengths.map((len) => {
    if (len <= 0) {
      return { code: 0, len: 0 };
    }
    const assigned = nextCode[len] ?? 0;
    nextCode[len] = assigned + 1;
    return { code: assigned, len };
  });
}

function countUsed(lengths: readonly number[]): { count: number; symbols: number[] } {
  const symbols: number[] = [];
  for (let i = 0; i < lengths.length; i += 1) {
    if ((lengths[i] ?? 0) > 0) {
      symbols.push(i);
    }
  }
  return { count: symbols.length, symbols };
}

function storeHuffman(bw: BitWriter, lengths: number[]): void {
  const { count, symbols } = countUsed(lengths);
  const first = symbols[0] ?? 0;
  const second = symbols[1];
  const simpleOk =
    count >= 1 &&
    count <= 2 &&
    first <= 255 &&
    (second === undefined || second <= 255);
  if (simpleOk) {
    bw.writeBits(1, 1);
    bw.writeBits(count - 1, 1);
    if (first < 2) {
      bw.writeBits(0, 1);
      bw.writeBits(first, 1);
    } else {
      bw.writeBits(1, 1);
      bw.writeBits(first, 8);
    }
    if (count === 2 && second !== undefined) {
      bw.writeBits(second, 8);
    }
    return;
  }
  bw.writeBits(0, 1);
  const clUsed = new Array<boolean>(CODE_LENGTH_CODES).fill(false);
  for (const L of lengths) {
    clUsed[L] = true;
  }
  const clLengths = equalLengthCodes(clUsed);
  let numCodeLengthCodes = 4;
  for (let i = CODE_LENGTH_CODE_ORDER.length - 1; i >= 0; i -= 1) {
    const sym = CODE_LENGTH_CODE_ORDER[i] ?? 0;
    if ((clLengths[sym] ?? 0) > 0) {
      numCodeLengthCodes = Math.max(4, i + 1);
      break;
    }
  }
  bw.writeBits(numCodeLengthCodes - 4, 4);
  for (let i = 0; i < numCodeLengthCodes; i += 1) {
    const sym = CODE_LENGTH_CODE_ORDER[i] ?? 0;
    bw.writeBits(clLengths[sym] ?? 0, 3);
  }
  const clCodes = lengthsToCodes(clLengths);
  for (const L of lengths) {
    const entry = clCodes[L] ?? { code: 0, len: 0 };
    bw.writeBits(reverseBits(entry.code, entry.len), entry.len);
  }
}

function channelLengths(values: Uint8Array, alphabetSize: number): number[] {
  const used = new Array<boolean>(alphabetSize).fill(false);
  for (const v of values) {
    used[v] = true;
  }
  if (!used.some(Boolean)) {
    used[0] = true;
  }
  return equalLengthCodes(used);
}

type HuffEnc = { kind: "simple"; symbols: number[] } | { kind: "tree"; codes: HuffSym[] };

function encoderFor(lengths: number[]): HuffEnc {
  const { count, symbols } = countUsed(lengths);
  const first = symbols[0] ?? 0;
  const second = symbols[1];
  const simpleOk =
    count >= 1 &&
    count <= 2 &&
    first <= 255 &&
    (second === undefined || second <= 255);
  if (simpleOk) {
    return { kind: "simple", symbols };
  }
  return { kind: "tree", codes: lengthsToCodes(lengths) };
}

function emitSymbol(bw: BitWriter, enc: HuffEnc, symbol: number): void {
  if (enc.kind === "simple") {
    if (enc.symbols.length <= 1) {
      return;
    }
    bw.writeBits(enc.symbols[0] === symbol ? 0 : 1, 1);
    return;
  }
  const entry = enc.codes[symbol];
  if (entry === undefined || entry.len < 0) {
    throw new Error("huff");
  }
  bw.writeBits(reverseBits(entry.code, entry.len), entry.len);
}

function wrapVp8l(payload: Buffer): Buffer {
  const pad = payload.length & 1;
  const chunkSize = payload.length;
  const file = Buffer.alloc(20 + chunkSize + pad);
  file.write("RIFF", 0);
  file.writeUInt32LE(12 + chunkSize + pad, 4);
  file.write("WEBP", 8);
  file.write("VP8L", 12);
  file.writeUInt32LE(chunkSize, 16);
  payload.copy(file, 20);
  return file;
}

export function encodeWebpLossless(width: number, height: number, rgba: Uint8Array): Buffer {
  if (width < 1 || height < 1 || width > 16384 || height > 16384) {
    throw new Error("webp size");
  }
  if (rgba.length !== width * height * 4) {
    throw new Error("webp rgba");
  }
  const n = width * height;
  const greens = new Uint8Array(n);
  const reds = new Uint8Array(n);
  const blues = new Uint8Array(n);
  const alphas = new Uint8Array(n);
  let alphaUsed = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    reds[i] = rgba[o] ?? 0;
    greens[i] = rgba[o + 1] ?? 0;
    blues[i] = rgba[o + 2] ?? 0;
    alphas[i] = rgba[o + 3] ?? 0;
    if ((alphas[i] ?? 0) !== 255) {
      alphaUsed = 1;
    }
  }
  const bw = new BitWriter();
  bw.writeBits(0x2f, 8);
  bw.writeBits(width - 1, 14);
  bw.writeBits(height - 1, 14);
  bw.writeBits(alphaUsed, 1);
  bw.writeBits(0, 3);
  bw.writeBits(0, 1);
  bw.writeBits(0, 1);
  const gLen = channelLengths(greens, GREEN_ALPHABET);
  const rLen = channelLengths(reds, NUM_LITERAL_CODES);
  const bLen = channelLengths(blues, NUM_LITERAL_CODES);
  const aLen = channelLengths(alphas, NUM_LITERAL_CODES);
  const dUsed = new Array<boolean>(NUM_DISTANCE_CODES).fill(false);
  dUsed[0] = true;
  const dLen = equalLengthCodes(dUsed);
  storeHuffman(bw, gLen);
  storeHuffman(bw, rLen);
  storeHuffman(bw, bLen);
  storeHuffman(bw, aLen);
  storeHuffman(bw, dLen);
  const gEnc = encoderFor(gLen);
  const rEnc = encoderFor(rLen);
  const bEnc = encoderFor(bLen);
  const aEnc = encoderFor(aLen);
  for (let i = 0; i < n; i += 1) {
    emitSymbol(bw, gEnc, greens[i] ?? 0);
    emitSymbol(bw, rEnc, reds[i] ?? 0);
    emitSymbol(bw, bEnc, blues[i] ?? 0);
    emitSymbol(bw, aEnc, alphas[i] ?? 0);
  }
  return wrapVp8l(bw.finish());
}

type HuffNode = { sym?: number; child?: [HuffNode, HuffNode] };

function treeFromLengths(lengths: readonly number[]): HuffNode {
  const codes = lengthsToCodes(lengths);
  const root: HuffNode = {};
  for (let sym = 0; sym < lengths.length; sym += 1) {
    const entry = codes[sym];
    if (entry === undefined || entry.len === 0) {
      continue;
    }
    let node = root;
    for (let i = entry.len - 1; i >= 0; i -= 1) {
      const bit = (entry.code >> i) & 1;
      if (node.child === undefined) {
        node.child = [{}, {}];
      }
      const next = node.child[bit];
      if (next === undefined) {
        throw new Error("huff tree");
      }
      node = next;
    }
    node.sym = sym;
  }
  return root;
}

function decodeSymbol(br: BitReader, simple: { symbols: number[] } | { root: HuffNode }): number {
  if ("symbols" in simple) {
    if (simple.symbols.length === 1) {
      return simple.symbols[0] ?? 0;
    }
    const bit = br.readBits(1);
    return simple.symbols[bit] ?? 0;
  }
  let node = simple.root;
  while (node.sym === undefined) {
    const bit = br.readBits(1);
    const child = node.child?.[bit];
    if (child === undefined) {
      throw new Error("huff decode");
    }
    node = child;
  }
  return node.sym;
}

function readHuffman(br: BitReader, alphabetSize: number): { symbols: number[] } | { root: HuffNode } {
  const isSimple = br.readBits(1) === 1;
  if (isSimple) {
    const num = br.readBits(1) + 1;
    const firstBits = br.readBits(1) === 1 ? 8 : 1;
    const first = br.readBits(firstBits);
    const symbols = [first];
    if (num === 2) {
      symbols.push(br.readBits(8));
    }
    return { symbols };
  }
  const numCodeLengthCodes = 4 + br.readBits(4);
  const clLengths = new Array<number>(CODE_LENGTH_CODES).fill(0);
  for (let i = 0; i < numCodeLengthCodes; i += 1) {
    const sym = CODE_LENGTH_CODE_ORDER[i] ?? 0;
    clLengths[sym] = br.readBits(3);
  }
  const clTree = treeFromLengths(clLengths);
  const lengths = new Array<number>(alphabetSize).fill(0);
  for (let i = 0; i < alphabetSize; i += 1) {
    lengths[i] = decodeSymbol(br, { root: clTree });
  }
  return { root: treeFromLengths(lengths) };
}

export function decodeWebpLossless(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  if (
    bytes.length < 21 ||
    bytes[0] !== 0x52 ||
    bytes[8] !== 0x57 ||
    bytes[12] !== 0x56 ||
    bytes[20] !== 0x2f
  ) {
    throw new Error("webp");
  }
  const payload = bytes.subarray(21);
  const br = new BitReader(payload);
  const width = br.readBits(14) + 1;
  const height = br.readBits(14) + 1;
  br.readBits(1);
  const version = br.readBits(3);
  if (version !== 0) {
    throw new Error("webp version");
  }
  if (br.readBits(1) !== 0) {
    throw new Error("webp transform");
  }
  if (br.readBits(1) !== 0) {
    throw new Error("webp cache");
  }
  const g = readHuffman(br, GREEN_ALPHABET);
  const r = readHuffman(br, NUM_LITERAL_CODES);
  const b = readHuffman(br, NUM_LITERAL_CODES);
  const a = readHuffman(br, NUM_LITERAL_CODES);
  readHuffman(br, NUM_DISTANCE_CODES);
  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    const gV = decodeSymbol(br, g);
    const rV = decodeSymbol(br, r);
    const bV = decodeSymbol(br, b);
    const aV = decodeSymbol(br, a);
    const o = i * 4;
    rgba[o] = rV;
    rgba[o + 1] = gV;
    rgba[o + 2] = bV;
    rgba[o + 3] = aV;
  }
  return { width, height, rgba };
}
