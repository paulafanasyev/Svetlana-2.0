"""Режим «всё на этом компьютере»: настоящий node поднимает ядро, LocalCore сам выдаёт ключ устройства, ws пускает только с ним.

Запуск из core/:  python3 test/local_core_check.py   (SVETLANA_CORE_DIR по умолчанию — папка core)
"""
import json, os, socket, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp(prefix="svetlana-local-")
os.environ["APPDATA"] = tmp
os.environ.setdefault("SVETLANA_CORE_DIR", os.path.abspath(os.path.join(HERE, "..")))
sys.path.insert(0, os.environ.get("SVETLANA_AGENT_DIR") or os.path.join(HERE, "..", "desktop-agent"))
import local_core


def ws_status(port, token):
    s = socket.create_connection(("127.0.0.1", port), timeout=5)
    q = f"?token={token}" if token else ""
    s.sendall((f"GET /ws/device{q} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    buf = b""
    while b"\r\n" not in buf and len(buf) < 4096:
        chunk = s.recv(512)
        if not chunk:
            break
        buf += chunk
    s.close()
    line = buf.decode("latin1").split("\r\n")[0]
    return int(line.split()[1]) if line.startswith("HTTP/") else 0


# свободный порт, чтобы не мешать соседним тестам
with socket.socket() as s:
    s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
logs = []
lc = local_core.LocalCore(port=port, log=logs.append)
assert len(lc.admin_token) >= 16, "пароль владельца сгенерирован"
try:
    assert lc.start(wait=40), "ядро запустилось"
    assert lc.healthy() and lc.ours(), "это наше ядро и оно принимает наш пароль"
    if sys.platform == "win32":
        assert lc._job, "ядро привязано к Светлане (Job Object): закроют её — закроется и ядро"
    prov = json.load(open(os.path.join(lc.data, "providers.json"), encoding="utf-8"))
    assert prov[0]["preset"] == "ollama" and "vision" in prov[0]["capabilities"], prov
    assert any(p.get("id") == "local" for p in lc._req("GET", "/api/providers")), "ядро видит локального провайдера"
    t1 = lc.ensure_device("тест-ПК")
    assert t1.startswith("dev_")
    assert lc.ensure_device("тест-ПК") == t1, "повторный запуск не плодит устройства"
    assert len(lc._req("GET", "/api/devices")) == 1
    assert ws_status(lc.port, t1) == 101, "руки и глаза подключаются по выданному ключу"
    assert ws_status(lc.port, "dev_xxx") == 401, "чужой ключ не пускает"
    assert ws_status(lc.port, None) == 401, "без ключа не пускает"
    # модель сменили в окне, пока ядро не работало: при старте провайдер «local» подтягивается
    local_core.sync_model(lc, "qwen3-vl:4b")
    assert next(p for p in lc._req("GET", "/api/providers") if p["id"] == "local")["model"] == "qwen3-vl:4b"
    # второй экземпляр видит уже работающее ядро и не запускает дубль
    lc2 = local_core.LocalCore(port=port, log=logs.append)
    assert lc2.admin_token == lc.admin_token and lc2.start() and lc2.proc is None
    # ядро слушает только 127.0.0.1
    assert lc.env()["HOST"] == "127.0.0.1" and int(lc.env()["SVETLANA_MAX_STEPS"]) >= 30
    # Светлана-разработчица: команды в папке проектов (каждая — с подтверждением), папка видна в Документах
    assert lc.env()["SVETLANA_ALLOW_HOST_EXEC"] == "1" and os.path.isdir(lc.env()["SVETLANA_WORKSPACE"]), lc.env()["SVETLANA_WORKSPACE"]
finally:
    lc.stop()
assert not lc.healthy(), "ядро остановлено"
print("OK")
