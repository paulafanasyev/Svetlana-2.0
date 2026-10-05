/**
 * Мир самозанятых → Светлана 2.0: протокол STP поверх вашего реестра инструментов (backend/src/ai/tools/registry.js).
 * Положите в backend/src/ai/stp.js и подключите в роутере (пример для Express / Hono / любой (req)→Response ниже).
 *
 *   GET  /api/svetlana/tools        → список инструментов
 *   POST /api/svetlana/tools        { name, args, confirmToken? } → результат runTool (status/verified/evidence)
 *
 * Авторизация: Bearer-токен пользователя (ваш обычный JWT) → ctx.user. Чувствительные инструменты (tool.sensitive)
 * без подтверждения возвращают 202 + одноразовый confirmToken (HMAC, 10 минут, привязан к имени и аргументам);
 * Светлана показывает кнопку владельцу и повторяет вызов с токеном.
 */
import crypto from 'node:crypto';
import { listTools, runTool } from './tools/registry.js';

const KEY = process.env.STP_CONFIRM_SECRET || crypto.randomBytes(32).toString('hex');
const used = new Map();
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',')}}` : JSON.stringify(v));
const mac = (s) => crypto.createHmac('sha256', KEY).update(s).digest('base64url');
const issue = (uid, name, args) => { const exp = Date.now() + 600000; const n = crypto.randomBytes(9).toString('base64url'); return `${exp}.${n}.${mac(`${uid}.${exp}.${n}.${name}.${canon(args)}`)}`; };
function consume(t, uid, name, args) {
  if (typeof t !== 'string') return false; const [exp, n, sig] = t.split('.');
  if (!sig || Number(exp) < Date.now() || used.has(n)) return false;
  const want = Buffer.from(mac(`${uid}.${exp}.${n}.${name}.${canon(args)}`)); const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
  used.set(n, Number(exp)); for (const [k, e] of used) if (e < Date.now()) used.delete(k); return true;
}

/** Фреймворк-независимый обработчик: ctx — ваш обычный контекст запроса (user, db, …). */
export async function handleStp({ method, body, ctx }) {
  if (!ctx?.user?.id) return { status: 401, json: { ok: false, error: 'нужна авторизация' } };
  if (method === 'GET') {
    return { status: 200, json: { tools: listTools().map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters }, needsConfirmation: Boolean(t.sensitive) })) } };
  }
  const { name, args = {}, confirmToken } = body || {};
  const tool = listTools().find((t) => t.name === name);
  if (!tool) return { status: 404, json: { ok: false, error: `инструмента ${name} нет` } };
  const approved = new Set(ctx.approvedTools || []);
  if (tool.sensitive) {
    if (!consume(confirmToken, ctx.user.id, name, args)) return { status: 202, json: { ok: false, pendingConfirmation: true, confirmToken: issue(ctx.user.id, name, args), error: `«${tool.label ?? name}» требует подтверждения` } };
    approved.add(name);
  }
  const rec = await runTool({ ...ctx, approvedTools: approved }, name, args);
  const ok = rec.status === 'succeeded' && rec.verified;
  return { status: ok ? 200 : 422, json: { ok, data: rec.result, summary: rec.message, error: ok ? undefined : rec.error || rec.message || rec.status, verification: rec.verified ? 'VERIFIED' : 'NOT_PROVEN', evidence: rec.evidence } };
}

/* Express:
   import { handleStp } from './ai/stp.js';
   app.all('/api/svetlana/tools', requireAuth, async (req, res) => { const r = await handleStp({ method: req.method, body: req.body, ctx: { user: req.user, db } }); res.status(r.status).json(r.json); });
   В .env Светланы: SELF_EMPLOYED_URL=https://мир-самозанятых.рф/api/svetlana/tools  SELF_EMPLOYED_TOKEN=<JWT владельца> */
