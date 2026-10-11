// Отпечаток голоса владельца: MFCC-признаки речи, шаблон из нескольких записей и проверка совпадения.
// Всё считается на устройстве, запись голоса никуда не отправляется. Это локальная биометрическая проверка:
// она отсекает чужие голоса, но не заменяет подтверждение действий (запись голоса можно воспроизвести).

const N_MEL = 26;
const N_CEP = 13;            // c1..c12 (c0 = громкость, не используем)
const MIN_VOICED_FRAMES = 40; // ≈ 0,4 с речи

export interface VoicePrint { v: number[]; frames: number }
export interface VoiceTemplate {
  version: 1;
  mean: number[];
  sd: number[];
  distThreshold: number;
  samples: number;
  createdAt: number;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const hz2mel = (f: number) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m: number) => 700 * (10 ** (m / 2595) - 1);

/** Признаки голоса из PCM (моно, -1..1). null — слишком мало речи или тишина. */
export function computeVoicePrint(pcm: Float32Array, sampleRate: number): VoicePrint | null {
  if (!(sampleRate >= 8000) || pcm.length < sampleRate * 0.5) return null;
  const frameLen = Math.round(0.025 * sampleRate);
  const hop = Math.round(0.010 * sampleRate);
  let nfft = 1; while (nfft < frameLen) nfft <<= 1;
  const frames = Math.floor((pcm.length - frameLen) / hop) + 1;
  if (frames < MIN_VOICED_FRAMES) return null;

  // Отбор кадров с речью: громче 10% от максимума и не тише абсолютного порога.
  const rms = new Float64Array(frames);
  let maxRms = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < frameLen; i++) { const x = pcm[f * hop + i]; s += x * x; }
    rms[f] = Math.sqrt(s / frameLen);
    if (rms[f] > maxRms) maxRms = rms[f];
  }
  if (maxRms < 0.003) return null;
  const gate = Math.max(maxRms * 0.1, 0.002);

  // Мел-фильтры 80 Гц … min(7600, Найквист)
  const fMax = Math.min(7600, sampleRate / 2 - 100);
  const melPts = Array.from({ length: N_MEL + 2 }, (_, i) => mel2hz(hz2mel(80) + (i * (hz2mel(fMax) - hz2mel(80))) / (N_MEL + 1)));
  const bins = melPts.map(f => Math.floor(((nfft + 1) * f) / sampleRate));
  const window = Float64Array.from({ length: frameLen }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameLen - 1)));

  const ceps: number[][] = [];
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let f = 0; f < frames; f++) {
    if (rms[f] < gate) continue;
    re.fill(0); im.fill(0);
    const off = f * hop;
    for (let i = 0; i < frameLen; i++) {
      const x = pcm[off + i] - 0.97 * (i > 0 ? pcm[off + i - 1] : off > 0 ? pcm[off - 1] : 0);
      re[i] = x * window[i];
    }
    fft(re, im);
    const mel = new Float64Array(N_MEL);
    for (let m = 1; m <= N_MEL; m++) {
      const [a, b, c] = [bins[m - 1], bins[m], bins[m + 1]];
      let e = 0;
      for (let k = a; k < c; k++) {
        const w = k < b ? (k - a) / Math.max(1, b - a) : (c - k) / Math.max(1, c - b);
        e += w * (re[k] * re[k] + im[k] * im[k]);
      }
      mel[m - 1] = Math.log(e + 1e-10);
    }
    const c: number[] = [];
    for (let k = 1; k < N_CEP; k++) {
      let s = 0;
      for (let m = 0; m < N_MEL; m++) s += mel[m] * Math.cos((Math.PI * k * (m + 0.5)) / N_MEL);
      c.push(s * Math.sqrt(2 / N_MEL));
    }
    ceps.push(c);
  }
  if (ceps.length < MIN_VOICED_FRAMES) return null;
  const dim = N_CEP - 1;
  const mean = Array(dim).fill(0), sd = Array(dim).fill(0);
  for (const c of ceps) c.forEach((x, k) => { mean[k] += x / ceps.length; });
  for (const c of ceps) c.forEach((x, k) => { sd[k] += ((x - mean[k]) ** 2) / ceps.length; });
  return { v: [...mean, ...sd.map(Math.sqrt)], frames: ceps.length };
}

function dist(v: number[], mean: number[], sd: number[]): number {
  let s = 0;
  for (let k = 0; k < mean.length; k++) s += ((v[k] - mean[k]) / sd[k]) ** 2;
  return Math.sqrt(s / mean.length);
}

function stats(prints: VoicePrint[]): { mean: number[]; sd: number[] } {
  const d = prints[0].v.length;
  const mean = Array(d).fill(0), sd = Array(d).fill(0);
  prints.forEach(p => p.v.forEach((x, k) => { mean[k] += x / prints.length; }));
  prints.forEach(p => p.v.forEach((x, k) => { sd[k] += ((x - mean[k]) ** 2) / Math.max(1, prints.length - 1); }));
  // Нижняя граница разброса: запись к записи голос немного «плавает» (усталость, микрофон, шум).
  return { mean, sd: sd.map((s, k) => Math.max(Math.sqrt(s), 0.35 + 0.08 * Math.abs(mean[k]))) };
}

export const MIN_ENROLL_SAMPLES = 3;

/** Шаблон из ≥3 записей. Порог считается по тому, насколько записи владельца отличаются друг от друга. */
export function buildTemplate(prints: VoicePrint[], now = Date.now()): VoiceTemplate {
  if (prints.length < MIN_ENROLL_SAMPLES) throw new Error(`Нужно минимум ${MIN_ENROLL_SAMPLES} записи голоса`);
  const { mean, sd } = stats(prints);
  // leave-one-out: насколько каждая запись далека от шаблона из остальных
  const loo = prints.map((p, i) => { const s = stats(prints.filter((_, j) => j !== i)); return dist(p.v, s.mean, s.sd); });
  const distThreshold = Math.min(2.5, Math.max(1.2, Math.max(...loo) * 1.3));
  return { version: 1, mean, sd, distThreshold, samples: prints.length, createdAt: now };
}

export interface VerifyResult { ok: boolean; score: number; reason?: string }

export function verifyPrint(p: VoicePrint | null, t: VoiceTemplate): VerifyResult {
  if (!p) return { ok: false, score: Infinity, reason: 'Не расслышала голос (слишком тихо или коротко). Команда не выполнена.' };
  const score = dist(p.v, t.mean, t.sd);
  return score <= t.distThreshold
    ? { ok: true, score }
    : { ok: false, score, reason: 'Голос не узнан: команды принимаются только от владельца. Команда не выполнена.' };
}

// ---------- хранение шаблона (только на устройстве) ----------
const KEY = 'svetlana_voiceprint_v1';
interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }
function storage(): KV | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }

const isNumArr = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every(x => typeof x === 'number' && Number.isFinite(x));

export function loadTemplate(s: KV | null = storage()): VoiceTemplate | null {
  try {
    const raw = s?.getItem(KEY);
    if (!raw || raw.length > 20_000) return null;
    const t = JSON.parse(raw) as Partial<VoiceTemplate>;
    const d = 2 * (N_CEP - 1);
    if (t?.version !== 1 || !isNumArr(t.mean, d) || !isNumArr(t.sd, d) || !(t.sd as number[]).every(x => x > 0)) return null;
    if (typeof t.distThreshold !== 'number' || !(t.distThreshold > 0 && t.distThreshold <= 2.5)) return null;
    return { version: 1, mean: t.mean as number[], sd: t.sd as number[], distThreshold: t.distThreshold, samples: Number(t.samples) || 0, createdAt: Number(t.createdAt) || 0 };
  } catch { return null; }
}
export function saveTemplate(t: VoiceTemplate, s: KV | null = storage()): void { s?.setItem(KEY, JSON.stringify(t)); }
export function deleteTemplate(s: KV | null = storage()): void { s?.removeItem?.(KEY); }
