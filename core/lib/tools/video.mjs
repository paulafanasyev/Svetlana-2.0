// Бесплатный монтаж видео на ПК через ffmpeg: обрезать, склеить, сделать вертикальным (Reels/Shorts), наложить музыку, вшить субтитры.
// Генерация роликов — во внешних сервисах (роль «Маркетинг и видео» в команде); здесь только монтаж готовых файлов в рабочей папке.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { artifacts } from "./docs.mjs";

const OPS = ["trim", "concat", "vertical", "music", "subtitles"];
const OUT_EXT = [".mp4", ".mov", ".mkv"]; // H.264 + AAC: .webm такие кодеки не принимает
const MIME_OUT = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska" };
const SAFE = /^[A-Za-z0-9_\-./а-яА-ЯёЁ ]+$/;
const sec = (v) => Math.round(Number(v) * 1000) / 1000;

export function ffmpegArgs(a, rel) {
  const out = ["-hide_banner", "-loglevel", "error", "-n"]; // -n: не перезаписывать чужой файл
  const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"];
  switch (a.op) {
    case "trim": {
      if (!(a.end > a.start)) throw new Error("конец должен быть позже начала");
      return [...out, "-ss", String(sec(a.start)), "-i", rel(a.input), "-t", String(sec(a.end - a.start)), ...enc, rel(a.output)];
    }
    case "concat": {
      if (!a.inputs || a.inputs.length < 2) throw new Error("для склейки нужно минимум два файла");
      const ins = a.inputs.flatMap((f) => ["-i", rel(f)]); const n = a.inputs.length;
      // все куски → один размер 1920x1080 (или как у первого — без сложностей: фиксированный), звук обязателен у каждого
      const v = a.inputs.map((_, i) => `[${i}:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`).join(";");
      const pairs = a.inputs.map((_, i) => `[v${i}][${i}:a:0]`).join("");
      return [...out, ...ins, "-filter_complex", `${v};${pairs}concat=n=${n}:v=1:a=1[v][a]`, "-map", "[v]", "-map", "[a]", ...enc, rel(a.output)];
    }
    case "vertical": return [...out, "-i", rel(a.input), "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1", ...enc, rel(a.output)];
    case "music": {
      const vol = Math.min(2, Math.max(0, a.volume ?? 1));
      const graph = a.keepVoice ? `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]` : `[1:a]volume=${vol}[a]`;
      return [...out, "-i", rel(a.input), "-stream_loop", "-1", "-i", rel(a.audio), "-filter_complex", graph, "-map", "0:v:0", "-map", "[a]", "-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", rel(a.output)];
    }
    case "subtitles": {
      const s = rel(a.srt).replace(/\\/g, "/");
      if (!/^[A-Za-z0-9_\-./]+\.(srt|ass)$/i.test(s)) throw new Error("файл субтитров: .srt/.ass, имя латиницей без пробелов");
      return [...out, "-i", rel(a.input), "-vf", `subtitles=${s}`, ...enc, rel(a.output)];
    }
  }
  throw new Error("неизвестная операция");
}

export function videoTools(cfg, { bin = process.env.SVETLANA_FFMPEG || "ffmpeg", timeoutMs = 15 * 60_000 } = {}) {
  const root = () => path.resolve(cfg.workspace);
  const inWs = (p) => {
    const s = String(p ?? ""); if (!s || !SAFE.test(s) || s.includes("..")) throw new Error(`имя файла «${s.slice(0, 80)}»: только буквы, цифры, пробел, - _ . /`);
    const f = path.resolve(root(), s); if (!f.startsWith(root() + path.sep)) throw new Error("файл вне рабочей папки"); return f;
  };
  const rel = (p) => path.relative(root(), inWs(p));
  let have = null;
  const check = () => (have ??= new Promise((res) => { try { const c = spawn(bin, ["-version"], { shell: false }); c.on("error", () => res(false)); c.on("close", (code) => res(code === 0)); } catch { res(false); } }));
  const run = (args) => new Promise((res) => {
    const c = spawn(bin, args, { cwd: root(), shell: false }); let err = "";
    const t = setTimeout(() => { try { c.kill("SIGKILL"); } catch {} }, timeoutMs);
    c.stderr.on("data", (d) => { err = (err + d).slice(-3000); });
    c.on("error", (e) => { clearTimeout(t); res({ code: -1, err: e.message }); });
    c.on("close", (code) => { clearTimeout(t); res({ code, err }); });
  });
  return [{
    name: "video_edit", domain: "media", risk: "write",
    description: "Бесплатный монтаж видео на этом ПК (ffmpeg), файлы в рабочей папке: trim — обрезать (start/end в секундах), concat — склеить несколько (inputs), vertical — вертикальный 1080×1920 для Reels/Shorts/Клипов, music — наложить музыку (audio, volume 0–2, keepVoice — оставить исходный звук), subtitles — вшить субтитры (.srt). Новый файл — output. Сгенерировать ролик с нуля не умеет — для этого внешний сервис.",
    parameters: { type: "object", properties: {
      op: { type: "string", enum: OPS }, input: { type: "string", maxLength: 300 }, inputs: { type: "array", minItems: 2, maxItems: 20, items: { type: "string", maxLength: 300 } },
      output: { type: "string", maxLength: 300 }, start: { type: "number", minimum: 0, maximum: 86400 }, end: { type: "number", minimum: 0, maximum: 86400 },
      audio: { type: "string", maxLength: 300 }, volume: { type: "number", minimum: 0, maximum: 2 }, keepVoice: { type: "boolean" }, srt: { type: "string", maxLength: 300 },
    }, required: ["op", "output"], additionalProperties: false },
    confirm: (a) => { try { return fs.existsSync(inWs(a.output)); } catch { return true; } }, // новый файл — без лишних кликов; существующий не трогаем
    async execute(_ctx, a) {
      const need = { trim: ["input", "start", "end"], concat: ["inputs"], vertical: ["input"], music: ["input", "audio"], subtitles: ["input", "srt"] }[a.op];
      const miss = need.filter((k) => a[k] == null); if (miss.length) return { ok: false, error: `для ${a.op} нужно: ${miss.join(", ")}` };
      if (!OUT_EXT.includes(path.extname(String(a.output)).toLowerCase())) return { ok: false, error: "output: .mp4, .mov или .mkv" };
      const out = inWs(a.output);
      if (fs.existsSync(out)) return { ok: false, error: "файл output уже есть — выберите другое имя" };
      for (const f of [a.input, a.audio, a.srt, ...(a.inputs || [])].filter(Boolean)) if (!fs.existsSync(inWs(f))) return { ok: false, error: `нет файла ${f} в рабочей папке` };
      if (!(await check())) return { ok: false, error: "ffmpeg не найден. Установите бесплатно: Windows — `winget install Gyan.FFmpeg`, macOS — `brew install ffmpeg`, Linux — `sudo apt install ffmpeg`; на телефоне монтаж не поддерживается." };
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const args = ffmpegArgs(a, rel); const t0 = Date.now(); const r = await run(args);
      if (r.code !== 0 || !fs.existsSync(out)) { try { fs.rmSync(out, { force: true }); } catch {} return { ok: false, error: "ffmpeg: " + (r.err.trim().split("\n").slice(-3).join(" ") || "код " + r.code) }; }
      const bytes = fs.statSync(out).size; const A = artifacts(cfg);
      let link = [];
      if (bytes <= 300 * 1024 * 1024) { const name = `video-${crypto.randomBytes(4).toString("hex")}${path.extname(out).toLowerCase()}`; fs.copyFileSync(out, path.join(A.dir, name)); link = [{ name, url: `/api/artifacts/${name}`, bytes, mime: MIME_OUT[path.extname(out).toLowerCase()] }]; }
      return { data: { output: path.relative(root(), out), bytes, seconds: Math.round((Date.now() - t0) / 1000) }, artifacts: link, summary: `Видео готово: ${path.relative(root(), out)} (${(bytes / 1048576).toFixed(1)} МБ)` };
    },
  }];
}
