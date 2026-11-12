/*
 * offline.js - Pruefungen ohne ELO-Verbindung: Protokoll, Stufen, Vorschau und Token,
 * Datumspruefung, Bauplan-, Skript- und Maskenpruefungen. Wird von test\offline.ps1 nach den Quellen geladen
 * (elo.js, elo-mcp.js, elo-mcp-schreiben.js, elo-mcp-bauen.js, elo-mcp-masken.js, elo-mcp-benutzer.js, elo-mcp-rechte.js, elo-mcp-vorgaenge.js - ohne elo-mcp-start.js).
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
var erwartet = 19 + (SCHREIBEN_ERLAUBT ? 7 : 0) + (BAUEN_ERLAUBT ? 14 : 0);
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

OUT.println("");
OUT.println(okZahl + " ok, " + fehlerZahl + " Fehler");
OUT.flush();
java.lang.System.exit(fehlerZahl ? 1 : 0);
