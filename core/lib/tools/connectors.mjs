// Внешние системы по одному протоколу «Svetlana Tool Protocol» (STP):
//   GET  {base}/tools                       → { tools: [{type:"function",function:{name,description,parameters}, needsConfirmation}] }
//   POST {base}/tools  {name,args,confirmToken?} → ToolResult | 202 {pendingConfirmation, confirmToken}
// АИКО: base = https://аико/api/ai/tool (уже есть в патче АИКО). Мир самозанятых: connectors/self-employed-stp.js.
import { parsePublicUrl, safeGet, isPrivateIp, guardedLookup } from "../netguard.mjs";
import dns from "node:dns/promises";

/** Проверка до запроса (быстрый отказ); окончательная проверка — при соединении (guardedLookup). */
export async function assertPublicUrl(u) {
  const url = parsePublicUrl(u);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = /^[\d.]+$|:/.test(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error("адрес во внутренней сети — запрещено");
  return url;
}
export { isPrivateIp, guardedLookup };

function textFromHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|p|div|li|h\d|tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export function stpConnector({ id, title, base, token, fx = fetch }) {
  const hdr = () => ({ "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}`, Cookie: `session=${token}` } : {}) });
  const call = async (method, body) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 60000);
    try {
      const r = await fx(base.replace(/\/$/, "") + (method === "GET" ? "?side=seller" : ""), { method, headers: hdr(), body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      const j = await r.json().catch(() => ({ ok: false, error: `ответ ${r.status} не JSON` }));
      return { status: r.status, j };
    } finally { clearTimeout(t); }
  };
  return [
    { name: `${id}_tools`, domain: id, risk: "read", taints: true, description: `${title}: список доступных действий (инструментов) с параметрами.`,
      async execute() { if (!base) return { ok: false, error: `${title} не подключён (задайте адрес и токен)` }; const { status, j } = await call("GET"); if (status >= 400) return { ok: false, error: j.error || `ошибка ${status}` };
        return { data: (j.tools || []).map((t) => ({ name: t.function?.name, description: t.function?.description, parameters: t.function?.parameters, needsConfirmation: t.needsConfirmation })), summary: `${title}: инструментов ${(j.tools || []).length}`, untrusted: true }; } },
    { name: `${id}_call`, domain: id, risk: "write", taints: true, description: `${title}: выполнить действие (имя из ${id}_tools). Каждое действие подтверждает владелец.`,
      parameters: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 64 }, args: { type: "object" } }, required: ["name"], additionalProperties: false },
      async execute(_ctx, a) {
        if (!base) return { ok: false, error: `${title} не подключён` };
        const req = { name: a.name, args: a.args || {}, side: "seller" };
        let { status, j } = await call("POST", req);
        // Владелец уже подтвердил ровно это действие у нас → передаём удалённой системе её одноразовый токен
        if (status === 202 && j.pendingConfirmation && j.confirmToken) ({ status, j } = await call("POST", { ...req, confirmToken: j.confirmToken }));
        if (status >= 400 || status === 202 || j.ok === false) return { ok: false, error: j.error || `ошибка ${status}`, data: j.data, untrusted: true };
        return { data: j.data, summary: j.summary || "выполнено", verification: j.verification, untrusted: true };
      } },
  ];
}

export function webTools(getImpl = safeGet) {
  return [{ name: "web_fetch", domain: "web", risk: "read", taints: true, description: "Открыть страницу в интернете и получить её текст (документация, новости, цены).",
    parameters: { type: "object", properties: { url: { type: "string", minLength: 8, maxLength: 2000 } }, required: ["url"], additionalProperties: false },
    async execute(_c, a) {
      const r = await getImpl(a.url);
      const ct = String(r.headers["content-type"] || ""); const raw = r.body.toString("utf8");
      const text = ct.includes("html") ? textFromHtml(raw) : raw;
      return { ok: r.status < 400, data: { url: r.url, status: r.status, text: text.slice(0, 30000), truncated: r.truncated || text.length > 30000 }, summary: `${r.status}, ${text.length} символов`, untrusted: true };
    } }];
}
export { textFromHtml };
