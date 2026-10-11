// Голос: подготовка распознанного текста (слова-числа → цифры, «Светлана, …») и текста для озвучки.

const UNITS: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
};
const TEENS: Record<string, number> = {
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
};
const TENS: Record<string, number> = {
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
};
const HUNDREDS: Record<string, number> = {
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};
const THOUSAND = /^тысяч[аиу]?$/;
const MILLION = /^миллион(а|ов)?$/;

type Cls = 'h' | 't' | 'u' | 'none';

/** «пять тысяч двести» → «5200», «полторы тысячи» → «1500», «пятнадцать тридцать» → «15 30». */
export function wordsToNumbers(text: string): string {
  const out: string[] = [];
  let total = 0;
  let current = 0;
  let last: Cls = 'none';
  let active = false;
  const flush = () => {
    if (active) out.push(String(total + current));
    total = 0; current = 0; last = 'none'; active = false;
  };
  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^([а-яё]+)([^а-яё\d]*)$/i);
    const w = m ? m[1].toLowerCase().replace(/ё/g, 'е') : '';
    const tail = m ? m[2] : '';
    let handled = true;
    if (w === 'полторы' || w === 'полтора') {
      flush(); current = 1.5; active = true; last = 'u';
    } else if (w in HUNDREDS) {
      if (active && last !== 'none') flush();
      current += HUNDREDS[w]; active = true; last = 'h';
    } else if (w in TENS) {
      if (active && (last === 't' || last === 'u')) flush();
      current += TENS[w]; active = true; last = 't';
    } else if (w in TEENS) {
      if (active && (last === 't' || last === 'u')) flush();
      current += TEENS[w]; active = true; last = 'u';
    } else if (w in UNITS) {
      if (active && last === 'u') flush();
      current += UNITS[w]; active = true; last = 'u';
    } else if (THOUSAND.test(w) && (active || w === 'тысяча' || w === 'тысячу')) {
      total += (active ? current : 1) * 1000; current = 0; active = true; last = 'none';
    } else if (MILLION.test(w) && (active || w === 'миллион')) {
      total += (active ? current : 1) * 1_000_000; current = 0; active = true; last = 'none';
    } else {
      handled = false;
    }
    if (handled) {
      if (tail) { flush(); out[out.length - 1] += tail; }
      continue;
    }
    flush();
    out.push(tok);
  }
  flush();
  return out.join(' ');
}

export function hasWakeWord(text: string): boolean {
  return /^\s*(?:эй\s*,?\s*)?(?:светлана|света|светик)(?![а-яё])/i.test(text);
}

/** Распознанная фраза → команда: убирает «Светлана,», переводит числа, время «15 30» → «15:30». */
export function normalizeSpoken(raw: string): string {
  let s = raw.trim().replace(/^\s*(?:эй\s*,?\s*)?(?:светлана|света|светик)(?![а-яё])[\s,.!:-]*/i, '');
  s = s.replace(/ноль\s+ноль/gi, '00');
  s = wordsToNumbers(s);
  s = s.replace(/(\d)\s+(?=\d{3}(?!\d))/g, '$1'); // «5 000» → «5000»
  s = s.replace(/(^|\s)((?:в|на|к|с)\s+)(\d{1,2})\s+(00|[0-5]\d)(?!\d)/gi, (m, b: string, p: string, h: string, mm: string) => (Number(h) <= 23 ? `${b}${p}${h}:${mm}` : m));
  s = s.replace(/(\d)\s*(?:рублей|рубля|рубль|руб\.?)(?![а-яё])/gi, '$1');
  s = s.replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Текст ответа → то, что приятно слушать: без эмодзи, ссылок, маркеров; «₽» → «рублей». */
export function speakable(text: string, maxChars = 600): string {
  let s = text
    .replace(/https?:\/\/\S+/g, 'ссылка на экране')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\uFE0F|\u200D/g, '')
    .replace(/^[\s•\-*]+/gm, '')
    .replace(/(\d)\s?₽/g, '$1 рублей')
    .replace(/₽/g, 'рублей')
    .replace(/№\s?/g, 'номер ')
    .replace(/(\d{1,2}):00(?!\d)/g, '$1 ноль ноль')
    .replace(/[–—]/g, ', ')
    .replace(/\n+/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxChars) {
    const cut = s.slice(0, maxChars);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = (end > maxChars / 2 ? cut.slice(0, end + 1) : cut) + ' Остальное на экране.';
  }
  return s;
}

/** Делит текст на фразы до ~180 символов: длинные реплики Chrome иначе обрывает. */
export function chunkForSpeech(text: string, max = 180): string[] {
  const parts = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const out: string[] = [];
  let buf = '';
  for (const p of parts.map(x => x.trim()).filter(Boolean)) {
    if ((buf + ' ' + p).trim().length > max && buf) { out.push(buf); buf = p; } else buf = (buf + ' ' + p).trim();
  }
  if (buf) out.push(buf);
  return out.flatMap(c => (c.length <= max ? [c] : (c.match(new RegExp(`.{1,${max}}(\\s|$)`, 'g')) ?? [c]).map(x => x.trim())));
}

/** Лучший русский голос: женские голоса Microsoft/Google/Apple, иначе любой ru. */
export function pickRussianVoice<T extends { lang: string; name: string }>(voices: T[]): T | undefined {
  const ru = voices.filter(v => v.lang.toLowerCase().startsWith('ru'));
  const preferred = /(svetlana|dariya|irina|milena|alena|алена|алёна|милена|ирина|светлана|female|жен)/i;
  return ru.find(v => preferred.test(v.name)) ?? ru.find(v => /google/i.test(v.name)) ?? ru[0];
}
