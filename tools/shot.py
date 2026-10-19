"""
shot.py — headless-Chrome screenshots of the story map at given clock times
(dev helper; needs a Python with `websockets`).

    python tools/shot.py OUT_DIR 16:20 16:45@crash_close 17:40@heli ...

Each arg is HH:MM[@camera]; camera names match app.js camera().
Also prints page console errors.
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

from websockets.sync.client import connect

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8020/"
PORT = 9333


def cdp_target():
    for _ in range(60):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
            for t in tabs:
                if t["type"] == "page":
                    return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("chrome not reachable")


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    prof = os.path.join(out, "_profile")
    proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}",
                             "--window-size=1600,900", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
                             "--hide-scrollbars", "about:blank"])
    try:
        ws = connect(cdp_target(), max_size=2 ** 26)
        mid = [0]
        logs = []

        def send(method, params=None):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
            while True:
                m = json.loads(ws.recv(timeout=120))
                if m.get("id") == mid[0]:
                    if "error" in m:
                        raise RuntimeError(m["error"])
                    return m.get("result", {})
                if m.get("method") == "Runtime.exceptionThrown":
                    logs.append(m["params"]["exceptionDetails"].get("exception", {}).get("description", str(m["params"])))
                if m.get("method") == "Runtime.consoleAPICalled" and m["params"]["type"] in ("error", "warning"):
                    logs.append(" ".join(str(a.get("value", a.get("description", ""))) for a in m["params"]["args"]))

        def ev(expr):
            r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
            return r.get("result", {}).get("value")

        send("Runtime.enable"); send("Page.enable")
        send("Emulation.setDeviceMetricsOverride", {"width": 1600, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        send("Page.navigate", {"url": URL})
        for _ in range(120):
            time.sleep(0.5)
            if ev("!!(window.__rv25 && document.getElementById('loading').classList.contains('hidden'))"):
                break
        time.sleep(4)
        for spec in sys.argv[2:]:
            if spec.startswith("js:"):
                print("js ->", ev(spec[3:]))
                time.sleep(1.5)
                continue
            if spec.startswith("png:"):
                png = send("Page.captureScreenshot", {"format": "png"})["data"]
                open(os.path.join(out, spec[4:] + ".png"), "wb").write(base64.b64decode(png))
                continue
            tm, _, cam = spec.partition("@")
            h, m = map(int, tm.split(":"))
            ev(f"(()=>{{const r=window.__rv25; r.seek({h * 60 + m}); r.S.lastEventIdx=-2; return 1}})()")
            if cam:
                ev(f"(window.__rv25.camera('{cam}'), 1)")
            time.sleep(5.5 if cam else 2.5)
            png = send("Page.captureScreenshot", {"format": "png"})["data"]
            fn = os.path.join(out, f"shot_{h:02d}{m:02d}{('_' + cam) if cam else ''}.png")
            open(fn, "wb").write(base64.b64decode(png))
            print("saved", fn)
        print("console:", *logs[:30], sep="\n  ")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
