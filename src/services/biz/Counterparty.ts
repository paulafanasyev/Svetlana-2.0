// Проверка контрагентов и реквизиты по ИНН/БИК.
// Офлайн: контрольная сумма ИНН. Онлайн: DaData (ключ пользователя, бесплатный тариф) и сервис ФНС «статус самозанятого».
import type { KeyValueStorage } from '../crm/CRMStore';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export type PartyStatus = 'ACTIVE' | 'LIQUIDATING' | 'LIQUIDATED' | 'BANKRUPT' | 'REORGANIZING' | 'UNKNOWN';

export interface PartyInfo {
  inn: string;
  kind: 'company' | 'ip' | 'person';
  name: string;
  fullName: string;
  kpp?: string;
  ogrn?: string;
  address?: string;
  manager?: string;
  okved?: string;
  status: PartyStatus;
  registeredAt?: number;
  liquidatedAt?: number;
}

export interface BankInfo { bik: string; name: string; corrAccount: string; address?: string }

export interface CheckReport {
  inn: string;
  validInn: boolean;
  party?: PartyInfo;
  selfEmployed?: boolean;
  risks: string[];
  notes: string[];
  links: { title: string; url: string }[];
}

export const STATUS_LABELS: Record<PartyStatus, string> = {
  ACTIVE: 'Действующая', LIQUIDATING: 'Ликвидируется', LIQUIDATED: 'Ликвидирована',
  BANKRUPT: 'Банкротство', REORGANIZING: 'Реорганизация', UNKNOWN: 'Нет данных',
};

const KEY_STORAGE = 'svetlana_dadata_key';
const DADATA = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById';
const NPD_STATUS = 'https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status';
const DAY = 86_400_000;

function defaultStorage(): KeyValueStorage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function getDadataKey(storage: KeyValueStorage | null = defaultStorage()): string {
  return storage?.getItem(KEY_STORAGE) ?? '';
}

export function setDadataKey(key: string, storage: KeyValueStorage | null = defaultStorage()): void {
  storage?.setItem(KEY_STORAGE, key.trim());
}

function defaultFetch(): FetchLike | null {
  return typeof fetch === 'function' ? (fetch as unknown as FetchLike) : null;
}

/** Контрольная сумма ИНН (10 цифр — организация, 12 — ИП/физлицо). */
export function validateInn(raw: string): boolean {
  const inn = raw.replace(/\s/g, '');
  if (!/^\d{10}$|^\d{12}$/.test(inn)) return false;
  const d = inn.split('').map(Number);
  const check = (weights: number[]) => (weights.reduce((s, w, i) => s + w * d[i], 0) % 11) % 10;
  if (inn.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}

export function validateBik(raw: string): boolean {
  return /^\d{9}$/.test(raw.trim());
}

function toStatus(s: unknown): PartyStatus {
  return s === 'ACTIVE' || s === 'LIQUIDATING' || s === 'LIQUIDATED' || s === 'BANKRUPT' || s === 'REORGANIZING' ? s : 'UNKNOWN';
}

/** Данные организации/ИП по ИНН через DaData findById/party. */
export async function lookupParty(inn: string, opts: { key?: string; fetchImpl?: FetchLike | null } = {}): Promise<PartyInfo | null> {
  const key = opts.key ?? getDadataKey();
  const f = opts.fetchImpl === undefined ? defaultFetch() : opts.fetchImpl;
  if (!key) throw new Error('Нужен API-ключ DaData (бесплатный): dadata.ru → Профиль → API-ключ. Вставьте его в разделе «Банк и ИНН».');
  if (!f) throw new Error('Нет доступа к сети');
  const res = await f(`${DADATA}/party`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${key}` },
    body: JSON.stringify({ query: inn.trim() }),
  });
  if (res.status === 401 || res.status === 403) throw new Error('DaData отклонила ключ. Проверьте API-ключ.');
  if (!res.ok) throw new Error(`DaData недоступна (код ${res.status})`);
  const json = await res.json();
  const s = json?.suggestions?.[0];
  if (!s?.data) return null;
  const d = s.data;
  const isIp = d.type === 'INDIVIDUAL';
  return {
    inn: String(d.inn ?? inn),
    kind: isIp ? 'ip' : 'company',
    name: String(d.name?.short_with_opf || s.value || ''),
    fullName: String(d.name?.full_with_opf || s.unrestricted_value || s.value || ''),
    kpp: d.kpp || undefined,
    ogrn: d.ogrn || undefined,
    address: d.address?.unrestricted_value || d.address?.value || undefined,
    manager: d.management?.name ? `${d.management.post ? `${d.management.post}: ` : ''}${d.management.name}` : undefined,
    okved: d.okved || undefined,
    status: toStatus(d.state?.status),
    registeredAt: typeof d.state?.registration_date === 'number' ? d.state.registration_date : undefined,
    liquidatedAt: typeof d.state?.liquidation_date === 'number' ? d.state.liquidation_date : undefined,
  };
}

/** Банк по БИК через DaData findById/bank. */
export async function lookupBank(bik: string, opts: { key?: string; fetchImpl?: FetchLike | null } = {}): Promise<BankInfo | null> {
  const key = opts.key ?? getDadataKey();
  const f = opts.fetchImpl === undefined ? defaultFetch() : opts.fetchImpl;
  if (!key) throw new Error('Нужен API-ключ DaData (бесплатный), см. раздел «Банк и ИНН».');
  if (!f) throw new Error('Нет доступа к сети');
  const res = await f(`${DADATA}/bank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${key}` },
    body: JSON.stringify({ query: bik.trim() }),
  });
  if (!res.ok) throw new Error(`DaData недоступна (код ${res.status})`);
  const d = (await res.json())?.suggestions?.[0]?.data;
  if (!d) return null;
  return { bik: String(d.bic ?? bik), name: String(d.name?.payment || d.name?.short || ''), corrAccount: String(d.correspondent_account ?? ''), address: d.address?.value };
}

/** Статус плательщика НПД через открытый сервис ФНС. null — сервис недоступен. */
export async function checkSelfEmployed(inn: string, now: number, fetchImpl: FetchLike | null = defaultFetch()): Promise<boolean | null> {
  if (!fetchImpl || !/^\d{12}$/.test(inn)) return null;
  try {
    const res = await fetchImpl(NPD_STATUS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inn, requestDate: new Date(now).toISOString().slice(0, 10) }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.status === 'boolean' ? json.status : null;
  } catch {
    return null;
  }
}

export function officialLinks(inn: string): { title: string; url: string }[] {
  return [
    { title: 'Выписка ЕГРЮЛ/ЕГРИП (ФНС)', url: 'https://egrul.nalog.ru/' },
    { title: '«Прозрачный бизнес» (ФНС)', url: `https://pb.nalog.ru/search.html#t=${Date.now()}&mode=search-all&queryAll=${encodeURIComponent(inn)}` },
    { title: 'Банкротства (Федресурс)', url: `https://fedresurs.ru/search/entity?code=${encodeURIComponent(inn)}` },
    { title: 'Статус самозанятого (ФНС)', url: 'https://npd.nalog.ru/check-status/' },
  ];
}

/** Полная проверка: ИНН → данные, статус, риски. Работает частично и без ключа/сети. */
export async function checkCounterparty(innRaw: string, opts: { now?: number; key?: string; fetchImpl?: FetchLike | null } = {}): Promise<CheckReport> {
  const inn = innRaw.replace(/\D/g, '');
  const now = opts.now ?? Date.now();
  const report: CheckReport = { inn, validInn: validateInn(inn), risks: [], notes: [], links: officialLinks(inn) };
  if (!report.validInn) {
    report.risks.push('ИНН не проходит проверку контрольной суммы — скорее всего, опечатка или поддельный ИНН.');
    return report;
  }
  const key = opts.key ?? getDadataKey();
  if (key) {
    try {
      const party = await lookupParty(inn, { key, fetchImpl: opts.fetchImpl });
      if (party) {
        report.party = party;
        if (party.status !== 'ACTIVE') report.risks.push(`Статус: ${STATUS_LABELS[party.status]}. Работать с такой организацией рискованно.`);
        if (party.registeredAt && now - party.registeredAt < 180 * DAY) report.risks.push('Зарегистрирована меньше полугода назад — проверьте внимательнее, возьмите предоплату.');
      } else if (inn.length === 10) {
        report.risks.push('Организация с таким ИНН не найдена в ЕГРЮЛ.');
      } else {
        report.notes.push('ИП с таким ИНН не найден — возможно, это физлицо или самозанятый.');
      }
    } catch (e: any) {
      report.notes.push(e?.message || 'Не удалось получить данные DaData');
    }
  } else {
    report.notes.push('Для названия, адреса, руководителя и статуса добавьте бесплатный ключ DaData. Пока проверена только контрольная сумма ИНН.');
  }
  if (inn.length === 12) { // ИП тоже может быть самозанятым
    const npd = await checkSelfEmployed(inn, now, opts.fetchImpl === undefined ? defaultFetch() : opts.fetchImpl);
    if (npd !== null) {
      report.selfEmployed = npd;
      report.notes.push(npd ? 'Является плательщиком НПД (самозанятый).' : 'Не является плательщиком НПД.');
    }
  }
  return report;
}

export function reportText(r: CheckReport): string {
  const lines: string[] = [];
  if (r.party) {
    const p = r.party;
    lines.push(`${p.name} — ${STATUS_LABELS[p.status]}`);
    if (p.ogrn) lines.push(`ИНН ${p.inn}${p.kpp ? `, КПП ${p.kpp}` : ''}, ОГРН ${p.ogrn}`);
    if (p.registeredAt) lines.push(`Зарегистрирована: ${new Date(p.registeredAt).toLocaleDateString('ru-RU')}`);
    if (p.address) lines.push(`Адрес: ${p.address}`);
    if (p.manager) lines.push(`Руководитель: ${p.manager}`);
  } else {
    lines.push(`ИНН ${r.inn}: ${r.validInn ? 'контрольная сумма верна' : 'неверный ИНН'}`);
  }
  r.risks.forEach(x => lines.push(`⚠️ ${x}`));
  r.notes.forEach(x => lines.push(`ℹ️ ${x}`));
  if (!r.risks.length && r.party) lines.push('✅ Явных рисков не видно.');
  return lines.join('\n');
}
