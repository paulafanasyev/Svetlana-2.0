"use strict";
// Светлана: веб/PWA-клиент. Без зависимостей. Голос: распознавание браузера (или сервера), озвучка сервера (или браузера).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: "same-origin", ...opts, headers: { ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) } });
  if (r.status === 401) { showLogin(); throw new Error("нужен вход"); }
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : r.status === 204 ? null : await r.blob();
  if (!r.ok) throw new Error((data && data.error) || `ошибка ${r.status}`);
  return data;
};
const S = { conv: localStorage.getItem("sv_conv") || null, images: [], talk: false, speaking: false };
// Приложение Светланы для Android: голос телефона (распознавание и озвучка работают и без интернета) через мост WebView
const AND = window.SvetlanaAndroid || null;
// code_* → «режим разработки»: правки и обычные команды в папке проектов без кликов на время (опасные команды всё равно спросит)
const GRANTABLE = { device_act: "device", code_write: "dev", code_edit: "dev", code_append: "dev", code_run: "dev", code_serve: "dev", image_generate: "media", video_generate: "media", acc_income_add: "accounting", acc_income_cancel: "accounting", aiko_call: "aiko", selfemployed_call: "selfemployed" };

function showLogin() { $("#app").hidden = true; $("#login").hidden = false; $("#pwd").focus(); }
function showApp() { $("#login").hidden = true; $("#app").hidden = false; }
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("#loginErr").textContent = "";
  try { await api("/api/login", { method: "POST", body: JSON.stringify({ token: $("#pwd").value }) }); $("#pwd").value = ""; showApp(); boot(); }
  catch (err) { $("#loginErr").textContent = err.message; }
});

// ---------- вкладки ----------
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x.id === "tab-" + b.dataset.tab));
  ({ crm: loadCrm, money: loadMoney, devices: loadDevices, providers: loadProviders }[b.dataset.tab] || (() => {}))();
});

// ---------- чат ----------
function bubble(role, html) { const d = document.createElement("div"); d.className = "msg " + role; d.innerHTML = html; $("#log").appendChild(d); d.scrollIntoView({ block: "end", behavior: "smooth" }); return d; }
// адрес запущенного проекта (code_serve) — сразу ссылка «открыть»; только этот компьютер
const linkify = (h) => h.replace(/\bhttp:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}(?:\/[\w\-./?=&;%#]*)?/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
const fmt = (t) => linkify(esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>"));
function setStatus(t, mood) {
  $("#status").textContent = t; const st = $("#stageStatus"); if (st) st.textContent = t;
  const a = $("#ava"); if (a) a.dataset.mood = mood || "";
  window.SvAvatar?.setState({ think: "thinking", listen: "listening", speak: "speaking" }[mood] || "idle");
}

function render(res) {
  let html = `<div class="txt">${fmt(res.answer)}</div>`;
  if (res.steps?.length) html += `<details class="steps"><summary>Действия: ${res.steps.length}</summary>${res.steps.map((s) => `<div class="${s.ok ? "ok" : "bad"}">${s.ok ? "✔" : "✘"} <code>${esc(s.tool)}</code> — ${linkify(esc(s.summary || ""))}</div>`).join("")}</details>`;
  if (res.artifacts?.length) html += `<div class="files">${res.artifacts.map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">📄 ${esc(a.name)}</a>`).join("")}</div>`;
  const d = bubble("bot", html);
  if (res.pending?.length) {
    const box = document.createElement("div"); box.className = "confirm";
    box.innerHTML = `<b>Нужно подтверждение:</b>${res.pending.map((p) => `<div>• ${esc(p.title)} <span class="risk ${esc(p.risk)}">${esc({ write: "изменение", external: "внешнее/платное", dangerous: "опасное" }[p.risk] || p.risk)}</span></div>`).join("")}
      <div class="row"><button class="btn primary" data-a="yes">Подтвердить</button><button class="btn" data-a="no">Отклонить</button>${grantDomain(res.pending) ? `<button class="btn" data-a="grant"${grantDomain(res.pending) === "dev" ? ' title="30 минут Светлана сама пишет файлы и запускает обычные команды в папке проектов. Публикация, git push, пакеты из интернета, код из строки и всё после чтения сайтов — всё равно спросит."' : ""}>${grantDomain(res.pending) === "dev" ? "Режим разработки на 30 минут" : "Разрешить на 15 минут"}</button>` : ""}</div>`;
    box.addEventListener("click", async (e) => {
      const a = e.target.dataset?.a; if (!a) return; box.querySelectorAll("button").forEach((b) => (b.disabled = true));
      const decisions = res.pending.map((p) => ({ callId: p.callId, token: p.token, approve: a !== "no" }));
      await turn(() => api("/api/confirm", { method: "POST", body: JSON.stringify({ conversationId: res.conversationId, decisions, grant: a === "grant" ? { domain: grantDomain(res.pending), minutes: grantDomain(res.pending) === "dev" ? 30 : 15 } : undefined }) }), a === "no" ? "Отклонено" : "Подтверждаю");
    });
    d.appendChild(box);
  }
  speak(res.answer);
}
function grantDomain(pending) { const ds = [...new Set(pending.map((p) => GRANTABLE[p.tool]).filter(Boolean))]; return ds.length === 1 && pending.every((p) => GRANTABLE[p.tool]) ? ds[0] : null; }

async function turn(fn, userText) {
  if (userText) bubble("me", fmt(userText));
  setStatus("думаю…", "think"); $("#send").disabled = true;
  try { const res = await fn(); S.conv = res.conversationId; localStorage.setItem("sv_conv", S.conv); render(res); if (!S.speaking) setStatus("готова"); } // озвучка сама вернёт «готова», когда договорит
  catch (e) {
    if (/не настроен ни один провайдер|нет провайдера/.test(e.message)) noBrain(); // первый запуск: Светлане нечем думать — подсказываем, что сделать
    else bubble("bot err", "Не получилось: " + esc(e.message));
    setStatus("ошибка", "sad");
  }
  finally { $("#send").disabled = false; }
}
function noBrain() { // нечем думать → тот же мастер, что при первом запуске: оценит телефон и предложит модель или облако
  const d = bubble("bot", `<div class="txt">Мне пока нечем думать 🙂 ${AND ? "Могу оценить телефон и подобрать <b>модель без интернета</b> — или подключите <b>облачный ИИ своим ключом</b>." : "Подключите <b>облачный ИИ своим ключом</b> (GigaChat, YandexGPT, DeepSeek…)."}</div><div class="row" style="margin-top:.5rem">${AND ? `<button class="btn primary" data-go="brain">Подобрать под телефон</button>` : ""}<button class="btn${AND ? "" : " primary"}" data-go="cloud">Облако с ключом</button></div>`);
  d.addEventListener("click", (e) => { const g = e.target.dataset?.go; if (g) window.svSetup?.open(g); });
}
async function sendText(text) {
  text = text.trim(); if (!text && !S.images.length) return;
  const images = S.images.splice(0); $("#attach").innerHTML = "";
  await turn(() => api("/api/chat", { method: "POST", body: JSON.stringify({ conversationId: S.conv, text: text || "Что на изображении?", images }) }), (text || "🖼") + (images.length ? ` · изображений: ${images.length}` : ""));
}
$("#composer").addEventListener("submit", (e) => { e.preventDefault(); const t = $("#text").value; $("#text").value = ""; sendText(t); });
$("#text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); } });

// ---------- изображения: файл и снимок экрана ----------
async function toDataUrl(blob, maxSide = 1600) {
  const bmp = await createImageBitmap(blob); const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.85);
}
function addImage(url) { if (S.images.length >= 4) return; S.images.push(url); const i = document.createElement("img"); i.src = url; i.alt = "вложение"; $("#attach").appendChild(i); }
$("#file").addEventListener("change", async (e) => { for (const f of e.target.files) addImage(await toDataUrl(f)); e.target.value = ""; });
async function grabScreen(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track || track.readyState !== "live") throw new Error("показ экрана остановлен");
  const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.srcObject = stream;
  try {
    await new Promise((res, rej) => { if (v.readyState >= 2) return res(); v.onloadeddata = res; v.onerror = () => rej(new Error("видео не загрузилось")); setTimeout(() => rej(new Error("таймаут кадра")), 5000); });
    await v.play().catch(() => {});
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!v.videoWidth || !v.videoHeight) throw new Error("пустой кадр");
    const c = document.createElement("canvas"); const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k); c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return { url: c.toDataURL("image/jpeg", 0.8), width: c.width, height: c.height };
  } finally { v.pause(); v.srcObject = null; }
}
const canShare = () => !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function" && window.isSecureContext);
const NO_SHARE = "Этот браузер не умеет делиться экраном (нужен HTTPS и десктопный Chrome/Edge/Firefox). На телефоне используйте приложение «Светлана Руки».";
$("#shot").addEventListener("click", async () => {
  if (!canShare()) return bubble("bot err", NO_SHARE);
  let s = null;
  try { s = await navigator.mediaDevices.getDisplayMedia({ video: true }); addImage((await grabScreen(s)).url); $("#text").focus(); }
  catch (e) { if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") bubble("bot err", "Снимок не получился: " + esc(e?.message || e)); }
  finally { s?.getTracks().forEach((t) => t.stop()); }
});

// ---------- голос: одна машина состояний ----------
// idle → listening (SR | recorder) → idle; talk-режим перезапускает только после нетерминальных исходов.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const V = { mode: "idle", rec: null, recorder: null, stream: null, fails: 0, timer: null };
const TERMINAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);
function micUi(on, text) { $("#mic").classList.toggle("on", on); setStatus(text || (on ? "слушаю…" : "готова"), on ? "listen" : ""); }
function stopTalk(reason) { S.talk = false; $("#talk").classList.remove("on"); clearTimeout(V.timer); if (reason) bubble("bot err", esc(reason)); }
function scheduleListen(ms) { clearTimeout(V.timer); if (S.talk && !S.speaking) V.timer = setTimeout(() => { if (S.talk && !S.speaking && V.mode === "idle") listen(); }, ms); }
function stopListening() {
  clearTimeout(V.timer);
  if (V.rec) { try { V.rec.abort(); } catch {} }
  if (V.recorder && V.recorder.state !== "inactive") { try { V.recorder.stop(); } catch {} }
}
function listenAndroid() { // распознавание речи телефона: partial/final/error/end приходят из Kotlin
  let terminal = null; V.mode = "sr"; micUi(true);
  V.rec = { stop: () => AND.stopListening(), abort: () => AND.stopListening() };
  window.__svVoice = (kind, text) => {
    if (kind === "partial" || kind === "final") { $("#text").value = text || ""; return; }
    if (kind === "error") { if (text === "permission") terminal = "not-allowed"; return; }
    if (kind !== "end") return;
    window.__svVoice = null; V.rec = null; V.mode = "idle"; micUi(false);
    if (terminal) return stopTalk("Нет доступа к микрофону: разрешите его Светлане в настройках телефона.");
    const t = $("#text").value;
    if (t.trim()) { V.fails = 0; $("#text").value = ""; sendText(t); return; }
    V.fails++; if (V.fails >= 5) return stopTalk("Ничего не слышу, режим разговора выключен.");
    scheduleListen(400 * V.fails);
  };
  try { AND.listen(); } catch (e) { window.__svVoice = null; V.rec = null; V.mode = "idle"; micUi(false); stopTalk("Микрофон не запустился: " + (e?.message || e)); }
}
function listen() {
  if (S.speaking || V.mode !== "idle") return;
  if (AND) return listenAndroid();
  if (!SR) return recordFallback();
  let r; try { r = new SR(); } catch { return recordFallback(); }
  r.lang = "ru-RU"; r.interimResults = true; r.continuous = false;
  let final = "", terminal = null; V.rec = r; V.mode = "sr"; micUi(true);
  r.onresult = (e) => { let t = ""; for (const x of e.results) { if (x.isFinal) final += x[0].transcript; else t += x[0].transcript; } $("#text").value = final + t; };
  r.onerror = (e) => { if (TERMINAL.has(e.error)) terminal = e.error; };
  r.onend = () => {
    V.rec = null; V.mode = "idle"; micUi(false);
    if (terminal) { stopTalk(terminal === "not-allowed" || terminal === "service-not-allowed" ? "Нет доступа к микрофону: разрешите его в настройках сайта." : "Распознавание речи недоступно: " + terminal); return; }
    const t = $("#text").value;
    if (t.trim()) { V.fails = 0; $("#text").value = ""; sendText(t); return; }
    V.fails++; if (V.fails >= 5) return stopTalk("Ничего не слышу, режим разговора выключен.");
    scheduleListen(400 * V.fails);
  };
  try { r.start(); } catch (e) { V.rec = null; V.mode = "idle"; micUi(false); stopTalk("Микрофон не запустился: " + (e?.message || e)); }
}
async function recordFallback() { // браузер без распознавания (Firefox и др.) → запись → сервер (Whisper/SpeechKit)
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return stopTalk("Этот браузер не умеет записывать голос.");
  V.mode = "rec"; const gen = (V.gen = (V.gen || 0) + 1); V.cancel = () => { V.gen++; V.mode = "idle"; micUi(false); };
  let st; try { st = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { if (gen === V.gen) { V.mode = "idle"; stopTalk("Нет доступа к микрофону"); } return; }
  if (gen !== V.gen) { st.getTracks().forEach((t) => t.stop()); return; } // пока ждали разрешения, запись отменили
  let mr; try { mr = new MediaRecorder(st); } catch (e) { st.getTracks().forEach((t) => t.stop()); V.mode = "idle"; return stopTalk("Запись не поддерживается: " + (e?.message || e)); }
  const chunks = []; let cancelled = false; V.recorder = mr; V.stream = st;
  mr.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
  mr.onstop = async () => {
    st.getTracks().forEach((t) => t.stop()); V.recorder = null; V.stream = null; V.mode = "idle"; micUi(false); clearTimeout(V.cap);
    if (cancelled || !chunks.length) return;
    try { setStatus("распознаю…"); const { text } = await api("/api/stt", { method: "POST", body: new Blob(chunks, { type: mr.mimeType }), headers: { "Content-Type": mr.mimeType || "audio/webm" } });
      if (text && text.trim()) sendText(text); else { setStatus("готова"); scheduleListen(800); } }
    catch (e) { bubble("bot err", esc(e.message)); setStatus("готова"); stopTalk(); }
  };
  V.cancel = () => { cancelled = true; V.gen++; };
  try { mr.start(); } catch (e) { st.getTracks().forEach((t) => t.stop()); V.recorder = null; V.mode = "idle"; return stopTalk("Запись не запустилась"); }
  micUi(true, "слушаю… (нажмите 🎤 ещё раз, чтобы отправить)");
  V.cap = setTimeout(() => { if (mr.state !== "inactive") mr.stop(); }, 60000);
}
$("#mic").addEventListener("click", () => {
  if (V.mode === "rec" && V.recorder) return V.recorder.stop();       // отправить запись
  if (V.mode === "sr") return V.rec?.stop();                          // закончить фразу
  listen();
});
$("#talk").addEventListener("click", () => {
  S.talk = !S.talk; $("#talk").classList.toggle("on", S.talk); V.fails = 0;
  if (S.talk) listen();
  else { V.cancel?.(); stopListening(); stopSpeaking(); setStatus("готова"); }
});

let audio = null, audioUrl = null, speakGen = 0, speakAbort = null;
function stopSpeaking() {
  speakGen++; speakAbort?.abort(); speakAbort = null;
  if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null; }
  if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (AND) { window.__svSpoke = null; try { AND.stopSpeaking(); } catch {} }
  window.SvAvatar?.hush?.(); S.speaking = false;
}
async function speak(text) {
  const clean = String(text || "").replace(/[*`#>|]/g, "").replace(/\(Проверка:[^)]*\)/, "").slice(0, 3000);
  if (!clean.trim() || !(S.talk || localStorage.getItem("sv_voice") === "1")) return;
  stopSpeaking(); const gen = speakGen; const ac = (speakAbort = new AbortController());
  S.speaking = true; setStatus("говорю…", "speak"); window.SvAvatar?.say(clean);
  let finished = false;
  const done = () => { if (finished || gen !== speakGen) return; finished = true; S.speaking = false; if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; } setStatus("готова"); scheduleListen(300); };
  try {
    const blob = await api("/api/tts", { method: "POST", body: JSON.stringify({ text: clean }), signal: ac.signal });
    if (gen !== speakGen) return; // пока ждали, пришёл новый ответ или озвучку выключили
    if (blob instanceof Blob) { audioUrl = URL.createObjectURL(blob); audio = new Audio(audioUrl); window.SvAvatar?.voice?.(audio); audio.onended = done; audio.onerror = done; try { await audio.play(); } catch { done(); } return; }
  } catch { if (gen !== speakGen) return; /* озвучим браузером */ }
  if (AND) { // голос телефона; id фразы отсекает запоздавшие события прошлой
    let id = ""; window.__svSpoke = (t) => { if (t && id && t !== id) return; window.__svSpoke = null; done(); };
    try { id = String(AND.speak(clean) || ""); window.SvAvatar?.tag?.(id); } catch { done(); } return;
  }
  if (!("speechSynthesis" in window)) return done();
  const u = new SpeechSynthesisUtterance(clean); u.lang = "ru-RU";
  const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith("ru") && /female|жен|irina|alena|milena|svetlana/i.test(x.name)) || speechSynthesis.getVoices().find((x) => x.lang.startsWith("ru"));
  if (v) u.voice = v; u.onend = done; u.onerror = done;
  u.onstart = () => window.SvAvatar?.started?.(); u.onboundary = (e) => window.SvAvatar?.word?.(e.charIndex || 0); // губы аватара — в темп голоса
  speechSynthesis.speak(u);
}
// нажатие на лицо Светланы — включить/выключить озвучку (canvas живого аватара заменяет картинку, поэтому слушаем документ)
document.addEventListener("click", (e) => { if (!e.target.closest?.("#ava")) return; const on = localStorage.getItem("sv_voice") !== "1"; localStorage.setItem("sv_voice", on ? "1" : "0"); if (!on) stopSpeaking(); setStatus(on ? "озвучка включена" : "озвучка выключена"); });
$("#stage")?.addEventListener("click", () => { $("#stage").classList.add("off"); localStorage.setItem("sv_stage", "0"); });
if (localStorage.getItem("sv_stage") === "0") $("#stage")?.classList.add("off");
$(".me b")?.addEventListener("click", () => { const off = $("#stage").classList.toggle("off"); localStorage.setItem("sv_stage", off ? "0" : "1"); }); // имя в шапке — показать/свернуть большое лицо
if (AND) { $("#shot").hidden = true; if (localStorage.getItem("sv_voice") === null) localStorage.setItem("sv_voice", "1"); } // на телефоне экран видит «Руки», а отвечает она голосом
window.SvAvatar?.mount($("#ava"), 44); window.SvAvatar?.mount($("#stageAva"), 128);

// ---------- CRM / финансы ----------
const table = (rows, cols) => rows.length ? `<table><tr>${cols.map(([, h]) => `<th>${esc(h)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${cols.map(([k]) => `<td>${esc(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</table>` : `<p class="hint">Пока пусто</p>`;
async function loadCrm() {
  const [deals, contacts, tasks] = await Promise.all(["deals", "contacts", "tasks"].map((n) => api("/api/data/" + n)));
  $("#deals").innerHTML = table(deals.slice(-50).reverse(), [["title", "Сделка"], ["stage", "Этап"], ["amount", "₽"]]);
  $("#contacts").innerHTML = table(contacts.slice(-50).reverse(), [["name", "Имя"], ["phone", "Телефон"], ["company", "Компания"]]);
  $("#tasks").innerHTML = table(tasks.filter((t) => !t.done).slice(-50), [["title", "Задача"], ["due", "Срок"]]);
}
async function loadMoney() {
  const inc = (await api("/api/data/incomes")).filter((r) => !r.cancelled); const y = String(new Date().getFullYear());
  const ytd = inc.filter((r) => r.date.startsWith(y)).reduce((s, r) => s + r.amount, 0);
  const tax = inc.filter((r) => r.date.startsWith(y)).reduce((s, r) => s + r.amount * (r.payer === "individual" ? 0.04 : 0.06), 0);
  $("#money").innerHTML = `<div class="kpis"><div><small>Доход ${y}</small><b>${ytd.toLocaleString("ru-RU")} ₽</b></div><div><small>НПД до вычета</small><b>${(Math.round(tax * 100) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</b></div><div><small>До лимита 2,4 млн</small><b>${Math.max(0, 2400000 - ytd).toLocaleString("ru-RU")} ₽</b></div><div><small>Без чека</small><b>${inc.filter((r) => !r.receiptNumber).length}</b></div></div>` +
    table(inc.slice(-100).reverse(), [["date", "Дата"], ["amount", "₽"], ["payerName", "Плательщик"], ["service", "Услуга"], ["receiptNumber", "Чек"]]);
}

// ---------- устройства ----------
async function loadDevices() {
  const list = await api("/api/devices");
  $("#devList").innerHTML = list.length ? list.map((d) => `<div class="dev"><b>${esc(d.name)}</b> · ${esc(d.platform)} · ${d.online ? "🟢 в сети" : "⚪ не в сети"} ${d.capabilities.length ? "· доступ: " + esc(d.capabilities.join(", ")) : ""} <button class="btn small" data-del="${esc(d.id)}">Отключить</button></div>`).join("") : `<p class="hint">Устройств нет</p>`;
}
$("#devList").addEventListener("click", async (e) => { const id = e.target.dataset?.del; if (id && confirm("Отозвать доступ устройства?")) { await api("/api/devices/" + id, { method: "DELETE" }); loadDevices(); } });
$("#pairForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const r = await api("/api/devices/pair", { method: "POST", body: JSON.stringify({ name: $("#pairName").value, platform: $("#pairPlatform").value }) });
  const ws = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/device`;
  $("#pairOut").hidden = false; $("#pairOut").textContent = `Адрес: ${ws}\nКлюч устройства (показывается один раз):\n${r.token}\n\nAndroid: вставьте адрес и ключ в «Светлана Руки».\nПК: python agent.py --url ${ws} --token ${r.token}`;
  loadDevices();
});
// Вкладка браузера как «глаза»: делится экраном, Светлана сама берёт снимок, когда нужно.
let shareWs = null, shareStream = null;
function stopShare() { const w = shareWs; shareWs = null; try { w?.close(); } catch {} shareStream?.getTracks().forEach((t) => t.stop()); shareStream = null; $("#shareState").textContent = "выключено"; $("#shareScreen").textContent = "Дать Светлане видеть экран"; }
$("#shareScreen").addEventListener("click", async () => {
  if (shareWs || shareStream) return stopShare();
  if (!canShare()) return bubble("bot err", NO_SHARE);
  try { shareStream = await navigator.mediaDevices.getDisplayMedia({ video: true }); }
  catch (e) { shareStream = null; if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") bubble("bot err", "Показ экрана не запустился: " + esc(e?.message || e)); return; }
  shareStream.getVideoTracks()[0].onended = stopShare;
  try {
    let tok = sessionStorage.getItem("sv_browser_dev");
    if (!tok) { tok = (await api("/api/devices/pair", { method: "POST", body: JSON.stringify({ name: "Экран браузера " + navigator.platform, platform: "browser" }) })).token; sessionStorage.setItem("sv_browser_dev", tok); }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/device`, [tok]); shareWs = ws; let opened = false;
    ws.onopen = () => { if (shareWs !== ws || !shareStream) return ws.close(); opened = true; ws.send(JSON.stringify({ type: "hello", platform: "browser", name: "Экран браузера", capabilities: ["screen"] })); $("#shareState").textContent = "🟢 Светлана может смотреть экран"; $("#shareScreen").textContent = "Перестать показывать"; };
    ws.onmessage = async (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id == null) return;
      const reply = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify({ id: m.id, ...o })); };
      if (m.method !== "screen.capture") return reply({ error: "только просмотр" });
      try { const g = await grabScreen(shareStream); reply({ result: { image: g.url.split(",")[1], mime: "image/jpeg", width: g.width, height: g.height } }); }
      catch (e) { reply({ error: String(e?.message || e) }); }
    };
    ws.onclose = (ev) => { if (shareWs !== ws) return; if (!opened || ev.code === 1008) sessionStorage.removeItem("sv_browser_dev"); stopShare(); };
    ws.onerror = () => {};
  } catch (e) { bubble("bot err", "Не удалось подключить экран: " + esc(e?.message || e)); stopShare(); }
});

// ---------- провайдеры ----------
const CAP_RU = { chat: "чат", tools: "инструменты", vision: "зрение", image: "картинки", video: "видео", tts: "озвучка", stt: "распознавание речи" };
$("#pvCaps").innerHTML += Object.entries(CAP_RU).map(([k, v]) => `<label><input type="checkbox" value="${k}" ${["chat", "tools"].includes(k) ? "checked" : ""}> ${v}</label>`).join("");
let cloudMounted = false;
$("#provBrain")?.addEventListener("click", () => window.svSetup?.open("brain"));
async function loadProviders() {
  if (!cloudMounted && window.svSetup) { cloudMounted = true; window.svSetup.cloudForm($("#provCloud"), (p, answer) => { $("#provOk").textContent = `✔ ${p.name} подключён${answer ? ": «" + answer + "»" : ""}`; loadProviders(); }); }
  const list = await api("/api/providers");
  $("#provList").innerHTML = list.length ? list.map((p) => `<div class="dev"><b>${esc(p.id)}</b> · ${esc(p.type)} · ${esc(p.model)} · ${esc(p.capabilities.map((c) => CAP_RU[c] || c).join(", "))} ${p.hasKey ? "🔑" : ""} <button class="btn small" data-test="${esc(p.id)}">Проверить</button> <button class="btn small" data-rm="${esc(p.id)}">Удалить</button> <span data-res="${esc(p.id)}"></span></div>`).join("") : `<p class="hint">Пока ничего не подключено — выберите сервис ниже.</p>`;
}
$("#provList").addEventListener("click", async (e) => {
  const t = e.target.dataset?.test, rm = e.target.dataset?.rm;
  if (t) { const out = document.querySelector(`[data-res="${CSS.escape(t)}"]`); out.textContent = "…"; const r = await api("/api/providers/test", { method: "POST", body: JSON.stringify({ id: t }) }); out.textContent = r.ok ? "✔ " + r.answer : "✘ " + (r.error || "ответил другой провайдер"); }
  if (rm && confirm("Удалить провайдера?")) { await api("/api/providers?id=" + encodeURIComponent(rm), { method: "DELETE" }); loadProviders(); }
});
$("#provForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const preset = $("#pvPreset").value;
  const body = { id: $("#pvId").value, preset, type: preset === "anthropic" ? "anthropic" : preset === "gigachat" ? "gigachat" : "openai", model: $("#pvModel").value,
    capabilities: [...document.querySelectorAll("#pvCaps input:checked")].map((x) => x.value) };
  if ($("#pvUrl").value) body.baseUrl = $("#pvUrl").value; if ($("#pvKey").value) body.apiKey = $("#pvKey").value;
  if (preset === "vllm") body.extraBody = { chat_template_kwargs: { enable_thinking: false } };
  await api("/api/providers", { method: "POST", body: JSON.stringify(body) }); $("#pvKey").value = ""; loadProviders();
});

// ---------- старт ----------
async function boot() {
  try { await api("/api/tools"); showApp(); } catch { return; }
  if (S.conv) { try { const c = await api("/api/conversations/" + S.conv); c.messages.slice(-30).forEach((m) => bubble(m.role === "user" ? "me" : "bot", fmt(m.content))); } catch { S.conv = null; } }
  window.svSetup?.auto(); // первый запуск: аватар, оценка телефона, модель или облако
  if (!$("#log").children.length) bubble("bot", "Привет, Павел! Я Светлана. Могу писать код, вести CRM и учёт НПД, делать документы и презентации, работать с АИКО и «Миром самозанятых», смотреть экран и управлять устройствами. Нажмите 🗣 — и поговорим голосом.");
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
boot();
