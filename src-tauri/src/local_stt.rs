//! Локальное распознавание речи для проверки голоса цифрами: GigaAM-v3 CTC (int8, ONNX, лицензия MIT).
//!
//! Зачем: при проверке «скажите цифры» текст и отпечаток голоса должны браться из ОДНОЙ записи.
//! Встроенное распознавание браузера слушает микрофон само и чужую запись не принимает, а облако
//! означает отправку голоса наружу. Здесь распознаётся ровно тот звук, который передал фронтенд,
//! и он никуда не уходит.
//!
//! Безопасность:
//! - модель скачивается только после подтверждения в НАТИВНОМ окне Windows (скрипт на странице не
//!   может нажать его сам), только по https и только с серверов Hugging Face;
//! - файл проверяется по SHA-256 после загрузки и ещё раз при каждой загрузке в память; проверяются
//!   и исполняются одни и те же байты (из памяти), подменить файл между проверкой и загрузкой нельзя;
//! - размер, длина звука и частота запросов ограничены.

use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const MODEL_URL: &str = "https://huggingface.co/istupakov/gigaam-v3-onnx/resolve/main/v3_ctc.int8.onnx";
const MODEL_SHA256: &str = "ceb61454e2e1a2dec5872cbac1de0fe0a4271d1148f6b26b5bda53ff30a12acd";
const MODEL_FILE: &str = "gigaam-v3-ctc.int8.onnx";
const MODEL_SIZE_MB: u32 = 225;
const MAX_MODEL_BYTES: u64 = 400 * 1024 * 1024;

const SAMPLE_RATE: usize = 16_000;
const N_FFT: usize = 320; // окно 20 мс
const HOP: usize = 160; // шаг 10 мс
const N_BINS: usize = N_FFT / 2 + 1;
const N_MELS: usize = 64;
const MAX_SECONDS: usize = 15;
const CLASSES: usize = 34; // пробел, а..я (32 буквы), пустой символ CTC
const BLANK: usize = 33;
const TRANSCRIBE_PER_MINUTE: usize = 20;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttStatus {
    installed: bool,
    downloading: bool,
    downloaded: u64,
    total: u64,
    error: Option<String>,
    size_mb: u32,
}

struct Progress {
    downloaded: u64,
    total: u64,
    error: Option<String>,
}

struct Engine {
    session: ort::session::Session,
    dsp: Dsp,
}

static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static PROGRESS: Mutex<Progress> = Mutex::new(Progress { downloaded: 0, total: 0, error: None });
static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);
static CALLS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());

fn rate_ok(max: usize) -> bool {
    let mut q = CALLS.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    while let Some(t) = q.front() {
        if now.duration_since(*t) > Duration::from_secs(60) {
            q.pop_front();
        } else {
            break;
        }
    }
    if q.len() >= max {
        return false;
    }
    q.push_back(now);
    true
}

fn set_progress(downloaded: u64, total: u64, error: Option<String>) {
    let mut p = PROGRESS.lock().unwrap_or_else(|e| e.into_inner());
    p.downloaded = downloaded;
    p.total = total;
    p.error = error;
}

async fn confirm(app: &AppHandle, text: String) -> bool {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(text)
            .title("Светлана — подтверждение")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show()
    })
    .await
    .unwrap_or(false)
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("models").join(MODEL_FILE))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Скачивать можно только с серверов Hugging Face (основной адрес и его хранилища файлов).
fn allowed_host(host: &str) -> bool {
    host == "huggingface.co" || host.ends_with(".huggingface.co") || host == "hf.co" || host.ends_with(".hf.co")
}

/// Состояние модели: установлена ли, идёт ли загрузка и сколько скачано.
#[tauri::command]
pub fn local_stt_status(app: AppHandle) -> Result<SttStatus, String> {
    let installed = model_path(&app)?.is_file();
    let p = PROGRESS.lock().unwrap_or_else(|e| e.into_inner());
    Ok(SttStatus {
        installed,
        downloading: DOWNLOADING.load(Ordering::SeqCst),
        downloaded: p.downloaded,
        total: p.total,
        error: p.error.clone(),
        size_mb: MODEL_SIZE_MB,
    })
}

/// Скачать модель (только после подтверждения в нативном окне).
#[tauri::command]
pub async fn local_stt_install(app: AppHandle) -> Result<(), String> {
    let path = model_path(&app)?;
    if path.is_file() {
        return Ok(());
    }
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Err("Модель уже скачивается".into());
    }
    let question = format!(
        "Скачать модель распознавания речи GigaAM-v3 (около {MODEL_SIZE_MB} МБ) с Hugging Face?\n\nПосле этого цифры для проверки голоса распознаются прямо на компьютере: запись никуда не отправляется."
    );
    let result = if confirm(&app, question).await {
        set_progress(0, 0, None);
        download(&path).await
    } else {
        Err("Отменено пользователем".to_string())
    };
    if let Err(e) = &result {
        let p = PROGRESS.lock().unwrap_or_else(|x| x.into_inner()).downloaded;
        set_progress(p, 0, Some(e.clone()));
    }
    DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

async fn download(path: &Path) -> Result<(), String> {
    let dir = path.parent().ok_or("Некорректный путь к модели")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let part = path.with_extension("part");
    let result = download_to(&part).await.and_then(|digest| {
        if digest != MODEL_SHA256 {
            return Err("Файл модели не прошёл проверку подлинности (SHA-256). Загрузка отменена.".to_string());
        }
        std::fs::rename(&part, path).map_err(|e| e.to_string())
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    result
}

/// Скачивает файл в `part`, возвращает SHA-256 скачанного.
async fn download_to(part: &Path) -> Result<String, String> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("Слишком много перенаправлений");
        }
        let url = attempt.url();
        if url.scheme() == "https" && url.host_str().map_or(false, allowed_host) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60 * 60))
        .redirect(policy)
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(MODEL_URL).send().await.map_err(|e| e.without_url().to_string())?;
    if !response.status().is_success() {
        return Err(format!("Сервер с моделью ответил кодом {}", response.status().as_u16()));
    }
    let total = response.content_length().unwrap_or(0);
    if total > MAX_MODEL_BYTES {
        return Err("Файл модели больше ожидаемого".into());
    }
    let mut file = std::fs::File::create(part).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut got: u64 = 0;
    set_progress(0, total, None);
    while let Some(chunk) = response.chunk().await.map_err(|e| e.without_url().to_string())? {
        got += chunk.len() as u64;
        if got > MAX_MODEL_BYTES {
            return Err("Файл модели больше ожидаемого".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        set_progress(got, total, None);
    }
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(hex(&hasher.finalize()))
}

/// Удалить модель (после подтверждения в нативном окне).
#[tauri::command]
pub async fn local_stt_remove(app: AppHandle) -> Result<(), String> {
    let path = model_path(&app)?;
    if !path.is_file() {
        return Ok(());
    }
    if DOWNLOADING.load(Ordering::SeqCst) {
        return Err("Дождитесь окончания загрузки".into());
    }
    if !confirm(&app, "Удалить модель распознавания речи с компьютера?".into()).await {
        return Err("Отменено пользователем".into());
    }
    *ENGINE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Распознать переданный звук (моно, -1..1) на компьютере. Возвращает текст строчными буквами.
#[tauri::command]
pub async fn local_stt_transcribe(app: AppHandle, pcm: Vec<f32>, sample_rate: u32) -> Result<String, String> {
    if !(8_000..=96_000).contains(&sample_rate) {
        return Err("Неподдерживаемая частота звука".into());
    }
    if pcm.is_empty() || pcm.len() > sample_rate as usize * MAX_SECONDS {
        return Err("Запись пустая или слишком длинная".into());
    }
    if pcm.iter().any(|x| !x.is_finite()) {
        return Err("Некорректная запись".into());
    }
    if !rate_ok(TRANSCRIBE_PER_MINUTE) {
        return Err("Слишком много запросов распознавания, подождите минуту".into());
    }
    let path = model_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || transcribe_blocking(&path, &pcm, sample_rate as usize))
        .await
        .map_err(|e| e.to_string())?
}

fn load_engine(path: &Path) -> Result<Engine, String> {
    let bytes = std::fs::read(path).map_err(|_| "Модель распознавания не установлена".to_string())?;
    if hex(&Sha256::digest(&bytes)) != MODEL_SHA256 {
        return Err("Файл модели повреждён или подменён. Удалите его и скачайте заново.".into());
    }
    let session = ort::session::Session::builder()
        .map_err(|e| e.to_string())?
        .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
        .map_err(|e| e.to_string())?
        .with_intra_threads(4)
        .map_err(|e| e.to_string())?
        .commit_from_memory(&bytes)
        .map_err(|e| e.to_string())?;
    Ok(Engine { session, dsp: Dsp::new() })
}

fn transcribe_blocking(path: &Path, pcm: &[f32], sample_rate: usize) -> Result<String, String> {
    let audio = resample(pcm, sample_rate);
    if audio.len() < N_FFT {
        return Ok(String::new());
    }
    let mut guard = ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(load_engine(path)?);
    }
    let engine = guard.as_mut().ok_or("Модель не загружена")?;
    let (features, frames) = engine.dsp.features(&audio);
    let input = ort::value::Tensor::from_array(([1usize, N_MELS, frames], features)).map_err(|e| e.to_string())?;
    let lens = ort::value::Tensor::from_array(([1usize], vec![frames as i64])).map_err(|e| e.to_string())?;
    let outputs = engine
        .session
        .run(ort::inputs!["features" => input, "feature_lengths" => lens])
        .map_err(|e| e.to_string())?;
    let (shape, data) = outputs["log_probs"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    let dims: Vec<i64> = shape.iter().copied().collect();
    if dims.len() != 3 || dims[0] != 1 || dims[2] != CLASSES as i64 || dims[1] < 0 {
        return Err("Неожиданный ответ модели".into());
    }
    let steps = dims[1] as usize;
    if data.len() < steps * CLASSES {
        return Err("Неожиданный ответ модели".into());
    }
    Ok(ctc_decode(data, steps))
}

/// Приведение к 16 кГц: сглаживание (против наложения частот) и линейная интерполяция.
fn resample(pcm: &[f32], sample_rate: usize) -> Vec<f32> {
    if sample_rate == SAMPLE_RATE {
        return pcm.to_vec();
    }
    let source: Vec<f32> = if sample_rate > SAMPLE_RATE {
        let w = ((sample_rate as f64 / SAMPLE_RATE as f64).round() as usize).max(1);
        let half = w / 2;
        (0..pcm.len())
            .map(|i| {
                let a = i.saturating_sub(half);
                let b = (i + w - half).min(pcm.len());
                pcm[a..b].iter().sum::<f32>() / (b - a) as f32
            })
            .collect()
    } else {
        pcm.to_vec()
    };
    let ratio = sample_rate as f64 / SAMPLE_RATE as f64;
    let n = ((source.len() as f64) / ratio).floor() as usize;
    (0..n)
        .map(|i| {
            let x = i as f64 * ratio;
            let j = x.floor() as usize;
            let f = (x - j as f64) as f32;
            let a = source[j.min(source.len() - 1)];
            let b = source[(j + 1).min(source.len() - 1)];
            a + (b - a) * f
        })
        .collect()
}

/// Округление до bfloat16, как в эталонной предобработке GigaAM v3.
fn bf16(x: f32) -> f32 {
    let b = x.to_bits();
    let rounded = b.wrapping_add(0x7FFF + ((b >> 16) & 1));
    f32::from_bits(rounded & 0xFFFF_0000)
}

fn hz_to_mel(f: f64) -> f64 {
    2595.0 * (1.0 + f / 700.0).log10()
}

fn mel_to_hz(m: f64) -> f64 {
    700.0 * (10f64.powf(m / 2595.0) - 1.0)
}

/// Лог-мел спектрограмма GigaAM v3: окно Ханна 320, шаг 160, 64 мел-фильтра (HTK, 0..8000 Гц), без центрирования.
struct Dsp {
    window: Vec<f32>,
    cos: Vec<f32>,
    sin: Vec<f32>,
    fbank: Vec<f32>, // [N_BINS][N_MELS]
}

impl Dsp {
    fn new() -> Self {
        let window: Vec<f32> = (0..N_FFT)
            .map(|n| bf16((0.5 - 0.5 * (2.0 * std::f64::consts::PI * n as f64 / N_FFT as f64).cos()) as f32))
            .collect();
        let mut cos = vec![0f32; N_BINS * N_FFT];
        let mut sin = vec![0f32; N_BINS * N_FFT];
        for k in 0..N_BINS {
            for n in 0..N_FFT {
                let a = 2.0 * std::f64::consts::PI * ((k * n) % N_FFT) as f64 / N_FFT as f64;
                cos[k * N_FFT + n] = a.cos() as f32;
                sin[k * N_FFT + n] = a.sin() as f32;
            }
        }
        Dsp { window, cos, sin, fbank: mel_fbank() }
    }

    /// Признаки [64][T] (по строкам мел-фильтров) и число кадров T.
    fn features(&self, audio: &[f32]) -> (Vec<f32>, usize) {
        let frames = (audio.len() - N_FFT) / HOP + 1;
        let mut out = vec![0f32; N_MELS * frames];
        let mut frame = [0f32; N_FFT];
        let mut power = [0f32; N_BINS];
        for t in 0..frames {
            let off = t * HOP;
            for n in 0..N_FFT {
                frame[n] = audio[off + n] * self.window[n];
            }
            for k in 0..N_BINS {
                let (c, s) = (&self.cos[k * N_FFT..(k + 1) * N_FFT], &self.sin[k * N_FFT..(k + 1) * N_FFT]);
                let mut re = 0f32;
                let mut im = 0f32;
                for n in 0..N_FFT {
                    re += frame[n] * c[n];
                    im -= frame[n] * s[n];
                }
                power[k] = re * re + im * im;
            }
            for m in 0..N_MELS {
                let mut e = 0f32;
                for k in 0..N_BINS {
                    e += power[k] * self.fbank[k * N_MELS + m];
                }
                out[m * frames + t] = e.clamp(1e-9, 1e9).ln();
            }
        }
        (out, frames)
    }
}

/// Мел-фильтры как torchaudio.functional.melscale_fbanks(161, 0, 8000, 64, 16000, norm=None, mel_scale="htk").
fn mel_fbank() -> Vec<f32> {
    let m_min = hz_to_mel(0.0);
    let m_max = hz_to_mel(8000.0);
    let f_pts: Vec<f64> = (0..N_MELS + 2)
        .map(|i| mel_to_hz(m_min + (m_max - m_min) * i as f64 / (N_MELS + 1) as f64))
        .collect();
    let mut fb = vec![0f32; N_BINS * N_MELS];
    for k in 0..N_BINS {
        let f = 8000.0 * k as f64 / (N_BINS - 1) as f64;
        for m in 0..N_MELS {
            let down = (f - f_pts[m]) / (f_pts[m + 1] - f_pts[m]);
            let up = (f_pts[m + 2] - f) / (f_pts[m + 2] - f_pts[m + 1]);
            fb[k * N_MELS + m] = bf16(down.min(up).max(0.0) as f32);
        }
    }
    fb
}

fn token(i: usize) -> Option<char> {
    match i {
        0 => Some(' '),
        1..=32 => char::from_u32(0x0430 + i as u32 - 1),
        _ => None,
    }
}

/// Жадное CTC-декодирование: лучший класс на шаг, повторы схлопываются, пустой символ убирается.
fn ctc_decode(log_probs: &[f32], steps: usize) -> String {
    let mut text = String::new();
    let mut prev = usize::MAX;
    for t in 0..steps {
        let row = &log_probs[t * CLASSES..(t + 1) * CLASSES];
        let mut best = 0;
        for c in 1..CLASSES {
            if row[c] > row[best] {
                best = c;
            }
        }
        if best != prev && best != BLANK {
            if let Some(ch) = token(best) {
                text.push(ch);
            }
        }
        prev = best;
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ctc_collapses_repeats_and_blanks() {
        let mut lp = vec![-10f32; 6 * CLASSES];
        let pick = |lp: &mut Vec<f32>, t: usize, c: usize| lp[t * CLASSES + c] = 0.0;
        // «д», «д», пусто, «в», пробел, «а» -> «дв а»
        pick(&mut lp, 0, 5);
        pick(&mut lp, 1, 5);
        pick(&mut lp, 2, BLANK);
        pick(&mut lp, 3, 3);
        pick(&mut lp, 4, 0);
        pick(&mut lp, 5, 1);
        assert_eq!(ctc_decode(&lp, 6), "дв а");
        assert_eq!(token(32), Some('я'));
        assert_eq!(token(33), None);
    }

    #[test]
    fn features_shape_and_frames() {
        let dsp = Dsp::new();
        let audio: Vec<f32> = (0..16_000).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
        let (f, t) = dsp.features(&audio);
        assert_eq!(t, (16_000 - 320) / 160 + 1);
        assert_eq!(f.len(), 64 * t);
        assert!(f.iter().all(|x| x.is_finite()));
    }

    #[test]
    fn mel_filters_cover_spectrum() {
        let fb = mel_fbank();
        for m in 0..N_MELS {
            assert!((0..N_BINS).any(|k| fb[k * N_MELS + m] > 0.0));
        }
    }

    #[test]
    fn resample_to_16k() {
        assert_eq!(resample(&vec![0.1; 48_000], 48_000).len(), 16_000);
        assert_eq!(resample(&vec![0.1; 8_000], 8_000).len(), 16_000);
        assert!(allowed_host("cas-bridge.xethub.hf.co"));
        assert!(allowed_host("huggingface.co"));
        assert!(!allowed_host("evil-huggingface.co"));
        assert!(!allowed_host("huggingface.co.evil.com"));
    }
}
