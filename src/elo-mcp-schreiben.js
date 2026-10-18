/*
 * elo-mcp-schreiben.js - Stufe 2 des ELO-MCP-Servers: arbeiten (ablegen, Version,
 * Indexfelder, Workflow starten, Aufgabe weiterleiten). Wird nach elo-mcp.js geladen.
 *
 * Jedes Werkzeug arbeitet zweistufig:
 *   1. Aufruf ohne token  -> Pruefung + Vorschau + token (5 Minuten gueltig, einmal benutzbar)
 *   2. Aufruf mit token   -> dieselben Argumente, Zustand wird neu gelesen und mit der
 *                            Vorschau verglichen (Fingerabdruck); nur bei Gleichheit wird ausgefuehrt.
 * Nichts loescht, nichts verschiebt, keine Rechte- oder Maskenaenderung.
 *
 * Nur mit ELO_MCP_SCHREIBEN=1 (Schalter -Schreiben in elo-mcp.ps1); sonst stehen die
 * Werkzeuge nicht in der Liste. Die bauenden Werkzeuge (Stufe 3) nutzen denselben Ablauf.
 * Jede Ausfuehrung wird lokal protokolliert: %LOCALAPPDATA%\elo-mcp\protokoll-JJJJ-MM.jsonl
 */

// Hausregel mancher Archive: Datum in Textfeldern als JJJJMMTT (Schalter -TextDatumJJJJMMTT).
var TEXTDATUM_JJJJMMTT = envFlag("ELO_MCP_TEXTDATUM", "JJJJMMTT");
var TOKEN_MS = 5 * 60 * 1000;
var LIMIT_UPLOAD = 50 * 1024 * 1024;
var PENDING = {};

/* ---------- Protokoll ---------- */

function protokoll(eintrag) {
  try {
    var dir = new java.io.File(S(java.lang.System.getenv("LOCALAPPDATA")) || S(java.lang.System.getProperty("java.io.tmpdir")), "elo-mcp");
    dir.mkdirs();
    var monat = S(new java.text.SimpleDateFormat("yyyy-MM").format(new java.util.Date()));
    eintrag.zeit = S(new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss").format(new java.util.Date()));
    try { eintrag.konto = S(ELO.connect().getLoginResult().getUser().getName()); } catch (e) {}
    eintrag.server = S(java.lang.System.getenv("ELO_IX_URL"));
    if (ARCHIV_NAME) eintrag.archiv = ARCHIV_NAME;
    var w = new java.io.OutputStreamWriter(new java.io.FileOutputStream(new java.io.File(dir, "protokoll-" + monat + ".jsonl"), true), "UTF-8");
    try { w.write(JSON.stringify(eintrag) + "\n"); } finally { w.close(); }
  } catch (e) { log("Protokoll nicht geschrieben: " + e); }
}

/* ---------- Zwei-Schritt-Ablauf ---------- */

function argsKey(a) {
  var keys = [], o = {};
  for (var k in a) if (k !== "token") keys.push(k);
  keys.sort();
  for (var i = 0; i < keys.length; i++) o[keys[i]] = a[keys[i]];
  return JSON.stringify(o);
}

function zweiSchritte(name, a, pruefen, ausfuehren) {
  var st = HANDLERS[name] ? HANDLERS[name].stufe : 2;
  if (!stufeFrei(st)) fail("Werkzeug " + name + freischaltHinweis(st));
  var plan = pruefen(a), key = argsKey(a);
  if (!a.token) {
    var tok = S(java.util.UUID.randomUUID()).substring(0, 13);
    for (var t in PENDING) if (PENDING[t].ablauf < java.lang.System.currentTimeMillis()) delete PENDING[t];
    PENDING[tok] = { name: name, key: key, fp: plan.fp, ablauf: java.lang.System.currentTimeMillis() + TOKEN_MS };
    return { modus: "Vorschau - noch nichts geaendert", archiv: ARCHIV_NAME || undefined, vorschau: plan.vorschau, warnungen: plan.warnungen || [], token: tok,
             naechsterSchritt: "Vorschau dem Anwender zeigen. Nach Zustimmung dasselbe Werkzeug mit denselben Argumenten und token=\"" + tok + "\" aufrufen. Gueltig 5 Minuten, einmal." };
  }
  var p = PENDING[S(a.token)];
  delete PENDING[S(a.token)];
  if (!p) fail("token unbekannt oder schon benutzt. Bitte neue Vorschau holen (Aufruf ohne token).");
  if (p.ablauf < java.lang.System.currentTimeMillis()) fail("token abgelaufen. Bitte neue Vorschau holen.");
  if (p.name !== name || p.key !== key) fail("Argumente weichen von der Vorschau ab. Bitte neue Vorschau holen.");
  if (p.fp !== plan.fp) fail("Das Objekt hat sich seit der Vorschau geaendert. Bitte neue Vorschau holen.");
  var res;
  try { res = ausfuehren(plan); }
  catch (e) { protokoll({ werkzeug: name, argumente: JSON.parse(key), fehler: errText(e) }); throw e; }
  protokoll({ werkzeug: name, argumente: JSON.parse(key), ergebnis: res });
  return { modus: "ausgefuehrt", archiv: ARCHIV_NAME || undefined, ergebnis: res };
}

/* ---------- Masken und Felder ---------- */

var maskObjCache = {};
function maskOf(maskId) {
  var k = S(maskId);
  if (!maskObjCache[k]) {
    try { maskObjCache[k] = ELO.ix().checkoutDocMask(k, IXC.DocMaskC.mbAll, IXC.LockC.NO); }
    catch (e) { fail("Maske nicht gefunden: " + k); }
  }
  return maskObjCache[k];
}

function keywordTexts(group) {
  var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("java.lang.String"), 1), out = [];
  arr[0] = S(group);
  try {
    var kws = ELO.ix().checkoutKeywords(arr, IXC.KeywordC.mbEdit, 2000, IXC.LockC.NO);
    (function walk(list) { for (var i = 0; list && i < list.length; i++) { var tx = S(list[i].getText()); if (tx && !/^Stichw\u00f6rter f\u00fcr Feldgruppe/.test(tx)) out.push(tx); walk(list[i].getChildren()); } })(kws);
  } catch (e) { return null; }
  return out;
}

var T = IXC.DocMaskLineC;

/* Datumseingabe -> JJJJMMTT; null, wenn kein Datum. Prueft auch, ob es den Tag gibt (31.02. nicht). */
function datum8(v) {
  var m, y, mo, d;
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v))) { d = m[1]; mo = m[2]; y = m[3]; }
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) { y = m[1]; mo = m[2]; d = m[3]; }
  else if ((m = /^(\d{4})(\d{2})(\d{2})(\d{6})?$/.exec(v))) { y = m[1]; mo = m[2]; d = m[3]; }
  else return null;
  var dt = new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
  if (dt.getFullYear() !== parseInt(y, 10) || dt.getMonth() !== parseInt(mo, 10) - 1 || dt.getDate() !== parseInt(d, 10)) return null;
  return y + ("0" + mo).slice(-2) + ("0" + d).slice(-2);
}

function normValue(line, v, warn) {
  v = trim(v);
  if (v === "") return "";
  var t = line.getType(), key = S(line.getKey());
  if (t === T.TYPE_ISO_DATE || t === T.TYPE_DATE) {
    var d = datum8(v);
    if (d === null) fail("Feld " + key + ": gueltiges Datum erwartet (TT.MM.JJJJ, JJJJ-MM-TT oder JJJJMMTT), bekommen '" + v + "'.");
    return d + "000000";
  }
  if (TEXTDATUM_JJJJMMTT && t === T.TYPE_TEXT && /DAT(UM)?$/.test(key)) {
    // Textfeld mit Datum nach Hausregel JJJJMMTT (Feldname endet auf DAT/DATUM); ELO selbst prueft hier nichts.
    var d2 = datum8(v);
    if (d2 !== null) v = d2;
    else warn.push("Feld " + key + " ist ein Textfeld, das ueblicherweise ein Datum JJJJMMTT enthaelt - '" + v + "' ist kein gueltiges Datum.");
  }
  if (t === T.TYPE_INTEGER || t === T.TYPE_LONG) { if (!/^-?\d+$/.test(v)) fail("Feld " + key + ": ganze Zahl erwartet, bekommen '" + v + "'."); }
  if (t === T.TYPE_NUMBER || t === T.TYPE_FLOAT || t === T.TYPE_DOUBLE || (t >= T.TYPE_NUMBER_F0 && t <= T.TYPE_NUMBER_F6)) {
    if (!/^-?[\d.]*\d(,\d+)?$|^-?\d+(\.\d+)?$/.test(v)) fail("Feld " + key + ": Zahl erwartet, bekommen '" + v + "'.");
  }
  if (line.getMax() > 0 && v.length > line.getMax()) fail("Feld " + key + ": hoechstens " + line.getMax() + " Zeichen, bekommen " + v.length + ".");
  if (line.isOnlyBuzzwords()) {
    var kw = keywordTexts(line.getKey());
    if (kw && kw.length && kw.indexOf(v) < 0) fail("Feld " + key + ": nur Werte aus der Stichwortliste erlaubt. Erlaubt: " + kw.slice(0, 40).join(" | ") + (kw.length > 40 ? " ..." : ""));
  }
  return v;
}

/* Prueft felder gegen die Maske; liefert [{line, key, label, wert}] */
function pruefeFelder(maskId, felder, warn) {
  warn = warn || [];
  var res = [], lines = maskOf(maskId).getLines(), byKey = {};
  for (var i = 0; i < lines.length; i++) byKey[S(lines[i].getKey())] = lines[i];
  for (var k in (felder || {})) {
    var line = byKey[S(k)];
    if (!line) {
      var bekannte = []; for (var b in byKey) bekannte.push(b);
      fail("Feld " + k + " gibt es in Maske " + S(maskOf(maskId).getName()) + " nicht. Felder: " + bekannte.join(", "));
    }
    res.push({ line: line, key: S(k), label: S(line.getName()), wert: normValue(line, felder[k], warn) });
  }
  return res;
}

function pflichtFehlt(maskId, gesetzt) {
  var lines = maskOf(maskId).getLines(), fehlt = [];
  for (var i = 0; i < lines.length; i++) {
    var req = false; try { req = !!lines[i].isRequired(); } catch (e) {}
    if (req && !gesetzt[S(lines[i].getKey())]) fehlt.push(S(lines[i].getName()) + " (" + S(lines[i].getKey()) + ")");
  }
  return fehlt;
}

function setzeFelder(sord, felder) {
  var keys = sord.getObjKeys(), liste = new java.util.ArrayList();
  for (var i = 0; keys && i < keys.length; i++) liste.add(keys[i]);
  for (var j = 0; j < felder.length; j++) {
    var f = felder[j], ok = null;
    for (var i = 0; i < liste.size(); i++) if (S(liste.get(i).getName()) === f.key) ok = liste.get(i);
    if (ok === null) { ok = new IXC.ObjKey(); ok.setName(f.key); ok.setId(f.line.getId()); liste.add(ok); }
    var data = java.lang.reflect.Array.newInstance(java.lang.Class.forName("java.lang.String"), f.wert === "" ? 0 : 1);
    if (f.wert !== "") data[0] = f.wert;
    ok.setData(data);
  }
  var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.ObjKey"), liste.size());
  for (var i = 0; i < liste.size(); i++) arr[i] = liste.get(i);
  sord.setObjKeys(arr);
}

function felderVorschau(felder, alt) {
  var out = [];
  for (var i = 0; i < felder.length; i++) {
    var o = { feld: felder[i].key, bezeichnung: felder[i].label, neu: felder[i].wert === "" ? "(leer)" : felder[i].wert };
    if (alt) o.bisher = alt[felder[i].key] !== undefined ? alt[felder[i].key] : "(leer)";
    out.push(o);
  }
  return out;
}

function fingerprintSord(s) {
  var f = indexFields(s), parts = [S(s.getId()), S(s.getName()), S(s.getMaskName()), S(s.getLockId()), S(s.getParentId())];
  for (var i = 0; i < f.length; i++) parts.push(f[i].feld + "=" + JSON.stringify(f[i].wert));
  return parts.join("|");
}

function namensgleiche(parentId, name) {
  var fi = new IXC.FindInfo(), fb = new IXC.FindByIndex(), fc = new IXC.FindChildren();
  fb.setName(name); fi.setFindByIndex(fb); fc.setParentId(S(parentId)); fc.setEndLevel(1); fi.setFindChildren(fc);
  var r = findSords(fi, 5, IXC.SordC.mbLean), out = [];
  for (var i = 0; i < r.sords.length; i++) if (S(r.sords[i].getName()) === name) out.push(S(r.sords[i].getId()));
  return out;
}

function lokaleDatei(pfad) {
  var f = new java.io.File(S(pfad));
  if (!f.isFile()) fail("Lokale Datei nicht gefunden: " + S(pfad));
  if (f.length() > LIMIT_UPLOAD) fail("Datei groesser als " + (LIMIT_UPLOAD / 1048576) + " MB.");
  var n = S(f.getName()), p = n.lastIndexOf(".");
  return { file: f, name: p > 0 ? n.substring(0, p) : n, ext: p > 0 ? n.substring(p + 1).toLowerCase() : "", bytes: Number(f.length()),
           md5: S(java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("MD5").digest(java.nio.file.Files.readAllBytes(f.toPath())))).toUpperCase() };
}

function unlockSord(id) { try { var s = new IXC.Sord(); s.setId(parseInt(S(id), 10)); ELO.ix().checkinSord(s, IXC.SordC.mbOnlyUnlock, IXC.LockC.YES); } catch (e) { log("Entsperren " + id + " fehlgeschlagen: " + e); } }

function ordnerPruefen(id) {
  var o = sordOf(id);
  if (!isFolder(o)) fail("Kein Ordner: " + S(o.getName()) + " [" + S(o.getId()) + "]");
  return o;
}

var P_TOKEN = { type: "string", description: "Leer lassen fuer die Vorschau. Zum Ausfuehren das token aus der Vorschau." };
var P_FELDER = { type: "object", additionalProperties: { type: "string" }, description: "Feldgruppe -> Wert, z. B. {\"DOKUMENTART\": \"Vertrag\"}. Datum als TT.MM.JJJJ. Leerer Text leert das Feld." };

/* ---------- Werkzeuge ---------- */

tool("elo_create_folder", "Legt einen Ordner an (zweistufig: Vorschau, dann mit token ausfuehren). Maske muss eine Ordnermaske sein.",
  { eltern: { type: "string", description: "Elternordner (ID, GUID oder Pfad)" }, name: { type: "string" },
    maske: { type: "string", description: "Ordnermaske (Name oder ID), Standard: Maske des Elternordners, falls das eine Ordnermaske ist" },
    felder: P_FELDER, token: P_TOKEN },
  ["eltern", "name"], function (a) {
    return zweiSchritte("elo_create_folder", a, function () {
      var eltern = ordnerPruefen(a.eltern), name = trim(a.name), warn = [];
      if (!name) fail("name ist leer.");
      var maske = trim(a.maske) || (maskOf(eltern.getMask()).getDetails().isFolderMask() ? S(eltern.getMaskName()) : "");
      if (!maske) fail("Die Maske des Elternordners (" + S(eltern.getMaskName()) + ") ist keine Ordnermaske - bitte maske angeben.");
      if (!maskOf(maske).getDetails().isFolderMask()) fail("Maske " + maske + " ist keine Ordnermaske.");
      var felder = pruefeFelder(maske, a.felder, warn), gesetzt = {};
      for (var i = 0; i < felder.length; i++) if (felder[i].wert !== "") gesetzt[felder[i].key] = true;
      var gleich = namensgleiche(eltern.getId(), name);
      if (gleich.length) warn.push("Im Elternordner gibt es schon '" + name + "' (" + gleich.join(", ") + ").");
      var pf = pflichtFehlt(maske, gesetzt); if (pf.length) warn.push("Pflichtfelder leer: " + pf.join(", "));
      return { vorschau: { aktion: "Ordner anlegen", in: pathOf(eltern) + "/" + S(eltern.getName()) + " [" + S(eltern.getId()) + "]", name: name, maske: S(maskOf(maske).getName()), felder: felderVorschau(felder) },
               warnungen: warn, fp: S(eltern.getId()) + "|" + gleich.join(","), eltern: eltern, name: name, maske: maske, felder: felder };
    }, function (p) {
      var s = ELO.ix().createSord(S(p.eltern.getId()), S(p.maske), IXC.EditInfoC.mbSord).getSord();
      s.setName(p.name); setzeFelder(s, p.felder);
      var id = S(ELO.ix().checkinSord(s, IXC.SordC.mbAll, IXC.LockC.NO));
      return { id: id, name: p.name, link: link(sordOf(id)) };
    });
  }, 2);

tool("elo_create_document", "Legt eine lokale Datei als neues Dokument in einem Ordner ab (zweistufig). Maske muss eine Dokumentmaske sein.",
  { ordner: { type: "string", description: "Zielordner (ID, GUID oder Pfad)" },
    datei: { type: "string", description: "Vollstaendiger lokaler Dateipfad, z. B. C:\\Users\\...\\Rechnung.pdf" },
    name: { type: "string", description: "Kurzbezeichnung, Standard: Dateiname ohne Endung" },
    maske: { type: "string", description: "Dokumentmaske (Name oder ID), Standard 0 (Freie Eingabe)" },
    felder: P_FELDER, kommentar: { type: "string", description: "Versionskommentar (max. 64 Zeichen)" }, token: P_TOKEN },
  ["ordner", "datei"], function (a) {
    return zweiSchritte("elo_create_document", a, function () {
      var ordner = ordnerPruefen(a.ordner), d = lokaleDatei(a.datei), name = trim(a.name) || d.name, warn = [];
      var maske = trim(a.maske) || "0";
      if (!maskOf(maske).getDetails().isDocumentMask()) fail("Maske " + maske + " ist keine Dokumentmaske (ELO wuerde das erst bei der naechsten Version ablehnen).");
      var kommentar = trim(a.kommentar) || "abgelegt ueber ELO-MCP";
      if (kommentar.length > 64) fail("Versionskommentar hoechstens 64 Zeichen.");
      var felder = pruefeFelder(maske, a.felder, warn), gesetzt = {};
      for (var i = 0; i < felder.length; i++) if (felder[i].wert !== "") gesetzt[felder[i].key] = true;
      var gleich = namensgleiche(ordner.getId(), name);
      if (gleich.length) warn.push("Im Ordner gibt es schon '" + name + "' (" + gleich.join(", ") + "). Fuer eine neue Version elo_new_version nehmen.");
      var pf = pflichtFehlt(maske, gesetzt); if (pf.length) warn.push("Pflichtfelder leer: " + pf.join(", "));
      if (!d.ext) warn.push("Datei ohne Endung.");
      return { vorschau: { aktion: "Dokument ablegen", in: pathOf(ordner) + "/" + S(ordner.getName()) + " [" + S(ordner.getId()) + "]", name: name,
                           maske: S(maskOf(maske).getName()), datei: S(d.file.getAbsolutePath()), bytes: d.bytes, endung: d.ext, kommentar: kommentar, felder: felderVorschau(felder) },
               warnungen: warn, fp: S(ordner.getId()) + "|" + gleich.join(",") + "|" + d.md5, ordner: ordner, datei: d, name: name, maske: maske, felder: felder, kommentar: kommentar };
    }, function (p) {
      var ed = ELO.ix().createDoc(S(p.ordner.getId()), S(p.maske), null, IXC.EditInfoC.mbSordDoc), s = ed.getSord();
      s.setName(p.name); setzeFelder(s, p.felder);
      var dv = new IXC.DocVersion(); dv.setExt(p.datei.ext); dv.setComment(p.kommentar);
      var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.DocVersion"), 1); arr[0] = dv;
      var doc = ed.getDocument(); doc.setDocs(arr);
      doc = ELO.ix().checkinDocBegin(doc);
      doc.getDocs()[0].setUploadResult(ELO.connect().upload(doc.getDocs()[0].getUrl(), p.datei.file));
      doc = ELO.ix().checkinDocEnd(s, IXC.SordC.mbAll, doc, IXC.LockC.NO);
      var id = S(doc.getObjId());
      return { id: id, name: p.name, versionId: S(doc.getDocs()[0].getId()), link: link(sordOf(id)) };
    });
  }, 2);

tool("elo_new_version", "Legt eine lokale Datei als neue Version auf ein vorhandenes Dokument (zweistufig). Die alte Version bleibt erhalten.",
  { objekt: P_OBJ, datei: { type: "string", description: "Vollstaendiger lokaler Dateipfad" },
    kommentar: { type: "string", description: "Versionskommentar, Pflicht, max. 64 Zeichen" }, token: P_TOKEN },
  ["objekt", "datei", "kommentar"], function (a) {
    return zweiSchritte("elo_new_version", a, function () {
      var v = versionsOf(a.objekt), s = v.sord, d = lokaleDatei(a.datei), warn = [], akt = null;
      if (isFolder(s)) fail("Ordner haben keine Versionen.");
      var kommentar = trim(a.kommentar);
      if (!kommentar) fail("kommentar ist Pflicht."); if (kommentar.length > 64) fail("Versionskommentar hoechstens 64 Zeichen.");
      if (S(s.getLockName())) fail("Dokument ist gesperrt von " + S(s.getLockName()) + ".");
      for (var i = 0; i < v.docs.length; i++) if (v.docs[i].isWorkVersion()) akt = v.docs[i];
      if (akt && S(akt.getMd5()).toUpperCase() === d.md5) fail("Die Datei ist identisch mit der aktuellen Version.");
      if (akt && d.ext && S(akt.getExt()).toLowerCase() !== d.ext) warn.push("Endung aendert sich von ." + S(akt.getExt()) + " auf ." + d.ext + ".");
      return { vorschau: { aktion: "neue Version", dokument: S(s.getName()) + " [" + S(s.getId()) + "]", pfad: pathOf(s), bisherigeVersionen: v.docs.length,
                           aktuell: akt ? versionInfo(akt) : null, neueDatei: S(d.file.getAbsolutePath()), bytes: d.bytes, kommentar: kommentar },
               warnungen: warn, fp: fingerprintSord(s) + "|" + (akt ? S(akt.getId()) : "") + "|" + d.md5, sord: s, akt: akt, datei: d, kommentar: kommentar };
    }, function (p) {
      var id = S(p.sord.getId());
      var ed = ELO.ix().checkoutDoc(id, null, IXC.EditInfoC.mbAll, IXC.LockC.YES);
      try {
        var dv = new IXC.DocVersion(); dv.setExt(p.datei.ext || (p.akt ? S(p.akt.getExt()) : "")); dv.setComment(p.kommentar);
        if (p.akt) dv.setPathId(p.akt.getPathId());
        var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.DocVersion"), 1); arr[0] = dv;
        var doc = ed.getDocument(); doc.setDocs(arr);
        doc = ELO.ix().checkinDocBegin(doc);
        doc.getDocs()[0].setUploadResult(ELO.connect().upload(doc.getDocs()[0].getUrl(), p.datei.file));
        doc = ELO.ix().checkinDocEnd(ed.getSord(), IXC.SordC.mbAll, doc, IXC.LockC.YES);
        return { id: id, name: S(p.sord.getName()), neueVersionId: S(doc.getDocs()[0].getId()) };
      } catch (e) { unlockSord(id); throw e; }
    });
  }, 2);

tool("elo_set_fields", "Setzt Indexfelder und/oder die Kurzbezeichnung eines Objekts (zweistufig). Prueft Feldnamen, Datum, Zahl, Laenge und Stichwortlisten gegen die Maske.",
  { objekt: P_OBJ, felder: P_FELDER, name: { type: "string", description: "Neue Kurzbezeichnung (optional)" }, token: P_TOKEN },
  ["objekt"], function (a) {
    return zweiSchritte("elo_set_fields", a, function () {
      var s = sordOf(a.objekt), warn = [];
      if (S(s.getLockName())) fail("Objekt ist gesperrt von " + S(s.getLockName()) + ".");
      var felder = pruefeFelder(s.getMask(), a.felder, warn), name = trim(a.name);
      if (!felder.length && !name) fail("Weder felder noch name angegeben.");
      var alt = {}, f = indexFields(s);
      for (var i = 0; i < f.length; i++) alt[f[i].feld] = f[i].wert;
      var aenderung = [];
      for (var i = 0; i < felder.length; i++) if (S(alt[felder[i].key] || "") !== felder[i].wert) aenderung.push(felder[i]);
      if (!aenderung.length && (!name || name === S(s.getName()))) fail("Keine Aenderung - alle Werte sind schon so.");
      var v = { aktion: "Indexfelder setzen", objekt: S(s.getName()) + " [" + S(s.getId()) + "]", maske: S(s.getMaskName()), felder: felderVorschau(aenderung, alt) };
      if (name && name !== S(s.getName())) v.name = { bisher: S(s.getName()), neu: name };
      return { vorschau: v, warnungen: warn, fp: fingerprintSord(s), sord: s, felder: aenderung, name: name };
    }, function (p) {
      var id = S(p.sord.getId());
      var s = ELO.ix().checkoutSord(id, IXC.EditInfoC.mbSord, IXC.LockC.YES).getSord();
      try {
        if (p.name) s.setName(p.name);
        setzeFelder(s, p.felder);
        ELO.ix().checkinSord(s, IXC.SordC.mbAll, IXC.LockC.YES);
      } catch (e) { unlockSord(id); throw e; }
      var n = sordOf(id);
      return { id: id, name: S(n.getName()), felder: indexFields(n) };
    });
  }, 2);

function vorlageFinden(v) {
  v = trim(v);
  if (!v) fail("vorlage fehlt.");
  try { return ELO.ix().checkoutWorkFlow(v, IXC.WFTypeC.TEMPLATE, IXC.WFDiagramC.mbLean, IXC.LockC.NO); }
  catch (e) { fail("Workflow-Vorlage nicht gefunden: " + v + " (ID oder exakter Name, siehe elo_workflow_templates)"); }
}

tool("elo_start_workflow", "Startet einen Workflow aus einer Vorlage auf einem Objekt (zweistufig).",
  { objekt: P_OBJ, vorlage: { type: "string", description: "Vorlagen-ID oder exakter Vorlagenname" },
    titel: { type: "string", description: "Name des Workflows, Standard: Kurzbezeichnung des Objekts" }, token: P_TOKEN },
  ["objekt", "vorlage"], function (a) {
    return zweiSchritte("elo_start_workflow", a, function () {
      var s = sordOf(a.objekt), tpl = vorlageFinden(a.vorlage), warn = [], titel = trim(a.titel) || S(s.getName());
      var fwi = new IXC.FindWorkflowInfo(); fwi.setType(IXC.WFTypeC.ACTIVE); fwi.setObjId(S(s.getId()));
      var fr = ELO.ix().findFirstWorkflows(fwi, LIMIT.workflows, IXC.WFDiagramC.mbLean), gleich = [];
      try { var w = fr.getWorkflows(); for (var i = 0; i < w.length; i++) if (S(w[i].getTemplateId()) === S(tpl.getId())) gleich.push(S(w[i].getId())); }
      finally { try { ELO.ix().findClose(fr.getSearchId()); } catch (e) {} }
      if (gleich.length) warn.push("Auf dem Objekt laeuft diese Vorlage schon: Workflow " + gleich.join(", ") + ".");
      return { vorschau: { aktion: "Workflow starten", vorlage: S(tpl.getName()) + " [" + S(tpl.getId()) + "]", objekt: S(s.getName()) + " [" + S(s.getId()) + "]", pfad: pathOf(s), titel: titel },
               warnungen: warn, fp: S(s.getId()) + "|" + S(tpl.getId()) + "|" + gleich.join(","), sord: s, tpl: tpl, titel: titel };
    }, function (p) {
      var flowId = S(ELO.ix().startWorkFlow(S(p.tpl.getId()), p.titel, S(p.sord.getId())));
      var d = workflowDetail(flowId, "aktiv", true), akt = [];
      for (var k = 0; k < d.knoten.length; k++) if (d.knoten[k].aktiv) akt.push({ knotenId: d.knoten[k].id, knoten: d.knoten[k].name, bearbeiter: d.knoten[k].bearbeiter || "" });
      return { workflowId: flowId, titel: p.titel, aktiveKnoten: akt };
    });
  }, 2);

function meineIds() {
  var u = ELO.connect().getLoginResult().getUser(), ids = {}, g = allGroups(u);
  ids[S(u.getId())] = true;
  for (var i = 0; i < g.length; i++) ids[S(g[i].info.getId())] = true;
  return ids;
}

tool("elo_forward_task",
  "Leitet eine Workflow-Aufgabe weiter (zweistufig). Bei mehreren moeglichen Nachfolgern muss nachfolger angegeben werden. Formulare werden dabei NICHT geprueft - bei Knoten mit Formular nur mit trotzFormular=true.",
  { workflowId: { type: "string" }, knotenId: { type: "string" },
    nachfolger: { type: "array", items: { type: "string" }, description: "Knoten-IDs, die aktiviert werden sollen (aus der Vorschau)" },
    kommentar: { type: "string", description: "Optionaler Kommentar am Knoten" },
    trotzFormular: { type: "boolean", description: "Auch weiterleiten, wenn der Knoten ein Formular hat (Formular-Pruefungen entfallen)" },
    token: P_TOKEN },
  ["workflowId", "knotenId"], function (a) {
    return zweiSchritte("elo_forward_task", a, function () {
      var flowId = trim(a.workflowId), nodeId = trim(a.knotenId), warn = [];
      var wf = ELO.ix().checkoutWorkFlow(flowId, IXC.WFTypeC.ACTIVE, IXC.WFDiagramC.mbAll, IXC.LockC.NO);
      var nodes = wf.getNodes(), node = null, byId = {};
      for (var i = 0; i < nodes.length; i++) { if (nodes[i].getType() === 0) continue; byId[S(nodes[i].getId())] = nodes[i]; if (S(nodes[i].getId()) === nodeId) node = nodes[i]; }
      if (!node) fail("Knoten " + nodeId + " gibt es in Workflow " + flowId + " nicht.");
      if (!S(node.getEnterDateIso()) || S(node.getExitDateIso())) fail("Knoten " + S(node.getName()) + " ist nicht aktiv.");
      if (S(node.getFormSpec()) && !a.trotzFormular) fail("Knoten '" + S(node.getName()) + "' hat das Formular '" + S(node.getFormSpec()) + "'. Beim Weiterleiten ueber die API laufen dessen Pruefungen nicht. Nur mit trotzFormular=true, wenn das gewollt ist.");
      if (S(node.getFormSpec())) warn.push("Formular '" + S(node.getFormSpec()) + "' wird uebergangen.");
      if (!meineIds()[S(node.getUserId())]) warn.push("Der Knoten ist " + S(node.getUserName()) + " zugeordnet, nicht dir oder einer deiner Gruppen - ELO lehnt das vermutlich ab.");
      var as = wf.getMatrix().getAssocs(), moegl = [];
      for (var j = 0; j < as.length; j++) if (S(as[j].getNodeFrom()) === nodeId) moegl.push(S(as[j].getNodeTo()));
      var ziel = a.nachfolger && a.nachfolger.length ? a.nachfolger.map(S) : (moegl.length === 1 ? moegl : null);
      var optionen = moegl.map(function (m) { return { knotenId: m, name: byId[m] ? S(byId[m].getName()) : "?", typ: byId[m] ? (NODE_TYPE[byId[m].getType()] || "") : "" }; });
      if (!ziel) fail("Mehrere Nachfolger moeglich, bitte nachfolger angeben: " + JSON.stringify(optionen));
      for (var k = 0; k < ziel.length; k++) if (moegl.indexOf(ziel[k]) < 0) fail("Knoten " + ziel[k] + " ist kein Nachfolger von " + nodeId + ". Moeglich: " + JSON.stringify(optionen));
      var kommentar = trim(a.kommentar);
      return { vorschau: { aktion: "Aufgabe weiterleiten", workflow: S(wf.getName()) + " [" + flowId + "]", objekt: S(wf.getObjId()), knoten: S(node.getName()) + " [" + nodeId + "]",
                           bearbeiter: S(node.getUserName()), nachfolger: optionen.filter(function (o) { return ziel.indexOf(o.knotenId) >= 0; }), kommentar: kommentar },
               warnungen: warn, fp: flowId + "|" + nodeId + "|" + S(node.getEnterDateIso()) + "|" + S(node.getExitDateIso()) + "|" + S(node.getUserId()),
               flowId: parseInt(flowId, 10), nodeId: parseInt(nodeId, 10), ziel: ziel, kommentar: kommentar };
    }, function (p) {
      var edit = ELO.ix().beginEditWorkFlowNode(p.flowId, p.nodeId, IXC.LockC.YES);
      try {
        var fi = new IXC.ForwardWorkflowNodeInfo(), succ = new java.util.ArrayList();
        for (var i = 0; i < p.ziel.length; i++) succ.add(new java.lang.Integer(parseInt(p.ziel[i], 10)));
        fi.setSuccessorNodesToActivate(succ);
        if (p.kommentar) { var n = edit.getNode(); n.setComment(p.kommentar); fi.setNode(n); }
        ELO.ix().forwardWorkflowNode(p.flowId, p.nodeId, fi, IXC.LockC.YES);
      } catch (e) {
        try { ELO.ix().endEditWorkFlowNode(p.flowId, p.nodeId, false, true, null, null, null); } catch (e2) { log("Knoten entsperren fehlgeschlagen: " + e2); }
        throw e;
      }
      var akt = [];
      try {
        var d = workflowDetail(S(p.flowId), "aktiv", true);
        for (var k = 0; k < d.knoten.length; k++) if (d.knoten[k].aktiv) akt.push({ knotenId: d.knoten[k].id, knoten: d.knoten[k].name, bearbeiter: d.knoten[k].bearbeiter || "" });
      } catch (e) { return { workflowId: S(p.flowId), weitergeleitet: S(p.nodeId), jetztAktiv: [], hinweis: "Workflow ist nicht mehr aktiv (vermutlich beendet)." }; }
      return { workflowId: S(p.flowId), weitergeleitet: S(p.nodeId), jetztAktiv: akt };
    });
  }, 2);
