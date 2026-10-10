"use strict";
// Вкладка «Интеграции»: GitHub, Vercel, ВК, YouTube, почта. Ключи уходят только в ядро Светланы и обратно не показываются.
(() => {
  const tabs = $("#tabs"); if (!tabs || $("#tab-integrations")) return;
  const btn = document.createElement("button"); btn.dataset.tab = "integrations"; btn.textContent = "Интеграции"; btn.title = "GitHub, Vercel, ВК, YouTube, почта";
  const before = tabs.querySelector('button[data-tab="providers"]'); before ? tabs.insertBefore(btn, before) : tabs.appendChild(btn);
  const sec = document.createElement("section"); sec.id = "tab-integrations"; sec.className = "tab";
  sec.innerHTML = `<h2>Интеграции</h2><p class="hint">Подключите сервисы — и просите Светлану: «покажи непрочитанные письма», «создай issue в GitHub», «как прошёл деплой на Vercel», «опубликуй пост в ВК», «найди на YouTube…». Любое действие вовне (письмо, пост, деплой) Светлана сначала покажет вам на подтверждение.</p><div id="igList"><p class="hint">Загружаю…</p></div>
    <h3>MCP-серверы</h3><p class="hint">Как коннекторы у Claude и ChatGPT: вставьте адрес MCP-сервера (Streamable HTTP) и, если нужен, токен. Например GitHub: <code>https://api.githubcopilot.com/mcp/</code> + токен GitHub. Светлана увидит все его инструменты; всё, что меняет данные, — с вашим подтверждением.</p>
    <div id="mcpList"></div>
    <form id="mcpForm" class="ig"><label>Название<input id="mcpName" maxlength="40" placeholder="например, GitHub MCP"></label><label>Адрес<input id="mcpUrl" type="url" required placeholder="https://…/mcp"></label><label>Токен (если нужен)<input id="mcpToken" type="password" autocomplete="off"></label><div class="row"><button class="btn primary">Подключить MCP</button></div><p class="cu-out" id="mcpOut"></p></form>`;
  const anchor = $("#tab-providers"); anchor ? anchor.parentNode.insertBefore(sec, anchor) : document.querySelector(".tab")?.parentNode.appendChild(sec);

  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b) });
  const ICON = { github: "🐙", vercel: "▲", vk: "🟦", youtube: "▶️", gmail: "✉️", mailru: "📧", yandex: "📮" };
  let list = [];
  function card(x) {
    const f = x.fields.map((k) => `<label>${esc(k.label)}<input data-k="${esc(k.key)}" ${k.secret ? 'type="password" autocomplete="off"' : 'type="text"'} value="${esc(k.value || "")}" placeholder="${k.secret && x.connected ? "сохранён — оставьте пустым" : ""}"></label>`).join("");
    return `<div class="ig${x.connected ? " on" : ""}" data-id="${esc(x.id)}">
      <div class="ig-head"><b>${ICON[x.id] || "🔌"} ${esc(x.title)}</b><span class="ig-st">${x.connected ? "✔ " + esc(x.account || "подключено") : "не подключено"}</span></div>
      <details><summary>${x.connected ? "Изменить" : "Подключить"}</summary>
        <p class="hint">${esc(x.how)} <a href="${esc(x.link)}" target="_blank" rel="noopener">Открыть</a></p>${f}
        <div class="row"><button type="button" class="btn primary" data-act="save">${x.connected ? "Сохранить" : "Подключить"}</button>${x.connected ? `<button type="button" class="btn" data-act="test">Проверить связь</button><button type="button" class="btn" data-act="off">Отключить</button>` : ""}</div>
      </details><p class="cu-out" data-out></p></div>`;
  }
  async function load() {
    try { list = await api("/api/integrations"); } catch (e) { $("#igList").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    $("#igList").innerHTML = list.map(card).join("");
  }
  async function loadMcp() {
    let l; try { l = await api("/api/integrations/mcp"); } catch { return; }
    $("#mcpList").innerHTML = l.map((m) => `<div class="ig on"><div class="ig-head"><b>🧩 ${esc(m.name)}</b><span class="ig-st">инструментов: ${m.tools}</span></div><p class="hint">${esc(m.url)}</p><div class="row"><button type="button" class="btn" data-mcp-rm="${esc(m.id)}">Удалить</button></div></div>`).join("");
  }
  $("#mcpList").addEventListener("click", async (e) => { const id = e.target.dataset?.mcpRm; if (!id || !confirm("Удалить MCP-сервер?")) return; await api("/api/integrations/mcp?id=" + encodeURIComponent(id), { method: "DELETE" }); loadMcp(); });
  $("#mcpForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const o = $("#mcpOut"); const b = e.target.querySelector("button"); b.disabled = true; o.className = "cu-out"; o.textContent = "Подключаюсь и спрашиваю список инструментов…";
    try {
      const r = await post("/api/integrations/mcp", { name: $("#mcpName").value, url: $("#mcpUrl").value, token: $("#mcpToken").value });
      if (!r.ok) { o.className = "cu-out bad"; o.textContent = "✘ " + r.error; return; }
      o.className = "cu-out ok"; o.textContent = `✔ ${r.server.name}: инструментов ${r.server.tools}${r.server.sample.length ? " (" + r.server.sample.join(", ") + "…)" : ""}`;
      $("#mcpToken").value = ""; loadMcp();
    } catch (err) { o.className = "cu-out bad"; o.textContent = "✘ " + err.message; } finally { b.disabled = false; }
  });
  $("#igList").addEventListener("click", async (e) => {
    const act = e.target.dataset?.act; if (!act) return;
    const c = e.target.closest(".ig"); const id = c.dataset.id; const out = c.querySelector("[data-out]");
    const say = (t, cls = "") => { out.className = "cu-out " + cls; out.textContent = t; };
    c.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      if (act === "save") {
        say("Проверяю доступ…");
        const fields = Object.fromEntries([...c.querySelectorAll("input[data-k]")].map((i) => [i.dataset.k, i.value]));
        const r = await post("/api/integrations", { id, fields });
        if (!r.ok) return say("✘ " + r.error, "bad");
        await load(); const n = $(`#igList .ig[data-id="${id}"] [data-out]`); if (n) { n.className = "cu-out ok"; n.textContent = "✔ Подключено: " + (r.account || ""); }
        return;
      }
      if (act === "test") { say("Проверяю…"); const r = await post("/api/integrations/test", { id }); return r.ok ? say("✔ Работает: " + r.account, "ok") : say("✘ " + r.error, "bad"); }
      if (act === "off") { if (!confirm("Отключить? Ключ удалится из Светланы.")) return; await api("/api/integrations?id=" + encodeURIComponent(id), { method: "DELETE" }); await load(); }
    } catch (err) { say("✘ " + err.message, "bad"); }
    finally { c.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  });
  tabs.addEventListener("click", (e) => { if (e.target.closest('button[data-tab="integrations"]')) { load(); loadMcp(); } });
  window.svIntegrations = { load, loadMcp };
})();
