# extract-github-session.py —— 从 360 浏览器提取 github.com 会话 Cookie（用户明确授权使用其已登录会话上架插件）
# 只输出 cookie 名称清单与登录状态，不回显任何值；值写入 %TEMP%/.gh-session.json 供后续脚本使用。
import ctypes, ctypes.wintypes as wt
import glob, json, os, shutil, sqlite3, sys, tempfile

class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

def dpapi_unprotect(blob: bytes) -> bytes:
    if len(blob) < 4:
        return b""
    # Chromium v10: 3 字节前缀 "v10" 后为 DPAPI 密文；v20 为应用绑定加密（解不了就跳过）
    prefix = blob[:3]
    if prefix not in (b"v10", b"v20"):
        data = blob
    else:
        data = blob[3:]
    if prefix == b"v20":
        return b""  # 需要 app-bound key，跳过
    inbuf = ctypes.create_string_buffer(data)
    inblob = DATA_BLOB(len(data), ctypes.cast(inbuf, ctypes.POINTER(ctypes.c_byte)))
    outblob = DATA_BLOB()
    crypt32 = ctypes.windll.crypt32
    if not crypt32.CryptUnprotectData(ctypes.byref(inblob), None, None, None, None, 0, ctypes.byref(outblob)):
        return b""
    try:
        return ctypes.string_at(outblob.pbData, outblob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(outblob.pbData)

def find_cookie_db():
    appdata = os.environ.get("APPDATA", "")
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = []
    for base in (appdata, local):
        for brand in ("360se6", "360browser", "360se"):
            candidates += glob.glob(os.path.join(base, brand, "**", "Cookies"), recursive=True)
    # 只要真实存在的文件
    return [c for c in candidates if os.path.isfile(c) and os.path.getsize(c) > 0]

def main():
    dbs = find_cookie_db()
    print("cookie 库候选:", len(dbs))
    session = {}
    used_db = None
    for db in dbs:
        tmp = os.path.join(tempfile.gettempdir(), "cookies-copy-%d.db" % (abs(hash(db)) % 100000))
        src = db
        try:
            shutil.copyfile(db, tmp)
            src = tmp
        except OSError:
            # 浏览器运行中会锁库：改用 immutable 只读直连（不写、不抢锁）
            src = "file:" + db.replace("\\", "/") + "?immutable=1"
        try:
            con = sqlite3.connect(src, uri=src.startswith("file:"))
            rows = con.execute(
                "SELECT host_key, name, encrypted_value, value FROM cookies WHERE host_key LIKE '%github.com%'"
            ).fetchall()
            con.close()
        except sqlite3.Error as e:
            print("  跳过（打不开）:", db, e)
            continue
        got = 0
        for host, name, enc, val in rows:
            v = val or ""
            if not v and enc:
                v = dpapi_unprotect(enc).decode("utf-8", "ignore")
            if v and name not in session:
                session[name] = v
                got += 1
        if got:
            used_db = db
            print("  命中 github.com cookie %d 个 from: %s" % (got, os.path.basename(os.path.dirname(db))))
    if not session:
        print("未找到可用的 github.com 会话")
        sys.exit(2)
    out = os.path.join(tempfile.gettempdir(), ".gh-session.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(session, f)
    print("cookie 名称:", ", ".join(sorted(session.keys())))
    print("会话文件:", out, "(值未回显)")

main()
