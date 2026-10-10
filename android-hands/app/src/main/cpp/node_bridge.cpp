// Запуск ядра Светланы (Node.js) внутри приложения: аргументы, окружение и журнал в файл. node::Start вызывается один раз за процесс.
#include <jni.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#ifndef SV_NO_NODE
#include "node.h"
#endif

static std::string str(JNIEnv* env, jstring s) {
  const char* c = env->GetStringUTFChars(s, nullptr); std::string out(c ? c : ""); env->ReleaseStringUTFChars(s, c); return out;
}

extern "C" JNIEXPORT jint JNICALL
Java_ru_svetlana_hands_NodeBridge_startNode(JNIEnv* env, jclass, jobjectArray jargs, jobjectArray jenv, jstring jlog) {
  for (jsize i = 0, n = env->GetArrayLength(jenv); i < n; i++) {
    auto s = (jstring)env->GetObjectArrayElement(jenv, i); std::string kv = str(env, s); env->DeleteLocalRef(s);
    auto eq = kv.find('='); if (eq != std::string::npos) setenv(kv.substr(0, eq).c_str(), kv.substr(eq + 1).c_str(), 1);
  }
  int fd = open(str(env, jlog).c_str(), O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (fd >= 0) { dup2(fd, 1); dup2(fd, 2); close(fd); setvbuf(stdout, nullptr, _IONBF, 0); setvbuf(stderr, nullptr, _IONBF, 0); }
  // libuv требует, чтобы строки argv лежали в памяти подряд
  jsize argc = env->GetArrayLength(jargs); std::vector<std::string> a(argc); size_t total = 0;
  for (jsize i = 0; i < argc; i++) { auto s = (jstring)env->GetObjectArrayElement(jargs, i); a[i] = str(env, s); env->DeleteLocalRef(s); total += a[i].size() + 1; }
  char* buf = (char*)calloc(total, 1); std::vector<char*> argv(argc + 1, nullptr); char* p = buf;
  for (jsize i = 0; i < argc; i++) { memcpy(p, a[i].c_str(), a[i].size()); argv[i] = p; p += a[i].size() + 1; }
#ifdef SV_NO_NODE
  return -2;
#else
  return node::Start(argc, argv.data());
#endif
}
