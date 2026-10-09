package android.print

import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import java.io.File

/**
 * Печать WebView в PDF без диалога. Колбэки PrintDocumentAdapter нельзя создать вне пакета android.print,
 * поэтому этот маленький помощник живёт здесь (известный приём, работает на Android 5+).
 */
object PdfPrinter {
    fun print(adapter: PrintDocumentAdapter, attrs: PrintAttributes, out: File, done: (Boolean, String?) -> Unit) {
        adapter.onStart()
        adapter.onLayout(null, attrs, CancellationSignal(), object : PrintDocumentAdapter.LayoutResultCallback() {
            override fun onLayoutFinished(info: PrintDocumentInfo, changed: Boolean) {
                val fd = try { ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE or ParcelFileDescriptor.MODE_READ_WRITE) }
                catch (e: Exception) { adapter.onFinish(); done(false, e.message); return }
                adapter.onWrite(arrayOf(PageRange.ALL_PAGES), fd, CancellationSignal(), object : PrintDocumentAdapter.WriteResultCallback() {
                    override fun onWriteFinished(pages: Array<out PageRange>) { runCatching { fd.close() }; adapter.onFinish(); done(true, null) }
                    override fun onWriteFailed(error: CharSequence?) { runCatching { fd.close() }; adapter.onFinish(); done(false, error?.toString()) }
                    override fun onWriteCancelled() { runCatching { fd.close() }; adapter.onFinish(); done(false, "отменено") }
                })
            }
            override fun onLayoutFailed(error: CharSequence?) { adapter.onFinish(); done(false, error?.toString()) }
            override fun onLayoutCancelled() { adapter.onFinish(); done(false, "отменено") }
        }, null)
    }
}
