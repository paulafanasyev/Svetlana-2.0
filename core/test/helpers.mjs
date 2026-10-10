import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { encodeClientFrame } from "../lib/ws.mjs";

export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sv-"));
export function cfgFor(dir, extra = {}) {
  return { port: 0, host: "127.0.0.1", dataDir: dir, workspace: path.join(dir, "ws"), adminToken: "test-admin-token-123456", secret: "s3cret-s3cret", maxSteps: 8, chromium: "", aikoUrl: "", aikoToken: "", selfEmployedUrl: "", selfEmployedToken: "", commandAllow: ["node", "ls", "git"], allowHostExec: true, chromiumNoSandbox: true, runnerSocket: "", ...extra };
}
/** Сценарный «провайдер»: отвечает по очереди заранее заданными сообщениями OpenAI-формата. */
export function scriptedFetch(script, seen = []) {
  return async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null; seen.push({ url: String(url), body });
    const next = script.shift(); if (!next) throw new Error("script exhausted");
    if (next.status) return new Response(next.text || "err", { status: next.status });
    return new Response(JSON.stringify({ choices: [{ message: next, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
}
export const call = (name, args, id = "c_" + crypto.randomBytes(3).toString("hex")) => ({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
export const say = (content) => ({ role: "assistant", content });

/** Клиент WebSocket поверх TCP — изображает телефон/ПК. */
export function fakeDevice(port, token, handler, caps = ["screen", "control", "apps"]) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1"); const key = crypto.randomBytes(16).toString("base64"); let buf = Buffer.alloc(0), up = false;
    s.on("error", reject);
    s.write(`GET /ws/device?token=${token} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    const send = (o) => s.write(encodeClientFrame(JSON.stringify(o)));
    s.on("data", async (d) => {
      buf = Buffer.concat([buf, d]);
      if (!up) { const i = buf.indexOf("\r\n\r\n"); if (i < 0) return; const head = buf.subarray(0, i).toString(); if (!head.includes(" 101 ")) return reject(new Error(head)); up = true; buf = buf.subarray(i + 4); send({ type: "hello", platform: "android", name: "Тест", capabilities: caps }); resolve({ close: () => s.destroy() }); }
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f, off = 2; if (len === 126) { len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return; const op = buf[0] & 0x0f; const payload = buf.subarray(off, off + len).toString(); buf = buf.subarray(off + len);
        if (op !== 1) continue; const m = JSON.parse(payload);
        try { send({ id: m.id, result: await handler(m.method, m.params) }); } catch (e) { send({ id: m.id, error: e.message }); }
      }
    });
  });
}
