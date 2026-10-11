// Строгая проверка вызовов инструментов, которые предложила модель.
// Модель — недоверенный источник: вызов принимается, только если инструмент есть в списке,
// переданном именно в этот запрос, а аргументы точно соответствуют его схеме
// (обязательные поля на месте, типы совпадают, лишних полей нет). Всё остальное отбрасывается.

export interface ToolCallLike {
  tool: string;
  arguments: Record<string, unknown>;
}

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  maxLength?: number;
  additionalProperties?: boolean;
}

const MAX_STRING = 10_000;
const MAX_ARRAY = 200;
const MAX_DEPTH = 6;

/** Имя и схема параметров из описания инструмента (формат OpenAI, Anthropic или простой). */
export function toolSpec(t: unknown): { name: string; schema: JsonSchema } | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, any>;
  const fn = o.function && typeof o.function === 'object' ? o.function : o;
  const name = typeof fn.name === 'string' ? fn.name : null;
  if (!name) return null;
  const schema = (fn.parameters ?? fn.input_schema ?? o.input_schema ?? { type: 'object', properties: {} }) as JsonSchema;
  return { name, schema };
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(v: unknown, type: string | string[] | undefined): boolean {
  if (!type) return true;
  const types = Array.isArray(type) ? type : [type];
  const actual = typeOf(v);
  return types.some(t => t === actual || (t === 'number' && actual === 'integer'));
}

/** true — значение точно соответствует схеме. Неизвестные поля объектов запрещены. */
export function matchesSchema(v: unknown, s: JsonSchema, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (!matchesType(v, s.type ?? (s.properties ? 'object' : undefined))) return false;
  if (s.enum && !s.enum.some(e => e === v)) return false;
  if (typeof v === 'string') return v.length <= Math.min(s.maxLength ?? MAX_STRING, MAX_STRING);
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length <= MAX_ARRAY && v.every(x => !s.items || matchesSchema(x, s.items, depth + 1));
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const props = s.properties ?? {};
    for (const key of Object.keys(obj)) {
      if (!(key in props)) return false;
      if (!matchesSchema(obj[key], props[key], depth + 1)) return false;
    }
    for (const req of s.required ?? []) if (!(req in obj)) return false;
  }
  return true;
}

/** Оставляет только вызовы разрешённых в этом запросе инструментов с корректными аргументами. */
export function validateToolCalls<T extends ToolCallLike>(calls: T[], tools: unknown[]): T[] {
  const specs = new Map<string, JsonSchema>();
  for (const t of tools ?? []) {
    const spec = toolSpec(t);
    if (spec) specs.set(spec.name, spec.schema);
  }
  return calls.filter(c => {
    const schema = specs.get(c.tool);
    if (!schema) return false;
    return matchesSchema(c.arguments, { ...schema, type: 'object' });
  });
}
