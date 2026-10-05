// Сборка ядра: хранилище, провайдеры, инструменты, агент, устройства.
import fs from "node:fs";
import path from "node:path";
import { Store } from "./store.mjs";
import { Providers } from "./providers.mjs";
import { Registry } from "./tools/registry.mjs";
import { codeTools } from "./tools/code.mjs";
import { businessTools } from "./tools/business.mjs";
import { docTools } from "./tools/docs.mjs";
import { stpConnector, webTools } from "./tools/connectors.mjs";
import { DeviceHub, deviceTools } from "./devices.mjs";
import { Confirmations } from "./confirm.mjs";
import { Agent } from "./agent.mjs";

export function createApp(cfg, { fetchImpl = fetch } = {}) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const store = new Store(path.join(cfg.dataDir, "db"));
  const providers = new Providers(path.join(cfg.dataDir, "providers.json"), fetchImpl);
  const hub = new DeviceHub(store);
  const registry = new Registry().add(
    ...codeTools(cfg), ...businessTools(store), ...docTools(cfg, providers), ...webTools(), ...deviceTools(hub),
    ...stpConnector({ id: "aiko", title: "Маркетплейс АИКО", base: cfg.aikoUrl, token: cfg.aikoToken, fx: fetchImpl }),
    ...stpConnector({ id: "selfemployed", title: "Мир самозанятых", base: cfg.selfEmployedUrl, token: cfg.selfEmployedToken, fx: fetchImpl }),
  );
  const nonceFile = path.join(cfg.dataDir, "used-confirmations.json");
  const confirmations = new Confirmations(cfg.secret, undefined, {
    load: () => { try { return JSON.parse(fs.readFileSync(nonceFile, "utf8")); } catch { return []; } },
    save: (e) => { const t = nonceFile + ".tmp"; fs.writeFileSync(t, JSON.stringify(e)); fs.renameSync(t, nonceFile); },
  });
  if (!cfg.secret) console.warn("⚠ SVETLANA_SECRET не задан: после перезапуска выданные подтверждения станут недействительны");
  const agent = new Agent({ providers, registry, store, confirmations, maxSteps: cfg.maxSteps });
  return { cfg, store, providers, hub, registry, confirmations, agent };
}
