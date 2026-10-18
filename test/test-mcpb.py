"""Startet ein gebautes MCPB-Paket so, wie Claude Desktop es startet, und ruft Werkzeuge auf.

    python -I test\\test-mcpb.py dist\\elo-mcp-<version>.mcpb [aufrufe.json | --liste] -- ix_url=<url> [schreiben=true] [bauen=true]
                                                            [credential_file=<pfad>] [client_dir=<pfad>] [archiv=<name>]
                                                            [name=<kurz> ix_url2=<url> name2=<kurz> schreiben2=true bauen2=true ...]

Statt der .mcpb geht auch ein entpackter Ordner, z. B. die von Claude Desktop installierte Kopie unter
%APPDATA%\\Claude\\Claude Extensions\\<id>. Entpackt das Paket in einen Temp-Ordner, setzt die Einstellungen (user_config) wie der MCPB-Standard
ein (${__dirname}, ${user_config.x}, Schalter als "true"/"false", nicht gesetzte Felder bleiben als
Platzhalter stehen) und startet command/args/env aus manifest.json.

Ohne aufrufe.json: initialize, tools/list und elo_whoami. Mit --liste: nur initialize und tools/list,
ohne Verbindung zu ELO. aufrufe.json wie bei test-mcp.py: Liste von [name, argumente].
"""
import json, os, re, shutil, subprocess, sys, tempfile, zipfile

sys.stdout.reconfigure(encoding="utf-8")
LIMIT = int(os.environ.get("MCP_TEST_LIMIT", "900"))
argv = sys.argv[1:]
konfig_args = argv[argv.index("--") + 1:] if "--" in argv else []
argv = argv[:argv.index("--")] if "--" in argv else argv
if not argv:
    sys.exit(__doc__)
paket = argv[0]
if len(argv) > 1 and argv[1] == "--liste":
    calls = []
elif len(argv) > 1:
    calls = json.load(open(argv[1], encoding="utf-8"))
else:
    calls = [["elo_whoami", {}]]

if os.path.isdir(paket):
    # schon entpackt, z. B. die von Claude Desktop installierte Kopie: nur benutzen, nicht loeschen
    ordner, aufraeumen = os.path.abspath(paket), False
else:
    ordner, aufraeumen = tempfile.mkdtemp(prefix="elo-mcpb-"), True
    with zipfile.ZipFile(paket) as z:
        z.extractall(ordner)
manifest = json.load(open(os.path.join(ordner, "manifest.json"), encoding="utf-8"))

# Einstellungen: erst Vorgaben aus dem Manifest, dann die Angaben von der Befehlszeile.
schema = manifest.get("user_config", {})
werte = {k: v["default"] for k, v in schema.items() if "default" in v}
for a in konfig_args:
    k, _, v = a.partition("=")
    if k not in schema:
        sys.exit("unbekannte Einstellung: " + k + " (bekannt: " + ", ".join(schema) + ")")
    werte[k] = (v.lower() == "true") if schema[k]["type"] == "boolean" else v
if len(argv) == 1 and werte.get("ix_url2"):
    calls.append(["elo_whoami", {"archiv": werte.get("name2") or "2"}])   # Standardaufruf auch fuers zweite Archiv
fehlt = [k for k, v in schema.items() if v.get("required") and werte.get(k) in (None, "")]
if fehlt:
    sys.exit("Pflichtangabe fehlt: " + ", ".join(fehlt))

home = os.path.expanduser("~")
var = {"__dirname": ordner, "pathSeparator": os.sep, "/": os.sep, "HOME": home,
       "DESKTOP": os.path.join(home, "Desktop"), "DOCUMENTS": os.path.join(home, "Documents"),
       "DOWNLOADS": os.path.join(home, "Downloads")}
for k, v in werte.items():
    var["user_config." + k] = ("true" if v else "false") if isinstance(v, bool) else str(v)

def ersetze(s):
    return re.sub(r"\$\{([^}]+)\}", lambda m: var.get(m.group(1), m.group(0)), s)

def ersetze_arg(s):
    # Wie der MCPB-Standard: ein Argument, das nur aus einem Platzhalter besteht, bleibt bei leerem Wert stehen.
    m = re.fullmatch(r"\$\{([^}]+)\}", s)
    if m:
        return var[m.group(1)] if var.get(m.group(1)) else s
    return ersetze(s)

cfg = dict(manifest["server"]["mcp_config"])
cfg.update(cfg.get("platform_overrides", {}).get(sys.platform, {}))
befehl = [ersetze(cfg["command"])] + [ersetze_arg(a) for a in cfg.get("args", [])]
umgebung = dict(os.environ)
umgebung.update({k: ersetze(v) for k, v in cfg.get("env", {}).items()})
print("Paket:", manifest["name"], manifest["version"], "entpackt nach", ordner)
print("Start:", " ".join(befehl))

p = subprocess.Popen(befehl, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                     text=True, encoding="utf-8", env=umgebung, cwd=ordner)

def rpc(i, method, params=None):
    msg = {"jsonrpc": "2.0", "id": i, "method": method}
    if params is not None:
        msg["params"] = params
    p.stdin.write(json.dumps(msg) + "\n"); p.stdin.flush()
    zeile = p.stdout.readline()
    if not zeile:
        sys.exit("Server hat sich beendet - Log: dieselbe Befehlszeile mit stderr starten")
    return json.loads(zeile)

fehler = 0
try:
    init = rpc(0, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test-mcpb", "version": "1"}})
    p.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); p.stdin.flush()
    print("Server:", init["result"]["serverInfo"])
    tools = rpc(1, "tools/list")["result"]["tools"]
    print("Werkzeuge:", len(tools), " ".join(t["name"] for t in tools))
    for n, (name, args) in enumerate(calls, start=2):
        r = rpc(n, "tools/call", {"name": name, "arguments": args})["result"]
        txt = r["content"][0]["text"]
        fehler += 1 if r.get("isError") else 0
        print(f"\n### {name} {json.dumps(args, ensure_ascii=False)} {'FEHLER' if r.get('isError') else 'ok'}")
        print(txt[:LIMIT] + (" ..." if len(txt) > LIMIT else ""))
finally:
    p.stdin.close()
    p.wait(timeout=60)
    if aufraeumen:
        shutil.rmtree(ordner, ignore_errors=True)
print(f"\n{len(calls)} Aufrufe, {fehler} mit Fehler, Exit {p.returncode}")
sys.exit(1 if fehler else 0)
