package ru.svetlana.hands

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout

/** Просмотр приложения, которое сделала Светлана (адрес 127.0.0.1:порт). Без доступа к чату и голосу. */
class PreviewActivity : Activity() {
    private lateinit var web: WebView
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // отдельный процесс «:preview» со своими cookie: страница проекта не увидит сессию чата Светланы
        if (android.os.Build.VERSION.SDK_INT >= 28) runCatching { WebView.setDataDirectorySuffix("preview") }
        val u = intent.data ?: return finish()
        if (u.host != "127.0.0.1" && u.host != "localhost") return finish()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(android.graphics.Color.WHITE) }
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(Ui.dp(this@PreviewActivity, 8), Ui.dp(this@PreviewActivity, 4), Ui.dp(this@PreviewActivity, 8), Ui.dp(this@PreviewActivity, 4)) }
        bar.addView(Ui.chip(this, "✕ Закрыть") { finish() })
        bar.addView(Ui.text(this, "  ${u.host}:${u.port}", 13f, Ui.SOFT), LinearLayout.LayoutParams(0, -2, 1f))
        bar.addView(Ui.chip(this, "⟳") { web.reload() })
        root.addView(bar, Ui.lp())
        web = WebView(this)
        web.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val x = req.url; if (x.host == u.host && x.port == u.port) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, x)) }; return true
            }
        }
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root); Ui.insets(root)
        web.loadUrl(u.toString())
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
    override fun onDestroy() { if (::web.isInitialized) web.destroy(); super.onDestroy() }
}
