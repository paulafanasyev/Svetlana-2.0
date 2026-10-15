package ru.svetlana.app

import android.os.SystemClock

/** Не больше max вызовов за окно (по умолчанию минута) — как rate_ok в secure_ai.rs. */
class RateLimit(private val max: Int, private val windowMs: Long = 60_000L) {
    private val calls = ArrayDeque<Long>()

    @Synchronized
    fun ok(): Boolean {
        val now = SystemClock.elapsedRealtime()
        while (calls.isNotEmpty() && now - calls.first() > windowMs) calls.removeFirst()
        if (calls.size >= max) return false
        calls.addLast(now)
        return true
    }
}
