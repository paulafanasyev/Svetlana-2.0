package ru.svetlana.app

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.SafeBrowsingResponse
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Native browser adapter for agent sessions. Uses Android System WebView rather than a separately
 * installed Node/Playwright process. Untrusted site pages never receive Svetlana's JS bridge.
 */
@SuppressLint("SetJavaScriptEnabled")
class AgentBrowser(private val act: MainActivity, private val host: FrameLayout) {
    private data class Session(
        val id: String,
        val agentId: String,
        val view: WebView,
        val panel: LinearLayout,
        val title: TextView,
        var lastUsed: Long = System.currentTimeMillis(),
        var navigationDone: Done? = null,
        var navigationTimeout: Runnable? = null,
    )

    private val main = Handler(Looper.getMainLooper())
    private val sessions = linkedMapOf<String, Session>()
    private var activeId: String? = null
    private val maxSessions = 3

    fun handle(command: String, args: JSONObject, done: Done) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { handle(command, args, done) }
            return
        }
        try {
            when (command) {
                "browser_worker_status" -> done(true, JSONObject().put("ok", true).put("service", "android-webview-browser").put("sessions", sessions.size))
                "browser_create_session" -> createSession(args.optString("agentId"), done)
                "browser_navigate" -> navigate(args.optString("sessionId"), args.optString("url"), done)
                "browser_snapshot" -> withSession(args.optString("sessionId"), done) { s -> observe(s, done) }
                "browser_follow_link" -> followLink(args.optString("sessionId"), args.optString("name"), done)
                "browser_click" -> click(args.optString("sessionId"), args.optString("role"), args.optString("name"), done)
                "browser_fill" -> fill(args.optString("sessionId"), args.optString("role"), args.optString("name"), args.optString("value"), done)
                "browser_wait" -> waitFor(args.optString("sessionId"), args.optInt("ms", -1), done)
                "browser_screenshot" -> screenshot(args.optString("sessionId"), done)
                "browser_close_session" -> closeSession(args.optString("sessionId"), done)
                else -> done(false, "Неизвестная команда встроенного браузера")
            }
        } catch (e: Exception) {
            done(false, e.message ?: "Не удалось выполнить команду браузера")
        }
    }

    private fun createSession(agentId: String, done: Done) {
        if (!agentId.matches(Regex("^[A-Za-z0-9._:-]{1,80}$"))) {
            done(false, "Некорректный идентификатор агента")
            return
        }
        if (sessions.size >= maxSessions) {
            done(false, "Достигнут лимит браузерных сессий; закройте старую сессию")
            return
        }
        val id = UUID.randomUUID().toString()
        val view = WebView(act)
        val settings = view.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.setSupportMultipleWindows(false)
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setGeolocationEnabled(false)
        settings.safeBrowsingEnabled = true
        settings.mediaPlaybackRequiresUserGesture = true
        // Browser sessions must not inherit the user's regular browser cookies or login state.
        CookieManager.getInstance().setAcceptCookie(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)

        val panel = LinearLayout(act).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(18, 25, 42))
            elevation = dp(12).toFloat()
            background = GradientDrawable().apply {
                setColor(Color.rgb(18, 25, 42))
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), Color.rgb(48, 139, 155))
            }
            clipToOutline = true
        }
        val header = LinearLayout(act).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(5), dp(8), dp(5))
        }
        val title = TextView(act).apply {
            text = "Браузер агента · загрузка…"
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        header.addView(title, LinearLayout.LayoutParams(0, dp(42), 1f))
        val close = Button(act).apply {
            text = "Закрыть"
            textSize = 12f
            isAllCaps = false
            setOnClickListener { closeSession(id) }
        }
        header.addView(close, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(40)))
        panel.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        panel.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val session = Session(id, agentId, view, panel, title)
        sessions[id] = session
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val u = request.url
                if (!isAllowedUrl(u.toString())) {
                    failNavigation(session, "Переход заблокирован: разрешены только публичные HTTP/HTTPS-адреса")
                    return true
                }
                session.title.text = "Браузер агента · " + (u.host ?: "страница")
                return false
            }

            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? {
                val scheme = request.url.scheme?.lowercase()
                if (scheme == "data" || scheme == "blob" || scheme == "about") return null
                if (scheme != "http" && scheme != "https") return blockedResponse()
                if (!isAllowedUrl(request.url.toString())) return blockedResponse()
                return super.shouldInterceptRequest(v, request)
            }

            override fun onPageStarted(v: WebView, url: String?, favicon: Bitmap?) {
                session.lastUsed = System.currentTimeMillis()
                session.title.text = "Браузер агента · загрузка…"
            }

            override fun onPageFinished(v: WebView, url: String?) {
                session.lastUsed = System.currentTimeMillis()
                session.title.text = v.title?.take(100)?.ifBlank { v.url?.take(120) ?: "Браузер агента" } ?: "Браузер агента"
                if (session.navigationDone != null) finishNavigation(session)
            }

            @Suppress("DEPRECATION")
            override fun onReceivedError(v: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                if (v === view && failingUrl == v.url) failNavigation(session, "Не удалось загрузить страницу: " + (description ?: "ошибка сети").take(180))
            }

            override fun onSafeBrowsingHit(view: WebView, request: WebResourceRequest, threatType: Int, callback: SafeBrowsingResponse) {
                callback.backToSafety(true)
                failNavigation(session, "Android Safe Browsing заблокировал опасную страницу")
            }
        }
        view.setDownloadListener { _, _, _, _, _ ->
            // Downloads are deliberately disabled in the agent browser.
        }
        show(session)
        done(true, JSONObject()
            .put("sessionId", id)
            .put("agentId", agentId)
            .put("isolated", true)
            .put("expiresAfterMs", TimeUnit.MINUTES.toMillis(30)))
    }

    private fun show(session: Session) {
        activeId = session.id
        host.removeAllViews()
        val height = (act.resources.displayMetrics.heightPixels * 0.48f).toInt().coerceAtLeast(dp(260))
        host.addView(session.panel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height, Gravity.TOP))
        host.visibility = View.VISIBLE
        session.lastUsed = System.currentTimeMillis()
        session.view.onResume()
    }

    private fun navigate(id: String, rawUrl: String, done: Done) {
        val session = sessions[id]
        if (session == null) { done(false, "Браузерная сессия не найдена или закрыта"); return }
        val target = normalizeUrl(rawUrl)
        if (target == null) { done(false, "Неверный URL: разрешены только публичные HTTP/HTTPS-адреса без учётных данных"); return }
        session.navigationDone?.invoke(false, "Предыдущая навигация заменена новой")
        session.navigationDone = done
        session.navigationTimeout?.let(main::removeCallbacks)
        val timeout = Runnable {
            if (session.navigationDone === done) failNavigation(session, "Страница не завершила загрузку за 25 секунд")
        }
        session.navigationTimeout = timeout
        main.postDelayed(timeout, 25_000L)
        show(session)
        Thread({
            val allowed = isAllowedUrl(target)
            main.post {
                if (session.navigationDone !== done) return@post
                if (!allowed) {
                    failNavigation(session, "Переход заблокирован: адрес указывает на локальную или приватную сеть")
                } else {
                    runCatching { session.view.loadUrl(target) }
                        .onFailure { failNavigation(session, "Не удалось открыть страницу") }
                }
            }
        }, "svetlana-browser-url-check").apply { isDaemon = true }.start()
    }

    private fun finishNavigation(session: Session) {
        val callback = session.navigationDone ?: return
        session.navigationDone = null
        session.navigationTimeout?.let(main::removeCallbacks)
        session.navigationTimeout = null
        observe(session) { ok, value ->
            if (!ok) callback(false, value)
            else callback(true, JSONObject().put("success", true).put("observation", value))
        }
    }

    private fun failNavigation(session: Session, message: String) {
        val callback = session.navigationDone ?: return
        session.navigationDone = null
        session.navigationTimeout?.let(main::removeCallbacks)
        session.navigationTimeout = null
        callback(false, message)
    }

    private fun withSession(id: String, done: Done, action: (Session) -> Unit) {
        val session = sessions[id]
        if (session == null) { done(false, "Браузерная сессия не найдена или закрыта"); return }
        session.lastUsed = System.currentTimeMillis()
        show(session)
        action(session)
    }

    private fun observe(session: Session, done: Done, attempt: Int = 0) {
        val js = """
            (function(){
              const nodes=Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')).slice(0,500);
              const roleOf=e=>{
                const r=(e.getAttribute('role')||'').toLowerCase(); if(r)return r;
                const t=e.tagName.toLowerCase();
                if(t==='a'&&e.hasAttribute('href'))return 'link';
                if(t==='button')return 'button';
                if(t==='textarea')return 'textbox';
                if(t==='select')return 'combobox';
                if(t==='input'){
                  const type=(e.type||'text').toLowerCase();
                  if(type==='search')return 'searchbox';
                  if(type==='checkbox')return 'checkbox';
                  if(type==='radio')return 'radio';
                  if(['button','submit','reset'].includes(type))return 'button';
                  if(type==='password')return 'password';
                  return 'textbox';
                }
                return e.tabIndex>=0?'generic':'';
              };
              const labelOf=e=>{
                const label=e.getAttribute('aria-label') || e.getAttribute('title') ||
                  (e.labels&&e.labels.length?Array.from(e.labels).map(x=>x.innerText).join(' '):'') ||
                  e.innerText || e.value || e.getAttribute('name') || e.id || '';
                return String(label).replace(/\s+/g,' ').trim().slice(0,240);
              };
              const aria=nodes.map(e=>{const r=roleOf(e),l=labelOf(e);return r&&l?(r+': '+l):'';}).filter(Boolean).join('\n'              const body=document.body,root=document.documentElement;
              const candidates=[body&&body.innerText,body&&body.textContent,root&&root.innerText,root&&root.textContent];
              const pageText=candidates.find(v=>typeof v==='string'&&v.trim().length>0)||'';
              return JSON.stringify({url:location.href,title:document.title||'',text:String(pageText).replace(/\s+/g,' ').trim().slice(0,12000),aria:aria,timestamp:Date.now()});
            })()
        """.trimIndent()
        session.view.evaluateJavascript(js) { raw ->
            val jsonText = decodeJsString(raw)
            val parsed = runCatching { JSONObject(jsonText) }.getOrNull()
            if (parsed == null) {
                done(false, "Не удалось прочитать содержимое страницы")
            } else {
                if (parsed.optString("text").isBlank() && attempt < 3 &&
                    (session.view.url?.startsWith("https://") == true || session.view.url?.startsWith("http://") == true)) {
                    // Some WebView providers report onPageFinished before page text is exposed.
                    // Retry briefly so the agent receives document content rather than an empty snapshot.
                    main.postDelayed({ observe(session, done, attempt + 1) }, 300L)
                    return@evaluateJavascript
                }
                parsed.put("url", parsed.optString("url", session.view.url ?: ""))
                    .put("title", parsed.optString("title", session.view.title ?: ""))
                    .put("timestamp", System.currentTimeMillis())
                session.lastUsed = System.currentTimeMillis()
                done(true, parsed)
            }
        }
    }

    /**
     * Follows ordinary navigation links without executing arbitrary click handlers. Action-like
     * links are rejected here; the caller can then deliberately use browser_click through ActionGate.
     */
    private fun followLink(id: String, name: String, done: Done) {
        if (name.isBlank() || name.length > 300) { done(false, "Имя ссылки имеет недопустимую длину"); return }
        val session = sessions[id]
        if (session == null) { done(false, "Браузерная сессия не найдена или закрыта"); return }
        show(session)
        session.view.evaluateJavascript(followLinkScript(name)) { raw ->
            val result = runCatching { JSONObject(decodeJsString(raw)) }.getOrNull()
            if (result == null || !result.optBoolean("ok")) {
                done(false, result?.optString("error") ?: "Не удалось проверить ссылку")
                return@evaluateJavascript
            }
            val target = result.optString("url")
            if (isPotentiallyConsequentialLink(name, target)) {
                done(false, "Ссылка похожа на действие с последствиями и не открыта автоматически. Используйте browser_click после подтверждения.")
                return@evaluateJavascript
            }
            // navigate() rechecks the URL and DNS destinations before loading the target.
            navigate(id, target, done)
        }
    }

    private fun followLinkScript(name: String): String {
        val nameJson = JSONObject.quote(name)
        return """
          (function(){
            const name=$nameJson;
            const links=Array.from(document.querySelectorAll('a[href]')).slice(0,1000);
            const labelOf=e=>String(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,240);
            const matches=links.filter(e=>labelOf(e)===name);
            if(matches.length!==1)return JSON.stringify({ok:false,error:matches.length?'Найдено несколько ссылок с таким именем':'Ссылка не найдена'});
            const url=new URL(matches[0].getAttribute('href'),location.href);
            if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return JSON.stringify({ok:false,error:'Разрешены только публичные HTTP/HTTPS-ссылки'});
            return JSON.stringify({ok:true,url:url.href});
          })()
        """.trimIndent()
    }

    private fun isPotentiallyConsequentialLink(name: String, url: String): Boolean {
        val pattern = Regex(
            "(logout|log[ -]?out|sign[ -]?out|delete|remove|unsubscribe|cancel[ -]?(subscription|account|order)?|checkout|payment|pay now|purchase|buy now|submit|send|transfer|revoke|reset[ -]?password|verify[ -]?email|confirm[ -]?email|activate[ -]?account|удал(?:ить|ение)|отпис(?:аться|ка)|отмен(?:ить|а)|оплат(?:ить|а)|покуп(?:ка|ать)|перевод|отправ(?:ить|ка)|подтверд(?:ить|ение)|сброс(?:ить| пароля))",
            RegexOption.IGNORE_CASE
        )
        return pattern.containsMatchIn("$name $url")
    }

    private fun click(id: String, role: String, name: String, done: Done) {
        if (role !in setOf("button", "link", "checkbox", "radio", "tab", "menuitem", "option")) {
            done(false, "Недопустимая роль элемента")
            return
        }
        val session = sessions[id]
        if (session == null) { done(false, "Браузерная сессия не найдена или закрыта"); return }
        session.lastUsed = System.currentTimeMillis()
        show(session)
        session.view.evaluateJavascript(clickScript(role, name, false)) { raw ->
            val result = runCatching { JSONObject(decodeJsString(raw)) }.getOrNull()
            if (result == null) { done(false, "Не удалось проверить элемент страницы"); return@evaluateJavascript }
            if (!result.optBoolean("ok") && result.optBoolean("needConfirm")) {
                val context = result.optString("context", name).take(160)
                Thread({
                    val ok = act.confirm("Разрешить агенту нажать элемент сайта?\n\nСайт: ${session.view.url ?: "неизвестен"}\nЭлемент: $context\n\nСтраницы могут содержать обманчивые подписи. Подтверждайте только ожидаемое действие.")
                    act.main.post {
                        if (!ok) done(false, "Действие отменено пользователем")
                        else executeClick(session, role, name, done, true)
                    }
                }, "svetlana-browser-confirm").apply { isDaemon = true }.start()
            } else if (!result.optBoolean("ok")) {
                done(false, result.optString("error", "Не удалось найти однозначный элемент"))
            } else {
                main.postDelayed({ observe(session) { ok, observation ->
                    if (ok) done(true, JSONObject().put("success", true).put("observation", observation))
                    else done(false, observation)
                } }, 450L)
            }
        }
    }

    private fun executeClick(session: Session, role: String, name: String, done: Done, confirmed: Boolean) {
        session.view.evaluateJavascript(clickScript(role, name, confirmed)) { raw ->
            val result = runCatching { JSONObject(decodeJsString(raw)) }.getOrNull()
            if (result?.optBoolean("ok") != true) {
                done(false, result?.optString("error") ?: "Нажатие не выполнено")
            } else {
                main.postDelayed({ observe(session) { ok, observation ->
                    if (ok) done(true, JSONObject().put("success", true).put("observation", observation))
                    else done(false, observation)
                } }, 650L)
            }
        }
    }

    private fun clickScript(role: String, name: String, confirmed: Boolean): String {
        val roleJson = JSONObject.quote(role)
        val nameJson = JSONObject.quote(name)
        return """
          (function(){
            const role=$roleJson,name=$nameJson,confirmed=$confirmed;
            const nodes=Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')).slice(0,1000);
            const roleOf=e=>{const r=(e.getAttribute('role')||'').toLowerCase();if(r)return r;const t=e.tagName.toLowerCase();if(t==='a'&&e.hasAttribute('href'))return'link';if(t==='button')return'button';if(t==='input'){const x=(e.type||'text').toLowerCase();if(x==='checkbox'||x==='radio')return x;if(['button','submit','reset'].includes(x))return'button';}if(t==='select')return'combobox';return'';};
            const labelOf=e=>String(e.getAttribute('aria-label')||e.getAttribute('title')||(e.labels&&e.labels.length?Array.from(e.labels).map(x=>x.innerText).join(' '):'')||e.innerText||e.value||e.getAttribute('name')||e.id||'').replace(/\s+/g,' ').trim().slice(0,240);
            const matches=nodes.filter(e=>roleOf(e)===role&&labelOf(e)===name);
            if(matches.length!==1)return JSON.stringify({ok:false,error:matches.length?'Найдено несколько одинаковых элементов':'Элемент не найден'});
            const e=matches[0];if(e.disabled||e.getAttribute('aria-disabled')==='true')return JSON.stringify({ok:false,error:'Элемент отключён'});
            let ancestor=e,context=[],metadata=[];
            for(let i=0;ancestor&&i<6;i++,ancestor=ancestor.parentElement){
              context.push(labelOf(ancestor));
              metadata.push(ancestor.getAttribute('href')||'',ancestor.getAttribute('action')||'',
                ancestor.getAttribute('formaction')||'',ancestor.getAttribute('name')||'',
                ancestor.getAttribute('type')||'',ancestor.getAttribute('aria-label')||'',
                ancestor.getAttribute('data-testid')||'');
            }
            const form=e.closest('form');
            if(form)metadata.push(form.getAttribute('action')||'',form.getAttribute('method')||'',form.innerText||'');
            const signals=context.concat(metadata).join(' ');
            const dangerous=/(delete|remove|purchase|checkout|pay(?:ment)?|submit|send|transfer|confirm|subscribe|sign[ -]?out|logout|erase|wipe|approve|authorize|accept|agree|place order|complete order|save changes|unsubscribe|revoke|reset|удал|оплат|покуп|купить|перевод|отправ|подтвер|подпис|списат|разреш|соглас|принять|оформить|заказ|сохранить измен|отмен|сброс)/i.test(signals)
              || (e.tagName==='INPUT'&&['submit','image'].includes((e.type||'').toLowerCase()))
              || (e.tagName==='BUTTON'&&((e.type||'').toLowerCase()==='submit'||!!form));
            if(dangerous&&!confirmed)return JSON.stringify({ok:false,needConfirm:true,context:context.filter(Boolean).join(' ← ').slice(0,240)});
            e.click();return JSON.stringify({ok:true});
          })()
        """.trimIndent()
    }

    private fun fill(id: String, role: String, name: String, value: String, done: Done) {
        if (role !in setOf("textbox", "searchbox", "combobox")) { done(false, "Недопустимая роль поля"); return }
        if (name.isBlank() || name.length > 300 || value.length > 4000) { done(false, "Имя поля или текст имеют недопустимую длину"); return }
        val session = sessions[id]
        if (session == null) { done(false, "Браузерная сессия не найдена или закрыта"); return }
        session.lastUsed = System.currentTimeMillis()
        show(session)
        session.view.evaluateJavascript(fillScript(role, name, value, false)) { raw ->
            val result = runCatching { JSONObject(decodeJsString(raw)) }.getOrNull()
            if (result == null) { done(false, "Не удалось проверить поле страницы"); return@evaluateJavascript }
            if (!result.optBoolean("ok") && result.optBoolean("needConfirm")) {
                val context = result.optString("context", name).take(160)
                Thread({
                    val valuePreview = value.take(100) + if (value.length > 100) "…" else ""
                    val ok = act.confirm("Разрешить агенту заполнить поле сайта?\n\nСайт: ${session.view.url ?: "неизвестен"}\nПоле: $context\nЗначение: $valuePreview\n\nПроверьте, что это нужная форма.")
                    main.post {
                        if (!ok) done(false, "Заполнение отменено пользователем")
                        else executeFill(session, role, name, value, done, true)
                    }
                }, "svetlana-browser-confirm").apply { isDaemon = true }.start()
            } else if (!result.optBoolean("ok")) {
                done(false, result.optString("error", "Не удалось найти однозначное поле"))
            } else {
                observe(session) { ok, observation ->
                    if (ok) done(true, JSONObject().put("success", true).put("observation", observation))
                    else done(false, observation)
                }
            }
        }
    }

    private fun executeFill(session: Session, role: String, name: String, value: String, done: Done, confirmed: Boolean) {
        session.view.evaluateJavascript(fillScript(role, name, value, confirmed)) { raw ->
            val result = runCatching { JSONObject(decodeJsString(raw)) }.getOrNull()
            if (result?.optBoolean("ok") != true) { done(false, result?.optString("error") ?: "Поле не заполнено"); return@evaluateJavascript }
            observe(session) { ok, observation ->
                if (ok) done(true, JSONObject().put("success", true).put("observation", observation))
                else done(false, observation)
            }
        }
    }

    private fun fillScript(role: String, name: String, value: String, confirmed: Boolean): String {
        val roleJson = JSONObject.quote(role)
        val nameJson = JSONObject.quote(name)
        val valueJson = JSONObject.quote(value)
        return """
          (function(){
            const role=$roleJson,name=$nameJson,value=$valueJson,confirmed=$confirmed;
            const nodes=Array.from(document.querySelectorAll('input,textarea,select,[role="textbox"],[role="searchbox"],[role="combobox"]')).slice(0,1000);
            const roleOf=e=>{const r=(e.getAttribute('role')||'').toLowerCase();if(r)return r;const t=e.tagName.toLowerCase();if(t==='textarea')return'textbox';if(t==='select')return'combobox';if(t==='input'){const x=(e.type||'text').toLowerCase();if(x==='search')return'searchbox';if(x==='password')return'password';if(['button','submit','reset','checkbox','radio','hidden'].includes(x))return'';return'textbox';}return'';};
            const labelOf=e=>String(e.getAttribute('aria-label')||e.getAttribute('title')||(e.labels&&e.labels.length?Array.from(e.labels).map(x=>x.innerText).join(' '):'')||e.getAttribute('placeholder')||e.getAttribute('name')||e.id||'').replace(/\s+/g,' ').trim().slice(0,240);
            const matches=nodes.filter(e=>roleOf(e)===role&&labelOf(e)===name);
            if(matches.length!==1)return JSON.stringify({ok:false,error:matches.length?'Найдено несколько одинаковых полей':'Поле не найдено'});
            const e=matches[0];if(e.disabled||e.readOnly)return JSON.stringify({ok:false,error:'Поле недоступно для ввода'});
            if((e.type||'').toLowerCase()==='password'||/(password|passwd|парол|credit.?card|card.?number|cvv|cvc|security.?code|номер.?карты)/i.test(labelOf(e)))return JSON.stringify({ok:false,error:'Ввод паролей и платёжных реквизитов агентом запрещён'});
            const sensitive=/(email|e-mail|phone|mobile|address|passport|tax|amount|account|bank|iban|телефон|почт|адрес|паспорт|инн|сумм|сч[её]т|банк)/i.test(labelOf(e));
            const parent=(e.closest('form')&&((e.closest('form').innerText||'').slice(0,800)))||'';
            if((sensitive||/(payment|checkout|оплат|покупк|перевод|заказ)/i.test(parent))&&!confirmed)return JSON.stringify({ok:false,needConfirm:true,context:labelOf(e)+' · '+parent.slice(0,100)});
            e.focus();
            if(e.tagName==='SELECT'){
              const option=Array.from(e.options).find(o=>o.text.trim()===value||o.value===value);
              if(!option)return JSON.stringify({ok:false,error:'Нет варианта с таким точным названием'});
              e.value=option.value;
            }else{
              const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
              const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
              if(setter)setter.call(e,value);else e.value=value;
            }
            e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
            return JSON.stringify({ok:true});
          })()
        """.trimIndent()
    }

    private fun waitFor(id: String, ms: Int, done: Done) {
        if (ms !in 0..10_000) { done(false, "Ожидание должно быть от 0 до 10000 мс"); return }
        val session = sessions[id]
        if (session == null) { done(false, "Браузерная сессия не найдена или закрыта"); return }
        show(session)
        main.postDelayed({
            if (sessions[id] !== session) done(false, "Браузерная сессия уже закрыта")
            else observe(session) { ok, observation ->
                if (ok) done(true, JSONObject().put("success", true).put("observation", observation))
                else done(false, observation)
            }
        }, ms.toLong())
    }

    private fun screenshot(id: String, done: Done) {
        val session = sessions[id]
        if (session == null) { done(false, "Браузерная сессия не найдена или закрыта"); return }
        show(session)
        val view = session.view
        if (view.width < 2 || view.height < 2) { done(false, "Браузер ещё не отрисовал страницу"); return }
        try {
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            val scale = minOf(1.0, 960.0 / bitmap.width)
            val resized = if (scale < 1.0) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true) else bitmap
            val bytes = ByteArrayOutputStream()
            resized.compress(Bitmap.CompressFormat.JPEG, 55, bytes)
            if (resized !== bitmap) resized.recycle()
            bitmap.recycle()
            val encoded = android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP)
            done(true, JSONObject().put("success", true).put("mimeType", "image/jpeg").put("base64", encoded).put("url", view.url ?: ""))
        } catch (_: Exception) {
            done(false, "Не удалось создать снимок страницы")
        }
    }

    private fun closeSession(id: String, done: Done) {
        val session = sessions.remove(id)
        if (session == null) { done(true, JSONObject().put("closed", false)); return }
        session.navigationDone?.invoke(false, "Браузерная сессия закрыта")
        session.navigationDone = null
        session.navigationTimeout?.let(main::removeCallbacks)
        if (activeId == id) {
            host.removeAllViews()
            activeId = null
            val next = sessions.values.lastOrNull()
            if (next != null) show(next) else host.visibility = View.GONE
        }
        runCatching { session.view.stopLoading(); session.view.loadUrl("about:blank"); session.view.destroy() }
        done(true, JSONObject().put("closed", true))
    }

    fun onPause() { sessions.values.forEach { it.view.onPause() } }
    fun onResume() { sessions.values.forEach { it.view.onResume() } }
    fun closeAll() { sessions.keys.toList().forEach { closeSession(it) } }
    private fun closeSession(id: String) = closeSession(id) { _, _ -> }

    private fun normalizeUrl(raw: String): String? {
        val input = raw.trim()
        if (input.isEmpty() || input.length > 2048) return null
        val withScheme = if (input.matches(Regex("(?i)^https?://.*"))) input else "https://$input"
        return runCatching {
            val uri = Uri.parse(withScheme)
            val scheme = uri.scheme?.lowercase()
            if (scheme !in setOf("http", "https") || uri.host.isNullOrBlank() || uri.encodedUserInfo != null) null
            else uri.toString().takeIf { uri.host!!.length <= 253 }
        }.getOrNull()
    }

    private fun isAllowedUrl(raw: String): Boolean {
        val normalized = normalizeUrl(raw) ?: return false
        return try {
            val uri = URI(normalized)
            val hostName = uri.host?.trim('[', ']')?.lowercase() ?: return false
            if (hostName == "localhost" || hostName.endsWith(".localhost") || hostName.endsWith(".local") || hostName.endsWith(".internal")) return false
            val addresses = if (hostName.matches(Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")) || hostName.contains(':')) {
                listOf(InetAddress.getByName(hostName))
            } else {
                InetAddress.getAllByName(hostName).toList()
            }
            addresses.isNotEmpty() && addresses.all { isPublicAddress(it) }
        } catch (_: Exception) { false }
    }

    private fun isPublicAddress(address: InetAddress): Boolean {
        if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
        val bytes = address.address.map { it.toInt() and 0xff }
        return if (address is Inet4Address) {
            val a = bytes[0]; val b = bytes[1]; val c = bytes[2]
            // Deny non-global, special-purpose, documentation, benchmarking and multicast ranges.
            !(a == 0 || a == 10 || a == 127 || a >= 224 ||
                (a == 100 && b in 64..127) ||
                (a == 169 && b == 254) ||
                (a == 172 && b in 16..31) ||
                (a == 192 && (b == 0 || b == 168)) ||
                (a == 192 && b == 88 && c == 99) ||
                (a == 198 && (b == 18 || b == 19 || b == 51 && c == 100)) ||
                (a == 203 && b == 0 && c == 113) || a == 255)
        } else if (address is Inet6Address) {
            val a = bytes[0]; val b = bytes.getOrElse(1) { 0 }
            val isGlobalUnicast = a in 0x20..0x3f // 2000::/3
            val isDocumentation = a == 0x20 && b == 0x01 &&
                bytes.getOrElse(2) { 0 } == 0x0d && bytes.getOrElse(3) { 0 } == 0xb8
            val isMappedOrCompatible = bytes.take(10).all { it == 0 } &&
                (bytes.getOrElse(10) { 0 } == 0xff || bytes.getOrElse(10) { 0 } == 0)
            isGlobalUnicast && !isDocumentation && !isMappedOrCompatible
        } else false
    }

    private fun blockedResponse() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", mapOf("Cache-Control" to "no-store"), java.io.ByteArrayInputStream(ByteArray(0)))
    private fun decodeJsString(raw: String?): String {
        if (raw.isNullOrBlank() || raw == "null") return ""
        return runCatching { JSONArray("[$raw]").getString(0) }.getOrDefault("")
    }
    private fun dp(value: Int): Int = (value * act.resources.displayMetrics.density).toInt()
}
