package ru.svetlana.app

import android.content.Context
import android.provider.ContactsContract.CommonDataKinds.Phone
import org.json.JSONArray
import org.json.JSONObject

/**
 * Контакты этого телефона для CRM (то же, что «Импорт с телефона» в Windows через Svetlana-home).
 * Только имя и номера, только после разрешения Android «Контакты» и нативного подтверждения (Bridge).
 * Текст очищается от управляющих и bidi-символов, количество ограничено.
 */
object Contacts {
    const val MAX = 10_000
    private const val MAX_PHONES = 10

    fun list(ctx: Context): JSONObject {
        val byId = LinkedHashMap<String, Pair<String, MutableList<String>>>()
        val proj = arrayOf(Phone.CONTACT_ID, Phone.DISPLAY_NAME_PRIMARY, Phone.NUMBER)
        val c = ctx.contentResolver.query(Phone.CONTENT_URI, proj, null, null, "${Phone.DISPLAY_NAME_PRIMARY} ASC")
            ?: throw SecureAi.Fail("Не удалось прочитать контакты телефона")
        try {
            while (c.moveToNext()) {
                val id = c.getString(0) ?: continue
                if (!byId.containsKey(id) && byId.size >= MAX) continue
                val name = Steps.safe(c.getString(1) ?: "", 200)
                val num = Steps.safe(c.getString(2) ?: "", 40)
                val e = byId.getOrPut(id) { name to ArrayList() }
                if (num.isNotEmpty() && e.second.size < MAX_PHONES && num !in e.second) e.second.add(num)
            }
        } finally {
            c.close()
        }
        val arr = JSONArray()
        for ((id, v) in byId) {
            val name = v.first.ifBlank { v.second.firstOrNull() ?: "" }
            if (name.isBlank()) continue
            arr.put(JSONObject().put("id", id).put("name", name).put("phones", JSONArray(v.second)))
        }
        return JSONObject().put("total", arr.length()).put("contacts", arr)
    }
}
