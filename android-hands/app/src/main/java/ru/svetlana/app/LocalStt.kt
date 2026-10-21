package ru.svetlana.app

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * Распознавание речи на самом телефоне: та же модель GigaAM-v3 CTC (int8, ONNX, MIT) и та же обработка, что в
 * версии для Windows (src-tauri/src/local_stt.rs). Распознаётся ровно тот звук, который передала страница
 * (та же запись, по которой сверяется голос), и он никуда не уходит.
 *
 * Модель скачивается только после нативного подтверждения, только по https и только с Hugging Face
 * (каждое перенаправление проверяется), сверяется по SHA-256 после загрузки и перед каждой загрузкой
 * в память; файл лежит в закрытой папке приложения (писать туда может только само приложение).
 * Размер, длина звука и частота запросов ограничены. Загрузку можно остановить (cancelInstall: соединение
 * рвётся, недокачанный файл удаляется), а загруженную в память модель отпустить (release, при закрытии экрана).
 * Вся загрузка ограничена по времени (MAX_DOWNLOAD_MS): сервер, который отдаёт по байту раз в минуту, не держит
 * загрузку вечно: таймаут чтения не больше оставшегося времени, срок проверяется на каждом куске.
 */
object LocalStt {
    private const val MODEL_URL = "https://huggingface.co/istupakov/gigaam-v3-onnx/resolve/main/v3_ctc.int8.onnx"
    const val MODEL_SHA256 = "ceb61454e2e1a2dec5872cbac1de0fe0a4271d1148f6b26b5bda53ff30a12acd"
    private const val MODEL_FILE = "gigaam-v3-ctc.int8.onnx"
    const val MODEL_SIZE_MB = 225
    private const val MAX_MODEL_BYTES = 400L * 1024 * 1024
    /** Вся загрузка модели не дольше часа (225 МБ даже на медленном интернете укладываются). */
    private const val MAX_DOWNLOAD_MS = 60L * 60 * 1000
    private const val READ_TIMEOUT_MS = 60_000L
    const val DOWNLOAD_TIMEOUT = "Модель скачивается слишком долго (больше часа). Проверьте интернет (лучше Wi‑Fi) и попробуйте ещё раз."
    private const val SAMPLE_RATE = 16_000
    private const val N_FFT = 320
    private const val HOP = 160
    private const val N_BINS = N_FFT / 2 + 1
    private const val N_MELS = 64
    const val MAX_SECONDS = 15
    private const val CLASSES = 34
    private const val BLANK = 33
    private const val TRANSCRIBE_PER_MINUTE = 20
    private const val UNEXPECTED = "Неожиданный ответ модели"
    const val INSTALL_STOPPED = "Загрузка модели остановлена"

    private val downloading = AtomicBoolean(false)
    @Volatile private var downloaded = 0L
    @Volatile private var total = 0L
    @Volatile private var error: String? = null
    /** Человек нажал «Остановить загрузку». */
    @Volatile private var cancel = false
    /** Текущее соединение загрузки: его рвём при остановке, чтобы не ждать очередного куска. */
    @Volatile private var activeConn: HttpURLConnection? = null
    private val engineLock = Any()
    private var session: OrtSession? = null
    private val dsp by lazy { Dsp() }
    private val calls = ArrayDeque<Long>()

    private fun modelFile(ctx: Context) = File(File(ctx.filesDir, "models"), MODEL_FILE)

    fun status(ctx: Context): JSONObject = JSONObject()
        .put("installed", modelFile(ctx).isFile)
        .put("downloading", downloading.get())
        .put("downloaded", downloaded)
        .put("total", total)
        .put("error", error ?: JSONObject.NULL)
        .put("sizeMb", MODEL_SIZE_MB)

    /** Скачать модель (только после подтверждения). Блокирует поток до конца загрузки. */
    fun install(ctx: Context, confirm: (String) -> Boolean) {
        val f = modelFile(ctx)
        if (f.isFile) return
        if (!downloading.compareAndSet(false, true)) throw SecureAi.Fail("Модель уже скачивается")
        try {
            val q = "Скачать модель распознавания речи GigaAM-v3 (около $MODEL_SIZE_MB МБ) с Hugging Face?\n\n" +
                "После этого цифры для проверки голоса и команды распознаются прямо на телефоне: запись никуда не отправляется. Лучше по Wi‑Fi."
            if (!confirm(q)) throw SecureAi.Fail(SecureAi.CANCELLED)
            cancel = false
            downloaded = 0
            total = 0
            error = null
            download(f)
        } catch (e: Exception) {
            error = (e.message ?: "Ошибка загрузки").take(300)
            throw e
        } finally {
            cancel = false
            activeConn = null
            downloading.set(false)
        }
    }

    /** Остановить идущую загрузку (без подтверждения: на диске ничего не меняется). true, если загрузка шла. */
    fun cancelInstall(): Boolean {
        if (!downloading.get()) return false
        cancel = true
        runCatching { activeConn?.disconnect() }
        return true
    }

    /** Отпустить модель из памяти (экран закрыт): дожидается идущего распознавания. Вызывать не из главного потока. */
    fun release() {
        synchronized(engineLock) {
            runCatching { session?.close() }
            session = null
        }
    }

    private fun allowedHost(h: String) =
        h == "huggingface.co" || h.endsWith(".huggingface.co") || h == "hf.co" || h.endsWith(".hf.co")

    private fun stopIfCancelled() {
        if (cancel) throw SecureAi.Fail(INSTALL_STOPPED)
    }

    /** Сколько миллисекунд осталось до срока; срок вышел — ошибка DOWNLOAD_TIMEOUT. */
    private fun timeLeft(deadline: Long): Long {
        val left = deadline - System.currentTimeMillis()
        if (left <= 0) throw SecureAi.Fail(DOWNLOAD_TIMEOUT)
        return left
    }

    private fun download(dest: File) {
        val dir = dest.parentFile ?: throw SecureAi.Fail("Некорректный путь к модели")
        dir.mkdirs()
        val part = File(dir, "$MODEL_FILE.part")
        val deadline = System.currentTimeMillis() + MAX_DOWNLOAD_MS
        try {
            var url = URL(MODEL_URL)
            var hops = 0
            var conn: HttpURLConnection
            while (true) {
                stopIfCancelled()
                val left = timeLeft(deadline)
                if (url.protocol != "https" || !allowedHost(url.host.lowercase())) {
                    throw SecureAi.Fail("Модель можно скачать только с Hugging Face по https")
                }
                conn = url.openConnection() as HttpURLConnection
                activeConn = conn
                conn.instanceFollowRedirects = false
                conn.connectTimeout = min(20_000L, left).toInt()
                conn.readTimeout = min(READ_TIMEOUT_MS, left).toInt()
                conn.setRequestProperty("User-Agent", "Svetlana-Android")
                val code = conn.responseCode
                if (code in 300..399) {
                    val loc = conn.getHeaderField("Location")
                    conn.disconnect()
                    if (loc == null || ++hops > 5) throw SecureAi.Fail("Сервер с моделью ответил непонятно (перенаправление)")
                    url = URL(url, loc)
                    continue
                }
                if (code != 200) {
                    conn.disconnect()
                    throw SecureAi.Fail("Сервер с моделью ответил кодом $code")
                }
                break
            }
            try {
                val len = conn.contentLengthLong
                if (len > MAX_MODEL_BYTES) throw SecureAi.Fail("Файл модели больше ожидаемого")
                total = max(len, 0L)
                val md = MessageDigest.getInstance("SHA-256")
                var got = 0L
                val inp = conn.inputStream
                val out = part.outputStream()
                try {
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        stopIfCancelled()
                        // Каждое чтение ждёт не дольше, чем осталось до срока всей загрузки.
                        conn.readTimeout = min(READ_TIMEOUT_MS, timeLeft(deadline)).toInt()
                        val n = inp.read(buf)
                        if (n < 0) break
                        got += n
                        if (got > MAX_MODEL_BYTES) throw SecureAi.Fail("Файл модели больше ожидаемого")
                        md.update(buf, 0, n)
                        out.write(buf, 0, n)
                        downloaded = got
                    }
                    stopIfCancelled()
                    out.fd.sync()
                } finally {
                    runCatching { out.close() }
                    runCatching { inp.close() }
                }
                if (hex(md.digest()) != MODEL_SHA256) {
                    throw SecureAi.Fail("Файл модели не прошёл проверку подлинности (SHA-256). Загрузка отменена.")
                }
                if (!part.renameTo(dest)) throw SecureAi.Fail("Не удалось сохранить модель")
            } finally {
                conn.disconnect()
            }
        } catch (e: SecureAi.Fail) {
            throw e
        } catch (e: java.io.IOException) {
            // Соединение оборвали мы сами (кнопка «Остановить»): это не «нет связи».
            if (cancel) throw SecureAi.Fail(INSTALL_STOPPED)
            // Чтение оборвалось по общему сроку загрузки.
            if (System.currentTimeMillis() >= deadline) throw SecureAi.Fail(DOWNLOAD_TIMEOUT)
            throw SecureAi.Fail("Нет связи с Hugging Face: проверьте интернет и попробуйте ещё раз")
        } finally {
            if (part.exists()) part.delete()
        }
    }

    /** Удалить модель (с подтверждением). */
    fun remove(ctx: Context, confirm: (String) -> Boolean) {
        val f = modelFile(ctx)
        if (!f.isFile) return
        if (downloading.get()) throw SecureAi.Fail("Дождитесь окончания загрузки")
        if (!confirm("Удалить модель распознавания речи с телефона?")) throw SecureAi.Fail(SecureAi.CANCELLED)
        release()
        if (!f.delete()) throw SecureAi.Fail("Не удалось удалить модель")
    }

    /** PCM 16 бит (little-endian, base64) в отсчёты -1..1. Запись нечётной длины — ошибка, а не обрезка. */
    fun decodePcm16(b64: String): FloatArray {
        val bytes = try { Base64.decode(b64, Base64.NO_WRAP) } catch (e: IllegalArgumentException) { throw SecureAi.Fail("Некорректная запись") }
        if (bytes.size % 2 != 0) throw SecureAi.Fail("Некорректная запись")
        val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val out = FloatArray(bytes.size / 2)
        for (i in out.indices) out[i] = bb.getShort(i * 2) / 32768f
        return out
    }

    private fun rateOk(): Boolean = synchronized(calls) {
        val now = System.currentTimeMillis()
        while (calls.isNotEmpty() && now - calls.first() > 60_000) calls.removeFirst()
        if (calls.size >= TRANSCRIBE_PER_MINUTE) return false
        calls.addLast(now)
        true
    }

    /** Распознать переданный звук (моно). Текст строчными буквами. Вызывать не из главного потока. */
    fun transcribe(ctx: Context, pcm: FloatArray, sampleRate: Int): String {
        if (sampleRate !in 8_000..96_000) throw SecureAi.Fail("Неподдерживаемая частота звука")
        if (pcm.isEmpty() || pcm.size > sampleRate * MAX_SECONDS) throw SecureAi.Fail("Запись пустая или слишком длинная")
        if (!rateOk()) throw SecureAi.Fail("Слишком много запросов распознавания, подождите минуту")
        val audio = resample(pcm, sampleRate)
        if (audio.size < N_FFT) return ""
        synchronized(engineLock) {
            val s = session ?: load(ctx).also { session = it }
            val (features, frames) = dsp.features(audio)
            val env = OrtEnvironment.getEnvironment()
            val input = OnnxTensor.createTensor(env, FloatBuffer.wrap(features), longArrayOf(1, N_MELS.toLong(), frames.toLong()))
            val lens = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(frames.toLong())), longArrayOf(1))
            try {
                val r = s.run(mapOf("features" to input, "feature_lengths" to lens))
                try {
                    // Без падения, если в ответе модели нет такого выхода.
                    val v = r.get("log_probs").orElse(null) as? OnnxTensor ?: throw SecureAi.Fail(UNEXPECTED)
                    val shape = v.info.shape
                    if (shape.size != 3 || shape[0] != 1L || shape[2] != CLASSES.toLong() || shape[1] < 0) throw SecureAi.Fail(UNEXPECTED)
                    val steps = shape[1].toInt()
                    val fb = v.floatBuffer
                    if (fb.remaining() < steps * CLASSES) throw SecureAi.Fail(UNEXPECTED)
                    val data = FloatArray(steps * CLASSES)
                    fb.get(data)
                    return ctcDecode(data, steps)
                } finally {
                    r.close()
                }
            } finally {
                input.close()
                lens.close()
            }
        }
    }

    private fun load(ctx: Context): OrtSession {
        val f = modelFile(ctx)
        if (!f.isFile) throw SecureAi.Fail("Модель распознавания не установлена")
        val md = MessageDigest.getInstance("SHA-256")
        val inp = FileInputStream(f)
        try {
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = inp.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        } finally {
            inp.close()
        }
        if (hex(md.digest()) != MODEL_SHA256) {
            // Повреждённый файл убираем, иначе статус вечно показывает «установлена».
            f.delete()
            throw SecureAi.Fail("Файл модели был повреждён и удалён. Скачайте модель заново.")
        }
        val opts = OrtSession.SessionOptions()
        opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        opts.setIntraOpNumThreads(4)
        return OrtEnvironment.getEnvironment().createSession(f.absolutePath, opts)
    }

    private fun hex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }

    /** Приведение к 16 кГц: windowed-sinc с окном Блэкмана (как в local_stt.rs). */
    fun resample(pcm: FloatArray, sampleRate: Int): FloatArray {
        if (sampleRate == SAMPLE_RATE || pcm.isEmpty()) return pcm.copyOf()
        val ratio = sampleRate.toDouble() / SAMPLE_RATE
        val cutoff = 0.5 * min(SAMPLE_RATE.toDouble() / sampleRate, 1.0) * 0.94
        val half = ceil(8.0 / cutoff).toLong()
        val last = pcm.size.toLong() - 1
        val n = floor(pcm.size / ratio).toInt()
        val out = FloatArray(n)
        for (i in 0 until n) {
            val t = i * ratio
            val c = floor(t).toLong()
            var acc = 0.0
            var ws = 0.0
            val from = max(c - half + 1, 0L)
            val to = min(c + half, last)
            var j = from
            while (j <= to) {
                val x = j - t
                if (abs(x) < half) {
                    val a = 2.0 * cutoff * x
                    val s = if (abs(a) < 1e-12) 1.0 else sin(PI * a) / (PI * a)
                    val u = x / half
                    val w = 0.42 + 0.5 * cos(PI * u) + 0.08 * cos(2.0 * PI * u)
                    val k = s * w
                    acc += pcm[j.toInt()] * k
                    ws += k
                }
                j++
            }
            out[i] = if (abs(ws) > 1e-9) (acc / ws).toFloat() else 0f
        }
        return out
    }

    /** Округление до bfloat16, как в эталонной предобработке GigaAM v3. */
    private fun bf16(x: Float): Float {
        val b = java.lang.Float.floatToRawIntBits(x)
        val r = b + (0x7FFF + ((b ushr 16) and 1))
        return java.lang.Float.intBitsToFloat(r and 0xFFFF0000.toInt())
    }

    private fun hzToMel(f: Double) = 2595.0 * log10(1.0 + f / 700.0)
    private fun melToHz(m: Double) = 700.0 * (10.0.pow(m / 2595.0) - 1.0)

    /** Лог-мел спектрограмма GigaAM v3: окно Ханна 320, шаг 160, 64 мел-фильтра (HTK, 0..8000 Гц). */
    private class Dsp {
        val window = FloatArray(N_FFT) { n -> bf16((0.5 - 0.5 * cos(2.0 * PI * n / N_FFT)).toFloat()) }
        val cosT = FloatArray(N_BINS * N_FFT)
        val sinT = FloatArray(N_BINS * N_FFT)
        val fbank = melFbank()

        init {
            for (k in 0 until N_BINS) for (n in 0 until N_FFT) {
                val a = 2.0 * PI * ((k * n) % N_FFT) / N_FFT
                cosT[k * N_FFT + n] = cos(a).toFloat()
                sinT[k * N_FFT + n] = sin(a).toFloat()
            }
        }

        fun features(audio: FloatArray): Pair<FloatArray, Int> {
            val frames = (audio.size - N_FFT) / HOP + 1
            val out = FloatArray(N_MELS * frames)
            val frame = FloatArray(N_FFT)
            val power = FloatArray(N_BINS)
            for (t in 0 until frames) {
                val off = t * HOP
                for (n in 0 until N_FFT) frame[n] = audio[off + n] * window[n]
                for (k in 0 until N_BINS) {
                    var re = 0f
                    var im = 0f
                    val base = k * N_FFT
                    for (n in 0 until N_FFT) {
                        re += frame[n] * cosT[base + n]
                        im -= frame[n] * sinT[base + n]
                    }
                    power[k] = re * re + im * im
                }
                for (m in 0 until N_MELS) {
                    var e = 0f
                    for (k in 0 until N_BINS) e += power[k] * fbank[k * N_MELS + m]
                    out[m * frames + t] = ln(e.coerceIn(1e-9f, 1e9f))
                }
            }
            return out to frames
        }

        private fun melFbank(): FloatArray {
            val mMin = hzToMel(0.0)
            val mMax = hzToMel(8000.0)
            val pts = DoubleArray(N_MELS + 2) { i -> melToHz(mMin + (mMax - mMin) * i / (N_MELS + 1)) }
            val fb = FloatArray(N_BINS * N_MELS)
            for (k in 0 until N_BINS) {
                val f = 8000.0 * k / (N_BINS - 1)
                for (m in 0 until N_MELS) {
                    val down = (f - pts[m]) / (pts[m + 1] - pts[m])
                    val up = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1])
                    fb[k * N_MELS + m] = bf16(max(min(down, up), 0.0).toFloat())
                }
            }
            return fb
        }
    }

    private fun token(i: Int): Char? = when (i) {
        0 -> ' '
        in 1..32 -> (0x0430 + i - 1).toChar()
        else -> null
    }

    /** Жадное CTC-декодирование: лучший класс на шаг, повторы схлопываются, пустой символ убирается. */
    fun ctcDecode(logProbs: FloatArray, steps: Int): String {
        val sb = StringBuilder()
        var prev = -1
        for (t in 0 until steps) {
            val base = t * CLASSES
            var best = 0
            for (c in 1 until CLASSES) if (logProbs[base + c] > logProbs[base + best]) best = c
            if (best != prev && best != BLANK) token(best)?.let { sb.append(it) }
            prev = best
        }
        return sb.toString().trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
    }
}
