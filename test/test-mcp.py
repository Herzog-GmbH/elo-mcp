"""Testlauf gegen ein echtes ELO: startet elo-mcp.ps1, ruft Werkzeuge nacheinander auf, zeigt gekuerzte Antworten.

    python -I test\\test-mcp.py [aufrufe.json] [-- <Argumente fuer elo-mcp.ps1>]

aufrufe.json ist eine Liste von [name, argumente]. Ohne Datei: nur initialize + tools/list.
Platzhalter in den Argumenten: "$TOKEN" = token der letzten Vorschau, "$TOKEN-1" = der vorletzten,
"$ID" = id aus dem letzten Ergebnis, "$WF" = workflowId aus dem letzten Ergebnis.
Beispiel: python -I test\\test-mcp.py test\\beispiel-lesen.json -- -IxUrl https://elo.example.com:9093/ix-Archiv/ix
"""
import json, subprocess, sys, os

sys.stdout.reconfigure(encoding="utf-8")  # python -I ignoriert PYTHONIOENCODING
LIMIT = int(os.environ.get("MCP_TEST_LIMIT", "900"))
here = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[1:]
ps_args = argv[argv.index("--") + 1:] if "--" in argv else []
argv = argv[:argv.index("--")] if "--" in argv else argv
calls = json.load(open(argv[0], encoding="utf-8")) if argv else []
p = subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", os.path.join(here, "..", "elo-mcp.ps1")] + ps_args,
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8")

def rpc(i, method, params=None):
    msg = {"jsonrpc": "2.0", "id": i, "method": method}
    if params is not None:
        msg["params"] = params
    p.stdin.write(json.dumps(msg) + "\n"); p.stdin.flush()
    zeile = p.stdout.readline()
    if not zeile:
        sys.exit("elo-mcp.ps1 hat sich beendet - Meldung siehe: powershell -File elo-mcp.ps1 " + " ".join(ps_args))
    return json.loads(zeile)

init = rpc(0, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}})
p.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); p.stdin.flush()
print("Server:", init["result"]["serverInfo"])
tools = rpc(1, "tools/list")["result"]["tools"]
print("Werkzeuge:", len(tools), " ".join(t["name"] for t in tools))
last = {}
fehler = 0
for n, (name, args) in enumerate(calls, start=2):
    toks = last.get("toks", [""])
    a = json.dumps(args).replace('"$TOKEN-1"', json.dumps(toks[-2] if len(toks) > 1 else ""))
    args = json.loads(a.replace('"$TOKEN"', json.dumps(last.get("token", ""))).replace('"$ID"', json.dumps(last.get("id", ""))).replace('"$WF"', json.dumps(last.get("wf", ""))))
    r = rpc(n, "tools/call", {"name": name, "arguments": args})["result"]
    txt = r["content"][0]["text"]
    try:
        d = json.loads(txt)
        if "token" in d:
            last["token"] = d["token"]; last.setdefault("toks", []).append(d["token"])
        e = d.get("ergebnis") or {}
        if "id" in e: last["id"] = e["id"]
        if "workflowId" in e: last["wf"] = e["workflowId"]
    except ValueError:
        pass
    fehler += 1 if r.get("isError") else 0
    print(f"\n### {name} {json.dumps(args, ensure_ascii=False)} {'FEHLER' if r.get('isError') else 'ok'}")
    print(txt[:LIMIT] + (" ..." if len(txt) > LIMIT else ""))
p.stdin.close(); p.wait(timeout=60)
print(f"\n{len(calls)} Aufrufe, {fehler} mit Fehler")
