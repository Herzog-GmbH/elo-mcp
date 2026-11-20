/*
 * offline.js - Pruefungen ohne ELO-Verbindung: Protokoll, Stufen, Vorschau und Token,
 * Datumspruefung, Bauplan-, Skript- und Maskenpruefungen. Wird von test\offline.ps1 nach den Quellen geladen
 * (elo.js, elo-mcp.js, elo-mcp-schreiben.js, elo-mcp-bauen.js, elo-mcp-masken.js, elo-mcp-benutzer.js, elo-mcp-rechte.js, elo-mcp-vorgaenge.js, elo-mcp-notizen.js, elo-mcp-ergaenzungen.js, elo-mcp-ablage.js, elo-mcp-wiedervorlagen.js - ohne elo-mcp-start.js).
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
var erwartet = 27 + (SCHREIBEN_ERLAUBT ? 16 : 0) + (BAUEN_ERLAUBT ? 19 : 0);
pruefe("tools/list: " + erwartet + " Werkzeuge bei Stufen " + stufenText(), liste.length === erwartet, liste.length);
pruefe("tools/list: Schreibwerkzeug nur mit -Schreiben", !!namen.elo_set_fields === SCHREIBEN_ERLAUBT);
pruefe("tools/list: Bauwerkzeug nur mit -Bauen", !!namen.elo_workflow_build === BAUEN_ERLAUBT);
pruefe("tools/list: Maskenwerkzeuge nur mit -Bauen", !!namen.elo_mask_create === BAUEN_ERLAUBT && !!namen.elo_mask_fields === BAUEN_ERLAUBT && !!namen.elo_mask_tabs === BAUEN_ERLAUBT);
pruefe("tools/list: Lesewerkzeuge immer", !!(namen.elo_search && namen.elo_workflow_export && namen.elo_mask && namen.elo_keywords));
pruefe("tools/list: Stichwortlisten setzen nur mit -Bauen", !!namen.elo_keywords_set === BAUEN_ERLAUBT);
for (var j = 0; j < liste.length; j++) {
  var t = liste[j];
  pruefe("Schema " + t.name, t.inputSchema && t.inputSchema.type === "object" && typeof t.description === "string" && t.description.length > 20);
}
if (!SCHREIBEN_ERLAUBT) {
  var r = callTool("elo_set_fields", { objekt: "1", name: "x" });
  pruefe("gesperrtes Werkzeug wird abgelehnt", r.isError && /nicht freigeschaltet/.test(r.content[0].text), r.content[0].text);
}
if (!BAUEN_ERLAUBT) {
  var rm = callTool("elo_mask_fields", { maske: "1", felder: [{ key: "X" }] });
  pruefe("gesperrtes Maskenwerkzeug wird abgelehnt", rm.isError && /nicht freigeschaltet/.test(rm.content[0].text), rm.content[0].text);
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

/* ---------- Masken (ohne ELO: Zeilen und Masken nur im Speicher) ---------- */

function zl(id, key, name, tab, row, ohneRechte, labelCol) {
  var l = new IXC.DocMaskLine();
  l.setId(id); l.setKey(key); l.setName(name); l.setType(3000); l.setMax(255);
  l.setTabIndex(tab); l.setLabelRow(row); l.setEditRow(row); l.setLabelCol(labelCol || 1); l.setEditCol(14);
  if (!ohneRechte) l.setAclItems(jarr("AclItem", [aclItem(JEDER_ID, "Jeder", 0, 3)]));
  return l;
}
function testMaske(zeilen) {
  var mk = new IXC.DocMask();
  mk.setText("Basis|Termine|||");
  mk.setLines(jarr("DocMaskLine", zeilen || [zl(1, "NAME", "Name", 0, 4), zl(2, "BETRAG", "Betrag", 0, 5), zl(3, "FRIST", "Frist", 1, 1)]));
  return mk;
}
function keyFolge(lines) { var k = []; for (var i = 0; i < lines.length; i++) k.push(keyOf(lines[i])); return k.join(","); }

/* ---------- Maske ohne Felder, Stichwortlisten (nur im Speicher) ---------- */

var vorbildTest = testMaske(), planOhne = aufbauPlan(vorbildTest, { ohneFelder: true, reiter: ["Basis"] });
pruefe("Maske anlegen: ohneFelder uebernimmt keine Felder", aufbauAnwenden(alsListe(vorbildTest.getLines()), planOhne, { items: [], text: "" }, []).length === 0);
m = fange(function () { aufbauAnwenden(alsListe(testMaske().getLines()), aufbauPlan(testMaske(), { felder: ["NAME"] }), { items: [], text: "" }, []); });
pruefe("Maske anlegen: Auswahl bleibt wie bisher", m === "", m);
m = fange(function () { aufbauPlan(testMaske(), { ohneFelder: true, felder: ["NAME"] }); });
pruefe("Maske anlegen: ohneFelder mit felder abgelehnt", /zusammen/.test(m), m);

var kwE = kwEingabe(["draft", { text: "Gruppe", eintraege: ["a", "b"] }], 1, "");
pruefe("Stichworte: Eingabe mit Unterliste", kwE.length === 2 && kwE[1].eintraege.length === 2);
m = fange(function () { kwEingabe(["a", "a"], 1, ""); });
pruefe("Stichworte: doppelter Eintrag abgelehnt", /doppelt/.test(m), m);
m = fange(function () { kwEingabe(["a", " "], 1, ""); });
pruefe("Stichworte: leerer Eintrag abgelehnt", /Leerer Eintrag/.test(m), m);
var kwB = { hinzu: [], weg: [] }, kwN = kwEbene("L\u00b6.", [], kwEingabe(["draft", "sent"], 1, ""), "ergaenzen", "", kwB);
pruefe("Stichworte: neue IDs AA, AB", S(kwN[0].getId()) === "L\u00b6.AA" && S(kwN[1].getId()) === "L\u00b6.AB" && kwN[0].isEnabled(), kwIdLesbar(kwN[1].getId()));
var kwAlt = [kwNeuerKnoten("L\u00b6.AA", "draft"), kwNeuerKnoten("L\u00b6.AC", "alt")];
kwB = { hinzu: [], weg: [] };
var kwG = kwEbene("L\u00b6.", kwAlt, kwEingabe(["draft", "sent"], 1, ""), "ergaenzen", "", kwB);
pruefe("Stichworte: ergaenzen haengt an, behaelt Vorhandene", kwG.length === 3 && S(kwG[2].getText()) === "sent" && S(kwG[2].getId()) === "L\u00b6.AB" && kwB.weg.length === 0,
       kwFlach(kwBaum(kwG, true)).join(","));
kwB = { hinzu: [], weg: [] };
var kwR = kwEbene("L\u00b6.", [kwNeuerKnoten("L\u00b6.AA", "draft"), kwNeuerKnoten("L\u00b6.AC", "alt")], kwEingabe(["sent", "draft"], 1, ""), "ersetzen", "", kwB);
pruefe("Stichworte: ersetzen in neuer Reihenfolge, alt faellt weg", kwFlach(kwBaum(kwR, false)).join(",") === "sent,draft" && S(kwR[1].getId()) === "L\u00b6.AA" && kwB.weg.join() === "alt",
       kwFlach(kwBaum(kwR, false)).join(",") + " weg=" + kwB.weg.join());
kwB = { hinzu: [], weg: [] };
var kwU = kwEbene("L\u00b6.", [], kwEingabe([{ text: "G", eintraege: ["x"] }], 1, ""), "ergaenzen", "", kwB);
pruefe("Stichworte: Unterliste bekommt ID der Ebene darunter", S(kwU[0].getChildren()[0].getId()) === "L\u00b6.AAAA" && kwB.hinzu.join() === "G,G > x", kwB.hinzu.join());
pruefe("Stichworte: Listen-ID in Grossbuchstaben", kwId(" aw_sign_status ") === "AW_SIGN_STATUS", kwId(" aw_sign_status "));
m = fange(function () { kwId("AW-SIGN"); });
pruefe("Stichworte: Listen-ID mit Sonderzeichen abgelehnt", /nur Buchstaben/.test(m), m);
var ixEcht = ELO.ix, kwFehler = "";
ELO.ix = function () { return { checkoutKeywordList: function () { throw new Error(kwFehler); } }; };
try {
  kwFehler = "[ELOIX:5023]Das Objekt mit der ID kwList.id=X ist nicht vorhanden.";
  pruefe("Stichworte: fehlende Liste (ELOIX:5023) gilt als neu", kwListeHolen("X") === null);
  kwFehler = "[ELOIX:2001]Sitzung abgelaufen";
  m = fange(function () { kwListeHolen("X"); });
  pruefe("Stichworte: anderer Fehler beim Holen wird nicht als neue Liste behandelt", /ELOIX:2001/.test(m), m);
} finally { ELO.ix = ixEcht; }

pruefe("Maske: Rechte RW", rechteBits("RW") === 3);
pruefe("Maske: Rechte voll", rechteBits("voll") === 63);
m = fange(function () { rechteBits("W"); });
pruefe("Maske: Rechte ohne R abgelehnt", /ohne R/.test(m), m);
m = fange(function () { rechteBits("X"); });
pruefe("Maske: unbekannter Rechtebuchstabe abgelehnt", /erlaubt sind/.test(m), m);
pruefe("Maske: Typ datum", typNr("datum") === 3004);
pruefe("Maske: Typ als Nummer", typNr("3010") === 3010);
m = fange(function () { typNr("bild"); });
pruefe("Maske: unbekannter Typ abgelehnt", /unbekannt/.test(m), m);
pruefe("Maske: Maskentext mit fuenf Reitern", reiterText(["Basis", "Termine"]) === "Basis|Termine|||");
m = fange(function () { pruefeReiterNamen(["", "x"]); });
pruefe("Maske: Reiter 0 ohne Namen abgelehnt", /Reiter 0 braucht/.test(m), m);
m = fange(function () { pruefeReiterNamen(["a|b"]); });
pruefe("Maske: '|' im Reiternamen abgelehnt", /enthaelt/.test(m), m);
pruefe("Maske: Spalte fuer lange Beschriftung", noetigeSpalte("Kuendigungsfrist in Monaten") === 26);
pruefe("Maske: erste freie Zeile Reiter 0 ist 4, sonst 1", naechsteZeile([], 0, "") === 4 && naechsteZeile([], 1, "") === 1);

var viele = [];
for (var vi = 0; vi < 50; vi++) viele.push(zl(vi, "F" + vi, "Feld " + vi, 0, 4 + vi));
pruefe("Maske: Zeilen-IDs 50 bis 59 uebersprungen", freieId(viele) === 60, freieId(viele));
pruefe("Maske: naechste ID nach der hoechsten", freieId([zl(0, "A", "A", 0, 4), zl(5, "B", "B", 0, 5)]) === 6);

var NAMEN = ["Basis", "", "", "", ""];
var kaputt = [zl(1, "A", "Alpha", 0, 4), zl(2, "B", "Beta", 0, 2), zl(3, "C", "Betrag (EUR)", 0, 5),
              zl(4, "D", "Delta", 0, 6, true), zl(5, "E", "Echo", 1, 1), zl(6, "F", "Foxtrot", 0, 4)];
var lpAlle = layoutPruefen(NAMEN, kaputt, {}, true);
pruefe("Layout: Feld vor Zeile 4 auf Reiter 0", enthaelt(lpAlle.fehler, "Zeilen 1 bis 3"), JSON.stringify(lpAlle));
pruefe("Layout: Klammern im Anzeigenamen", enthaelt(lpAlle.fehler, "Klammern"), JSON.stringify(lpAlle));
pruefe("Layout: Feld ohne Rechte", enthaelt(lpAlle.fehler, "ohne Rechte"), JSON.stringify(lpAlle));
pruefe("Layout: Reiter ohne Namen", enthaelt(lpAlle.fehler, "ohne Namen"), JSON.stringify(lpAlle));
pruefe("Layout: Felder uebereinander", enthaelt(lpAlle.fehler, "uebereinander"), JSON.stringify(lpAlle));
var lpAlt = layoutPruefen(NAMEN, kaputt, {}, false);
pruefe("Layout: unberuehrte Maengel nur als Hinweis", lpAlt.fehler.length === 0 && lpAlt.hinweise.length >= 5, JSON.stringify(lpAlt));

var ord = [zl(1, "G", "G", 0, 4), zl(2, "H", "H", 0, 7), zl(3, "I", "I", 0, 7, false, 40), zl(4, "J", "J", 0, 9)];
var aend = ordneReiter(ord, 0);
pruefe("ordnen: Zeilen lueckenlos, nebeneinander bleibt nebeneinander",
       ord[1].getEditRow() === 5 && ord[2].getEditRow() === 5 && ord[3].getEditRow() === 6 && aend.length === 3, JSON.stringify(aend));

var pl = [zl(1, "K", "K", 0, 4), zl(2, "L", "L", 0, 5), zl(3, "M", "M", 0, 6)], ger = [];
var plRow = platzNach(pl, "K", 0, "NEU", ger);
pruefe("nach: Platz unter dem Feld, darunter rueckt nach unten", plRow === 5 && pl[1].getEditRow() === 6 && pl[2].getEditRow() === 7 && ger.join(",") === "L,M", plRow + " " + ger);

var mf = testMaske(), wf = [];
var rf = felderAnwenden({ felder: [{ key: "neu", name: "Kuendigungsfrist in Monaten", nach: "NAME" }] })(mf, wf);
var nf = rf.lines[3];
pruefe("Feld neu: hinten angehaengt, Reihenfolge bleibt", keyFolge(rf.lines) === "NAME,BETRAG,FRIST,NEU" && mf.getLines().length === 4, keyFolge(rf.lines));
pruefe("Feld neu: Zeile unter NAME, BETRAG rueckt nach unten", nf.getEditRow() === 5 && rf.lines[1].getEditRow() === 6, nf.getEditRow() + "/" + rf.lines[1].getEditRow());
pruefe("Feld neu: freie ID, Spalte fuer lange Beschriftung, Rechte wie die anderen",
       nf.getId() === 4 && nf.getEditCol() === 26 && aclSig(nf.getAclItems()) === aclSig(rf.lines[0].getAclItems()), nf.getId() + "/" + nf.getEditCol());
pruefe("Feld neu: Regeln erfuellt", layoutPruefen(rf.namen, rf.lines, rf.beruehrt, false).fehler.length === 0);
m = fange(function () { felderAnwenden({ felder: [{ key: "X1", name: "Betrag (EUR)" }] })(testMaske(), []); });
pruefe("Feld neu: Klammern abgelehnt", /Klammern/.test(m), m);
m = fange(function () { felderAnwenden({ felder: [{ key: "X2", name: "x", reiter: 2 }] })(testMaske(), []); });
pruefe("Feld neu: Reiter ohne Namen abgelehnt", /keinen Namen/.test(m), m);
m = fange(function () { felderAnwenden({ felder: [{ key: "ELOX", name: "x" }] })(testMaske(), []); });
pruefe("Feld neu: Feldgruppe ELO... abgelehnt", /reserviert/.test(m), m);
m = fange(function () { felderAnwenden({ felder: [{ key: "NAME", name: "Name" }] })(testMaske(), []); });
pruefe("Feld aendern: ohne Aenderung abgelehnt", /keine Aenderung/.test(m), m);

var mv = testMaske(), rv = reiterAnwenden({ verschieben: [{ key: "BETRAG", reiter: "Termine" }] })(mv, []);
pruefe("Reiter: Feld ans Ende eines anderen Reiters", rv.lines[1].getTabIndex() === 1 && rv.lines[1].getEditRow() === 2 && keyFolge(rv.lines) === "NAME,BETRAG,FRIST",
       rv.lines[1].getTabIndex() + "/" + rv.lines[1].getEditRow());
var rn = reiterAnwenden({ reiter: ["Basis"] })(testMaske(), []);
pruefe("Reiter: Namen weg, Felder darauf -> Regelverstoss", enthaelt(layoutPruefen(rn.namen, rn.lines, rn.beruehrt, rn.alle).fehler, "ohne Namen"));
var ro = reiterAnwenden({ ordnen: true })(testMaske([zl(1, "NAME", "Name", 0, 4), zl(2, "BETRAG", "Betrag", 0, 8)]), []);
pruefe("Reiter: ordnen schliesst Luecken", ro.lines[1].getEditRow() === 5, ro.lines[1].getEditRow());

/* ---------- Benutzerkonten (nur im Speicher) ---------- */

pruefe("tools/list: Benutzer lesen immer, setzen nur mit -Bauen", !!namen.elo_user && !!namen.elo_user_set_login === BAUEN_ERLAUBT);
function testUser(id, name, os, mail) {
  var u = new IXC.UserInfo(); u.setId(id); u.setName(name); u.setType(IXC.UserInfoC.TYPE_USER);
  var p = java.lang.reflect.Array.newInstance(java.lang.String, IXC.UserInfoC.MAX_USERPROP); p[0] = os; p[1] = mail; u.setUserProps(p);
  return u;
}
pruefe("Benutzer: Windows-Name ohne Domaene passt", osGleich("DOM\\M.Muster", "m.muster") && osGleich("dom\\m.muster", "DOM\\M.Muster") && !osGleich("DOM\\m.muster", "DOM\\m.mustermann"));
pruefe("Benutzer: leerer Windows-Name passt nie", !osGleich("", "") && !osGleich("DOM\\x", ""));
var tu = [testUser(1, "Muster, Max", "DOM\\m.muster", "m.muster@example.com"), testUser(2, "Max Muster", "DOM\\M.Muster", "m.muster@example.com"),
          testUser(3, "Frei, Fritz", "DOM\\f.frei", "f.frei@example.com"), testUser(4, "Leer, Lea", "", "")];
var dw = doppelte(tu, PROP_OS), dm = doppelte(tu, PROP_MAIL);
pruefe("Benutzer: doppelter Windows-Name gefunden (Schreibweise egal)", dw.length === 1 && dw[0].konten.length === 2 && dw[0].wert === "m.muster", JSON.stringify(dw));
pruefe("Benutzer: doppelte Mail gefunden, leere zaehlen nicht", dm.length === 1 && dm[0].konten.length === 2, JSON.stringify(dm));
var am = andereMit(tu, tu[0], "m.muster", PROP_OS);
pruefe("Benutzer: andere Konten mit gleichem Windows-Namen ohne das eigene", am.length === 1 && am[0].id === "2", JSON.stringify(am));
if (!BAUEN_ERLAUBT) {
  var ru = callTool("elo_user_set_login", { benutzer: "1", windowsName: "" });
  pruefe("gesperrtes Benutzerwerkzeug wird abgelehnt", ru.isError && /nicht freigeschaltet/.test(ru.content[0].text), ru.content[0].text);
}

/* ---------- Rechte und Vertretungen (nur im Speicher) ---------- */

pruefe("tools/list: Rechte/Vertretungen lesen immer, setzen nur mit -Bauen",
  !!namen.elo_acl && !!namen.elo_substitutions && !!namen.elo_acl_set === BAUEN_ERLAUBT && !!namen.elo_substitution_set === BAUEN_ERLAUBT);
function testAcl(id, typ, acc, name) { var it = new IXC.AclItem(); it.setId(id); it.setType(typ); it.setAccess(acc); it.setName(name || ""); return it; }
function testSord(id, owner, items, parent) {
  var s = new IXC.Sord(); s.setId(id); s.setName("O" + id); s.setOwnerId(owner); s.setParentId(String(parent || 0));
  var arr = java.lang.reflect.Array.newInstance(IXC.AclItem, items.length); for (var i = 0; i < items.length; i++) arr[i] = items[i];
  s.setAclItems(arr); return s;
}
var person = { id: "15", name: "Muster, Max", ids: { "15": "Muster, Max", "4": "Vertrieb", "9999": "Jeder" } };
var so = testSord(10, 3, [testAcl(53, 1, 11), testAcl(15, 1, 1), testAcl(4, 0, 2), testAcl(2, 0, 63)]);
var wr = wirksam(so, person, 0, {});
pruefe("Rechte: direkt R plus Gruppe W ergibt RW", rechteText(wr.bits) === "RW" && wr.quelle.length === 2, JSON.stringify(wr));
var wl = wirksam(testSord(11, 3, [testAcl(53, 1, 63)]), person, 0, {});
pruefe("Rechte: fremder Eintrag gibt nichts", wl.bits === 0 && rechteText(wl.bits) === "-", JSON.stringify(wl));
var wo = wirksam(testSord(12, 15, [testAcl(0, 200, 63)]), person, 0, {});
pruefe("Rechte: Eigentuemer-Eintrag zaehlt nur fuer den Eigentuemer", rechteText(wo.bits) === "RWDELP", JSON.stringify(wo));
var cacheE = { "20": testSord(20, 3, [testAcl(9999, 0, 3)]) };
var we = wirksam(testSord(21, 3, [testAcl(0, 100, 1)], 20), person, 0, cacheE);
pruefe("Rechte: Erbe nimmt nur, was der Erbe-Eintrag zulaesst", rechteText(we.bits) === "R" && /geerbt/.test(we.quelle[0]), JSON.stringify(we));
var wk = wirksam(testSord(22, 3, [testAcl(5, 10, 1, "Schluessel A")]), person, 0, {});
pruefe("Rechte: Schluessel wird gemeldet, nicht geraten", wk.bits === 0 && wk.offen.length === 1, JSON.stringify(wk));
pruefe("Vertretung: Datum JJJJ-MM-TT und TT.MM.JJJJ", isoDatum("2026-11-30", true) === "20261130235959" && isoDatum("01.12.2026", false) === "20261201000000");
var dfehl = false; try { isoDatum("30/11/2026"); } catch (e) { dfehl = !!e.userError; }
pruefe("Vertretung: falsches Datum abgelehnt", dfehl);
if (!BAUEN_ERLAUBT) {
  var ra = callTool("elo_acl_set", { objekt: "1", aenderungen: [{ name: "x", rechte: "R" }] });
  pruefe("gesperrtes Rechtewerkzeug wird abgelehnt", ra.isError && /nicht freigeschaltet/.test(ra.content[0].text), ra.content[0].text);
  var rv = callTool("elo_substitution_set", { benutzer: "1", vertreter: "2", bis: "2099-01-01" });
  pruefe("gesperrtes Vertretungswerkzeug wird abgelehnt", rv.isError && /nicht freigeschaltet/.test(rv.content[0].text), rv.content[0].text);
}

/* ---------- Vorgaenge, Kanten, Formularseiten, Text ersetzen ---------- */

pruefe("tools/list: Vorgaenge einer Vorlage immer", !!namen.elo_workflows_of_template);
pruefe("tools/list: Knoten/Kanten/Aktivieren/Formularseiten nur mit -Bauen",
       !!namen.elo_workflow_node_set === BAUEN_ERLAUBT && !!namen.elo_workflow_activate === BAUEN_ERLAUBT &&
       !!namen.elo_workflow_edges === BAUEN_ERLAUBT && !!namen.elo_form_pages === BAUEN_ERLAUBT);
pruefe("tools/list: Text ersetzen nur mit -Schreiben", !!namen.elo_rename_in_folder === SCHREIBEN_ERLAUBT);

var we1 = wortErsetzen("Personalakte Mustermann, Mxa", "Mxa", "Max");
pruefe("Wort ersetzen: ganzes Wort", we1.text === "Personalakte Mustermann, Max" && we1.anzahl === 1, JSON.stringify(we1));
var we2 = wortErsetzen("Mxas Mxa-Akte xMxa", "Mxa", "Max");
pruefe("Wort ersetzen: Teilwort bleibt, Bindestrich trennt", we2.text === "Mxas Max-Akte xMxa" && we2.anzahl === 1, JSON.stringify(we2));
var we3 = wortErsetzen("Müller Müllerin ÜMüller", "Müller", "Mueller");
pruefe("Wort ersetzen: Umlaute zaehlen als Buchstaben", we3.text === "Mueller Müllerin ÜMüller" && we3.anzahl === 1, JSON.stringify(we3));
var we4 = wortErsetzen("Ab ab AB", "ab", "x");
pruefe("Wort ersetzen: Gross-/Kleinschreibung zaehlt", we4.text === "Ab x AB", JSON.stringify(we4));

var pw = [];
pruefe("props ergaenzen: Schluessel dazu", JSON.parse(propsNeu('{"a":1}', { propsErgaenzen: { forwardToAll: true } }, pw)).forwardToAll === true);
pruefe("props ergaenzen: null entfernt", JSON.parse(propsNeu('{"a":1,"b":2}', { propsErgaenzen: { b: null } }, pw)).b === undefined);
pruefe("props ergaenzen: ohne Aenderung bleibt der Text", propsNeu('{"a":1}', { propsErgaenzen: { a: 1 } }, pw) === '{"a":1}');
pruefe("props ergaenzen: leer wird Objekt", JSON.parse(propsNeu("", { propsErgaenzen: { x: "y" } }, pw)).x === "y");
pruefe("props ergaenzen: Nicht-JSON abgelehnt", /kein JSON/.test(fange(function () { propsNeu("kein json", { propsErgaenzen: { x: 1 } }, []); })));
pruefe("props ersetzen: Objekt wird JSON", JSON.parse(propsNeu("", { props: { z: 2 } }, pw)).z === 2);
var pw2 = []; propsNeu("", { props: "{kaputt" }, pw2);
pruefe("props ersetzen: kaputtes JSON nur Warnung", pw2.length === 1, JSON.stringify(pw2));
pruefe("props und propsErgaenzen zusammen abgelehnt", /nicht zusammen/.test(fange(function () { propsNeu("", { props: {}, propsErgaenzen: {} }, []); })));
pruefe("aenderung: unbekanntes Feld abgelehnt", /unbekanntes Feld/.test(fange(function () { aenderungPruefen({ lable: "x" }); })));
pruefe("aenderung: leer abgelehnt", /leer/.test(fange(function () { aenderungPruefen({}); })));
pruefe("aenderung: flags nur ganze Zahl", /flags/.test(fange(function () { aenderungPruefen({ flags: "1" }); })));

pruefe("Kante lesen: ja", kanteLesen([3, 4, "ja"], true).typ === -1);
pruefe("Kante lesen: normal", kanteLesen(["3", "4"], true).typ === -3 && kanteLesen(["3", "4"], true).von === 3);
pruefe("Kante lesen: falscher Typ abgelehnt", /ja/.test(fange(function () { kanteLesen([3, 4, "vielleicht"], true); })));
pruefe("Kante lesen: Typ beim Entfernen abgelehnt", /\[von, nach\]/.test(fange(function () { kanteLesen([3, 4, "ja"], false); })));
pruefe("Knoten-IDs: Text abgelehnt", /ungueltig/.test(fange(function () { knotenIds(["3a"]); })));
pruefe("Vorgangs-IDs: doppelte zusammengefasst", idListe(["1", "1", "2"], 5, "Vorgaenge").length === 2);
pruefe("Vorgangs-IDs: Grenze", /Hoechstens/.test(fange(function () { idListe(["1", "2", "3"], 2, "Vorgaenge"); })));
pruefe("Workflow-Art geprueft", /vorlage/.test(fange(function () { wfTyp("beendet"); })));

// Knotenziel an einem echten WFNode (ohne ELO-Verbindung)
var tn = new IXC.WFNode(); tn.setId(7); tn.setType(IXC.WFNodeC.TYPE_PERSONNODE); tn.setName("HR"); tn.setLabel(""); tn.setUserName("Alt"); tn.setUserId(5);
tn.setProperties('{"a":1}'); tn.setFlags(0);
var tz = knotenZiel(tn, { label: "Erledigt", flags: 1, propsErgaenzen: { forwardToAll: true } }, null, []);
pruefe("Knotenziel: nur Geaendertes", tz.label.neu === "Erledigt" && tz.flags.neu === 1 && !!tz.props && !tz.name, JSON.stringify(tz));
knotenSetzen(tn, tz);
pruefe("Knotenziel gesetzt", S(tn.getLabel()) === "Erledigt" && tn.getFlags() === 1 && JSON.parse(S(tn.getProperties())).forwardToAll === true);
pruefe("Knotenziel: nach dem Setzen nichts mehr zu tun", JSON.stringify(knotenZiel(tn, { label: "Erledigt", flags: 1 }, null, [])) === "{}");
var tv = new IXC.WFNode(); tv.setId(8); tv.setType(IXC.WFNodeC.TYPE_SPLITNODE); tv.setName("Verteiler");
pruefe("Knotenziel: Bearbeiter nur an Personenknoten", /kein Personenknoten/.test(fange(function () { knotenZiel(tv, {}, { name: "X", id: 1 }, []); })));

// Bauplan aus Datei
var bpf = java.io.File.createTempFile("elo-mcp-test-", ".json"); bpf.deleteOnExit();
var bpw = new java.io.OutputStreamWriter(new java.io.FileOutputStream(bpf), "UTF-8"); bpw.write("﻿{\"name\":\"X\",\"nodes\":[],\"assocs\":[]}"); bpw.close();
pruefe("Bauplan aus Datei (mit BOM)", bauplanLesen({ bauplanDatei: S(bpf.getAbsolutePath()) }).name === "X");
pruefe("Bauplan: beides abgelehnt", /nicht beides/.test(fange(function () { bauplanLesen({ bauplan: {}, bauplanDatei: S(bpf.getAbsolutePath()) }); })));
pruefe("Bauplan: keiner abgelehnt", /fehlt/.test(fange(function () { bauplanLesen({}); })));

if (!BAUEN_ERLAUBT) {
  var rn = callTool("elo_workflow_node_set", { ids: ["1"], art: "aktiv", knoten: [1], aenderung: { label: "x" } });
  pruefe("gesperrtes Knotenwerkzeug wird abgelehnt", rn.isError && /nicht freigeschaltet/.test(rn.content[0].text), rn.content[0].text);
}

/* ---------- Notizen und Map-Felder (nur im Speicher, erfundene Werte) ---------- */

pruefe("tools/list: Notizen und Map lesen immer, Map setzen nur mit -Schreiben", !!namen.elo_notes && !!namen.elo_map && !!namen.elo_map_set === SCHREIBEN_ERLAUBT);

function auffuellen(s, n) { while (s.length < n) s += " "; return s; }
var NZ_VOR = "9+F70505FA0360" + auffuellen("Calibri", 32);
pruefe("Notiz: Vorspann hat feste Laenge", NZ_VOR.length === NOTIZ_VORSPANN, NZ_VOR.length);
pruefe("Notiz: Vorspann abgetrennt", ohneVorspann(NZ_VOR + "Bitte pruefen") === "Bitte pruefen");
pruefe("Notiz: Text ohne Vorspann bleibt", ohneVorspann("9 + 3 Rechnungen offen") === "9 + 3 Rechnungen offen");
pruefe("Notiz: nur Vorspann ergibt leeren Text", ohneVorspann(NZ_VOR) === "");
pruefe("Notiz: Arten aus NoteC", notizTyp(20).art === "Textnotiz" && notizTyp(23).art === "Stempel" && notizTyp(1).art === "Haftnotiz" && notizTyp(999).art === "Typ 999",
       [notizTyp(20).art, notizTyp(23).art, notizTyp(1).art, notizTyp(999).art].join("/"));
var nzStempel = notizText(23, NZ_VOR + "Geprueft und freigegeben\\n Muster, Max 01.02.2026", null);
pruefe("Notiz: Stempel mit Zeilenwechsel", nzStempel === "Geprueft und freigegeben\nMuster, Max 01.02.2026", JSON.stringify(nzStempel));
pruefe("Notiz: Text des Indexservers geht vor", notizText(20, NZ_VOR + "alt", "neu") === "neu");
pruefe("Notiz: Haftnotiz bleibt, wie sie ist", notizText(1, NZ_VOR + "x", null) === NZ_VOR + "x");
pruefe("Notiz: Rueckstrich-n nur im Stempel ein Zeilenwechsel", notizText(20, NZ_VOR + "C:\\neu", null) === "C:\\neu", notizText(20, NZ_VOR + "C:\\neu", null));
var nzNote = new IXC.Note();
nzNote.setId(7); nzNote.setType(23); nzNote.setPageNo(2); nzNote.setOwnerName("Muster, Max"); nzNote.setCreateDateIso("20260201101500"); nzNote.setDesc(NZ_VOR + "Freigegeben");
var nzK = notizKurz(nzNote, false), nzKr = notizKurz(nzNote, true);
pruefe("Notiz: Art, Seite, Verfasser, Datum, Text", nzK.art === "Stempel" && nzK.typ === 23 && nzK.seite === 2 && nzK.verfasser === "Muster, Max" &&
       nzK.datum === "20260201101500" && nzK.text === "Freigegeben" && nzK.roh === undefined, JSON.stringify(nzK));
pruefe("Notiz: Rohwert nur auf Wunsch", nzKr.roh === NZ_VOR + "Freigegeben", JSON.stringify(nzKr));
pruefe("Notiz: Liste ohne Doppelte", objektListe(["1", " 1 ", "2"], 10).join() === "1,2" && objektListe("5", 10).join() === "5");
pruefe("Notiz: Grenze der Liste", /Hoechstens 2/.test(fange(function () { objektListe(["1", "2", "3"], 2); })));
pruefe("Notiz: leere Liste abgelehnt", /fehlt/.test(fange(function () { objektListe([], 10); })));

pruefe("Map: Passwort- und Tokenschluessel erkannt", mapGeheim("PORTAL_PW") && mapGeheim("WLAN_PW2") && mapGeheim("pw") && mapGeheim("API_TOKEN") &&
       mapGeheim("Kennwort_Portal") && mapGeheim("SMTP_PASSWORD") && mapGeheim("X.APIKEY"));
pruefe("Map: andere Schluessel bleiben lesbar", !mapGeheim("BELEG_STATUS") && !mapGeheim("PWR_STUFE") && !mapGeheim("KOMPASS") && !mapGeheim("BELEG_PRUEFER") && !mapGeheim("SPW_NR"));
var mpAnfang = mapFilter("beleg_"), mpMuster = mapFilter(["*_STATUS", "INV?"]);
pruefe("Map: Filter als Anfang, Gross/klein egal", mpAnfang("BELEG_STATUS") && !mpAnfang("XBELEG_STATUS") && mapFilter("") === null && mapFilter(undefined) === null);
pruefe("Map: Filter mit Muster und Liste", mpMuster("BELEG_STATUS") && !mpMuster("BELEG_STATUS_TEXT") && mpMuster("INV1") && !mpMuster("INV12"));
pruefe("Map: Sonderzeichen im Filter woertlich", mapFilter("A.B")("A.B1") && !mapFilter("A.B")("AXB1"));
var mpTest = { BELEG_STATUS: "2", BELEG_PRUEFER: "Muster, Max", PORTAL_PW: "geheim", LEER_PW: "", LANG: "abcdefghij" };
var mpAus = mapAusgabe(mpTest, null, 5, 500);
pruefe("Map: Passwort maskiert, leeres bleibt leer", mpAus.felder.PORTAL_PW === "***" && mpAus.felder.LEER_PW === "" && mpAus.maskiert.join() === "PORTAL_PW" &&
       JSON.stringify(mpAus).indexOf("geheim") < 0, JSON.stringify(mpAus));
pruefe("Map: lange Werte gekuerzt und genannt", mpAus.felder.LANG === "abcde ..." && mpAus.gekuerzt.length === 2 && mpAus.felder.BELEG_STATUS === "2", JSON.stringify(mpAus));
var mpEng = mapAusgabe(mpTest, mapFilter("BELEG_"), 100, 1);
pruefe("Map: Filter, Grenze und Sortierung", mpEng.anzahl === 1 && mpEng.mehrVorhanden === true && mpEng.felderGesamt === 5 &&
       mpEng.felder.BELEG_PRUEFER === "Muster, Max" && mpEng.felder.BELEG_STATUS === undefined, JSON.stringify(mpEng));

var mpEin = mapEingabe({ BELEG_STATUS: "3" }, ["BELEG_NOTIZ"]);
pruefe("Map setzen: Eingabe mit leeren", mpEin.length === 2 && mpEin[0].wert === "3" && mpEin[1].key === "BELEG_NOTIZ" && mpEin[1].wert === "", JSON.stringify(mpEin));
m = fange(function () { mapEingabe({ BELEG_STATUS: " " }); });
pruefe("Map setzen: leerer Wert nur ueber leeren", /leeren=/.test(m), m);
pruefe("Map setzen: Passwortfeld abgelehnt, auch beim Leeren", /Passwort/.test(fange(function () { mapEingabe({ PORTAL_PW: "x" }); })) &&
       /Passwort/.test(fange(function () { mapEingabe(null, ["PORTAL_PW"]); })));
pruefe("Map setzen: doppelter Schluessel abgelehnt", /doppelt/.test(fange(function () { mapEingabe({ BELEG_STATUS: "1" }, ["beleg_status"]); })));
pruefe("Map setzen: Platzhalter im Schluessel abgelehnt", /Platzhalter/.test(fange(function () { mapEingabe({ "BELEG_*": "1" }); })));
pruefe("Map setzen: Steuerzeichen im Schluessel abgelehnt", /Steuerzeichen/.test(fange(function () { mapEingabe({ "BELEG\tX": "1" }); })));
pruefe("Map setzen: ohne Angaben abgelehnt", /Weder/.test(fange(function () { mapEingabe({}, []); })));
pruefe("Map setzen: Wert muss Text sein", /Text erwartet/.test(fange(function () { mapEingabe({ A: { b: 1 } }); })));
var mpViele = {};
for (var mz = 0; mz <= LIMIT_MAP.setzen; mz++) mpViele["F" + mz] = "x";
pruefe("Map setzen: Grenze je Aufruf", /Hoechstens/.test(fange(function () { mapEingabe(mpViele); })));

var mpDiff = mapAenderungen({ BELEG_STATUS: "2", BELEG_NOTIZ: "alt" }, mapEingabe({ BELEG_STATUS: "3", BELEG_NEU: "x", BELEG_NOTIZ: "alt" }, null));
pruefe("Map setzen: nur echte Aenderungen", mpDiff.schritte.length === 2 && mpDiff.schritte[0].key === "BELEG_STATUS" && mpDiff.schritte[0].alt === "2" && mpDiff.schritte[1].da === false, JSON.stringify(mpDiff));
pruefe("Map setzen: Hinweise zu neu und gleich", enthaelt(mpDiff.warn, "neu angelegt") && enthaelt(mpDiff.warn, "hat schon diesen Wert"), JSON.stringify(mpDiff.warn));
var mpVor = mapVorschau(mpDiff.schritte);
pruefe("Map setzen: Vorschau bisher/neu", mpVor[0].bisher === "2" && mpVor[0].neu === "3" && mpVor[1].bisher === "(leer)", JSON.stringify(mpVor));
pruefe("Map setzen: Leeren eines leeren Felds ist keine Aenderung", mapAenderungen({}, mapEingabe(null, ["BELEG_NOTIZ"])).schritte.length === 0);
m = fange(function () { mapAenderungen({ BELEG_STATUS: "2" }, mapEingabe({ beleg_status: "3" })); });
pruefe("Map setzen: andere Schreibweise des Schluessels abgelehnt", /Kleinschreibung/.test(m), m);
pruefe("Map setzen: Fingerabdruck haengt am alten Wert", mapAenderungen({ A: "1" }, mapEingabe({ A: "9" })).fp !== mapAenderungen({ A: "2" }, mapEingabe({ A: "9" })).fp);
if (!SCHREIBEN_ERLAUBT) {
  var mpZu = callTool("elo_map_set", { objekt: "1", felder: { X: "1" } });
  pruefe("gesperrtes Map-Werkzeug wird abgelehnt", mpZu.isError && /nicht freigeschaltet/.test(mpZu.content[0].text), mpZu.content[0].text);
}

/* ---------- Feed (nur im Speicher, erfundene Werte) ---------- */

pruefe("tools/list: Feed lesen immer, Kommentar schreiben nur mit -Schreiben", !!namen.elo_feed && !!namen.elo_feed_post === SCHREIBEN_ERLAUBT);
pruefe("Feed: Erwaehnung lesbar", feedText("@[Muster, Max (0A1B2C3D-0000-1111-2222-333344445555)] bitte ansehen") === "@Muster, Max bitte ansehen",
       feedText("@[Muster, Max (0A1B2C3D-0000-1111-2222-333344445555)] bitte ansehen"));
pruefe("Feed: eckige Klammern ohne GUID bleiben", feedText("siehe [Anlage (2)]") === "siehe [Anlage (2)]");
var fdAuto = feedAuto("{\"file\": \"beispiel.paket\", \"key\": \"BELEG.FREIGEGEBEN\", \"data\": [\"Einkauf\"]}");
pruefe("Feed: automatischer Eintrag mit Schluessel und Daten", !!fdAuto && fdAuto.datei === "beispiel.paket" && fdAuto.schluessel === "BELEG.FREIGEGEBEN" && fdAuto.daten.join() === "Einkauf", JSON.stringify(fdAuto));
pruefe("Feed: Text ist kein automatischer Eintrag", feedAuto("{kein json") === null && feedAuto("normaler Text") === null && feedAuto("{\"a\": 1}") === null);
pruefe("Feed: Arten zu Typen", feedTypen(["Kommentar", "version"]).join() === "UserComment,VersionCreated,WorkVersionCreated,WorkVersionSwitched,Released" && feedTypen(undefined) === null && feedTypen([]) === null);
m = fange(function () { feedTypen(["alles"]); });
pruefe("Feed: unbekannte Art abgelehnt", /Unbekannte Art/.test(m), m);
function fdEintrag(typ, text, datum, name, guid) {
  var x = new FEED.Action(); x.setType(FEED.EActionType.valueOf(typ)); x.setText(text); x.setCreateDateIso(datum); x.setUpdateDateIso(datum); x.setUserName(name); x.setGuid(guid);
  return x;
}
var fdK = feedKurz(fdEintrag("UserComment", "@[Muster, Max (0A1B2C3D-0000-1111-2222-333344445555)] ok?", "20260301120000", "Beispiel, Eva", "(G1)"), false);
pruefe("Feed: Kommentar mit Art, Datum, Verfasser, Text", fdK.art === "Kommentar" && fdK.datum === "20260301120000" && fdK.verfasser === "Beispiel, Eva" && fdK.text === "@Muster, Max ok?" &&
       fdK.roh === undefined && fdK.geaendert === undefined, JSON.stringify(fdK));
var fdA = feedKurz(fdEintrag("AutoComment", "{\"file\": \"beispiel.paket\", \"key\": \"BELEG.STATUS\", \"data\": [\"2\"]}", "20260301120500", "", "(G2)"), true);
pruefe("Feed: automatischer Eintrag ohne Text, roh auf Wunsch", fdA.art === "Automatischer Eintrag" && fdA.text === undefined && fdA.auto.schluessel === "BELEG.STATUS" &&
       fdA.typ === "AutoComment" && fdA.guid === "(G2)" && /Benutzer-ID/.test(fdA.verfasser), JSON.stringify(fdA));
if (!SCHREIBEN_ERLAUBT) {
  var fdZu = callTool("elo_feed_post", { objekt: "1", text: "x" });
  pruefe("gesperrtes Feed-Werkzeug wird abgelehnt", fdZu.isError && /nicht freigeschaltet/.test(fdZu.content[0].text), fdZu.content[0].text);
}
var fdStore = [fdEintrag("UserComment", "Bitte pruefen", "20260302080000", "Beispiel, Eva", "(G3)"),
               fdEintrag("AutoComment", "{\"file\": \"beispiel.paket\", \"key\": \"BELEG.STATUS\", \"data\": [\"2\"]}", "20260301120500", "Dienst", "(G2)"),
               fdEintrag("SordCreated", "", "20260301120000", "Dienst", "(G0)")];
var fdGeschlossen = 0, fdCheckins = 0, fdVerschluckt = false, fdDienstEcht = feedDienst;
feedDienst = function () {
  return {
    findFirstActions: function (fi, max) {
      var typen = fi.getActionTypes(), out = [];
      for (var i = 0; i < fdStore.length && out.length < max; i++) if (!typen || typen.contains(fdStore[i].getType())) out.push(fdStore[i]);
      return { getActions: function () { return out; }, isMoreResults: function () { return false; }, getSearchId: function () { return "s1"; } };
    },
    createAction: function (typ, parent) { var x = new FEED.Action(); x.setType(typ); x.setFeedGuid(parent); return x; },
    checkinAction: function (x) {
      fdCheckins++;
      if (fdVerschluckt) return "(G-WEG)";
      x.setGuid("(G-NEU" + fdCheckins + ")"); x.setCreateDateIso("20260303090000"); x.setUserName("Test, Konto"); fdStore.unshift(x);
      return x.getGuid();
    }
  };
};

// Ganze Werkzeuge gegen einen Indexserver im Speicher
var mpIxEcht = ELO.ix, mpStore = { BELEG_STATUS: "2", BELEG_NOTIZ: "alt", PORTAL_PW: "geheim" }, mpLeerLoescht = false, mpSchreibtNicht = false, mpCheckins = 0;
function mpJson(r) { return r.isError ? { fehler: r.content[0].text } : JSON.parse(r.content[0].text); }
ELO.ix = function () {
  return {
    checkoutSord: function () {
      var s = new IXC.Sord(); s.setId(4711); s.setName("Testbeleg"); s.setType(254); s.setMaskName("Beleg"); s.setGuid("(G-OBJEKT)");
      return { getSord: function () { return s; } };
    },
    findClose: function () { fdGeschlossen++; },
    checkoutNotes: function () { return [nzNote]; },
    checkoutMap: function () {
      var items = [];
      for (var k in mpStore) (function (key) { items.push({ getKey: function () { return key; }, getValue: function () { return mpStore[key]; } }); })(k);
      return { getItems: function () { return items; } };
    },
    checkinMap: function (domain, id, objId, arr) {
      mpCheckins++;
      for (var i = 0; !mpSchreibtNicht && i < arr.length; i++) {
        var k = String(arr[i].getKey()), v = String(arr[i].getValue());
        if (v === "" && mpLeerLoescht) delete mpStore[k]; else mpStore[k] = v;
      }
    }
  };
};
try {
  var nzEin = mpJson(callTool("elo_notes", { objekt: "4711" }));
  pruefe("elo_notes: ein Objekt", nzEin.id === "4711" && nzEin.art === "Dokument" && nzEin.anzahl === 1 && nzEin.notizen[0].text === "Freigegeben", JSON.stringify(nzEin));
  var nzListe = mpJson(callTool("elo_notes", { objekt: ["4711", "4712"], roh: true }));
  pruefe("elo_notes: Liste mit Rohwert", nzListe.objekte === 2 && nzListe.notizenGesamt === 2 && nzListe.liste[1].notizen[0].roh === NZ_VOR + "Freigegeben", JSON.stringify(nzListe));
  var mpRoh = callTool("elo_map", { objekt: "4711" }), mpLes = mpJson(mpRoh);
  pruefe("elo_map: Felder, Passwort maskiert", mpLes.bereich === "Objekt" && mpLes.anzahl === 3 && mpLes.felder.BELEG_STATUS === "2" && mpLes.felder.PORTAL_PW === "***" &&
         mpRoh.content[0].text.indexOf("geheim") < 0, mpRoh.content[0].text);
  var mpGef = mpJson(callTool("elo_map", { objekt: "4711", filter: "BELEG_N" }));
  pruefe("elo_map: Filter", mpGef.anzahl === 1 && mpGef.felder.BELEG_NOTIZ === "alt" && mpGef.felderGesamt === 3, JSON.stringify(mpGef));
  pruefe("elo_map: objekt und workflow zusammen abgelehnt", /nicht beides/.test(mpJson(callTool("elo_map", { objekt: "1", workflow: "2" })).fehler));
  pruefe("elo_map: art nur mit workflow", /nur zusammen mit workflow/.test(mpJson(callTool("elo_map", { objekt: "1", art: "aktiv" })).fehler));
  pruefe("elo_map: Workflow-ID muss eine Zahl sein", /Zahl/.test(mpJson(callTool("elo_map", { workflow: "abc" })).fehler));
  if (SCHREIBEN_ERLAUBT) {
    var mpProtEcht = protokoll, mpSichEcht = mapSichern, mpGesichert = [];
    protokoll = function () {};
    mapSichern = function (p, werte, suffix) { mpGesichert.push({ suffix: suffix, werte: werte }); return "sicherung" + suffix; };
    try {
      var mpArgs = { objekt: "4711", felder: { BELEG_STATUS: "3" }, leeren: ["BELEG_NOTIZ"] };
      var mpV1 = mpJson(callTool("elo_map_set", mpArgs));
      pruefe("elo_map_set: Vorschau bisher/neu, nichts geschrieben", /^Vorschau/.test(mpV1.modus) && mpCheckins === 0 && mpV1.vorschau.felder.length === 2 &&
             mpV1.vorschau.felder[0].bisher === "2" && mpV1.vorschau.felder[1].neu === "(leer)" && mpGesichert.length === 0, JSON.stringify(mpV1));
      mpArgs.token = mpV1.token;
      var mpA1 = mpJson(callTool("elo_map_set", mpArgs));
      pruefe("elo_map_set: mit token ausgefuehrt und zurueckgelesen", mpA1.modus === "ausgefuehrt" && mpCheckins === 1 && mpStore.BELEG_STATUS === "3" &&
             mpA1.ergebnis.rueckgelesen === "ok, wie geplant" && mpA1.ergebnis.felder.BELEG_NOTIZ === "(leer)", JSON.stringify(mpA1));
      pruefe("elo_map_set: Sicherung vorher mit alten Werten, danach nachher", mpGesichert.length === 2 && mpGesichert[0].suffix === "-vorher" &&
             mpGesichert[0].werte.BELEG_STATUS === "2" && mpGesichert[0].werte.BELEG_NOTIZ === "alt" && mpGesichert[1].suffix === "-nachher", JSON.stringify(mpGesichert));
      pruefe("elo_map_set: andere Felder unberuehrt", mpStore.PORTAL_PW === "geheim");
      // Entfernt der Server geleerte Eintraege ganz, gilt das Zuruecklesen genauso als erfuellt.
      mpLeerLoescht = true; mpStore.BELEG_NOTIZ = "alt";
      var mpV2 = mpJson(callTool("elo_map_set", { objekt: "4711", leeren: ["BELEG_NOTIZ"] }));
      var mpA2 = mpJson(callTool("elo_map_set", { objekt: "4711", leeren: ["BELEG_NOTIZ"], token: mpV2.token }));
      pruefe("elo_map_set: geleertes Feld, das der Server entfernt", mpA2.ergebnis && mpA2.ergebnis.rueckgelesen === "ok, wie geplant" && mpStore.BELEG_NOTIZ === undefined &&
             mpGesichert[3].werte.BELEG_NOTIZ === null, JSON.stringify(mpA2));
      var mpV3 = mpJson(callTool("elo_map_set", { objekt: "4711", felder: { BELEG_STATUS: "5" } }));
      mpStore.BELEG_STATUS = "4";
      var mpA3 = mpJson(callTool("elo_map_set", { objekt: "4711", felder: { BELEG_STATUS: "5" }, token: mpV3.token }));
      pruefe("elo_map_set: Wert seit der Vorschau geaendert -> abgelehnt", /geaendert/.test(mpA3.fehler) && mpStore.BELEG_STATUS === "4", JSON.stringify(mpA3));
      mpSchreibtNicht = true;
      var mpV4 = mpJson(callTool("elo_map_set", { objekt: "4711", felder: { BELEG_STATUS: "5" } }));
      var mpA4 = mpJson(callTool("elo_map_set", { objekt: "4711", felder: { BELEG_STATUS: "5" }, token: mpV4.token }));
      pruefe("elo_map_set: Abweichung beim Zuruecklesen gemeldet", mpA4.ergebnis && /ABWEICHUNG bei BELEG_STATUS/.test(mpA4.ergebnis.rueckgelesen), JSON.stringify(mpA4));
      pruefe("elo_map_set: ohne Aenderung keine Vorschau", /Keine Aenderung/.test(mpJson(callTool("elo_map_set", { objekt: "4711", felder: { BELEG_STATUS: "4" } })).fehler));
    } finally { protokoll = mpProtEcht; mapSichern = mpSichEcht; }
  }

  var fdLes = mpJson(callTool("elo_feed", { objekt: "4711" }));
  pruefe("elo_feed: alle Eintraege, neueste zuerst, Suche geschlossen", fdLes.eintraege === 3 && fdLes.liste[0].text === "Bitte pruefen" && fdLes.liste[1].auto.schluessel === "BELEG.STATUS" &&
         fdLes.liste[2].art === "Angelegt" && fdGeschlossen === 1, JSON.stringify(fdLes));
  var fdNur = mpJson(callTool("elo_feed", { objekt: "4711", arten: ["kommentar"], max: 5 }));
  pruefe("elo_feed: nur Kommentare", fdNur.eintraege === 1 && fdNur.liste[0].art === "Kommentar", JSON.stringify(fdNur));
  pruefe("elo_feed: unbekannte Art abgelehnt", /Unbekannte Art/.test(mpJson(callTool("elo_feed", { objekt: "4711", arten: ["alles"] })).fehler));
  if (SCHREIBEN_ERLAUBT) {
    var fdProtEcht = protokoll;
    protokoll = function () {};
    try {
      var fdV1 = mpJson(callTool("elo_feed_post", { objekt: "4711", text: "  Rechnung sachlich geprueft  " }));
      pruefe("elo_feed_post: Vorschau schreibt nichts", /^Vorschau/.test(fdV1.modus) && fdCheckins === 0 && fdV1.vorschau.text === "Rechnung sachlich geprueft" &&
             enthaelt(fdV1.warnungen, "nicht aendern oder loeschen"), JSON.stringify(fdV1));
      var fdA1 = mpJson(callTool("elo_feed_post", { objekt: "4711", text: "  Rechnung sachlich geprueft  ", token: fdV1.token }));
      pruefe("elo_feed_post: mit token geschrieben und zurueckgelesen", fdA1.modus === "ausgefuehrt" && fdCheckins === 1 && fdStore.length === 4 &&
             S(fdStore[0].getText()) === "Rechnung sachlich geprueft" && S(fdStore[0].getType()) === "UserComment" && S(fdStore[0].getFeedGuid()) === "(G-OBJEKT)" &&
             fdA1.ergebnis.rueckgelesen === "ok, steht im Feed" && fdA1.ergebnis.eintrag.text === "Rechnung sachlich geprueft", JSON.stringify(fdA1));
      var fdV2 = mpJson(callTool("elo_feed_post", { objekt: "4711", text: "Rechnung sachlich geprueft" }));
      pruefe("elo_feed_post: gleicher Text wird gemeldet", enthaelt(fdV2.warnungen, "Derselbe Text"), JSON.stringify(fdV2.warnungen));
      var fdV3 = mpJson(callTool("elo_feed_post", { objekt: "4711", text: "@[Muster, Max (0A1B2C3D-0000-1111-2222-333344445555)] bitte freigeben" }));
      pruefe("elo_feed_post: Erwaehnung wird gemeldet", enthaelt(fdV3.warnungen, "benachrichtigt"), JSON.stringify(fdV3.warnungen));
      pruefe("elo_feed_post: leerer Text abgelehnt", /leer/.test(mpJson(callTool("elo_feed_post", { objekt: "4711", text: "  " })).fehler));
      var fdLang = ""; while (fdLang.length <= LIMIT_FEED.text) fdLang += "0123456789";
      pruefe("elo_feed_post: zu langer Text abgelehnt", /hoechstens/.test(mpJson(callTool("elo_feed_post", { objekt: "4711", text: fdLang })).fehler));
      fdVerschluckt = true;
      var fdV4 = mpJson(callTool("elo_feed_post", { objekt: "4711", text: "kommt nicht an" }));
      var fdA4 = mpJson(callTool("elo_feed_post", { objekt: "4711", text: "kommt nicht an", token: fdV4.token }));
      pruefe("elo_feed_post: fehlender Eintrag beim Zuruecklesen gemeldet", fdA4.ergebnis && /ABWEICHUNG/.test(fdA4.ergebnis.rueckgelesen), JSON.stringify(fdA4));
    } finally { protokoll = fdProtEcht; }
  }
} finally { ELO.ix = mpIxEcht; feedDienst = fdDienstEcht; }

/* ---------- 0.12.0: Farben, Workflow-Map, Gruppenaufgaben, registrierte Funktionen, Formular-Reload (nur im Speicher) ---------- */

pruefe("tools/list: Farben und lesende Funktionen immer", !!namen.elo_colors && !!namen.elo_function_read);
pruefe("tools/list: Farbe setzen und Annehmen nur mit -Schreiben", !!namen.elo_color_set === SCHREIBEN_ERLAUBT && !!namen.elo_task_take === SCHREIBEN_ERLAUBT);
pruefe("tools/list: Funktion aufrufen und Formular-Reload nur mit -Bauen", !!namen.elo_function_call === BAUEN_ERLAUBT && !!namen.elo_form_reload === BAUEN_ERLAUBT);
pruefe("Farbe: COLORREF zu #RRGGBB", farbeHex(3347394) === "#C21333" && farbeHex(12525568) === "#0020BF" && farbeHex(0) === "#000000", farbeHex(3347394));
var fbCd = new IXC.ColorData(); fbCd.setId(1); fbCd.setName("ELO.COLOR.RED"); fbCd.setDisplayName("Rot"); fbCd.setSpecName("red"); fbCd.setRGB(3347394);
var fbAus = farbeAus(fbCd);
pruefe("Farbe: Eintrag der Farbliste", fbAus.id === 1 && fbAus.name === "ELO.COLOR.RED" && fbAus.anzeige === "Rot" && fbAus.kurz === "red" && fbAus.rgb === "#C21333" &&
       fbAus.ausgeblendet === undefined, JSON.stringify(fbAus));
var FB_LISTE = [{ id: 0, name: "ELO.COLOR.SYSTEM", anzeige: "Systemfarbe", kurz: "system_colour", rgb: "#000000" },
                { id: 1, name: "ELO.COLOR.RED", anzeige: "Rot", kurz: "red", rgb: "#C21333" },
                { id: 7, name: "Gelb", anzeige: "Gelb", kurz: "", rgb: "#FFBF00" },
                { id: 8, name: "ELO.COLOR.YELLOW", anzeige: "Gelb", kurz: "yellow", rgb: "#FFED47" },
                { id: 9, name: "Beispielstatus", anzeige: "Beispielstatus", kurz: "", rgb: "#808080", geloescht: true }];
pruefe("Farbe finden: ID, Name, Kurzname, Anzeigename", farbeFinden("1", FB_LISTE).id === 1 && farbeFinden("ELO.COLOR.RED", FB_LISTE).id === 1 &&
       farbeFinden("red", FB_LISTE).id === 1 && farbeFinden("rot", FB_LISTE).id === 1 && farbeFinden(8, FB_LISTE).id === 8 && farbeFinden("Yellow", FB_LISTE).id === 8);
m = fange(function () { farbeFinden("Gelb", FB_LISTE); });
pruefe("Farbe finden: mehrdeutiger Name abgelehnt, beide genannt", /mehrdeutig/.test(m) && /7 Gelb/.test(m) && /8 ELO.COLOR.YELLOW \(Gelb\)/.test(m), m);
m = fange(function () { farbeFinden("lila", FB_LISTE); });
pruefe("Farbe finden: unbekannt, Auswahl genannt", /nicht gefunden/.test(m) && /1 ELO.COLOR.RED \(Rot\)/.test(m) && !/Beispielstatus/.test(m), m);
pruefe("Farbe finden: unbekannte ID, geloeschte Farbe", /ID 42/.test(fange(function () { farbeFinden("42", FB_LISTE); })) && /geloescht/.test(fange(function () { farbeFinden("9", FB_LISTE); })));
pruefe("Farbe: Kurzform mit Name und Anzeige", JSON.stringify(farbeKurz(1, FB_LISTE)) === "{\"id\":1,\"name\":\"ELO.COLOR.RED\",\"anzeige\":\"Rot\"}" &&
       farbeKurz(7, FB_LISTE).anzeige === undefined && /nicht in der Farbliste/.test(farbeKurz(42, FB_LISTE).hinweis), JSON.stringify(farbeKurz(1, FB_LISTE)));

pruefe("Funktion: Name geprueft", RX_RF.test("RF_sol_common_service_SordProvider") && !RX_RF.test("sol.common.Test") && !RX_RF.test("RF_a b") && !RX_RF.test("RF_"));
var rfSp = RF_LESEND.RF_sol_common_service_SordProvider, rfW = [];
pruefe("SordProvider: ohne output abgelehnt", /output/.test(fange(function () { rfSp.pruefen({ ids: ["1"] }, []); })));
pruefe("SordProvider: Suche ohne Maske abgelehnt", /Massenabfrage/.test(fange(function () { rfSp.pruefen({ search: [{ key: "X", value: "1" }], output: [{}] }, []); })));
pruefe("SordProvider: Maske ohne search abgelehnt", /search/.test(fange(function () { rfSp.pruefen({ masks: ["Beleg"], output: [{}] }, []); })));
var rfViele = []; for (var rv = 0; rv <= LIMIT_RF.ids; rv++) rfViele.push(String(rv));
pruefe("SordProvider: Grenze fuer ids", /Hoechstens/.test(fange(function () { rfSp.pruefen({ ids: rfViele, output: [{}] }, []); })));
var rfSu = rfSp.pruefen({ masks: ["Beleg"], search: [{ key: "BELEG_STATUS", value: "1" }], options: { maxResults: 5000 }, output: [{}] }, rfW);
var rfSu2 = rfSp.pruefen({ masks: ["Beleg"], search: [{ key: "BELEG_STATUS", value: "1" }], output: [{}] }, rfW);
pruefe("SordProvider: Treffer begrenzt bzw. vorgegeben", rfSu.options.maxResults === LIMIT_RF.treffer && rfSu2.options.maxResults === LIMIT_RF.standardTreffer && rfW.length === 2, JSON.stringify(rfW));
var rfLang = ""; while (rfLang.length <= LIMIT_RF.parameter) rfLang += "0123456789";
pruefe("Funktion: Parameter zu lang abgelehnt", /hoechstens/.test(fange(function () { rfParameterText(rfLang); })) && rfParameterText(undefined) === "" && rfParameterText({ a: 1 }) === "{\"a\":1}");

var fbIxEcht = ELO.ix, fbConnEcht = ELO.connect, fbIdsEcht = meineIds, fbNameEcht = benutzerName, fbCacheEcht = farbenCache, fbProtEcht = protokoll,
    fbSichEcht = jsonSichern, fbMapSichEcht = mapSichern, fbHttpEcht = httpHolen, fbIxAdrEcht = ixAdresse;
var fbKind = 1, fbCheckin = null, fbWfs = [], fbGesichert = [], fbLocks = [], fbRf = [], fbHttp = [], fbMap = { objekte: {}, wfactive: { BELEG_RUNDE: "1" } }, fbMapCheckin = null;
var fbKnoten = new IXC.WFNode(), fbKnoten2 = new IXC.WFNode(), fbNehmen = [], fbEditFehler = false, fbForward = 0;
fbKnoten.setId(3); fbKnoten.setType(2); fbKnoten.setName("Eingang pruefen"); fbKnoten.setUserId(3); fbKnoten.setUserName("Beispielgruppe"); fbKnoten.setEnterDateIso("20260301120000"); fbKnoten.setDepartment2(-1); fbKnoten.setDesignDepartment(3);
fbKnoten2.setId(4); fbKnoten2.setType(2); fbKnoten2.setName("Erfassen"); fbKnoten2.setUserId(5); fbKnoten2.setUserName("Muster, Max"); fbKnoten2.setEnterDateIso("20260301120000");
var fbWf = { getId: function () { return 5005; }, getName: function () { return "Vorgang Beispiel"; }, getObjId: function () { return 4711; }, getLockName: function () { return ""; },
             getNodes: function () { return [fbKnoten, fbKnoten2]; },
             getMatrix: function () { return { getAssocs: function () { return [{ getNodeFrom: function () { return 3; }, getNodeTo: function () { return 4; } }]; } }; } };
function fbAny(text) { var r = new IXC.Any(); r.setType(IXC.AnyC.TYPE_STRING); r.setStringValue(text); return r; }
ELO.ix = function () {
  return {
    checkoutSord: function (id, z, lock) {
      fbLocks.push(String(lock));
      var s = new IXC.Sord(); s.setId(4711); s.setName("Testbeleg"); s.setType(254); s.setMaskName("Beleg"); s.setGuid("(G-OBJEKT)"); s.setKind(fbKind);
      return { getSord: function () { return s; } };
    },
    checkinSord: function (s, z, lock) { fbCheckin = { kind: Number(s.getKind()), z: z, lock: String(lock) }; fbKind = Number(s.getKind()); return 4711; },
    findFirstWorkflows: function () { return { getWorkflows: function () { return fbWfs; }, getSearchId: function () { return "w1"; } }; },
    findClose: function () {},
    checkoutWorkFlow: function (id) { if (String(id) !== "5005") throw "[ELOIX:5023]Workflow nicht gefunden"; return fbWf; },
    checkoutMap: function (domain, id) {
      var st = fbMap[String(domain)], items = [];
      for (var k in st) (function (key) { items.push({ getKey: function () { return key; }, getValue: function () { return st[key]; } }); })(k);
      return { getItems: function () { return items; } };
    },
    checkinMap: function (domain, id, objId, arr) {
      fbMapCheckin = { domain: String(domain), id: String(id), objId: objId };
      for (var i = 0; i < arr.length; i++) { var k = String(arr[i].getKey()), v = String(arr[i].getValue()); if (v === "") delete fbMap[String(domain)][k]; else fbMap[String(domain)][k] = v; }
    },
    // Wie im Testarchiv beobachtet: ohne Benutzer nimmt das eigene Konto den Knoten (inUseDate gesetzt),
    // mit Gruppen-ID und RESET_IN_USE_DATE geht er an die Gruppe zurueck. department2 bleibt -1.
    takeWorkFlowNode: function (flowId, nodeId, user, flags) {
      fbNehmen.push(Number(flags) + ":" + (user === null ? "null" : String(user)));
      if (user === null) { fbKnoten.setUserId(75); fbKnoten.setUserName("Test, Konto"); fbKnoten.setInUseDateIso("20260301130000"); }
      else { fbKnoten.setUserId(parseInt(String(user), 10)); fbKnoten.setUserName(String(user) === "3" ? "Beispielgruppe" : "Gruppe " + user); if (Number(flags) & IXC.WFTakeNodeC.RESET_IN_USE_DATE) fbKnoten.setInUseDateIso(""); }
    },
    checkoutUser: function (wer) {
      var t = { "Beispielgruppe": [3, IXC.UserInfoC.TYPE_GROUP], "3": [3, IXC.UserInfoC.TYPE_GROUP], "Andere Gruppe": [9, IXC.UserInfoC.TYPE_GROUP], "Muster, Max": [5, IXC.UserInfoC.TYPE_USER] }[String(wer)];
      if (!t) throw "[ELOIX:5023]nicht gefunden";
      return { getId: function () { return t[0]; }, getType: function () { return t[1]; }, getName: function () { return String(wer); } };
    },
    beginEditWorkFlowNode: function () { if (fbEditFehler) throw "[ELOIX:2000]Knoten nicht bearbeitbar"; return { getNode: function () { return fbKnoten; } }; },
    forwardWorkflowNode: function () { fbForward++; },
    endEditWorkFlowNode: function () {},
    executeRegisteredFunction: function (name, any) { fbRf.push({ name: String(name), text: String(any.getStringValue()) }); return fbAny("{\"sords\": [{\"id\": \"4711\", \"name\": \"Testbeleg\"}]}"); }
  };
};
ELO.connect = function () {
  return { getLoginResult: function () { return { getUser: function () { return { getId: function () { return 75; }, getName: function () { return "Test, Konto"; } }; },
                                                   getClientInfo: function () { return { getTicket: function () { return "TICKET-XYZ"; } }; } }; } };
};
meineIds = function () { return { "75": true, "3": true }; };
benutzerName = function (id) { return String(id) === "3" ? "Beispielgruppe" : ""; };
farbenCache = FB_LISTE;
protokoll = function () {};
jsonSichern = function (name, inhalt) { fbGesichert.push({ name: name, inhalt: inhalt }); return "sicherung-" + name; };
mapSichern = function (p, werte, suffix) { fbGesichert.push({ name: "map" + suffix, bereich: p.bereich, werte: werte }); return "sicherung-map" + suffix; };
try {
  var fbL = mpJson(callTool("elo_colors", {}));
  pruefe("elo_colors: Farbliste", fbL.farben === 5 && fbL.liste[1].name === "ELO.COLOR.RED" && fbL.objekte === undefined, JSON.stringify(fbL));
  var fbO = mpJson(callTool("elo_colors", { objekt: "4711", ohneListe: true }));
  pruefe("elo_colors: Farbe eines Objekts", fbO.objekte[0].farbe.name === "ELO.COLOR.RED" && fbO.objekte[0].farbe.anzeige === "Rot" && fbO.liste === undefined, JSON.stringify(fbO));
  pruefe("elo_colors: ohneListe nur mit objekt", /nur zusammen mit objekt/.test(mpJson(callTool("elo_colors", { ohneListe: true })).fehler));

  var rfLes = mpJson(callTool("elo_function_read", { funktion: "RF_sol_common_service_SordProvider", parameter: { masks: ["Beleg"], search: [{ key: "BELEG_STATUS", value: "1" }], output: [{ source: { type: "SORD", key: "name" }, target: { prop: "name" } }] } }));
  pruefe("elo_function_read: Aufruf mit Grenze, Antwort als JSON", rfLes.ergebnis && rfLes.ergebnis.sords[0].id === "4711" && fbRf.length === 1 &&
         JSON.parse(fbRf[0].text).options.maxResults === LIMIT_RF.standardTreffer && enthaelt(rfLes.hinweise, "maxResults"), JSON.stringify(rfLes));
  pruefe("elo_function_read: andere Funktion abgelehnt", /nicht in der Liste/.test(mpJson(callTool("elo_function_read", { funktion: "RF_beispiel_Schreiben", parameter: {} })).fehler) && fbRf.length === 1);

  if (SCHREIBEN_ERLAUBT) {
    var fbV1 = mpJson(callTool("elo_color_set", { objekt: "4711", farbe: "yellow" }));
    pruefe("elo_color_set: Vorschau mit ID und Name bisher/neu, nichts geschrieben", /^Vorschau/.test(fbV1.modus) && fbCheckin === null && fbV1.vorschau.bisher.id === 1 &&
           fbV1.vorschau.bisher.name === "ELO.COLOR.RED" && fbV1.vorschau.neu.id === 8 && fbV1.vorschau.neu.anzeige === "Gelb", JSON.stringify(fbV1));
    var fbA1 = mpJson(callTool("elo_color_set", { objekt: "4711", farbe: "yellow", token: fbV1.token }));
    pruefe("elo_color_set: nur die Farbe eingecheckt, zurueckgelesen, gesichert", fbA1.modus === "ausgefuehrt" && fbCheckin.kind === 8 && Number(fbCheckin.z.getBset()) === Number(IXC.SordC.mbKind) &&
           fbA1.ergebnis.rueckgelesen === "ok, wie geplant" && fbGesichert[0].inhalt.farbe.id === 1 && /farbe="1"/.test(fbA1.ergebnis.hinweis), JSON.stringify(fbA1));
    pruefe("elo_color_set: gleiche Farbe ist keine Aenderung", /Keine Aenderung/.test(mpJson(callTool("elo_color_set", { objekt: "4711", farbe: "8" })).fehler));
    pruefe("elo_color_set: mehrdeutig abgelehnt", /mehrdeutig/.test(mpJson(callTool("elo_color_set", { objekt: "4711", farbe: "Gelb" })).fehler));
    fbWfs = [{ getId: function () { return 5005; }, getName: function () { return "Vorgang Beispiel"; } }];
    var fbV2 = mpJson(callTool("elo_color_set", { objekt: "4711", farbe: 0 }));
    pruefe("elo_color_set: laufender Workflow wird genannt", enthaelt(fbV2.warnungen, "Workflow 5005") && fbV2.vorschau.neu.name === "ELO.COLOR.SYSTEM", JSON.stringify(fbV2));
    var fbV3 = mpJson(callTool("elo_color_set", { objekt: "4711", farbe: "red" }));
    fbKind = 0;
    pruefe("elo_color_set: Farbe seit der Vorschau geaendert -> abgelehnt", /geaendert/.test(mpJson(callTool("elo_color_set", { objekt: "4711", farbe: "red", token: fbV3.token })).fehler));

    var wmV = mpJson(callTool("elo_map_set", { workflow: "5005", felder: { BELEG_PROBE: "1" } }));
    pruefe("elo_map_set workflow: Vorschau nennt den Vorgang", /^Vorschau/.test(wmV.modus) && wmV.vorschau.workflow === "Vorgang Beispiel [5005]" && wmV.vorschau.felder[0].neu === "1" &&
           enthaelt(wmV.warnungen, "laufenden Vorgangs") && fbMapCheckin === null, JSON.stringify(wmV));
    var wmA = mpJson(callTool("elo_map_set", { workflow: "5005", felder: { BELEG_PROBE: "1" }, token: wmV.token }));
    pruefe("elo_map_set workflow: in die Map des Vorgangs mit Objekt-ID", wmA.modus === "ausgefuehrt" && fbMapCheckin.domain === "wfactive" && fbMapCheckin.id === "5005" &&
           fbMapCheckin.objId === 4711 && fbMap.wfactive.BELEG_PROBE === "1" && fbMap.objekte.BELEG_PROBE === undefined && wmA.ergebnis.bereich === "Vorgang" &&
           wmA.ergebnis.rueckgelesen === "ok, wie geplant", JSON.stringify(wmA));
    pruefe("elo_map_set workflow: Sicherung im Bereich des Vorgangs", fbGesichert[fbGesichert.length - 2].bereich === "wfactive" && fbGesichert[fbGesichert.length - 2].werte.BELEG_PROBE === null);
    pruefe("elo_map_set: objekt und workflow zusammen abgelehnt", /nicht beides/.test(mpJson(callTool("elo_map_set", { objekt: "4711", workflow: "5005", felder: { A: "1" } })).fehler));
    pruefe("elo_map_set: unbekannter Vorgang abgelehnt", /nicht lesbar/.test(mpJson(callTool("elo_map_set", { workflow: "6006", felder: { A: "1" } })).fehler));

    var tkV = mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "3" }));
    pruefe("elo_task_take: Vorschau jetzt/danach, nichts angenommen", /^Vorschau/.test(tkV.modus) && tkV.vorschau.jetztBei === "Beispielgruppe" && tkV.vorschau.danachBei === "Test, Konto" &&
           fbNehmen.length === 0, JSON.stringify(tkV));
    var tkA = mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "3", token: tkV.token }));
    pruefe("elo_task_take: angenommen und zurueckgelesen", tkA.modus === "ausgefuehrt" && fbNehmen.join() === IXC.WFTakeNodeC.DEFAULT + ":null" &&
           tkA.ergebnis.rueckgelesen === "ok, wie geplant" && tkA.ergebnis.jetztBei === "Test, Konto", JSON.stringify(tkA));
    pruefe("elo_task_take: schon angenommen", /schon bei dir/.test(mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "3" })).fehler));
    pruefe("elo_task_take: an nur mit zurueckgeben", /nur zusammen mit zurueckgeben/.test(mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "3", an: "3" })).fehler));
    pruefe("elo_task_take: an muss eine eigene Gruppe sein", /nicht in der Gruppe/.test(mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "3", zurueckgeben: true, an: "Andere Gruppe" })).fehler) &&
           /keine Gruppe/.test(mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "3", zurueckgeben: true, an: "Muster, Max" })).fehler));
    var tkZ = mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "3", zurueckgeben: true }));
    var tkZA = mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "3", zurueckgeben: true, token: tkZ.token }));
    pruefe("elo_task_take: zurueckgeben an die Gruppe aus der Vorlage", tkZ.vorschau.danachBei === "Beispielgruppe" && fbNehmen[1] === IXC.WFTakeNodeC.RESET_IN_USE_DATE + ":3" &&
           tkZA.ergebnis.rueckgelesen === "ok, wie geplant" && fbKnoten.getUserId() === 3 && S(fbKnoten.getInUseDateIso()) === "", JSON.stringify(tkZA));
    pruefe("elo_task_take: zurueckgeben, wenn die Aufgabe nicht bei mir liegt, abgelehnt", /die bei dir liegt/.test(mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "3", zurueckgeben: true })).fehler));
    pruefe("elo_task_take: fremder Knoten abgelehnt", /keiner Gruppe/.test(mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "4" })).fehler));
    pruefe("elo_task_take: Knoten-ID muss eine Zahl sein", /Zahl/.test(mpJson(callTool("elo_task_take", { workflowId: "5005", knotenId: "x" })).fehler));

    var fwV0 = mpJson(callTool("elo_forward_task", { workflowId: "5005", knotenId: "3" }));
    pruefe("elo_forward_task: Hinweis auf offene Gruppenaufgabe", enthaelt(fwV0.warnungen, "annehmen=true") && fwV0.vorschau.vorherAnnehmen === undefined, JSON.stringify(fwV0.warnungen));
    fbNehmen = []; fbEditFehler = true;
    var fwV1 = mpJson(callTool("elo_forward_task", { workflowId: "5005", knotenId: "3", annehmen: true }));
    var fwA1 = mpJson(callTool("elo_forward_task", { workflowId: "5005", knotenId: "3", annehmen: true, token: fwV1.token }));
    pruefe("elo_forward_task annehmen: scheitert das Weiterleiten, geht die Aufgabe zurueck", fwV1.vorschau.vorherAnnehmen === true && /ELOIX:2000/.test(fwA1.fehler) &&
           fbNehmen.join() === IXC.WFTakeNodeC.DEFAULT + ":null," + IXC.WFTakeNodeC.RESET_IN_USE_DATE + ":3" && fbKnoten.getUserId() === 3 && fbForward === 0, JSON.stringify(fwA1) + " " + fbNehmen.join());
    fbNehmen = []; fbEditFehler = false;
    var fwV2 = mpJson(callTool("elo_forward_task", { workflowId: "5005", knotenId: "3", annehmen: true }));
    var fwA2 = mpJson(callTool("elo_forward_task", { workflowId: "5005", knotenId: "3", annehmen: true, token: fwV2.token }));
    pruefe("elo_forward_task annehmen: erst annehmen, dann weiterleiten", fwA2.modus === "ausgefuehrt" && fbNehmen.join() === IXC.WFTakeNodeC.DEFAULT + ":null" && fbForward === 1, JSON.stringify(fwA2));
  } else {
    pruefe("gesperrtes Farbwerkzeug wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_color_set", { objekt: "1", farbe: "1" })).fehler));
    pruefe("gesperrtes Annehmen wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_task_take", { workflowId: "1", knotenId: "1" })).fehler));
  }

  if (BAUEN_ERLAUBT) {
    fbRf = [];
    var rcV = mpJson(callTool("elo_function_call", { funktion: "RF_beispiel_Schreiben", parameter: { id: "4711", wert: "x" } }));
    pruefe("elo_function_call: Vorschau zeigt Aufruf und Warnung, ruft nicht auf", /^Vorschau/.test(rcV.modus) && rcV.vorschau.funktion === "RF_beispiel_Schreiben" &&
           rcV.vorschau.parameter.wert === "x" && enthaelt(rcV.warnungen, "koennen schreiben") && fbRf.length === 0, JSON.stringify(rcV));
    var rcA = mpJson(callTool("elo_function_call", { funktion: "RF_beispiel_Schreiben", parameter: { id: "4711", wert: "x" }, token: rcV.token }));
    pruefe("elo_function_call: mit token aufgerufen", rcA.modus === "ausgefuehrt" && fbRf.length === 1 && fbRf[0].text === "{\"id\":\"4711\",\"wert\":\"x\"}" &&
           rcA.ergebnis.ergebnis.sords.length === 1, JSON.stringify(rcA));
    pruefe("elo_function_call: ungueltiger Name abgelehnt", /beginnt mit RF_/.test(mpJson(callTool("elo_function_call", { funktion: "sol.beispiel" })).fehler));
    pruefe("elo_function_call: lesende Funktion bekommt Hinweis", enthaelt(mpJson(callTool("elo_function_call", { funktion: "RF_sol_common_service_SordProvider", parameter: "{}" })).warnungen, "elo_function_read"));

    ixAdresse = function () { return "https://elo.example.com:9093/ix-Archiv/ix"; };
    pruefe("Formular-Reload: Adresse aus der IX-Adresse", wfBasis("") === "https://elo.example.com:9093/ix-Archiv/plugin/de.elo.ix.plugin.proxy/wf/wf/", wfBasis(""));
    pruefe("Formular-Reload: eigene Adresse bekommt /", wfBasis("https://elo.example.com:9093/wf-Archiv/wf") === "https://elo.example.com:9093/wf-Archiv/wf/");
    pruefe("Formular-Reload: anderer Server abgelehnt", /demselben Server/.test(fange(function () { wfBasis("https://andere.example.com/wf/"); })));
    pruefe("Formular-Reload: Adresse mit ? abgelehnt", /ohne \?/.test(fange(function () { wfBasis("https://elo.example.com:9093/wf/?a=1"); })));
    ixAdresse = function () { return "https://elo.example.com:9093/ix-Archiv/ixx"; };
    pruefe("Formular-Reload: ohne /ix am Ende nur mit adresse", /adresse angeben/.test(fange(function () { wfBasis(""); })));
    ixAdresse = function () { return "https://elo.example.com:9093/ix-Archiv/ix"; };
    httpHolen = function (url) { fbHttp.push(url); return { code: 200, text: "<html><script>var t='TICKET-XYZ';</script><body>Formulare neu geladen ticket=TICKET-XYZ</body></html>", ziel: "" }; };
    var frV = mpJson(callTool("elo_form_reload", {}));
    pruefe("elo_form_reload: Vorschau ruft nichts auf", /^Vorschau/.test(frV.modus) && fbHttp.length === 0 && /edit.jsp\?reload=1$/.test(frV.vorschau.adresse), JSON.stringify(frV));
    var frRoh = callTool("elo_form_reload", { token: frV.token }), frA = mpJson(frRoh);
    pruefe("elo_form_reload: Aufruf mit Ticket, Antwort ohne Ticket", frA.modus === "ausgefuehrt" && fbHttp.length === 1 && /reload=1&ticket=TICKET-XYZ$/.test(fbHttp[0]) &&
           frRoh.content[0].text.indexOf("TICKET-XYZ") < 0 && /Formulare neu geladen/.test(frA.ergebnis.seite), frRoh.content[0].text);
    httpHolen = function () { return { code: 302, text: "", ziel: "https://elo.example.com:9093/login?ticket=TICKET-XYZ" }; };
    var frV2 = mpJson(callTool("elo_form_reload", {})), frRoh2 = callTool("elo_form_reload", { token: frV2.token });
    pruefe("elo_form_reload: Umleitung ist ein Fehler, ohne Ticket", frRoh2.isError && /Anmeldung/.test(frRoh2.content[0].text) && frRoh2.content[0].text.indexOf("TICKET-XYZ") < 0, frRoh2.content[0].text);
    httpHolen = function (url) { throw new java.io.IOException("Server returned HTTP response code: 500 for URL: " + url); };
    var frV3 = mpJson(callTool("elo_form_reload", {})), frRoh3 = callTool("elo_form_reload", { token: frV3.token });
    pruefe("elo_form_reload: Ausnahme ohne Ticket gemeldet", frRoh3.isError && /nicht erreichbar/.test(frRoh3.content[0].text) && frRoh3.content[0].text.indexOf("TICKET-XYZ") < 0, frRoh3.content[0].text);
  } else {
    pruefe("gesperrter Funktionsaufruf wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_function_call", { funktion: "RF_x" })).fehler));
    pruefe("gesperrter Formular-Reload wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_form_reload", {})).fehler));
  }
} finally {
  ELO.ix = fbIxEcht; ELO.connect = fbConnEcht; meineIds = fbIdsEcht; benutzerName = fbNameEcht; farbenCache = fbCacheEcht; protokoll = fbProtEcht;
  jsonSichern = fbSichEcht; mapSichern = fbMapSichEcht; httpHolen = fbHttpEcht; ixAdresse = fbIxAdrEcht;
}

/* ---------- 0.13.0: Verweise, Verschieben, Loeschen, Wiederherstellen (nur im Speicher, erfundene Ablage) ---------- */

pruefe("tools/list: Verweise lesen immer", !!namen.elo_references);
pruefe("tools/list: Verweis setzen und Verschieben nur mit -Schreiben", !!namen.elo_reference_set === SCHREIBEN_ERLAUBT && !!namen.elo_move === SCHREIBEN_ERLAUBT);
pruefe("tools/list: Loeschen und Wiederherstellen nur mit -Bauen", !!namen.elo_delete === BAUEN_ERLAUBT && !!namen.elo_restore === BAUEN_ERLAUBT);

/* Ablage: Akten [10] mit Akte A [11] (Dokument Vertrag Muster [20], Verweis davon in Ablage B [14]), Leer [12] mit Unterordner leer [13],
   Ablage B [14] mit Rechnung [21], Mit Verweis [15] (nur ein Verweis auf [21]), Baum [16] mit Ast [17].
   Wie im Testarchiv beobachtet: Loeschen markiert den ganzen Baum mit demselben Zeitpunkt, ein entfernter Verweis bleibt als
   geloeschter Verweis mit eigenem Zeitpunkt stehen, restoreSord mit minDeleteDate holt alles ab diesem Zeitpunkt zurueck. */
var AB, abAufrufe, abUhr;
function abNeu() {
  abAufrufe = []; abUhr = "20261115120000";
  AB = { "1": { name: "Wurzel", typ: 1, eltern: "0", verweise: [] }, "10": { name: "Akten", typ: 1, eltern: "1", verweise: [] },
         "11": { name: "Akte A", typ: 1, eltern: "10", verweise: [] }, "12": { name: "Leer", typ: 1, eltern: "10", verweise: [] },
         "13": { name: "Unterordner leer", typ: 1, eltern: "12", verweise: [] }, "14": { name: "Ablage B", typ: 1, eltern: "10", verweise: [] },
         "15": { name: "Mit Verweis", typ: 1, eltern: "10", verweise: [] }, "16": { name: "Baum", typ: 1, eltern: "10", verweise: [] },
         "17": { name: "Ast", typ: 1, eltern: "16", verweise: [] },
         "20": { name: "Vertrag Muster", typ: 254, eltern: "11", verweise: ["14"] }, "21": { name: "Rechnung", typ: 254, eltern: "14", verweise: ["15"] } };
}
function abKette(f) {
  var k = [];
  while (f && f !== "1" && f !== "0") { var n = new IXC.IdName(); n.setId(parseInt(f, 10)); n.setName(AB[f].name); k.unshift(n); f = AB[f].eltern; }
  return k;
}
function abSord(id, verweisWeg) {
  var o = AB[id], s = new IXC.Sord(), aps = [], orte = [o.eltern].concat(o.verweise);
  s.setId(parseInt(id, 10)); s.setName(o.name); s.setType(o.typ); s.setParentId(parseInt(o.eltern, 10)); s.setGuid("(G-" + id + ")"); s.setMaskName("Basis");
  s.setDeleted(!!o.geloescht); s.setLockId(o.sperre || -1); s.setLockName(o.sperre ? "Muster, Max" : ""); s.setLockIdDoc(-1);
  if (o.geloescht) { s.setDeleteDateIso(o.geloescht); s.setDeleteUser(5); }
  for (var i = 0; i < orte.length; i++) { if (orte[i] === "0") continue; var ap = new IXC.ArcPath(); ap.setPath(jarr("IdName", abKette(orte[i]))); aps.push(ap); }
  s.setRefPaths(jarr("ArcPath", aps));
  if (verweisWeg) { s.setDeleted(true); s.setDeleteDateIso(verweisWeg); s.setDeleteUser(5); }
  return s;
}
function abWeg(o, f) { for (var i = 0; o.verweiseWeg && i < o.verweiseWeg.length; i++) if (o.verweiseWeg[i].ordner === f) return o.verweiseWeg[i].am; return ""; }
function abHier(f, mitGeloeschten) {
  var r = [];
  for (var id in AB) {
    var o = AB[id];
    if (o.eltern === f || o.verweise.indexOf(f) >= 0) { if (!o.geloescht || mitGeloeschten) r.push(abSord(id)); }
    else if (mitGeloeschten && abWeg(o, f)) r.push(abSord(id, abWeg(o, f)));
  }
  return r;
}
function abMarkieren(id, am) { AB[id].geloescht = am; for (var k in AB) if (AB[k].eltern === id && !AB[k].geloescht) abMarkieren(k, am); }
function abZurueck(id, ab) {
  delete AB[id].geloescht;
  for (var k in AB) {
    var o = AB[k];
    if (o.eltern === id && o.geloescht && o.geloescht >= ab) abZurueck(k, ab);
    var w = abWeg(o, id);
    if (w && w >= ab) { o.verweise.push(id); o.verweiseWeg = o.verweiseWeg.filter(function (x) { return x.ordner !== id; }); }
  }
}
var abIxEcht = ELO.ix, abConnEcht = ELO.connect, abNameEcht = benutzerName, abProtEcht = protokoll, abSichEcht = jsonSichern, abWarteEcht = warte, abGesichert = [];
ELO.ix = function () {
  return {
    checkoutSord: function (id) { id = String(id); if (!AB[id]) throw "[ELOIX:5023]nicht gefunden " + id; return { getSord: function () { return abSord(id); } }; },
    findFirstSords: function (fi) {
      var fc = fi.getFindChildren(), fo = fi.getFindOptions(), r = fc ? abHier(String(fc.getParentId()), !!(fo && fo.isInclDeleted())) : [];
      return { getSords: function () { return r; }, isMoreResults: function () { return false; }, getSearchId: function () { return "s1"; } };
    },
    findClose: function () {},
    refSord: function (alt, neu, id) {
      alt = String(alt); neu = String(neu); id = String(id); abAufrufe.push("ref " + alt + ">" + neu + " " + id);
      var o = AB[id];
      if (alt === "") o.verweise.push(neu); else if (alt === o.eltern) o.eltern = neu; else o.verweise[o.verweise.indexOf(alt)] = neu;
    },
    deleteSord: function (eltern, id, lock, opt) {
      eltern = String(eltern); id = String(id);
      abAufrufe.push("del " + eltern + " " + id + (opt ? (opt.isDeleteFinally() ? " endgueltig" : " markieren") : ""));
      var o = AB[id];
      if (eltern === o.eltern) abMarkieren(id, abUhr);
      else { o.verweise.splice(o.verweise.indexOf(eltern), 1); (o.verweiseWeg = o.verweiseWeg || []).push({ ordner: eltern, am: abUhr }); }
    },
    restoreSord: function (id, ro) {
      id = String(id); abAufrufe.push("restore " + id + (ro.isSingleObject() ? " einzeln" : " ab " + ro.getMinDeleteDate()));
      if (!AB[id].geloescht) throw "[ELOIX:2000]nicht geloescht " + id;
      if (ro.isSingleObject()) delete AB[id].geloescht; else abZurueck(id, String(ro.getMinDeleteDate()));
    }
  };
};
ELO.connect = function () { return { getLoginResult: function () { return { getUser: function () { return { getId: function () { return 75; }, getName: function () { return "Test, Konto"; } }; } }; } }; };
benutzerName = function (id) { return String(id) === "5" ? "Muster, Max" : ""; };
protokoll = function () {};
jsonSichern = function (name, inhalt) { abGesichert.push({ name: name, inhalt: inhalt }); return "sicherung-" + name; };
warte = function () {};
function abZwei(name, args) {
  var v = mpJson(callTool(name, args));
  if (v.fehler) return { vorschau: v, ergebnis: v };
  var vorAufrufe = abAufrufe.length, a2 = {};
  for (var k in args) a2[k] = args[k];
  a2.token = v.token;
  return { vorschau: v, aufrufeInVorschau: vorAufrufe, ergebnis: mpJson(callTool(name, a2)) };
}
try {
  abNeu();
  var abR = mpJson(callTool("elo_references", { objekt: "20" }));
  pruefe("elo_references: Hauptablage und Verweis", abR.hauptablage.ordner === "11" && abR.hauptablage.pfad === "Akten/Akte A" && abR.anzahlVerweise === 1 &&
         abR.verweise[0].ordner === "14" && abR.verweise[0].pfad === "Akten/Ablage B" && abR.geloescht === undefined, JSON.stringify(abR));
  var abO = mpJson(callTool("elo_references", { ordner: "14" }));
  pruefe("elo_references: Verweise in einem Ordner", abO.eintraege === 2 && abO.hierAbgelegt === 1 && abO.anzahlVerweise === 1 && abO.verweise[0].id === "20" &&
         abO.verweise[0].hauptablage.ordner === "11", JSON.stringify(abO));
  pruefe("elo_references: objekt oder ordner", /Entweder/.test(mpJson(callTool("elo_references", {})).fehler) && /Entweder/.test(mpJson(callTool("elo_references", { objekt: "20", ordner: "14" })).fehler));
  AB["21"].geloescht = "20261101080000";
  var abG = mpJson(callTool("elo_references", { objekt: "21" }));
  pruefe("elo_references: geloeschtes Objekt mit Datum und Konto", abG.geloescht === true && abG.geloeschtAm === "01.11.2026 08:00 UTC" && abG.geloeschtVon === "Muster, Max", JSON.stringify(abG));
  delete AB["21"].geloescht;

  if (SCHREIBEN_ERLAUBT) {
    var abV1 = abZwei("elo_reference_set", { aktion: "anlegen", verweise: [{ objekt: "21", ordner: "11" }] });
    pruefe("elo_reference_set anlegen: Vorschau ruft nichts auf, dann refSord mit leerem alten Ordner", abV1.aufrufeInVorschau === 0 && abV1.vorschau.vorschau.anzahl === 1 &&
           abV1.ergebnis.ergebnis.erledigt === 1 && abAufrufe.join() === "ref >11 21" && AB["21"].verweise.indexOf("11") >= 0, JSON.stringify(abV1) + " " + abAufrufe.join());
    pruefe("elo_reference_set: Verweis gibt es schon", /schon einen Verweis/.test(mpJson(callTool("elo_reference_set", { aktion: "anlegen", verweise: [{ objekt: "21", ordner: "11" }] })).fehler));
    pruefe("elo_reference_set: Verweis in der Hauptablage abgelehnt", /schon in der Hauptablage/.test(mpJson(callTool("elo_reference_set", { aktion: "anlegen", verweise: [{ objekt: "21", ordner: "14" }] })).fehler));
    pruefe("elo_reference_set: Ordner als Verweis in sich selbst abgelehnt", /Ring/.test(mpJson(callTool("elo_reference_set", { aktion: "anlegen", verweise: [{ objekt: "10", ordner: "13" }] })).fehler));
    pruefe("elo_reference_set: Hauptablage wird nie entfernt", /kein Verweis/.test(mpJson(callTool("elo_reference_set", { aktion: "entfernen", verweise: [{ objekt: "20", ordner: "11" }] })).fehler));
    pruefe("elo_reference_set: kein Verweis im Ordner", /keinen Verweis/.test(mpJson(callTool("elo_reference_set", { aktion: "entfernen", verweise: [{ objekt: "20", ordner: "12" }] })).fehler));
    pruefe("elo_reference_set: Ziel muss Ordner sein", /Kein Ordner/.test(mpJson(callTool("elo_reference_set", { aktion: "anlegen", verweise: [{ objekt: "21", ordner: "20" }] })).fehler));
    abAufrufe = []; abGesichert = [];
    var abV2 = abZwei("elo_reference_set", { aktion: "entfernen", verweise: [{ objekt: "20", ordner: "14" }, { objekt: "20", ordner: "14" }] });
    pruefe("elo_reference_set entfernen: doppelte Angabe einmal, deleteSord im Verweisordner, Sicherung, Objekt bleibt",
           abV2.vorschau.vorschau.anzahl === 1 && abAufrufe.join() === "del 14 20" && abGesichert.length === 1 && abGesichert[0].inhalt.verweise[0].ordner === "14" &&
           !AB["20"].geloescht && AB["20"].verweise.length === 0 && abV2.ergebnis.ergebnis.erledigt === 1, JSON.stringify(abV2.ergebnis) + " " + abAufrufe.join());

    abAufrufe = [];
    var abM1 = abZwei("elo_move", { objekte: ["21"], ziel: "12" });
    pruefe("elo_move: Hauptablage verschieben", abM1.aufrufeInVorschau === 0 && abM1.vorschau.vorschau.objekte[0].von === "Akten/Ablage B [14]" &&
           abM1.vorschau.vorschau.objekte[0].was === "Hauptablage" && abAufrufe.join() === "ref 14>12 21" && AB["21"].eltern === "12" && abM1.ergebnis.ergebnis.verschoben === 1,
           JSON.stringify(abM1) + " " + abAufrufe.join());
    pruefe("elo_move: liegt schon im Ziel", /liegt schon/.test(mpJson(callTool("elo_move", { objekte: ["21"], ziel: "12" })).fehler));
    pruefe("elo_move: Verweis im Ziel", /schon einen Verweis/.test(mpJson(callTool("elo_move", { objekte: ["21"], ziel: "11" })).fehler));
    pruefe("elo_move: Ordner in den eigenen Baum abgelehnt", /Ring/.test(mpJson(callTool("elo_move", { objekte: ["10"], ziel: "13" })).fehler) &&
           /Ring/.test(mpJson(callTool("elo_move", { objekte: ["12"], ziel: "12" })).fehler));
    pruefe("elo_move: von nur bei einem Objekt", /nur mit einem Objekt/.test(mpJson(callTool("elo_move", { objekte: ["20", "21"], ziel: "16", von: "11" })).fehler));
    pruefe("elo_move: von muss ein Ablageort sein", /liegt nicht in Ordner 17/.test(mpJson(callTool("elo_move", { objekte: ["21"], ziel: "16", von: "17" })).fehler));
    abAufrufe = [];
    var abM2 = abZwei("elo_move", { objekte: ["21"], ziel: "16", von: "11" });
    pruefe("elo_move: Verweis verschieben, Hauptablage bleibt", abM2.vorschau.vorschau.objekte[0].was === "Verweis" && abAufrufe.join() === "ref 11>16 21" &&
           AB["21"].eltern === "12" && AB["21"].verweise.indexOf("16") >= 0 && AB["21"].verweise.indexOf("11") < 0 && abM2.ergebnis.ergebnis.verschoben === 1, JSON.stringify(abM2.ergebnis));
    AB["20"].sperre = 5;
    pruefe("elo_move: fremd gesperrt abgelehnt", /gesperrt von Muster, Max/.test(mpJson(callTool("elo_move", { objekte: ["20"], ziel: "12" })).fehler));
    AB["20"].sperre = 75;
    pruefe("elo_move: eigene Sperre stoert nicht", /^Vorschau/.test(mpJson(callTool("elo_move", { objekte: ["20"], ziel: "12" })).modus));
    delete AB["20"].sperre;
    var abZu = []; for (var az = 0; az <= LIMIT_ABLAGE.objekte; az++) abZu.push(String(az + 1000));
    pruefe("elo_move: Obergrenze Objekte", /Hoechstens/.test(mpJson(callTool("elo_move", { objekte: abZu, ziel: "12" })).fehler));
  } else {
    pruefe("gesperrtes Verschieben wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_move", { objekte: ["21"], ziel: "12" })).fehler));
  }

  if (BAUEN_ERLAUBT) {
    abNeu(); abGesichert = [];
    var abL1 = abZwei("elo_delete", { objekte: ["12"] });
    pruefe("elo_delete: leerer Ordnerbaum, Vorschau zaehlt, nur markieren, Sicherung vorher", abL1.aufrufeInVorschau === 0 && abL1.vorschau.vorschau.summe.unterordner === 1 &&
           abL1.vorschau.vorschau.summe.dokumente === 0 && abAufrufe.join() === "del 10 12 markieren" && AB["12"].geloescht && abGesichert.length === 1 &&
           abGesichert[0].inhalt.objekte[0].eltern === "10" && abL1.ergebnis.ergebnis.geloescht === 1, JSON.stringify(abL1) + " " + abAufrufe.join());
    pruefe("elo_delete: schon geloescht", /schon geloescht/.test(mpJson(callTool("elo_delete", { objekte: ["12"] })).fehler));
    pruefe("elo_delete: Ordner mit Dokument nur mit mitInhalt", /1 Dokumente darin: Vertrag Muster \[20\]/.test(mpJson(callTool("elo_delete", { objekte: ["11"] })).fehler));
    pruefe("elo_delete: Ordner mit Verweis nur mit mitInhalt", /1 Verweise darin: Rechnung \[21\] in 15/.test(mpJson(callTool("elo_delete", { objekte: ["15"] })).fehler));
    pruefe("elo_delete: Dokument nur mit mitInhalt", /ist ein Dokument/.test(mpJson(callTool("elo_delete", { objekte: ["21"] })).fehler));
    pruefe("elo_delete: Archivwurzel nie", /Archivwurzel/.test(mpJson(callTool("elo_delete", { objekte: ["1"] })).fehler));
    var abL2 = mpJson(callTool("elo_delete", { objekte: ["11", "16", "17"], ueberspringen: true }));
    pruefe("elo_delete: ueberspringen laesst aus, Ast geht mit dem Baum", abL2.vorschau.anzahl === 1 && abL2.vorschau.objekte[0].objekt === "Baum [16]" &&
           abL2.vorschau.ausgelassen.length === 1 && /Akte A/.test(abL2.vorschau.ausgelassen[0].objekt) && abL2.vorschau.gehenMit.length === 1, JSON.stringify(abL2));
    var abL3 = mpJson(callTool("elo_delete", { objekte: ["11"], mitInhalt: true }));
    pruefe("elo_delete mitInhalt: zaehlt Dokument, warnt vor Verweis von ausserhalb", abL3.vorschau.summe.dokumente === 1 && enthaelt(abL3.warnungen, "Verweise ausserhalb") &&
           enthaelt(abL3.warnungen, "Ablage B [14]"), JSON.stringify(abL3));
    var abL4 = mpJson(callTool("elo_delete", { objekte: ["21"], mitInhalt: true }));
    pruefe("elo_delete mitInhalt: Dokument mit Verweis gewarnt", abL4.vorschau.summe.dokumente === 1 && enthaelt(abL4.warnungen, "hat 1 Verweise"), JSON.stringify(abL4));
    AB["17"].sperre = 5;
    pruefe("elo_delete: gesperrter Eintrag im Baum", /gesperrt: Ast \[17\] von Muster, Max/.test(mpJson(callTool("elo_delete", { objekte: ["16"] })).fehler));
    delete AB["17"].sperre;

    abAufrufe = [];
    var abW1 = abZwei("elo_restore", { objekte: ["12"] });
    pruefe("elo_restore: Vorschau nennt Datum, Konto und Inhalt, dann restoreSord ab Loeschdatum", abW1.aufrufeInVorschau === 0 && abW1.vorschau.vorschau.objekte[0].geloeschtVon === "Muster, Max" &&
           abW1.vorschau.vorschau.objekte[0].geloeschtAm === "15.11.2026 12:00 UTC" && abW1.vorschau.vorschau.objekte[0].mitZurueck.unterordner === 1 &&
           abAufrufe.join() === "restore 12 ab 20261115120000" && !AB["12"].geloescht && !AB["13"].geloescht &&
           abW1.ergebnis.ergebnis.wiederhergestellt === 1, JSON.stringify(abW1) + " " + abAufrufe.join());
    pruefe("elo_restore: nicht geloescht", /nicht geloescht/.test(mpJson(callTool("elo_restore", { objekte: ["12"] })).fehler));
    AB["16"].geloescht = "20261115130000"; AB["17"].geloescht = "20261115130000";
    pruefe("elo_restore: geloeschter Elternordner blockiert", /Elternordner Baum \[16\] ist selbst geloescht/.test(mpJson(callTool("elo_restore", { objekte: ["17"] })).fehler));
    abAufrufe = [];
    var abW2 = abZwei("elo_restore", { objekte: ["17", "16"], einzeln: true });
    pruefe("elo_restore: Elternordner zuerst, einzeln", abAufrufe.join() === "restore 16 einzeln,restore 17 einzeln" && abW2.ergebnis.ergebnis.wiederhergestellt === 2 &&
           abW2.vorschau.vorschau.objekte[0].bleibenGeloescht === 1 && enthaelt(abW2.vorschau.warnungen, "bleibt geloescht"), abAufrufe.join() + " " + JSON.stringify(abW2.vorschau));
    abMarkieren("16", "20261115130000"); abAufrufe = [];
    var abW3 = abZwei("elo_restore", { objekte: ["17", "16"] });
    pruefe("elo_restore: Inhalt kommt mit dem Elternordner, kein zweiter Aufruf", abAufrufe.join() === "restore 16 ab 20261115130000" &&
           abW3.ergebnis.ergebnis.wiederhergestellt === 1 && abW3.ergebnis.ergebnis.mitElternordner[0] === "17" && !AB["17"].geloescht, abAufrufe.join() + " " + JSON.stringify(abW3.ergebnis));

    /* Verweis entfernt, Ordner spaeter geloescht: der Verweis bleibt beim Wiederherstellen weg. */
    abNeu(); abUhr = "20261115100000";
    abZwei("elo_reference_set", { aktion: "entfernen", verweise: [{ objekt: "21", ordner: "15" }] });
    abUhr = "20261115110000";
    abZwei("elo_delete", { objekte: ["15"] });
    var abW4 = abZwei("elo_restore", { objekte: ["15"] });
    pruefe("elo_restore: frueher entfernter Verweis bleibt weg", abW4.vorschau.vorschau.objekte[0].mitZurueck.verweise === 0 && abW4.vorschau.vorschau.objekte[0].bleibenGeloescht === 1 &&
           !AB["15"].geloescht && AB["21"].verweise.indexOf("15") < 0 && !enthaelt(abW4.vorschau.warnungen, "kommen mit zurueck"), JSON.stringify(abW4.vorschau));
    /* Verweis in derselben Minute entfernt wie der Ordner geloescht: er kommt mit zurueck, die Vorschau sagt es. */
    abNeu();
    abZwei("elo_reference_set", { aktion: "entfernen", verweise: [{ objekt: "21", ordner: "15" }] });
    abZwei("elo_delete", { objekte: ["15"] });
    var abW5 = abZwei("elo_restore", { objekte: ["15"] });
    pruefe("elo_restore: Verweis aus derselben Minute kommt mit und wird gewarnt", abW5.vorschau.vorschau.objekte[0].mitZurueck.verweise === 1 &&
           enthaelt(abW5.vorschau.warnungen, "kommen mit zurueck: Rechnung [21] in 15") && AB["21"].verweise.indexOf("15") >= 0, JSON.stringify(abW5.vorschau));
  } else {
    pruefe("gesperrtes Loeschen wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_delete", { objekte: ["12"] })).fehler));
    pruefe("gesperrtes Wiederherstellen wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_restore", { objekte: ["12"] })).fehler));
  }
} finally {
  ELO.ix = abIxEcht; ELO.connect = abConnEcht; benutzerName = abNameEcht; protokoll = abProtEcht; jsonSichern = abSichEcht; warte = abWarteEcht;
}

/* ---------- Vorgaenge beenden (nur im Speicher, erfundene Vorgaenge) ---------- */

pruefe("tools/list: Vorgaenge beenden nur mit -Schreiben", !!namen.elo_workflow_terminate === SCHREIBEN_ERLAUBT);

/* Konto 75 (Gruppe 3). Vorgang 101 (Vorlage 69) mit zwei Aufgaben fuer 75, 102 (Vorlage 70) bei Gruppe 3,
   103 (Vorlage 69) nur in Vertretung sichtbar, 104 beendet. */
var WB, wbAufrufe, wbFind, wbGesichert, wbBlatt;
function wbNeu() {
  wbAufrufe = []; wbFind = []; wbGesichert = [];
  WB = { "101": { name: "Pruefung A", obj: 4711, tpl: 69, aktiv: true, knoten: [[2, "Pruefen", "Test, Konto", 75], [3, "Freigeben", "Test, Konto", 75]] },
         "102": { name: "Pruefung B", obj: 4712, tpl: 70, aktiv: true, knoten: [[2, "Buchen", "Beispielgruppe", 3]] },
         "103": { name: "Pruefung C", obj: 4713, tpl: 69, aktiv: true, knoten: [[2, "Pruefen", "Muster, Max", 5]] },
         "104": { name: "Alt", obj: 4714, tpl: 69, aktiv: false, knoten: [] } };
}
function wbDiagramm(id) {
  var o = WB[id], wf = new IXC.WFDiagram(), ns = [];
  wf.setId(parseInt(id, 10)); wf.setName(o.name); wf.setObjId(String(o.obj)); wf.setTemplateId(o.tpl); wf.setLockName(o.sperre || "");
  for (var i = 0; i < o.knoten.length; i++) {
    var k = o.knoten[i], n = new IXC.WFNode();
    n.setId(k[0]); n.setName(k[1]); n.setType(IXC.WFNodeC.TYPE_PERSONNODE); n.setUserName(k[2]); n.setUserId(k[3]); n.setEnterDateIso("20261119080000"); n.setExitDateIso("");
    ns.push(n);
  }
  wf.setNodes(jarr("WFNode", ns));
  return wf;
}
function wbAufgabe(flow, knoten, bei) {
  return { getWfNode: function () { return { getFlowId: function () { return flow; }, getNodeName: function () { return knoten; }, getUserName: function () { return bei; } }; } };
}
var wbIxEcht = ELO.ix, wbConnEcht = ELO.connect, wbProtEcht = protokoll, wbSichEcht = jsonSichern, wbWarteEcht = warte, wbTestEcht = testArchiv, wbVnEcht = vorlageNachName, wbSeite = LIMIT_BEENDEN.seite;
ELO.ix = function () {
  return {
    checkoutUser: function (wer) {
      if (String(wer) !== "75" && String(wer) !== "Test, Konto") throw "[ELOIX:5023]unbekannt " + wer;
      var u = new IXC.UserInfo(); u.setId(75); u.setName("Test, Konto"); u.setType(IXC.UserInfoC.TYPE_USER); return u;
    },
    findFirstTasks: function (fi, max) {
      var l = [wbAufgabe(101, "Pruefen", "Test, Konto"), wbAufgabe(101, "Freigeben", "Test, Konto")];
      if (fi.isInclGroup()) l.push(wbAufgabe(102, "Buchen", "Beispielgruppe"));
      if (fi.isInclDeputy()) l.push(wbAufgabe(103, "Pruefen", "Muster, Max"));
      l = l.filter(function (t) { return WB[String(t.getWfNode().getFlowId())].aktiv; });
      wbFind.push({ user: String(fi.getUserIds()[0]), gruppe: fi.isInclGroup(), vertretung: fi.isInclDeputy(), inUse: fi.isUpdateInUseDate(), wf: fi.isInclWorkflows(), prio: fi.getHighestPriority() + "-" + fi.getLowestPriority() });
      function seite(ab) { var s = l.slice(ab, ab + max); return { getTasks: function () { return s; }, isMoreResults: function () { return ab + max < l.length; }, getSearchId: function () { return "t1"; } }; }
      wbAufrufe.push("find"); wbBlatt = seite;
      return seite(0);
    },
    findNextTasks: function (sid, ab) { wbAufrufe.push("next " + ab); return wbBlatt(ab); },
    findClose: function () { wbAufrufe.push("close"); },
    checkoutWorkFlow: function (id, typ) {
      id = String(id); typ = String(typ);
      if (typ === "TEMPLATE") { var t = new IXC.WFDiagram(); t.setId(parseInt(id, 10)); t.setName({ "69": "WF-Dokument pruefen", "70": "Andere Vorlage" }[id] || ""); if (!t.getName()) throw "[ELOIX:5023]keine Vorlage"; return t; }
      if (!WB[id]) throw "[ELOIX:5023]nicht gefunden " + id;
      if ((typ === "ACTIVE") !== WB[id].aktiv) throw "[ELOIX:5023]nicht " + typ + " " + id;
      return wbDiagramm(id);
    },
    terminateWorkFlow: function (id, lock) {
      id = String(id); wbAufrufe.push("terminate " + id + (lock === IXC.LockC.YES ? " sperren" : ""));
      if (WB[id].fehler) throw "[ELOIX:2000]" + WB[id].fehler;
      if (!WB[id].bleibt) WB[id].aktiv = false;
    }
  };
};
ELO.connect = function () { return { getLoginResult: function () { return { getUser: function () { return { getId: function () { return 75; }, getName: function () { return "Test, Konto"; } }; } }; } }; };
protokoll = function () {};
jsonSichern = function (name, inhalt) { wbGesichert.push({ name: name, inhalt: inhalt }); return "sicherung-" + name; };
warte = function () {};
vorlageNachName = function (n) { return { "WF-Dokument pruefen": ["69"], "Andere Vorlage": ["70"] }[n] || []; };
function wbZwei(args) {
  var v = mpJson(callTool("elo_workflow_terminate", args));
  if (v.fehler) return { vorschau: v, ergebnis: v };
  var vorAufrufe = wbAufrufe.filter(function (x) { return /^terminate/.test(x); }).length, a2 = {};
  for (var k in args) a2[k] = args[k];
  a2.token = v.token;
  return { vorschau: v, terminateInVorschau: vorAufrufe, ergebnis: mpJson(callTool("elo_workflow_terminate", a2)) };
}
try {
  if (SCHREIBEN_ERLAUBT) {
    testArchiv = function () { return true; };
    LIMIT_BEENDEN.seite = 2;
    wbNeu();
    var wbB1 = wbZwei({ benutzer: "75" });
    var wbV1 = wbB1.vorschau.vorschau;
    pruefe("elo_workflow_terminate benutzer: Vorschau mit Gruppenaufgaben, ohne Vertretung, jeder Vorgang einmal", wbB1.terminateInVorschau === 0 && wbV1.anzahl === 2 &&
           wbV1.vorgaenge[0].id === "101" && wbV1.vorgaenge[1].id === "102" && wbV1.auswahl.benutzer === "Test, Konto [75]" && wbV1.auswahl.aufgaben === 3, JSON.stringify(wbV1));
    pruefe("elo_workflow_terminate benutzer: Vorschau nennt aktive Knoten mit Bearbeiter und Vorlage", wbV1.vorgaenge[0].aktiveKnoten.join("|") === "Pruefen (Test, Konto)|Freigeben (Test, Konto)" &&
           wbV1.vorgaenge[0].vorlage === "WF-Dokument pruefen [69]" && wbV1.vorgaenge[1].vorlage === "Andere Vorlage [70]" && wbV1.vorgaenge[0].name === "Pruefung A", JSON.stringify(wbV1.vorgaenge));
    pruefe("elo_workflow_terminate benutzer: Suche mit userIds, Gruppen, ohne Vertretung, ohne inUseDate, blaettert und schliesst",
           wbFind[0].user === "75" && wbFind[0].gruppe === true && wbFind[0].vertretung === false && wbFind[0].inUse === false && wbFind[0].wf === true && wbFind[0].prio === "0-2" &&
           wbAufrufe.indexOf("next 2") >= 0 && wbAufrufe.indexOf("close") >= 0, JSON.stringify(wbFind) + " " + wbAufrufe.join());
    pruefe("elo_workflow_terminate benutzer: beendet mit Sperre, Sicherung vorher, Ergebnis je Vorgang",
           wbB1.ergebnis.modus === "ausgefuehrt" && wbB1.ergebnis.ergebnis.beendet === 2 && wbB1.ergebnis.ergebnis.fehler === undefined &&
           wbAufrufe.filter(function (x) { return /^terminate/.test(x); }).join() === "terminate 101 sperren,terminate 102 sperren" &&
           wbGesichert.length === 1 && wbGesichert[0].inhalt.vorgaenge.length === 2 && wbGesichert[0].inhalt.vorgaenge[0].knoten.length === 2 && !WB["101"].aktiv && !WB["102"].aktiv,
           JSON.stringify(wbB1.ergebnis) + " " + wbAufrufe.join());
    pruefe("elo_workflow_terminate benutzer: danach nichts mehr offen", /Keine offenen Workflow-Aufgaben/.test(mpJson(callTool("elo_workflow_terminate", { benutzer: "75" })).fehler));

    wbNeu();
    var wbG = mpJson(callTool("elo_workflow_terminate", { benutzer: "Test, Konto", gruppen: false }));
    pruefe("elo_workflow_terminate: gruppen=false nur eigene Aufgaben", wbG.vorschau.anzahl === 1 && wbG.vorschau.vorgaenge[0].id === "101" && wbFind[0].gruppe === false, JSON.stringify(wbG.vorschau));
    var wbD = mpJson(callTool("elo_workflow_terminate", { benutzer: "75", vertretungen: true }));
    pruefe("elo_workflow_terminate: vertretungen=true nimmt Vertretungsaufgaben dazu", wbD.vorschau.anzahl === 3 && wbD.vorschau.vorgaenge[2].id === "103", JSON.stringify(wbD.vorschau));
    var wbT = mpJson(callTool("elo_workflow_terminate", { benutzer: "75", vertretungen: true, vorlage: "WF-Dokument pruefen" }));
    pruefe("elo_workflow_terminate: vorlage grenzt ein (Name)", wbT.vorschau.anzahl === 2 && wbT.vorschau.vorgaenge[0].id === "101" && wbT.vorschau.vorgaenge[1].id === "103" &&
           wbT.vorschau.nurVorlage === "WF-Dokument pruefen [69]", JSON.stringify(wbT.vorschau));
    pruefe("elo_workflow_terminate: vorlage ohne Treffer", /Nichts zu beenden \(Vorlage Andere Vorlage \[70\]\)/.test(mpJson(callTool("elo_workflow_terminate", { benutzer: "75", gruppen: false, vorlage: "70" })).fehler));
    pruefe("elo_workflow_terminate: unbekannte Vorlage", /Keine Vorlage/.test(mpJson(callTool("elo_workflow_terminate", { benutzer: "75", vorlage: "Gibts nicht" })).fehler));
    pruefe("elo_workflow_terminate: unbekannter Benutzer", /nicht gefunden/.test(mpJson(callTool("elo_workflow_terminate", { benutzer: "Niemand" })).fehler));

    var wbI = mpJson(callTool("elo_workflow_terminate", { ids: ["103", "104", "999", "103"] }));
    pruefe("elo_workflow_terminate ids: doppelte einmal, beendete und unbekannte ausgelassen", wbI.vorschau.anzahl === 1 && wbI.vorschau.vorgaenge[0].id === "103" &&
           wbI.vorschau.ausgelassen.length === 2 && wbI.vorschau.ausgelassen[0].id === "104" && /nicht als laufender Vorgang/.test(wbI.vorschau.ausgelassen[1].grund) &&
           wbI.vorschau.auswahl.art === "Vorgangs-IDs" && wbI.warnungen.length === 0, JSON.stringify(wbI));
    pruefe("elo_workflow_terminate: nur beendete -> nichts zu beenden", /Nichts zu beenden/.test(mpJson(callTool("elo_workflow_terminate", { ids: ["104"] })).fehler));
    pruefe("elo_workflow_terminate: ids und benutzer zusammen abgelehnt", /Entweder ids oder benutzer/.test(mpJson(callTool("elo_workflow_terminate", { ids: ["101"], benutzer: "75" })).fehler));
    pruefe("elo_workflow_terminate: ohne Auswahl abgelehnt", /Entweder ids oder benutzer/.test(mpJson(callTool("elo_workflow_terminate", {})).fehler) &&
           /Entweder ids oder benutzer/.test(mpJson(callTool("elo_workflow_terminate", { ids: [] })).fehler));
    pruefe("elo_workflow_terminate: gruppen nur mit benutzer", /nur zusammen mit benutzer/.test(mpJson(callTool("elo_workflow_terminate", { ids: ["101"], gruppen: true })).fehler));
    pruefe("elo_workflow_terminate: ID muss eine Zahl sein", /keine ID/.test(mpJson(callTool("elo_workflow_terminate", { ids: ["abc"] })).fehler));
    var wbViele = []; for (var wi = 1; wi <= 201; wi++) wbViele.push(String(1000 + wi));
    pruefe("elo_workflow_terminate: Testarchiv hoechstens 200", /Hoechstens 200 Vorgaenge/.test(mpJson(callTool("elo_workflow_terminate", { ids: wbViele })).fehler));

    WB["103"].sperre = "Muster, Max";
    pruefe("elo_workflow_terminate: gesperrter Vorgang wird gewarnt", enthaelt(mpJson(callTool("elo_workflow_terminate", { ids: ["103"] })).warnungen, "gesperrt von Muster, Max"));
    delete WB["103"].sperre;
    var wbF = mpJson(callTool("elo_workflow_terminate", { ids: ["101"] }));
    WB["101"].knoten[0][3] = 3;
    pruefe("elo_workflow_terminate: Bearbeiter seit der Vorschau geaendert -> abgelehnt", /geaendert/.test(mpJson(callTool("elo_workflow_terminate", { ids: ["101"], token: wbF.token })).fehler) && WB["101"].aktiv);

    wbNeu(); WB["102"].fehler = "Vorgang gesperrt"; WB["103"].bleibt = true;
    var wbE = wbZwei({ ids: ["101", "102", "103"] });
    var wbEf = wbE.ergebnis.ergebnis.fehler || [];
    pruefe("elo_workflow_terminate: Fehler je Vorgang mit Grund, die anderen laufen weiter", wbE.ergebnis.ergebnis.beendet === 1 && wbE.ergebnis.ergebnis.vorgaenge[0].id === "101" &&
           wbEf.length === 2 && wbEf[0].id === "102" && /ELOIX:2000 Vorgang gesperrt/.test(wbEf[0].fehler) && wbEf[1].id === "103" && /ABWEICHUNG: laeuft noch/.test(wbEf[1].fehler),
           JSON.stringify(wbE.ergebnis));

    testArchiv = function () { return false; };
    wbNeu();
    var wbP = mpJson(callTool("elo_workflow_terminate", { ids: ["101"] }));
    pruefe("elo_workflow_terminate: kein Testarchiv -> deutliche Warnung zuerst", /^ACHTUNG: .*kein Testarchiv \(Produktiv\)/.test(wbP.warnungen[0]) && /Hoechstens 20 /.test(wbP.warnungen[0]), JSON.stringify(wbP.warnungen));
    var wbP20 = []; for (var wj = 1; wj <= 21; wj++) wbP20.push(String(2000 + wj));
    pruefe("elo_workflow_terminate: kein Testarchiv hoechstens 20", /Hoechstens 20 Vorgaenge \(Archiv ist kein Testarchiv\)/.test(mpJson(callTool("elo_workflow_terminate", { ids: wbP20 })).fehler));
    LIMIT_BEENDEN.produktiv = 1;
    var wbP1 = mpJson(callTool("elo_workflow_terminate", { benutzer: "75" }));
    pruefe("elo_workflow_terminate: mehr als die Grenze -> die ersten, Hinweis auf weitere", wbP1.vorschau.anzahl === 1 && enthaelt(wbP1.warnungen, "weitere Vorgaenge"), JSON.stringify(wbP1));
    LIMIT_BEENDEN.produktiv = 20;
  } else {
    pruefe("gesperrtes Beenden wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_workflow_terminate", { ids: ["1"] })).fehler));
  }
} finally {
  ELO.ix = wbIxEcht; ELO.connect = wbConnEcht; protokoll = wbProtEcht; jsonSichern = wbSichEcht; warte = wbWarteEcht; testArchiv = wbTestEcht; vorlageNachName = wbVnEcht;
  LIMIT_BEENDEN.seite = wbSeite;
}

/* ---------- Wiedervorlagen (nur im Speicher, erfundene Daten) ---------- */

pruefe("tools/list: Wiedervorlagen lesen immer", !!namen.elo_reminders);
pruefe("tools/list: Wiedervorlagen anlegen/loeschen nur mit -Schreiben", !!namen.elo_reminder_create === SCHREIBEN_ERLAUBT && !!namen.elo_reminder_delete === SCHREIBEN_ERLAUBT);
pruefe("Wiedervorlagen: Datum Ortszeit -> UTC -> Ortszeit", wvLokal(wvUtc("2028-09-02")) === "02.09.2028" && wvLokal(wvUtc("02.01.2028")) === "02.01.2028" && wvUtc("2028-09-02").length === 14);

/* Konto 75 (Gruppe 3), Objekte 4711/4712. */
var WV, wvFind, wvAufrufe, wvNaechste;
function wvNeu() {
  WV = {}; wvFind = []; wvAufrufe = []; wvNaechste = 500;
  wvSetzen(91, 4711, "Frist Kuendigung", "20280901220000", "20280929220000", 75, "Test, Konto");
  wvSetzen(92, 4711, "Rueckruf", "20200101230000", "", 3, "Beispielgruppe");
  wvSetzen(93, 4712, "Anderes", "20200101230000", "", 5, "Muster, Max");
  wvSetzen(95, 4713, "Zu geloeschtem Beleg", "20200101230000", "", 75, "Test, Konto");
}
function wvSetzen(id, obj, name, am, frist, empf, empfName) {
  var r = new IXC.Reminder(); r.setId(id); r.setObjId(obj); r.setName(name); r.setPromptDateIso(am); r.setDueDateIso(frist);
  r.setReceiverId(empf); r.setReceiverName(empfName); r.setSenderName("Test, Konto"); r.setPrio(1); r.setCreateDateIso("20261119080000");
  WV[String(id)] = r; return r;
}
function wvKopie(r) { var c = new IXC.Reminder(); c.setId(r.getId()); c.setObjId(r.getObjId()); c.setName(r.getName()); c.setPromptDateIso(r.getPromptDateIso());
  c.setDueDateIso(r.getDueDateIso()); c.setReceiverId(r.getReceiverId()); c.setReceiverName(r.getReceiverName()); c.setSenderName(r.getSenderName());
  c.setPrio(r.getPrio()); c.setDesc(r.getDesc()); c.setDeleted(r.isDeleted()); return c; }
var WV_NUTZER = { "75": ["Test, Konto", IXC.UserInfoC.TYPE_USER, [3]], "Test, Konto": "75", "3": ["Beispielgruppe", IXC.UserInfoC.TYPE_GROUP, []], "Beispielgruppe": "3",
                  "5": ["Muster, Max", IXC.UserInfoC.TYPE_USER, []], "Muster, Max": "5" };
function wvNutzer(wer) {
  var k = String(wer), e = WV_NUTZER[k];
  if (typeof e === "string") { k = e; e = WV_NUTZER[k]; }
  if (!e) throw "[ELOIX:5023]unbekannt " + wer;
  var u = new IXC.UserInfo(); u.setId(parseInt(k, 10)); u.setName(e[0]); u.setType(e[1]);
  var gl = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, e[2].length); for (var i = 0; i < e[2].length; i++) gl[i] = e[2][i]; u.setGroupList(gl);
  return u;
}
var wvIxEcht = ELO.ix, wvConnEcht = ELO.connect, wvProtEcht = protokoll, wvSichEcht = jsonSichern, wvWarteEcht = warte, wvGesichert = [];
ELO.ix = function () {
  return {
    checkoutUser: function (wer) { return wvNutzer(wer); },
    checkoutUsers: function (ids) { var o = []; for (var i = 0; i < ids.length; i++) o.push(wvNutzer(ids[i])); return o; },
    checkoutSord: function (id) {
      id = String(id); if (id !== "4711" && id !== "4712" && id !== "4713") throw "[ELOIX:5023]nicht gefunden " + id;
      var s = new IXC.Sord(); s.setId(parseInt(id, 10)); s.setName({ "4711": "Vertrag Muster", "4712": "Rechnung Muster", "4713": "Beleg geloescht" }[id]); s.setType(254);
      s.setDeleted(id === "4713"); return s;
    },
    findFirstTasks: function (fi, max) {
      var uid = fi.getUserIds() ? String(fi.getUserIds()[0]) : (fi.isAllUsers() ? "" : "75"), obj = S(fi.getObjId()), l = [];
      wvFind.push({ user: uid, alle: fi.isAllUsers(), obj: obj, wv: fi.isInclReminders(), wf: fi.isInclWorkflows(), gruppe: fi.isInclGroup(), inUse: fi.isUpdateInUseDate(), prio: fi.getHighestPriority() + "-" + fi.getLowestPriority() });
      var meine = {}; if (uid) { meine[uid] = true; if (fi.isInclGroup()) { var u = wvNutzer(uid), g = u.getGroupList(); for (var i = 0; g && i < g.length; i++) meine[String(g[i])] = true; } }
      for (var k in WV) {
        var r = WV[k];
        if (r.isDeleted()) continue;
        if (String(r.getObjId()) === "4713" && !fi.isInclDeleted()) continue;
        if (obj && String(r.getObjId()) !== obj) continue;
        if (!fi.isAllUsers() && !meine[String(r.getReceiverId())]) continue;
        (function (rr) { l.push({ getReminder: function () { return wvKopie(rr); }, getWfNode: function () { return null; },
                                  getSord: function () { var s = new IXC.Sord(); s.setId(rr.getObjId()); s.setName("Objekt " + rr.getObjId()); s.setDeleted(String(rr.getObjId()) === "4713"); return s; } }); })(r);
      }
      if (fi.isInclWorkflows()) l.unshift({ getReminder: function () { return null; }, getSord: function () { return null; },
        getWfNode: function () { var n = new IXC.WFCollectNode(); n.setFlowId(101); n.setFlowName("Pruefung A"); n.setNodeName("Pruefen"); n.setObjId("4711"); return n; } });
      var s = l.slice(0, max);
      return { getTasks: function () { return s; }, isMoreResults: function () { return l.length > max; }, getSearchId: function () { return "w1"; } };
    },
    findClose: function () { wvAufrufe.push("close"); },
    createReminder: function (obj) { var r = new IXC.Reminder(); r.setObjId(parseInt(obj, 10)); r.setPrio(0); return r; },
    checkinReminder: function (r, empf, expand, lock) {
      wvAufrufe.push("checkin " + Array.prototype.slice.call(empf).join("+") + " expand=" + expand);
      var ids = [];
      for (var i = 0; i < empf.length; i++) {
        var u = wvNutzer(empf[i]), n = wvSetzen(wvNaechste++, r.getObjId(), r.getName(), r.getPromptDateIso(), r.getDueDateIso(), u.getId(), u.getName());
        n.setPrio(r.getPrio()); n.setDesc(r.getDesc()); ids.push(n.getId());
      }
      var arr = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, ids.length); for (var j = 0; j < ids.length; j++) arr[j] = ids[j]; return arr;
    },
    checkoutReminders: function (ids) {
      var o = [];
      for (var i = 0; i < ids.length; i++) { var r = WV[String(ids[i])]; if (!r) throw "[ELOIX:5023]Wiedervorlage " + ids[i] + " nicht gefunden"; o.push(wvKopie(r)); }
      return o;
    },
    deleteReminders: function (ids) { var t = []; for (var i = 0; i < ids.length; i++) { t.push(String(ids[i])); if (WV[String(ids[i])]) WV[String(ids[i])].setDeleted(true); } wvAufrufe.push("delete " + t.join("+")); }
  };
};
ELO.connect = function () { return { getLoginResult: function () { return { getUser: function () { return wvNutzer("75"); } }; } }; };
protokoll = function () {};
jsonSichern = function (name, inhalt) { wvGesichert.push({ name: name, inhalt: inhalt }); return "sicherung-" + name; };
warte = function () {};
try {
  wvNeu();
  var wvL = mpJson(callTool("elo_reminders", {}));
  pruefe("elo_reminders: eigenes Konto mit Gruppen, ohne Workflows, ohne inUseDate", wvL.anzahl === 2 && wvL.benutzer === "Test, Konto [75]" &&
         wvFind[0].user === "75" && wvFind[0].gruppe === true && wvFind[0].wv === true && wvFind[0].wf === false && wvFind[0].inUse === false && wvFind[0].prio === "0-2" && wvAufrufe.indexOf("close") >= 0, JSON.stringify(wvL) + JSON.stringify(wvFind));
  var wv91 = wvL.wiedervorlagen.filter(function (x) { return x.id === "91"; })[0], wv92 = wvL.wiedervorlagen.filter(function (x) { return x.id === "92"; })[0];
  pruefe("elo_reminders: Datum in Ortszeit, faellig, Prioritaet im Klartext", wv91.am === wvLokal("20280901220000") && wv91.frist === wvLokal("20280929220000") && wv91.faellig === false &&
         wv92.faellig === true && wv91.prio === "1 (mittel)" && wvL.faellig === 1 && wv91.objekt === "Objekt 4711", JSON.stringify(wvL.wiedervorlagen));
  pruefe("elo_reminders: gruppen=false nur eigene", mpJson(callTool("elo_reminders", { gruppen: false })).anzahl === 1);
  var wvGel = mpJson(callTool("elo_reminders", { geloeschteObjekte: true }));
  pruefe("elo_reminders: geloeschteObjekte zeigt Wiedervorlagen geloeschter Objekte, gekennzeichnet", wvGel.anzahl === 3 &&
         wvGel.wiedervorlagen.filter(function (x) { return x.id === "95" && x.objektGeloescht === true; }).length === 1 && wvL.wiedervorlagen.filter(function (x) { return x.id === "95"; }).length === 0, JSON.stringify(wvGel));
  var wvO = mpJson(callTool("elo_reminders", { objekt: "4711" }));
  pruefe("elo_reminders: objekt ohne benutzer = alle Empfaenger dieses Objekts", wvO.anzahl === 2 && wvO.benutzer === "alle" && wvFind[wvFind.length - 1].alle === true && wvFind[wvFind.length - 1].obj === "4711", JSON.stringify(wvO));
  var wvB = mpJson(callTool("elo_reminders", { benutzer: "Muster, Max" }));
  pruefe("elo_reminders: anderes Konto", wvB.anzahl === 1 && wvB.wiedervorlagen[0].id === "93" && wvB.benutzer === "Muster, Max [5]", JSON.stringify(wvB));
  pruefe("elo_reminders: unbekanntes Objekt", /nicht gefunden/.test(mpJson(callTool("elo_reminders", { objekt: "9999" })).fehler));

  var wvT = mpJson(callTool("elo_my_tasks", {}));
  pruefe("elo_my_tasks: Workflow-Aufgaben und Wiedervorlagen mit art", wvT.aufgaben === 3 && wvT.workflows === 1 && wvT.wiedervorlagen === 2 &&
         wvT.liste[0].art === "workflow" && wvT.liste[1].art === "wiedervorlage" && !!wvT.liste[1].am, JSON.stringify(wvT));
  var wvT2 = mpJson(callTool("elo_my_tasks", { wiedervorlagen: false }));
  pruefe("elo_my_tasks: alle Prioritaeten 0 bis 2", wvFind[wvFind.length - 1].prio === "0-2", JSON.stringify(wvFind[wvFind.length - 1]));
  pruefe("elo_my_tasks: wiedervorlagen=false nur Workflows", wvT2.aufgaben === 1 && wvT2.wiedervorlagen === undefined && wvFind[wvFind.length - 1].wv === false, JSON.stringify(wvT2));

  if (SCHREIBEN_ERLAUBT) {
    var wvC = mpJson(callTool("elo_reminder_create", { objekt: "4711", am: "2028-09-02", frist: "2028-09-30", empfaenger: ["Test, Konto", "Beispielgruppe", "75"], prio: "hoch" }));
    pruefe("elo_reminder_create: Vorschau ohne Anlegen, Standardname, Empfaenger einmal, Gruppe gekennzeichnet",
           wvC.vorschau.name === "Wiedervorlage: Vertrag Muster" && wvC.vorschau.empfaenger.join("|") === "Test, Konto [75]|Beispielgruppe [3] (Gruppe)" &&
           wvC.vorschau.am === "02.09.2028" && wvC.vorschau.frist === "30.09.2028" && wvC.vorschau.prio === "hoch" && wvC.vorschau.vorhandeneZumObjekt === 2 &&
           enthaelt(wvC.warnungen, "gemeinsame Wiedervorlage") && wvAufrufe.join().indexOf("checkin") < 0, JSON.stringify(wvC));
    var wvC2 = mpJson(callTool("elo_reminder_create", { objekt: "4711", am: "2028-09-02", frist: "2028-09-30", empfaenger: ["Test, Konto", "Beispielgruppe", "75"], prio: "hoch", token: wvC.token }));
    var wvNeuR = WV["500"];
    pruefe("elo_reminder_create: legt je Empfaenger an, Datum UTC, Gruppe nicht aufgeloest, zurueckgelesen",
           wvC2.ergebnis.angelegt === 2 && wvC2.ergebnis.rueckgelesen === "ok, wie geplant" && enthaelt(wvAufrufe, "checkin 75+3 expand=false") &&
           String(wvNeuR.getPromptDateIso()) === wvUtc("2028-09-02") && String(wvNeuR.getDueDateIso()) === wvUtc("2028-09-30") && wvNeuR.getPrio() === 0, JSON.stringify(wvC2) + wvAufrufe.join());
    var wvC3 = mpJson(callTool("elo_reminder_create", { objekt: "4711", name: "Frist Kuendigung" }));
    pruefe("elo_reminder_create: Standard eigenes Konto, heute, Warnung bei gleichem Namen", wvC3.vorschau.empfaenger.join() === "Test, Konto [75]" &&
           wvC3.vorschau.am === wvLokal(wvHeuteUtc()) && enthaelt(wvC3.warnungen, "schon die Wiedervorlage 'Frist Kuendigung'"), JSON.stringify(wvC3));
    var wvLang = ""; for (var wl = 0; wl < 130; wl++) wvLang += "x";
    pruefe("elo_reminder_create: name ueber 128 Zeichen abgelehnt", /128/.test(mpJson(callTool("elo_reminder_create", { objekt: "4711", name: wvLang })).fehler));
    pruefe("elo_reminder_create: frist vor am abgelehnt", /frist liegt vor am/.test(mpJson(callTool("elo_reminder_create", { objekt: "4711", am: "2028-09-02", frist: "2028-09-01" })).fehler));
    pruefe("elo_reminder_create: falsches Datum abgelehnt", /Datum/.test(mpJson(callTool("elo_reminder_create", { objekt: "4711", am: "morgen" })).fehler));
    pruefe("elo_reminder_create: falsche prio abgelehnt", /prio/.test(mpJson(callTool("elo_reminder_create", { objekt: "4711", prio: "dringend" })).fehler));
    pruefe("elo_reminder_create: geloeschtes Objekt gewarnt", enthaelt(mpJson(callTool("elo_reminder_create", { objekt: "4713" })).warnungen, "als geloescht markiert"));
    pruefe("elo_reminder_create: Vergangenheit gewarnt", enthaelt(mpJson(callTool("elo_reminder_create", { objekt: "4711", am: "2020-01-01" })).warnungen, "Vergangenheit"));
    var wvF = mpJson(callTool("elo_reminder_create", { objekt: "4711" }));
    wvSetzen(600, 4711, "Neu dazwischen", "20280101230000", "", 5, "Muster, Max");
    pruefe("elo_reminder_create: neue Wiedervorlage am Objekt seit der Vorschau -> abgelehnt", /geaendert/.test(mpJson(callTool("elo_reminder_create", { objekt: "4711", token: wvF.token })).fehler));
    pruefe("elo_reminder_create: anJedesMitglied geht an den Indexserver", (function () {
      var v = mpJson(callTool("elo_reminder_create", { objekt: "4712", empfaenger: "Beispielgruppe", anJedesMitglied: true }));
      mpJson(callTool("elo_reminder_create", { objekt: "4712", empfaenger: "Beispielgruppe", anJedesMitglied: true, token: v.token }));
      return enthaelt(wvAufrufe, "checkin 3 expand=true") && enthaelt(v.warnungen, "jedes Mitglied");
    })());

    wvNeu(); wvGesichert = [];
    var wvD = mpJson(callTool("elo_reminder_delete", { ids: ["91", "92", "999", "91"] }));
    pruefe("elo_reminder_delete ids: Vorschau, doppelte einmal, unbekannte ausgelassen, nichts geloescht",
           wvD.vorschau.anzahl === 2 && wvD.vorschau.ausgelassen.length === 1 && wvD.vorschau.ausgelassen[0].id === "999" && enthaelt(wvD.warnungen, "Endgueltig") &&
           wvAufrufe.join().indexOf("delete") < 0 && wvD.vorschau.wiedervorlagen[0].objekt === "Vertrag Muster", JSON.stringify(wvD));
    var wvD2 = mpJson(callTool("elo_reminder_delete", { ids: ["91", "92", "999", "91"], token: wvD.token }));
    pruefe("elo_reminder_delete: loescht, Sicherung vorher mit allen Angaben, zurueckgelesen",
           wvD2.ergebnis.geloescht === 2 && enthaelt(wvAufrufe, "delete 91+92") && WV["91"].isDeleted() && !WV["93"].isDeleted() &&
           wvGesichert.length === 1 && wvGesichert[0].inhalt.wiedervorlagen.length === 2 && wvGesichert[0].inhalt.wiedervorlagen[0].promptDateIso === "20280901220000",
           JSON.stringify(wvD2) + wvAufrufe.join());
    pruefe("elo_reminder_delete: schon geloescht -> nichts zu loeschen", /Nichts zu loeschen/.test(mpJson(callTool("elo_reminder_delete", { ids: ["91"] })).fehler));

    wvNeu();
    var wvDo = mpJson(callTool("elo_reminder_delete", { objekt: "4711" }));
    pruefe("elo_reminder_delete objekt: alle Empfaenger dieses Objekts", wvDo.vorschau.anzahl === 2 && wvDo.vorschau.auswahl.art === "Objekt", JSON.stringify(wvDo.vorschau));
    var wvDb = mpJson(callTool("elo_reminder_delete", { objekt: "4711", benutzer: "75" }));
    pruefe("elo_reminder_delete objekt + benutzer: nur dieser Empfaenger (ohne Gruppe)", wvDb.vorschau.anzahl === 1 && wvDb.vorschau.wiedervorlagen[0].id === "91", JSON.stringify(wvDb.vorschau));
    var wvDg = mpJson(callTool("elo_reminder_delete", { objekt: "4713" }));
    pruefe("elo_reminder_delete objekt: auch bei geloeschtem Objekt", wvDg.vorschau && wvDg.vorschau.anzahl === 1 && wvDg.vorschau.wiedervorlagen[0].id === "95", JSON.stringify(wvDg));
    pruefe("elo_reminder_delete: keine zum Objekt", /Keine Wiedervorlagen/.test(mpJson(callTool("elo_reminder_delete", { objekt: "4712", benutzer: "75" })).fehler));
    pruefe("elo_reminder_delete: ids und objekt zusammen abgelehnt", /Entweder ids oder objekt/.test(mpJson(callTool("elo_reminder_delete", { ids: ["91"], objekt: "4711" })).fehler) &&
           /Entweder ids oder objekt/.test(mpJson(callTool("elo_reminder_delete", {})).fehler));
    pruefe("elo_reminder_delete: benutzer nur mit objekt", /nur zusammen mit objekt/.test(mpJson(callTool("elo_reminder_delete", { ids: ["91"], benutzer: "75" })).fehler));
    var wvG = mpJson(callTool("elo_reminder_delete", { ids: ["91"] }));
    WV["91"].setPromptDateIso("20290101230000");
    pruefe("elo_reminder_delete: seit der Vorschau verschoben -> abgelehnt", /geaendert/.test(mpJson(callTool("elo_reminder_delete", { ids: ["91"], token: wvG.token })).fehler) && !WV["91"].isDeleted());
  } else {
    pruefe("gesperrtes Anlegen/Loeschen von Wiedervorlagen wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_reminder_create", { objekt: "4711" })).fehler) &&
           /nicht freigeschaltet/.test(mpJson(callTool("elo_reminder_delete", { ids: ["91"] })).fehler));
  }
} finally {
  ELO.ix = wvIxEcht; ELO.connect = wvConnEcht; protokoll = wvProtEcht; jsonSichern = wvSichEcht; warte = wvWarteEcht;
}

/* ---------- IX-Skripte neu laden (elo_ix_reload) gegen einen Skript-Motor im Speicher ---------- */

var ixIxEcht = ELO.ix, ixLesenEcht = ixSkriptLesen, ixProtEcht = protokoll, ixTestEcht = testArchiv;
var IXK = {}, ixReloads = 0, ixNachReload = null, ixTest = true;
function ixMap() { var m = new java.util.HashMap(); for (var k in IXK) m.put(java.lang.Integer.valueOf(parseInt(k, 10)), IXK[k]); return m; }
var IXS = {
  "501": { id: "501", name: "paket.neu", hauptablage: "Administration/Business Solutions Custom/paket/IndexServer Scripting Base",
           ueber: ["Verweis " + IX_BASIS + "/_ALL/business_solutions"], md5: "AAA2", stand: "20261120203600" },
  "502": { id: "502", name: "paket.ohneVerweis", hauptablage: "Administration/Business Solutions Custom/paket/IndexServer Scripting Base",
           ueber: [], md5: "BBB1", stand: "20261120100000" },
  "503": { id: "503", name: "lib_alt", hauptablage: IX_BASIS + "/_ALL", ueber: ["Hauptablage " + IX_BASIS + "/_ALL"], md5: "CCC1", stand: "20250101000000" }
};
function ixNeu() { IXK = { "501": "aaa1", "503": "CCC1", "600": "DDD1" }; ixReloads = 0; ixNachReload = { "501": "AAA2", "503": "CCC1" }; }
ELO.ix = function () {
  return { getCompiledScripts: function () { return ixMap(); },
           reloadScripts: function () { ixReloads++; if (ixNachReload) IXK = ixNachReload; },
           checkoutSord: function () { var s = new IXC.Sord(); s.setId(600); s.setName("lib_kaputt"); return { getSord: function () { return s; } }; } };
};
ixSkriptLesen = function (o) { var x = IXS[S(o)]; if (!x) fail("Objekt nicht gefunden: " + o); return JSON.parse(JSON.stringify(x)); };
protokoll = function () {};
testArchiv = function () { return ixTest; };
try {
  pruefe("ixUnterBasis: Basis und darunter ja, Paketordner nein", ixUnterBasis(IX_BASIS) && ixUnterBasis(IX_BASIS + "/_ALL/business_solutions") &&
         !ixUnterBasis("Administration/Business Solutions Custom/paket/IndexServer Scripting Base") && !ixUnterBasis(IX_BASIS + " alt/x"));
  pruefe("ixStand: aktuell, aeltere Fassung, nicht geladen",
         ixStand({ id: "1", md5: "X" }, { md5: { "1": "X" } }) === "aktuell geladen" && ixStand({ id: "1", md5: "X" }, { md5: { "1": "Y" } }) === "aeltere Fassung geladen" &&
         ixStand({ id: "1", md5: "X" }, { md5: {} }) === "nicht geladen");
  if (BAUEN_ERLAUBT) {
    ixNeu();
    var ixV = mpJson(callTool("elo_ix_reload", { pruefen: ["501", "502", "503", "501"] }));
    pruefe("elo_ix_reload Vorschau: laedt noch nicht neu", ixReloads === 0 && !!ixV.token, JSON.stringify(ixV));
    pruefe("elo_ix_reload Vorschau: Gesamtzahl und je Skript der Stand (MD5 ohne Gross/Klein)", ixV.vorschau.geladenJetzt === 3 && ixV.vorschau.skripte.length === 3 &&
           ixV.vorschau.skripte[0].jetzt === "aeltere Fassung geladen" && ixV.vorschau.skripte[1].jetzt === "nicht geladen" && ixV.vorschau.skripte[2].jetzt === "aktuell geladen", JSON.stringify(ixV.vorschau));
    pruefe("elo_ix_reload Vorschau: warnt bei Skript ohne Ort unter der Basis und bei schon aktuellem", enthaelt(ixV.warnungen, "paket.ohneVerweis [502] liegt nicht unter") &&
           enthaelt(ixV.warnungen, "lib_alt [503] ist schon in der aktuellen Version geladen") && ixV.vorschau.skripte[1].geladenUeber.indexOf("KEIN Ort") === 0, JSON.stringify(ixV.warnungen));
    pruefe("elo_ix_reload Vorschau: im Testarchiv keine Produktiv-Warnung", !enthaelt(ixV.warnungen, "ACHTUNG"));
    var ixE = mpJson(callTool("elo_ix_reload", { pruefen: ["501", "502", "503", "501"], token: ixV.token }));
    pruefe("elo_ix_reload: einmal neu geladen", ixReloads === 1 && ixE.modus === "ausgefuehrt", JSON.stringify(ixE));
    var ixR = ixE.ergebnis;
    pruefe("elo_ix_reload: vorher/nachher je Skript", ixR.skripte[0].nachher === "aktuell geladen" && ixR.skripte[0].ok && ixR.skripte[1].nachher === "nicht geladen" && !ixR.skripte[1].ok, JSON.stringify(ixR.skripte));
    pruefe("elo_ix_reload: Zahlen und fehlende Skripte mit Namen", ixR.geladenVorher === 3 && ixR.geladenNachher === 2 && ixR.geaendertOderNeu === 1 &&
           ixR.fehlenNachher.length === 1 && ixR.fehlenNachher[0] === "lib_kaputt [600]", JSON.stringify(ixR));
    pruefe("elo_ix_reload: Ergebnis PRUEFEN bei Fehlern", /^PRUEFEN: 1 Skript\(e\) nicht .* 1 vorher geladene/.test(ixR.ergebnis), ixR.ergebnis);
    ixNeu(); ixNachReload = { "501": "AAA2", "503": "CCC1", "600": "DDD1" };
    var ixV2 = mpJson(callTool("elo_ix_reload", { pruefen: ["501"] }));
    var ixR2 = mpJson(callTool("elo_ix_reload", { pruefen: ["501"], token: ixV2.token })).ergebnis;
    pruefe("elo_ix_reload: alles geladen -> ok, keine fehlenden", ixR2.ergebnis === "ok" && ixR2.fehlenNachher === undefined, JSON.stringify(ixR2));
    ixNeu();
    var ixV3 = mpJson(callTool("elo_ix_reload", {}));
    pruefe("elo_ix_reload ohne pruefen: Hinweis, nur Gesamtzahl", ixV3.vorschau.skripte.length === 0 && enthaelt(ixV3.warnungen, "Ohne pruefen"), JSON.stringify(ixV3));
    var ixV4 = mpJson(callTool("elo_ix_reload", { pruefen: ["501"] }));
    IXS["501"].md5 = "AAA4";
    pruefe("elo_ix_reload: Fingerabdruck greift", /geaendert/.test(mpJson(callTool("elo_ix_reload", { pruefen: ["501"], token: ixV4.token })).fehler) && ixReloads === 0);
    ixTest = false;
    pruefe("elo_ix_reload: Produktiv-Warnung zuerst", mpJson(callTool("elo_ix_reload", { pruefen: ["501"] })).warnungen[0].indexOf("ACHTUNG") === 0);
    ixTest = true;
    var zuViel = []; for (var zi = 0; zi < 21; zi++) zuViel.push("501");
    pruefe("elo_ix_reload: hoechstens 20 in pruefen", /Hoechstens 20/.test(mpJson(callTool("elo_ix_reload", { pruefen: zuViel })).fehler));
    pruefe("elo_ix_reload: unbekanntes Skript", /nicht gefunden/.test(mpJson(callTool("elo_ix_reload", { pruefen: ["999"] })).fehler));
  } else {
    pruefe("gesperrtes Neuladen der IX-Skripte wird abgelehnt", /nicht freigeschaltet/.test(mpJson(callTool("elo_ix_reload", {})).fehler));
  }
} finally {
  ELO.ix = ixIxEcht; ixSkriptLesen = ixLesenEcht; protokoll = ixProtEcht; testArchiv = ixTestEcht;
}

/* ---------- Zusatztext (desc) in elo_set_fields gegen ein Objekt im Speicher ---------- */

var ztIxEcht = ELO.ix, ztSichEcht = jsonSichern, ztProtEcht = protokoll, ZT = { desc: "Alter Text\nZeile 2", name: "Beleg A" }, ztGesichert = [], ztCheckins = 0;
maskObjCache["7"] = { getLines: function () { return []; } }; maskCache["7"] = {};
function ztSord() { var s = new IXC.Sord(); s.setId(4720); s.setName(ZT.name); s.setType(254); s.setMask(7); s.setMaskName("Beleg"); s.setDesc(ZT.desc); s.setObjKeys([]); return s; }
ELO.ix = function () {
  return { checkoutSord: function () { var s = ztSord(); return { getSord: function () { return s; } }; },
           checkinSord: function (s) { ztCheckins++; ZT.desc = S(s.getDesc()); ZT.name = S(s.getName()); } };
};
jsonSichern = function (name, inhalt) { ztGesichert.push({ name: name, inhalt: inhalt }); return "C:\\sicherung\\" + name + ".json"; };
protokoll = function () {};
try {
  if (SCHREIBEN_ERLAUBT) {
    var ztV = mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztext: "Neuer Text" }));
    pruefe("elo_set_fields zusatztext: Vorschau bisher/neu, Warnung ersetzt", ztV.vorschau.zusatztext.bisher === "Alter Text\nZeile 2" && ztV.vorschau.zusatztext.neu === "Neuer Text" &&
           enthaelt(ztV.warnungen, "ganz ersetzt") && ztCheckins === 0 && ztV.vorschau.felder === undefined, JSON.stringify(ztV));
    var ztE = mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztext: "Neuer Text", token: ztV.token }));
    pruefe("elo_set_fields zusatztext: geschrieben, zurueckgelesen, alter Text gesichert", ZT.desc === "Neuer Text" && ztE.ergebnis.zusatztext.rueckgelesen === "ok, wie geplant" &&
           ztGesichert.length === 1 && ztGesichert[0].inhalt.zusatztextVorher === "Alter Text\nZeile 2" && /zusatztext-4720/.test(ztE.ergebnis.zusatztext.sicherungVorher), JSON.stringify(ztE));
    pruefe("elo_set_fields zusatztext: gleicher Text -> keine Aenderung", /schon so/.test(mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztext: "Neuer Text" })).fehler));
    pruefe("elo_set_fields zusatztext: leerer Text abgelehnt", /zusatztextLeeren/.test(mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztext: "" })).fehler));
    pruefe("elo_set_fields: zusatztext und zusatztextLeeren zusammen abgelehnt", /nicht beides/.test(mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztext: "x", zusatztextLeeren: true })).fehler));
    var ztLang = ""; while (ztLang.length <= 30000) ztLang += "0123456789";
    pruefe("elo_set_fields zusatztext: zu lang abgelehnt", /hoechstens 30000/.test(mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztext: ztLang })).fehler));
    var ztL = mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztextLeeren: true }));
    pruefe("elo_set_fields zusatztextLeeren: Vorschau (leer) mit Warnung", ztL.vorschau.zusatztext.neu === "(leer)" && enthaelt(ztL.warnungen, "geleert"), JSON.stringify(ztL));
    ZT.desc = "inzwischen geaendert";
    pruefe("elo_set_fields zusatztext: seit der Vorschau geaendert -> abgelehnt", /geaendert/.test(mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztextLeeren: true, token: ztL.token })).fehler) &&
           ZT.desc === "inzwischen geaendert");
    var ztL2 = mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztextLeeren: true }));
    var ztE2 = mpJson(callTool("elo_set_fields", { objekt: "4720", zusatztextLeeren: true, token: ztL2.token }));
    pruefe("elo_set_fields zusatztextLeeren: geleert", ZT.desc === "" && ztE2.ergebnis.zusatztext.jetzt === "(leer)" && ztE2.ergebnis.zusatztext.rueckgelesen === "ok, wie geplant", JSON.stringify(ztE2));
    var ztN = mpJson(callTool("elo_set_fields", { objekt: "4720", name: "Beleg B" }));
    pruefe("elo_set_fields nur name: kein Zusatztext in der Vorschau", ztN.vorschau.name.neu === "Beleg B" && ztN.vorschau.zusatztext === undefined, JSON.stringify(ztN));
    pruefe("elo_set_fields ohne Angaben abgelehnt", /Weder felder, name noch zusatztext/.test(mpJson(callTool("elo_set_fields", { objekt: "4720" })).fehler));
  }
} finally {
  ELO.ix = ztIxEcht; jsonSichern = ztSichEcht; protokoll = ztProtEcht; delete maskObjCache["7"]; delete maskCache["7"];
}

/* ---------- elo_map_set leerenMuster gegen eine Map im Speicher ---------- */

var lmIxEcht = ELO.ix, lmProtEcht = protokoll, lmSichEcht = mapSichern, lmCheckins = 0, LM = {};
function lmNeu() { LM = { IMP_NACHGEZOGEN: "2026-11-20 10:00|ok", IMP_NAME_ALT: "Alt", imp_hinweis: "x", IMP_TOKEN: "geheim", BELEGART: "Rechnung", ANDERES: "bleibt" }; lmCheckins = 0; }
ELO.ix = function () {
  return {
    checkoutSord: function () { var s = new IXC.Sord(); s.setId(4730); s.setName("Beleg M"); s.setType(254); s.setMaskName("Beleg"); return { getSord: function () { return s; } }; },
    checkoutMap: function () {
      var items = [];
      for (var k in LM) (function (key) { items.push({ getKey: function () { return key; }, getValue: function () { return LM[key]; } }); })(k);
      return { getItems: function () { return items; } };
    },
    checkinMap: function (d, id, objId, arr) { lmCheckins++; for (var i = 0; i < arr.length; i++) { var k = String(arr[i].getKey()), v = String(arr[i].getValue()); if (v === "") delete LM[k]; else LM[k] = v; } }
  };
};
protokoll = function () {};
mapSichern = function (p, werte, suffix) { return "sicherung" + suffix; };
try {
  lmNeu();
  var lmM = mapMusterLeeren(["IMP_"], LM, null, null);
  pruefe("mapMusterLeeren: Anfang, Gross/klein egal, Token-Feld uebersprungen", lmM.keys.join(",") === "IMP_NACHGEZOGEN,IMP_NAME_ALT,imp_hinweis" && lmM.geheim.join() === "IMP_TOKEN", JSON.stringify(lmM));
  pruefe("mapMusterLeeren: Muster mit *", mapMusterLeeren("IMP_*_ALT", LM).keys.join() === "IMP_NAME_ALT");
  pruefe("mapMusterLeeren: schon in leeren genannt -> nicht doppelt", mapMusterLeeren(["IMP_N"], LM, null, ["IMP_NAME_ALT"]).keys.join() === "IMP_NACHGEZOGEN");
  pruefe("mapMusterLeeren: zu breit abgelehnt", /zu breit/.test(errText((function () { try { mapMusterLeeren(["*"], LM); } catch (e) { return e; } })())) &&
         /zu breit/.test(errText((function () { try { mapMusterLeeren(["W*"], LM); } catch (e) { return e; } })())));
  if (SCHREIBEN_ERLAUBT) {
    var lmV = mpJson(callTool("elo_map_set", { objekt: "4730", leerenMuster: ["IMP_"] }));
    pruefe("elo_map_set leerenMuster: Vorschau nennt jedes Feld mit bisherigem Wert", lmV.vorschau.felder.length === 3 && lmV.vorschau.leerenMuster.anzahl === 3 &&
           lmV.vorschau.felder[0].feld === "IMP_NACHGEZOGEN" && lmV.vorschau.felder[0].bisher === "2026-11-20 10:00|ok" && lmV.vorschau.felder[0].neu === "(leer)" && lmCheckins === 0, JSON.stringify(lmV));
    pruefe("elo_map_set leerenMuster: Warnung fuer uebersprungenes Token-Feld", enthaelt(lmV.warnungen, "IMP_TOKEN"), JSON.stringify(lmV.warnungen));
    LM.IMP_NEU = "dazugekommen";
    pruefe("elo_map_set leerenMuster: neues passendes Feld seit der Vorschau -> abgelehnt", /geaendert/.test(mpJson(callTool("elo_map_set", { objekt: "4730", leerenMuster: ["IMP_"], token: lmV.token })).fehler) && lmCheckins === 0);
    delete LM.IMP_NEU;
    var lmV2 = mpJson(callTool("elo_map_set", { objekt: "4730", leerenMuster: ["IMP_"], felder: { BELEGART: "Gutschrift" } }));
    var lmE = mpJson(callTool("elo_map_set", { objekt: "4730", leerenMuster: ["IMP_"], felder: { BELEGART: "Gutschrift" }, token: lmV2.token }));
    pruefe("elo_map_set leerenMuster + felder: ausgefuehrt, Rest unberuehrt", lmE.modus === "ausgefuehrt" && lmCheckins === 1 && LM.BELEGART === "Gutschrift" && LM.ANDERES === "bleibt" &&
           LM.IMP_TOKEN === "geheim" && !LM.IMP_NAME_ALT && !LM.imp_hinweis && lmE.ergebnis.rueckgelesen === "ok, wie geplant", JSON.stringify(lmE) + JSON.stringify(LM));
    pruefe("elo_map_set leerenMuster: trifft nichts -> abgelehnt", /trifft kein Feld/.test(mpJson(callTool("elo_map_set", { objekt: "4730", leerenMuster: ["XYZ_"] })).fehler));
    lmNeu(); for (var lmi = 0; lmi < 51; lmi++) LM["VIEL_" + lmi] = "x";
    pruefe("elo_map_set leerenMuster: mehr als 50 Treffer abgelehnt", /hoechstens 50/.test(mpJson(callTool("elo_map_set", { objekt: "4730", leerenMuster: ["VIEL_"] })).fehler));
  }
} finally {
  ELO.ix = lmIxEcht; protokoll = lmProtEcht; mapSichern = lmSichEcht;
}

/* ---------- elo_find_by_fields seitenweise mit Map-Spalten gegen eine Suche im Speicher ---------- */

var fsIxEcht = ELO.ix, FS = [], fsAufrufe = [], fsZaehlen = null, fsMapAufrufe = 0;
maskCache["9"] = { FIRMA: "Firma", TYP: "Typ" };
for (var fsi = 0; fsi < 120; fsi++) {
  (function (n) {
    var s = new IXC.Sord(); s.setId(5000 + n); s.setName("Beleg " + n); s.setType(254); s.setMask(9); s.setMaskName("Lieferantenbeleg");
    var k1 = new IXC.ObjKey(); k1.setName("FIRMA"); k1.setData(["Muster GmbH"]);
    var k2 = new IXC.ObjKey(); k2.setName("TYP"); k2.setData([n % 2 ? "Rechnung" : "Vertrag"]);
    s.setObjKeys([k1, k2]); FS.push(s);
  })(fsi);
}
function fsErg(ab, max) {
  var teil = FS.slice(ab, ab + max), arr = java.lang.reflect.Array.newInstance(IXC.Sord, teil.length);
  for (var i = 0; i < teil.length; i++) arr[i] = teil[i];
  return { getSords: function () { return arr; }, isMoreResults: function () { return ab + max < FS.length; }, getSearchId: function () { return "S1"; },
           getCount: function () { return FS.length; } };
}
ELO.ix = function () {
  return {
    findFirstSords: function (fi, max) { fsZaehlen = fi.getFindOptions() ? !!fi.getFindOptions().isEvalCount() : false; fsAufrufe.push("first " + max); return fsErg(0, max); },
    findNextSords: function (sid, ab, max) { fsAufrufe.push("next " + ab + " " + max); return fsErg(ab, max); },
    findClose: function () { fsAufrufe.push("close"); },
    checkoutSord: function () { var s = new IXC.Sord(); s.setId(77); s.setName("Ordner"); s.setType(1); return { getSord: function () { return s; } }; },
    checkoutMap: function (d, id, keys) {
      fsMapAufrufe++;
      var werte = { IMP_NACHGEZOGEN: "2026-11-20|" + id, IMP_API_TOKEN: "geheim" }, items = [];
      for (var i = 0; keys && i < keys.length; i++) (function (k) { if (werte[k] !== undefined) items.push({ getKey: function () { return k; }, getValue: function () { return werte[k]; } }); })(String(keys[i]));
      return { getItems: function () { return items; } };
    }
  };
};
try {
  var fs1 = mpJson(callTool("elo_find_by_fields", { maske: "Lieferantenbeleg", felder: { FIRMA: "Muster GmbH" }, max: 50 }));
  pruefe("elo_find_by_fields Seite 1: 50 Treffer, naechsteSeite 50, ohne Zaehlen", fs1.treffer === 50 && fs1.ab === 0 && fs1.mehrVorhanden && fs1.naechsteSeite === 50 &&
         fs1.gesamt === undefined && fsZaehlen === false && fsAufrufe.join() === "first 50,close", JSON.stringify(fs1).substring(0, 300) + fsAufrufe.join());
  fsAufrufe = [];
  var fs3 = mpJson(callTool("elo_find_by_fields", { maske: "Lieferantenbeleg", felder: { FIRMA: "Muster GmbH" }, max: 50, ab: 100, gesamt: true }));
  pruefe("elo_find_by_fields Seite 3: Rest ab 100, gesamt, keine naechste Seite", fs3.treffer === 20 && fs3.ab === 100 && !fs3.mehrVorhanden && fs3.naechsteSeite === undefined &&
         fs3.gesamt === 120 && fsZaehlen === true && fs3.ergebnisse[0].name === "Beleg 100" && fsAufrufe.join() === "first 1,next 100 50,close", JSON.stringify(fs3).substring(0, 300) + fsAufrufe.join());
  var fsM = mpJson(callTool("elo_find_by_fields", { maske: "Lieferantenbeleg", felder: { FIRMA: "Muster GmbH" }, max: 3, spalten: ["typ"], mapFelder: ["IMP_NACHGEZOGEN", "IMP_API_TOKEN", "FEHLT"] }));
  pruefe("elo_find_by_fields: spalten und mapFelder, Token maskiert, eine Map-Abfrage je Treffer", fsM.ergebnisse.length === 3 && fsM.ergebnisse[1].felder.length === 1 &&
         fsM.ergebnisse[1].felder[0].feld === "TYP" && fsM.ergebnisse[1].map.IMP_NACHGEZOGEN === "2026-11-20|5001" && fsM.ergebnisse[1].map.IMP_API_TOKEN === "***" &&
         fsM.ergebnisse[1].map.FEHLT === undefined && fsMapAufrufe === 3, JSON.stringify(fsM));
  pruefe("elo_find_by_fields: ohne mapFelder keine Map-Abfrage", fsMapAufrufe === 3 && fs1.ergebnisse[0].map === undefined);
  pruefe("elo_find_by_fields: ab ueber der Grenze abgelehnt", /hoechstens 5000/.test(mpJson(callTool("elo_find_by_fields", { maske: "X", felder: { FIRMA: "Muster" }, ab: 5001 })).fehler));
  pruefe("elo_find_by_fields: negatives ab abgelehnt", /ab 0/.test(mpJson(callTool("elo_find_by_fields", { maske: "X", felder: { FIRMA: "Muster" }, ab: -1 })).fehler));
  pruefe("elo_find_by_fields: mapFelder mit Platzhalter abgelehnt", /ohne Platzhalter/.test(mpJson(callTool("elo_find_by_fields", { maske: "X", felder: { FIRMA: "Muster" }, mapFelder: ["IMP_*"] })).fehler));
  var fsZv = []; for (var fz = 0; fz < 11; fz++) fsZv.push("K" + fz);
  pruefe("elo_find_by_fields: hoechstens 10 mapFelder", /Hoechstens 10 mapFelder/.test(mpJson(callTool("elo_find_by_fields", { maske: "X", felder: { FIRMA: "Muster" }, mapFelder: fsZv })).fehler));
  pruefe("elo_find_by_fields: weiterhin keine ganze Maske", /mindestens ein Feld/.test(mpJson(callTool("elo_find_by_fields", { maske: "Lieferantenbeleg", ab: 50 })).fehler));
} finally {
  ELO.ix = fsIxEcht; delete maskCache["9"];
}

/* ---------- elo_count gegen eine Suche im Speicher ---------- */

var bzIxEcht = ELO.ix, BZ = [], bzAufrufe = [], bzZaehlFehlt = false;
function bzObjekt(n, firma, typ, art, geloescht) {
  var s = new IXC.Sord(); s.setId(6000 + n); s.setName("B" + n); s.setType(254); s.setDeleted(!!geloescht);
  var ks = [], werte = { FIRMA: firma, TYP: typ, ART: art };
  for (var k in werte) { var o = new IXC.ObjKey(); o.setName(k); o.setData(werte[k] === null ? [] : [werte[k]]); ks.push(o); }
  s.setObjKeys(ks); return s;
}
function bzNeu(anzahl) {
  BZ = []; bzAufrufe = [];
  for (var i = 0; i < anzahl; i++) BZ.push(bzObjekt(i, i % 3 === 0 ? "Alpha" : "Beta", i % 2 ? "Rechnung" : "Vertrag", i % 4 === 0 ? "neu" : null, false));
}
function bzErg(ab, max) {
  var teil = BZ.slice(ab, ab + max), arr = java.lang.reflect.Array.newInstance(IXC.Sord, teil.length);
  for (var i = 0; i < teil.length; i++) arr[i] = teil[i];
  return { getSords: function () { return arr; }, isMoreResults: function () { return ab + max < BZ.length; }, getSearchId: function () { return "Z1"; },
           getCount: function () { if (bzZaehlFehlt) throw new Error("kein Count"); return BZ.length; } };
}
ELO.ix = function () {
  return { findFirstSords: function (fi, max) { bzAufrufe.push("first " + max); return bzErg(0, max); },
           findNextSords: function (sid, ab, max) { bzAufrufe.push("next " + ab); return bzErg(ab, max); },
           findClose: function () { bzAufrufe.push("close"); } };
};
var bzWarteEcht = java.lang.Thread;
try {
  bzNeu(450);
  var bz0 = mpJson(callTool("elo_count", { maske: "Beleg" }));
  pruefe("elo_count ohne gruppe: nur Gesamtzahl, eine Zaehlabfrage", bz0.gesamt === 450 && bz0.gruppen === undefined && bzAufrufe.join() === "first 1,close", JSON.stringify(bz0) + bzAufrufe.join());
  bzAufrufe = [];
  var bz1 = mpJson(callTool("elo_count", { maske: "Beleg", gruppe: ["firma", "TYP"], gefuellt: ["ART"] }));
  var bzA = bz1.gruppen.filter(function (g) { return g.FIRMA === "Beta" && g.TYP === "Rechnung"; })[0];
  pruefe("elo_count gruppe A x B: Seiten zu 200, alle gelesen", bz1.gezaehlt === 450 && bz1.seiten === 3 && bzAufrufe.join() === "first 1,close,first 200,next 200,next 400,close", JSON.stringify(bz1).substring(0, 200) + bzAufrufe.join());
  pruefe("elo_count gruppe A x B: vier Gruppen, groesste zuerst, Summe stimmt", bz1.gruppen.length === 4 && bz1.gruppen[0].anzahl >= bz1.gruppen[3].anzahl &&
         bz1.gruppen.reduce(function (s, g) { return s + g.anzahl; }, 0) === 450 && bzA.anzahl === 150, JSON.stringify(bz1.gruppen));
  pruefe("elo_count gefuellt: je Gruppe und gesamt", bzA.ART_gefuellt === 0 && bz1.gefuelltGesamt.ART === 113, JSON.stringify(bz1.gefuelltGesamt) + JSON.stringify(bzA));
  BZ[0].setDeleted(true); BZ[1] = bzObjekt(1, null, "Vertrag", null, false);
  var bz2 = mpJson(callTool("elo_count", { maske: "Beleg", gruppe: "FIRMA" }));
  pruefe("elo_count: geloeschte uebersprungen, leere Werte als (leer)", bz2.gezaehlt === 449 && bz2.geloeschtUebersprungen === 1 &&
         bz2.gruppen.filter(function (g) { return g.FIRMA === "(leer)" && g.anzahl === 1; }).length === 1, JSON.stringify(bz2));
  bzNeu(5001);
  pruefe("elo_count: ueber 5000 nur Gesamtzahl, Gruppieren abgelehnt", mpJson(callTool("elo_count", { maske: "Beleg" })).gesamt === 5001 &&
         /hoechstens 5000/.test(mpJson(callTool("elo_count", { maske: "Beleg", gruppe: ["FIRMA"] })).fehler));
  bzZaehlFehlt = true;
  pruefe("elo_count: ohne Trefferzahl abgelehnt", /keine Trefferzahl/.test(mpJson(callTool("elo_count", { maske: "Beleg" })).fehler));
  bzZaehlFehlt = false;
  pruefe("elo_count: hoechstens zwei Gruppenfelder", /eine oder zwei/.test(mpJson(callTool("elo_count", { maske: "Beleg", gruppe: ["A", "B", "C"] })).fehler));
  pruefe("elo_count: hoechstens drei gefuellt-Felder", /hoechstens drei/.test(mpJson(callTool("elo_count", { maske: "Beleg", gefuellt: ["A", "B", "C", "D"] })).fehler));
  pruefe("elo_count: Filterwert zu unspezifisch", /zu unspezifisch/.test(mpJson(callTool("elo_count", { maske: "Beleg", felder: { FIRMA: "*" } })).fehler));
  pruefe("elo_count: maske Pflicht", mpJson(callTool("elo_count", {})).fehler !== undefined);
} finally {
  ELO.ix = bzIxEcht;
}

/* ---------- elo_mask: Formular aus ELOwf.maskforms und Maskenkopie als Datei ---------- */

var mfWert = "(840187C7-2112-F12C-701A-AFA993944475):common_document(105_a,005_b)" + ELO.PILCROW + "(01BEBFDE-71DE-498E-DEE0-A1909D72F41F):ansicht_x(titel,ansicht)" + ELO.PILCROW + "kaputt";
var mf = maskFormulareLesen(mfWert, "(01bebfde-71de-498e-dee0-a1909d72f41f)");
pruefe("maskFormulareLesen: Eintrag zur GUID, Gross/klein egal", mf.length === 1 && mf[0].formular === "ansicht_x" && mf[0].seiten.join() === "titel,ansicht" && mf[0].eintrag === "ansicht_x(titel,ansicht)", JSON.stringify(mf));
pruefe("maskFormulareLesen: keine Zuordnung -> leer", maskFormulareLesen(mfWert, "(00000000-0000-0000-0000-000000000000)").length === 0 && maskFormulareLesen("", "(X)").length === 0);
var mfOrdner = java.nio.file.Files.createTempDirectory("elo-mcp-maske").toFile(), mfDatei = new java.io.File(mfOrdner, "maske.json");
var mfPfad = maskeDateiSchreiben(S(mfDatei.getAbsolutePath()), { quelle: "elo_mask", name: "Beleg" });
pruefe("maskeDateiSchreiben: neue Datei", mfDatei.exists() && JSON.parse(S(new java.lang.String(java.nio.file.Files.readAllBytes(mfDatei.toPath()), "UTF-8"))).name === "Beleg");
maskeDateiSchreiben(mfPfad, { quelle: "elo_mask", name: "Beleg 2" });
pruefe("maskeDateiSchreiben: eigene Datei ueberschreiben", JSON.parse(S(new java.lang.String(java.nio.file.Files.readAllBytes(mfDatei.toPath()), "UTF-8"))).name === "Beleg 2");
var mfFremd = new java.io.File(mfOrdner, "fremd.json"); java.nio.file.Files.write(mfFremd.toPath(), new java.lang.String("{\"a\":1}").getBytes("UTF-8"));
function mfFehler(f) { try { f(); return ""; } catch (e) { return errText(e); } }
pruefe("maskeDateiSchreiben: fremde Datei nicht ueberschreiben", /stammt nicht von elo_mask/.test(mfFehler(function () { maskeDateiSchreiben(S(mfFremd.getAbsolutePath()), { quelle: "elo_mask" }); })) &&
       S(new java.lang.String(java.nio.file.Files.readAllBytes(mfFremd.toPath()), "UTF-8")) === "{\"a\":1}");
var mfF1 = mfFehler(function () { maskeDateiSchreiben(S(mfOrdner.getAbsolutePath()) + "/x.txt", {}); }), mfF2 = mfFehler(function () { maskeDateiSchreiben("x.json", {}); }),
    mfF3 = mfFehler(function () { maskeDateiSchreiben(S(mfOrdner.getAbsolutePath()) + "/fehlt/x.json", {}); });
pruefe("maskeDateiSchreiben: nur .json", /\.json/.test(mfF1), mfF1);
pruefe("maskeDateiSchreiben: nur absolut", /absoluten/.test(mfF2), mfF2);
pruefe("maskeDateiSchreiben: Ordner muss bestehen", /gibt es nicht/.test(mfF3), mfF3);
mfDatei["delete"](); mfFremd["delete"](); mfOrdner["delete"]();

OUT.println("");
OUT.println(okZahl + " ok, " + fehlerZahl + " Fehler");
OUT.flush();
java.lang.System.exit(fehlerZahl ? 1 : 0);
