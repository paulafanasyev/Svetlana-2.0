// Одноразовые подтверждения: токен привязан к инструменту и ТОЧНЫМ аргументам, живёт 10 минут, второй раз не сработает.
import crypto from "node:crypto";

const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",")}}` : JSON.stringify(v));

export class Confirmations {
  /** persist: { load(): [[nonce, exp]], save(entries) } — использованные токены переживают перезапуск. */
  constructor(secret, ttlMs = 10 * 60_000, persist = null) {
    this.key = secret ? Buffer.from(secret) : crypto.randomBytes(32);
    this.ttl = ttlMs; this.persist = persist; this.used = new Map(persist?.load?.() || []);
  }
  mac(s) { return crypto.createHmac("sha256", this.key).update(s).digest("base64url"); }
  issue(tool, args, now = Date.now()) {
    const exp = now + this.ttl; const nonce = crypto.randomBytes(9).toString("base64url");
    return `${exp}.${nonce}.${this.mac(`${exp}.${nonce}.${tool}.${canon(args)}`)}`;
  }
  consume(token, tool, args, now = Date.now()) {
    if (typeof token !== "string" || token.length > 300) return false;
    const [exp, nonce, sig] = token.split(".");
    if (!exp || !nonce || !sig || Number(exp) < now) return false;
    const want = this.mac(`${exp}.${nonce}.${tool}.${canon(args)}`);
    const a = Buffer.from(sig), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, Number(exp));
    for (const [n, e] of this.used) if (e < now) this.used.delete(n);
    this.persist?.save?.([...this.used]);
    return true;
  }
}
export { canon };
