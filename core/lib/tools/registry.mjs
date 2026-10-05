// Реестр инструментов: строгая проверка аргументов по схеме, уровни риска, подтверждения.
// risk: read — без подтверждения; write — меняет ваши данные; external — тратит деньги/действует вовне; dangerous — команды, управление устройством.
export const RISKS = ["read", "write", "external", "dangerous"];

export function validate(schema, value, at = "args") {
  const errs = [];
  const t = schema.type;
  const typeOk = (v) => t === "string" ? typeof v === "string" : t === "number" ? typeof v === "number" && Number.isFinite(v)
    : t === "integer" ? Number.isInteger(v) : t === "boolean" ? typeof v === "boolean" : t === "array" ? Array.isArray(v)
      : t === "object" ? v !== null && typeof v === "object" && !Array.isArray(v) : true;
  if (!typeOk(value)) return [`${at}: ожидается ${t}`];
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: допустимо ${schema.enum.join("|")}`);
  if (t === "string") {
    if (schema.maxLength && value.length > schema.maxLength) errs.push(`${at}: длиннее ${schema.maxLength}`);
    if (schema.minLength && value.length < schema.minLength) errs.push(`${at}: короче ${schema.minLength}`);
    if (schema.format === "date") {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) errs.push(`${at}: дата должна быть в виде ГГГГ-ММ-ДД`);
    }
  }
  if ((t === "number" || t === "integer") && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) errs.push(`${at}: вне диапазона`);
  if (t === "array") {
    if (schema.maxItems && value.length > schema.maxItems) errs.push(`${at}: больше ${schema.maxItems} элементов`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${at}[${i}]`)));
  }
  if (t === "object") {
    const props = schema.properties || {};
    for (const k of schema.required || []) if (value[k] === undefined) errs.push(`${at}.${k}: обязателен`);
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errs.push(...validate(props[k], v, `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}.${k}: неизвестный параметр`);
    }
  }
  return errs;
}

export class Registry {
  constructor() { this.tools = new Map(); }
  add(...defs) {
    for (const d of defs) {
      if (!d.name || !/^[a-z][a-z0-9_]{1,63}$/.test(d.name)) throw new Error(`bad tool name ${d.name}`);
      if (!RISKS.includes(d.risk)) throw new Error(`bad risk for ${d.name}`);
      if (this.tools.has(d.name)) throw new Error(`duplicate tool ${d.name}`);
      this.tools.set(d.name, { parameters: { type: "object", properties: {}, additionalProperties: false }, ...d });
    }
    return this;
  }
  get(n) { return this.tools.get(n); }
  list(filter = () => true) { return [...this.tools.values()].filter(filter); }
  forModel(filter) {
    return this.list(filter).map((t) => ({ type: "function", function: { name: t.name, description: `${t.description}${t.risk !== "read" ? " [нужно подтверждение пользователя]" : ""}`, parameters: t.parameters } }));
  }
  needsConfirm(tool, args, ctx) {
    if (tool.risk === "read") return false;
    // После чтения чужих данных (веб, экран, файлы, ответы внешних систем) любые изменения — только с подтверждением:
    // инструкция, спрятанная в данных, не сможет сама ничего записать.
    if (ctx.tainted) return true;
    if (typeof tool.confirm === "function") return tool.confirm(args, ctx);
    if (tool.confirm === false) return false;
    return !(ctx.grants?.has?.(tool.domain || tool.name));
  }
  async run(tool, args, ctx) {
    try {
      const r = await tool.execute(ctx, args);
      return { ok: r.ok !== false, ...r };
    } catch (e) {
      return { ok: false, error: String(e.message || e).slice(0, 500) };
    }
  }
}
