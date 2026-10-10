// Эталоны упражнений по позе (MediaPipe Pose, 33 точки). Чистый ES-модуль без зависимостей:
// одинаково работает в ядре Светланы (Node) и в приложении «Я-Зарядка» (браузер/Capacitor).
// Эталон = средние кривые углов суставов за один повтор + допуски. Новое упражнение = новое видео, без нового кода.

export const JOINTS = {
  knee_l: [23, 25, 27], knee_r: [24, 26, 28], hip_l: [11, 23, 25], hip_r: [12, 24, 26],
  elbow_l: [11, 13, 15], elbow_r: [12, 14, 16], shoulder_l: [13, 11, 23], shoulder_r: [14, 12, 24],
};
export const JOINT_RU = { knee_l: "левое колено", knee_r: "правое колено", hip_l: "левое бедро", hip_r: "правое бедро", elbow_l: "левый локоть", elbow_r: "правый локоть", shoulder_l: "левое плечо", shoulder_r: "правое плечо", trunk: "корпус" };
const N = 24; // точек на кривой одного повтора

function angle(a, b, c) {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const d = Math.hypot(...v1) * Math.hypot(...v2); if (!d) return NaN;
  return (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180) / Math.PI;
}
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
/** Углы суставов одного кадра. lm — 33 точки [x, y, z?, visibility?] в долях кадра. */
export function frameAngles(lm) {
  const out = {};
  for (const [k, [a, b, c]] of Object.entries(JOINTS)) out[k] = (lm[a]?.[3] ?? 1) < 0.4 || (lm[b]?.[3] ?? 1) < 0.4 || (lm[c]?.[3] ?? 1) < 0.4 ? NaN : angle(lm[a], lm[b], lm[c]);
  const sh = mid(lm[11], lm[12]), hp = mid(lm[23], lm[24]);
  out.trunk = (Math.atan2(sh[0] - hp[0], hp[1] - sh[1]) * 180) / Math.PI; // наклон корпуса от вертикали
  return out;
}
/** Ряды углов по всем кадрам с заполнением пропусков и сглаживанием (как smoother(0.5) в «Я-Зарядке»). */
export function series(frames) {
  const keys = [...Object.keys(JOINTS), "trunk"], s = Object.fromEntries(keys.map((k) => [k, []]));
  const prev = {};
  for (const f of frames) { const a = frameAngles(f.lm); for (const k of keys) { let v = a[k]; if (!Number.isFinite(v)) v = prev[k] ?? 0; v = prev[k] === undefined ? v : prev[k] * 0.5 + v * 0.5; prev[k] = v; s[k].push(v); } }
  return { t: frames.map((f) => f.t), s };
}
const range = (a) => [Math.min(...a), Math.max(...a)];
function resample(a, n = N) { if (a.length === 1) return Array(n).fill(a[0]); return Array.from({ length: n }, (_, i) => { const x = (i * (a.length - 1)) / (n - 1), j = Math.floor(x), f = x - j; return a[j] * (1 - f) + (a[Math.min(j + 1, a.length - 1)] ?? a[j]) * f; }); }
/** Повторы по главному суставу: выход из исходной позы глубже 30% амплитуды и возврат ближе 20%.
 *  Неполные повторы тоже считаются — их амплитуда низкая, это и есть «присядь глубже». */
function segment(prim, t, lo, hi, minMs) {
  const span = hi - lo || 1, startHigh = Math.abs(prim[0] - hi) < Math.abs(prim[0] - lo); // исходная поза у края диапазона
  const depth = (v) => (startHigh ? (hi - v) / span : (v - lo) / span);
  const reps = []; let st = null, peak = 0;
  for (let i = 0; i < prim.length; i++) {
    const d = depth(prim[i]);
    if (d < 0.2) { if (st !== null && peak > 0.3 && t[i] - t[st] >= minMs) reps.push([st, i]); st = i; peak = 0; }
    else if (st !== null) peak = Math.max(peak, d);
  }
  return reps;
}

/** Создать эталон из записи упражнения. kind: "reps" (повторы) или "hold" (удержание позы). */
export function buildTemplate({ id, name, kind = "reps", frames, norms = [6, 8, 12], cue = "", minRepMs = 400 }) {
  if (!Array.isArray(frames) || frames.length < 15) throw new Error("нужно хотя бы 15 кадров позы");
  const { t, s } = series(frames);
  if (kind === "hold") {
    const keys = Object.keys(s), take = Math.floor(frames.length * 0.2); // середина записи: поза уже принята
    const pose = Object.fromEntries(keys.map((k) => { const a = s[k].slice(take, frames.length - take); return [k, a.reduce((x, y) => x + y, 0) / a.length]; }));
    return { v: 1, id, name, kind, cue, norms, pose, tol: Object.fromEntries(keys.map((k) => [k, 15])) };
  }
  const ranges = Object.fromEntries(Object.entries(s).map(([k, a]) => [k, range(a)]));
  const active = Object.keys(ranges).filter((k) => ranges[k][1] - ranges[k][0] >= 25 && k !== "trunk");
  if (!active.length) throw new Error("в записи нет заметного движения суставов (меньше 25°)");
  const primary = active.reduce((a, b) => (ranges[b][1] - ranges[b][0] > ranges[a][1] - ranges[a][0] ? b : a));
  const reps = segment(s[primary], t, ...ranges[primary], minRepMs);
  if (reps.length < 2) throw new Error(`в эталоне найден ${reps.length} повтор — запишите 3–5 чистых повторов`);
  const curve = {}, tol = {};
  for (const k of active) {
    const rs = reps.map(([a, b]) => resample(s[k].slice(a, b + 1)));
    curve[k] = Array.from({ length: N }, (_, i) => rs.reduce((x, r) => x + r[i], 0) / rs.length);
    const sd = Math.sqrt(rs.flatMap((r) => r.map((v, i) => (v - curve[k][i]) ** 2)).reduce((x, y) => x + y, 0) / (rs.length * N));
    tol[k] = Math.max(8, Math.round(sd * 2.5)); // допуск: разброс самого эталона, но не строже 8°
  }
  const durs = reps.map(([a, b]) => t[b] - t[a]);
  const span = reps.map(([a, b]) => { const [l, h] = range(s[primary].slice(a, b + 1)); return h - l; }).reduce((x, y) => x + y, 0) / reps.length;
  return { v: 1, id, name, kind, cue, norms, primary, active, range: ranges[primary], span: Math.round(span), curve, tol, repMs: Math.round(durs.reduce((x, y) => x + y, 0) / durs.length), minRepMs };
}

function dtw(a, b) {
  const n = a.length, m = b.length, D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity)); D[0][0] = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(1, i - 6); j <= Math.min(m, i + 6); j++) D[i][j] = Math.abs(a[i - 1] - b[j - 1]) + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
  return D[n][m] / Math.max(n, m);
}
/** Оценить попытку по эталону. Возвращает повторы в формате computeScore «Я-Зарядки»: { amp, form, dur } и коды ошибок. */
export function evaluate(tpl, frames) {
  const { t, s } = series(frames);
  if (tpl.kind === "hold") {
    let held = 0, worst = {};
    for (let i = 1; i < t.length; i++) {
      const off = Object.entries(tpl.pose).filter(([k, v]) => Math.abs(s[k][i] - v) > tpl.tol[k]);
      if (!off.length) held += t[i] - t[i - 1]; else for (const [k] of off) worst[k] = (worst[k] || 0) + 1;
    }
    const errors = Object.entries(worst).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => `${k}_off`);
    return { kind: "hold", seconds: Math.round(held / 100) / 10, errors };
  }
  const [lo, hi] = tpl.range, reps = segment(s[tpl.primary], t, lo, hi, tpl.minRepMs);
  const out = [], errs = [];
  for (const [a, b] of reps) {
    let dev = 0; const per = {};
    for (const k of tpl.active) { const d = dtw(resample(s[k].slice(a, b + 1)), tpl.curve[k]); per[k] = d; dev += d / tpl.tol[k]; }
    dev /= tpl.active.length;
    const [rl, rh] = range(s[tpl.primary].slice(a, b + 1)), amp = Math.min(100, Math.round(((rh - rl) / (tpl.span || hi - lo || 1)) * 100));
    const form = Math.max(0, Math.min(100, Math.round(100 * Math.exp(-0.6 * Math.max(0, dev - 0.5)))));
    out.push({ amp, form, dur: t[b] - t[a] });
    if (amp < 70) errs.push("shallow");
    const bad = Object.entries(per).filter(([k, d]) => d > tpl.tol[k] * 1.5).sort((x, y) => y[1] / tpl.tol[y[0]] - x[1] / tpl.tol[x[0]])[0];
    if (bad) errs.push(`${bad[0]}_off`);
  }
  return { kind: "reps", reps: out, errors: errs };
}
/** Текст подсказки по коду ошибки эталонного упражнения. */
export function hintFor(code, tpl) {
  if (code === "shallow") return "Делай движение шире, как в эталоне.";
  const j = code.replace(/_off$/, ""); return `Следи за суставом: ${JOINT_RU[j] || j}${tpl?.cue ? `. ${tpl.cue}` : ""}.`;
}
