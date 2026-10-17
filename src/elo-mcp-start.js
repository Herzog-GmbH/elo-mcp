/* elo-mcp-start.js - Hauptschleife des ELO-MCP-Servers. Wird als letzte Datei geladen
 * (nach elo.js, elo-mcp.js, elo-mcp-schreiben.js und elo-mcp-bauen.js). */

log("gestartet, Server " + S(java.lang.System.getenv("ELO_IX_URL")) + ", " + freieWerkzeuge().length + " von " + TOOLS.length + " Werkzeugen (Stufen " + stufenText() + ")");
var line;
while ((line = IN.readLine()) !== null) {
  line = S(line);
  if (!trim(line)) continue;
  var msg;
  try { msg = JSON.parse(line); } catch (e) { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Kein gueltiges JSON" } }); continue; }
  var answer;
  try { answer = handle(msg); } catch (e) { answer = { jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: errText(e) } }; }
  if (answer) send(answer);
}
log("stdin geschlossen, beende");
try { ELO.close(); } catch (e) {}
// Die IX-Verbindung haelt Hintergrund-Threads; ohne exit bleibt die JVM noch lange stehen.
java.lang.System.exit(0);
