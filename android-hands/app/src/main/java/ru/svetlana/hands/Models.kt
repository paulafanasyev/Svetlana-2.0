package ru.svetlana.hands

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.StatFs
import java.io.File

/** Что за телефон: от этого зависит, какую модель советовать. */
data class Device(val ramGb: Double, val availGb: Double, val cores: Int, val soc: String, val arm64: Boolean, val sdk: Int, val freeGb: Double, val vulkan: Boolean, val serverBundled: Boolean) {
    /** Офлайн-модель возможна: 64-битный процессор, Android 9+, в установленном APK есть llama-server. */
    val offline get() = arm64 && sdk >= 28 && serverBundled
    val tier get() = when { ramGb < 3.5 -> 0; ramGb < 5.5 -> 1; ramGb < 9.0 -> 2; else -> 3 }
    val tierName get() = listOf("простой телефон", "средний телефон", "хороший телефон", "флагман")[tier]
    fun describe() = "ОЗУ %.1f ГБ (свободно сейчас %.1f) · ядер %d%s · память телефона: свободно %.1f ГБ · Android %s%s".format(ramGb, availGb, cores, if (soc.isNotBlank()) " · $soc" else "", freeGb, Build.VERSION.RELEASE, if (arm64) "" else " · 32-бит")

    companion object {
        fun detect(ctx: Context): Device {
            val mi = ActivityManager.MemoryInfo(); (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mi)
            val dir = Models.dir(ctx)
            val free = runCatching { StatFs(dir.path).availableBytes / 1e9 }.getOrDefault(0.0)
            val soc = if (Build.VERSION.SDK_INT >= 31) "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}".trim() else Build.HARDWARE
            return Device(mi.totalMem / 1073741824.0, mi.availMem / 1073741824.0, Runtime.getRuntime().availableProcessors(), soc, Build.SUPPORTED_64_BIT_ABIS.contains("arm64-v8a"), Build.VERSION.SDK_INT, free,
                Build.VERSION.SDK_INT >= 24 && ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_VULKAN_HARDWARE_VERSION), File(ctx.applicationInfo.nativeLibraryDir, "libllama_server.so").isFile)
        }
    }
}

/** Модель из каталога: GGUF с Hugging Face (открытые репозитории, без регистрации). Размер и SHA-256 закреплены — подменённый или битый файл не запустится. */
data class Model(val id: String, val title: String, val note: String, val url: String, val bytes: Long, val sha256: String, val minRamGb: Double, val tier: Int,
                 val mmprojUrl: String? = null, val mmprojBytes: Long = 0, val mmprojSha256: String = "", val maxTokens: Int = 1024) {
    val file get() = url.substringAfterLast('/')
    val mmprojFile get() = mmprojUrl?.let { "${id}-" + it.substringAfterLast('/') }
    val vision get() = mmprojUrl != null
    val totalGb get() = (bytes + mmprojBytes) / 1e9
}

object Models {
    private const val HF = "https://huggingface.co"
    val catalog = listOf(
        Model("qwen3-0.6b", "Qwen3 0.6B — лёгкая", "для старых и простых телефонов (от 2–3 ГБ ОЗУ): короткие ответы, простые команды", "$HF/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf", 396_705_472, "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a", 2.0, 0, maxTokens = 768),
        Model("qwen3-1.7b", "Qwen3 1.7B — сбалансированная", "для средних телефонов (4–6 ГБ ОЗУ): заметки, CRM, учёт, простые приложения", "$HF/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf", 1_107_409_472, "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897", 3.5, 1, maxTokens = 1024),
        Model("qwen3-4b", "Qwen3 4B — умная", "для хороших телефонов (8 ГБ ОЗУ): документы, код, длинные задачи", "$HF/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf", 2_497_281_312, "f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a", 5.5, 2, maxTokens = 1536),
        Model("qwen25-vl-3b", "Qwen2.5-VL 3B — видит экран", "для хороших телефонов (8 ГБ ОЗУ): понимает скриншоты и фото", "$HF/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf", 1_929_901_056, "d02fe9b69ad8cadbbd228e387667af66612c44bed29ffc8eb1e7caf9ac486c12", 6.0, 2,
            "$HF/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf", 844_757_728, "980c9b2f78c04e6cff93d277ada09e768394f112d75db3b4e9dea8a69f9fb904", maxTokens = 1024),
        Model("qwen3-8b", "Qwen3 8B — максимальная", "для флагманов (12 ГБ ОЗУ и больше): почти как облачная, но медленнее", "$HF/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf", 5_027_784_512, "120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4", 9.0, 3, maxTokens = 2048),
    )
    fun byId(id: String?) = catalog.firstOrNull { it.id == id }
    fun dir(ctx: Context): File = (ctx.getExternalFilesDir("models") ?: File(ctx.filesDir, "models")).apply { mkdirs() }
    fun path(ctx: Context, m: Model) = File(dir(ctx), m.file)
    fun mmprojPath(ctx: Context, m: Model) = m.mmprojFile?.let { File(dir(ctx), it) }
    private fun parts(ctx: Context, m: Model) = listOfNotNull(Triple(path(ctx, m), m.bytes, m.sha256), mmprojPath(ctx, m)?.let { Triple(it, m.mmprojBytes, m.mmprojSha256) })
    private fun mark(f: File) = File(f.path + ".ok")
    /** Скачано полностью: точный размер. */
    fun downloaded(ctx: Context, m: Model) = parts(ctx, m).all { (f, b, _) -> f.isFile && f.length() == b }
    /** Готова к запуску: скачана и SHA-256 проверен (отметка .ok с той же суммой). */
    fun ready(ctx: Context, m: Model) = parts(ctx, m).all { (f, b, sha) -> f.isFile && f.length() == b && runCatching { mark(f).readText().trim() }.getOrNull() == sha }
    /** Проверка SHA-256 скачанных файлов (5 ГБ — до минуты). Битый или чужой файл удаляется. */
    fun verify(ctx: Context, m: Model): Boolean = parts(ctx, m).all { (f, b, sha) ->
        if (runCatching { mark(f).readText().trim() }.getOrNull() == sha && f.length() == b) return@all true
        val md = java.security.MessageDigest.getInstance("SHA-256"); val buf = ByteArray(1 shl 20)
        val got = runCatching { f.inputStream().use { i -> while (true) { val n = i.read(buf); if (n < 0) break; md.update(buf, 0, n) }; md.digest().joinToString("") { "%02x".format(it) } } }.getOrNull()
        if (got == sha) { mark(f).writeText(sha); true } else { f.delete(); mark(f).delete(); false }
    }
    fun delete(ctx: Context, m: Model) = parts(ctx, m).forEach { (f, _, _) -> f.delete(); mark(f).delete() }
    /** Сколько памяти нужно модели вместе с контекстом и запасом (ГБ). */
    fun needGb(m: Model) = m.totalGb + 0.7
    /** Совет: самая сильная модель своего уровня, которая с запасом помещается в ОЗУ (не больше ~60% всей памяти). */
    fun recommended(d: Device): Model = catalog.filter { !it.vision && it.tier <= d.tier && needGb(it) <= d.ramGb * 0.6 }.maxByOrNull { it.tier } ?: catalog.first()
    /** Сколько потоков и контекста дать модели на этом телефоне. */
    fun threads(d: Device) = minOf(4, maxOf(2, d.cores / 2))
    fun context(d: Device, m: Model) = when { d.ramGb >= 7.5 && m.tier >= 1 -> 8192; d.ramGb < 3.5 -> 2048; else -> 4096 }
}
