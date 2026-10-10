"use strict";
// Мастер первого запуска: Светлана здоровается (живой аватар), оценивает телефон и предлагает только то, что ему подходит:
// совместимую модель без интернета (скачать → проверить → включить) или облачный ИИ своим ключом — тогда работают все функции.
// В браузере (без приложения Android) — сразу облако. Та же форма облака стоит во вкладке «ИИ».
(() => {
  const L = window.SvSetupLogic;
  const SET = window.SvetlanaSetup || null; // мост Android: report/download/cancel/enable/disable/remove/openModels
  const q = (s, r = document) => r.querySelector(s);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const call = async (path, opts = {}) => (typeof api === "function" ? api(path, opts) : (await fetch(path, opts)).json());
  const W = { run: 0, open: false, step: "", rep: null, mode: "first", timer: 0, spoken: new Set(), showAll: false, msg: "" };
  const box = q("#setup"), body = q("#suBody"), say = q("#suSay"), dots = q("#suDots");
  if (!box || !L) return;
  window.SvAvatar?.mount(q("#suAva"), 150);

  function report() { if (!SET) return null; try { const r = JSON.parse(SET.report()); return r.error ? null : r; } catch { return null; } }
  const ava = (state, feel) => { window.SvAvatar?.setState(state || "idle"); if (feel) window.SvAvatar?.feel?.(feel, 4000); };
  /** Реплика Светланы: в «облачке» над лицом и голосом (один раз на шаг, если озвучка включена). */
  function line(text, key, feel) {
    say.textContent = text; ava("idle", feel);
    if (key && !W.spoken.has(key) && typeof speak === "function") { W.spoken.add(key); speak(text); }
  }
  function progress(n) { const all = SET ? 4 : 3; dots.innerHTML = Array.from({ length: all }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join(""); }

  // ---------- шаги ----------
  function hello() {
    W.step = "hello"; progress(1);
    line(SET ? "Привет! Я Светлана. Сначала посмотрю, на что способен ваш телефон, — и подберу, чем мне думать." : "Привет! Я Светлана. Чтобы я могла думать, подключите облачный ИИ своим ключом — это пара минут.", "hello", "joy");
    body.innerHTML = `<div class="su-actions"><button class="btn primary" data-a="${SET ? "check" : "cloud"}">${SET ? "Оценить телефон" : "Подключить ИИ"}</button>
      <button class="btn" data-a="skip">Позже</button></div>`;
  }

  async function check() {
    const run = ++W.run; // повторное нажатие не должно смешать две проверки
    W.step = "check"; progress(2); W.rep = report();
    if (!W.rep) { cloud("Не получилось оценить телефон — подключим облако."); return; }
    const cs = L.checks(W.rep);
    ava("thinking"); say.textContent = "Смотрю на телефон…";
    body.innerHTML = `<div class="su-dev"><b>${h(W.rep.model || "Ваш телефон")}</b><small>${h(W.rep.tierName || "")}</small></div><ul class="su-checks">${cs.map((c) => `<li data-c="${c.id}"><span class="su-ic">…</span><span>${h(c.label)}</span><b>${h(c.value)}</b></li>`).join("")}</ul><div id="suVerdict"></div>`;
    for (const c of cs) { // по одной проверке — видно, что она действительно смотрит
      await new Promise((r) => setTimeout(r, W.mode === "first" ? 380 : 60));
      if (run !== W.run || W.step !== "check") return;
      const li = q(`[data-c="${c.id}"]`, body); if (!li) return;
      li.classList.add(c.ok ? "ok" : c.warn ? "warn" : "bad"); q(".su-ic", li).textContent = c.ok ? "✓" : c.warn ? "!" : "✕";
      if (!c.ok && c.why) li.insertAdjacentHTML("beforeend", `<small>${h(c.why)}</small>`);
    }
    const v = L.verdictText(W.rep);
    line(v.text, "verdict-" + W.rep.verdict, W.rep.verdict === "local" ? "proud" : "tender");
    q("#suVerdict", body).innerHTML = `<div class="su-verdict ${h(W.rep.verdict)}"><b>${h(v.title)}</b></div><div class="su-actions">${W.rep.verdict === "local"
      ? `<button class="btn primary" data-a="models">Выбрать модель</button><button class="btn" data-a="cloud">Лучше облако</button>`
      : `<button class="btn primary" data-a="cloud">Подключить облако</button>`}</div>`;
  }

  function models() {
    W.step = "models"; progress(3); W.rep = report() || W.rep;
    const rec = W.rep?.models.find((m) => m.rec);
    line(rec ? `Советую «${rec.title}». Скачивается один раз, лучше по Wi-Fi, — потом я работаю без интернета.` : "Вот что подойдёт этому телефону.", "models", "calm");
    body.innerHTML = `<div id="suModels" class="su-models"></div><div class="su-actions"><button class="btn" data-a="cloud">Облако вместо модели</button>${W.mode === "brain" ? `<button class="btn" data-a="native">Подробнее</button>` : ""}<button class="btn" data-a="skip">Закрыть</button></div>`;
    drawModels(); clearInterval(W.timer); W.timer = setInterval(() => { if (W.step !== "models") return clearInterval(W.timer); W.rep = report() || W.rep; drawModels(); }, 1500);
  }

  function drawModels() {
    const el = q("#suModels", body); if (!el || !W.rep) return;
    const r = W.rep, fit = r.models.filter((m) => m.fits), unfit = r.models.filter((m) => !m.fits);
    fit.sort((a, b) => (b.rec - a.rec) || (a.gb - b.gb));
    const busy = r.models.some((m) => m.state?.phase === "downloading");
    const ready = r.active && r.llm?.state === "ready";
    el.innerHTML = fit.map((m) => card(m, busy)).join("")
      + (unfit.length ? `<details class="su-unfit"${W.showAll ? " open" : ""}><summary>Не подойдут этому телефону: ${unfit.length}</summary>${unfit.map((m) => `<div class="su-model off"><b>${h(m.title)}</b><small>${h(m.why || "")}</small></div>`).join("")}</details>` : "")
      + (W.msg ? `<p class="err">${h(W.msg)}</p>` : "")
      + (ready ? `<div class="su-actions"><button class="btn primary" data-a="done-local">Готово — начнём!</button></div>` : "");
    q("details", el)?.addEventListener("toggle", (e) => { W.showAll = e.target.open; }, { once: true });
    if (ready && !W.spoken.has("ready")) line("Модель включена — теперь я думаю прямо в телефоне, без интернета.", "ready", "joy");
  }

  function card(m, busy) {
    const r = W.rep, s = m.state?.phase, active = r.active === m.id;
    const pct = s === "downloading" && m.state.total ? Math.round(m.state.done / m.state.total * 100) : 0;
    let btns = "";
    if (s === "downloading") btns = `<button class="btn small" data-a="cancel" data-id="${m.id}">Отменить</button>`;
    else if (s === "ready" && active && r.llm?.state !== "error") btns = `<button class="btn small" data-a="off">Выключить</button>`;
    else if (s === "ready") btns = `<button class="btn small primary" data-a="enable" data-id="${m.id}">Включить</button><button class="btn small" data-a="remove" data-id="${m.id}">Удалить</button>`;
    else if (s !== "verifying") btns = `<button class="btn small ${m.rec ? "primary" : ""}" data-a="download" data-id="${m.id}" ${busy || m.space === false ? "disabled" : ""}>Скачать ${L.gb(m.gb)} ГБ</button>`;
    const st = L.modelLine(m, r.active, r.llm);
    return `<div class="su-model ${m.rec ? "rec" : ""} ${active ? "active" : ""}"><div class="su-mh"><b>${h(m.title)}</b>${m.rec ? `<span class="su-badge">★ советую</span>` : ""}${m.vision ? `<span class="su-badge v">видит экран</span>` : ""}</div>
      <small>${h(m.note)} · ${L.gb(m.gb)} ГБ</small>${s === "downloading" ? `<div class="su-bar"><i style="width:${pct}%"></i></div>` : ""}${st ? `<small class="su-st">${h(st)}</small>` : ""}<div class="row">${btns}</div></div>`;
  }

  function cloud(intro, visionOnly = false) {
    W.step = "cloud"; clearInterval(W.timer); progress(SET ? 3 : 2);
    line(intro || (W.rep && W.rep.verdict !== "local" ? L.verdictText(W.rep).text : "Выберите сервис и вставьте ключ — я сама проверю, что всё работает."), "cloud", "calm");
    body.innerHTML = `<div id="suCloud"></div><div class="su-actions">${SET && W.rep?.verdict === "local" ? `<button class="btn" data-a="models">Модель на телефоне</button>` : ""}<button class="btn" data-a="skip">Позже</button></div>`;
    cloudForm(q("#suCloud", body), visionOnly, (p, answer) => done(`Подключено: ${p.name}. ${answer ? `Ответ: «${answer}». ` : ""}` + (p.caps.includes("vision") ? "Всё готово — голос, аватар, CRM, документы, код, экран и фото работают." : "Голос, аватар, CRM, документы и код работают. Чтобы я видела экран и фото, добавьте ещё сервис с отметкой 👁 — можно сейчас или позже во вкладке «ИИ»."), !p.caps.includes("vision")));
  }

  function done(text, addEye) {
    W.step = "done"; clearInterval(W.timer); progress(SET ? 4 : 3);
    line(text || "Всё готово! Спрашивайте голосом или текстом.", "done", "joy");
    body.innerHTML = `<div class="su-actions"><button class="btn primary" data-a="close">Начать общение</button>${addEye ? `<button class="btn" data-a="cloud-eye">Добавить сервис 👁</button>` : ""}</div>`;
    try { localStorage.setItem("sv_setup_done", "1"); } catch {}
  }

  /** Форма облака: плитки сервисов → ключ (+ ID каталога для Яндекса) → «Подключить и проверить». Используется и во вкладке «ИИ». */
  function cloudForm(el, visionOnly, onOk) {
    if (typeof visionOnly === "function") { onOk = visionOnly; visionOnly = false; }
    const list = L.PRESETS.filter((p) => !visionOnly || p.caps.includes("vision"));
    let cur = null;
    const tiles = () => `<div class="su-tiles">${list.map((p) => `<button type="button" class="su-tile ${cur?.id === p.id ? "on" : ""}" data-p="${p.id}"><b>${h(p.name)}</b><small>${h(p.by)}${p.ru ? " · из РФ" : ""}</small>${p.caps.includes("vision") ? `<small class="su-eye">👁 видит экран и фото</small>` : ""}</button>`).join("")}</div>`;
    const form = (p) => `<form class="su-form" autocomplete="off">
      <label>${h(p.keyLabel)}<span class="su-key"><input name="key" type="password" required placeholder="Вставьте ключ" spellcheck="false"><button type="button" class="icon" data-eye aria-label="Показать ключ">👁</button></span></label>
      ${p.folder ? `<label>ID каталога<input name="folder" required placeholder="b1g…" spellcheck="false"></label>` : ""}
      <label>Модель<select name="model">${p.models.map((m) => `<option>${h(m)}</option>`).join("")}</select></label>
      <p class="hint">${h(p.how)} <a href="${h(p.link)}" target="_blank" rel="noopener">Где взять ключ →</a></p>
      <button class="btn primary">Подключить и проверить</button><p class="su-res" role="status"></p></form>`;
    const draw = () => { el.innerHTML = tiles() + (cur ? form(cur) : `<p class="hint">Ключ хранится только в ядре Светланы на этом устройстве.</p>`); q("input[name=key]", el)?.focus(); };
    el.onclick = (e) => {
      const t = e.target.closest("[data-p]"); if (t) { if (saving) return; cur = L.preset(t.dataset.p); draw(); return; }
      if (e.target.closest("[data-eye]")) { const i = q("input[name=key]", el); i.type = i.type === "password" ? "text" : "password"; }
      if (e.target.closest("[data-force]")) { e.preventDefault(); save(true); }
    };
    el.onsubmit = (e) => { e.preventDefault(); save(false); };
    let saving = false;
    const ok = (p, answer) => { saving = false; el.classList.remove("busy"); cur = null; draw(); onOk(p, answer); }; // форма снова чистая (во вкладке «ИИ» можно добавить следующий сервис)
    async function save(force) {
      const f = q("form", el), res = q(".su-res", el), btn = q("form > .btn.primary", el); if (!f || !cur || saving) return;
      const sel = cur; // выбор сервиса фиксируем: переключение плиток во время проверки не подменит результат
      let b; try { b = L.buildProvider(sel.id, { key: f.key.value, model: f.model.value, folder: f.folder?.value }); } catch (err) { res.className = "su-res err"; res.textContent = err.message; return; }
      saving = true; el.classList.add("busy"); btn.disabled = true; res.className = "su-res"; res.textContent = force ? "Сохраняю…" : "Подключаю и проверяю…"; ava("thinking");
      try {
        await call("/api/providers", { method: "POST", body: JSON.stringify(b) });
        if (force) { ava("idle", "calm"); ok(sel, ""); return; }
        const t = await call("/api/providers/test", { method: "POST", body: JSON.stringify({ id: b.id }) });
        if (t.ok) { ava("idle", "joy"); ok(sel, String(t.answer || "").trim().slice(0, 60)); return; }
        await call("/api/providers?id=" + encodeURIComponent(b.id), { method: "DELETE" }).catch(() => {}); // нерабочий ключ не оставляем: иначе «думать есть чем», а ответов нет
        throw new Error(t.error || "сервис не ответил");
      } catch (err) {
        saving = false; el.classList.remove("busy"); ava("idle", "sorry"); btn.disabled = false; res.className = "su-res err";
        res.innerHTML = `Не получилось: ${h(String(err.message || err).slice(0, 200))}. Проверьте ключ${sel.folder ? " и ID каталога" : ""}. <a href="#" data-force>Сохранить без проверки</a>`;
      }
    }
    draw();
  }

  // ---------- действия ----------
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a, id = b.dataset.id; W.msg = "";
    if (a === "check") check();
    else if (a === "models") models();
    else if (a === "cloud") cloud();
    else if (a === "cloud-eye") cloud("Выберите сервис, который видит экран и фото. Первый сервис остаётся — я сама выберу нужный под задачу.", true);
    else if (a === "skip") { try { localStorage.setItem("sv_setup_skip", "1"); } catch {} try { SET?.skip?.(true); } catch {} close(); }
    else if (a === "close" || a === "done-local") { if (a === "done-local") done("Готово! Я думаю прямо в телефоне. Спрашивайте голосом или текстом."); else close(); }
    else if (a === "native") SET?.openModels();
    else if (a === "download") { const r = SET?.download(id); if (r) W.msg = r; W.rep = report() || W.rep; drawModels(); }
    else if (a === "cancel") { const r = SET?.cancel(id); if (r) W.msg = r; W.rep = report() || W.rep; drawModels(); }
    else if (a === "enable") {
      b.disabled = true; // второе нажатие не запускает модель повторно (и мост это тоже отсекает)
      let r = SET?.enable(id, false) || "";
      if (r.startsWith("warn:")) r = confirm(r.slice(5)) ? SET.enable(id, true) || "" : "skip";
      if (r && r !== "skip") W.msg = r; else if (!r) line("Загружаю модель в память — до пары минут.", "enable-" + id, "thinking");
      W.rep = report() || W.rep; drawModels();
    }
    else if (a === "off") { b.disabled = true; const r = SET?.disable(); if (r) W.msg = r; setTimeout(() => { W.rep = report() || W.rep; drawModels(); }, 600); }
    else if (a === "remove" && confirm("Удалить модель с телефона?")) { const r = SET?.remove(id); if (r) W.msg = r; W.rep = report() || W.rep; drawModels(); }
  });

  function open(mode = "first") {
    W.run++; W.spoken.clear(); W.mode = mode; W.open = true; box.hidden = false; document.body.classList.add("su-on");
    if (mode === "brain") { if (SET) check(); else cloud(); return; }
    if (mode === "cloud") { cloud(); return; }
    hello();
  }
  function close() {
    W.run++; W.open = false; W.step = ""; clearInterval(W.timer); box.hidden = true; document.body.classList.remove("su-on");
    if (location.hash === "#setup") history.replaceState(null, "", location.pathname + location.search);
    window.SvAvatar?.setState("idle"); q("#text")?.focus?.();
  }
  /** При загрузке чата: открыть, если Светлане нечем думать (нет облака и модель на телефоне не выбрана) или просит приложение (#setup). */
  async function auto() {
    let skip = false; try { skip = localStorage.getItem("sv_setup_skip") === "1" || String(SET?.skipped?.() ?? false) === "true"; } catch {}
    if (location.hash === "#setup" && !skip) return open("first");
    if (skip) return;
    const r = report(); if (r && (r.usable ?? (r.active && ["ready", "starting"].includes(r.llm?.state)))) return; // выбранная, но упавшая модель — не повод молчать
    const run = ++W.run; // пока ждём ответ ядра, пользователь мог сам открыть или закрыть мастер — тогда не вмешиваемся
    try { const list = await call("/api/providers"); if (run === W.run && !W.open && Array.isArray(list) && list.length === 0) open("first"); } catch {}
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && W.open && W.step !== "check") close(); });
  window.svSetup = { open, close, auto, cloudForm, _w: W };
})();
