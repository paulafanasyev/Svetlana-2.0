import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Confirmations } from "../lib/confirm.mjs";
import { validate } from "../lib/tools/registry.mjs";
import { safePath, codeTools } from "../lib/tools/code.mjs";
import { npdReport, businessTools } from "../lib/tools/business.mjs";
import { md, docTools, findChromium } from "../lib/tools/docs.mjs";
import { Providers, textToolCalls, toAnthropic } from "../lib/providers.mjs";
import { webTools, assertPublicUrl } from "../lib/tools/connectors.mjs";
import { Store } from "../lib/store.mjs";
import { tmp, cfgFor, scriptedFetch } from "./helpers.mjs";

test("подтверждение: привязано к аргументам, одноразовое, истекает", () => {
  const c = new Confirmations("k");
  const t = c.issue("code_run", { command: "node", args: ["a"] });
  assert.equal(c.consume(t, "code_run", { command: "node", args: ["b"] }), false, "другие аргументы");
  assert.equal(c.consume(t, "code_write", { command: "node", args: ["a"] }), false, "другой инструмент");
  assert.equal(c.consume(t, "code_run", { args: ["a"], command: "node" }), true, "порядок ключей не важен");
  assert.equal(c.consume(t, "code_run", { command: "node", args: ["a"] }), false, "второй раз нельзя");
  const old = c.issue("x", {}, Date.now() - 11 * 60_000); assert.equal(c.consume(old, "x", {}), false, "истёк");
  assert.equal(c.consume("garbage", "x", {}), false);
});

test("схема аргументов: типы, обязательные, лишние, enum", () => {
  const s = { type: "object", properties: { a: { type: "string", maxLength: 3 }, n: { type: "integer", minimum: 1 }, e: { type: "string", enum: ["x"] } }, required: ["a"], additionalProperties: false };
  assert.deepEqual(validate(s, { a: "ok" }), []);
  assert.ok(validate(s, {}).length); assert.ok(validate(s, { a: "long!" }).length); assert.ok(validate(s, { a: "x", z: 1 }).length);
  assert.ok(validate(s, { a: "x", n: 1.5 }).length); assert.ok(validate(s, { a: "x", e: "y" }).length); assert.ok(validate(s, "str").length);
});

test("код: нельзя выйти из рабочей папки (../, абсолютный путь, симлинк)", () => {
  const d = tmp(); const ws = path.join(d, "ws"); fs.mkdirSync(ws);
  assert.throws(() => safePath(ws, "../x")); assert.throws(() => safePath(ws, "/etc/passwd"));
  fs.symlinkSync("/etc", path.join(ws, "evil")); assert.throws(() => safePath(ws, "evil/passwd"));
  assert.ok(safePath(ws, "new/dir/file.txt").startsWith(fs.realpathSync(ws)));
});

test("код: запись → правка → чтение → запуск разрешённой команды; неразрешённая отклоняется", async () => {
  const d = tmp(); const cfg = cfgFor(d); const T = Object.fromEntries(codeTools(cfg).map((t) => [t.name, t]));
  assert.equal((await T.code_write.execute({}, { path: "src/a.js", content: "console.log(1+1)\n" })).ok, true);
  assert.equal((await T.code_edit.execute({}, { path: "src/a.js", find: "1+1", replace: "2+3" })).ok, undefined);
  assert.equal((await T.code_edit.execute({}, { path: "src/a.js", find: "нет такого", replace: "x" })).ok, false);
  assert.match((await T.code_read.execute({}, { path: "src/a.js" })).data.text, /1\| console\.log\(2\+3\)/);
  const r = await T.code_run.execute({}, { command: "node", args: ["src/a.js"] }); assert.equal(r.ok, true); assert.equal(r.data.stdout.trim(), "5");
  assert.equal((await T.code_run.execute({}, { command: "rm", args: ["-rf", "/"] })).ok, false);
  assert.equal(T.code_run.confirm(), true, "команды всегда с подтверждением");
  assert.match((await T.code_search.execute({}, { query: "console" })).data.hits[0], /src\/a\.js:1/);
});

test("НПД: 4% физлица, 6% юрлица, лимит 2,4 млн, аннулированные не считаются", async () => {
  const st = new Store(tmp()); const T = Object.fromEntries(businessTools(st).map((t) => [t.name, t]));
  await T.acc_income_add.execute({}, { amount: 10000, date: "2026-09-01", payer: "individual", service: "консультация" });
  await T.acc_income_add.execute({}, { amount: 20000, date: "2026-09-02", payer: "business", service: "сайт", receiptNumber: "20abc" });
  const bad = await T.acc_income_add.execute({}, { amount: 5000, date: "2026-09-03", payer: "business", service: "ошибка" });
  await T.acc_income_cancel.execute({}, { incomeId: bad.data.id, reason: "дубль" });
  const r = (await T.acc_report.execute({}, { from: "2026-09-01", to: "2026-09-30" })).data;
  assert.equal(r.total, 30000); assert.equal(r.taxBeforeDeduction, 10000 * 0.04 + 20000 * 0.06); assert.equal(r.withoutReceipt, 1); assert.equal(r.limitLeft, 2_370_000);
  const big = await T.acc_income_add.execute({}, { amount: 2_400_000, date: "2026-10-01", payer: "business", service: "крупный" });
  assert.match(big.summary, /Превышен годовой лимит/);
  assert.deepEqual(npdReport([], "2026-01-01", "2026-12-31").total, 0);
});

test("CRM: контакт → сделка → этап → сводка", async () => {
  const st = new Store(tmp()); const T = Object.fromEntries(businessTools(st).map((t) => [t.name, t]));
  const c = (await T.crm_contact_add.execute({}, { name: "Иван", phone: "+7 900 000-00-00" })).data;
  assert.equal((await T.crm_deal_add.execute({}, { title: "Сайт", contactId: "нет" })).ok, false);
  const d = (await T.crm_deal_add.execute({}, { title: "Сайт", contactId: c.id, amount: 50000 })).data;
  await T.crm_deal_move.execute({}, { dealId: d.id, stage: "negotiation" });
  const o = (await T.crm_overview.execute({}, {})).data; assert.equal(o.byStage.negotiation, 1); assert.equal(o.pipelineRub, 50000);
  const st2 = new Store(st.dir); assert.equal(st2.all("deals").length, 1, "данные пережили перезапуск");
});

test("документы: Markdown экранирует HTML; PDF и презентация реально собираются; CSV защищён от формул", async () => {
  assert.doesNotMatch(md("<script>alert(1)</script> **жир**"), /<script>/); assert.match(md("| a | b |\n|---|---|\n| 1 | 2 |"), /<table>/);
  const d = tmp(); const cfg = cfgFor(d); const T = Object.fromEntries(docTools(cfg, null).map((t) => [t.name, t]));
  const sheet = await T.sheet_create.execute({}, { title: "т", columns: ["a"], rows: [["=HYPERLINK(\"x\")"]] });
  assert.match(fs.readFileSync(path.join(d, "artifacts", sheet.data.name), "utf8"), /'=HYPERLINK/);
  if (!findChromium(cfg)) return; // без Chromium PDF не проверить — тест HTML выше
  const doc = await T.doc_create.execute({}, { title: "Договор оказания услуг", markdown: "# Предмет\nИсполнитель **обязуется**…\n\n| Услуга | Цена |\n|---|---|\n| Сайт | 50 000 ₽ |" });
  assert.equal(doc.data.pdf, true, doc.data.note); const pdf = doc.artifacts.find((a) => a.name.endsWith(".pdf"));
  assert.equal(fs.readFileSync(path.join(d, "artifacts", pdf.name)).subarray(0, 5).toString(), "%PDF-");
  const sl = await T.slides_create.execute({}, { title: "Светлана 2.0", slides: [{ title: "Светлана 2.0", subtitle: "одна помощница на всё" }, { title: "Что умеет", bullets: ["код", "CRM", "НПД"] }] });
  assert.equal(sl.data.pdf, true); const inv = await T.invoice_create.execute({}, { number: "7", date: "2026-10-05", sellerName: "Павел", buyerName: "ООО Ромашка", items: [{ name: "Сайт", qty: 1, price: 50000 }] });
  assert.equal(inv.data.total, 50000); assert.equal(inv.data.pdf, true);
});

test("провайдеры: нативные tool_calls, <tool_call> текстом, переход на запасного при 500", async () => {
  const seen = []; const fx = scriptedFetch([{ status: 500 }, { role: "assistant", content: '<tool_call>{"name":"crm_find","arguments":{"query":"Иван"}}</tool_call>' }], seen);
  process.env.SVETLANA_PROVIDERS = JSON.stringify([{ id: "main", preset: "vllm", model: "q", capabilities: ["chat", "tools"] }, { id: "reserve", preset: "openai", apiKey: "sk-test", model: "g", capabilities: ["chat", "tools"] }]);
  const P = new Providers(null, fx); delete process.env.SVETLANA_PROVIDERS;
  const r = await P.chat({ messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "crm_find", parameters: {} } }] });
  assert.equal(r.provider, "reserve"); assert.equal(r.toolCalls[0].name, "crm_find"); assert.deepEqual(r.toolCalls[0].arguments, { query: "Иван" });
  assert.equal(seen[1].url, "https://api.openai.com/v1/chat/completions"); assert.equal(seen[1].body.tool_choice, "auto");
  assert.equal(P.public()[1].apiKey, undefined, "ключ не уходит в браузер"); assert.equal(P.public()[1].hasKey, true);
  assert.deepEqual(textToolCalls('<tool_call>{"name":"a","arguments":"{\\"x\\":1}"}</tool_call>')[0].arguments, { x: 1 });
  const an = toAnthropic([{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "f", arguments: "{}" } }] }, { role: "tool", tool_call_id: "t1", content: "{}" }]);
  assert.equal(an.system, "s"); assert.equal(an.messages[1].content[0].type, "tool_use"); assert.equal(an.messages[2].content[0].type, "tool_result");
});

test("веб: внутренняя сеть в любой записи и не-http запрещены (SSRF), проверка при соединении", async () => {
  for (const u of ["http://127.0.0.1:8787/api/data/incomes", "http://169.254.169.254/latest/meta-data", "http://[::ffff:172.16.0.1]/", "http://[::ffff:ac10:1]/", "http://100.64.0.1/", "http://0.0.0.0/", "http://[fd00::1]/", "http://localhost/"])
    await assert.rejects(assertPublicUrl(u), /внутренней сети/, u);
  await assert.rejects(assertPublicUrl("file:///etc/passwd"), /только http/);
  await assert.rejects(assertPublicUrl("http://user:pass@example.com/"), /логин/);
  const { safeGet, guardedLookup } = await import("../lib/netguard.mjs");
  await assert.rejects(safeGet("http://127.0.0.1:9/"), /внутренней сети/);
  await new Promise((res) => guardedLookup("localhost", {}, (err) => { assert.ok(err && /внутренней/.test(err.message)); res(); }));
});

test("WebSocket: немаскированный кадр, RSV-биты, огромная длина и чужой continuation закрывают соединение", async () => {
  const { WsConn } = await import("../lib/ws.mjs");
  const mk = () => { const ev = new (require_events())(); const out = []; ev.write = (b) => out.push(b); ev.end = () => (ev.ended = true); return { sock: ev, out }; };
  const closeCode = (out) => { const f = out.find((b) => (b[0] & 0x0f) === 8); return f ? f.readUInt16BE(2) : null; };
  for (const [name, frame, code] of [
    ["немаскированный", Buffer.from([0x81, 0x02, 0x68, 0x69]), 1002],
    ["RSV1", Buffer.from([0xc1, 0x80, 0, 0, 0, 0]), 1002],
    ["огромный", Buffer.concat([Buffer.from([0x81, 0xff]), Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.alloc(4)]), 1009],
    ["continuation без начала", Buffer.from([0x80, 0x80, 0, 0, 0, 0]), 1002],
    ["фрагментированный ping", Buffer.from([0x09, 0x80, 0, 0, 0, 0]), 1002],
  ]) { const { sock, out } = mk(); const c = new WsConn(sock); sock.emit("data", frame); assert.equal(closeCode(out), code, name); c.close(); }
});
function require_events() { return EventEmitterRef; }
import { EventEmitter as EventEmitterRef } from "node:events";
