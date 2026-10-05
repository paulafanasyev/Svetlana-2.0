// Конфигурация из окружения. Ключи провайдеров живут только на сервере, браузер их не видит.
import fs from "node:fs";
import path from "node:path";

export function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

export function config(env = process.env) {
  const dataDir = path.resolve(env.SVETLANA_DATA_DIR || "./data");
  return {
    port: Number(env.PORT || 8787),
    host: env.HOST || "127.0.0.1",
    dataDir,
    workspace: path.resolve(env.SVETLANA_WORKSPACE || path.join(dataDir, "workspace")),
    adminToken: env.SVETLANA_ADMIN_TOKEN || "",
    secret: env.SVETLANA_SECRET || "",
    maxSteps: Number(env.SVETLANA_MAX_STEPS || 12),
    chromium: env.CHROMIUM_PATH || "",
    aikoUrl: env.AIKO_URL || "",
    aikoToken: env.AIKO_TOKEN || "",
    selfEmployedUrl: env.SELF_EMPLOYED_URL || "",
    selfEmployedToken: env.SELF_EMPLOYED_TOKEN || "",
    runnerSocket: env.SVETLANA_RUNNER_SOCKET || "",
    allowHostExec: env.SVETLANA_ALLOW_HOST_EXEC === "1",
    chromiumNoSandbox: env.CHROMIUM_NO_SANDBOX === "1",
    commandAllow: (env.SVETLANA_COMMAND_ALLOW || "node,npm,npx,git,python3,pytest,ls,cat,tsc,eslint,vitest").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
