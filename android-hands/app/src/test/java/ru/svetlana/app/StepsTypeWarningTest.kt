package ru.svetlana.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ввод и очистка текста в чужом приложении всегда получают отдельное предупреждение в окне подтверждения. */
class StepsTypeWarningTest {
    @Test fun typingIsFlagged() {
        assertTrue(Steps.typesText(listOf(Step.Type("1234", null))))
        assertTrue(Steps.typesText(listOf(Step.Scroll(true), Step.Clear("Пароль"))))
    }

    @Test fun readingIsNotFlagged() {
        assertFalse(Steps.typesText(listOf(Step.ReadScreen, Step.Scroll(false), Step.Tap("Далее"))))
    }

    @Test fun warningNamesSecrets() {
        assertTrue(Steps.TYPE_WARNING.contains("пароль"))
    }
}
