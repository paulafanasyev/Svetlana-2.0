package ru.svetlana.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Ключи хранятся зашифрованными AES-GCM ключом из Android Keystore (ключ шифрования не покидает телефон). */
object SecretStore {
    private const val ALIAS = "svetlana_secret_v1"
    private const val PREFS = "svetlana_secure"

    /** Синхронно: первое обращение из нескольких потоков не создаст два разных ключа с одним именем. */
    @Synchronized
    private fun masterKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    @Synchronized
    fun put(ctx: Context, name: String, value: String?) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (value.isNullOrEmpty()) {
            prefs.edit().remove(name).commit()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, masterKey())
        val data = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val packed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(data, Base64.NO_WRAP)
        prefs.edit().putString(name, packed).commit()
    }

    fun get(ctx: Context, name: String): String? {
        val packed = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(name, null) ?: return null
        return try {
            val parts = packed.split(":", limit = 2)
            if (parts.size != 2) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * «Удалить всё»: стирает все зашифрованные записи и уничтожает сам ключ в Android Keystore:
     * даже восстановленные старые записи расшифровать больше нечем. Возвращает число удалённых записей.
     */
    @Synchronized
    fun clearAll(ctx: Context): Int {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val n = prefs.all.size
        prefs.edit().clear().commit()
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
        return n
    }
}

object Keys {
    private const val SVETLANA = "svetlana_server_key"
    fun svetlana(ctx: Context): String? = SecretStore.get(ctx, SVETLANA)?.takeIf { it.isNotBlank() }
    fun setSvetlana(ctx: Context, key: String?) = SecretStore.put(ctx, SVETLANA, key?.trim())
}
