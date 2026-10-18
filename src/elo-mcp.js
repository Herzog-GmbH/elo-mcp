/*
 * elo-mcp.js - MCP-Server fuer ELO: Kern, Hilfen, Textauszug, lesende Werkzeuge (Stufe 1).
 *
 * Laeuft unter Rhino mit den Jars des ELO Java Client. Start ueber elo-mcp.ps1
 * (setzt Server, Zugangsdaten und Schalter als Umgebungsvariablen).
 * Protokoll: MCP ueber stdio, eine JSON-RPC-Nachricht pro Zeile.
 *
 * Sicherungen (ein Indexserver kann an Massenabfragen mit OutOfMemoryError ausfallen):
 *   - Anfragen werden strikt nacheinander abgearbeitet (stdio, eine Schleife).
 *   - Jede Suche hat eine harte Obergrenze.
 *   - Laufende/beendete Workflows nur zu einem Objekt oder mit exaktem Namen,
 *     nie mit Platzhalter. Kein Massen-Checkout.
 *   - Versionen werden nur aus der Versionsliste des eigenen Objekts gewaehlt
 *     (checkoutDoc mit fremder docId liefert sonst ohne Fehler ein anderes Objekt).
 *
 * Alle Zugriffe laufen mit dem ELO-Konto des Anwenders; ELO prueft die Rechte selbst.
 */

var IXC = Packages.de.elo.ix.client;
var SERVER_NAME = "elo", SERVER_VERSION = "0.6.0";
var LIMIT = { suche: 50, liste: 300, aufgaben: 50, workflows: 20, aktiveKnoten: 5, textZeichen: 50000, dateiBytes: 20 * 1024 * 1024 };

/* ---------- stdio ---------- */

var REAL_OUT = java.lang.System.out;
// Alles, was Bibliotheken auf stdout schreiben, nach stderr umleiten - stdout gehoert dem Protokoll.
java.lang.System.setOut(java.lang.System.err);
var IN = new java.io.BufferedReader(new java.io.InputStreamReader(java.lang.System["in"], "UTF-8"));

function log(msg) { java.lang.System.err.println("[elo-mcp] " + msg); }

function send(obj) {
  // Nur ASCII ausgeben: Nicht-ASCII als \uXXXX, damit keine Codepage dazwischenfunkt.
  var s = JSON.stringify(obj).replace(/[\u007f-\uffff]/g, function (c) {
    return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
  });
  REAL_OUT.print(s + "\n");
  REAL_OUT.flush();
}

/* ---------- Hilfen ---------- */

function S(v) { return (v === null || v === undefined) ? "" : String(v); }
function trim(s) { return S(s).replace(/^\s+|\s+$/g, ""); }
function cap(n, def, max) { n = parseInt(n, 10); if (!(n > 0)) n = def; return Math.min(n, max); }
function fail(msg) { throw { userError: msg }; }
function isFolder(s) { return s.getType() < 254 || S(s.getId()) === "1"; }  // Wurzel hat einen Sondertyp
function link(s) { var g = S(s.getGuid()); return g ? "elodms://" + g : ""; }
function envFlag(name, wert) { return S(java.lang.System.getenv(name)) === (wert || "1"); }

/* Stufen: 1 lesen (immer), 2 arbeiten (-Schreiben), 3 bauen (-Bauen). Nicht freigeschaltete
   Werkzeuge stehen nicht in tools/list und werden beim Aufruf abgelehnt. */
var SCHREIBEN_ERLAUBT = envFlag("ELO_MCP_SCHREIBEN");
var BAUEN_ERLAUBT = envFlag("ELO_MCP_BAUEN");
function stufeFrei(st) { return st === 1 || (st === 2 && SCHREIBEN_ERLAUBT) || (st === 3 && BAUEN_ERLAUBT); }
function stufenText() { return "1 lesen" + (SCHREIBEN_ERLAUBT ? ", 2 arbeiten" : "") + (BAUEN_ERLAUBT ? ", 3 bauen" : ""); }

/* Mehrere Archive: elo-mcp.ps1 startet je Archiv einen eigenen Java-Prozess und gibt jedem die Liste
   aller Archive (ELO_MCP_ARCHIVE, JSON: name, stufen, schreiben, bauen, text) und den eigenen Namen
   (ELO_MCP_ARCHIV_NAME) mit. Jedes Werkzeug bekommt dann den Parameter archiv; der Vorschalt leitet
   danach weiter, dieser Prozess prueft nur noch, dass der Aufruf fuer ihn gedacht ist. */
var ARCHIVE = (function () {
  var t = trim(java.lang.System.getenv("ELO_MCP_ARCHIVE"));
  if (!t) return [];
  try { var a = JSON.parse(t); return (a instanceof Array) ? a : []; }
  catch (e) { log("ELO_MCP_ARCHIVE ist kein gueltiges JSON, ignoriert"); return []; }
})();
var ARCHIV_NAME = trim(java.lang.System.getenv("ELO_MCP_ARCHIV_NAME"));
function mehrereArchive() { return ARCHIVE.length > 1; }
function archivNamen() { var n = []; for (var i = 0; i < ARCHIVE.length; i++) n.push(S(ARCHIVE[i].name)); return n; }
function freischaltHinweis(st) {
  return mehrereArchive() ? " ist im Archiv '" + ARCHIV_NAME + "' nicht freigeschaltet (" + (st === 3 ? "Bauen" : "Schreiben") + " fuer dieses Archiv einschalten)."
                          : " ist nicht freigeschaltet (elo-mcp.ps1 " + (st === 3 ? "-Bauen" : "-Schreiben") + ").";
}

function pathOf(s) {
  try {
    var rp = s.getRefPaths();
    if (rp && rp.length > 0) {
      var p = rp[0].getPath(), names = [];
      for (var i = 0; i < p.length; i++) names.push(S(p[i].getName()));
      return names.join("/");
    }
  } catch (e) {}
  return "";
}

function brief(s) {
  return { id: S(s.getId()), name: S(s.getName()), art: isFolder(s) ? "Ordner" : "Dokument",
           maske: S(s.getMaskName()), eltern: S(s.getParentId()), datum: S(s.getXDateIso()) };
}

var maskCache = {};
function maskLabels(maskId) {
  var k = S(maskId);
  if (maskCache[k]) return maskCache[k];
  var m = {};
  try {
    var lines = ELO.ix().checkoutDocMask(k, IXC.DocMaskC.mbAll, IXC.LockC.NO).getLines();
    for (var i = 0; i < lines.length; i++) m[S(lines[i].getKey())] = S(lines[i].getName());
  } catch (e) { log("Maske " + k + " nicht lesbar: " + e); }
  maskCache[k] = m;
  return m;
}

function indexFields(s) {
  var labels = maskLabels(s.getMask()), out = [];
  var keys = s.getObjKeys();
  for (var i = 0; keys && i < keys.length; i++) {
    var d = keys[i].getData(), vals = [];
    for (var j = 0; d && j < d.length; j++) if (S(d[j]) !== "") vals.push(S(d[j]));
    if (vals.length === 0) continue;
    var key = S(keys[i].getName());
    out.push({ feld: key, bezeichnung: labels[key] || "", wert: vals.length === 1 ? vals[0] : vals });
  }
  return out;
}

function sordOf(id) {
  if (!trim(id)) fail("Objekt fehlt (ID, GUID oder Archivpfad).");
  return ELO.ix().checkoutSord(ELO.arcpath(trim(id)), IXC.EditInfoC.mbSord, IXC.LockC.NO).getSord();
}

/* Versionsliste eines Dokuments, neueste zuerst (docId "-1"). */
function versionsOf(id) {
  var ed = ELO.ix().checkoutDoc(ELO.arcpath(trim(id)), "-1", IXC.EditInfoC.mbSordDoc, IXC.LockC.NO);
  var docs = (ed.getDocument() && ed.getDocument().getDocs()) ? ed.getDocument().getDocs() : [];
  return { sord: ed.getSord(), docs: docs };
}

function versionInfo(d) {
  return { versionId: S(d.getId()), aktuell: !!d.isWorkVersion(), angelegt: S(d.getCreateDateIso()),
           von: S(d.getOwnerName()), endung: S(d.getExt()), bytes: Number(S(d.getSize()) || 0),
           kommentar: S(d.getComment()), md5: S(d.getMd5()), version: S(d.getVersion()) };
}

function findSords(fi, max, sordZ) {
  var fr = ELO.ix().findFirstSords(fi, max, sordZ || IXC.SordC.mbAll), out = [];
  try {
    var arr = fr.getSords();
    for (var i = 0; i < arr.length && out.length < max; i++) out.push(arr[i]);
    return { sords: out, mehr: !!fr.isMoreResults() };
  } finally { try { ELO.ix().findClose(fr.getSearchId()); } catch (e) {} }
}

/* ---------- Textauszug ---------- */

function readAll(is, limit) {
  var out = new java.io.ByteArrayOutputStream();
  var buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 65536), n;
  try {
    while ((n = is.read(buf)) > 0) { out.write(buf, 0, n); if (out.size() > limit) fail("Datei groesser als " + (limit / 1048576) + " MB."); }
  } finally { is.close(); }
  return out.toByteArray();
}

function zipEntries(bytes, re) {
  var zis = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(bytes)), e, out = [];
  try {
    while ((e = zis.getNextEntry()) !== null) {
      var name = S(e.getName());
      if (re.test(name)) out.push({ name: name, text: S(new java.lang.String(zis.readAllBytes(), "UTF-8")) });
    }
  } finally { zis.close(); }
  out.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
  return out;
}

function xmlText(x) {
  return x.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
          .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(n); }).replace(/&amp;/g, "&");
}

function textDocx(bytes) {
  var parts = zipEntries(bytes, /^word\/(document|header\d*|footer\d*)\.xml$/), out = [];
  for (var i = 0; i < parts.length; i++)
    out.push(xmlText(parts[i].text.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<w:br\/>/g, "\n")));
  return out.join("\n");
}

function textPptx(bytes) {
  var parts = zipEntries(bytes, /^ppt\/slides\/slide\d+\.xml$/), out = [];
  for (var i = 0; i < parts.length; i++) out.push("--- Folie " + (i + 1) + "\n" + xmlText(parts[i].text.replace(/<\/a:p>/g, "\n")));
  return out.join("\n");
}

function textXlsx(bytes) {
  var ss = zipEntries(bytes, /^xl\/sharedStrings\.xml$/), strings = [];
  if (ss.length) {
    var si = ss[0].text.split(/<si>/);
    for (var i = 1; i < si.length; i++) strings.push(xmlText(si[i].replace(/<rPh[\s\S]*?<\/rPh>/g, "")));
  }
  var sheets = zipEntries(bytes, /^xl\/worksheets\/sheet\d+\.xml$/), out = [];
  for (var s = 0; s < sheets.length; s++) {
    out.push("--- Blatt " + (s + 1));
    var rows = sheets[s].text.split(/<row[ >]/);
    for (var r = 1; r < rows.length; r++) {
      var cells = [], re = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m;
      while ((m = re.exec(rows[r])) !== null) {
        var attrs = m[1], inner = m[2] || "", v = /<v>([\s\S]*?)<\/v>/.exec(inner), t = /t="(\w+)"/.exec(attrs);
        var val = v ? xmlText(v[1]) : (/<is>/.test(inner) ? xmlText(inner) : "");
        if (t && t[1] === "s" && v) val = strings[parseInt(v[1], 10)] || "";
        cells.push(val);
      }
      if (cells.join("") !== "") out.push(cells.join("\t"));
    }
  }
  return out.join("\n");
}

function textPdf(bytes) {
  var doc = Packages.org.apache.pdfbox.Loader.loadPDF(bytes);
  try { return S(new Packages.org.apache.pdfbox.text.PDFTextStripper().getText(doc)); }
  finally { doc.close(); }
}

function textXls(bytes) {
  var wb = new Packages.org.apache.poi.hssf.usermodel.HSSFWorkbook(new java.io.ByteArrayInputStream(bytes));
  try { return S(new Packages.org.apache.poi.hssf.extractor.ExcelExtractor(wb).getText()); } finally { wb.close(); }
}

function mimeText(part, out) {
  var ct = S(part.getContentType()).toLowerCase(), c = part.getContent();
  if (c instanceof Packages.jakarta.mail.Multipart) {
    var plain = null;
    for (var i = 0; i < c.getCount(); i++) {
      var bp = c.getBodyPart(i);
      if (S(bp.getContentType()).toLowerCase().indexOf("text/plain") === 0) plain = bp;
    }
    if (plain && /multipart\/alternative/.test(ct)) { mimeText(plain, out); return; }
    for (var j = 0; j < c.getCount(); j++) mimeText(c.getBodyPart(j), out);
  } else if (ct.indexOf("text/plain") === 0) out.push(S(c));
  else if (ct.indexOf("text/html") === 0) out.push(xmlText(S(c).replace(/<(br|\/p|\/div|\/tr)[^>]*>/gi, "\n").replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")));
  else { var fn = S(part.getFileName()); if (fn) out.push("[Anhang: " + fn + "]"); }
}

function textEml(bytes) {
  var sess = Packages.jakarta.mail.Session.getDefaultInstance(new java.util.Properties());
  var msg = new Packages.jakarta.mail.internet.MimeMessage(sess, new java.io.ByteArrayInputStream(bytes));
  function adr(a) { if (!a) return ""; var r = []; for (var i = 0; i < a.length; i++) r.push(S(a[i].toString())); return r.join(", "); }
  var out = ["Von: " + adr(msg.getFrom()), "An: " + adr(msg.getRecipients(Packages.jakarta.mail.Message.RecipientType.TO)),
             "Betreff: " + S(msg.getSubject()), "Datum: " + S(msg.getSentDate()), ""];
  mimeText(msg, out);
  return out.join("\n");
}

var TEXT_EXT = /^(txt|csv|json|xml|js|html?|md|log|ini|properties|sql|ps1|py|yml|yaml|cfg|conf)$/;

function extractText(bytes, ext) {
  ext = S(ext).toLowerCase();
  if (ext === "pdf") return textPdf(bytes);
  if (ext === "docx" || ext === "docm" || ext === "dotx") return textDocx(bytes);
  if (ext === "xlsx" || ext === "xlsm") return textXlsx(bytes);
  if (ext === "pptx") return textPptx(bytes);
  if (ext === "xls") return textXls(bytes);
  if (ext === "eml") return textEml(bytes);
  if (TEXT_EXT.test(ext)) {
    var s = S(new java.lang.String(bytes, "UTF-8"));
    if (s.indexOf("\ufffd") >= 0) s = S(new java.lang.String(bytes, "windows-1252"));
    return /^html?$/.test(ext) ? xmlText(s.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")) : s;
  }
  return null;
}

/* ---------- Rechte ---------- */

function flagTable(prefix) {
  var fs = java.lang.Class.forName("de.elo.ix.client.AccessC").getFields(), t = [];
  for (var i = 0; i < fs.length; i++) {
    var n = S(fs[i].getName());
    if (n.indexOf(prefix) !== 0 || /ALL|LAST|NOT_TO|EXCLUSIVE/.test(n)) continue;
    var v; try { v = fs[i].getInt(null); } catch (e) { continue; }
    if (v && (v & (v - 1)) === 0) t.push([n, v]);
  }
  return t;
}
function notInherited(name) { try { return java.lang.Class.forName("de.elo.ix.client.AccessC").getField(name).getInt(null); } catch (e) { return 0; } }

function allGroups(u) {
  var seen = {}, list = [], todo = [], gl = u.getGroupList();
  for (var i = 0; gl && i < gl.length; i++) todo.push(S(gl[i]));
  for (var depth = 0; todo.length > 0 && depth < 5; depth++) {
    var ids = [];
    for (var i = 0; i < todo.length; i++) if (!seen[todo[i]]) { seen[todo[i]] = true; ids.push(todo[i]); }
    if (ids.length === 0) break;
    var gs = ELO.ix().checkoutUsers(ids, IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO);
    todo = [];
    for (var j = 0; j < gs.length; j++) {
      list.push({ info: gs[j], ueber: depth > 0 });
      var sub = gs[j].getGroupList();
      for (var k = 0; sub && k < sub.length; k++) todo.push(S(sub[k]));
    }
  }
  return list;
}

/* ---------- Werkzeuge ---------- */

var TOOLS = [];
var HANDLERS = {};
function tool(name, description, props, required, fn, stufe) {
  stufe = stufe || 1;
  TOOLS.push({ name: name, description: description,
               inputSchema: { type: "object", properties: props, required: required || [], additionalProperties: false },
               annotations: stufe > 1 ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
                                      : { readOnlyHint: true, openWorldHint: false } });
  HANDLERS[name] = { fn: fn, schreibt: stufe > 1, stufe: stufe };
}

function freieWerkzeuge() {
  var out = [];
  for (var i = 0; i < TOOLS.length; i++) if (stufeFrei(HANDLERS[TOOLS[i].name].stufe)) out.push(mehrereArchive() ? mitArchiv(TOOLS[i]) : TOOLS[i]);
  return out;
}

/* Werkzeug mit dem Parameter archiv; bei Stufe 2/3 steht in der Beschreibung, in welchen Archiven es geht. */
function mitArchiv(t) {
  var st = HANDLERS[t.name].stufe, props = {}, teile = [], frei = [];
  for (var k in t.inputSchema.properties) props[k] = t.inputSchema.properties[k];
  for (var i = 0; i < ARCHIVE.length; i++) {
    var a = ARCHIVE[i];
    teile.push("'" + S(a.name) + "'" + (i === 0 ? " (Standard)" : "") + ": Stufen " + S(a.stufen) + (a.text ? ", " + S(a.text) : ""));
    if (st === 1 || (st === 2 && a.schreiben) || (st === 3 && a.bauen)) frei.push("'" + S(a.name) + "'");
  }
  props.archiv = { type: "string", enum: archivNamen(),
                   description: "ELO-Archiv. " + teile.join("; ") + ". Ohne Angabe '" + S(ARCHIVE[0].name) + "'. Objekt-IDs, Masken und Vorlagen gelten nur im jeweiligen Archiv." };
  return { name: t.name,
           description: t.description + (st > 1 && frei.length < ARCHIVE.length ? " Nur im Archiv " + frei.join(", ") + "." : ""),
           inputSchema: { type: "object", properties: props, required: t.inputSchema.required, additionalProperties: false },
           annotations: t.annotations };
}

var P_OBJ = { type: "string", description: "Objekt-ID, GUID oder Archivpfad (z. B. 'Administration/ELOas Base')" };

tool("elo_whoami", "Zeigt, mit welchem ELO-Konto und gegen welchen Server dieser MCP-Server arbeitet.", {}, [], function () {
  var conn = ELO.connect(), u = conn.getLoginResult().getUser();
  return { archiv: ARCHIV_NAME || undefined, konto: S(u.getName()), id: S(u.getId()), server: S(java.lang.System.getenv("ELO_IX_URL")),
           ixVersion: S(conn.getVersion()), mcpVersion: SERVER_VERSION, stufen: stufenText(),
           schreibenErlaubt: SCHREIBEN_ERLAUBT, bauenErlaubt: BAUEN_ERLAUBT,
           archive: mehrereArchive() ? archivNamen() : undefined };
});

tool("elo_search",
  "Suche ueber die ELO-iSearch (Titel, Volltext, Indexfelder). Optional auf einen Ordner samt Unterordnern eingrenzen. Feldsyntax moeglich, z. B. 'NACHNAME:Mustermann'. Hoechstens " + LIMIT.suche + " Treffer.",
  { query: { type: "string", description: "Suchbegriff(e)" },
    ordner: { type: "string", description: "Optional: Ordner (ID, GUID oder Pfad), in dem gesucht wird, inkl. Unterordner" },
    bereich: { type: "array", items: { type: "string", enum: ["titel", "volltext", "index", "zusatztext", "version", "feed"] },
               description: "Wo gesucht wird, Standard titel+volltext+index" },
    max: { type: "integer", description: "Trefferzahl, Standard 20, hoechstens " + LIMIT.suche } },
  ["query"], function (a) {
    if (!trim(a.query)) fail("query ist leer.");
    var C = IXC.esearch.ESearchParamsC, bits = { titel: C.TITLE, volltext: C.FULLTEXT, index: C.INDEX_FIELDS, zusatztext: C.EXTRA_TEXT, version: C.VERSION, feed: C.FEED };
    var b = a.bereich && a.bereich.length ? a.bereich : ["titel", "volltext", "index"], searchIn = 0;
    for (var i = 0; i < b.length; i++) { if (bits[b[i]] === undefined) fail("Unbekannter Bereich: " + b[i]); searchIn |= bits[b[i]]; }
    var p = new IXC.esearch.ESearchParams(); p.setQuery(trim(a.query)); p.setSearchIn(searchIn);
    var opt = new IXC.esearch.DocumentOptions(), ordner = null;
    if (a.ordner) { ordner = sordOf(a.ordner); opt.setCurrentFolderId(S(ordner.getId())); }
    var es = new IXC.esearch.FindByESearch(); es.setSearchParams(p); es.setSearchOptions(opt);
    var fi = new IXC.FindInfo(); fi.setFindByESearch(es);
    var r = findSords(fi, cap(a.max, 20, LIMIT.suche));
    var res = [];
    for (var i = 0; i < r.sords.length; i++) res.push(brief(r.sords[i]));
    return { treffer: res.length, mehrVorhanden: r.mehr, ordner: ordner ? S(ordner.getName()) : "ganzes Archiv", ergebnisse: res };
  });

tool("elo_find_by_fields",
  "Sucht ueber Indexfelder einer Maske (Datenbanksuche, exakt, Platzhalter * erlaubt). Mindestens ein Feld oder ein Name ist Pflicht - eine ganze Maske ohne Eingrenzung wird nicht gelistet.",
  { maske: { type: "string", description: "Maskenname oder -ID, z. B. 'Rechnung'" },
    felder: { type: "object", additionalProperties: { type: "string" }, description: "Feldgruppe -> Wert, z. B. {\"NACHNAME\": \"Mustermann\"}" },
    name: { type: "string", description: "Kurzbezeichnung, Platzhalter * erlaubt" },
    ordner: { type: "string", description: "Optional: nur unterhalb dieses Ordners (beliebig tief)" },
    max: { type: "integer", description: "Standard 20, hoechstens " + LIMIT.suche } },
  [], function (a) {
    var fb = new IXC.FindByIndex(), keys = [];
    for (var k in (a.felder || {})) {
      var v = trim(a.felder[k]);
      if (v.replace(/[*?%]/g, "").length < 2) fail("Feld " + k + ": Wert zu unspezifisch (mindestens 2 Zeichen ohne Platzhalter).");
      var ok = new IXC.ObjKey(); ok.setName(S(k)); ok.setData([v]); keys.push(ok);
    }
    var nm = trim(a.name);
    if (keys.length === 0 && nm.replace(/[*?%]/g, "").length < 3) fail("Bitte mindestens ein Feld oder einen Namen mit 3 Zeichen ohne Platzhalter angeben.");
    if (a.maske) fb.setMaskId(S(a.maske));
    if (keys.length) fb.setObjKeys(keys);
    if (nm) fb.setName(nm);
    var fi = new IXC.FindInfo(); fi.setFindByIndex(fb);
    if (a.ordner) { var fc = new IXC.FindChildren(); fc.setParentId(S(sordOf(a.ordner).getId())); fc.setEndLevel(-1); fi.setFindChildren(fc); }
    var r = findSords(fi, cap(a.max, 20, LIMIT.suche)), res = [];
    for (var i = 0; i < r.sords.length; i++) { var o = brief(r.sords[i]); o.felder = indexFields(r.sords[i]); res.push(o); }
    return { treffer: res.length, mehrVorhanden: r.mehr, ergebnisse: res };
  });

tool("elo_list", "Listet den direkten Inhalt eines Ordners (eine Ebene).",
  { ordner: P_OBJ, max: { type: "integer", description: "Standard 100, hoechstens " + LIMIT.liste } },
  ["ordner"], function (a) {
    var o = sordOf(a.ordner);
    if (!isFolder(o)) fail("Kein Ordner: " + S(o.getName()));
    var fi = new IXC.FindInfo(), fc = new IXC.FindChildren();
    fc.setParentId(S(o.getId())); fc.setEndLevel(1); fi.setFindChildren(fc);
    var r = findSords(fi, cap(a.max, 100, LIMIT.liste), IXC.SordC.mbLean), res = [];
    for (var i = 0; i < r.sords.length; i++) res.push(brief(r.sords[i]));
    return { ordner: S(o.getName()), id: S(o.getId()), pfad: pathOf(o), eintraege: res.length, mehrVorhanden: r.mehr, inhalt: res };
  });

tool("elo_get_object", "Metadaten eines Objekts: Name, Maske, Pfad, Eigentuemer, Daten, alle gefuellten Indexfelder, aktuelle Version, Link.",
  { objekt: P_OBJ }, ["objekt"], function (a) {
    var s = sordOf(a.objekt), o = brief(s);
    o.guid = S(s.getGuid()); o.pfad = pathOf(s); o.eigentuemer = S(s.getOwnerName()); o.ablagedatum = S(s.getIDateIso());
    o.zusatztext = S(s.getDesc()).substring(0, 2000); o.link = link(s); o.felder = indexFields(s);
    var lock = S(s.getLockName()); if (lock) o.gesperrtVon = lock;
    if (!isFolder(s)) {
      var v = versionsOf(S(s.getId()));
      o.versionen = v.docs.length;
      for (var i = 0; i < v.docs.length; i++) if (v.docs[i].isWorkVersion()) o.aktuelleVersion = versionInfo(v.docs[i]);
    }
    return o;
  });

tool("elo_get_versions", "Versionsliste eines Dokuments, neueste zuerst.",
  { objekt: P_OBJ }, ["objekt"], function (a) {
    var v = versionsOf(a.objekt), res = [];
    if (isFolder(v.sord)) fail("Ordner haben keine Versionen.");
    for (var i = 0; i < v.docs.length; i++) res.push(versionInfo(v.docs[i]));
    return { id: S(v.sord.getId()), name: S(v.sord.getName()), versionen: res };
  });

tool("elo_get_text",
  "Text eines Dokuments: PDF (mit Textebene), DOCX, XLSX, PPTX, XLS, EML und Textdateien. Gescannte PDFs ohne Textebene liefern keinen Text (kein OCR). Hoechstens " + LIMIT.textZeichen + " Zeichen.",
  { objekt: P_OBJ,
    versionId: { type: "string", description: "Optional: bestimmte Version aus elo_get_versions, sonst die aktuelle" },
    maxZeichen: { type: "integer", description: "Standard 20000, hoechstens " + LIMIT.textZeichen },
    abZeichen: { type: "integer", description: "Optional: ab dieser Stelle weiterlesen" } },
  ["objekt"], function (a) {
    var v = versionsOf(a.objekt), s = v.sord, d = null;
    if (isFolder(s)) fail("Ordner haben keinen Inhalt.");
    for (var i = 0; i < v.docs.length; i++) {
      if (a.versionId ? S(v.docs[i].getId()) === S(a.versionId) : v.docs[i].isWorkVersion()) d = v.docs[i];
    }
    if (!d) fail(a.versionId ? "Version " + a.versionId + " gehoert nicht zu Objekt " + S(s.getId()) + "." : "Keine aktuelle Version gefunden.");
    if (Number(S(d.getSize())) > LIMIT.dateiBytes) fail("Datei zu gross (" + S(d.getSize()) + " Bytes).");
    var bytes;
    try { bytes = readAll(ELO.connect().download(d.getUrl(), 0, -1), LIMIT.dateiBytes); }
    catch (e) {
      if (e && e.userError) throw e;
      fail("Datei auf dem Server nicht ladbar (Ablagepfad " + S(d.getPathId()) + "): " + errText(e));
    }
    var text = extractText(bytes, d.getExt());
    if (text === null) fail("Format ." + S(d.getExt()) + " wird nicht ausgelesen (moeglich: pdf, docx, xlsx, pptx, xls, eml, Textdateien).");
    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    var ab = Math.max(0, parseInt(a.abZeichen, 10) || 0), max = cap(a.maxZeichen, 20000, LIMIT.textZeichen);
    var teil = text.substring(ab, ab + max);
    return { id: S(s.getId()), name: S(s.getName()), versionId: S(d.getId()), endung: S(d.getExt()),
             zeichenGesamt: text.length, ab: ab, bis: ab + teil.length, abgeschnitten: ab + teil.length < text.length,
             hinweis: trim(text) === "" ? "Kein Text gefunden - vermutlich Scan ohne Textebene." : "", text: teil };
  });

tool("elo_user_rights", "Wirksame Funktionsrechte eines ELO-Benutzers mit Herkunft (direkt oder ueber welche Gruppe), dazu alle Gruppen. Ohne Angabe: eigenes Konto.",
  { benutzer: { type: "string", description: "Name ('Nachname, Vorname'), Anmeldename oder ID" } },
  [], function (a) {
    var who = trim(a.benutzer) || S(ELO.connect().getLoginResult().getUser().getId()), u;
    try { u = ELO.ix().checkoutUser(who, IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO); }
    catch (e) { fail("Benutzer nicht gefunden: " + who); }
    var groups = allGroups(u), res = { benutzer: S(u.getName()), id: S(u.getId()), letzteAnmeldung: S(u.getLastLoginIso()), rechte: [], gruppen: [] };
    function collect(prefix, getter, direct, block) {
      var t = flagTable(prefix);
      for (var i = 0; i < t.length; i++) {
        var bit = t[i][1], src = [];
        if ((direct & bit) !== 0) src.push("direkt");
        for (var g = 0; g < groups.length; g++) if ((groups[g].info[getter]() & bit) !== 0) src.push(S(groups[g].info.getName()));
        if (src.length === 0) continue;
        var r = { recht: t[i][0].substring(prefix.length), herkunft: src };
        if ((block & bit) !== 0 && (direct & bit) === 0) r.hinweis = "wird laut ELO nicht von Gruppen geerbt";
        res.rechte.push(r);
      }
    }
    collect("FLAG_", "getFlags", u.getFlags(), notInherited("FLAGS_NOT_TO_INHERIT"));
    collect("FLAG2_", "getFlags2", u.getFlags2(), notInherited("FLAGS2_NOT_TO_INHERIT"));
    for (var i = 0; i < groups.length; i++) res.gruppen.push({ id: S(groups[i].info.getId()), name: S(groups[i].info.getName()), verschachtelt: groups[i].ueber });
    return res;
  });

var NODE_TYPE = { 1: "Start", 2: "Person", 3: "Verteiler", 4: "Entscheidung", 5: "Sammler", 6: "Ende", 7: "Zyklus", 8: "Serveruebergabe", 9: "Subworkflow" };
var WF_ART = { vorlage: "TEMPLATE", aktiv: "ACTIVE", beendet: "FINISHED" };

tool("elo_workflow_templates", "Listet alle Workflow-Vorlagen (ID, Name, Eigentuemer).", {}, [], function () {
  var fwi = new IXC.FindWorkflowInfo(); fwi.setType(IXC.WFTypeC.TEMPLATE); fwi.setName("*");
  var fr = ELO.ix().findFirstWorkflows(fwi, 300, IXC.WFDiagramC.mbLean), res = [];
  try { var w = fr.getWorkflows(); for (var i = 0; i < w.length; i++) res.push({ id: S(w[i].getId()), name: S(w[i].getName()), eigentuemer: S(w[i].getOwnerName()) }); }
  finally { try { ELO.ix().findClose(fr.getSearchId()); } catch (e) {} }
  res.sort(function (x, y) { return x.name < y.name ? -1 : (x.name > y.name ? 1 : 0); });
  return { vorlagen: res.length, liste: res };
});

function workflowDetail(id, art, ohneKonfig) {
  var wf = ELO.ix().checkoutWorkFlow(S(id), IXC.WFTypeC[WF_ART[art]], IXC.WFDiagramC.mbAll, IXC.LockC.NO);
  var res = { id: S(wf.getId()), name: S(wf.getName()), art: art, eigentuemer: S(wf.getOwnerName()), objekt: S(wf.getObjId()), knoten: [], verbindungen: [] };
  if (art !== "vorlage") { res.vorlage = S(wf.getTemplateId()); res.gestartet = S(wf.getStartDateIso()); }
  var nodes = wf.getNodes(), byId = {};
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i]; if (n.getType() === 0) continue;
    byId[S(n.getId())] = S(n.getName());
    var k = { id: S(n.getId()), typ: NODE_TYPE[n.getType()] || ("Typ " + n.getType()), name: S(n.getName()) };
    if (S(n.getUserName())) k.bearbeiter = S(n.getUserName());
    if (S(n.getOnExit())) k.endeSkript = S(n.getOnExit());
    if (S(n.getOnEnter())) k.startSkript = S(n.getOnEnter());
    if (S(n.getFormSpec())) k.formular = S(n.getFormSpec());
    try { if (S(n.getYesNoCondition())) k.bedingung = S(n.getYesNoCondition()); } catch (e) {}
    try { if (n.getSubTemplateId() > 0) k.subworkflow = S(n.getSubTemplateId()); } catch (e) {}
    if (!ohneKonfig && trim(n.getProperties())) k.konfiguration = trim(n.getProperties()).substring(0, 4000);
    if (art !== "vorlage") {
      if (S(n.getEnterDateIso())) k.betreten = S(n.getEnterDateIso());
      if (S(n.getExitDateIso())) k.verlassen = S(n.getExitDateIso());
      k.aktiv = !!S(n.getEnterDateIso()) && !S(n.getExitDateIso());
    }
    res.knoten.push(k);
  }
  try {
    var as = wf.getMatrix().getAssocs();
    for (var j = 0; j < as.length; j++) res.verbindungen.push({ von: S(as[j].getNodeFrom()), nach: S(as[j].getNodeTo()) });
  } catch (e) {}
  return res;
}

tool("elo_workflow",
  "Zeigt einen Workflow im Detail: Knoten (Typ, Bearbeiter, Skripte, Formular, JSON-Konfiguration), Verbindungen; bei laufenden/beendeten zusaetzlich Ein- und Austrittszeiten.",
  { id: { type: "string", description: "Workflow- bzw. Vorlagen-ID (aus elo_workflow_templates, elo_workflows_of_object oder elo_my_tasks)" },
    art: { type: "string", enum: ["vorlage", "aktiv", "beendet"], description: "Standard vorlage" },
    ohneKonfiguration: { type: "boolean", description: "JSON-Konfiguration der Knoten weglassen (kuerzere Antwort)" } },
  ["id"], function (a) { return workflowDetail(a.id, a.art || "vorlage", !!a.ohneKonfiguration); });

tool("elo_workflows_of_object",
  "Workflows zu genau einem Objekt. Laufende mit ihren aktiven Knoten; beendete nur auf Wunsch. Abfragen ueber alle Workflows sind gesperrt, sie koennen den Indexserver ueberlasten.",
  { objekt: P_OBJ, beendete: { type: "boolean", description: "Beendete statt laufende Workflows" } },
  ["objekt"], function (a) {
    var s = sordOf(a.objekt);
    var fwi = new IXC.FindWorkflowInfo(); fwi.setType(a.beendete ? IXC.WFTypeC.FINISHED : IXC.WFTypeC.ACTIVE); fwi.setObjId(S(s.getId()));
    var fr = ELO.ix().findFirstWorkflows(fwi, LIMIT.workflows, IXC.WFDiagramC.mbLean), res = [];
    try {
      var w = fr.getWorkflows();
      for (var i = 0; i < w.length; i++) res.push({ id: S(w[i].getId()), name: S(w[i].getName()), vorlage: S(w[i].getTemplateId()),
                                                    gestartet: S(w[i].getStartDateIso()), eigentuemer: S(w[i].getOwnerName()) });
    } finally { try { ELO.ix().findClose(fr.getSearchId()); } catch (e) {} }
    if (!a.beendete) {
      for (var j = 0; j < res.length && j < LIMIT.aktiveKnoten; j++) {
        var d = workflowDetail(res[j].id, "aktiv", true), akt = [];
        for (var k = 0; k < d.knoten.length; k++) if (d.knoten[k].aktiv) akt.push({ knoten: d.knoten[k].name, bearbeiter: d.knoten[k].bearbeiter || "", seit: d.knoten[k].betreten });
        res[j].aktiveKnoten = akt;
      }
    }
    return { objekt: S(s.getName()), id: S(s.getId()), art: a.beendete ? "beendet" : "aktiv", workflows: res };
  });

tool("elo_my_tasks", "Eigene offene Workflow-Aufgaben (auch ueber Gruppen), neueste zuerst.",
  { max: { type: "integer", description: "Standard 30, hoechstens " + LIMIT.aufgaben } },
  [], function (a) {
    var fti = new IXC.FindTasksInfo(); fti.setInclWorkflows(true); fti.setInclGroup(true);
    var fr = ELO.ix().findFirstTasks(fti, cap(a.max, 30, LIMIT.aufgaben)), res = [];
    try {
      var t = fr.getTasks();
      for (var i = 0; t && i < t.length; i++) {
        var n = t[i].getWfNode(); if (!n) continue;
        res.push({ workflowId: S(n.getFlowId()), workflow: S(n.getFlowName()), knoten: S(n.getNodeName()), knotenId: S(n.getNodeId()),
                   objektId: S(n.getObjId()), objekt: S(n.getObjName()), bearbeiter: S(n.getUserName()),
                   seit: S(n.getActivateDateIso()), frist: S(n.getTimeLimitIso()), ueberfaellig: !!n.isOverTimeLimit() });
      }
      return { aufgaben: res.length, mehrVorhanden: !!fr.isMoreResults(), liste: res };
    } finally { try { ELO.ix().findClose(fr.getSearchId()); } catch (e) {} }
  });

/* ---------- Ausfuehrung ---------- */

function errText(e) {
  if (e && e.userError) return e.userError;
  var s = S(e && e.javaException ? e.javaException : e);
  var m = /\[ELOIX:(\d+)\]([^\[]*)/.exec(s);
  return m ? "ELOIX:" + m[1] + " " + trim(m[2]) : s.substring(0, 500);
}

function isSessionError(e) { return /ELOIX:(2001|5005)|INVALID_SESSION|ticket.*(invalid|expired)|Session.*(expired|abgelaufen)/i.test(S(e && e.javaException ? e.javaException : e)); }

function callTool(name, args) {
  var h = HANDLERS[name];
  if (!h) return { content: [{ type: "text", text: "Unbekanntes Werkzeug: " + name }], isError: true };
  args = args || {};
  if (args.archiv !== undefined && args.archiv !== null) {
    // Den Parameter selbst sieht kein Werkzeug (und kein Token-Vergleich); hier nur pruefen, dass der Aufruf hierher gehoert.
    var gewuenscht = trim(args.archiv);
    delete args.archiv;
    if (gewuenscht && !mehrereArchive())
      return { content: [{ type: "text", text: "Fehler: Es ist nur ein Archiv eingerichtet, der Parameter archiv entfaellt." }], isError: true };
    if (gewuenscht && gewuenscht.toLowerCase() !== ARCHIV_NAME.toLowerCase())
      return { content: [{ type: "text", text: "Fehler: Dieser Prozess bedient das Archiv '" + ARCHIV_NAME + "', nicht '" + gewuenscht + "'." }], isError: true };
  }
  if (!stufeFrei(h.stufe)) return { content: [{ type: "text", text: "Fehler: Werkzeug " + name + freischaltHinweis(h.stufe) }], isError: true };
  var fn = h.fn;
  var t0 = java.lang.System.currentTimeMillis();
  try {
    var r;
    try { r = fn(args); }
    catch (e) {
      // Schreibende Werkzeuge nie automatisch wiederholen - sonst droht doppelte Ausfuehrung.
      if (h.schreibt || !isSessionError(e)) throw e;
      log("Sitzung abgelaufen, melde neu an");
      ELO.close(); r = fn(args);
    }
    log(name + " ok (" + (java.lang.System.currentTimeMillis() - t0) + " ms)");
    return { content: [{ type: "text", text: JSON.stringify(r, null, 1) }] };
  } catch (e) {
    log(name + " FEHLER " + errText(e));
    return { content: [{ type: "text", text: "Fehler: " + errText(e) }], isError: true };
  }
}

function anweisungen() {
  var archiv = trim(java.lang.System.getenv("ELO_MCP_ARCHIV")), t;
  if (mehrereArchive()) {
    var teile = [];
    for (var i = 0; i < ARCHIVE.length; i++)
      teile.push("'" + S(ARCHIVE[i].name) + "'" + (i === 0 ? " (Standard)" : "") + (ARCHIVE[i].text ? " = " + S(ARCHIVE[i].text) : "") + ", Stufen " + S(ARCHIVE[i].stufen));
    t = ARCHIVE.length + " ELO-Archive, Zugriff mit den Rechten des angemeldeten Benutzers: " + teile.join("; ") + ". " +
        "Jedes Werkzeug hat den Parameter archiv, ohne Angabe gilt '" + S(ARCHIVE[0].name) + "'. Das Archiv nur wechseln, wenn der Anwender es will, " +
        "und in der Antwort nennen. Objekt-IDs, Masken und Vorlagen gelten nur im jeweiligen Archiv. " +
        "Eng suchen (Ordner, Maske, Felder), keine Massenabfragen. Workflows nur zu einem Objekt oder per ID.";
  } else {
    t = "ELO-Archiv" + (archiv ? " " + archiv : "") + ", Zugriff mit den Rechten des angemeldeten Benutzers (Stufen: " + stufenText() + "). " +
        "Eng suchen (Ordner, Maske, Felder), keine Massenabfragen. Workflows nur zu einem Objekt oder per ID.";
  }
  if (SCHREIBEN_ERLAUBT || BAUEN_ERLAUBT)
    t += " Schreibende Werkzeuge arbeiten zweistufig: erster Aufruf ohne token liefert eine Vorschau und ein token; " +
         "erst der zweite Aufruf mit denselben Argumenten plus token fuehrt aus. Die Vorschau dem Anwender zeigen " +
         "und seine Zustimmung abwarten, bevor das token benutzt wird.";
  return t;
}

function handle(msg) {
  var id = msg.id, m = S(msg.method);
  if (m === "initialize") {
    var pv = msg.params && msg.params.protocolVersion ? S(msg.params.protocolVersion) : "2025-06-18";
    return { jsonrpc: "2.0", id: id, result: { protocolVersion: pv, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: anweisungen() } };
  }
  if (m === "ping") return { jsonrpc: "2.0", id: id, result: {} };
  if (m === "tools/list") return { jsonrpc: "2.0", id: id, result: { tools: freieWerkzeuge() } };
  if (m === "tools/call") return { jsonrpc: "2.0", id: id, result: callTool(S(msg.params.name), msg.params.arguments) };
  if (m.indexOf("notifications/") === 0) return null;
  if (id === undefined || id === null) return null;
  return { jsonrpc: "2.0", id: id, error: { code: -32601, message: "Methode nicht unterstuetzt: " + m } };
}
