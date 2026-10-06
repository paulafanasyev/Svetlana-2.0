// Голос с устройства (Светлана для Windows/macOS/Linux): устройство само распознаёт речь офлайн и присылает только текст.
//   → {type:"say", reqId, text, reset?}      ← {type:"reply", reqId, answer, pending:[{title, risk, voice}]} | {type:"reply", reqId, error}
//   → {type:"confirm", reqId, approve}       ← то же
// У каждого устройства свой разговор (чужие разговоры ему недоступны). Голосом подтверждаются только обычные изменения
// и действия на ЭТОМ же устройстве; деньги, публикации, запуск кода и чужие устройства — только в приложении
// (голос легко подделать записью или услышать из колонок).

export const VOICE_RATE = 20; // фраз в минуту на устройство

export function voiceOk(p, deviceId) {
  if (p.risk === "write") return true;
  return p.tool === "device_act" && p.args?.deviceId === deviceId;
}

const view = (r, deviceId) => ({
  answer: String(r.answer || ""),
  pending: (r.pending || []).map((p) => ({ title: p.title, risk: p.risk, voice: voiceOk(p, deviceId) })),
});

/** Обработчик одной голосовой реплики: (conn, m) → ответ. */
export function voiceBridge({ agent, store }) {
  return async (conn, m) => {
    const id = conn.dev.id;
    const row = store.get("devices", id) || conn.dev;
    if (m.type === "say") {
      let conv = row.voiceConv || undefined;
      if (m.reset) { conv = undefined; conn.voicePending = null; store.update("devices", id, { voiceConv: null }); }
      const text = String(m.text || "").trim().slice(0, 2000);
      if (!text) return m.reset ? { answer: "Хорошо, начинаем заново.", pending: [] } : { error: "пустая фраза" };
      const name = String(conn.info?.name || row.name || "компьютер").replace(/[«»\[\]]/g, "").slice(0, 60);
      const r = await agent.chat({ conversationId: conv, text: `[Голосом с устройства «${name}», deviceId: ${id}. Отвечай коротко: ответ озвучат.] ${text}` });
      store.update("devices", id, { voiceConv: r.conversationId });
      conn.voicePending = r.pending?.length ? { conversationId: r.conversationId, pending: r.pending } : null;
      return view(r, id);
    }
    if (m.type === "confirm") {
      const vp = conn.voicePending; conn.voicePending = null;
      if (!vp) return { answer: "Нечего подтверждать.", pending: [] };
      const allowed = vp.pending.every((p) => voiceOk(p, id));
      const approve = m.approve === true && allowed;
      const r = await agent.confirm({ conversationId: vp.conversationId, decisions: vp.pending.map((p) => ({ callId: p.callId, token: p.token, approve })) });
      conn.voicePending = r.pending?.length ? { conversationId: r.conversationId, pending: r.pending } : null;
      const out = view(r, id);
      if (m.approve === true && !allowed) out.answer = "Это голосом не подтверждаю, только в приложении Светланы. " + out.answer;
      return out;
    }
    return { error: "неизвестный запрос" };
  };
}

/** Подключить голос к DeviceHub: слушаем те же WebSocket-сообщения рядом с основным обработчиком (он реплики игнорирует). */
export function installVoice(hub, deps, handler = voiceBridge(deps)) {
  const attach = hub.attach.bind(hub);
  hub.attach = (dev, ws) => {
    attach(dev, ws);
    const conn = hub.live.get(dev.id);
    if (!conn) return;
    ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || (m.type !== "say" && m.type !== "confirm")) return;
      const reqId = String(m.reqId || "").slice(0, 64);
      const reply = (o) => { try { ws.send(JSON.stringify({ type: "reply", reqId, ...o })); } catch {} };
      if (!conn.info.capabilities.includes("voice")) return reply({ error: "голосовое управление на этом устройстве не включено" });
      const now = Date.now(); conn.voiceHits = (conn.voiceHits || []).filter((t) => now - t < 60_000);
      if (conn.voiceHits.length >= VOICE_RATE) return reply({ error: "слишком много фраз подряд, подождите минуту" });
      conn.voiceHits.push(now);
      const run = () => handler(conn, m).then(reply, (e) => reply({ error: String(e?.message || e).slice(0, 300) }));
      conn.voiceChain = (conn.voiceChain || Promise.resolve()).then(run, run); // по одной реплике за раз
    });
  };
  return hub;
}
