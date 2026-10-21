// Понятные ошибки ИИ для человека: вместо «HTTP 401: {...}» или «Failed to fetch» — коротко по-русски, что делать.
// Сообщения, которые уже написаны по-русски (нативная часть, Ollama, GigaChat), остаются как есть, но без
// технических хвостов вроде «(error sending request: SocketTimeoutException)». Сырой английский текст сервера
// человеку не показывается: только код ответа (если есть) и что делать дальше.

const CYRILLIC = /[А-Яа-яЁё]/;
const TECH_TAIL = /\s*\((?:error sending request|[A-Za-z.]*(?:Exception|Error))[^)]*\)/g;

export const AI_ERROR_GENERIC = 'сервис ответил ошибкой. Попробуйте ещё раз или выберите другой ИИ во вкладке «Модели ИИ».';

export function explainAiError(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'Ошибка при обращении к ИИ';
  if (/Отменено пользователем/.test(s)) return 'В окне подтверждения нажата «Отмена». Отправьте сообщение ещё раз и разрешите запрос.';
  const code = Number(/\bHTTP (\d{3})\b/.exec(s)?.[1] ?? 0);
  if (code === 401 || code === 403) return 'Сервис ИИ не принял ключ. Проверьте ключ во вкладке «Модели ИИ».';
  if (code === 402) return 'У сервиса ИИ закончились деньги или бесплатные токены на счёте.';
  if (code === 404) return 'Сервис ИИ не нашёл модель. Выберите другую модель во вкладке «Модели ИИ».';
  if (code === 429) return 'Слишком много запросов к ИИ. Подождите минуту и повторите.';
  if (code >= 500 && code <= 599) return 'Сервис ИИ сейчас не отвечает. Попробуйте позже или выберите другой ИИ.';
  if (CYRILLIC.test(s) && !code) return s.replace(TECH_TAIL, '').slice(0, 300);
  if (/Failed to fetch|NetworkError|Load failed|error sending request|timed? ?out|ECONNREFUSED|dns/i.test(s)) return 'Нет связи с ИИ. Проверьте интернет и попробуйте ещё раз.';
  // Код ответа полезен для поддержки, сырой текст сервера — нет (в нём бывает JSON и пути).
  const anyCode = code || Number(/\b([45]\d\d)\b/.exec(s)?.[1] ?? 0);
  return anyCode ? `Ошибка ИИ: ${AI_ERROR_GENERIC} (код ${anyCode})` : `Ошибка ИИ: ${AI_ERROR_GENERIC}`;
}
