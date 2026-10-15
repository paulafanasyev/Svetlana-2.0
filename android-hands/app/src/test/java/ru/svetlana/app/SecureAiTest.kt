package ru.svetlana.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Модульные тесты проверок SecureAi (без сети и без телефона). Запускаются на каждой сборке
 * assembleDebug, поэтому APK с сломанной проверкой ключей или тела запроса не соберётся.
 */
class SecureAiTest {
    private fun accepts(provider: String, model: String, json: String) {
        SecureAi.validateBody(provider, model, JSONObject(json))
    }

    private fun rejects(provider: String, model: String, json: String) {
        assertThrows(SecureAi.Fail::class.java) { SecureAi.validateBody(provider, model, JSONObject(json)) }
    }

    @Test
    fun providersMatchWindowsOrder() {
        assertEquals(
            listOf("openai", "groq", "openrouter", "deepseek", "mistral", "anthropic", "google", "svetlana", "gigachat"),
            SecureAi.PROVIDERS,
        )
    }

    @Test
    fun secretNamesOnlyForKnownProviders() {
        assertEquals("gigachat", SecureAi.providerOfSecret("ai.gigachat"))
        assertEquals("openai", SecureAi.providerOfSecret("ai.openai"))
        assertNull(SecureAi.providerOfSecret("ai.evil"))
        assertNull(SecureAi.providerOfSecret("ai."))
        assertNull(SecureAi.providerOfSecret("gigachat"))
        assertNull(SecureAi.providerOfSecret("native.ai.openai"))
    }

    @Test
    fun gigachatKeyIsBase64Only() {
        assertTrue(SecureAi.validGigachatKey("QWxhZGRpbjpvcGVuIHNlc2FtZQ=="))
        assertTrue(SecureAi.validGigachatKey("A".repeat(16)))
        assertTrue(SecureAi.validGigachatKey("A".repeat(1024)))
        assertFalse(SecureAi.validGigachatKey("A".repeat(15)))
        assertFalse(SecureAi.validGigachatKey("A".repeat(1025)))
        assertFalse(SecureAi.validGigachatKey("Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="))
        assertFalse(SecureAi.validGigachatKey("QWxhZGRpbjpvcGVu\r\nX-Evil: 1"))
        assertFalse(SecureAi.validGigachatKey("ключключключключключ"))
    }

    @Test
    fun openAiLikeBody() {
        val ok = """{"model":"gpt-4o-mini","messages":[{"role":"system","content":"ты Светлана"},{"role":"user","content":"привет"}],"temperature":0.7,"max_tokens":512}"""
        accepts("openai", "gpt-4o-mini", ok)
        accepts("openrouter", "meta-llama/llama-3.1-8b-instruct:free", """{"model":"meta-llama/llama-3.1-8b-instruct:free","messages":[{"role":"user","content":"a"}]}""")
        // Лишнее поле, чужая модель, плохая роль, пустой список, не текст, выход за пределы.
        rejects("openai", "gpt-4o-mini", """{"model":"gpt-4o-mini","messages":[{"role":"user","content":"a"}],"stream":true}""")
        rejects("openai", "gpt-4o-mini", """{"model":"gpt-4o","messages":[{"role":"user","content":"a"}]}""")
        rejects("openai", "gpt-4o-mini", """{"model":"gpt-4o-mini","messages":[{"role":"tool","content":"a"}]}""")
        rejects("openai", "gpt-4o-mini", """{"model":"gpt-4o-mini","messages":[]}""")
        rejects("openai", "gpt-4o-mini", """{"model":"gpt-4o-mini","messages":[{"role":"user","content":5}]}""")
        rejects("openai", "gpt-4o-mini", """{"model":"gpt-4o-mini","messages":[{"role":"user","content":"a","name":"x"}]}""")
        rejects("openai", "gpt-4o-mini", """{"model":"gpt-4o-mini","messages":[{"role":"user","content":"a"}],"temperature":3}""")
        rejects("openai", "gpt-4o-mini", """{"model":"gpt-4o-mini","messages":[{"role":"user","content":"a"}],"max_tokens":0}""")
        rejects("openai", "bad model", """{"model":"bad model","messages":[{"role":"user","content":"a"}]}""")
    }

    @Test
    fun tooManyMessages() {
        val list = JSONArray()
        repeat(SecureAi.MAX_MESSAGES + 1) { list.put(JSONObject().put("role", "user").put("content", "a")) }
        val body = JSONObject().put("model", "gpt-4o-mini").put("messages", list)
        assertThrows(SecureAi.Fail::class.java) { SecureAi.validateBody("openai", "gpt-4o-mini", body) }
    }

    @Test
    fun gigachatNeedsPositiveTemperature() {
        rejects("gigachat", "GigaChat-2", """{"model":"GigaChat-2","messages":[{"role":"user","content":"a"}],"temperature":0}""")
        accepts("gigachat", "GigaChat-2", """{"model":"GigaChat-2","messages":[{"role":"user","content":"a"}],"temperature":0.1}""")
        accepts("gigachat", "GigaChat-2-Max", """{"model":"GigaChat-2-Max","messages":[{"role":"system","content":"s"},{"role":"user","content":"a"}]}""")
    }

    @Test
    fun anthropicBody() {
        accepts("anthropic", "claude-3-5-haiku-latest", """{"model":"claude-3-5-haiku-latest","max_tokens":1024,"system":"s","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}""")
        rejects("anthropic", "claude-3-5-haiku-latest", """{"model":"claude-3-5-haiku-latest","messages":[{"role":"system","content":"a"}]}""")
    }

    @Test
    fun googleBody() {
        val ok = """{"contents":[{"role":"user","parts":[{"text":"a"}]}],"systemInstruction":{"parts":[{"text":"s"}]},"generationConfig":{"temperature":0.5,"maxOutputTokens":256}}"""
        accepts("google", "gemini-2.0-flash", ok)
        // Имя модели вставляется в адрес: никаких ".." и "/".
        rejects("google", "../x", ok)
        rejects("google", "models/x", ok)
        rejects("google", "gemini-2.0-flash", """{"contents":[{"role":"assistant","parts":[{"text":"a"}]}]}""")
        rejects("google", "gemini-2.0-flash", """{"contents":[{"role":"user","parts":[{"text":"a"}]}],"tools":[]}""")
    }

    @Test
    fun svetlanaBody() {
        accepts("svetlana", SecureAi.SVETLANA_MODEL, """{"message":"привет","history":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}],"system":"s"}""")
        rejects("svetlana", "gpt-4o", """{"message":"привет"}""")
        rejects("svetlana", SecureAi.SVETLANA_MODEL, """{"message":"   "}""")
        rejects("svetlana", SecureAi.SVETLANA_MODEL, """{"message":"a","history":[{"role":"system","content":"a"}]}""")
        val history = JSONArray()
        repeat(SecureAi.SVETLANA_MAX_HISTORY + 1) { history.put(JSONObject().put("role", "user").put("content", "a")) }
        val long = JSONObject().put("message", "a").put("history", history)
        assertThrows(SecureAi.Fail::class.java) { SecureAi.validateBody("svetlana", SecureAi.SVETLANA_MODEL, long) }
    }

    @Test
    fun previewHasNoControlCharsAndIsShort() {
        val body = JSONObject("""{"model":"m","messages":[{"role":"system","content":"s"},{"role":"user","content":"a\nb"}]}""")
        assertEquals("ab", SecureAi.previewOf("openai", body))
        val long = JSONObject().put("message", "я".repeat(500))
        assertEquals(80, SecureAi.previewOf("svetlana", long).length)
    }
}
