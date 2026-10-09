package ru.svetlana.hands

/** Node.js (nodejs-mobile) внутри приложения: на нём работает то же ядро Светланы, что на компьютере. */
object NodeBridge {
    init { System.loadLibrary("node"); System.loadLibrary("svbridge") }
    @JvmStatic external fun startNode(args: Array<String>, env: Array<String>, log: String): Int
}
