package ru.svetlana.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorTextTest {
    @Test
    fun keyEchoedByProviderIsHidden() {
        val key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"
        val out = ErrorText.scrub("Incorrect API key provided: $key. See docs", listOf(key))
        assertFalse(out.contains(key))
        assertFalse(out.contains("abcdefghijklmnop"))
        assertTrue(out.contains("Incorrect API key provided"))
        assertTrue(out.contains(ErrorText.HIDDEN))
    }

    @Test
    fun keyLikeStringsAreHiddenEvenIfNotOurs() {
        val out = ErrorText.scrub("bad token Bearer gsk_ABCDEFGHIJKLMNOPQRSTUV here", emptyList())
        assertFalse(out.contains("ABCDEFGHIJKLMNOP"))
        assertTrue(out.endsWith(" here"))
    }

    @Test
    fun bidiAndInvisibleCharsAreRemoved() {
        assertEquals("abcd", ErrorText.clean("a\u202Eb\u2066c\u200Bd"))
        assertEquals("ab", ErrorText.clean("a\nb"))
    }

    @Test
    fun errorTextIsShort() {
        assertEquals(ErrorText.MAX_ERROR, ErrorText.scrub("я".repeat(1000), emptyList()).length)
    }

    @Test
    fun consentPreviewHasNoBidi() {
        val body = JSONObject().put("message", "оплати\u202Eсчёт")
        assertEquals("оплатисчёт", SecureAi.previewOf("svetlana", body))
    }
}
