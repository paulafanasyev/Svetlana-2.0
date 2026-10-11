// Printable documents (счёт, акт, договор) + сумма прописью + платёжная строка ГОСТ Р 56042-2014.
import { DOC_LABELS, REGIME_LABELS, formatRub, type BizDocument, type BizProfile } from './BizStore';

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

function triad(n: number, feminine: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) out.push(HUNDREDS[h]);
  if (t === 1) out.push(TEENS[o]);
  else {
    if (t) out.push(TENS[t]);
    if (o) out.push((feminine ? ONES_F : ONES_M)[o]);
  }
  return out;
}

/** 1234.5 → «Одна тысяча двести тридцать четыре рубля 50 копеек» */
export function rublesInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Некорректная сумма');
  const kopTotal = Math.round(amount * 100);
  let rub = Math.floor(kopTotal / 100);
  const kop = kopTotal % 100;
  const scales: { forms: [string, string, string] | null; fem: boolean }[] = [
    { forms: null, fem: false },
    { forms: ['тысяча', 'тысячи', 'тысяч'], fem: true },
    { forms: ['миллион', 'миллиона', 'миллионов'], fem: false },
    { forms: ['миллиард', 'миллиарда', 'миллиардов'], fem: false },
    { forms: ['триллион', 'триллиона', 'триллионов'], fem: false },
  ];
  if (rub >= 1e15) throw new Error('Слишком большая сумма для прописи');
  const parts: string[] = [];
  if (rub === 0) parts.push('ноль');
  let i = 0;
  const chunks: number[] = [];
  while (rub > 0 && i < scales.length) { chunks.push(rub % 1000); rub = Math.floor(rub / 1000); i++; }
  for (let s = chunks.length - 1; s >= 0; s--) {
    const n = chunks[s];
    if (!n) continue;
    const sc = scales[s];
    parts.push(...triad(n, sc.fem));
    if (sc.forms) parts.push(plural(n, ...sc.forms));
  }
  const rubInt = Math.floor(kopTotal / 100);
  const text = `${parts.join(' ')} ${plural(rubInt, 'рубль', 'рубля', 'рублей')} ${String(kop).padStart(2, '0')} ${plural(kop, 'копейка', 'копейки', 'копеек')}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Payment string for bank-app QR codes (ГОСТ Р 56042-2014, UTF-8 variant ST00012). */
export function paymentString(profile: BizProfile, amount: number, purpose: string): string {
  // Управляющие символы и разделитель «|» ломают QR, режем по длинам ГОСТ Р 56042.
  // eslint-disable-next-line no-control-regex
  const clean = (v: string | undefined, max: number) => (v ?? '').replace(/[\x00-\x1f\x7f|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const digits = (v: string | undefined) => (v ?? '').replace(/\D/g, '');
  const acc = digits(profile.account), bik = digits(profile.bik), corr = digits(profile.corrAccount);
  const name = clean(profile.fullName, 160), bank = clean(profile.bankName, 45);
  const missing: string[] = [];
  if (!name) missing.push('получатель');
  if (acc.length !== 20) missing.push('расчётный счёт (20 цифр)');
  if (!bank) missing.push('банк');
  if (bik.length !== 9) missing.push('БИК (9 цифр)');
  if (corr && corr.length !== 20) missing.push('корр. счёт (20 цифр)');
  if (!Number.isFinite(amount) || amount <= 0) missing.push('сумма');
  if (missing.length) throw new Error(`Для QR не хватает реквизитов: ${missing.join(', ')}`);
  const fields = [
    `Name=${name}`,
    `PersonalAcc=${acc}`,
    `BankName=${bank}`,
    `BIC=${bik}`,
    `CorrespAcc=${corr || '0'}`,
    `Sum=${Math.round(amount * 100)}`,
    `Purpose=${clean(purpose, 210)}`,
  ];
  const inn = digits(profile.inn);
  if (inn.length === 10 || inn.length === 12) fields.push(`PayeeINN=${inn}`);
  return `ST00012|${fields.join('|')}`;
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function d(ts?: number): string {
  return ts ? new Date(ts).toLocaleDateString('ru-RU') : '';
}

function sellerBlock(p: BizProfile): string {
  const rows = [
    p.fullName && `<b>${esc(p.fullName)}</b>`,
    p.regime !== 'none' && esc(REGIME_LABELS[p.regime]),
    p.inn && `ИНН ${esc(p.inn)}`,
    p.ogrn && `ОГРН/ОГРНИП ${esc(p.ogrn)}`,
    p.address && esc(p.address),
    (p.phone || p.email) && esc([p.phone, p.email].filter(Boolean).join(', ')),
  ].filter(Boolean);
  return rows.join('<br>');
}

function bankBlock(p: BizProfile): string {
  if (!p.account) return '';
  return `<table class="bank"><tr><td>Банк получателя</td><td>${esc(p.bankName)}</td><td>БИК</td><td>${esc(p.bik)}</td></tr>`
    + `<tr><td>Получатель</td><td>${esc(p.fullName)}${p.inn ? `, ИНН ${esc(p.inn)}` : ''}</td><td>Сч. №</td><td>${esc(p.account)}</td></tr>`
    + `<tr><td colspan="2"></td><td>Корр. сч.</td><td>${esc(p.corrAccount)}</td></tr></table>`;
}

function vatLine(doc: BizDocument): string {
  if (doc.vatRate && doc.vatRate > 0) {
    const vat = Math.round(doc.total * doc.vatRate / (100 + doc.vatRate) * 100) / 100;
    return `<tr><td colspan="5" class="r">в т.ч. НДС ${doc.vatRate}%:</td><td class="r">${formatRub(vat)}</td></tr>`;
  }
  return `<tr><td colspan="5" class="r">${esc(doc.vatNote || 'Без НДС')}</td><td class="r">—</td></tr>`;
}

function itemsTable(doc: BizDocument): string {
  const rows = doc.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td class="r">${i.qty}</td><td>усл.</td><td class="r">${formatRub(i.price)}</td><td class="r">${formatRub(i.qty * i.price)}</td></tr>`).join('');
  return `<table class="items"><thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody>`
    + `<tfoot><tr><td colspan="5" class="r"><b>Итого:</b></td><td class="r"><b>${formatRub(doc.total)}</b></td></tr>`
    + vatLine(doc) + `</tfoot></table>`
    + `<p>Всего наименований ${doc.items.length}, на сумму ${formatRub(doc.total)}.<br><b>${esc(rublesInWords(doc.total))}</b></p>`;
}

function signLine(role: string, name?: string): string {
  return `<div>${role}: ____________ / ${esc(name || '________________')} /<br><span class="muted">подпись, расшифровка, дата «___» ________ 20__ г.</span></div>`;
}

const STYLE = `body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;max-width:780px;margin:24px auto;padding:0 16px}
h1{font-size:18px;margin:16px 0}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #444;padding:4px 6px;vertical-align:top}
th{background:#f0f0f0}.r{text-align:right}.bank td{font-size:12px}.sign{margin-top:36px;display:flex;justify-content:space-between;gap:24px}
.sign div{flex:1;border-top:1px solid #444;padding-top:4px;font-size:12px}.muted{color:#555;font-size:12px}@media print{body{margin:0}}`;

export function renderDocumentHTML(doc: BizDocument, profile: BizProfile): string {
  const title = `${DOC_LABELS[doc.type]} № ${esc(doc.number)} от ${d(doc.date)}`;
  const client = `<b>${esc(doc.clientName)}</b>${doc.clientDetails ? `<br>${esc(doc.clientDetails).replace(/\n/g, '<br>')}` : ''}`;
  let body = '';
  if (doc.type === 'invoice') {
    body = `${bankBlock(profile)}<h1>${title}</h1>
<table><tr><td style="width:120px">Исполнитель</td><td>${sellerBlock(profile)}</td></tr><tr><td>Заказчик</td><td>${client}</td></tr>${doc.basis ? `<tr><td>Основание</td><td>${esc(doc.basis)}</td></tr>` : ''}</table>
${itemsTable(doc)}${doc.dueDate ? `<p>Оплатить до ${d(doc.dueDate)}.</p>` : ''}
<div class="sign">${signLine('Исполнитель', profile.fullName)}</div>`;
  } else if (doc.type === 'act') {
    body = `<h1>${title}</h1><p class="muted">об оказании услуг (выполнении работ)</p>
<table><tr><td style="width:120px">Исполнитель</td><td>${sellerBlock(profile)}</td></tr><tr><td>Заказчик</td><td>${client}</td></tr>${doc.basis ? `<tr><td>Основание</td><td>${esc(doc.basis)}</td></tr>` : ''}</table>
${itemsTable(doc)}<p>Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.</p>
<div class="sign">${signLine('Исполнитель', profile.fullName)}${signLine('Заказчик', doc.clientName)}</div>`;
  } else {
    body = `<h1>Договор возмездного оказания услуг № ${esc(doc.number)}</h1><p class="muted">${d(doc.date)}</p>
<p>${esc(profile.fullName || 'Исполнитель')}${profile.regime === 'npd' ? ', применяющий специальный налоговый режим «Налог на профессиональный доход»' : ''}${profile.inn ? `, ИНН ${esc(profile.inn)}` : ''}, именуемый в дальнейшем «Исполнитель», и ${esc(doc.clientName)}, именуемый в дальнейшем «Заказчик», заключили настоящий договор о нижеследующем.</p>
<p><b>1. Предмет договора.</b> Исполнитель обязуется оказать услуги, указанные ниже, а Заказчик обязуется принять и оплатить их.</p>
${itemsTable(doc)}
<p><b>2. Порядок оплаты.</b> Оплата производится на основании счёта Исполнителя в течение 5 (пяти) календарных дней с даты его выставления, если стороны не договорились об ином.</p>
<p><b>3. Приёмка.</b> Факт оказания услуг подтверждается актом${profile.regime === 'npd' ? ' или чеком, сформированным Исполнителем в приложении «Мой налог»' : ''}.</p>
<p><b>4. Ответственность.</b> Стороны несут ответственность в соответствии с законодательством Российской Федерации. Споры решаются путём переговоров, а при недостижении согласия — в суде по месту нахождения ответчика.</p>
<p><b>5. Срок действия.</b> Договор вступает в силу с момента подписания и действует до полного исполнения обязательств.</p>
<table><tr><th>Исполнитель</th><th>Заказчик</th></tr><tr><td>${sellerBlock(profile)}${profile.account ? `<br>р/с ${esc(profile.account)}<br>${esc(profile.bankName)}, БИК ${esc(profile.bik)}` : ''}</td><td>${client}</td></tr></table>
<div class="sign">${signLine('Исполнитель', profile.fullName)}${signLine('Заказчик', doc.clientName)}</div>
<p class="muted">Шаблон для типовых услуг. Для крупных или нестандартных сделок покажите договор юристу.</p>`;
  }
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}
