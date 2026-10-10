plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}

// Ошибки сборки → аннотации GitHub Actions: видны на странице запуска без чтения логов.
fun annotate(task: String, line: CharSequence) {
    val s = line.toString().trim()
    if (s.startsWith("::")) return
    if (s.startsWith("e: ") || s.contains(" error: ") || s.startsWith("error:") || s.contains("CMake Error") || s.contains("FAILED:"))
        System.out.println("::error title=$task::" + s.replace("\r", " ").replace("\n", " ").take(900))
}
allprojects {
    tasks.configureEach {
        val name = this.name
        logging.addStandardOutputListener { annotate(name, it) }
        logging.addStandardErrorListener { annotate(name, it) }
    }
}
@Suppress("DEPRECATION")
gradle.addBuildListener(object : org.gradle.BuildAdapter() {
    override fun buildFinished(result: org.gradle.BuildResult) {
        var e: Throwable? = result.failure
        var depth = 0
        while (e != null && depth < 6) { System.out.println("::error title=gradle::" + (e.message ?: e.javaClass.name).replace("\n", " ").take(900)); e = e.cause; depth++ }
    }
})
