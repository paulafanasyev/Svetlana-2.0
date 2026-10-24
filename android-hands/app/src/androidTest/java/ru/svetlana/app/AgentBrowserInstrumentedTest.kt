package ru.svetlana.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * End-to-end smoke test of the real Android System WebView adapter on an emulator.
 * This verifies public navigation and DOM text extraction, not just that adapter strings exist in DEX.
 */
@RunWith(AndroidJUnit4::class)
class AgentBrowserInstrumentedTest {
    @Test
    fun opensPublicPageAndReturnsItsTextToTheAgentToolCallback() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val status = call(scenario, "browser_worker_status", JSONObject())
            assertEquals("android-webview-browser", (status as JSONObject).getString("service"))

            val created = call(
                scenario,
                "browser_create_session",
                JSONObject().put("agentId", "emulator-smoke")
            ) as JSONObject
            val sessionId = created.getString("sessionId")
            assertTrue("Browser session must be isolated", created.getBoolean("isolated"))

            try {
                val result = call(
                    scenario,
                    "browser_navigate",
                    JSONObject().put("sessionId", sessionId).put("url", "https://example.com/")
                ) as JSONObject
                assertTrue("Navigation result should be successful", result.optBoolean("success"))
                val observation = result.getJSONObject("observation")
                assertTrue("Unexpected URL: ${observation.getString("url")}", observation.getString("url").startsWith("https://example.com"))
                assertEquals("Example Domain", observation.getString("title"))
                assertTrue(
                    "Navigation snapshot must contain public page body text; observation=$observation",
                    observation.getString("text").contains("This domain is for use in documentation examples")
                )

                // The chat panel calls browser_snapshot immediately after session creation;
                // ensure the native adapter preserves the shared { success, observation } contract.
                val snapshotResult = call(
                    scenario,
                    "browser_snapshot",
                    JSONObject().put("sessionId", sessionId)
                ) as JSONObject
                assertTrue("Snapshot tool result must have success=true", snapshotResult.optBoolean("success"))
                val snapshot = snapshotResult.getJSONObject("observation")
                assertTrue("Snapshot tool must return a URL", snapshot.getString("url").startsWith("https://example.com"))
                assertTrue(
                    "Snapshot tool must return body text; snapshot=$snapshot",
                    snapshot.getString("text").contains("This domain is for use in documentation examples")
                )
            } finally {
                call(scenario, "browser_close_session", JSONObject().put("sessionId", sessionId))
            }
        }
    }

    private fun call(
        scenario: ActivityScenario<MainActivity>,
        command: String,
        args: JSONObject,
    ): Any? {
        val latch = CountDownLatch(1)
        val result = AtomicReference<Pair<Boolean, Any?>?>()
        scenario.onActivity { activity ->
            activity.agentBrowser.handle(command, args) { ok, value ->
                result.set(ok to value)
                latch.countDown()
            }
        }
        assertTrue("Timed out waiting for $command", latch.await(40, TimeUnit.SECONDS))
        val (ok, value) = result.get() ?: throw AssertionError("No callback for $command")
        assertTrue("$command failed: $value", ok)
        return value
    }
}
