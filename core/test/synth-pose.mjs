// синтетические приседания: колени и бёдра сгибаются синусом
export function squat({ reps = 4, depth = 1, ms = 1200, fps = 30, wobble = 0, arms = 0 }) {
  const frames = []; const total = reps * ms;
  for (let t = 0; t <= total + 400; t += 1000 / fps) {
    const ph = t < total ? (1 - Math.cos((2 * Math.PI * t) / ms)) / 2 : 0; const k = ph * depth;
    const lm = Array.from({ length: 33 }, () => [0.5, 0.5, 0, 1]);
    const hipY = 0.55 + 0.15 * k, kneeX = 0.5 + 0.12 * k;
    lm[11] = [0.45, 0.3 + 0.12 * k, 0, 1]; lm[12] = [0.55 + wobble * Math.sin(t / 90), 0.3 + 0.12 * k, 0, 1];
    lm[23] = [0.46, hipY, 0, 1]; lm[24] = [0.54, hipY, 0, 1];
    lm[25] = [0.46 + 0.12 * k, 0.72, 0, 1]; lm[26] = [0.54 + 0.12 * k, 0.72, 0, 1];
    lm[27] = [0.46, 0.9, 0, 1]; lm[28] = [0.54, 0.9, 0, 1];
    lm[13] = [0.42, 0.42, 0, 1]; lm[14] = [0.58, 0.42, 0, 1]; lm[15] = [0.42 + 0.12 * arms * ph, 0.52 - 0.05 * arms * ph, 0, 1]; lm[16] = [0.58 - 0.12 * arms * ph, 0.52 - 0.05 * arms * ph, 0, 1]; // руки сгибаются к груди
    frames.push({ t: Math.round(t), lm });
  }
  return frames;
}
