package ru.svetlana.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** В окне подтверждения виден весь текст, который будет напечатан; слишком длинный текст от ИИ не принимается. */
class StepsTypeFullTest {
    @Test fun titleShowsWholeText() {
        val text = "Привет! " + "а".repeat(200) + " СКРЫТЫЙ_ХВОСТ"
        val step = Step.Type(text, null)
        assertTrue(step.title.contains("СКРЫТЫЙ_ХВОСТ"))
        assertTrue(step.title.contains("(${text.length} симв.)"))
    }

    @Test fun tooLongAiTextIsRefused() {
        val long = "x".repeat(Steps.MAX_TYPE + 1)
        val steps = Steps.parse(JSONObject().put("actions", org.json.JSONArray().put(JSONObject().put("type", "type").put("text", long))))
        assertEquals(0, steps.size)
        val ok = Steps.parse(JSONObject().put("actions", org.json.JSONArray().put(JSONObject().put("type", "type").put("text", "привет"))))
        assertEquals(1, ok.size)
    }

    @Test fun tooLongQuickTypeIsRefused() {
        assertNull(Steps.quick("напечатай " + "x".repeat(Steps.MAX_TYPE + 1)))
    }
}
