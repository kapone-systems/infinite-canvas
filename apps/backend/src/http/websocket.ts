/**
 * 最小 WebSocket（文本帧 + ping/pong + close）。无第三方 ws 包。
 * 升级禁止 inspectRequest；子协议 canvas-bearer + canvas-bearer.<token>。
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const WS_BEARER_PROTOCOL = "canvas-bearer";

export function secWebSocketAccept(key: string): string {
  return createHash("sha1").update(`${key}${GUID}`).digest("base64");
}

export function parseSubprotocols(header: string | undefined): string[] {
  if (header === undefined || header.length === 0) {
    return [];
  }
  return header.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

export function tokenFromSubprotocols(protocols: readonly string[]): string | null {
  const prefix = `${WS_BEARER_PROTOCOL}.`;
  for (const item of protocols) {
    if (item.startsWith(prefix)) {
      const token = item.slice(prefix.length);
      if (token.length > 0) {
        return token;
      }
    }
  }
  return null;
}

function encodeTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload, "utf8");
  const len = data.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, data]);
}

function encodeCloseFrame(code = 1000): Buffer {
  const buf = Buffer.alloc(4);
  buf[0] = 0x88;
  buf[1] = 2;
  buf.writeUInt16BE(code, 2);
  return buf;
}

function encodePong(payload: Buffer): Buffer {
  const header = Buffer.alloc(2);
  header[0] = 0x8a;
  header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

export type WsSession = {
  sendText: (text: string) => void;
  close: (code?: number) => void;
};

export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  protocol: string,
  onMessage?: (text: string) => void,
): WsSession | null {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || key.length === 0) {
    return null;
  }
  const accept = secWebSocketAccept(key);
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      `Sec-WebSocket-Protocol: ${protocol}\r\n` +
      `\r\n`,
  );
  if (head.length > 0) {
    socket.unshift(head);
  }
  let buffer = Buffer.alloc(0);
  let closed = false;
  const session: WsSession = {
    sendText(text: string): void {
      if (closed) {
        return;
      }
      socket.write(encodeTextFrame(text));
    },
    close(code = 1000): void {
      if (closed) {
        return;
      }
      closed = true;
      try {
        socket.write(encodeCloseFrame(code));
      } catch {
        /* ignore */
      }
      socket.end();
    },
  };
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const first = buffer[0] ?? 0;
      const second = buffer[1] ?? 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let len = second & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) {
          return;
        }
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) {
          return;
        }
        len = buffer.readUInt32BE(6);
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buffer.length < offset + maskLen + len) {
        return;
      }
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      offset += maskLen;
      const payload = Buffer.from(buffer.subarray(offset, offset + len));
      buffer = buffer.subarray(offset + len);
      if (mask !== null) {
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
        }
      }
      if (opcode === 0x8) {
        session.close();
        return;
      }
      if (opcode === 0x9) {
        socket.write(encodePong(payload));
        continue;
      }
      if (opcode === 0x1 && onMessage !== undefined) {
        onMessage(payload.toString("utf8"));
      }
    }
  });
  socket.on("error", () => {
    closed = true;
  });
  socket.on("close", () => {
    closed = true;
  });
  return session;
}
