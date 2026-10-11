// Каталог мер господдержки для самозанятых и МСП + подбор по профилю и региону.
// Условия программ меняются: в карточках только устойчивые признаки, суммы — «до», всегда со ссылкой на официальный источник.
import type { BizProfile, TaxRegime } from './BizStore';

export type SupportKind = 'grant' | 'subsidy' | 'loan' | 'guarantee' | 'consulting' | 'property' | 'tax' | 'education';

export interface SupportMeasure {
  id: string;
  title: string;
  kind: SupportKind;
  provider: string;
  summary: string;
  amount?: string;
  regimes: TaxRegime[];          // кому подходит
  maxAge?: number;
  minAge?: number;
  sectors?: string[];            // если задано — нужен хотя бы один из секторов
  flags?: string[];              // если задано — нужен хотя бы один флаг
  howTo: string;
  url: string;
}

export const SUPPORT_KIND_LABELS: Record<SupportKind, string> = {
  grant: 'Грант', subsidy: 'Субсидия', loan: 'Заём/кредит', guarantee: 'Поручительство',
  consulting: 'Консультации', property: 'Аренда/помещения', tax: 'Налоги', education: 'Обучение',
};

export const SECTOR_LABELS: Record<string, string> = {
  services: 'Услуги', trade: 'Торговля', production: 'Производство', tech: 'IT и технологии',
  agro: 'Сельское хозяйство', export: 'Экспорт', social: 'Социальное предпринимательство',
  education: 'Образование', creative: 'Творческие индустрии', tourism: 'Туризм',
};

export const FLAG_LABELS: Record<string, string> = {
  lowIncome: 'Малоимущая семья', unemployed: 'Безработный (на учёте в центре занятости)',
  newBusiness: 'Бизнесу меньше года', socialEnterprise: 'В реестре социальных предприятий',
  veteran: 'Участник СВО или член семьи', disability: 'Инвалидность',
};

const ALL_BUSINESS: TaxRegime[] = ['npd', 'usn6', 'usn15', 'patent', 'ooo'];
const MSP: TaxRegime[] = ['usn6', 'usn15', 'patent', 'ooo'];

export const SUPPORT_MEASURES: SupportMeasure[] = [
  {
    id: 'moy-biznes', title: 'Центр «Мой бизнес» в вашем регионе', kind: 'consulting', provider: 'Минэкономразвития / регион',
    summary: 'Бесплатные консультации (юрист, бухгалтер, маркетинг), обучение, помощь с документами и заявками на гранты. Работает и для самозанятых.',
    regimes: ALL_BUSINESS, howTo: 'Найдите центр своего региона на портале и запишитесь на консультацию.', url: 'https://мойбизнес.рф',
  },
  {
    id: 'msp-platform', title: 'Подбор мер поддержки на МСП.РФ', kind: 'consulting', provider: 'Корпорация МСП',
    summary: 'Цифровая платформа: подбор федеральных и региональных мер по ИНН, проверка контрагентов, льготные кредиты, обучение.',
    regimes: ALL_BUSINESS, howTo: 'Войдите через Госуслуги, укажите ИНН — платформа покажет доступные меры.', url: 'https://мсп.рф',
  },
  {
    id: 'social-contract', title: 'Социальный контракт на открытие своего дела', kind: 'subsidy', provider: 'Органы соцзащиты',
    summary: 'Единовременная выплата малоимущим семьям на запуск бизнеса (ИП или самозанятость) по бизнес-плану.',
    amount: 'до 350 000 ₽ (уточняйте в регионе)', regimes: ['npd', 'usn6', 'usn15', 'patent', 'none'], flags: ['lowIncome'],
    howTo: 'Подайте заявление в соцзащиту или через Госуслуги, приложите бизнес-план.', url: 'https://www.gosuslugi.ru',
  },
  {
    id: 'youth-grant', title: 'Грант молодым предпринимателям до 25 лет', kind: 'grant', provider: 'Центр «Мой бизнес»',
    summary: 'Грант на развитие бизнеса для молодых предпринимателей; обычно нужно обучение и софинансирование.',
    amount: 'от 100 000 до 500 000 ₽', regimes: MSP, maxAge: 24,
    howTo: 'Пройдите обучение в центре «Мой бизнес» и подайте заявку с проектом.', url: 'https://мойбизнес.рф',
  },
  {
    id: 'social-enterprise-grant', title: 'Грант социальному предприятию', kind: 'grant', provider: 'Центр «Мой бизнес»',
    summary: 'Для предприятий, включённых в реестр социальных предприятий (в т.ч. по критериям занятости уязвимых групп или социальным услугам).',
    amount: 'от 100 000 до 500 000 ₽', regimes: MSP, flags: ['socialEnterprise'],
    howTo: 'Получите статус соцпредприятия (сроки подачи уточните в центре «Мой бизнес» своего региона), затем подайте заявку на грант.', url: 'https://мойбизнес.рф',
  },
  {
    id: 'microloans', title: 'Микрозаймы государственных МФО', kind: 'loan', provider: 'Региональные государственные микрофинансовые организации',
    summary: 'Займы на льготных условиях для малого бизнеса и самозанятых, когда банк отказывает или нужно быстро.',
    regimes: ALL_BUSINESS, howTo: 'Обратитесь в региональную госМФО через центр «Мой бизнес».', url: 'https://мойбизнес.рф',
  },
  {
    id: 'guarantee', title: 'Поручительство региональной гарантийной организации / Корпорации МСП', kind: 'guarantee', provider: 'РГО, Корпорация МСП',
    summary: 'Помогает получить кредит, если не хватает залога: поручительство покрывает часть суммы.',
    regimes: MSP, howTo: 'Банк-партнёр оформляет заявку на поручительство вместе с кредитом.', url: 'https://мсп.рф',
  },
  {
    id: 'soft-credit', title: 'Льготное кредитование МСП', kind: 'loan', provider: 'Минэкономразвития, Корпорация МСП, банки-партнёры',
    summary: 'Кредиты по сниженной ставке за счёт господдержки, в т.ч. для приоритетных отраслей.',
    regimes: MSP, howTo: 'Подайте заявку в банк-участник программы или через МСП.РФ.', url: 'https://мсп.рф',
  },
  {
    id: 'employment-subsidy', title: 'Субсидия центра занятости на открытие дела', kind: 'subsidy', provider: 'Центр занятости населения',
    summary: 'Безработным, состоящим на учёте, могут выплатить единовременную помощь на регистрацию и запуск бизнеса (условия зависят от региона).',
    regimes: ['npd', 'usn6', 'usn15', 'patent', 'none'], flags: ['unemployed'],
    howTo: 'Встаньте на учёт через «Работа России» и подайте бизнес-план в центр занятости.', url: 'https://trudvsem.ru',
  },
  {
    id: 'fasie', title: 'Фонд содействия инновациям («Старт», «УМНИК» и др.)', kind: 'grant', provider: 'Фонд содействия инновациям',
    summary: 'Гранты на технологические и научные проекты, от идеи до выхода на рынок.',
    regimes: ['npd', 'usn6', 'usn15', 'ooo', 'none'], sectors: ['tech'],
    howTo: 'Следите за конкурсами и подавайте заявку в системе фонда.', url: 'https://fasie.ru',
  },
  {
    id: 'rosmol', title: 'Росмолодёжь.Гранты', kind: 'grant', provider: 'Росмолодёжь',
    summary: 'Гранты физлицам 14–35 лет на проекты, в т.ч. социальные и творческие (не на коммерческую деятельность как таковую).',
    amount: 'зависит от конкурса', regimes: ['npd', 'usn6', 'usn15', 'patent', 'ooo', 'none'], minAge: 14, maxAge: 35,
    howTo: 'Зарегистрируйтесь на платформе и подайте проект на конкурс.', url: 'https://grants.myrosmol.ru',
  },
  {
    id: 'agro', title: 'Гранты «Агростартап» и поддержка фермеров', kind: 'grant', provider: 'Минсельхоз / региональный минсельхоз',
    summary: 'Гранты на создание и развитие КФХ и сельхозкооперативов.',
    regimes: ['usn6', 'usn15', 'ooo', 'none'], sectors: ['agro'],
    howTo: 'Обратитесь в региональный минсельхоз или центр компетенций АПК.', url: 'https://mcx.gov.ru',
  },
  {
    id: 'export', title: 'Поддержка экспорта (РЭЦ, «Мой экспорт»)', kind: 'consulting', provider: 'Российский экспортный центр',
    summary: 'Консультации, поиск покупателей, компенсация части затрат на выход на зарубежные рынки.',
    regimes: MSP, sectors: ['export'], howTo: 'Зарегистрируйтесь на платформе «Мой экспорт».', url: 'https://www.exportcenter.ru',
  },
  {
    id: 'incubator', title: 'Бизнес-инкубаторы и льготная аренда', kind: 'property', provider: 'Регион, муниципалитет',
    summary: 'Помещения и коворкинги по сниженной ставке, перечни имущества для льготной аренды МСП и самозанятых.',
    regimes: ALL_BUSINESS, howTo: 'Узнайте перечень имущества и инкубаторы в центре «Мой бизнес».', url: 'https://мойбизнес.рф',
  },
  {
    id: 'regional-tax', title: 'Региональные налоговые ставки и льготы', kind: 'tax', provider: 'ФНС, закон субъекта РФ',
    summary: 'Регион может снижать ставки УСН и стоимость патента для отдельных видов деятельности. Проверьте ставки своего региона.',
    regimes: ['usn6', 'usn15', 'patent'], howTo: 'Сервис ФНС «Справочная информация о ставках и льготах по региональным налогам».', url: 'https://www.nalog.gov.ru',
  },
  {
    id: 'education', title: 'Бесплатное обучение предпринимательству', kind: 'education', provider: 'Центр «Мой бизнес», Корпорация МСП',
    summary: 'Курсы для начинающих и действующих предпринимателей, в т.ч. для самозанятых, подготовка к грантам.',
    regimes: ALL_BUSINESS.concat('none'), howTo: 'Запишитесь в центре «Мой бизнес» или на МСП.РФ.', url: 'https://мсп.рф',
  },
];

export interface SupportMatch { measure: SupportMeasure; reasons: string[] }

export function ageFromBirthYear(birthYear: number | undefined, now: number): number | undefined {
  if (!birthYear) return undefined;
  return new Date(now).getFullYear() - birthYear;
}

/** Подбор мер: фильтр по режиму, возрасту, отраслям и особым статусам. */
export function findSupport(profile: BizProfile, now: number, opts: { kind?: SupportKind; query?: string } = {}): SupportMatch[] {
  const age = ageFromBirthYear(profile.birthYear, now);
  const q = opts.query?.trim().toLowerCase();
  const out: SupportMatch[] = [];
  for (const m of SUPPORT_MEASURES) {
    const reasons: string[] = [];
    if (!m.regimes.includes(profile.regime)) continue;
    if (m.maxAge !== undefined) {
      // По году рождения возраст = age или age-1 (если день рождения ещё не наступил).
      if (age === undefined || age - 1 > m.maxAge) continue;
      reasons.push(age > m.maxAge
        ? `на границе по возрасту (${age - 1}–${age}), проверьте точную дату рождения`
        : `подходит по возрасту (${age - 1}–${age})`);
    }
    if (m.minAge !== undefined && (age === undefined || age < m.minAge)) continue;
    if (m.sectors) {
      const hit = m.sectors.filter(s => profile.sectors.includes(s));
      if (!hit.length) continue;
      reasons.push(`отрасль: ${hit.map(s => SECTOR_LABELS[s] ?? s).join(', ')}`);
    }
    if (m.flags) {
      const hit = m.flags.filter(f => profile.flags.includes(f));
      if (!hit.length) continue;
      reasons.push(hit.map(f => FLAG_LABELS[f] ?? f).join(', '));
    }
    if (opts.kind && m.kind !== opts.kind) continue;
    if (q && !`${m.title} ${m.summary} ${m.provider}`.toLowerCase().includes(q)) continue;
    out.push({ measure: m, reasons });
  }
  // Targeted measures (with reasons) first.
  return out.sort((a, b) => b.reasons.length - a.reasons.length);
}

/** Ссылка на поиск региональных мер (открывается в браузере пользователя). */
export function regionalSearchUrl(profile: BizProfile, now: number, topic = 'меры поддержки'): string {
  const who = profile.regime === 'npd' ? 'самозанятых' : profile.regime === 'ooo' ? 'малого бизнеса' : 'ИП';
  const region = profile.region || '';
  const text = `${topic} ${who} ${region} ${new Date(now).getFullYear()} официальный сайт`.replace(/\s+/g, ' ').trim();
  return `https://yandex.ru/search/?text=${encodeURIComponent(text)}`;
}

export const RUSSIAN_REGIONS: string[] = [
  'Москва', 'Санкт-Петербург', 'Севастополь', 'Республика Адыгея', 'Республика Алтай', 'Республика Башкортостан', 'Республика Бурятия',
  'Республика Дагестан', 'Республика Ингушетия', 'Кабардино-Балкарская Республика', 'Республика Калмыкия', 'Карачаево-Черкесская Республика',
  'Республика Карелия', 'Республика Коми', 'Республика Крым', 'Республика Марий Эл', 'Республика Мордовия', 'Республика Саха (Якутия)',
  'Республика Северная Осетия — Алания', 'Республика Татарстан', 'Республика Тыва', 'Удмуртская Республика', 'Республика Хакасия',
  'Чеченская Республика', 'Чувашская Республика', 'Алтайский край', 'Забайкальский край', 'Камчатский край', 'Краснодарский край',
  'Красноярский край', 'Пермский край', 'Приморский край', 'Ставропольский край', 'Хабаровский край', 'Амурская область',
  'Архангельская область', 'Астраханская область', 'Белгородская область', 'Брянская область', 'Владимирская область',
  'Волгоградская область', 'Вологодская область', 'Воронежская область', 'Ивановская область', 'Иркутская область',
  'Калининградская область', 'Калужская область', 'Кемеровская область — Кузбасс', 'Кировская область', 'Костромская область',
  'Курганская область', 'Курская область', 'Ленинградская область', 'Липецкая область', 'Магаданская область', 'Московская область',
  'Мурманская область', 'Нижегородская область', 'Новгородская область', 'Новосибирская область', 'Омская область',
  'Оренбургская область', 'Орловская область', 'Пензенская область', 'Псковская область', 'Ростовская область', 'Рязанская область',
  'Самарская область', 'Саратовская область', 'Сахалинская область', 'Свердловская область', 'Смоленская область',
  'Тамбовская область', 'Тверская область', 'Томская область', 'Тульская область', 'Тюменская область', 'Ульяновская область',
  'Челябинская область', 'Ярославская область', 'Еврейская автономная область', 'Ненецкий автономный округ',
  'Ханты-Мансийский автономный округ — Югра', 'Чукотский автономный округ', 'Ямало-Ненецкий автономный округ',
];
