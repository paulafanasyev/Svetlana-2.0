package ru.svetlana.hands

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.StatFs
import java.io.File

/** Что за телефон: от этого зависит, какую модель советовать. */
data class Device(val ramGb: Double, val cores: Int, val soc: String, val arm64: Boolean, val sdk: Int, val freeGb: Double, val vulkan: Boolean, val serverBundled: Boolean) {
    /** Офлайн-модель возможна: 64-битный процессор, Android 9+, в установленном APK есть llama-server. */
    val offline get() = arm64 && sdk >= 28 && serverBundled
    val tier get() = when { ramGb < 3.5 -> 0; ramGb < 5.5 -> 1; ramGb < 9.0 -> 2; else -> 3 }
    val tierName get() = listOf("простой телефон", "средний телефон", "хороший телефон", "флагман")[tier]
    fun describe() = "ОЗУ %.1f ГБ · ядер %d%s · свободно %.1f ГБ · Android %s%s".format(ramGb, cores, if (soc.isNotBlank()) " · $soc" else "", freeGb, Build.VERSION.RELEASE, if (arm64) "" else " · 32-бит")

    companion object {
        fun detect(ctx: Context): Device {
            val mi = ActivityManager.MemoryInfo(); (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mi)
            val dir = Models.dir(ctx)
            val free = runCatching { StatFs(dir.path).availableBytes / 1e9 }.getOrDefault(0.0)
            val soc = if (Build.VERSION.SDK_INT >= 31) "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}".trim() else Build.HARDWARE
            return Device(mi.totalMem / 1073741824.0, Runtime.getRuntime().availableProcessors(), soc, Build.SUPPORTED_64_BIT_ABIS.contains("arm64-v8a"), Build.VERSION.SDK_INT, free,
                Build.VERSION.SDK_INT >= 24 && ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_VULKAN_HARDWARE_VERSION), File(ctx.applicationInfo.nativeLibraryDir, "libllama_server.so").isFile)
        }
    }
}

/** Модель из каталога: GGUF с Hugging Face (открытые репозитории, без регистрации). */
data class Model(val id: String, val title: String, val note: String, val url: String, val bytes: Long, val minRamGb: Double, val tier: Int,
                 val mmprojUrl: String? = null, val mmprojBytes: Long = 0, val maxTokens: Int = 1024) {
    val file get() = url.substringAfterLast('/')
    val mmprojFile get() = mmprojUrl?.let { "${id}-" + it.substringAfterLast('/') }
    val vision get() = mmprojUrl != null
    val totalGb get() = (bytes + mmprojBytes) / 1e9
}

object Models {
    private const val HF = "https://huggingface.co"
    val catalog = listOf(
        Model("qwen3-0.6b", "Qwen3 0.6B — лёгкая", "для старых и простых телефонов (от 2–3 ГБ ОЗУ): короткие ответы, простые команды", "$HF/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf", 397_000_000, 2.0, 0, maxTokens = 768),
        Model("qwen3-1.7b", "Qwen3 1.7B — сбалансированная", "для средних телефонов (4–6 ГБ ОЗУ): заметки, CRM, учёт, простые приложения", "$HF/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf", 1_110_000_000, 3.5, 1, maxTokens = 1024),
        Model("qwen3-4b", "Qwen3 4B — умная", "для хороших телефонов (8 ГБ ОЗУ): документы, код, длинные задачи", "$HF/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf", 2_500_000_000, 5.5, 2, maxTokens = 1536),
        Model("qwen25-vl-3b", "Qwen2.5-VL 3B — видит экран", "для хороших телефонов (8 ГБ ОЗУ): понимает скриншоты и фото", "$HF/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf", 1_930_000_000, 6.0, 2,
            "$HF/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf", 1_340_000_000, maxTokens = 1024),
        Model("qwen3-8b", "Qwen3 8B — максимальная", "для флагманов (12 ГБ ОЗУ и больше): почти как облачная, но медленнее", "$HF/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf", 5_030_000_000, 9.0, 3, maxTokens = 2048),
    )
    fun byId(id: String?) = catalog.firstOrNull { it.id == id }
    fun dir(ctx: Context): File = (ctx.getExternalFilesDir("models") ?: File(ctx.filesDir, "models")).apply { mkdirs() }
    fun path(ctx: Context, m: Model) = File(dir(ctx), m.file)
    fun mmprojPath(ctx: Context, m: Model) = m.mmprojFile?.let { File(dir(ctx), it) }
    /** Скачана полностью (размер совпадает с ожидаемым с точностью 3%). */
    fun ready(ctx: Context, m: Model): Boolean {
        fun ok(f: File?, b: Long) = f != null && f.isFile && f.length() > b * 0.97
        return ok(path(ctx, m), m.bytes) && (!m.vision || ok(mmprojPath(ctx, m), m.mmprojBytes))
    }
    fun recommended(d: Device): Model = catalog.filter { !it.vision && it.tier <= d.tier }.maxByOrNull { it.tier } ?: catalog.first()
    /** Сколько потоков и контекста дать модели на этом телефоне. */
    fun threads(d: Device) = minOf(4, maxOf(2, d.cores / 2))
    fun context(d: Device, m: Model) = if (d.ramGb >= 7.5 && m.tier >= 1) 8192 else 4096
}
