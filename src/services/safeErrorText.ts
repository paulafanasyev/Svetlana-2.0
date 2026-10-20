// Текст ошибки для человека. Наши собственные русские сообщения показываем как есть, а технические
// (английские, со стеком, ссылками, длинными строками, похожими на ключ) заменяем понятной фразой.

const TECHNICAL = /(\bat\s+\S+\s*\(|https?:\/\/|\bsk-|Bearer\s|[A-Za-z0-9_-]{24,}|undefined|null|NaN|TypeError|ReferenceError|SyntaxError)/;

export function safeErrorText(e: unknown, fallback: string): string {
  const raw = typeof e === 'string' ? e : (e as { message?: unknown } | null)?.message;
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > 300) return fallback;
  if (!/[А-Яа-яЁё]/.test(s)) return fallback;
  if (TECHNICAL.test(s)) return fallback;
  return s;
}
