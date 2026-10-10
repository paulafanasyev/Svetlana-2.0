"use strict";
// Чаты со своим ИИ, «Свой ИИ по ссылке» и «Команда» (Павел — CEO). Работает поверх app.js: общие $, api, esc, S, bubble, fmt, loadProviders.
(() => {
  const T = { providers: [], team: [], presets: [], loaded: false };
  const q = (s, el = document) => el.querySelector(s);
  const busy = () => $("#send").disabled;
  const post = (p, b, method = "POST") => api(p, { method, body: JSON.stringify(b) });
  const pName = (id) => { const p = T.providers.find((x) => x.id === id); return p ? p.name || p.id : id; };
  const note = (t) => { const d = bubble("bot", `<div class="txt">${t}</div>`); d.classList.add("sys"); return d; };

  // ---------- кто отвечает в чате ----------
  const target = (c) => (c?.member ? "m:" + c.member : c?.provider ? "p:" + c.provider : "");
  const body = (v) => (v.startsWith("m:") ? { member: v.slice(2) } : v.startsWith("p:") ? { provider: v.slice(2) } : { provider: null, member: null });
  function who(v) {
    if (v.startsWith("m:")) { const m = T.team.find((x) => x.id === v.slice(2)); return m ? `${m.role} (${pName(m.provider)})` : "участник команды"; }
    if (v.startsWith("p:")) return pName(v.slice(2));
    return "Светлана (сама выбирает ИИ)";
  }
  function fillAi(sel, cur) {
    if (!sel) return; cur = cur ?? sel.value;
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    const team = T.team.map((m) => opt("m:" + m.id, `👤 ${m.role} · ${pName(m.provider)}`)).join("");
    const pv = T.providers.filter((p) => p.enabled !== false && p.capabilities.includes("chat")).map((p) => opt("p:" + p.id, `🧠 ${p.name || p.id}${p.model ? " · " + p.model : ""}`)).join("");
    sel.innerHTML = opt("", "✨ Светлана (авто)") + (team ? `<optgroup label="Команда">${team}</optgroup>` : "") + (pv ? `<optgroup label="Подключённые ИИ">${pv}</optgroup>` : "");
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
  }
  async function refresh() {
    try { const [pv, tm] = await Promise.all([api("/api/providers"), api("/api/team")]); T.providers = pv; T.team = tm.members; T.presets = tm.presets; T.loaded = true; }
    catch { return; }
    fillAi($("#chatAi")); const tv = $("#tmAi").value; $("#tmAi").innerHTML = `<option value="">— выберите ИИ —</option>` + T.providers.map((p) => `<option value="p:${esc(p.id)}">${esc(p.name || p.id)}${p.model ? " · " + esc(p.model) : ""}</option>`).join(""); $("#tmAi").value = tv; renderTeam();
    if (S.conv) { try { const c = await api("/api/conversations/" + S.conv); fillAi($("#chatAi"), target(c)); } catch {} }
  }
  $("#chatAi").addEventListener("change", async (e) => {
    const v = e.target.value;
    try {
      if (S.conv) await post("/api/conversations/" + S.conv, body(v), "PATCH");
      else { const c = await post("/api/conversations", body(v)); S.conv = c.id; localStorage.setItem("sv_conv", c.id); }
      note(`Дальше в этом чате отвечает: <b>${esc(who(v))}</b>`);
    } catch (err) { bubble("bot err", "Не получилось сменить ИИ: " + esc(err.message)); refresh(); }
  });

  // ---------- список чатов ----------
  function show(c) {
    if (typeof stopSpeaking === "function") stopSpeaking();
    S.conv = c.id; localStorage.setItem("sv_conv", c.id); $("#log").innerHTML = "";
    fillAi($("#chatAi"), target(c));
    (c.messages || []).slice(-30).forEach((m) => bubble(m.role === "user" ? "me" : "bot", fmt(m.content)));
    if (!c.messages?.length) note(`Новый чат. Отвечает: <b>${esc(who(target(c)))}</b>`);
    toggleList(false); $("#text").focus();
  }
  async function newChat(v = $("#chatAi").value) {
    if (busy()) return note("Дождитесь ответа в этом чате, потом откроем новый.");
    try { show(await post("/api/conversations", body(v))); } catch (e) { bubble("bot err", "Новый чат не создался: " + esc(e.message)); }
  }
  async function openChat(id) {
    if (busy()) return note("Дождитесь ответа, потом переключимся.");
    try { show(await api("/api/conversations/" + id)); } catch (e) { bubble("bot err", esc(e.message)); }
  }
  function toggleList(on = $("#chatList").hidden) {
    $("#chatList").hidden = !on; $("#chatsBtn").setAttribute("aria-expanded", String(on));
    if (on) loadList();
  }
  async function loadList() {
    const el = $("#chatList"); el.innerHTML = `<p class="hint">Загружаю…</p>`;
    let list; try { list = await api("/api/conversations"); } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    el.innerHTML = list.length ? list.map((c) => `<div class="chatitem${c.id === S.conv ? " on" : ""}" data-open="${esc(c.id)}" role="button" tabindex="0"><span><b>${esc(c.title || "Без названия")}</b><small>${esc(who(target(c)))}</small></span><button class="btn small" data-rm="${esc(c.id)}" aria-label="Удалить чат" title="Удалить чат">✕</button></div>`).join("") : `<p class="hint">Чатов пока нет — нажмите «＋ Новый».</p>`;
  }
  $("#chatsBtn").addEventListener("click", () => toggleList());
  $("#newChat").addEventListener("click", () => newChat());
  $("#chatList").addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-rm]")?.dataset.rm;
    if (rm) {
      e.stopPropagation(); if (!confirm("Удалить этот чат? Переписка пропадёт.")) return;
      try { await api("/api/conversations/" + rm, { method: "DELETE" }); } catch (err) { return bubble("bot err", esc(err.message)); }
      if (rm === S.conv) { S.conv = null; localStorage.removeItem("sv_conv"); $("#log").innerHTML = ""; fillAi($("#chatAi"), ""); note("Чат удалён. Пишите — начнём новый."); }
      return loadList();
    }
    const id = e.target.closest("[data-open]")?.dataset.open; if (id) openChat(id);
  });
  $("#chatList").addEventListener("keydown", (e) => { const id = e.target.dataset?.open; if (id && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openChat(id); } });

  // ---------- свой ИИ по ссылке ----------
  const cu = { models: [] };
  const draft = () => ({ baseUrl: $("#cuUrl").value.trim(), model: $("#cuModel").value.trim(), apiKey: $("#cuKey").value.trim(), name: $("#cuName").value.trim() });
  const out = (t, cls = "") => { const o = $("#cuOut"); o.className = "cu-out " + cls; o.innerHTML = t; };
  const lock = (on) => $("#cuForm").querySelectorAll("button,input").forEach((x) => { if (x.id !== "cuChat") x.disabled = on; });
  function chips(filter = "") {
    const f = filter.toLowerCase(); const list = cu.models.filter((m) => !f || m.toLowerCase().includes(f)).slice(0, 12);
    $("#cuModels").innerHTML = cu.models.slice(0, 500).map((m) => `<option value="${esc(m)}">`).join("");
    $("#cuChips").innerHTML = list.map((m) => `<button type="button" class="chip${m === $("#cuModel").value ? " on" : ""}" data-m="${esc(m)}">${esc(m)}</button>`).join("") + (cu.models.length > list.length ? `<small class="hint">…ещё ${cu.models.length - list.length} — начните вводить название</small>` : "");
  }
  async function loadModels(quiet) {
    const d = draft(); if (!d.baseUrl) { if (!quiet) out("Сначала вставьте адрес API.", "bad"); return; }
    out("Спрашиваю у сервера список моделей…");
    try {
      const r = await post("/api/providers/models", { baseUrl: d.baseUrl, apiKey: d.apiKey });
      if (!r.ok) { cu.models = []; chips(); return out("✘ Список не получен: " + esc(r.error) + ". Название модели можно вписать вручную.", "bad"); }
      if (r.baseUrl && r.baseUrl !== d.baseUrl) $("#cuUrl").value = r.baseUrl;
      cu.models = r.models; chips($("#cuModel").value);
      out(`Моделей: ${r.models.length}${r.note ? " · " + esc(r.note) : ""}. Выберите нужную.`, "ok");
    } catch (e) { out("✘ " + esc(e.message), "bad"); }
  }
  async function probe() {
    const d = draft(); if (!d.baseUrl || !d.model) { out("Нужны адрес API и модель.", "bad"); return null; }
    out("Проверяю соединение…"); lock(true);
    try {
      const r = await post("/api/providers/probe", d);
      if (!r.ok) { out("✘ Не отвечает: " + esc(r.error), "bad"); return r; }
      if (r.baseUrl) $("#cuUrl").value = r.baseUrl;
      q('#cuCaps input[value="tools"]').checked = r.tools;
      out(`✔ Работает: «${esc(r.answer)}» · ${(r.ms / 1000).toFixed(1)} с · действия (инструменты): ${r.tools ? "да — может работать как полноценная Светлана" : "нет — будет просто собеседником"}`, "ok");
      return r;
    } catch (e) { out("✘ " + esc(e.message), "bad"); return null; } finally { lock(false); }
  }
  $("#cuLoad").addEventListener("click", () => loadModels(false));
  // вставили ключ (или адрес локального сервера) — список моделей появляется сам, без кнопки
  let autoT = 0, autoSig = "";
  const autoModels = () => { clearTimeout(autoT); autoT = setTimeout(() => {
    const d = draft(); const local = /^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.)/i.test(d.baseUrl);
    const sig = d.baseUrl + "|" + d.apiKey; if (!d.baseUrl || (!d.apiKey && !local) || sig === autoSig) return;
    autoSig = sig; loadModels(true);
  }, 700); };
  $("#cuKey").addEventListener("input", autoModels);
  $("#cuUrl").addEventListener("input", () => { cu.models = []; chips(); autoModels(); });
  $("#cuModel").addEventListener("input", (e) => chips(e.target.value));
  $("#cuChips").addEventListener("click", (e) => { const m = e.target.dataset?.m; if (m) { $("#cuModel").value = m; chips(m); } });
  $("#cuEye").addEventListener("click", () => { const k = $("#cuKey"); k.type = k.type === "password" ? "text" : "password"; });
  $("#cuTest").addEventListener("click", probe);
  $("#cuForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await probe(); if (!r) return;
    if (!r.ok && !confirm("Соединение не прошло. Всё равно сохранить?")) return;
    const d = draft(); d.capabilities = [...document.querySelectorAll("#cuCaps input:checked")].map((x) => x.value);
    if (r.ok) d.baseUrl = $("#cuUrl").value.trim();
    try {
      const s = await post("/api/providers/custom", d);
      $("#cuKey").value = ""; $("#cuKey").type = "password";
      out(`✔ Подключён: <b>${esc(s.provider.name || s.provider.id)}</b>. Его можно выбрать в чате (поле «ИИ») или дать ему роль во вкладке «Команда».`, "ok");
      $("#cuChat").hidden = false; $("#cuChat").dataset.p = s.provider.id;
      if (typeof loadProviders === "function") loadProviders(); refresh();
    } catch (err) { out("✘ " + esc(err.message), "bad"); }
  });
  $("#cuChat").addEventListener("click", (e) => { tab("chat"); newChat("p:" + e.target.dataset.p); });
  $("#cuCaps").innerHTML += [["chat", "чат", true], ["tools", "действия (инструменты)", false], ["vision", "видит картинки", false]].map(([v, t, on]) => `<label><input type="checkbox" value="${v}"${on ? " checked disabled" : ""}> ${t}</label>`).join("");

  // ---------- команда ----------
  function tab(name) { q(`#tabs button[data-tab="${name}"]`)?.click(); }
  function renderTeam() {
    const el = $("#teamList"); if (!el) return;
    const noAi = !T.providers.length;
    $("#teamForm").querySelectorAll("input,select,textarea,button").forEach((x) => (x.disabled = noAi));
    $("#teamEmpty").hidden = !noAi;
    $("#teamPresets").innerHTML = T.presets.filter((p) => !T.team.some((m) => m.role.toLowerCase() === p.role.toLowerCase())).map((p) => `<button type="button" class="chip" data-role="${esc(p.role)}">＋ ${esc(p.role)}</button>`).join("");
    el.innerHTML = T.team.length ? T.team.map((m) => `<div class="member" data-id="${esc(m.id)}">
      <div class="row"><b class="role">${esc(m.role)}</b><select data-f="provider" aria-label="ИИ для роли ${esc(m.role)}"></select>
      <button type="button" class="btn small" data-chat="${esc(m.id)}">💬 Чат</button><button type="button" class="btn small" data-del="${esc(m.id)}">Удалить</button></div>
      ${T.providers.some((p) => p.id === m.provider) ? "" : `<p class="err">ИИ «${esc(m.provider)}» больше не подключён — выберите другой</p>`}
      <textarea data-f="instructions" rows="2" maxlength="2000" placeholder="Задачи роли" aria-label="Задачи роли ${esc(m.role)}">${esc(m.instructions)}</textarea></div>`).join("")
      : `<p class="hint">Ролей пока нет. Нажмите готовую ниже (CTO, IT…) или впишите свою.</p>`;
    el.querySelectorAll(".member").forEach((d) => { const m = T.team.find((x) => x.id === d.dataset.id); const s = q("select", d); s.innerHTML = T.providers.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join(""); s.value = m.provider; });
  }
  async function saveMember(d) {
    const m = T.team.find((x) => x.id === d.dataset.id); if (!m) return;
    try { await post("/api/team", { id: m.id, role: m.role, provider: q("select", d).value, instructions: q("textarea", d).value }); await refresh(); }
    catch (e) { alert("Не сохранилось: " + e.message); refresh(); }
  }
  $("#teamList").addEventListener("change", (e) => { const d = e.target.closest(".member"); if (d && e.target.dataset.f) saveMember(d); });
  $("#teamList").addEventListener("click", async (e) => {
    const del = e.target.dataset?.del, chat = e.target.dataset?.chat;
    if (del) { const m = T.team.find((x) => x.id === del); if (!confirm(`Убрать роль «${m?.role}»? Её чаты останутся с тем же ИИ.`)) return; await api("/api/team?id=" + encodeURIComponent(del), { method: "DELETE" }); refresh(); }
    if (chat) { tab("chat"); newChat("m:" + chat); }
  });
  $("#teamPresets").addEventListener("click", (e) => {
    const r = e.target.dataset?.role; if (!r) return; const p = T.presets.find((x) => x.role === r);
    $("#tmRole").value = p.role; $("#tmIns").value = p.instructions; $("#tmAi").focus();
  });
  $("#teamForm").addEventListener("submit", async (e) => {
    e.preventDefault(); $("#tmOut").textContent = "";
    const v = $("#tmAi").value; if (!v.startsWith("p:")) { $("#tmOut").textContent = "Выберите подключённый ИИ для роли."; return; }
    try { await post("/api/team", { role: $("#tmRole").value, provider: v.slice(2), instructions: $("#tmIns").value }); $("#tmRole").value = ""; $("#tmIns").value = ""; $("#tmOut").textContent = "✔ Роль добавлена"; refresh(); }
    catch (err) { $("#tmOut").textContent = "✘ " + err.message; }
  });
  $("#tabs").addEventListener("click", (e) => { const t = e.target.closest("button[data-tab]")?.dataset.tab; if (t === "team" || t === "providers") refresh(); });

  // ---------- приоритет ИИ: ↑↓ в списке «Подключено» ----------
  const order = () => [...document.querySelectorAll("#provList [data-test]")].map((b) => b.dataset.test);
  function decorate() {
    const rows = [...document.querySelectorAll("#provList .dev")].filter((r) => r.querySelector("[data-test]"));
    rows.forEach((r, i) => {
      if (r.querySelector(".prio")) { r.querySelector(".prio b").textContent = i + 1; return; }
      const id = r.querySelector("[data-test]").dataset.test;
      const box = document.createElement("span"); box.className = "prio";
      box.innerHTML = `<b>${i + 1}</b><button type="button" class="btn small" data-up="${esc(id)}" aria-label="Выше по приоритету" title="Выше">↑</button><button type="button" class="btn small" data-down="${esc(id)}" aria-label="Ниже по приоритету" title="Ниже">↓</button>`;
      r.prepend(box);
    });
    const t = document.querySelector("#provList [data-test]"); if (t && t.textContent === "Проверить") document.querySelectorAll("#provList [data-test]").forEach((b) => (b.textContent = "Проверить связь"));
  }
  new MutationObserver(decorate).observe($("#provList"), { childList: true });
  $("#provList").addEventListener("click", async (e) => {
    const up = e.target.dataset?.up, down = e.target.dataset?.down; const id = up || down; if (!id) return;
    const ids = order(); const i = ids.indexOf(id); const j = up ? i - 1 : i + 1; if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await post("/api/providers/order", { ids }); if (typeof loadProviders === "function") await loadProviders(); refresh(); }
    catch (err) { alert("Порядок не сохранился: " + err.message); }
  });
  // версия ядра — видно, что на телефоне именно новая сборка
  async function version() {
    try { const v = await api("/api/version"); document.querySelectorAll(".sv-ver").forEach((x) => (x.textContent = `Светлана ${v.version} · инструментов: ${v.tools}`)); } catch {}
  }
  for (const sel of ["#tab-providers > h2", "#tab-team > h2"]) { const h = q(sel); if (h) h.insertAdjacentHTML("afterend", `<p class="hint sv-ver"></p>`); }
  const ph = [...document.querySelectorAll("#tab-providers .hint")].find((x) => /Порядок = приоритет/.test(x.textContent)); if (ph) ph.textContent = "Сверху вниз — порядок: Светлана сначала спрашивает первый ИИ, при сбое — следующий. Меняйте стрелками ↑↓. «Проверить связь» — тест каждого. Ключи хранятся только в ядре.";

  // на телефоне экран Светлане показывает «Руки», а не браузер
  if (window.SvetlanaAndroid) { $("#shareScreen").hidden = true; $("#shareState").textContent = "На телефоне экран Светлане показывает кнопка «🖐 Экран и руки» вверху."; }

  // пока идёт ответ, ИИ чата не меняем (ядро тоже откажет)
  new MutationObserver(() => { $("#chatAi").disabled = busy(); }).observe($("#send"), { attributes: true, attributeFilter: ["disabled"] });

  // старт: когда вход выполнен (окно приложения видно)
  const start = () => { if (!$("#app").hidden && !T.loaded) { refresh(); version(); } };
  new MutationObserver(start).observe($("#app"), { attributes: true, attributeFilter: ["hidden"] }); start();
  window.svTeam = { refresh, newChat, openChat };
})();
