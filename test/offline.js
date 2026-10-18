/*
 * offline.js - Pruefungen ohne ELO-Verbindung: Protokoll, Stufen, Vorschau und Token,
 * Datumspruefung, Bauplan- und Skriptpruefungen. Wird von test\offline.ps1 nach den Quellen geladen
 * (elo.js, elo-mcp.js, elo-mcp-schreiben.js, elo-mcp-bauen.js - ohne elo-mcp-start.js).
 */

var OUT = REAL_OUT, fehlerZahl = 0, okZahl = 0;
function pruefe(name, bedingung, info) {
  if (bedingung) { okZahl++; OUT.println("ok     " + name); }
  else { fehlerZahl++; OUT.println("FEHLER " + name + (info !== undefined ? ": " + info : "")); }
}
function enthaelt(liste, text) { for (var i = 0; i < liste.length; i++) if (String(liste[i]).indexOf(text) >= 0) return true; return false; }

/* ---------- Protokoll und Stufen ---------- */

var init = handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
pruefe("initialize: Servername", init.result.serverInfo.name === "elo");
pruefe("initialize: Protokollversion vom Client", init.result.protocolVersion === "2025-06-18");
pruefe("initialize: Hinweise nennen die Stufen", init.result.instructions.indexOf(stufenText()) >= 0, init.result.instructions);

var liste = handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }).result.tools, namen = {};
for (var i = 0; i < liste.length; i++) namen[liste[i].name] = true;
var erwartet = 13 + (SCHREIBEN_ERLAUBT ? 6 : 0) + (BAUEN_ERLAUBT ? 3 : 0);
pruefe("tools/list: " + erwartet + " Werkzeuge bei Stufen " + stufenText(), liste.length === erwartet, liste.length);
pruefe("tools/list: Schreibwerkzeug nur mit -Schreiben", !!namen.elo_set_fields === SCHREIBEN_ERLAUBT);
pruefe("tools/list: Bauwerkzeug nur mit -Bauen", !!namen.elo_workflow_build === BAUEN_ERLAUBT);
pruefe("tools/list: Lesewerkzeuge immer", !!(namen.elo_search && namen.elo_workflow_export));
for (var j = 0; j < liste.length; j++) {
  var t = liste[j];
  pruefe("Schema " + t.name, t.inputSchema && t.inputSchema.type === "object" && typeof t.description === "string" && t.description.length > 20);
}
if (!SCHREIBEN_ERLAUBT) {
  var r = callTool("elo_set_fields", { objekt: "1", name: "x" });
  pruefe("gesperrtes Werkzeug wird abgelehnt", r.isError && /nicht freigeschaltet/.test(r.content[0].text), r.content[0].text);
}
var unbekannt = handle({ jsonrpc: "2.0", id: 3, method: "gibtsnicht" });
pruefe("unbekannte Methode -> -32601", !!(unbekannt.error && unbekannt.error.code === -32601));
pruefe("Benachrichtigung ohne Antwort", handle({ jsonrpc: "2.0", method: "notifications/initialized" }) === null);

/* ---------- Mehrere Archive (Lauf "zwei Archive" in offline.ps1: dieser Prozess ist das zweite) ---------- */

if (mehrereArchive()) {
  var ins = init.result.instructions, mitParam = true, alleNamen = true, sf = null;
  pruefe("Archive: Hinweise nennen beide Archive und den Standard",
         ins.indexOf("'" + ARCHIVE[0].name + "' (Standard)") >= 0 && ins.indexOf("'" + ARCHIVE[1].name + "'") >= 0, ins);
  for (var a1 = 0; a1 < liste.length; a1++) {
    var pa = liste[a1].inputSchema.properties.archiv;
    if (!pa) mitParam = false; else if (pa.enum.join("|") !== archivNamen().join("|")) alleNamen = false;
    if (liste[a1].name === "elo_set_fields") sf = liste[a1];
  }
  pruefe("Archive: jedes Werkzeug hat den Parameter archiv", mitParam);
  pruefe("Archive: archiv bietet alle Namen an", alleNamen);
  pruefe("Archive: Schreibwerkzeug nennt das Archiv, in dem es geht", !!sf && /Nur im Archiv 'Test'/.test(sf.description), sf && sf.description);
  pruefe("Archive: Hinweis bei gesperrter Stufe nennt das Archiv", /im Archiv 'Test'/.test(freischaltHinweis(2)), freischaltHinweis(2));
  var fremd = callTool("elo_whoami", { archiv: ARCHIVE[0].name });
  pruefe("Archive: Aufruf fuer das andere Archiv abgelehnt", fremd.isError && /bedient das Archiv 'Test'/.test(fremd.content[0].text), fremd.content[0].text);
  // eigenes Archiv: der Parameter wird entfernt, bevor das Werkzeug die Argumente sieht
  tool("test_echo", "Gibt die Argumente zurueck (nur fuer den Offline-Test).", {}, [], function (a) { return a; });
  var echo = callTool("test_echo", { archiv: ARCHIV_NAME.toUpperCase(), x: "1" }), eo = JSON.parse(echo.content[0].text);
  pruefe("Archive: eigenes Archiv (Gross-/Kleinschreibung egal), archiv entfernt", !echo.isError && eo.x === "1" && eo.archiv === undefined, echo.content[0].text);
} else {
  var einzeln = callTool("elo_whoami", { archiv: "Test" });
  pruefe("ein Archiv: Parameter archiv abgelehnt", einzeln.isError && /nur ein Archiv/.test(einzeln.content[0].text), einzeln.content[0].text);
  pruefe("ein Archiv: kein Parameter archiv in tools/list", !liste[0].inputSchema.properties.archiv);
}

/* ---------- Zwei-Schritt-Ablauf (Vorschau und Token) ---------- */

function fange(f) { try { f(); return ""; } catch (e) { return e && e.userError ? String(e.userError) : String(e); } }

var TN = "test_zwei_schritte";   // kein echtes Werkzeug, gilt als Stufe 2
if (SCHREIBEN_ERLAUBT) {
  // Protokoll abfangen, damit keine Testzeilen in %LOCALAPPDATA%\elo-mcp landen
  var echtesProtokoll = protokoll, protokolle = [], fp = "A", laeufe = 0, m;
  protokoll = function (e) { protokolle.push(e); };
  var plan2 = function (a) { return { vorschau: { wert: a.wert }, fp: fp }; };
  var aus2 = function () { laeufe++; return { gemacht: laeufe }; };

  var v1 = zweiSchritte(TN, { wert: "1" }, plan2, aus2);
  pruefe("Token: erster Aufruf ist nur Vorschau", /^Vorschau/.test(v1.modus) && !!v1.token && laeufe === 0, JSON.stringify(v1));
  if (mehrereArchive()) pruefe("Token: Vorschau nennt das Archiv", v1.archiv === ARCHIV_NAME, JSON.stringify(v1));
  var r1 = zweiSchritte(TN, { wert: "1", token: v1.token }, plan2, aus2);
  pruefe("Token: zweiter Aufruf fuehrt aus", r1.modus === "ausgefuehrt" && laeufe === 1, JSON.stringify(r1));
  pruefe("Token: Ausfuehrung protokolliert", protokolle.length === 1 && protokolle[0].werkzeug === TN && !protokolle[0].fehler, JSON.stringify(protokolle));
  m = fange(function () { zweiSchritte(TN, { wert: "1", token: v1.token }, plan2, aus2); });
  pruefe("Token: nur einmal benutzbar", /schon benutzt/.test(m) && laeufe === 1, m);

  var v2 = zweiSchritte(TN, { wert: "1" }, plan2, aus2);
  m = fange(function () { zweiSchritte(TN, { wert: "2", token: v2.token }, plan2, aus2); });
  pruefe("Token: andere Argumente abgelehnt", /weichen/.test(m) && laeufe === 1, m);
  m = fange(function () { zweiSchritte(TN, { wert: "1", token: v2.token }, plan2, aus2); });
  pruefe("Token: nach Fehlversuch verbraucht", /schon benutzt/.test(m) && laeufe === 1, m);

  var v3 = zweiSchritte(TN, { wert: "1" }, plan2, aus2);
  m = fange(function () { zweiSchritte(TN + "_anders", { wert: "1", token: v3.token }, plan2, aus2); });
  pruefe("Token: anderes Werkzeug abgelehnt", /weichen/.test(m) && laeufe === 1, m);

  var v4 = zweiSchritte(TN, { wert: "1" }, plan2, aus2);
  fp = "B";
  m = fange(function () { zweiSchritte(TN, { wert: "1", token: v4.token }, plan2, aus2); });
  fp = "A";
  pruefe("Token: veraendertes Objekt abgelehnt", /geaendert/.test(m) && laeufe === 1, m);

  var v5 = zweiSchritte(TN, { wert: "1" }, plan2, aus2);
  PENDING[v5.token].ablauf = java.lang.System.currentTimeMillis() - 1;
  m = fange(function () { zweiSchritte(TN, { wert: "1", token: v5.token }, plan2, aus2); });
  pruefe("Token: abgelaufen abgelehnt", /abgelaufen/.test(m) && laeufe === 1, m);

  m = fange(function () { zweiSchritte(TN, { wert: "1", token: "gibtsnicht" }, plan2, aus2); });
  pruefe("Token: unbekanntes Token abgelehnt", /unbekannt/.test(m) && laeufe === 1, m);

  var v6 = zweiSchritte(TN, { wert: "1" }, plan2, aus2);
  m = fange(function () { zweiSchritte(TN, { wert: "1", token: v6.token }, plan2, function () { throw { userError: "absichtlich" }; }); });
  pruefe("Token: Fehler beim Ausfuehren protokolliert", /absichtlich/.test(m) && protokolle.length === 2 && protokolle[1].fehler === "absichtlich", JSON.stringify(protokolle));

  protokoll = echtesProtokoll;
} else {
  var gesperrt = fange(function () { zweiSchritte(TN, { wert: "1" }, function () { return { vorschau: {}, fp: "" }; }, function () {}); });
  pruefe("Token: ohne -Schreiben keine Vorschau", /nicht freigeschaltet/.test(gesperrt), gesperrt);
}

/* ---------- Datum und Pfade ---------- */

pruefe("datum8 TT.MM.JJJJ", datum8("16.10.2026") === "20261016");
pruefe("datum8 ISO", datum8("2026-10-16") === "20261016");
pruefe("datum8 31.02. abgelehnt", datum8("31.02.2026") === null);
pruefe("datum8 Schaltjahr", datum8("29.02.2024") === "20240229");
pruefe("datum8 kein Datum", datum8("morgen") === null);
pruefe("arcpath Pfad", ELO.arcpath("Administration/ELOas Base") === "ARCPATH:" + ELO.PILCROW + "Administration" + ELO.PILCROW + "ELOas Base");
pruefe("arcpath ID", ELO.arcpath("4711") === "4711");

/* ---------- Bauplan ---------- */

function plan(nodes, assocs) { return { name: "Test", nodes: nodes, assocs: assocs }; }
var START = { id: 0, type: 1, name: "Start" }, ENDE = { id: 9, type: 6, name: "Ende" };
var PERSON = { id: 1, type: 2, name: "Pruefen", user: "Eigentuemer", userId: -2 };

var gut = pruefePlan(plan([START, PERSON, ENDE], [[0, 1], [1, 9]]));
pruefe("Bauplan gueltig", gut.fehler.length === 0, JSON.stringify(gut));
var sackgasse = pruefePlan(plan([START, PERSON, { id: 2, type: 2, name: "Sackgasse", user: "x", userId: -2 }, ENDE], [[0, 1], [1, 9], [1, 2]]));
pruefe("Knoten ohne Nachfolger erkannt", enthaelt(sackgasse.fehler, "keinen Nachfolger"), JSON.stringify(sackgasse));
var zweiStarts = pruefePlan(plan([START, { id: 5, type: 1, name: "Start 2" }, ENDE], [[0, 9], [5, 9]]));
pruefe("zwei Startknoten erkannt", enthaelt(zweiStarts.fehler, "Genau ein Startknoten"));
var sammler = pruefePlan(plan([START, { id: 3, type: 3, name: "Verteiler" }, { id: 4, type: 2, name: "A", user: "x", userId: -2 },
  { id: 5, type: 2, name: "B", user: "x", userId: -2 }, { id: 6, type: 5, name: "Sammler" }, ENDE],
  [[0, 3], [3, 4], [3, 5], [4, 6], [5, 6], [6, 9]]));
pruefe("Sammler ohne Zaehler erkannt", enthaelt(sammler.fehler, "braucht dones"), JSON.stringify(sammler));
var entscheid = pruefePlan(plan([START, { id: 7, type: 4, name: "Betrag gross?" }, ENDE], [[0, 7], [7, 9, "ja"]]));
pruefe("Entscheidung ohne Bedingung erkannt", enthaelt(entscheid.fehler, "ohne Bedingung"));
pruefe("Entscheidung ohne nein-Kante gewarnt", enthaelt(entscheid.warn, "keine nein-Kante"));
var kante = pruefePlan(plan([START, ENDE], [[0, 9], [0, 42]]));
pruefe("Kante auf unbekannten Knoten erkannt", enthaelt(kante.fehler, "unbekannten Knoten"));

var diff = planDiff(plan([START, PERSON, ENDE], [[0, 1], [1, 9]]),
  plan([START, { id: 1, type: 2, name: "Pruefen neu", user: "Eigentuemer", userId: -2 }, ENDE], [[0, 1], [1, 9], [0, 9]]));
pruefe("planDiff: geaenderter Knoten", diff.geaenderteKnoten.length === 1, JSON.stringify(diff));
pruefe("planDiff: neue Kante", diff.neueKanten.length === 1 && diff.neueKanten[0] === "0>9", JSON.stringify(diff));

/* ---------- Skripte und Regeln ---------- */

pruefe("JavaScript gueltig", pruefeSkript("var a = 1; function f() { return a; }", "js", "Administration/x").fehler.length === 0);
pruefe("JavaScript Syntaxfehler", pruefeSkript("var a = ;", "js", "Administration/x").fehler.length === 1);
var regel = "<ruleset><base>x</base><rule><name>R</name><condition>1 == 1</condition><script>var x = ;</script></rule></ruleset>";
var rr = pruefeSkript(regel, "xml", "Administration/ELOas Base/Direct");
pruefe("ELOas-Regel: Syntaxfehler im Skriptteil", rr.art === "ELOas-Regel" && rr.fehler.length === 1, JSON.stringify(rr));
pruefe("ELOas-Regel: kaputtes XML", pruefeSkript("<ruleset><rule></ruleset>", "xml", "Administration/ELOas Base/Direct").fehler.length === 1);
pruefe("JSON ungueltig", pruefeSkript("{ a: 1 }", "json", "Administration/x").fehler.length === 1);
var ix1 = pruefeSkript("// Kopf\nvar a = 1;\n// siehe @include weiter unten\n", "js", "Administration/IndexServer Scripting Base/_ALL/test");
pruefe("IX-Skript: @include ausserhalb der Kopfzeilen", enthaelt(ix1.fehler, "@include"), JSON.stringify(ix1));
var ix2 = pruefeSkript("var name = 'M" + String.fromCharCode(252) + "ller';\n", "js", "Administration/Business Solutions Custom/test");
pruefe("IX-Skript: Nicht-ASCII", enthaelt(ix2.fehler, "Nicht-ASCII"), JSON.stringify(ix2));

var zd = zeilenDiff("a\nb\nc", "a\nB\nc");
pruefe("zeilenDiff", zd.ab === 2 && zd.entfernt === 1 && zd.eingefuegt === 1 && zd.neu === "B", JSON.stringify(zd));

OUT.println("");
OUT.println(okZahl + " ok, " + fehlerZahl + " Fehler");
OUT.flush();
java.lang.System.exit(fehlerZahl ? 1 : 0);
