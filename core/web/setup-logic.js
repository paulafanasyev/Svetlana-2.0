"use strict";
// Мастер первого запуска — чистая логика без DOM (её проверяют тесты): облачные пресеты, сборка провайдера, проверки телефона, тексты итога.
(function (root) {
  const gb = (x) => (Math.round(Number(x) * 10) / 10).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /** Облака «в два касания»: выбрать сервис → вставить ключ. Порядок: что проще получить и оплатить из России — выше. */
  const PRESETS = [
    { id: "gigachat", name: "GigaChat", by: "Сбер", type: "gigachat", models: ["GigaChat-2-Max", "GigaChat-2-Pro", "GigaChat-2"], caps: ["chat", "tools"],
      keyLabel: "Ключ авторизации (Authorization key)", link: "https://developers.sber.ru/studio/", ru: true,
      how: "Студия Сбера → проект GigaChat API → «Настройки API» → «Получить ключ». Есть бесплатный лимит для физлиц." },
    { id: "yandex", name: "YandexGPT", by: "Яндекс", type: "openai", models: ["yandexgpt/latest", "yandexgpt-lite/latest"], caps: ["chat", "tools"], folder: true, authScheme: "Api-Key",
      keyLabel: "API-ключ сервисного аккаунта", link: "https://console.yandex.cloud/", ru: true,
      how: "Консоль Yandex Cloud → сервисный аккаунт с ролью ai.languageModels.user → «Создать API-ключ». ID каталога — на главной странице консоли." },
    { id: "deepseek", name: "DeepSeek", by: "дёшево", type: "openai", models: ["deepseek-chat", "deepseek-reasoner"], caps: ["chat", "tools"],
      keyLabel: "API-ключ", link: "https://platform.deepseek.com/api_keys", ru: true, how: "platform.deepseek.com → API keys → Create. Дёшево, пополнение картой." },
    { id: "openrouter", name: "OpenRouter", by: "сотни моделей", type: "openai", models: ["google/gemini-2.5-flash", "openai/gpt-4.1-mini", "anthropic/claude-sonnet-4.5"], caps: ["chat", "tools", "vision"],
      keyLabel: "API-ключ", link: "https://openrouter.ai/keys", ru: true, how: "openrouter.ai → Keys → Create key. Один ключ — доступ к моделям OpenAI, Google, Anthropic и др." },
    { id: "openai", name: "OpenAI", by: "ChatGPT", type: "openai", models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o"], caps: ["chat", "tools", "vision", "tts", "stt"],
      keyLabel: "API-ключ (sk-…)", link: "https://platform.openai.com/api-keys", how: "platform.openai.com → API keys → Create new secret key. Из России нужен зарубежный аккаунт и карта." },
    { id: "gemini", name: "Gemini", by: "Google", type: "openai", models: ["gemini-2.5-flash", "gemini-2.5-pro"], caps: ["chat", "tools", "vision"],
      keyLabel: "API-ключ", link: "https://aistudio.google.com/apikey", how: "Google AI Studio → Get API key. Из России недоступен без зарубежного аккаунта." },
    { id: "anthropic", name: "Claude", by: "Anthropic", type: "anthropic", models: ["claude-sonnet-4-5", "claude-haiku-4-5"], caps: ["chat", "tools", "vision"],
      keyLabel: "API-ключ (sk-ant-…)", link: "https://console.anthropic.com/settings/keys", how: "console.anthropic.com → API Keys → Create Key. Из России нужен зарубежный аккаунт." },
    { id: "mistral", name: "Mistral", by: "Mistral AI", type: "openai", models: ["mistral-large-latest", "mistral-small-latest"], caps: ["chat", "tools"],
      keyLabel: "API-ключ", link: "https://console.mistral.ai/api-keys", how: "console.mistral.ai → API Keys → Create new key." },
    { id: "groq", name: "Groq", by: "очень быстро", type: "openai", models: ["llama-3.3-70b-versatile", "qwen/qwen3-32b"], caps: ["chat", "tools"],
      keyLabel: "API-ключ", link: "https://console.groq.com/keys", how: "console.groq.com → API Keys → Create API Key. Есть бесплатный лимит." },
  ];
  const preset = (id) => PRESETS.find((p) => p.id === id) || null;

  /** Тело POST /api/providers из пресета и ввода пользователя. Ошибка — текст для человека. */
  function buildProvider(id, { key, model, folder } = {}) {
    const p = preset(id); if (!p) throw new Error("Нет такого сервиса");
    key = String(key || "").trim().replace(/^(Bearer|Basic|Api-Key)\s+/i, "");
    if (key.length < 8 || /\s/.test(key)) throw new Error("Похоже, ключ вставлен не целиком — скопируйте его ещё раз");
    model = String(model || p.models[0]).trim();
    const body = { id: p.id, preset: p.id, type: p.type, model, apiKey: key, capabilities: [...p.caps] };
    if (p.authScheme) body.authScheme = p.authScheme;
    if (p.folder) {
      folder = String(folder || "").trim();
      if (!/^[a-z0-9]{10,40}$/i.test(folder)) throw new Error("Нужен ID каталога Yandex Cloud (например b1g…)");
      body.model = model.startsWith("gpt://") ? model : `gpt://${folder}/${model}`;
      body.headers = { "OpenAI-Project": folder, "x-folder-id": folder };
    }
    return body;
  }

  /** Проверки телефона для экрана «оцениваю»: что смотрели, результат и пояснение. */
  function checks(d) {
    const ram = Number(d.ramGb) || 0, free = Number(d.freeGb) || 0;
    const fits = (d.models || []).filter((m) => m.fits);
    const lightest = fits.length ? Math.min(...fits.map((m) => m.gb)) : 0.4;
    return [
      { id: "cpu", label: "Процессор", value: d.arm64 ? "64-бит" + (d.soc ? " · " + d.soc : "") : "32-бит", ok: !!d.arm64, why: d.arm64 ? "" : "модели без интернета нужен 64-битный процессор" },
      { id: "android", label: "Android", value: String(d.android || d.sdk || "?"), ok: Number(d.sdk) >= 28, why: Number(d.sdk) >= 28 ? "" : "нужен Android 9 или новее" },
      { id: "ram", label: "Оперативная память", value: gb(ram) + " ГБ", ok: fits.length > 0, why: fits.length ? "" : "для модели внутри телефона мало памяти" },
      { id: "disk", label: "Свободное место", value: gb(free) + " ГБ", ok: free >= lightest * 1.05, warn: true, why: free >= lightest * 1.05 ? "" : "освободите место, чтобы скачать модель" },
      { id: "engine", label: "Движок моделей", value: d.serverBundled ? "есть" : "нет в этой версии", ok: !!d.serverBundled, why: d.serverBundled ? "" : "установите версию приложения arm64-v8a" },
    ];
  }

  /** Итог оценки человеческим языком. */
  function verdictText(d) {
    const rec = (d.models || []).find((m) => m.rec);
    if (d.verdict === "local" && rec) return { title: `Ваш телефон — ${d.tierName || "подходит"} 💪`, text: `Я могу думать прямо в телефоне, без интернета. Советую «${rec.title}» (${gb(rec.gb)} ГБ). А для сложных задач можно добавить облако.` };
    if (d.verdict === "weak") return { title: "Телефон справится, но с трудом", text: "Модель внутри телефона будет медленной и может закрываться. Советую облако — с ним работает всё: голос, аватар, CRM, документы, код, а с сервисом 👁 — и экран." };
    return { title: "Буду думать в облаке ☁️", text: "Для ИИ внутри этого телефона не хватает " + (!d.arm64 ? "64-битного процессора" : Number(d.sdk) < 28 ? "версии Android (нужна 9+)" : !d.serverBundled ? "движка в этой версии приложения" : "памяти") + ". Это не страшно: подключите облачный ИИ своим ключом — и всё будет работать: голос, аватар, CRM, учёт, документы, код, экран и руки. Чтобы я видела экран и фото, выберите сервис с отметкой 👁." };
  }

  /** Подпись состояния модели. */
  function modelLine(m, active, llm) {
    const s = m.state || {};
    if (active === m.id && llm?.state === "ready") return "✅ Включена — я думаю ею";
    if (active === m.id && llm?.state === "starting") return "⏳ Загружаю в память…";
    if (active === m.id && llm?.state === "error") return "⚠ " + (llm.text || "Не запустилась");
    switch (s.phase) {
      case "downloading": return `Скачиваю: ${gb((s.done || 0) / 1e9)} из ${gb((s.total || 0) / 1e9)} ГБ`;
      case "verifying": return "Проверяю файл (контрольная сумма)…";
      case "ready": return "Скачана и проверена";
      case "failed": return "Загрузка не удалась — попробуйте ещё раз по Wi-Fi";
      case "corrupt": return "Файл повреждён или подменён — удалён, скачайте заново";
      default: return m.space === false ? `Нужно ${gb(m.gb * 1.05)} ГБ свободного места` : "";
    }
  }

  root.SvSetupLogic = { PRESETS, preset, buildProvider, checks, verdictText, modelLine, gb };
})(typeof window !== "undefined" ? window : globalThis);
