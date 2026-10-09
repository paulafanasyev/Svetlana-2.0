package ru.svetlana.hands

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Настройки «Рук». Ключ устройства шифруется ключом из Android Keystore (AES-GCM), доступы по умолчанию выключены. */
class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("hands", Context.MODE_PRIVATE)
    var url: String get() = p.getString("url", "") ?: ""; set(v) = p.edit().putString("url", v.trim()).apply()
    var token: String
        get() = p.getString("token_enc", null)?.let { runCatching { decrypt(it) }.getOrNull() } ?: ""
        set(v) = p.edit().putString("token_enc", encrypt(v.trim())).apply()
    var deviceId: String get() = p.getString("device_id", "") ?: ""; set(v) = p.edit().putString("device_id", v).apply()
    /** «Руки» подключены к другому серверу Светланы (VPS), а не к ядру в этом телефоне. */
    var remote: Boolean get() = p.getBoolean("remote", false); set(v) = p.edit().putBoolean("remote", v).apply()
    var allowControl: Boolean get() = p.getBoolean("control", false); set(v) = p.edit().putBoolean("control", v).apply()
    var allowScreen: Boolean get() = p.getBoolean("screen", false); set(v) = p.edit().putBoolean("screen", v).apply()

    fun capabilities(): List<String> = buildList {
        if (allowScreen) { add("screen"); add("tree") }
        add("apps")
        if (allowControl) add("control") // clipboard.get на Android 10+ недоступен фоновой службе — не объявляем
    }

    /** Только wss://, кроме ядра в этом же телефоне и локальной отладки. */
    fun urlError(u: String = url): String? {
        val uri = runCatching { java.net.URI(u.trim()) }.getOrNull() ?: return "неверный адрес"
        val host = uri.host ?: return "в адресе нет сервера"
        if (uri.path != "/ws/device") return "адрес должен заканчиваться на /ws/device"
        return when {
            uri.scheme == "wss" -> null
            uri.scheme == "ws" && host in setOf("localhost", "127.0.0.1", "10.0.2.2") -> null
            else -> "нужен адрес wss:// (шифрованное соединение)"
        }
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return gen.generateKey()
    }
    private fun encrypt(s: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(c.doFinal(s.toByteArray()), Base64.NO_WRAP)
    }
    private fun decrypt(s: String): String {
        val (iv, data) = s.split(":", limit = 2)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        return String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)))
    }
    companion object { private const val ALIAS = "svetlana_hands_token" }
}
