// Минимальный WebSocket (RFC 6455) без зависимостей: текстовые кадры, фрагментация, ping/pong, close, лимит размера.
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_MESSAGE = 24 * 1024 * 1024; // скриншот 4K в base64 помещается

export class WsConn extends EventEmitter {
  constructor(socket) {
    super(); this.socket = socket; this.buf = Buffer.alloc(0); this.frag = []; this.fragSize = 0; this.closed = false;
    socket.on("data", (d) => this.onData(d)); socket.on("close", () => this.finish()); socket.on("error", () => this.finish());
    this.pinger = setInterval(() => this.frame(0x9, Buffer.alloc(0)), 25000);
  }
  finish() { if (this.closed) return; this.closed = true; clearInterval(this.pinger); this.emit("close"); }
  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (this.buf.length > MAX_MESSAGE + 14) return this.close(1009);
    for (;;) {
      if (this.closed || this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1]; const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      if (b0 & 0x70) return this.close(1002);                 // RSV-биты без расширений запрещены
      if (!masked) return this.close(1002);                   // клиент обязан маскировать
      const control = op >= 0x8;
      if (![0x0, 0x1, 0x2, 0x8, 0x9, 0xA].includes(op)) return this.close(1002);
      let len = b1 & 0x7f, off = 2;
      if (control && (!fin || len > 125)) return this.close(1002);
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > BigInt(MAX_MESSAGE)) return this.close(1009); len = Number(big); off = 10; }
      if (len > MAX_MESSAGE || this.fragSize + len > MAX_MESSAGE) return this.close(1009);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4); const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) return this.close(1000);
      if (op === 0x9) { this.frame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x0 && !this.frag.length) return this.close(1002);   // продолжение без начала
      if (op !== 0x0 && this.frag.length) return this.close(1002);    // новое сообщение посреди фрагментированного
      this.frag.push(payload); this.fragSize += payload.length;
      if (fin) { const msg = Buffer.concat(this.frag).toString("utf8"); this.frag = []; this.fragSize = 0; this.emit("message", msg); }
    }
  }
  frame(op, payload) {
    if (this.closed) return;
    const len = payload.length; let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    if (this.socket.writableLength > 64 * 1024 * 1024) return this.close(1008); // клиент не читает — не копим память
    this.socket.write(Buffer.concat([head, payload]));
  }
  send(text) { this.frame(0x1, Buffer.from(text, "utf8")); }
  close(code = 1000) { if (!this.closed) { const b = Buffer.alloc(2); b.writeUInt16BE(code); this.frame(0x8, b); this.socket.end(); } this.finish(); }
}

export function acceptUpgrade(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key || req.headers.upgrade?.toLowerCase() !== "websocket") { socket.destroy(); return null; }
  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  const proto = (req.headers["sec-websocket-protocol"] || "").split(",")[0].trim();
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${proto ? `Sec-WebSocket-Protocol: ${proto}\r\n` : ""}\r\n`);
  return new WsConn(socket);
}

/** Клиент WebSocket для тестов и для агента на Node (маскирует кадры). */
export function encodeClientFrame(text) {
  const p = Buffer.from(text, "utf8"); const mask = crypto.randomBytes(4); const len = p.length; let head;
  if (len < 126) head = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
  const out = Buffer.from(p); for (let i = 0; i < out.length; i++) out[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, out]);
}
