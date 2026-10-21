// Личный кабинет: привязка устройства (компьютера или телефона) к сайту «Мир Самозанятых», состояние защиты
// и кнопка полного удаления данных с этого устройства. Одинаковая на сайте, в Windows и в Android:
// те же пять проверок защиты и список локальных моделей (на телефоне — с компьютера в домашней сети).
// Проверки подписаны словами («включено / не включено»), а не только цветом иконки. Полное удаление
// подтверждается в окне Светланы (askConfirm), и только после настоящего нажатия человеком.
// «Отвязать» тоже спрашивает подтверждение: случайное нажатие не должно заставлять заново получать код на сайте.
// Ошибка связи не оставляет кнопки выключенными: везде try/finally, технический текст ошибки не показывается.
import { useEffect, useState, type MouseEvent } from 'react';
import { Link2, Unlink, ShieldCheck, ShieldAlert, Trash2, RefreshCw } from 'lucide-react';
import { linkDevice, unlinkLocal, loadMeta, sendHeartbeat, collectHeartbeat, normalizeLinkCode, type CabinetMeta, type Heartbeat } from '../services/cabinet/CabinetClient';
import { wipeAllLocalData } from '../services/security/WipeAll';
import { userGesture } from '../services/security/ActionGate';
import { isAndroidApp } from '../platform';
import { askConfirm } from '../components/ConfirmDialog';
import { safeErrorText } from '../services/safeErrorText';

const card = 'rounded-xl border border-white/10 bg-white/5 p-5 space-y-3';
const input = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-slate-100 font-mono tracking-widest uppercase';
const btn = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold';

const CHECKS: [keyof Heartbeat['status'], string][] = [
  ['secrets_encrypted', 'Ключи зашифрованы'],
  ['bridge_v2', 'Защищённый мост ПК ↔ телефон'],
  ['voice_enrolled', 'Голос владельца записан'],
  ['confirm_gate', 'Подтверждение опасных действий'],
  ['paired_with', 'Подключён Svetlana-home'],
];

const errText = (e: unknown): string => safeErrorText(e, 'отменено');

export default function CabinetPage() {
  const android = isAndroidApp();
  const device = android ? 'Телефон' : 'Компьютер';
  const onDevice = android ? 'на этом телефоне' : 'на этом компьютере';
  const [meta, setMeta] = useState<CabinetMeta | null>(loadMeta());
  const [hb, setHb] = useState<Heartbeat | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState(android ? 'Мой телефон' : 'Мой компьютер');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const say = (text: string, error = false) => setMsg({ text, error });

  /** Состояние защиты и привязки. Сбой не роняет страницу: остаётся прежнее состояние. */
  const refresh = async () => {
    try { setHb(await collectHeartbeat()); } catch { /* проверки покажутся при следующем обновлении */ }
    try { setMeta(loadMeta()); } catch { /* хранилище недоступно */ }
  };
  useEffect(() => { void refresh(); }, []);

  const onLink = async () => {
    setMsg(null); setBusy(true);
    try {
      normalizeLinkCode(code);
      await linkDevice({ code, name });
      setCode('');
      await sendHeartbeat().catch(() => undefined);
      say(`${device} привязан к личному кабинету.`);
    } catch (e) { say(safeErrorText(e, 'Не удалось привязать. Проверьте код и интернет.'), true); }
    finally { setBusy(false); await refresh(); }
  };

  const onSync = async () => {
    setBusy(true);
    try {
      const r = await sendHeartbeat();
      if (r === 'ok') say('Состояние отправлено в кабинет.');
      else say(r === 'unlinked' ? 'Устройство отключено в кабинете.' : r === 'not_linked' ? `${device} ещё не привязан.` : 'Нет связи с сайтом, попробую позже.', true);
    } catch {
      say('Нет связи с сайтом, попробую позже.', true);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const onUnlink = async () => {
    if (busy) return;
    const sure = await askConfirm('Отвязать ' + (android ? 'этот телефон' : 'этот компьютер') + ' от личного кабинета? Данные останутся ' + onDevice + ', а чтобы привязать снова, понадобится новый код с сайта.', { okText: 'Отвязать' });
    if (!sure) return;
    setBusy(true);
    try {
      await unlinkLocal();
      say(`Привязка удалена ${onDevice}. Отключите устройство и в кабинете.`);
    } catch (e) {
      say(safeErrorText(e, 'Не удалось отвязать устройство. Попробуйте ещё раз.'), true);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const onWipe = async (e: MouseEvent) => {
    // Только настоящее нажатие человеком: голос, нейросеть или скрипт удалить данные не могут.
    if (busy || !userGesture(e.nativeEvent)) return;
    const sure = await askConfirm(`Удалить ВСЕ данные Светланы ${onDevice}: клиентов, финансы, записи, память, голос, ключи и привязки? Отменить нельзя.`, { okText: 'Удалить всё' });
    if (!sure) return;
    setBusy(true);
    let n: number;
    try {
      n = await wipeAllLocalData();
    } catch (err) {
      // «Отмена» в окне системы: CRM, бизнес и прочие данные не тронуты.
      say(`Удаление остановлено: ${errText(err)}. Клиенты, финансы, записи и настройки остались ${onDevice}.`, true);
      setBusy(false);
      return;
    }
    say(`Удалено записей: ${n}. Приложение перезапустится.`);
    setTimeout(() => window.location.reload(), 800);
  };

  return (
    <div className="space-y-5 text-slate-200">
      <div className={card}>
        <h3 className="font-semibold flex items-center gap-2"><Link2 className="w-4 h-4" aria-hidden="true" />Личный кабинет</h3>
        {meta ? (
          <>
            <p className="text-sm">{device} привязан {new Date(meta.linkedAt).toLocaleString('ru-RU')}. Последняя отправка: {meta.lastOk ? new Date(meta.lastOk).toLocaleString('ru-RU') : '—'}{meta.lastError ? ` (ошибка: ${safeErrorText(meta.lastError, 'нет связи')})` : ''}.</p>
            <p className="text-xs text-slate-400">В кабинет уходят только версия, флаги защиты и названия моделей. Клиенты, деньги, голос и переписка остаются {onDevice}.</p>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} aria-busy={busy} onClick={onSync} className={`${btn} bg-indigo-600 text-white disabled:opacity-50`}><RefreshCw className="w-4 h-4" aria-hidden="true" />Обновить</button>
              <button disabled={busy} onClick={onUnlink} className={`${btn} bg-white/5 border border-white/10 disabled:opacity-50`}><Unlink className="w-4 h-4" aria-hidden="true" />Отвязать</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400">На сайте откройте «Мои устройства» → «Получить код» и введите его здесь. Код действует 10 минут.</p>
            <input className={input} placeholder="XXXX-XXXX-XXXX" maxLength={14} value={code} onChange={e => setCode(e.target.value)} aria-label="Код из личного кабинета" />
            <input className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10" maxLength={80} value={name} onChange={e => setName(e.target.value)} aria-label={android ? 'Название телефона' : 'Название компьютера'} />
            <button disabled={busy || !code.trim()} aria-busy={busy} onClick={onLink} className={`${btn} bg-indigo-600 text-white disabled:opacity-50`}><Link2 className="w-4 h-4" aria-hidden="true" />Привязать</button>
          </>
        )}
        {msg && <p role={msg.error ? 'alert' : 'status'} className={`text-sm break-words ${msg.error ? 'text-amber-300' : 'text-indigo-200'}`}>{msg.text}</p>}
      </div>

      <div className={card}>
        <h3 className="font-semibold">Защита {android ? 'этого телефона' : 'этого компьютера'}</h3>
        <ul className="space-y-1 text-sm">
          {CHECKS.map(([k, label]) => {
            const on = hb ? !!hb.status[k] : false;
            return (
              <li key={k} className="flex items-center gap-2">
                {on ? <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" /> : <ShieldAlert className="w-4 h-4 text-yellow-400" aria-hidden="true" />}
                <span>{label}: <span className={on ? 'text-emerald-300' : 'text-yellow-300'}>{on ? 'включено' : 'не включено'}</span></span>
              </li>
            );
          })}
        </ul>
        {hb && <p className="text-xs text-slate-400">Локальные модели: {hb.models.length ? hb.models.map(m => m.id).join(', ') : (android ? 'не найдены (укажите адрес Ollama на компьютере в «Модели ИИ» → «Локальные модели»)' : 'не найдены (установите Ollama и модель qwen3:4b)')}</p>}
      </div>

      <div className={`${card} border-red-500/30`}>
        <h3 className="font-semibold text-red-300">Удалить все данные</h3>
        <p className="text-sm text-slate-400">Стирает {android ? 'с этого телефона' : 'с этого компьютера'} всё: CRM, бизнес, записи, память, голос владельца, ключи ИИ и привязки. Ключ шифрования уничтожается.</p>
        <button disabled={busy} onClick={onWipe} className={`${btn} bg-red-600 text-white disabled:opacity-50`}><Trash2 className="w-4 h-4" aria-hidden="true" />Удалить всё</button>
      </div>
    </div>
  );
}
