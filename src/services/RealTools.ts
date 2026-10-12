// Real Tool Registry - Uses actual PlatformHands for device control
// Безопасность: действия на экране «прикалываются» к приложению, которое было на экране в начале,
// и перед самим нажатием/вводом/свайпом/клавишей проверяется, что оно всё ещё на экране (оверлей/подмена = отказ).
// Перед нажатием элемент ищется ещё раз и сравнивается (id, текст, границы, описание, нажимаемость):
// подмена кнопки внутри того же приложения = отказ. После этого читается самое свежее дерево экрана:
// того же элемента (id, текст, границы и описание) в нём нет = отказ (координаты устарели); если сам
// элемент не нажимается, а его нажимаемый родитель подписан опасно («Удалить», «Оплатить»…), а у
// элемента безобидная подпись («Продолжить») — отказ.
// Ввод идёт только в то поле, которое было в фокусе в начале (фокус ушёл = отказ).
// Сообщение уходит только в чат, в ЗАГОЛОВКЕ которого (самый верхний текст) именно этот собеседник,
// только той же кнопкой «Отправить» и только пока фокус всё ещё в том же поле сообщения.
// По имени пишем только если в телефонной книге РОВНО один подходящий контакт: несколько (два «Алекса»),
// ни одного или книгу не удалось проверить — сообщение не отправляется: нужен номер или
// полное имя. Имя в тексте сообщения ниже заголовка не считается. «Отправляющие» клавиши (Enter, Search, Go…)
// нажимаются только в поле в фокусе и только если фокус не ушёл; поиск в браузере вводит и отправляет запрос в то же поле.
// Свайп — «слепой» жест по координатам внутри того же приложения (низкий риск, цели у него нет).
// Проверка результата (verify) тоже считает доказательством только экран того же приложения.
import type { Tool, ToolResult } from './ToolRegistry';
import { handsManager } from './HandsManager';
import { HTTPHands } from './HTTPHands';

async function requireHands(): Promise<void> {
  const connected = await handsManager.isConnected();
  if (!connected) throw new Error('Android device not connected. Please connect via Settings → Android Connection.');
}

/** На экране всё ещё то приложение, в котором мы действуем (а не подменённое окно или оверлей). */
async function stillIn(hands: { getCurrentApp(): Promise<unknown> }, pkg: string): Promise<boolean> {
  try { return (await hands.getCurrentApp()) === pkg; } catch { return false; }
}

/** Приложение на экране в начале действия; если его нельзя определить — действие не выполняется. */
async function pinApp(hands: { getCurrentApp(): Promise<unknown> }): Promise<string | null> {
  try { const app = await hands.getCurrentApp(); return typeof app === 'string' && app ? app : null; } catch { return null; }
}

interface ElementLike { id?: unknown; text?: unknown; bounds?: { x: number; y: number; width: number; height: number } }

/** Тот же самый элемент: совпадают id, текст и границы. */
function sameElement(a: ElementLike | null | undefined, b: ElementLike | null | undefined): boolean {
  if (!a || !b || !a.bounds || !b.bounds) return false;
  return a.id === b.id && a.text === b.text
    && a.bounds.x === b.bounds.x && a.bounds.y === b.bounds.y
    && a.bounds.width === b.bounds.width && a.bounds.height === b.bounds.height;
}

/** Тот же самый элемент для нажатия: кроме id, текста и границ — те же описание и нажимаемость. */
function sameTapElement(a: any, b: any): boolean {
  return sameElement(a, b) && a.contentDescription === b.contentDescription && a.clickable === b.clickable;
}

/** Опасные действия по подписи: корни слов (любая форма) и короткие слова целиком. */
const DANGER_STEMS = /(delete|remove|uninstall|install|purchase|checkout|transfer|confirm|submit|reset|erase|wipe|subscribe|allow|grant|sign\s*out|log\s*out|place\s*order|удал|оплат|заплат|купить|покуп|перевест|перевод|отправ|установ|подтвер|сброс|стере|подписат|списат|разреш|предостав|позвон|вызов)/i;
const DANGER_WORDS = /(^|[^\p{L}\p{N}])(pay|buy|send|order|call|format|accept|ok)(?=$|[^\p{L}\p{N}])/iu;

function isDangerousLabel(label: string): boolean {
  return DANGER_STEMS.test(label) || DANGER_WORDS.test(label);
}

/** Подпись элемента: текст, описание и id. */
function labelOf(n: any): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return `${s(n?.text)} ${s(n?.contentDescription)} ${s(n?.id)}`;
}

const MAX_TREE_DEPTH = 60;

/**
 * Путь от корня до узла, совпадающего с элементом (id, текст, границы и — если оно известно у
 * элемента — то же описание contentDescription), или null.
 */
function pathTo(root: any, el: ElementLike & { contentDescription?: unknown }): any[] | null {
  const matches = (n: any) => sameElement(n, el)
    && (el.contentDescription === undefined || n?.contentDescription === el.contentDescription);
  const walk = (n: any, path: any[]): any[] | null => {
    if (!n || path.length > MAX_TREE_DEPTH) return null;
    const next = [...path, n];
    if (matches(n)) return next;
    for (const c of Array.isArray(n.children) ? n.children : []) { const found = walk(c, next); if (found) return found; }
    return null;
  };
  return walk(root, []);
}

/**
 * Нажатие уйдёт не тому, что проверяли: сам элемент не нажимается, а его ближайший нажимаемый
 * родитель подписан опасно («Удалить аккаунт» вокруг «Продолжить»), хотя подпись элемента — нет.
 * Узел в дереве должен совпадать с элементом и по нажимаемости (если она известна у обоих).
 * Элемента нет в дереве — тоже отказ (неизвестно, что сейчас под этими координатами).
 */
function tapEscalates(tree: any, el: ElementLike & { clickable?: unknown; contentDescription?: unknown }): boolean {
  const path = pathTo(tree?.root, el);
  if (!path) return true;
  const node = path[path.length - 1];
  if (typeof node?.clickable === 'boolean' && typeof el?.clickable === 'boolean' && node.clickable !== el.clickable) return true;
  if (node?.clickable !== false) return false;
  if (isDangerousLabel(labelOf(node))) return false;
  for (let i = path.length - 2; i >= 0; i--) {
    if (path[i]?.clickable === true) return isDangerousLabel(labelOf(path[i]));
  }
  return false;
}

function isEditable(node: any): boolean {
  return node?.type === 'EditText' || node?.type === 'TextField' || (typeof node?.className === 'string' && node.className.includes('EditText'));
}

/** Поле ввода в фокусе (или null). */
function findFocusedInput(node: any): any {
  if (node?.focused && isEditable(node)) return node;
  for (const child of node?.children || []) { const found = findFocusedInput(child); if (found) return found; }
  return null;
}

/** Поле в фокусе на экране прямо сейчас. */
async function focusedField(hands: { getAccessibilityTree(): Promise<any> }): Promise<any> {
  try { const tree = await hands.getAccessibilityTree(); return findFocusedInput(tree?.root); } catch { return null; }
}

interface FieldLike { id?: unknown; type?: unknown; className?: unknown; bounds?: unknown }

/** То же поле: совпадают id, тип и границы (текст при вводе меняется). */
function sameField(a: FieldLike | null | undefined, b: FieldLike | null | undefined): boolean {
  if (!a || !b) return false;
  return a.id === b.id && a.type === b.type && a.className === b.className
    && JSON.stringify(a.bounds ?? null) === JSON.stringify(b.bounds ?? null);
}

function fieldIdentity(f: any): FieldLike {
  return { id: f?.id, type: f?.type, className: f?.className, bounds: f?.bounds };
}

/** Клавиши, которые отправляют/подтверждают ввод (их можно нажать только в поле в фокусе). */
const SUBMIT_KEYS = new Set(['enter', 'numpad_enter', 'send', 'submit', 'search', 'go', 'done', 'dpad_center', 'return']);
function isSubmitKey(key: unknown): boolean {
  const k = String(key ?? '').trim().toLowerCase().replace(/^keycode_/, '');
  return SUBMIT_KEYS.has(k);
}

/**
 * Заголовок чата: самый верхний (по границам, иначе первый по порядку) нередактируемый текст на экране.
 * Сообщения и подписи ниже с тем же именем заголовком не считаются.
 */
function chatTitle(root: any): string | null {
  const items: { text: string; y: number; x: number; order: number }[] = [];
  let order = 0;
  const walk = (n: any) => {
    if (!n) return;
    if (!isEditable(n) && typeof n.text === 'string' && n.text.trim()) {
      const b = n.bounds;
      items.push({ text: n.text.trim(), y: typeof b?.y === 'number' ? b.y : Infinity, x: typeof b?.x === 'number' ? b.x : Infinity, order: order++ });
    }
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  if (!items.length) return null;
  items.sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.order - b.order));
  return items[0].text;
}

/** Открыт чат именно с этим собеседником: заголовок равен имени или начинается с него («John Smith» для «John»). */
function showsRecipient(root: any, contact: string): boolean {
  const title = chatTitle(root)?.toLowerCase();
  const want = contact.trim().toLowerCase();
  if (!title || !want) return false;
  return title === want || title.startsWith(`${want} `);
}

async function recipientOnScreen(hands: { getAccessibilityTree(): Promise<any> }, contact: string): Promise<boolean> {
  try { const tree = await hands.getAccessibilityTree(); return showsRecipient(tree?.root, contact); } catch { return false; }
}

type ContactCheck = 'unique' | 'ambiguous' | 'missing' | 'unverified';

const CONTACT_CHECK_LIMIT = 200;

/** Номер телефона: только цифры, «+» в начале и разделители, и не меньше 5 цифр («-----» — не номер). */
function isPhoneNumber(value: string): boolean {
  return /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, '').length >= 5;
}

/** Запись телефонной книги понятного вида: объект с именем-строкой. */
function isContactEntry(c: unknown): c is { name: string } {
  return !!c && typeof c === 'object' && !Array.isArray(c) && typeof (c as { name?: unknown }).name === 'string';
}

/**
 * Кому писать по имени: в телефонной книге должен быть РОВНО один подходящий контакт
 * (то же имя или «Alex» для «Alex Smith»). Несколько — 'ambiguous' (заголовок чата любого из них
 * пройдёт проверку), ни одного — 'missing' (неизвестно, кто это на экране мессенджера).
 * Номер телефона однозначен и не проверяется. Если телефонная книга по мосту не ответила, ответ
 * непонятный (хоть одна запись без имени-строки) или неполный (по запросу контактов больше,
 * чем пришло) — 'unverified'. Во всех случаях, кроме 'unique', по имени не пишем (fail closed).
 * Отладочный WebSocket-путь (не HTTPHands) телефонной книги не имеет: там остаются проверки на экране.
 */
async function checkContact(hands: unknown, contact: string): Promise<ContactCheck> {
  const want = contact.trim().toLowerCase();
  if (!want) return 'unverified';
  if (isPhoneNumber(want)) return 'unique';
  if (!(hands instanceof HTTPHands)) return 'unique';
  try {
    const page = await hands.listContacts({ query: contact.trim(), limit: CONTACT_CHECK_LIMIT });
    if (!page || !Array.isArray(page.contacts)) return 'unverified';
    const list = page.contacts as unknown[];
    if (!list.every(isContactEntry)) return 'unverified';
    const total = (page as { total?: unknown }).total;
    if (typeof total !== 'number' || !Number.isFinite(total) || total < 0 || total > list.length) return 'unverified';
    const matches = list.filter(c => {
      const name = c.name.trim().toLowerCase();
      return name === want || name.startsWith(`${want} `);
    });
    if (matches.length === 0) return 'missing';
    return matches.length === 1 ? 'unique' : 'ambiguous';
  } catch { return 'unverified'; }
}

const UNKNOWN_APP: ToolResult = { success: false, error: 'Cannot determine which app is on screen. Stopped for safety.' };
const movedFrom = (app: string): ToolResult => ({ success: false, error: `Another app is on screen instead of ${app}. Stopped for safety.` });
const ELEMENT_CHANGED: ToolResult = { success: false, error: 'The element changed right before the tap. Stopped for safety.' };
const NOT_ON_SCREEN: ToolResult = { success: false, error: 'The element is no longer on the current screen. Stopped for safety.' };
const TAP_ESCALATES: ToolResult = { success: false, error: 'This label is inside a button with a different, risky action. Stopped for safety: tap the button itself.' };
const NO_FIELD: ToolResult = { success: false, error: 'No focused input field. Tap the field first.' };
const FIELD_CHANGED: ToolResult = { success: false, error: 'The input field changed right before typing. Stopped for safety.' };
const NO_CHAT_INPUT: ToolResult = { success: false, error: 'Message field is not focused in the chat. Stopped for safety.' };
const WRONG_RECIPIENT: ToolResult = { success: false, error: 'The open chat is not with the requested contact. Stopped for safety.' };
const AMBIGUOUS_CONTACT: ToolResult = { success: false, error: 'There are several contacts with this name. Use the phone number or the full name.' };
const NOT_IN_CONTACTS: ToolResult = { success: false, error: 'This name is not in the phone contacts. Use the phone number or the exact contact name.' };
const CONTACT_UNVERIFIED: ToolResult = { success: false, error: 'Could not check the phone contacts for this name. Use the phone number instead.' };

export const openAppTool: Tool = {
  id: 'open_app', name: 'Open Application', description: 'Launch an Android application by package name', category: 'navigation', riskLevel: 'low',
  inputSchema: { type: 'object', properties: { packageName: { type: 'string', description: 'Android package name' } }, required: ['packageName'] },
  async execute(params: { packageName: string }): Promise<ToolResult> {
    await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' };
    const result = await hands.launchApp(params.packageName);
    if (!result.success) return { success: false, error: result.error || 'Failed to launch app' };
    await new Promise(r => setTimeout(r, 1000));
    const currentApp = await hands.getCurrentApp();
    if (currentApp === params.packageName) return { success: true, data: { app: params.packageName, currentApp, verified: true, timestamp: Date.now() } };
    return { success: false, error: `Verification failed: expected ${params.packageName}, got ${currentApp}` };
  },
  async verify(params, result) { return !!result.success && result.data?.verified === true && result.data?.currentApp === params.packageName; },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const readContactsTool: Tool = {
  id: 'read_contacts', name: 'Read Contacts',
  description: 'Read contacts (name and phone numbers) from the connected Android phone. Use query to filter by name; page with limit/offset.',
  category: 'data', riskLevel: 'medium',
  inputSchema: { type: 'object', properties: {
    query: { type: 'string', description: 'Part of the contact name (optional)' },
    limit: { type: 'number', description: 'Max contacts to return, default 500, max 5000' },
    offset: { type: 'number', description: 'Skip this many contacts (paging)' },
  } },
  async execute(params: Record<string, any>): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!(hands instanceof HTTPHands)) {
      return { success: false, error: 'Contacts are available only over the Svetlana-home HTTP bridge. Connect the phone on the Android Connection page.' };
    }
    const page = await hands.listContacts({ query: params.query, limit: params.limit, offset: params.offset });
    if (!page || !Array.isArray(page.contacts)) return { success: false, error: 'Unexpected response from the phone' };
    return { success: true, data: { total: page.total, offset: page.offset, count: page.contacts.length, contacts: page.contacts, timestamp: Date.now() } };
  },
  async verify(_params, result) { return !!result.success && Array.isArray(result.data?.contacts) && result.data.count === result.data.contacts.length; },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const tapElementTool: Tool = {
  id: 'tap_element', name: 'Tap UI Element', description: 'Tap on a UI element by text or ID', category: 'interaction', riskLevel: 'low',
  inputSchema: { type: 'object', properties: { elementText: { type: 'string', description: 'Text content of the element to tap' }, elementId: { type: 'string', description: 'Resource ID of the element to tap' } } },
  async execute(params: { elementText?: string; elementId?: string }): Promise<ToolResult> {
    await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' };
    const pinned = await pinApp(hands); if (!pinned) return UNKNOWN_APP;
    const find = async () => params.elementText ? await hands.findElementByText(params.elementText)
      : params.elementId ? await hands.findElementById(params.elementId) : undefined;
    const element = await find();
    if (!element) return { success: false, error: `Element not found: ${params.elementText || params.elementId}` };
    // Элемент ищем ещё раз: другая кнопка на том же месте, сдвиг или смена описания/нажимаемости = отказ.
    if (!sameTapElement(element, await find())) return ELEMENT_CHANGED;
    // Самое свежее дерево (после повторной проверки): того же элемента в нём нет — отказ;
    // безобидная подпись внутри опасной кнопки — отказ.
    const beforeTree = await hands.getAccessibilityTree();
    if (!pathTo(beforeTree?.root, element)) return NOT_ON_SCREEN;
    if (tapEscalates(beforeTree, element)) return TAP_ESCALATES;
    const beforeApp = await hands.getCurrentApp();
    // И сразу перед нажатием: на экране то же приложение.
    if (beforeApp !== pinned) return movedFrom(pinned);
    const centerX = element.bounds.x + element.bounds.width / 2; const centerY = element.bounds.y + element.bounds.height / 2;
    const tapResult = await hands.tap(centerX, centerY);
    if (!tapResult.success) return { success: false, error: tapResult.error || 'Tap failed' };
    await new Promise(r => setTimeout(r, 500));
    const afterTree = await hands.getAccessibilityTree(); const afterApp = await hands.getCurrentApp();
    return { success: true, data: { element: { id: element.id, text: element.text, bounds: element.bounds }, tappedAt: { x: centerX, y: centerY }, beforeTree, afterTree, beforeApp, afterApp, pinned, timestamp: Date.now() } };
  },
  async verify(_params, result) {
    if (!result.success || !result.data?.beforeTree || !result.data?.afterTree) return false;
    // Доказательство только из того же приложения: смена приложения после нажатия неотличима от оверлея — не подтверждено.
    if (!result.data.pinned || result.data.afterApp !== result.data.pinned) return false;
    const beforeCount = result.data.beforeTree.root?.children?.length || 0; const afterCount = result.data.afterTree.root?.children?.length || 0;
    return beforeCount !== afterCount;
  },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const typeTextTool: Tool = {
  id: 'type_text', name: 'Type Text', description: 'Type text into the focused input field', category: 'interaction', riskLevel: 'medium',
  inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Text to type' }, clearFirst: { type: 'boolean', description: 'Clear field before typing' } }, required: ['text'] },
  async execute(params: { text: string; clearFirst?: boolean }): Promise<ToolResult> {
    await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' };
    const pinned = await pinApp(hands); if (!pinned) return UNKNOWN_APP;
    // Поле фиксируется в начале; перед очисткой и перед вводом фокус должен быть всё ещё в нём.
    const field = await focusedField(hands);
    if (!field) return NO_FIELD;
    if (params.clearFirst) {
      if (!(await stillIn(hands, pinned))) return movedFrom(pinned);
      if (!sameField(field, await focusedField(hands))) return FIELD_CHANGED;
      const clear = await hands.clearText(); if (!clear.success) return { success: false, error: clear.error || 'Failed to clear text' };
    }
    if (!(await stillIn(hands, pinned))) return movedFrom(pinned);
    if (!sameField(field, await focusedField(hands))) return FIELD_CHANGED;
    const result = await hands.type(params.text); if (!result.success) return { success: false, error: result.error || 'Failed to type text' };
    return { success: true, data: { typed: params.text, length: params.text.length, app: pinned, field: fieldIdentity(field), timestamp: Date.now() } };
  },
  async verify(params, result) {
    if (!result.success || typeof result.data?.app !== 'string') return false; const hands = handsManager.getHands(); if (!hands) return false;
    // Читаем поле только если на экране то же приложение (иначе «подтверждение» может прийти из оверлея).
    if (!(await stillIn(hands, result.data.app))) return false;
    const input = await focusedField(hands);
    // И только из того же поля, в которое вводили.
    return !!input && sameField(input, result.data.field) && String(input.text || '').includes(params.text);
  },
  async isAvailable() { return await handsManager.isConnected(); },
};

/**
 * Снимок экрана — только через защищённый мост Svetlana-home (HTTP v2). Сейчас телефон снимки по мосту
 * не отдаёт — инструмент честно сообщает об этом. Отладочный WebSocket-путь сырые снимки не отдаёт.
 */
export const captureScreenTool: Tool = {
  id: 'capture_screen', name: 'Capture Screen', description: 'Take a screenshot of the current screen', category: 'system', riskLevel: 'medium', inputSchema: { type: 'object', properties: {} },
  async execute(): Promise<ToolResult> {
    await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' };
    if (!(hands instanceof HTTPHands)) return { success: false, error: 'Screenshots are available only over the protected Svetlana-home bridge.' };
    const capture = await hands.captureScreen();
    if (!capture?.image) return { success: false, error: 'The phone refused the screenshot (privacy policy) or it failed.' };
    return { success: true, data: { image: capture.image, width: capture.width, height: capture.height, timestamp: capture.timestamp } };
  },
  async verify(_params, result) { return !!result.success && !!result.data?.image; }, async isAvailable() { return await handsManager.isConnected(); },
};

export const sendMessageTool: Tool = {
  id: 'send_message', name: 'Send Message', description: 'Send a message via a messaging app (requires confirmation)', category: 'communication', riskLevel: 'high',
  inputSchema: { type: 'object', properties: { app: { type: 'string', description: 'Messaging app package name', enum: ['org.telegram.messenger', 'com.whatsapp', 'com.viber.voip'] }, contact: { type: 'string', description: 'Contact name or phone number' }, message: { type: 'string', description: 'Message text to send' } }, required: ['app', 'contact', 'message'] },
  async execute(params: { app: string; contact: string; message: string }): Promise<ToolResult> {
    await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' };
    // Кому писать по имени — только если в телефонной книге ровно один такой контакт;
    // иначе ничего не открываем и не печатаем.
    const check = await checkContact(hands, params.contact);
    if (check === 'ambiguous') return AMBIGUOUS_CONTACT;
    if (check === 'missing') return NOT_IN_CONTACTS;
    if (check === 'unverified') return CONTACT_UNVERIFIED;
    const moved = () => movedFrom(params.app);
    const launch = await hands.launchApp(params.app); if (!launch.success) return { success: false, error: `Failed to launch ${params.app}` };
    await new Promise(r => setTimeout(r, 2000));
    if (!(await stillIn(hands, params.app))) return moved();
    const findContact = () => hands.findElementByText(params.contact);
    const contact = await findContact(); if (!contact) return { success: false, error: `Contact not found: ${params.contact}` };
    // Строка чата ищется ещё раз прямо перед нажатием: подмена или сдвиг = отказ.
    if (!sameElement(contact, await findContact())) return ELEMENT_CHANGED;
    if (!(await stillIn(hands, params.app))) return moved();
    const tap = await hands.tap(contact.bounds.x + contact.bounds.width / 2, contact.bounds.y + contact.bounds.height / 2); if (!tap.success) return { success: false, error: 'Failed to tap contact' };
    await new Promise(r => setTimeout(r, 1000));
    if (!(await stillIn(hands, params.app))) return moved();
    // Открыт чат именно с этим собеседником (заголовок), и в нём поле ввода в фокусе.
    const field = await focusedField(hands);
    if (!field) return NO_CHAT_INPUT;
    if (!(await recipientOnScreen(hands, params.contact))) return WRONG_RECIPIENT;
    if (!(await stillIn(hands, params.app))) return moved();
    if (!sameField(field, await focusedField(hands))) return FIELD_CHANGED;
    const type = await hands.type(params.message); if (!type.success) return { success: false, error: 'Failed to type message' };
    await new Promise(r => setTimeout(r, 500));
    const findSend = async () => (await hands.findElementByText('Send')) || (await hands.findElementByText('Отправить'));
    const send = await findSend(); if (!send) return { success: false, error: 'Send button not found. Message typed but not sent.', data: { messageTyped: true, sent: false } };
    // Перед отправкой: та же кнопка, тот же собеседник в заголовке и фокус всё ещё в том же поле сообщения.
    if (!sameElement(send, await findSend())) return { ...ELEMENT_CHANGED, data: { messageTyped: true, sent: false } };
    if (!(await recipientOnScreen(hands, params.contact))) return { ...WRONG_RECIPIENT, data: { messageTyped: true, sent: false } };
    if (!sameField(field, await focusedField(hands))) return { ...FIELD_CHANGED, data: { messageTyped: true, sent: false } };
    if (!(await stillIn(hands, params.app))) return moved();
    const sent = await hands.tap(send.bounds.x + send.bounds.width / 2, send.bounds.y + send.bounds.height / 2); if (!sent.success) return { success: false, error: 'Failed to tap send button' };
    await new Promise(r => setTimeout(r, 500)); const tree = await hands.getAccessibilityTree();
    // Дерево принимаем как доказательство только если оно всё ещё из того же мессенджера (а не из подсунутого окна).
    if (!(await stillIn(hands, params.app))) return { success: false, error: `Message may have been sent, but another app is on screen instead of ${params.app}; delivery is not confirmed.`, data: { sent: 'unverified' } };
    return { success: true, data: { app: params.app, contact: params.contact, message: params.message, sent: true, afterTree: tree, timestamp: Date.now() } };
  },
  async verify(params, result) { if (!result.success || !result.data?.afterTree) return false; const find = (node: any): boolean => !!node && ((typeof node.text === 'string' && node.text.includes(params.message)) || (node.children || []).some((c: any) => find(c))); return find(result.data.afterTree.root); },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const swipeTool: Tool = {
  id: 'swipe', name: 'Swipe', description: 'Perform a swipe gesture on the screen', category: 'interaction', riskLevel: 'low',
  inputSchema: { type: 'object', properties: { startX: { type: 'number', description: 'Start X coordinate' }, startY: { type: 'number', description: 'Start Y coordinate' }, endX: { type: 'number', description: 'End X coordinate' }, endY: { type: 'number', description: 'End Y coordinate' }, duration: { type: 'number', description: 'Duration in milliseconds' } }, required: ['startX', 'startY', 'endX', 'endY'] },
  async execute(p) {
    await requireHands(); const h = handsManager.getHands(); if (!h) return { success: false, error: 'Hands not available' };
    const pinned = await pinApp(h); if (!pinned) return UNKNOWN_APP;
    if (!(await stillIn(h, pinned))) return movedFrom(pinned);
    const r = await h.swipe(p.startX, p.startY, p.endX, p.endY, p.duration);
    return r.success ? { success: true, data: { ...p, duration: p.duration || 300, app: pinned } } : { success: false, error: r.error || 'Swipe failed' };
  },
  async verify(_p, r) { return r.success; },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const pressKeyTool: Tool = {
  id: 'press_key', name: 'Press Key', description: 'Press a hardware key', category: 'interaction', riskLevel: 'low',
  inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Key name' } }, required: ['key'] },
  async execute(p) {
    await requireHands(); const h = handsManager.getHands(); if (!h) return { success: false, error: 'Hands not available' };
    const pinned = await pinApp(h); if (!pinned) return UNKNOWN_APP;
    // Если в начале было поле в фокусе, клавиша нажимается только в нём. «Отправляющие» клавиши
    // (Enter, Search, Go…) без поля в фокусе не нажимаются вообще.
    const field = await focusedField(h);
    if (!field && isSubmitKey(p.key)) return { success: false, error: 'No focused input field for this key. Stopped for safety.' };
    if (!(await stillIn(h, pinned))) return movedFrom(pinned);
    if (field && !sameField(field, await focusedField(h))) return { success: false, error: 'The focused field changed right before the key press. Stopped for safety.' };
    const r = await h.pressKey(p.key);
    return r.success ? { success: true, data: { key: p.key, app: pinned } } : { success: false, error: r.error || 'Key press failed' };
  },
  async verify(_p, r) { return r.success; },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const goHomeTool: Tool = { id:'go_home', name:'Go Home', description:'Navigate to Android home screen', category:'navigation', riskLevel:'low', inputSchema:{type:'object',properties:{}}, async execute(){await requireHands();const h=handsManager.getHands();if(!h)return{success:false,error:'Hands not available'};const beforeApp=await h.getCurrentApp();const r=await h.goHome();if(!r.success)return{success:false,error:r.error||'Home navigation failed'};await new Promise(res=>setTimeout(res,300));const afterApp=await h.getCurrentApp();return afterApp==='com.android.launcher'?{success:true,data:{navigated:true,beforeApp,afterApp,currentApp:afterApp}}:{success:false,error:`Verification failed: expected com.android.launcher, got ${afterApp}`,data:{navigated:false,beforeApp,afterApp,currentApp:afterApp}};},async verify(_p,r){return !!r.success&&r.data?.afterApp==='com.android.launcher'},async isAvailable(){return await handsManager.isConnected();}};

export const goBackTool: Tool = { id:'go_back', name:'Go Back', description:'Navigate back', category:'navigation', riskLevel:'low', inputSchema:{type:'object',properties:{}}, async execute(){await requireHands();const h=handsManager.getHands();if(!h)return{success:false,error:'Hands not available'};const beforeApp=await h.getCurrentApp();const r=await h.goBack();if(!r.success)return{success:false,error:r.error||'Back navigation failed'};await new Promise(res=>setTimeout(res,300));const afterApp=await h.getCurrentApp();const navigated=beforeApp!==afterApp;return navigated?{success:true,data:{navigated,beforeApp,afterApp}}:{success:false,error:`Verification failed: back navigation did not change app (${beforeApp})`,data:{navigated:false,beforeApp,afterApp}};},async verify(_p,r){return !!r.success&&r.data?.navigated===true&&r.data?.beforeApp!==r.data?.afterApp},async isAvailable(){return await handsManager.isConnected();}};

export const searchWebTool: Tool = {
  id: 'search_web', name: 'Search Web', description: 'Search the web using default browser', category: 'data', riskLevel: 'low',
  inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] },
  async execute(p) {
    await requireHands(); const h = handsManager.getHands(); if (!h) return { success: false, error: 'Hands not available' };
    const browser = 'com.android.chrome';
    const url = `https://www.google.com/search?q=${encodeURIComponent(p.query)}`;
    const l = await h.launchApp(browser); if (!l.success) return { success: false, error: 'Failed to open browser' };
    await new Promise(r => setTimeout(r, 1000));
    if (!(await stillIn(h, browser))) return movedFrom(browser);
    // Запрос вводится только в поле браузера в фокусе, Enter — только в то же поле.
    const field = await focusedField(h);
    if (!field) return NO_FIELD;
    if (!sameField(field, await focusedField(h))) return FIELD_CHANGED;
    const t = await h.type(url); if (!t.success) return { success: false, error: 'Failed to type search query' };
    // Enter — только если браузер всё ещё на экране и фокус в том же поле (иначе запрос уйдёт в подсунутое окно).
    if (!(await stillIn(h, browser))) return movedFrom(browser);
    if (!sameField(field, await focusedField(h))) return { success: false, error: 'The browser field changed before submitting. Stopped for safety.' };
    const e = await h.pressKey('enter');
    return e.success ? { success: true, data: { query: p.query, url, browser } } : { success: false, error: 'Failed to submit search' };
  },
  async verify(_p, r) { return r.success; },
  async isAvailable() { return await handsManager.isConnected(); },
};

import { toolRegistry } from './ToolRegistry';
export function registerRealTools(){[openAppTool,readContactsTool,tapElementTool,typeTextTool,captureScreenTool,sendMessageTool,swipeTool,pressKeyTool,goHomeTool,goBackTool,searchWebTool].forEach(t=>toolRegistry.registerTool(t));}
registerRealTools();
