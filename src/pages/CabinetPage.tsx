// Личный кабинет: привязка устройства (компьютера или телефона) к сайту «Мир Самозанятых», состояние защиты
// и кнопка полного удаления данных с этого устройства. Одинаковая на сайте, в Windows и в Android.
import { useEffect, useState, type MouseEvent } from 'react';
import { Link2, Unlink, ShieldCheck, ShieldAlert, Trash2, RefreshCw } from 'lucide-react';
import { linkDevice, unlinkLocal, loadMeta, sendHeartbeat, collectHeartbeat, normalizeLinkCode, type CabinetMeta, type Heartbeat } from '../services/cabinet/CabinetClient';
import { wipeAllLocalData } from '../services/security/WipeAll';
import { userGesture } from '../services/security/ActionGate';
import { isAndroidApp } from '../platform';

const card = 'rounded-xl border border-white/10 bg-white/5 p-5 space-y-3';
const input = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-slate-100 font-mono tracking-widest uppercase';
const btn = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold';

const CHECKS: [keyof Heartbeat['status'], string][] = [
  ['secrets_encrypted', 'Ключи зашифрованы'],
  ['bridge_v2', 'Защищённый мост ПК ↔ телефон'],
  ['voice_enrolled', 'Голос владельца записан'],
  ['confirm_gate', 'Подтверждение опасных действий'],
  ['paired_with', 'Телефон подключён'],
];
// На телефоне нет моста ПК ↔ телефон и голосового отпечатка (голосовые действия там всегда подтверждаются нажатием).
const PHONE_SKIP = new Set<string>(['bridge_v2', 'paired_with', 'voice_enrolled']);

export default function CabinetPage() {
  const android = isAndroidApp();
  const device = android ? 'Телефон' : 'Компьютер';
  const onDevice = android ? 'на этом телефоне' : 'на этом компьютере';
  const checks = android ? CHECKS.filter(([k]) => !PHONE_SKIP.has(k)) : CHECKS;
  const [meta, setMeta] = useState<CabinetMeta | null>(loadMeta());
  const [hb, setHb] = useState<Heartbeat | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState(android ? 'Мой телефон' : 'Мой компьютер');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = async () => { setHb(await collectHeartbeat()); setMeta(loadMeta()); };
  useEffect(() => { void refresh(); }, []);

  const onLink = async () => {
    setMsg(''); setBusy(true);
    try {
      normalizeLinkCode(code);
      await linkDevice({ code, name });
      setCode('');
      await sendHeartbeat();
      setMsg(`${device} привязан к личному кабинету.`);
    } catch (e: any) { setMsg(e?.message ?? 'Не удалось привязать'); }
    finally { setBusy(false); await refresh(); }
  };

  const onSync = async () => {
    setBusy(true);
    const r = await sendHeartbeat();
    setMsg(r === 'ok' ? 'Состояние отправлено в кабинет.' : r === 'unlinked' ? 'Устройство отключено в кабинете.' : r === 'not_linked' ? `${device} ещё не привязан.` : 'Нет связи с сайтом, попробую позже.');
    setBusy(false); await refresh();
  };

  const onUnlink = async () => { await unlinkLocal(); setMsg(`Привязка удалена ${onDevice}. Отключите устройство и в кабинете.`); await refresh(); };

  const onWipe = async (e: MouseEvent) => {
    // Только настоящее нажатие человеком: голос, нейросеть или скрипт удалить данные не могут.
    if (!userGesture(e.nativeEvent) || !window.confirm(`Удалить ВСЕ данные Светланы ${onDevice}: клиентов, финансы, записи, память, голос, ключи и привязки? Отменить нельзя.`)) return;
    const n = await wipeAllLocalData();
    setMsg(`Удалено записей: ${n}. Приложение перезапустится.`);
    setTimeout(() => window.location.reload(), 800);
  };

  return (
    <div className="space-y-5 text-slate-200">
      <div className={card}>
        <h3 className="font-semibold flex items-center gap-2"><Link2 className="w-4 h-4" />Личный кабинет</h3>
        {meta ? (
          <>
            <p className="text-sm">{device} привязан {new Date(meta.linkedAt).toLocaleString('ru-RU')}. Последняя отправка: {meta.lastOk ? new Date(meta.lastOk).toLocaleString('ru-RU') : '—'}{meta.lastError ? ` (ошибка: ${meta.lastError})` : ''}.</p>
            <p className="text-xs text-slate-400">В кабинет уходят только версия, флаги защиты и названия моделей. Клиенты, деньги, голос и переписка остаются {onDevice}.</p>
            <div className="flex gap-2">
              <button disabled={busy} onClick={onSync} className={`${btn} bg-indigo-600 text-white`}><RefreshCw className="w-4 h-4" />Обновить</button>
              <button onClick={onUnlink} className={`${btn} bg-white/5 border border-white/10`}><Unlink className="w-4 h-4" />Отвязать</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400">На сайте откройте «Мои устройства» → «Получить код» и введите его здесь. Код действует 10 минут.</p>
            <input className={input} placeholder="XXXX-XXXX-XXXX" maxLength={14} value={code} onChange={e => setCode(e.target.value)} aria-label="Код из личного кабинета" />
            <input className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10" maxLength={80} value={name} onChange={e => setName(e.target.value)} aria-label={android ? 'Название телефона' : 'Название компьютера'} />
            <button disabled={busy || !code.trim()} onClick={onLink} className={`${btn} bg-indigo-600 text-white disabled:opacity-50`}><Link2 className="w-4 h-4" />Привязать</button>
          </>
        )}
        {msg && <p className="text-sm text-indigo-200">{msg}</p>}
      </div>

      <div className={card}>
        <h3 className="font-semibold">Защита {android ? 'этого телефона' : 'этого компьютера'}</h3>
        <ul className="space-y-1 text-sm">
          {checks.map(([k, label]) => {
            const on = hb ? !!hb.status[k] : false;
            return <li key={k} className="flex items-center gap-2">{on ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldAlert className="w-4 h-4 text-yellow-400" />}{label}</li>;
          })}
        </ul>
        {hb && !android && <p className="text-xs text-slate-400">Локальные модели: {hb.models.length ? hb.models.map(m => m.id).join(', ') : 'не найдены (установите Ollama и модель qwen3:4b)'}</p>}
      </div>

      <div className={`${card} border-red-500/30`}>
        <h3 className="font-semibold text-red-300">Удалить все данные</h3>
        <p className="text-sm text-slate-400">Стирает {android ? 'с этого телефона' : 'с этого компьютера'} всё: CRM, бизнес, записи, память, голос владельца, ключи ИИ и привязки. Ключ шифрования уничтожается.</p>
        <button onClick={onWipe} className={`${btn} bg-red-600 text-white`}><Trash2 className="w-4 h-4" />Удалить всё</button>
      </div>
    </div>
  );
}
