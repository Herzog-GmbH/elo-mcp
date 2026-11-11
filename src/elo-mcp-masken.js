/*
 * elo-mcp-masken.js - Verschlagwortungsmasken lesen (Stufe 1) und bauen (Stufe 3).
 * Wird nach elo-mcp-bauen.js geladen (nutzt zweiSchritte, bauenPruefen, sicherungsOrdner, zeitstempel,
 * keywordTexts, errText).
 *
 *   elo_mask          Maske lesen: Art, Reiter, Felder mit Typ, Reiter, Zeile, Spalten, Rechte; Layout-Pruefung
 *   elo_mask_create   Neue Maske als Kopie einer vorhandenen (Dokument-, Ordner-, Suchmaske)
 *   elo_mask_fields   Felder hinten anhaengen oder vorhandene aendern
 *   elo_mask_tabs     Reiter benennen, Felder auf einen anderen Reiter verschieben, Zeilen ordnen
 *   elo_keywords      Stichwortliste lesen
 *   elo_keywords_set  Stichwortliste anlegen oder Eintraege ergaenzen/ersetzen
 *
 * Fest eingebaute Regeln, alle aus echten Stoerungen (siehe docs/FALLEN.md):
 *   - DocMaskLine.tabIndex ist die Nummer des Reiters, nicht die Reihenfolge. Die Reiternamen stehen im Maskentext,
 *     getrennt durch "|" ("Basis|Termine und Kosten|||"). Ein Reiter ohne Namen erscheint als "Index<n>".
 *   - Reiter 0: Zeilen 1 bis 3 belegen Kurzbezeichnung, Datum, Ablagedatum -> Indexfelder ab Zeile 4.
 *     Andere Reiter ab Zeile 1, fortlaufend je Reiter.
 *   - editCol (Beginn des Eingabefelds) Standard 14, bei langen Beschriftungen weiter (26 fuer
 *     "Kuendigungsfrist in Monaten"), sonst liegt die Beschriftung unter dem Feld.
 *   - Jede Zeile hat Rechte (aclItems). Ohne Eintrag sehen nur Administratoren den Wert.
 *   - Keine Klammern in Anzeigenamen: Programme wie ACTIWARE BLP geben Felder als [NDF.<Name>] weiter,
 *     "(" startet dort eine Formatangabe.
 *   - Zeilen nie umsortieren: manche Programme (z. B. der Maskenbaustein von ACTIWARE BLP) zaehlen Felder nach
 *     Position. Neue Felder nur hinten anhaengen.
 *   - Zeilen-IDs 50 bis 59 sind von ELO reserviert (ELO_XLINK, ELO_FNAME ...), hoechstens 199.
 *   - Speichern mit checkinDocMask(m, mbAll, LockC.YES), vorher Sicherung als JSON, danach zuruecklesen und
 *     vergleichen. Im ELO Client erst nach Neuanmeldung sichtbar.
 * Loeschen gibt es hier nicht (wie im restlichen Server).
 */

var DMC = IXC.DocMaskC;
var KLAMMER = /[()\[\]{}]/;
var SPALTE_STANDARD = 14;
var REITER_FELDER = 5;      // Maskentext hat in ELO ueblicherweise fuenf Eintraege: "Basis||||"
var JEDER_ID = 9999;
var RECHT_BITS = [["R", 1], ["W", 2], ["D", 4], ["E", 8], ["L", 16], ["P", 32]];
var TYP_NAME = { 3000: "Text", 3001: "Datum (alt)", 3002: "Zahl", 3003: "Text A-Z", 3004: "Datum", 3005: "Liste", 3006: "Benutzer",
  3007: "Thesaurus", 3008: "Zahl ohne Nachkommastellen", 3009: "Zahl 1 Nachkommastelle", 3010: "Zahl 2 Nachkommastellen",
  3011: "Zahl 4 Nachkommastellen", 3012: "Zahl 6 Nachkommastellen", 3013: "Ganzzahl", 3014: "Ganzzahl lang", 3015: "Float",
  3016: "Double", 3017: "Platzhalter", 3018: "Relation" };
var TYP_EIN = { text: 3000, datum: 3004, zahl: 3002, ganzzahl: 3013, betrag: 3010, benutzer: 3006 };

/* ---------- Hilfen ---------- */

function jarr(cls, list) {
  var a = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client." + cls), list.length);
  for (var i = 0; i < list.length; i++) a[i] = list[i];
  return a;
}
function alsListe(javaArr) { var out = []; for (var i = 0; javaArr && i < javaArr.length; i++) out.push(javaArr[i]); return out; }
function keyOf(l) { return S(l.getKey()).toUpperCase(); }
function ersteZeile(tab) { return tab === 0 ? 4 : 1; }
function reiterNamen(text) { return S(text).split("|"); }
function reiterText(namen) { var t = namen.slice(); while (t.length < REITER_FELDER) t.push(""); return t.join("|"); }
function reiterName(namen, nr) { return trim(namen[nr] || ""); }
function noetigeSpalte(name) { return Math.max(SPALTE_STANDARD, S(name).length - 1); }

function maskeHolen(v, sperren) {
  v = trim(v);
  if (!v) fail("maske fehlt.");
  try { return ELO.ix().checkoutDocMask(v, DMC.mbAll, sperren ? IXC.LockC.YES : IXC.LockC.NO); }
  catch (e) { if (sperren) throw e; fail("Maske nicht gefunden: " + v + " (" + errText(e) + ")"); }
}
function maskeDa(name) { try { return ELO.ix().checkoutDocMask(name, DMC.mbAll, IXC.LockC.NO); } catch (e) { return null; } }

function maskenArt(m) {
  var d = m.getDetails(), a = [];
  if (d.isDocumentMask()) a.push("Dokumentmaske");
  if (d.isFolderMask()) a.push("Ordnermaske");
  if (d.isSearchMask()) a.push("Suchmaske");
  return a.join(", ") || "keine Art gesetzt";
}

/* ---------- Rechte ---------- */

function rechteText(access) { var s = ""; for (var i = 0; i < RECHT_BITS.length; i++) if (access & RECHT_BITS[i][1]) s += RECHT_BITS[i][0]; return s || "-"; }
function aclArt(t) { return t === 0 ? "Gruppe" : (t === 1 ? "Benutzer" : (t === 100 ? "geerbt" : (t === 200 ? "Eigentuemer" : "Typ " + t))); }
function aclListe(items) {
  var out = [];
  for (var i = 0; items && i < items.length; i++) out.push(S(items[i].getName()) + " (" + aclArt(items[i].getType()) + ") " + rechteText(items[i].getAccess()));
  return out;
}
function aclItem(id, name, type, access) { var it = new IXC.AclItem(); it.setId(id); it.setName(S(name)); it.setType(type); it.setAccess(access); return it; }
function aclKopie(items) { var l = []; for (var i = 0; items && i < items.length; i++) l.push(aclItem(items[i].getId(), items[i].getName(), items[i].getType(), items[i].getAccess())); return l; }
function aclSig(items) { var t = []; for (var i = 0; items && i < items.length; i++) t.push(items[i].getId() + ":" + items[i].getAccess()); t.sort(); return t.join(","); }
function hatRechte(l) { var it = l.getAclItems(); return (it && it.length > 0) || !!trim(l.getAcl()); }

function rechteBits(s) {
  s = trim(s).toUpperCase();
  if (s === "VOLL" || s === "ALLE") return 63;
  var v = 0;
  for (var i = 0; i < s.length; i++) {
    var ok = false;
    for (var k = 0; k < RECHT_BITS.length; k++) if (RECHT_BITS[k][0] === s.charAt(i)) { v |= RECHT_BITS[k][1]; ok = true; }
    if (!ok) fail("Rechte '" + s + "': erlaubt sind die Buchstaben R W D E L P (lesen, schreiben, loeschen, bearbeiten, listen, Rechte) oder 'voll'.");
  }
  if (!(v & 1)) fail("Rechte '" + s + "' ohne R (lesen) - der Eintrag waere wirkungslos.");
  return v;
}

/* Rechte fuer eine Zeile. angabe: "wie" (Standard: wie die erste Zeile mit Rechten), "jeder_lesen", "jeder_schreiben"
   oder Liste [{name, rechte}]. Liefert { items: [AclItem], text } */
function rechteAus(angabe, lines, warn, key) {
  if (angabe === undefined || angabe === null || angabe === "" || angabe === "wie") {
    for (var i = 0; i < lines.length; i++) {
      var it = lines[i].getAclItems();
      if (it && it.length) return { items: aclKopie(it), text: "wie Feld " + keyOf(lines[i]) + ": " + aclListe(it).join(", ") };
    }
    return { items: [aclItem(JEDER_ID, "Jeder", 0, 3)], text: "Jeder (Gruppe) RW - keine Zeile mit Rechten als Vorbild" };
  }
  if (angabe === "jeder_lesen") return { items: [aclItem(JEDER_ID, "Jeder", 0, 1)], text: "Jeder (Gruppe) R" };
  if (angabe === "jeder_schreiben") return { items: [aclItem(JEDER_ID, "Jeder", 0, 3)], text: "Jeder (Gruppe) RW" };
  if (typeof angabe === "string" || !angabe.length) fail("rechte: 'wie', 'jeder_lesen', 'jeder_schreiben' oder Liste [{\"name\": \"Buchhaltung\", \"rechte\": \"RW\"}].");
  var items = [], jeder = false;
  for (var j = 0; j < angabe.length; j++) {
    var e = angabe[j] || {}, nm = trim(e.name), bits = rechteBits(e.rechte || "R");
    if (!nm) fail("rechte: Eintrag " + (j + 1) + " ohne name.");
    if (nm.toLowerCase() === "jeder") { items.push(aclItem(JEDER_ID, "Jeder", 0, bits)); jeder = true; continue; }
    var u;
    try { u = ELO.ix().checkoutUser(nm, IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO); }
    catch (x) { fail("rechte: Benutzer oder Gruppe '" + nm + "' gibt es nicht."); }
    items.push(aclItem(u.getId(), u.getName(), u.getType() === 0 ? 0 : 1, bits));
  }
  if (!jeder) warn.push("Feld " + key + ": nur " + aclListe(items).join(", ") + " sehen den Wert, alle anderen nicht.");
  return { items: items, text: aclListe(items).join(", ") };
}

/* ---------- Typen, Reiter, Zeilen ---------- */

function typNr(v) {
  var s = trim(v).toLowerCase();
  if (/^\d+$/.test(s)) { var n = parseInt(s, 10); if (TYP_NAME[n]) return n; }
  if (TYP_EIN[s] !== undefined) return TYP_EIN[s];
  fail("typ '" + v + "' unbekannt. Moeglich: text, datum, zahl, ganzzahl, betrag (2 Nachkommastellen), benutzer oder ELO-Typnummer 3000-3018.");
}
function typText(t) { return (TYP_NAME[t] || "Typ") + " (" + t + ")"; }

function reiterNr(v, namen) {
  if (typeof v === "number" || /^\d+$/.test(trim(v))) {
    var n = parseInt(v, 10);
    if (n < 0 || n > 99) fail("Reiter " + v + ": Nummer 0 bis 99.");
    return n;
  }
  var s = trim(v).toLowerCase();
  for (var i = 0; i < namen.length; i++) if (trim(namen[i]).toLowerCase() === s && s) return i;
  fail("Reiter '" + v + "' gibt es nicht. Reiter: " + reiterUebersicht(namen) + ". Neue Reiter mit elo_mask_tabs (reiter) anlegen.");
}
function reiterUebersicht(namen) { var t = []; for (var i = 0; i < namen.length; i++) if (trim(namen[i])) t.push(i + " " + trim(namen[i])); return t.join(", ") || "keine"; }

function pruefeReiterNamen(arr) {
  if (!arr || !arr.length) fail("reiter ist leer.");
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var n = trim(arr[i]);
    if (n.indexOf("|") >= 0) fail("Reitername '" + n + "' enthaelt '|' - das trennt im Maskentext die Reiter.");
    out.push(n);
  }
  if (!out[0]) fail("Reiter 0 braucht einen Namen (ueblich 'Basis').");
  return out;
}

function sichtbarAuf(l, tab) { return !l.isHidden() && l.getTabIndex() === tab; }

function haeufigste(lines, tab, getter, ohneKey) {
  var z = {}, best = 0, bestN = 0;
  for (var i = 0; i < lines.length; i++) {
    if (!sichtbarAuf(lines[i], tab) || keyOf(lines[i]) === ohneKey) continue;
    var c = lines[i][getter]();
    z[c] = (z[c] || 0) + 1;
    if (z[c] > bestN || (z[c] === bestN && c > best)) { best = c; bestN = z[c]; }
  }
  return best;
}
/* Beginn des Eingabefelds: wie die meisten Felder des Reiters, mindestens 14 bzw. so weit, wie die Beschriftung braucht */
function spalteFuer(lines, tab, name, ohneKey) { return Math.max(noetigeSpalte(name), haeufigste(lines, tab, "getEditCol", ohneKey) || SPALTE_STANDARD); }
function beschriftungsSpalte(lines, tab, ohneKey) { return haeufigste(lines, tab, "getLabelCol", ohneKey) || 1; }

function naechsteZeile(lines, tab, ohneKey) {
  var r = ersteZeile(tab) - 1;
  for (var i = 0; i < lines.length; i++) {
    if (!sichtbarAuf(lines[i], tab) || keyOf(lines[i]) === ohneKey) continue;
    r = Math.max(r, lines[i].getEditRow(), lines[i].getLabelRow());
  }
  return r + 1;
}

/* Platz direkt unter dem Feld nachKey; die Felder darunter auf demselben Reiter ruecken eine Zeile nach unten
   (nur die Anzeige, die Reihenfolge der Zeilen in der Maske bleibt). */
function platzNach(lines, nachKey, tab, ohneKey, verschoben) {
  var n = null, k = trim(nachKey).toUpperCase();
  for (var i = 0; i < lines.length; i++) if (keyOf(lines[i]) === k) n = lines[i];
  if (!n) fail("nach: Feld " + k + " gibt es in der Maske nicht.");
  if (n.isHidden()) fail("nach: Feld " + k + " ist versteckt.");
  if (n.getTabIndex() !== tab) fail("nach: Feld " + k + " liegt auf Reiter " + n.getTabIndex() + ", nicht auf Reiter " + tab + ".");
  var row = n.getEditRow() + 1;
  for (var j = 0; j < lines.length; j++) {
    var l = lines[j], key = keyOf(l);
    if (key === ohneKey || key === k || !sichtbarAuf(l, tab) || l.getEditRow() < row) continue;
    l.setEditRow(l.getEditRow() + 1);
    if (l.getLabelRow() >= row) l.setLabelRow(l.getLabelRow() + 1);
    verschoben.push(key);
  }
  return row;
}

/* Zeilen eines Reiters lueckenlos ab Zeile 4 (Basis) bzw. 1, sichtbare Reihenfolge bleibt.
   Felder nebeneinander (gleiche Zeile, andere Beschriftungsspalte) bleiben nebeneinander. Liefert die Aenderungen. */
function ordneReiter(lines, tab) {
  var vis = [];
  for (var i = 0; i < lines.length; i++) if (sichtbarAuf(lines[i], tab)) vis.push({ l: lines[i], i: i });
  vis.sort(function (a, b) { return (a.l.getEditRow() - b.l.getEditRow()) || (a.l.getLabelCol() - b.l.getLabelCol()) || (a.i - b.i); });
  var row = ersteZeile(tab) - 1, letzte = null, spalten = {}, aend = [];
  for (var k = 0; k < vis.length; k++) {
    var l = vis[k].l, r = l.getEditRow(), c = l.getLabelCol();
    if (r !== letzte || spalten[c]) { row++; spalten = {}; letzte = r; }
    spalten[c] = true;
    if (l.getEditRow() !== row || l.getLabelRow() !== row) {
      aend.push(keyOf(l) + ": Zeile " + l.getEditRow() + " -> " + row);
      l.setEditRow(row); l.setLabelRow(row);
    }
  }
  return aend;
}

function freieId(lines) {
  var used = {}, max = -1;
  for (var i = 0; i < lines.length; i++) { var id = lines[i].getId(); used[id] = true; if (id < 50 || id > 59) max = Math.max(max, id); }
  var n = max + 1;
  while (used[n] || (n >= 50 && n <= 59)) n++;
  if (n > 199) fail("Keine freie Zeilen-ID mehr (ELO erlaubt hoechstens 199).");
  return n;
}

/* ---------- Pruefung ---------- */

/* Prueft Reiter, Zeilen, Rechte und Namen. Verstoesse an Feldern aus beruehrt (oder alle, wenn alle=true) sind Fehler,
   die uebrigen bestehende Maengel (Hinweis). */
function layoutPruefen(namen, lines, beruehrt, alle) {
  var fehler = [], hinweise = [], platz = {}, gesehen = {}, ids = {}, keys = {}, proReiter = {};
  function melde(key, text) { (alle || beruehrt[key] ? fehler : hinweise).push(text); }
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i], key = keyOf(l), name = S(l.getName()), tab = l.getTabIndex(), id = l.getId();
    if (keys[key]) melde(key, "Feldgruppe " + key + " steht zweimal in der Maske.");
    keys[key] = true;
    if (ids[id] !== undefined) melde(key, "Zeilen-ID " + id + " doppelt (" + ids[id] + " und " + key + ").");
    ids[id] = key;
    if (id > 199) melde(key, "Feld " + key + ": Zeilen-ID " + id + " ueber 199.");
    if (KLAMMER.test(name)) melde(key, "Feld " + key + " '" + name + "': Klammern im Anzeigenamen stoeren BLP-Platzhalter [NDF.<Name>].");
    if (gesehen[name]) hinweise.push("Anzeigename '" + name + "' doppelt (" + gesehen[name] + " und " + key + ") - in BLP ([NDF.<Name>]) nicht unterscheidbar.");
    gesehen[name] = key;
    if (!hatRechte(l)) {
      if (l.isHidden()) hinweise.push("Verstecktes Feld " + key + " ohne Rechte - nur Administratoren sehen den Wert.");
      else melde(key, "Feld " + key + " ohne Rechte - nur Administratoren sehen den Wert.");
    }
    if (l.isHidden()) continue;
    proReiter[tab] = (proReiter[tab] || []).concat([l.getEditRow()]);
    if (!reiterName(namen, tab)) melde(key, "Feld " + key + " liegt auf Reiter " + tab + " ohne Namen - erscheint als 'Index" + tab + "'.");
    if (l.getEditRow() < ersteZeile(tab)) melde(key, "Feld " + key + " auf Reiter 0 in Zeile " + l.getEditRow() + " - Zeilen 1 bis 3 belegen Kurzbezeichnung, Datum und Ablagedatum.");
    if (l.getLabelRow() !== l.getEditRow()) hinweise.push("Feld " + key + ": Beschriftung in Zeile " + l.getLabelRow() + ", Eingabefeld in Zeile " + l.getEditRow() + ".");
    var p = tab + "/" + l.getEditRow() + "/" + l.getLabelCol();
    if (platz[p]) {
      var t = "Felder " + platz[p] + " und " + key + " liegen auf Reiter " + tab + " uebereinander (Zeile " + l.getEditRow() + ").";
      if (alle || beruehrt[key] || beruehrt[platz[p]]) fehler.push(t); else hinweise.push(t);
    } else platz[p] = key;
    if (l.getEditCol() > 0 && l.getEditCol() < S(name).length - 1) hinweise.push("Feld " + key + " '" + name + "': Eingabefeld beginnt in Spalte " + l.getEditCol() + ", die Beschriftung braucht etwa " + noetigeSpalte(name) + ".");
  }
  for (var r = 0; r < namen.length; r++) if (reiterName(namen, r) && !proReiter[r]) hinweise.push("Reiter " + r + " '" + reiterName(namen, r) + "' hat keine Felder.");
  for (var tb in proReiter) {
    var rows = proReiter[tb].slice().sort(function (a, b) { return a - b; }), fehlt = [];
    for (var z = ersteZeile(parseInt(tb, 10)); z < rows[rows.length - 1]; z++) if (rows.indexOf(z) < 0) fehlt.push(z);
    if (fehlt.length) hinweise.push("Reiter " + tb + ": leere Zeile(n) " + fehlt.slice(0, 10).join(", ") + (fehlt.length > 10 ? " ..." : "") + " (elo_mask_tabs mit ordnen schliesst sie).");
  }
  return { fehler: fehler, hinweise: hinweise };
}

function feldInfo(l, namen, pos) {
  var t = l.getTabIndex(), f = { pos: pos, id: l.getId(), key: S(l.getKey()), name: S(l.getName()), typ: typText(l.getType()) };
  if (l.isHidden()) f.versteckt = true;
  else {
    f.reiter = t + " " + (reiterName(namen, t) || "(ohne Namen, erscheint als Index" + t + ")");
    f.zeile = l.getEditRow();
    if (l.getLabelRow() !== l.getEditRow()) f.zeileBeschriftung = l.getLabelRow();
    f.spalten = l.getLabelCol() + "/" + l.getEditCol();
  }
  if (l.getEditWidth()) f.breite = l.getEditWidth();
  f.max = l.getMax();
  if (l.isOnlyBuzzwords()) f.nurListe = true;
  if (l.isRequired()) f.pflicht = true;
  if (l.isReadOnly()) f.nurLesen = true;
  if (S(l.getDefaultValue())) f.vorgabe = S(l.getDefaultValue());
  var it = l.getAclItems();
  f.rechte = it && it.length ? aclListe(it) : (trim(l.getAcl()) ? "nur ACL-Text '" + S(l.getAcl()) + "'" : "KEINE");
  return f;
}

function maskeBeschreiben(m) {
  var namen = reiterNamen(m.getText()), z = m.getLines(), felder = [], anz = {}, maxTab = 0;
  for (var i = 0; i < z.length; i++) {
    felder.push(feldInfo(z[i], namen, i));
    if (!z[i].isHidden()) { anz[z[i].getTabIndex()] = (anz[z[i].getTabIndex()] || 0) + 1; maxTab = Math.max(maxTab, z[i].getTabIndex()); }
  }
  var reiter = [];
  for (var r = 0; r <= Math.max(maxTab, namen.length - 1); r++)
    if (reiterName(namen, r) || anz[r]) reiter.push(r + " " + (reiterName(namen, r) || "Index" + r + " (ohne Namen)") + ": " + (anz[r] || 0) + " Felder");
  var d = m.getDetails(), res = { id: S(m.getId()), name: S(m.getName()), guid: S(m.getGuid()), art: maskenArt(m), maskentext: S(m.getText()), reiter: reiter,
    zeilen: z.length, nutzbarFuer: aclListe(m.getAclItems()), dokumentRechteVorgabe: aclListe(m.getDocAclItems()) };
  if (d.getEncryptionSet()) res.verschluesselung = "Schluesselkreis " + d.getEncryptionSet();
  if (m.getFlowId() >= 0) res.workflowBeiAblage = m.getFlowId();
  if (trim(m.getIndex())) res.ablagedefinition = S(m.getIndex());
  if (S(m.getLockName())) res.gesperrtVon = S(m.getLockName());
  res.felder = felder;
  return res;
}

/* ---------- Speichern ---------- */

function zeilenSig(l) {
  return [keyOf(l), S(l.getName()), l.getType(), l.getTabIndex(), l.getLabelRow(), l.getEditRow(), l.getLabelCol(), l.getEditCol(),
          l.getMax(), !!l.isOnlyBuzzwords(), !!l.isRequired(), !!l.isHidden(), aclSig(l.getAclItems())].join("|");
}
function fpMaske(m) {
  var z = m.getLines(), p = [S(m.getId()), S(m.getName()), S(m.getText()), maskenArt(m)];
  for (var i = 0; i < z.length; i++) p.push(z[i].getId() + "=" + zeilenSig(z[i]));
  return p.join("\n");
}

function sichereMaske(m, suffix) {
  var f = new java.io.File(sicherungsOrdner(), "maske-" + S(m.getId()) + "-" + zeitstempel() + suffix + ".json");
  var inhalt = maskeBeschreiben(m), z = m.getLines();
  inhalt.zeilenRoh = [];
  for (var i = 0; i < z.length; i++) inhalt.zeilenRoh.push({ id: z[i].getId(), sig: zeilenSig(z[i]), acl: S(z[i].getAcl()) });
  var w = new java.io.OutputStreamWriter(new java.io.FileOutputStream(f), "UTF-8");
  try { w.write(JSON.stringify(inhalt, null, 1)); } finally { w.close(); }
  return S(f.getAbsolutePath());
}

function rueckVergleich(soll, ist) {
  var ab = [], zi = ist.getLines();
  if (S(ist.getText()) !== soll.text) ab.push("Maskentext soll '" + soll.text + "', ist '" + S(ist.getText()) + "'.");
  if (zi.length !== soll.sig.length) ab.push("Zeilen soll " + soll.sig.length + ", ist " + zi.length + ".");
  for (var i = 0; i < Math.min(zi.length, soll.sig.length); i++) {
    var s = zeilenSig(zi[i]);
    if (s !== soll.sig[i]) ab.push("Zeile " + i + ": soll " + soll.sig[i] + " | ist " + s);
  }
  return ab;
}

function cachesLeeren() { maskCache = {}; maskObjCache = {}; }

/* Vorhandene Maske aendern: sperren, mit der Vorschau vergleichen, anwenden, pruefen, sichern, speichern, zuruecklesen. */
function maskeAendern(maskeId, fp, anwenden) {
  var m = maskeHolen(maskeId, true), gespeichert = false;
  try {
    if (fpMaske(m) !== fp) fail("Die Maske hat sich seit der Vorschau geaendert. Bitte neue Vorschau holen.");
    var altKeys = [], z = m.getLines();
    for (var i = 0; i < z.length; i++) altKeys.push(keyOf(z[i]));
    var vorher = sichereMaske(m, "-vorher");
    var r = anwenden(m, []);
    var lp = layoutPruefen(r.namen, r.lines, r.beruehrt, r.alle);
    if (lp.fehler.length) fail("Nicht gespeichert, Regeln verletzt:\n- " + lp.fehler.join("\n- "));
    for (var k = 0; k < altKeys.length; k++) if (keyOf(r.lines[k]) !== altKeys[k]) fail("Interner Fehler: Zeilenfolge wuerde sich aendern (Position " + k + "). Nichts gespeichert.");
    var soll = { text: S(m.getText()), sig: [] };
    for (var j = 0; j < r.lines.length; j++) soll.sig.push(zeilenSig(r.lines[j]));
    ELO.ix().checkinDocMask(m, DMC.mbAll, IXC.LockC.YES);
    gespeichert = true;
    cachesLeeren();
    var ist = maskeHolen(maskeId, false), ab = rueckVergleich(soll, ist);
    return { maskeId: S(ist.getId()), name: S(ist.getName()), aenderungen: r.bericht, rueckgelesen: ab.length ? "ABWEICHUNGEN" : "ok, alle Zeilen wie geplant",
             abweichungen: ab.length ? ab : undefined, sicherungVorher: vorher, sicherungNachher: sichereMaske(ist, "-nachher"),
             hinweis: "Im ELO Client erst nach Neuanmeldung sichtbar. Werten andere Programme die Maske aus (z. B. ACTIWARE BLP), dort pruefen." };
  } finally {
    if (!gespeichert) { try { ELO.ix().checkinDocMask(m, DMC.mbOnlyLock, IXC.LockC.YES); } catch (e2) { log("Maske " + maskeId + " entsperren fehlgeschlagen: " + e2); } }
  }
}

/* Vorschau und Ausfuehrung fuer elo_mask_fields und elo_mask_tabs */
function maskenWerkzeug(name, a, aktion, anwenden) {
  return zweiSchritte(name, a, function () {
    var m = maskeHolen(a.maske, false), warn = [];
    if (S(m.getLockName())) fail("Maske ist gesperrt von " + S(m.getLockName()) + ".");
    var fp = fpMaske(m), vorher = m.getLines().length;
    var r = anwenden(m, warn);
    var lp = layoutPruefen(r.namen, r.lines, r.beruehrt, r.alle);
    if (lp.fehler.length) fail("Regeln verletzt, nichts geaendert:\n- " + lp.fehler.join("\n- ") + (lp.hinweise.length ? "\nBestehende Maengel:\n- " + lp.hinweise.join("\n- ") : ""));
    for (var i = 0; i < lp.hinweise.length; i++) warn.push("Bestehend: " + lp.hinweise[i]);
    warn.push("Im ELO Client erst nach Neuanmeldung sichtbar.");
    return { vorschau: { aktion: aktion, maske: S(m.getName()) + " [" + S(m.getId()) + "]", reiter: reiterUebersicht(r.namen),
                         zeilenVorher: vorher, zeilenNachher: r.lines.length, aenderungen: r.bericht },
             warnungen: warn, fp: fp, maskeId: S(m.getId()) };
  }, function (p) {
    return maskeAendern(p.maskeId, p.fp, anwenden);
  });
}

/* ---------- elo_mask_fields ---------- */

function felderAnwenden(a) {
  return function (m, warn) {
    var lines = alsListe(m.getLines()), namen = reiterNamen(m.getText()), altLines = lines.slice(), byKey = {}, bericht = [], beruehrt = {}, gesehen = {};
    for (var i = 0; i < lines.length; i++) byKey[keyOf(lines[i])] = lines[i];
    if (!a.felder || !a.felder.length) fail("felder fehlt oder ist leer.");
    for (var n = 0; n < a.felder.length; n++) {
      var f = a.felder[n] || {}, key = trim(f.key).toUpperCase();
      if (!key) fail("felder[" + n + "]: key fehlt.");
      if (gesehen[key]) fail("Feld " + key + " steht zweimal in felder.");
      gesehen[key] = true;
      var name = f.name === undefined ? null : trim(f.name);
      if (name !== null && !name) fail("Feld " + key + ": name ist leer.");
      if (name && KLAMMER.test(name)) fail("Feld " + key + " '" + name + "': keine Klammern im Anzeigenamen - BLP gibt Felder als [NDF.<Name>] weiter, '(' startet dort eine Formatangabe.");
      var l = byKey[key], ae = [];
      if (l) {
        if (f.reiter !== undefined || f.nach !== undefined) fail("Feld " + key + " gibt es schon. Verschieben auf einen anderen Reiter oder Platz geht mit elo_mask_tabs (verschieben).");
        if (name !== null && name !== S(l.getName())) { ae.push("Name '" + S(l.getName()) + "' -> '" + name + "'"); l.setName(name); }
        if (f.typ !== undefined) {
          var t = typNr(f.typ);
          if (t !== l.getType()) {
            ae.push("Typ " + typText(l.getType()) + " -> " + typText(t)); l.setType(t);
            warn.push("Feld " + key + ": vorhandene Werte werden beim Typwechsel nicht umgewandelt (Datum braucht JJJJMMTT000000).");
          }
        }
        if (f.max !== undefined) {
          var mx = parseInt(f.max, 10);
          if (!(mx > 0 && mx <= 255)) fail("Feld " + key + ": max 1 bis 255.");
          if (mx !== l.getMax()) { ae.push("Laenge " + l.getMax() + " -> " + mx); if (mx < l.getMax()) warn.push("Feld " + key + ": kuerzer als bisher, laengere Werte bleiben stehen, lassen sich aber nicht mehr so speichern."); l.setMax(mx); }
        }
        if (f.spalte !== undefined) {
          var sp = parseInt(f.spalte, 10);
          if (!(sp >= 1 && sp <= 80)) fail("Feld " + key + ": spalte 1 bis 80.");
          if (sp !== l.getEditCol()) { ae.push("Spalte " + l.getEditCol() + " -> " + sp); l.setEditCol(sp); }
        }
        if (name !== null && f.spalte === undefined && !l.isHidden() && l.getEditCol() < noetigeSpalte(name) && name.length - 1 > l.getEditCol()) {
          var ns = spalteFuer(lines, l.getTabIndex(), name, key);
          ae.push("Spalte " + l.getEditCol() + " -> " + ns + " (lange Beschriftung)"); l.setEditCol(ns);
        }
      } else {
        if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(key)) fail("Feldgruppe '" + key + "': nur A-Z, 0-9 und _, mit Buchstaben am Anfang, hoechstens 30 Zeichen.");
        if (/^ELO/.test(key)) fail("Feldgruppe '" + key + "': ELO... ist fuer Systemfelder reserviert.");
        if (!name) fail("Neues Feld " + key + ": name (Anzeigename) ist Pflicht.");
        var tab = f.reiter !== undefined ? reiterNr(f.reiter, namen) : -1, verschoben = [], row;
        if (f.nach !== undefined) {
          var nk = trim(f.nach).toUpperCase();
          if (!byKey[nk]) fail("nach: Feld " + nk + " gibt es in der Maske nicht.");
          if (tab < 0) tab = byKey[nk].getTabIndex();
        }
        if (tab < 0) tab = 0;
        if (!reiterName(namen, tab)) fail("Reiter " + tab + " hat keinen Namen (erschiene als 'Index" + tab + "'). Reiter: " + reiterUebersicht(namen) + ". Neuen Reiter erst mit elo_mask_tabs benennen.");
        row = f.nach !== undefined ? platzNach(lines, f.nach, tab, key, verschoben) : naechsteZeile(lines, tab, key);
        var nl = new IXC.DocMaskLine(), typ = f.typ === undefined ? 3000 : typNr(f.typ);
        var mx2 = f.max === undefined ? 255 : parseInt(f.max, 10);
        if (!(mx2 > 0 && mx2 <= 255)) fail("Feld " + key + ": max 1 bis 255.");
        var spalte = f.spalte !== undefined ? parseInt(f.spalte, 10) : spalteFuer(lines, tab, name, key);
        if (!(spalte >= 1 && spalte <= 80)) fail("Feld " + key + ": spalte 1 bis 80.");
        nl.setId(freieId(lines)); nl.setKey(key); nl.setName(name); nl.setType(typ);
        nl.setMin(0); nl.setMax(mx2);
        nl.setTabIndex(tab); nl.setLabelRow(row); nl.setEditRow(row);
        nl.setLabelCol(beschriftungsSpalte(lines, tab, key)); nl.setEditCol(spalte);
        nl.setOnlyBuzzwords(!!f.nurListe); nl.setRequired(!!f.pflicht);
        var rn = rechteAus(f.rechte, altLines, warn, key);
        nl.setAclItems(jarr("AclItem", rn.items)); nl.setAcl("");
        lines.push(nl); byKey[key] = nl; beruehrt[key] = true;
        var b = { feld: key, aktion: "neu (hinten angehaengt, Position " + (lines.length - 1) + ", ID " + nl.getId() + ")", name: name, typ: typText(typ),
                  reiter: tab + " " + reiterName(namen, tab), zeile: row, spalten: nl.getLabelCol() + "/" + spalte, max: mx2, rechte: rn.text };
        if (f.nurListe) b.nurListe = true;
        if (f.pflicht) b.pflicht = true;
        if (verschoben.length) b.daruntergerueckt = verschoben;
        bericht.push(b);
        if (f.nurListe) { var kw = keywordTexts(key); if (!kw || !kw.length) warn.push("Feld " + key + ": nur Stichwortliste, aber die Liste ist leer - das Feld laesst sich dann nicht fuellen. Liste vorher anlegen."); }
        continue;
      }
      if (f.nurListe !== undefined && !!f.nurListe !== !!l.isOnlyBuzzwords()) {
        ae.push("nur Stichwortliste " + (l.isOnlyBuzzwords() ? "ja" : "nein") + " -> " + (f.nurListe ? "ja" : "nein")); l.setOnlyBuzzwords(!!f.nurListe);
        if (f.nurListe) { var kw2 = keywordTexts(key); if (!kw2 || !kw2.length) warn.push("Feld " + key + ": nur Stichwortliste, aber die Liste ist leer - das Feld laesst sich dann nicht mehr fuellen."); }
      }
      if (f.pflicht !== undefined && !!f.pflicht !== !!l.isRequired()) { ae.push("Pflicht " + (l.isRequired() ? "ja" : "nein") + " -> " + (f.pflicht ? "ja" : "nein")); l.setRequired(!!f.pflicht); }
      if (f.rechte !== undefined) {
        var r2 = rechteAus(f.rechte, altLines, warn, key);
        if (aclSig(l.getAclItems()) !== aclSig(r2.items)) { ae.push("Rechte " + (aclListe(l.getAclItems()).join(", ") || "KEINE") + " -> " + r2.text); l.setAclItems(jarr("AclItem", r2.items)); l.setAcl(""); }
      }
      if (!ae.length) fail("Feld " + key + ": keine Aenderung - alles ist schon so.");
      beruehrt[key] = true;
      bericht.push({ feld: key, aktion: "aendern", aenderungen: ae });
    }
    m.setLines(jarr("DocMaskLine", lines));
    return { lines: lines, namen: namen, bericht: bericht, beruehrt: beruehrt, alle: false };
  };
}

/* ---------- elo_mask_tabs ---------- */

function reiterAnwenden(a) {
  return function (m, warn) {
    var lines = alsListe(m.getLines()), namen = reiterNamen(m.getText()), bericht = [], beruehrt = {}, byKey = {};
    for (var i = 0; i < lines.length; i++) byKey[keyOf(lines[i])] = lines[i];
    if (a.reiter === undefined && !(a.verschieben && a.verschieben.length) && !a.ordnen) fail("Nichts zu tun: reiter, verschieben oder ordnen angeben.");
    if (a.reiter !== undefined) {
      var neu = pruefeReiterNamen(a.reiter), alt = namen;
      for (var r = 0; r < Math.max(neu.length, alt.length); r++)
        if (reiterName(neu, r) !== reiterName(alt, r)) bericht.push({ reiter: r, bisher: reiterName(alt, r) || "(ohne Namen)", neu: reiterName(neu, r) || "(ohne Namen)" });
      namen = neu;
      for (var j = 0; j < lines.length; j++) if (!lines[j].isHidden() && !reiterName(namen, lines[j].getTabIndex()) && reiterName(alt, lines[j].getTabIndex())) beruehrt[keyOf(lines[j])] = true;
      m.setText(reiterText(namen));
    }
    var gesehen = {};
    for (var v = 0; a.verschieben && v < a.verschieben.length; v++) {
      var e = a.verschieben[v] || {}, key = trim(e.key).toUpperCase(), l = byKey[key], verschoben = [];
      if (!key) fail("verschieben[" + v + "]: key fehlt.");
      if (!l) fail("Feld " + key + " gibt es in der Maske nicht.");
      if (gesehen[key]) fail("Feld " + key + " steht zweimal in verschieben.");
      gesehen[key] = true;
      if (l.isHidden()) fail("Feld " + key + " ist versteckt.");
      var tab = e.reiter !== undefined ? reiterNr(e.reiter, namen) : -1;
      if (e.nach !== undefined) {
        var nk = trim(e.nach).toUpperCase();
        if (!byKey[nk]) fail("nach: Feld " + nk + " gibt es in der Maske nicht.");
        if (nk === key) fail("Feld " + key + ": nach sich selbst geht nicht.");
        if (tab < 0) tab = byKey[nk].getTabIndex();
      }
      if (tab < 0) fail("Feld " + key + ": reiter oder nach angeben.");
      if (!reiterName(namen, tab)) fail("Reiter " + tab + " hat keinen Namen (erschiene als 'Index" + tab + "'). Erst mit reiter benennen.");
      var altTab = l.getTabIndex(), altRow = l.getEditRow(), altCol = l.getEditCol();
      if (altTab === tab && e.nach === undefined) fail("Feld " + key + " liegt schon auf Reiter " + tab + ". Fuer einen anderen Platz nach angeben.");
      var row = e.nach !== undefined ? platzNach(lines, e.nach, tab, key, verschoben) : naechsteZeile(lines, tab, key);
      l.setTabIndex(tab); l.setLabelRow(row); l.setEditRow(row);
      if (altTab !== tab) { l.setLabelCol(beschriftungsSpalte(lines, tab, key)); l.setEditCol(spalteFuer(lines, tab, S(l.getName()), key)); }
      beruehrt[key] = true;
      var b = { feld: key, reiter: altTab + " " + (reiterName(namen, altTab) || "Index" + altTab) + " -> " + tab + " " + reiterName(namen, tab), zeile: altRow + " -> " + row };
      if (l.getEditCol() !== altCol) b.spalte = altCol + " -> " + l.getEditCol();
      if (verschoben.length) b.daruntergerueckt = verschoben;
      bericht.push(b);
    }
    if (a.ordnen) {
      var tabs = {};
      for (var k = 0; k < lines.length; k++) if (!lines[k].isHidden()) tabs[lines[k].getTabIndex()] = true;
      for (var t in tabs) {
        var aend = ordneReiter(lines, parseInt(t, 10));
        if (aend.length) bericht.push({ reiter: t + " " + (reiterName(namen, parseInt(t, 10)) || "Index" + t), geordnet: aend });
      }
    }
    if (!bericht.length) fail("Keine Aenderung - Reiter und Zeilen sind schon so.");
    m.setLines(jarr("DocMaskLine", lines));
    return { lines: lines, namen: namen, bericht: bericht, beruehrt: beruehrt, alle: !!a.ordnen };
  };
}

/* ---------- elo_mask_create ---------- */

function artAus(a, vorbild) {
  var art = trim(a.art);
  if (!art) art = vorbild.getDetails().isFolderMask() ? "ordner" : (vorbild.getDetails().isDocumentMask() ? "dokument" : "suche");
  if (["dokument", "ordner", "suche"].indexOf(art) < 0) fail("art: dokument, ordner oder suche.");
  return art;
}

function aufbauPlan(vorbild, a) {
  var vz = vorbild.getLines(), da = {}, auswahl = null, umbenennen = {};
  for (var i = 0; i < vz.length; i++) da[keyOf(vz[i])] = true;
  if (a.ohneFelder && a.felder && a.felder.length) fail("ohneFelder und felder zusammen geht nicht.");
  if (a.ohneFelder) auswahl = {};
  if (a.felder && a.felder.length) {
    auswahl = {};
    for (var k = 0; k < a.felder.length; k++) {
      var key = trim(a.felder[k]).toUpperCase();
      if (!da[key]) { var alle = []; for (var x in da) alle.push(x); fail("Feld " + key + " gibt es im Vorbild nicht. Felder: " + alle.join(", ")); }
      auswahl[key] = true;
    }
  }
  for (var n in (a.namen || {})) {
    var nk = trim(n).toUpperCase();
    if (!da[nk] || (auswahl && !auswahl[nk])) fail("namen: Feld " + nk + " wird nicht uebernommen.");
    if (!trim(a.namen[n])) fail("namen: leerer Name fuer " + nk + ".");
    umbenennen[nk] = trim(a.namen[n]);
  }
  return { namen: a.reiter !== undefined ? pruefeReiterNamen(a.reiter) : reiterNamen(vorbild.getText()), auswahl: auswahl, umbenennen: umbenennen, ohneFelder: !!a.ohneFelder };
}

/* Zeilen des Vorbilds fuer die neue Maske zurechtlegen: Auswahl, Namen, Reiter mit Namen, Rechte, Spalte, Zeilen je Reiter. */
function aufbauAnwenden(quelle, plan, rechteVorlage, warn) {
  var out = [];
  for (var i = 0; i < quelle.length; i++) {
    var l = quelle[i], key = keyOf(l);
    if (plan.auswahl && !plan.auswahl[key]) continue;
    if (plan.umbenennen[key] !== undefined) l.setName(plan.umbenennen[key]);
    if (!l.isHidden() && !reiterName(plan.namen, l.getTabIndex())) {
      warn.push("Feld " + key + " lag im Vorbild auf Reiter " + l.getTabIndex() + " ohne Namen (Index" + l.getTabIndex() + ") und kommt ans Ende von Reiter 0 '" + reiterName(plan.namen, 0) + "'.");
      l.setTabIndex(0); l.setLabelRow(1000 + i); l.setEditRow(1000 + i);
    }
    if (!hatRechte(l)) { l.setAclItems(jarr("AclItem", rechteVorlage.items)); l.setAcl(""); warn.push("Feld " + key + " hatte im Vorbild keine Rechte und bekommt " + rechteVorlage.text + "."); }
    if (!l.isHidden() && l.getEditCol() < S(l.getName()).length - 1) l.setEditCol(noetigeSpalte(l.getName()));
    out.push(l);
  }
  if (!out.length && !plan.ohneFelder) fail("Keine Felder uebrig.");
  var tabs = {};
  for (var k = 0; k < out.length; k++) if (!out[k].isHidden()) tabs[out[k].getTabIndex()] = true;
  for (var t in tabs) ordneReiter(out, parseInt(t, 10));
  return out;
}

function artSetzen(m, art, suchmaske) {
  var d = m.getDetails();
  d.setDocumentMask(art === "dokument");
  d.setFolderMask(art === "ordner");
  d.setSearchMask(art === "suche" ? true : suchmaske !== false);
  m.setDetails(d);
}

/* ---------- Werkzeuge ---------- */

tool("elo_mask",
  "Liest eine Verschlagwortungsmaske: Art, Reiter samt Namen, alle Felder in Maskenreihenfolge mit Typ, Reiter, Zeile, Spalten (Beschriftung/Eingabe), Laenge, nur Stichwortliste, Pflicht und Rechten. Dazu eine Layout-Pruefung: Reiter ohne Namen (erscheint als 'Index<n>'), Felder auf Reiter 0 vor Zeile 4, uebereinanderliegende Felder, Felder ohne Rechte, Klammern in Anzeigenamen, Luecken.",
  { maske: { type: "string", description: "Maskenname oder -ID, z. B. 'Rechnung' oder '42'" } },
  ["maske"], function (a) {
    var m = maskeHolen(a.maske, false), res = maskeBeschreiben(m);
    var lp = layoutPruefen(reiterNamen(m.getText()), alsListe(m.getLines()), {}, true);
    res.pruefung = { maengel: lp.fehler, hinweise: lp.hinweise };
    return res;
  });

var P_MASKE = { type: "string", description: "Maskenname oder -ID" };
var P_REITER = { description: "Reiternummer (0 = erster Reiter, meist 'Basis') oder Reitername", anyOf: [{ type: "integer" }, { type: "string" }] };
var P_RECHTE = { description: "Rechte der Zeile: 'wie' (Standard, wie die erste Zeile der Maske mit Rechten), 'jeder_lesen', 'jeder_schreiben' oder Liste [{\"name\": \"Buchhaltung\", \"rechte\": \"RW\"}] (R W D E L P oder 'voll')",
                 anyOf: [{ type: "string", enum: ["wie", "jeder_lesen", "jeder_schreiben"] },
                         { type: "array", items: { type: "object", properties: { name: { type: "string" }, rechte: { type: "string" } }, required: ["name"], additionalProperties: false } }] };

tool("elo_mask_create",
  "Legt eine neue Verschlagwortungsmaske als Kopie einer vorhandenen an (zweistufig, Stufe 3 bauen). Uebernimmt alle, ausgewaehlte oder keine Felder (ohneFelder) mit Feldgruppe, Typ, Rechten und Stichwortbindung, dazu Maskenrechte und Dokumentrechte-Vorgabe. Art Dokument-, Ordner- oder reine Suchmaske. Reiter nach Vorgabe, Felder von Reitern ohne Namen kommen auf Reiter 0, Zeilen je Reiter fortlaufend (Reiter 0 ab Zeile 4). Workflow beim Ablegen wird nicht uebernommen. Weitere Felder danach mit elo_mask_fields.",
  { name: { type: "string", description: "Name der neuen Maske" },
    vorbild: { type: "string", description: "Maske, die kopiert wird (Name oder ID)" },
    art: { type: "string", enum: ["dokument", "ordner", "suche"], description: "Standard: wie das Vorbild" },
    suchmaske: { type: "boolean", description: "Auch in der Suche anbieten, Standard ja" },
    reiter: { type: "array", items: { type: "string" }, description: "Reiternamen, Position = Reiternummer, z. B. [\"Basis\", \"Termine und Kosten\"]. Standard: wie das Vorbild" },
    felder: { type: "array", items: { type: "string" }, description: "Nur diese Feldgruppen uebernehmen (Reihenfolge wie im Vorbild). Standard: alle" },
    namen: { type: "object", additionalProperties: { type: "string" }, description: "Andere Anzeigenamen als im Vorbild, Feldgruppe -> Name (ohne Klammern)" },
    ohneFelder: { type: "boolean", description: "Keine Felder des Vorbilds uebernehmen, nur Rechte, Art und Reiter. Felder danach mit elo_mask_fields" },
    token: P_TOKEN },
  ["name", "vorbild"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_mask_create", a, function () {
      var name = trim(a.name), warn = [];
      if (!name) fail("name ist leer.");
      if (/^\d+$/.test(name)) fail("Maskenname nur aus Ziffern geht nicht (wuerde als ID gelesen).");
      var da = maskeDa(name);
      if (da) fail("Es gibt schon eine Maske '" + S(da.getName()) + "' [" + S(da.getId()) + "]. Aendern mit elo_mask_fields/elo_mask_tabs.");
      var vorbild = maskeHolen(a.vorbild, false), art = artAus(a, vorbild), plan = aufbauPlan(vorbild, a);
      var vz = alsListe(vorbild.getLines()), rechteVorlage = rechteAus("wie", vz, warn, "");
      var lines = aufbauAnwenden(vz, plan, rechteVorlage, warn);
      var lp = layoutPruefen(plan.namen, lines, {}, true);
      if (lp.fehler.length) fail("Regeln verletzt, nichts angelegt:\n- " + lp.fehler.join("\n- ") + "\n(Anzeigenamen mit namen aendern, Felder mit felder auswaehlen.)");
      for (var i = 0; i < lp.hinweise.length; i++) warn.push(lp.hinweise[i]);
      var d = vorbild.getDetails();
      if (d.getEncryptionSet()) warn.push("Vorbild verschluesselt mit Schluesselkreis " + d.getEncryptionSet() + " - die neue Maske ebenso.");
      if (vorbild.getFlowId() >= 0 || vorbild.getFlowId2() >= 0) warn.push("Workflow beim Ablegen des Vorbilds (" + vorbild.getFlowId() + "/" + vorbild.getFlowId2() + ") wird nicht uebernommen.");
      if (trim(vorbild.getIndex())) warn.push("Ablagedefinition des Vorbilds wird uebernommen: " + S(vorbild.getIndex()));
      warn.push("Im ELO Client erst nach Neuanmeldung sichtbar.");
      var felder = [];
      for (var k = 0; k < lines.length; k++) { var f = feldInfo(lines[k], plan.namen, k); delete f.id; felder.push(f); }
      return { vorschau: { aktion: "Maske anlegen", name: name, art: art + (art !== "suche" && a.suchmaske !== false ? " + Suchmaske" : ""),
                           vorbild: S(vorbild.getName()) + " [" + S(vorbild.getId()) + "]", reiter: reiterUebersicht(plan.namen),
                           nutzbarFuer: aclListe(vorbild.getAclItems()), dokumentRechteVorgabe: aclListe(vorbild.getDocAclItems()), felder: felder },
               warnungen: warn, fp: "neu|" + name + "|" + fpMaske(vorbild), vorbildId: S(vorbild.getId()), name: name, art: art, plan: plan };
    }, function (p) {
      var vorbild = maskeHolen(p.vorbildId, false), vz = alsListe(vorbild.getLines());
      var m = ELO.ix().createDocMask(p.vorbildId), basis = alsListe(m.getLines()), warn = [];
      var quelle = basis.length === vz.length ? basis : vz;
      if (quelle === vz) for (var q = 0; q < vz.length; q++) vz[q].setMaskId(m.getId());
      var lines = aufbauAnwenden(quelle, p.plan, rechteAus("wie", vz, warn, ""), warn);
      m.setName(p.name);
      m.setText(reiterText(p.plan.namen));
      m.setLines(jarr("DocMaskLine", lines));
      artSetzen(m, p.art, a.suchmaske);
      m.setFlowId(-1); m.setFlowId2(-1);
      var soll = { text: S(m.getText()), sig: [] };
      for (var j = 0; j < lines.length; j++) soll.sig.push(zeilenSig(lines[j]));
      var id = S(ELO.ix().checkinDocMask(m, DMC.mbAll, IXC.LockC.NO));
      cachesLeeren();
      var ist = maskeHolen(id, false), ab = rueckVergleich(soll, ist);
      return { maskeId: id, name: S(ist.getName()), guid: S(ist.getGuid()), art: maskenArt(ist), felder: ist.getLines().length, reiter: reiterUebersicht(reiterNamen(ist.getText())),
               rueckgelesen: ab.length ? "ABWEICHUNGEN" : "ok, alle Zeilen wie geplant", abweichungen: ab.length ? ab : undefined,
               sicherungNachher: sichereMaske(ist, "-angelegt"), hinweis: "Im ELO Client erst nach Neuanmeldung sichtbar." };
    });
  }, 3);

tool("elo_mask_fields",
  "Haengt Felder an eine Verschlagwortungsmaske an oder aendert vorhandene (zweistufig, Stufe 3 bauen, Sicherung vorher). Neue Felder immer hinten (die Reihenfolge bleibt, manche Programme zaehlen Felder nach Position), auf dem angegebenen Reiter in der naechsten freien Zeile (Reiter 0 ab Zeile 4) oder direkt unter 'nach'; Eingabefeld ab Spalte 14 bzw. weiter bei langer Beschriftung; Rechte wie die anderen Zeilen. Vorhandene Felder: Anzeigename, Typ, Laenge, Spalte, nur Stichwortliste, Pflicht, Rechte. Verschieben geht mit elo_mask_tabs.",
  { maske: P_MASKE,
    felder: { type: "array", description: "Felder, je Eintrag key (Feldgruppe) plus die Angaben, die gesetzt werden",
              items: { type: "object", additionalProperties: false, required: ["key"],
                       properties: { key: { type: "string", description: "Feldgruppe, z. B. KUENDFRIST" },
                                     name: { type: "string", description: "Anzeigename, ohne Klammern; Pflicht bei neuen Feldern" },
                                     typ: { type: "string", description: "text (Standard), datum, zahl, ganzzahl, betrag (2 Nachkommastellen), benutzer oder ELO-Typnummer" },
                                     reiter: P_REITER,
                                     nach: { type: "string", description: "Nur neue Felder: direkt unter diesem Feld anzeigen (gleicher Reiter)" },
                                     max: { type: "integer", description: "Hoechstlaenge 1-255, Standard 255" },
                                     spalte: { type: "integer", description: "Beginn des Eingabefelds (editCol), Standard 14 bzw. wie der Reiter, laenger bei langer Beschriftung" },
                                     nurListe: { type: "boolean", description: "Nur Werte aus der Stichwortliste" },
                                     pflicht: { type: "boolean" },
                                     rechte: P_RECHTE } } },
    token: P_TOKEN },
  ["maske", "felder"], function (a) {
    bauenPruefen();
    return maskenWerkzeug("elo_mask_fields", a, "Felder anhaengen/aendern", felderAnwenden(a));
  }, 3);

tool("elo_mask_tabs",
  "Reiter einer Verschlagwortungsmaske benennen, Felder auf einen anderen Reiter oder Platz verschieben und Zeilen ordnen (zweistufig, Stufe 3 bauen, Sicherung vorher). tabIndex ist die Reiternummer; die Namen stehen im Maskentext ('Basis|Termine und Kosten|||'), ein Reiter ohne Namen erscheint als 'Index<n>'. Die Reihenfolge der Zeilen in der Maske bleibt, es aendern sich nur Reiter, Zeile und Spalte der Anzeige. ordnen: Zeilen je Reiter lueckenlos ab 4 (Reiter 0) bzw. 1, sichtbare Reihenfolge bleibt; danach muss die ganze Maske die Regeln erfuellen.",
  { maske: P_MASKE,
    reiter: { type: "array", items: { type: "string" }, description: "Alle Reiternamen, Position = Reiternummer, z. B. [\"Basis\", \"Termine und Kosten\"]. Ersetzt die bisherigen Namen" },
    verschieben: { type: "array", description: "Felder auf einen Reiter (ans Ende) oder direkt unter ein anderes Feld",
                   items: { type: "object", additionalProperties: false, required: ["key"],
                            properties: { key: { type: "string" }, reiter: P_REITER, nach: { type: "string", description: "Direkt unter diesem Feld (dessen Reiter)" } } } },
    ordnen: { type: "boolean", description: "Zeilen aller Reiter lueckenlos neu nummerieren, sichtbare Reihenfolge bleibt" },
    token: P_TOKEN },
  ["maske"], function (a) {
    bauenPruefen();
    return maskenWerkzeug("elo_mask_tabs", a, "Reiter und Zeilen", reiterAnwenden(a));
  }, 3);

/* ---------- Stichwortlisten ---------- */
/*
 * Eine Stichwortliste (IX KeywordList) gehoert zu einer Feldgruppe; ihre ID ist die Feldgruppe (z. B. AW_SIGN_STATUS).
 * Die Eintraege haben IDs <Liste>\u00b6.AA, <Liste>\u00b6.AB ... und darunter je Ebene zwei Buchstaben mehr
 * (<Liste>\u00b6.AAAA). Hoechstens 676 Eintraege je Ebene (AA bis ZZ), 15 Ebenen.
 * Manche Listen liefern einen Wurzeleintrag "Stichwoerter fuer Feldgruppe ...", der wird beim Lesen weggelassen.
 * Loeschen einer ganzen Liste gibt es hier nicht.
 */
var KWC = IXC.KeywordC;
var KW_WURZEL = /^Stichw\u00f6rter f\u00fcr Feldgruppe/;
var KW_TRENNER = "\u00b6.";
var KW_ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* null nur, wenn es die Liste nicht gibt (ELOIX:5023 "nicht vorhanden"). Andere Fehler (Verbindung, Rechte, Sitzung)
   gehen weiter - sonst wuerde eine vorhandene Liste als "neu" geplant und beim Speichern ersetzt. */
function kwListeHolen(id) {
  try { return ELO.ix().checkoutKeywordList(S(id), KWC.mbEdit, KWC.MAX_CHILDREN, IXC.LockC.NO); }
  catch (e) {
    if (/ELOIX:5023\]/.test(S(e && e.javaException ? e.javaException : e))) return null;
    throw e;
  }
}

/* Listen-ID = Feldgruppe, wie bei den Masken in Grossbuchstaben (aus aw_sign_status wird AW_SIGN_STATUS). */
function kwId(v) {
  var id = trim(v).toUpperCase();
  if (!id) fail("liste ist leer.");
  if (!/^[A-Z0-9_]+$/.test(id)) fail("liste: nur Buchstaben, Ziffern und _ (meist die Feldgruppe).");
  return id;
}

/* Steuerzeichen und Nicht-ASCII in IDs als \uXXXX zeigen (die IDs enthalten ein Trennzeichen nach der Listen-ID). */
function kwIdLesbar(id) {
  return S(id).replace(/[^\x20-\x7e]/g, function (c) { return "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4); });
}

/* Eintraege der Liste ohne Wurzeleintrag. */
function kwEintraege(kl) {
  var ch = alsListe(kl.getChildren());
  if (ch.length === 1 && KW_WURZEL.test(S(ch[0].getText()))) return { wurzel: ch[0], liste: alsListe(ch[0].getChildren()) };
  return { wurzel: null, liste: ch };
}

function kwBaum(list, roh) {
  var out = [];
  for (var i = 0; list && i < list.length; i++) {
    var k = list[i], e = { text: S(k.getText()) };
    if (roh) e.id = kwIdLesbar(k.getId());
    if (!k.isEnabled()) e.nichtWaehlbar = true;
    if (k.isRaw()) e.roh = true;
    var ch = kwBaum(k.getChildren(), roh);
    if (ch.length) e.eintraege = ch;
    out.push(e);
  }
  return out;
}

function kwBeschreiben(kl, roh) {
  var ke = kwEintraege(kl);
  var res = { id: S(kl.getId()), guid: S(kl.getGuid()), anzeigename: S(kl.getDisplayName()) || undefined, paket: S(kl.getPackageName()) || undefined,
              eintraege: kwBaum(ke.liste, roh) };
  if (roh) { res.wurzel = ke.wurzel ? { id: kwIdLesbar(ke.wurzel.getId()), text: S(ke.wurzel.getText()) } : null; res.tstamp = S(kl.getTStamp()); }
  if (kl.getLockId() >= 0 && S(kl.getUserName())) res.gesperrtVon = S(kl.getUserName());
  return res;
}

/* Kurzform fuer Vorschau und Vergleich: "Text", Unterlisten als "Gruppe > Text". */
function kwFlach(baum, pfad, out) {
  out = out || [];
  for (var i = 0; i < baum.length; i++) {
    var p = (pfad ? pfad + " > " : "") + baum[i].text;
    out.push(p);
    if (baum[i].eintraege) kwFlach(baum[i].eintraege, p, out);
  }
  return out;
}

/* Eingabe pruefen: Liste aus Texten oder {text, eintraege}. Liefert [{text, eintraege}]. */
function kwEingabe(list, tiefe, pfad) {
  if (!list || !list.length) fail("eintraege fehlt oder ist leer" + (pfad ? " (unter '" + pfad + "')" : "") + ".");
  if (tiefe > KWC.MAX_TREE_DEPTH) fail("Mehr als " + KWC.MAX_TREE_DEPTH + " Ebenen.");
  if (list.length > 676) fail("Mehr als 676 Eintraege auf einer Ebene.");
  var out = [], da = {};
  for (var i = 0; i < list.length; i++) {
    var e = list[i], obj = (e && typeof e === "object") ? e : null;
    var text = trim(obj ? obj.text : e), unter = obj ? obj.eintraege : null;
    if (!text) fail("Leerer Eintrag an Stelle " + (i + 1) + (pfad ? " unter '" + pfad + "'" : "") + ".");
    if (text.length > 255) fail("Eintrag '" + text.substring(0, 40) + "...' laenger als 255 Zeichen.");
    if (da[text]) fail("Eintrag '" + text + "' doppelt" + (pfad ? " unter '" + pfad + "'" : "") + ".");
    da[text] = true;
    out.push({ text: text, eintraege: unter && unter.length ? kwEingabe(unter, tiefe + 1, (pfad ? pfad + " > " : "") + text) : null });
  }
  return out;
}

function kwNeuerKnoten(id, text) {
  var k = new IXC.Keyword();
  k.setId(id); k.setText(text); k.setEnabled(true); k.setRaw(false); k.setAdd(false);
  k.setChildren(jarr("Keyword", []));
  return k;
}

function kwFreieId(praefix, vorhanden) {
  var belegt = {};
  for (var i = 0; i < vorhanden.length; i++) belegt[S(vorhanden[i].getId())] = true;
  for (var n = 0; n < 676; n++) {
    var id = praefix + KW_ABC.charAt(Math.floor(n / 26)) + KW_ABC.charAt(n % 26);
    if (!belegt[id]) return id;
  }
  fail("Keine freie ID mehr unter " + kwIdLesbar(praefix) + ".");
}

/* Kinderliste einer Ebene bauen. alt: vorhandene Keyword-Objekte, soll: Eingabe, modus ergaenzen|ersetzen.
   Vorhandene Eintraege mit gleichem Text behalten ID und Eigenschaften. bericht sammelt hinzu/weg. */
function kwEbene(praefix, alt, soll, modus, pfad, bericht) {
  var nachText = {}, out = [], benutzt = {}, i;
  for (i = 0; i < alt.length; i++) nachText[S(alt[i].getText())] = alt[i];
  if (modus === "ergaenzen") for (i = 0; i < alt.length; i++) out.push(alt[i]);
  for (i = 0; i < soll.length; i++) {
    var s = soll[i], k = nachText[s.text], p = (pfad ? pfad + " > " : "") + s.text;
    if (!k) {
      k = kwNeuerKnoten(kwFreieId(praefix, alt.concat(out)), s.text);
      bericht.hinzu.push(p);
      out.push(k);
    } else if (modus === "ersetzen") out.push(k);
    benutzt[s.text] = true;
    if (s.eintraege) {
      k.setChildren(jarr("Keyword", kwEbene(S(k.getId()), alsListe(k.getChildren()), s.eintraege, modus, p, bericht)));
    } else if (modus === "ersetzen" && k.getChildren() && k.getChildren().length) {
      var weg = kwFlach(kwBaum(k.getChildren(), false), p);
      for (var w = 0; w < weg.length; w++) bericht.weg.push(weg[w]);
      k.setChildren(jarr("Keyword", []));
    }
  }
  if (modus === "ersetzen") {
    for (i = 0; i < alt.length; i++) {
      var t = S(alt[i].getText());
      if (benutzt[t]) continue;
      var wp = (pfad ? pfad + " > " : "") + t;
      bericht.weg.push(wp);
      var wu = kwFlach(kwBaum(alt[i].getChildren(), false), wp);
      for (var x = 0; x < wu.length; x++) bericht.weg.push(wu[x]);
    }
  }
  return out;
}

function kwPlan(a) {
  var id = kwId(a.liste);
  var modus = trim(a.modus) || "ergaenzen";
  if (modus !== "ergaenzen" && modus !== "ersetzen") fail("modus: ergaenzen oder ersetzen.");
  var soll = kwEingabe(a.eintraege, 1, "");
  var kl = kwListeHolen(id), neu = !kl, warn = [];
  if (neu) { kl = new IXC.KeywordList(); kl.setId(id); kl.setChildren(jarr("Keyword", [])); }
  if (id !== trim(a.liste)) warn.push("Listen-ID in Grossbuchstaben wie die Feldgruppe: " + id + ".");
  var altName = S(kl.getDisplayName()), altPaket = S(kl.getPackageName()), tstamp = S(kl.getTStamp());
  var gesperrt = !neu && kl.getLockId() >= 0 && S(kl.getUserName()) ? S(kl.getUserName()) : "";
  var ke = kwEintraege(kl), bisher = kwBaum(ke.liste, false), bericht = { hinzu: [], weg: [] };
  var praefix = ke.wurzel ? S(ke.wurzel.getId()) : id + KW_TRENNER;
  var kinder = kwEbene(praefix, ke.liste, soll, modus, "", bericht);
  if (ke.wurzel) ke.wurzel.setChildren(jarr("Keyword", kinder)); else kl.setChildren(jarr("Keyword", kinder));
  var meta = false;
  if (a.anzeigename !== undefined && trim(a.anzeigename) !== altName) { kl.setDisplayName(trim(a.anzeigename)); meta = true; }
  if (a.paket !== undefined && trim(a.paket) !== altPaket) { kl.setPackageName(trim(a.paket)); meta = true; }
  if (!neu && !bericht.hinzu.length && !bericht.weg.length && !meta) fail("Keine Aenderung - die Liste hat schon diese Eintraege.");
  if (bericht.weg.length) warn.push("Diese Eintraege fallen weg (schon verschlagwortete Werte bleiben in den Dokumenten stehen): " + bericht.weg.join(", "));
  if (gesperrt) warn.push("Liste ist gesperrt von " + gesperrt + ".");
  warn.push("Im ELO Client erst nach Neuanmeldung sichtbar.");
  return { id: id, neu: neu, kl: kl, bisher: bisher, nachher: kwBaum(kwEintraege(kl).liste, false), bericht: bericht, warn: warn,
           fp: "kw|" + id + "|" + (neu ? "neu" : tstamp + "|" + altName + "|" + altPaket + "|" + JSON.stringify(bisher)) };
}

function sichereKwListe(id, suffix) {
  var kl = kwListeHolen(id);
  if (!kl) return undefined;
  var f = new java.io.File(sicherungsOrdner(), "stichwortliste-" + id + "-" + zeitstempel() + suffix + ".json");
  var w = new java.io.OutputStreamWriter(new java.io.FileOutputStream(f), "UTF-8");
  try { w.write(JSON.stringify(kwBeschreiben(kl, true), null, 1)); } finally { w.close(); }
  return S(f.getAbsolutePath());
}

tool("elo_keywords",
  "Liest eine Stichwortliste (ID = Feldgruppe, z. B. AW_SIGN_STATUS): Anzeigename, Paket, Eintraege als Baum (text, nichtWaehlbar = nur Gruppe, eintraege = Unterliste). Ein Wurzeleintrag 'Stichwoerter fuer Feldgruppe ...' wird weggelassen. roh zeigt zusaetzlich die IDs.",
  { liste: { type: "string", description: "ID der Stichwortliste, meist die Feldgruppe, z. B. AW_SIGN_STATUS" },
    roh: { type: "boolean", description: "Auch interne IDs, Wurzeleintrag und Zeitstempel zeigen" } },
  ["liste"], function (a) {
    var roh = trim(a.liste);
    if (!roh) fail("liste ist leer.");
    /* Feldgruppen stehen in Grossbuchstaben; eine Liste mit anderer Schreibweise wird zur Not wie angegeben gelesen. */
    var id = roh.toUpperCase(), kl = kwListeHolen(id);
    if (!kl && id !== roh) { kl = kwListeHolen(roh); if (kl) id = roh; }
    if (!kl) return { liste: id, vorhanden: false };
    var res = kwBeschreiben(kl, !!a.roh);
    res.vorhanden = true;
    return res;
  });

tool("elo_keywords_set",
  "Legt eine Stichwortliste an oder setzt ihre Eintraege (zweistufig, Stufe 3 bauen, Sicherung vorher). ID = Feldgruppe des Maskenfelds (z. B. AW_SIGN_STATUS), wird in Grossbuchstaben gesetzt. modus ergaenzen (Standard): fehlende Eintraege hinten anhaengen, vorhandene bleiben. modus ersetzen: die Liste besteht danach genau aus den angegebenen Eintraegen in dieser Reihenfolge, vorhandene mit gleichem Text behalten ihre ID. Unterlisten als {text, eintraege}. Eine ganze Liste loeschen geht nicht.",
  { liste: { type: "string", description: "ID der Stichwortliste, meist die Feldgruppe, z. B. AW_SIGN_STATUS" },
    eintraege: { type: "array", description: "Eintraege: Texte oder {\"text\": \"Gruppe\", \"eintraege\": [...]}",
                 items: { anyOf: [{ type: "string" }, { type: "object", properties: { text: { type: "string" }, eintraege: { type: "array" } }, required: ["text"] }] } },
    modus: { type: "string", enum: ["ergaenzen", "ersetzen"], description: "Standard ergaenzen" },
    anzeigename: { type: "string", description: "Optional: Anzeigename der Liste" },
    paket: { type: "string", description: "Optional: Paketname (packageName), z. B. fuer ein ELO-Paket" },
    token: P_TOKEN },
  ["liste", "eintraege"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_keywords_set", a, function () {
      var p = kwPlan(a);
      return { vorschau: { aktion: p.neu ? "Stichwortliste anlegen" : "Stichwortliste aendern (" + (trim(a.modus) || "ergaenzen") + ")", liste: p.id,
                           anzeigename: a.anzeigename !== undefined ? trim(a.anzeigename) : undefined, paket: a.paket !== undefined ? trim(a.paket) : undefined,
                           bisher: p.neu ? "neu" : kwFlach(p.bisher), hinzu: p.bericht.hinzu, weg: p.bericht.weg, nachher: kwFlach(p.nachher) },
               warnungen: p.warn, fp: p.fp };
    }, function () {
      var p = kwPlan(a), sicherung = p.neu ? undefined : sichereKwListe(p.id, "-vorher");
      ELO.ix().checkinKeywordList(p.kl, IXC.LockC.NO);
      var ist = kwListeHolen(p.id);
      if (!ist) fail("Nach dem Speichern nicht lesbar: " + p.id);
      var soll = kwFlach(p.nachher), istF = kwFlach(kwBaum(kwEintraege(ist).liste, false)), gleich = istF.join("\n") === soll.join("\n");
      return { liste: p.id, guid: S(ist.getGuid()), angelegt: p.neu || undefined, eintraege: istF,
               rueckgelesen: gleich ? "ok, wie geplant" : "ABWEICHUNG", soll: gleich ? undefined : soll,
               sicherungVorher: sicherung, sicherungNachher: sichereKwListe(p.id, "-nachher"), hinweis: "Im ELO Client erst nach Neuanmeldung sichtbar." };
    });
  }, 3);
