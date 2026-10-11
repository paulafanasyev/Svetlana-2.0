// Защита голосовых команд от записи (те же правила, что в Android-приложении Svetlana Home).
// Голос владельца сверяется с отпечатком на каждой фразе, но запись голоса можно воспроизвести.
// Поэтому перед первой командой Светлана просит произнести 3 случайные цифры: заранее записать
// нужную фразу нельзя. Проверяются два факта по одному и тому же звуку: сказаны именно эти цифры
// и сказал их владелец. После этого 2 минуты тишины (и не дольше 5 минут всего) команды проверяются
// только по голосу. 5 неудач подряд (чужой голос или не те цифры) ставят голосовое управление на паузу на 5 минут.
//
// Границы модели угроз (честно):
//  - голос — не согласие: любое изменение данных по голосу всё равно идёт через ActionGate и требует нажатия
//    «Выполнить» (см. voiceGate.test.ts). Воспроизведённая в доверенной сессии запись может только читать
//    или предлагать действие — выполнить его без человека у экрана нельзя;
//  - шаблон голоса и счётчик паузы хранятся в данных страницы. Скрипт, способный их переписать,
//    уже выполняется в странице и может вызвать команду напрямую в обход голоса — поэтому граница
//    безопасности проходит не здесь, а в подтверждениях и нативных окнах Windows (ключи, облако).

export const LIVENESS_LENGTH = 3;

const SPOKEN = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];

const UNITS = new Map<string, number>([
  ['ноль', 0], ['нуль', 0], ['один', 1], ['одна', 1], ['два', 2], ['две', 2], ['три', 3],
  ['четыре', 4], ['пять', 5], ['шесть', 6], ['семь', 7], ['восемь', 8], ['девять', 9],
]);
const TEENS = new Map<string, number>([
  ['десять', 10], ['одиннадцать', 11], ['двенадцать', 12], ['тринадцать', 13], ['четырнадцать', 14],
  ['пятнадцать', 15], ['шестнадцать', 16], ['семнадцать', 17], ['восемнадцать', 18], ['девятнадцать', 19],
]);
const TENS = new Map<string, number>([
  ['двадцать', 20], ['тридцать', 30], ['сорок', 40], ['пятьдесят', 50], ['шестьдесят', 60],
  ['семьдесят', 70], ['восемьдесят', 80], ['девяносто', 90],
]);
const HUNDREDS = new Map<string, number>([
  ['сто', 100], ['двести', 200], ['триста', 300], ['четыреста', 400], ['пятьсот', 500],
  ['шестьсот', 600], ['семьсот', 700], ['восемьсот', 800], ['девятьсот', 900],
]);

export interface Challenge { readonly digits: readonly number[]; readonly code: string; readonly spoken: string }

export function makeChallenge(digits: readonly number[]): Challenge {
  if (digits.length !== LIVENESS_LENGTH || digits.some(d => !Number.isInteger(d) || d < 0 || d > 9)) throw new Error('Неверные цифры проверки');
  const d = Object.freeze([...digits]);
  return Object.freeze({ digits: d, code: d.join(''), spoken: d.map(x => SPOKEN[x]).join(', ') });
}

export type RandomInt = (maxExclusive: number) => number;

/** Криптостойкое случайное целое 0..max-1 без перекоса. Без crypto.getRandomValues проверка не запускается. */
export function secureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max < 1 || max > 0x10000) throw new Error('Неверный диапазон');
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (!c?.getRandomValues) throw new Error('Нет криптостойкого генератора случайных чисел');
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) { c.getRandomValues(buf); if (buf[0] < limit) return buf[0] % max; }
}

/** Первая цифра не ноль (иначе «042» часто распознаётся как «42»): 900 вариантов на попытку. */
export function generateChallenge(rand: RandomInt = secureRandomInt): Challenge {
  return makeChallenge(Array.from({ length: LIVENESS_LENGTH }, (_, i) => (i === 0 ? 1 + rand(9) : rand(10))));
}

const isNumberWord = (t: string) => UNITS.has(t) || TEENS.has(t) || TENS.has(t) || HUNDREDS.has(t);
const isDigits = (t: string) => t.charCodeAt(0) >= 48 && t.charCodeAt(0) <= 57;

/**
 * Сказаны ли ровно загаданные цифры. Понимает «7 4 2», «742», «семь, четыре, два» и «семьсот сорок два».
 * Посторонние слова («это», «света») игнорируются; составное число разбирается по строгой грамматике.
 */
export function matchesChallenge(transcript: string | null | undefined, ch: Challenge): boolean {
  if (typeof transcript !== 'string' || !transcript.trim() || transcript.length > 200) return false;
  const text = transcript.toLowerCase().replace(/ё/g, 'е');
  const tokens = (text.match(/[0-9]+|[а-я]+/g) ?? []).filter(t => isDigits(t) || isNumberWord(t));
  if (!tokens.length) return false;
  const compound = tokens.some(t => TEENS.has(t) || TENS.has(t) || HUNDREDS.has(t));
  if (!compound) {
    let seq = '';
    for (const t of tokens) {
      seq += isDigits(t) ? t : String(UNITS.get(t));
      if (seq.length > 12) return false;
    }
    return seq === ch.code;
  }
  const v = parseCompound(tokens);
  return v !== null && String(v) === ch.code;
}

/** «семьсот сорок два», «семьсот 42», «семьсот два»: каждая часть меньше оставшегося разряда. */
function parseCompound(tokens: string[]): number | null {
  let value = 0;
  let limit = 1000;
  for (const t of tokens) {
    let n: number;
    if (isDigits(t)) {
      if (t.length > 3) return null;
      n = Number(t);
      if (n === 0 || n >= limit) return null;
      limit = 1;
    } else if (HUNDREDS.has(t)) {
      n = HUNDREDS.get(t)!; if (n >= limit) return null; limit = 100;
    } else if (TENS.has(t)) {
      n = TENS.get(t)!; if (n >= limit) return null; limit = 10;
    } else if (TEENS.has(t)) {
      n = TEENS.get(t)!; if (n >= limit) return null; limit = 1;
    } else {
      n = UNITS.get(t)!; if (n === 0 || n >= limit) return null; limit = 1;
    }
    value += n;
  }
  return value;
}

/** Метка шаблона голоса (все поля): новая запись голоса, удаление или любая правка шаблона закрывают доверенную сессию. */
export function templateId(t: { version: number; createdAt: number; samples: number; mean: number[]; sd: number[]; distThreshold: number }): string {
  return JSON.stringify([t.version, t.createdAt, t.samples, t.distThreshold, t.mean, t.sd]);
}

const monotonic = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

export const TRUST_IDLE_MS = 2 * 60_000;
export const TRUST_MAX_MS = 5 * 60_000;

/**
 * Доверенная сессия после успешной проверки цифрами: следующие команды проверяются только по голосу
 * (каждая фраза). Живёт idleMs с последней команды и не дольше maxMs всего. Монотонные часы:
 * перевод системного времени сессию не продлит. Привязана к шаблону голоса.
 */
export class VoiceTrust {
  private since = 0;
  private last = 0;
  private tpl: string | null = null;
  private readonly idleMs: number;
  private readonly maxMs: number;
  private readonly clock: () => number;
  constructor(idleMs = TRUST_IDLE_MS, maxMs = TRUST_MAX_MS, clock: () => number = monotonic) {
    this.idleMs = idleMs; this.maxMs = maxMs; this.clock = clock;
  }
  isValid(tpl: string, now = this.clock()): boolean {
    return this.tpl !== null && tpl === this.tpl && now >= this.last && now - this.last <= this.idleMs && now - this.since <= this.maxMs;
  }
  start(tpl: string, now = this.clock()): void { this.tpl = tpl; this.since = now; this.last = now; }
  touch(now = this.clock()): void { if (this.tpl !== null && now >= this.last) this.last = now; }
  end(): void { this.tpl = null; }
}

export const MAX_VOICE_FAILURES = 5;
export const VOICE_LOCK_MS = 5 * 60_000;
const LOCK_KEY = 'svetlana_voice_lockout_v1';

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }
const memory = new Map<string, string>();
const memoryKV: KV = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => { memory.set(k, v); }, removeItem: k => { memory.delete(k); } };
function defaultKV(): KV {
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* приватный режим */ }
  return memoryKV;
}

/**
 * Пауза после 5 неудач подряд, сохраняется между перезапусками. Если системные часы отвели назад,
 * пауза всё равно не длиннее 5 минут от «сейчас» и не снимается раньше времени.
 */
export class VoiceLockout {
  private readonly kv: KV;
  private readonly clock: () => number;
  constructor(kv: KV = defaultKV(), clock: () => number = () => Date.now()) { this.kv = kv; this.clock = clock; }
  private read(): { failures: number; until: number } {
    try {
      const raw = this.kv.getItem(LOCK_KEY);
      const s = raw && raw.length < 200 ? JSON.parse(raw) : null;
      const failures = Number.isInteger(s?.failures) && s.failures >= 0 && s.failures < MAX_VOICE_FAILURES ? s.failures : 0;
      const until = typeof s?.until === 'number' && Number.isFinite(s.until) ? s.until : 0;
      return { failures, until };
    } catch { return { failures: 0, until: 0 }; }
  }
  private write(s: { failures: number; until: number }): void {
    try { this.kv.setItem(LOCK_KEY, JSON.stringify(s)); } catch { /* хранилище недоступно */ }
  }
  remainingMs(): number {
    const { until } = this.read();
    const now = this.clock();
    if (until <= now) return 0;
    if (until - now > VOICE_LOCK_MS) { this.write({ failures: 0, until: now + VOICE_LOCK_MS }); return VOICE_LOCK_MS; }
    return until - now;
  }
  /** Учесть неудачу. Возвращает длительность паузы (0, если пауза не наступила). */
  fail(): number {
    const s = this.read();
    const failures = s.failures + 1;
    if (failures >= MAX_VOICE_FAILURES) { this.write({ failures: 0, until: this.clock() + VOICE_LOCK_MS }); return VOICE_LOCK_MS; }
    this.write({ failures, until: s.until });
    return 0;
  }
  reset(): void { this.write({ failures: 0, until: 0 }); }
}
