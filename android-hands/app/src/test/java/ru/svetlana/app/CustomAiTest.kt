package ru.svetlana.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** «Свой ИИ»: те же правила адреса, что у страницы (normalizeCustomEndpoint в AIGateway.ts). */
class CustomAiTest {
    @Test
    fun normalizesLikeThePage() {
        assertEquals("https://api.example.com/v1", SecureAi.customEndpoint("https://API.Example.com/v1/"))
        assertEquals("https://ai.my-server.ru:8443/v1", SecureAi.customEndpoint("https://ai.my-server.ru:8443/v1/chat/completions"))
        assertEquals("https://llm.example.org", SecureAi.customEndpoint("  https://llm.example.org/  "))
    }

    @Test
    fun rejectsUnsafeAddresses() {
        listOf(
            "http://api.example.com/v1",
            "https://user:pw@api.example.com/v1",
            "https://api.example.com/v1?x=1",
            "https://api.example.com/v1#a",
            "https://localhost/v1",
            "https://api.example.com/v 1",
            "https://api.example.com/%2e%2e/v1",
            "javascript:alert(1)",
            "",
        ).forEach { assertNull(it, SecureAi.customEndpoint(it)) }
    }

    @Test
    fun storedValueHoldsOnlyAddressAndKey() {
        val c = SecureAi.parseCustom("""{"endpoint":"https://ai.example.com/v1","key":"sk-1"}""")!!
        assertEquals("https://ai.example.com/v1", c.endpoint)
        assertEquals("sk-1", c.key)
        assertEquals("", SecureAi.parseCustom("""{"endpoint":"https://ai.example.com/v1","key":""}""")!!.key)
        assertNull(SecureAi.parseCustom("""{"endpoint":"http://ai.example.com/v1","key":"k"}"""))
        assertNull(SecureAi.parseCustom("""{"endpoint":"https://ai.example.com/v1","key":"k","x":1}"""))
        assertNull(SecureAi.parseCustom("""{"endpoint":"https://ai.example.com/v1","key":"bad key"}"""))
        assertNull(SecureAi.parseCustom("not json"))
    }

    @Test
    fun customIsAKnownSecretButNotAWindowsProvider() {
        assertEquals("custom", SecureAi.providerOfSecret("ai.custom"))
        assertNull(SecureAi.providerOfSecret("ai.evil"))
        assertNull(SecureAi.PROVIDERS.firstOrNull { it == "custom" })
    }
}
