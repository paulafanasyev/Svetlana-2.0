package ru.svetlana.app

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

/**
 * Отдаёт собранный интерфейс (assets/web, тот же dist, что у сайта) по адресу
 * https://appassets.androidplatform.net/... С точными MIME-типами (модульные скрипты их требуют) и nosniff.
 * Файлы вне assets/web и пути с «..» не отдаются.
 */
class WebAssets(private val ctx: Context) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse {
        var p = path.substringBefore('?').substringBefore('#').trimStart('/')
        if (p.isEmpty()) p = "index.html"
        if (p.contains("..") || p.contains('\\')) return notFound()
        var stream: InputStream? = open(p)
        if (stream == null && !p.substringAfterLast('/').contains('.')) {
            // Маршрут одностраничного приложения — отдаём index.html.
            p = "index.html"
            stream = open(p)
        }
        if (stream == null) return notFound()
        val mime = mime(p)
        val text = mime.startsWith("text/") || mime == "application/json" || mime == "image/svg+xml" || mime == "application/manifest+json"
        val r = WebResourceResponse(mime, if (text) "utf-8" else null, stream)
        r.responseHeaders = mapOf(
            "X-Content-Type-Options" to "nosniff",
            "Referrer-Policy" to "no-referrer",
            "Cache-Control" to "no-cache",
        )
        return r
    }

    private fun open(p: String): InputStream? = try {
        ctx.assets.open("web/$p")
    } catch (e: IOException) {
        null
    }

    private fun notFound(): WebResourceResponse =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("X-Content-Type-Options" to "nosniff"), ByteArrayInputStream(ByteArray(0)))

    companion object {
        fun mime(p: String): String = when (p.substringAfterLast('.', "").lowercase()) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json", "map" -> "application/json"
            "webmanifest" -> "application/manifest+json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "wasm" -> "application/wasm"
            "mp3" -> "audio/mpeg"
            "wav" -> "audio/wav"
            "ogg" -> "audio/ogg"
            "mp4" -> "video/mp4"
            "webm" -> "video/webm"
            "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
    }
}
