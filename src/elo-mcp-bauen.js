/*
 * elo-mcp-bauen.js - Stufe 3 des ELO-MCP-Servers: Eigenentwicklungen bauen.
 * Wird nach elo-mcp-schreiben.js geladen (nutzt zweiSchritte, protokoll, ...).
 *
 *   elo_workflow_export      Vorlage als Bauplan (JSON, Format in docs/BAUPLAN.md)
 *   elo_workflow_build       Vorlage aus Bauplan anlegen oder ersetzen (ID bleibt), mit Pruefungen
 *   elo_script_update        Neue Version eines Skript-/Regel-/Formulardokuments unter Administration
 *   elo_script_create        Neues Skript-/Regel-/Formulardokument unter Administration
 *
 * Nur mit ELO_MCP_BAUEN=1 (Schalter -Bauen in elo-mcp.ps1), am besten nur gegen ein
 * Testarchiv. Neu laden (ELOas, IX-Skripte) und Formulardesigner "Aktualisieren" bleiben
 * Handarbeit.
 *
 * Eingebaute Pruefungen, alle aus echten Stoerungen:
 *   - Sammelknoten ohne festen Zaehler (0 leitet beim ersten Vorgaenger weiter, -1 haengt bei IF-Zweigen)
 *   - Personenknoten ohne Weiterleitungs-Kante (der Vorgang bleibt dort haengen)
 *   - IX-Skript mit nicht aufloesbarem Include oder "//@include" ausserhalb der Kopfzeilen
 *     stoppt den ganzen Skript-Motor des Indexservers
 *   - IX-Skripte werden als cp1252 gelesen: Nicht-ASCII nur als \uXXXX
 */
var WFC = IXC.WFNodeC;
var FUNC_ICON = "(B7E96A85-0C63-B6AD-42E5-BA9F0018F01F)";
var PERSON_ICON = "(E10E1000-E100-E100-E100-E10E10E10EE2)";

function bauenPruefen() {
  if (!BAUEN_ERLAUBT) fail("Bauen" + freischaltHinweis(3));
}

function sicherungsOrdner() {
  var d = new java.io.File(new java.io.File(S(java.lang.System.getenv("LOCALAPPDATA")) || S(java.lang.System.getProperty("java.io.tmpdir")), "elo-mcp"), "sicherung");
  d.mkdirs();
  return d;
}
function zeitstempel() { return S(new java.text.SimpleDateFormat("yyyyMMdd-HHmmss").format(new java.util.Date())); }

/* ---------- Workflow: Vorlage <-> Bauplan ---------- */

function parseProps(p) {
  p = trim(p);
  if (!p) return undefined;
  try { return JSON.parse(p); } catch (e) { return p; }
}

function specFromWf(wf) {
  var spec = { name: S(wf.getName()), nodes: [], assocs: [] }, nicht = [];
  var nodes = wf.getNodes();
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i], t = n.getType();
    if (t === 0) continue;
    if (t > 6) nicht.push(S(n.getId()) + " " + (NODE_TYPE[t] || ("Typ " + t)));
    var o = { id: n.getId(), type: t, name: S(n.getName()) };
    if (S(n.getLabel())) o.label = S(n.getLabel());
    try { if (trim(n.getComment())) o.comment = S(n.getComment()); } catch (e) {}
    if (t === WFC.TYPE_PERSONNODE) { o.user = S(n.getUserName()); o.userId = n.getUserId(); }
    if (S(n.getFormSpec())) o.form = S(n.getFormSpec());
    if (S(n.getOnEnter())) o.onEnter = S(n.getOnEnter());
    if (S(n.getOnExit())) o.onExit = S(n.getOnExit());
    if (S(n.getYesNoCondition())) o.cond = S(n.getYesNoCondition());
    var pr = parseProps(n.getProperties()); if (pr !== undefined) o.props = pr;
    var tl = n.getTimeLimit();
    if (tl > 0) o.timeLimitDays = Math.round(tl / 1440 * 100) / 100;
    try {
      var es = n.getTimeLimitEscalations();
      if (es && es.length && es[0].getUserId() >= 0 && S(es[0].getUserName())) o.escalateTo = [S(es[0].getUserName()), es[0].getUserId()];
    } catch (e) {}
    var fl = n.getFlags() & ~WFC.FLAG_WORKINGDAYS;
    if (fl) o.flags = fl;
    if (t === WFC.TYPE_COLLECTNODE || n.getNbOfDonesToExit() !== 0) o.dones = n.getNbOfDonesToExit();
    o.x = n.getPosX(); o.y = n.getPosY();
    spec.nodes.push(o);
  }
  var as = wf.getMatrix() ? wf.getMatrix().getAssocs() : [];
  for (var j = 0; as && j < as.length; j++) {
    var e = [as[j].getNodeFrom(), as[j].getNodeTo()], ty = -3;
    try { ty = as[j].getType(); } catch (x) {}
    if (ty === -1) e.push("ja"); else if (ty === -2) e.push("nein");
    spec.assocs.push(e);
  }
  return { spec: spec, nichtUnterstuetzt: nicht };
}

function vorlageNachName(name) {
  var fwi = new IXC.FindWorkflowInfo(); fwi.setType(IXC.WFTypeC.TEMPLATE); fwi.setName(name);
  var fr = ELO.ix().findFirstWorkflows(fwi, 10, IXC.WFDiagramC.mbLean), ids = [];
  try { var w = fr.getWorkflows(); for (var i = 0; i < w.length; i++) if (S(w[i].getName()) === name) ids.push(S(w[i].getId())); }
  finally { try { ELO.ix().findClose(fr.getSearchId()); } catch (e) {} }
  return ids;
}

var benutzerCache = {};
function benutzerName(id) {
  var k = S(id);
  if (benutzerCache[k] === undefined) {
    try { benutzerCache[k] = S(ELO.ix().checkoutUser(k, IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO).getName()); }
    catch (e) { benutzerCache[k] = null; }
  }
  return benutzerCache[k];
}

function formularName(form) {
  var m = /^\[?\s*([A-Za-z0-9_\-.]+)\s*\(/.exec(S(form));
  return m ? m[1] : null;
}

/* Prueft den Bauplan. Liefert { fehler: [], warn: [] } */
function pruefePlan(spec) {
  var f = [], w = [], byId = {}, succ = {}, pred = {};
  if (!spec || typeof spec !== "object") return { fehler: ["Bauplan fehlt."], warn: w };
  if (!trim(spec.name)) f.push("name fehlt.");
  if (!spec.nodes || !spec.nodes.length) f.push("nodes fehlt oder leer.");
  if (!spec.assocs) f.push("assocs fehlt.");
  if (f.length) return { fehler: f, warn: w };
  var starts = 0, enden = 0;
  for (var i = 0; i < spec.nodes.length; i++) {
    var n = spec.nodes[i];
    if (typeof n.id !== "number" || n.id < 0 || n.id > 999 || n.id !== Math.floor(n.id)) { f.push("Knoten-ID ungueltig: " + JSON.stringify(n.id)); continue; }
    if (byId[n.id]) f.push("Knoten-ID doppelt: " + n.id);
    byId[n.id] = n; succ[n.id] = []; pred[n.id] = [];
    if (!(n.type >= 1 && n.type <= 6)) f.push("Knoten " + n.id + ": Typ " + n.type + " wird nicht unterstuetzt (1 Start, 2 Person, 3 Verteiler, 4 Entscheidung, 5 Sammler, 6 Ende).");
    if (n.type === 1) starts++;
    if (n.type === 6) enden++;
    if (!trim(n.name)) f.push("Knoten " + n.id + " ohne Namen.");
    if (n.props !== undefined && typeof n.props === "string") { try { JSON.parse(n.props); } catch (e) { w.push("Knoten " + n.id + ": props ist kein gueltiges JSON und wird als Text gespeichert."); } }
  }
  if (starts !== 1) f.push("Genau ein Startknoten (Typ 1) noetig, gefunden: " + starts + ".");
  if (enden < 1) f.push("Mindestens ein Endknoten (Typ 6) noetig.");
  for (var a = 0; a < spec.assocs.length; a++) {
    var e = spec.assocs[a];
    if (!e || e.length < 2 || !byId[e[0]] || !byId[e[1]]) { f.push("Verbindung auf unbekannten Knoten: " + JSON.stringify(e)); continue; }
    if (e[2] !== undefined && e[2] !== "ja" && e[2] !== "nein") f.push("Verbindung " + JSON.stringify(e) + ": dritter Wert nur \"ja\" oder \"nein\".");
    if (e[0] === e[1]) w.push("Knoten " + e[0] + " verweist auf sich selbst.");
    succ[e[0]].push(e); pred[e[1]].push(e[0]);
  }
  if (f.length) return { fehler: f, warn: w };

  for (var id in byId) {
    var n = byId[id], s = succ[id];
    if (n.type !== 6 && s.length === 0) f.push("Knoten " + id + " '" + n.name + "' hat keinen Nachfolger - der Vorgang bleibt dort haengen.");
    if (n.type === 6 && s.length) w.push("Endknoten " + id + " hat Nachfolger.");
    if (s.length > 20) f.push("Knoten " + id + " hat mehr als 20 Nachfolger.");
    if (n.type === 4) {
      if (!trim(n.cond)) f.push("Entscheidung " + id + " '" + n.name + "' ohne Bedingung (cond).");
      var ja = 0, nein = 0; for (var k = 0; k < s.length; k++) { if (s[k][2] === "ja") ja++; if (s[k][2] === "nein") nein++; }
      if (!ja || !nein) w.push("Entscheidung " + id + " '" + n.name + "': " + (!ja ? "keine ja-Kante" : "keine nein-Kante") + ".");
      for (var k2 = 0; k2 < s.length; k2++) if (byId[s[k2][1]].type === 5) w.push("Entscheidung " + id + " haengt direkt am Sammler " + s[k2][1] + " - besser einen leeren Verteiler 'Uebersprungen' dazwischen (Zaehler-Falle).");
    }
    if (n.type === 5) {
      if (typeof n.dones !== "number" || n.dones === 0) f.push("Sammler " + id + " '" + n.name + "' braucht dones = Zahl der Zweige (" + pred[id].length + " Vorgaenger). Ohne Zaehler leitet ELO beim ersten fertigen Vorgaenger weiter.");
      else if (n.dones === -1) w.push("Sammler " + id + ": dones -1 wartet auch auf Knoten, die ein IF uebersprungen hat, und bleibt dann stehen. Fester Zaehler ist sicherer.");
      else if (n.dones > pred[id].length) f.push("Sammler " + id + ": dones " + n.dones + " ist groesser als die Zahl der Vorgaenger (" + pred[id].length + ") - wuerde nie weiterleiten.");
    }
    if (n.type === 2) {
      if (!trim(n.user)) f.push("Personenknoten " + id + " '" + n.name + "' ohne Bearbeiter (user).");
      else if (typeof n.userId === "number" && n.userId < -1) { /* Sonderbearbeiter: -2 Eigentuemer, -3 ignorieren, -4 Vorgesetzter */ }
      else if (typeof n.userId === "number" && n.userId >= 0) {
        var nm = benutzerName(n.userId);
        if (nm === null) f.push("Personenknoten " + id + ": Benutzer-ID " + n.userId + " gibt es nicht.");
        else if (nm !== S(n.user)) w.push("Personenknoten " + id + ": ID " + n.userId + " ist '" + nm + "', im Bauplan steht '" + n.user + "'. ID gilt.");
      } else {
        try { n.userId = ELO.ix().checkoutUser(S(n.user), IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO).getId(); w.push("Personenknoten " + id + ": Benutzer-ID " + n.userId + " zu '" + n.user + "' ergaenzt."); }
        catch (e) { f.push("Personenknoten " + id + ": Benutzer '" + n.user + "' nicht gefunden."); }
      }
    }
    if (n.escalateTo && benutzerName(n.escalateTo[1]) === null) f.push("Knoten " + id + ": Eskalation an unbekannte Benutzer-ID " + n.escalateTo[1] + ".");
    if (n.form) {
      var fn = formularName(n.form);
      if (!fn) w.push("Knoten " + id + ": Formularangabe '" + n.form + "' nicht im Muster [name(seite,...)].");
      else { try { sordOf("Administration/ELOwf Base/Forms/" + fn); } catch (e) { w.push("Knoten " + id + ": Formular '" + fn + "' unter Administration/ELOwf Base/Forms nicht gefunden."); } }
    }
    if (n.type === 3 && n.onExit && !/^sol\./.test(S(n.onExit))) w.push("Verteiler " + id + ": Ende-Skript '" + n.onExit + "' ist kein sol.*-Baustein.");
  }
  // Erreichbarkeit
  var startId = null; for (var id2 in byId) if (byId[id2].type === 1) startId = id2;
  var seen = {}, todo = [startId];
  while (todo.length) { var x = todo.pop(); if (seen[x]) continue; seen[x] = true; for (var q = 0; q < succ[x].length; q++) todo.push(S(succ[x][q][1])); }
  for (var id3 in byId) if (!seen[id3]) w.push("Knoten " + id3 + " '" + byId[id3].name + "' ist vom Start aus nicht erreichbar.");
  var back = {}, todo2 = [];
  for (var id4 in byId) if (byId[id4].type === 6) todo2.push(id4);
  while (todo2.length) { var y = todo2.pop(); if (back[y]) continue; back[y] = true; for (var r = 0; r < pred[y].length; r++) todo2.push(S(pred[y][r])); }
  for (var id5 in byId) if (!back[id5] && seen[id5]) f.push("Von Knoten " + id5 + " '" + byId[id5].name + "' fuehrt kein Weg zu einem Ende.");
  return { fehler: f, warn: w };
}

function norm(o) {
  var c = {};
  for (var k in o) if (k !== "x" && k !== "y") c[k] = o[k];
  return JSON.stringify(c, Object.keys(c).sort());
}

function planDiff(alt, neu) {
  var a = {}, n = {}, res = { neueKnoten: [], entfernteKnoten: [], geaenderteKnoten: [], neueKanten: [], entfernteKanten: [] };
  for (var i = 0; i < alt.nodes.length; i++) a[alt.nodes[i].id] = alt.nodes[i];
  for (var j = 0; j < neu.nodes.length; j++) n[neu.nodes[j].id] = neu.nodes[j];
  for (var k in n) {
    if (!a[k]) { res.neueKnoten.push(k + " " + n[k].name); continue; }
    var felder = [], keys = {};
    for (var f1 in a[k]) keys[f1] = 1; for (var f2 in n[k]) keys[f2] = 1;
    for (var f in keys) if (f !== "x" && f !== "y" && JSON.stringify(a[k][f]) !== JSON.stringify(n[k][f])) felder.push(f);
    if (felder.length) res.geaenderteKnoten.push(k + " " + n[k].name + ": " + felder.join(", "));
  }
  for (var k2 in a) if (!n[k2]) res.entfernteKnoten.push(k2 + " " + a[k2].name);
  function kanten(s) { var m = {}; for (var i = 0; i < s.assocs.length; i++) m[s.assocs[i][0] + ">" + s.assocs[i][1] + (s.assocs[i][2] ? " " + s.assocs[i][2] : "")] = 1; return m; }
  var ka = kanten(alt), kn = kanten(neu);
  for (var e in kn) if (!ka[e]) res.neueKanten.push(e);
  for (var e2 in ka) if (!kn[e2]) res.entfernteKanten.push(e2);
  return res;
}

function eskalationen(spec) {
  var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.WFTimeLimit"), 2);
  for (var i = 0; i < 2; i++) {
    var e = new IXC.WFTimeLimit(); e.setUserId(-1); e.setUserName(""); e.setTimeLimit(0); e.setTimeLimitIso(""); arr[i] = e;
  }
  if (spec && spec.escalateTo && spec.timeLimitDays) {
    arr[0].setUserName(S(spec.escalateTo[0])); arr[0].setUserId(spec.escalateTo[1]); arr[0].setTimeLimit(Math.round(spec.timeLimitDays * 1440));
  }
  return arr;
}

/* Baut einen Knoten aus dem Bauplan. Bei Aktualisierung wird der vorhandene Knoten weiterverwendet,
   damit Eigenschaften ausserhalb des Bauplans (z. B. aus dem Designer) erhalten bleiben. */
function knotenBauen(spec, n) {
  n.setType(spec.type);
  n.setName(S(spec.name)); n.setLabel(S(spec.label || "")); n.setComment(S(spec.comment || ""));
  n.setOnEnter(S(spec.onEnter || "")); n.setOnExit(S(spec.onExit || "")); n.setYesNoCondition(S(spec.cond || ""));
  n.setFormSpec(S(spec.form || ""));
  n.setProperties(spec.props === undefined ? "" : (typeof spec.props === "string" ? spec.props : JSON.stringify(spec.props, null, 2)));
  n.setPosX(spec.x || 0); n.setPosY(spec.y || 0);
  var flags = spec.flags || 0;
  if (spec.type === WFC.TYPE_PERSONNODE) { n.setUserName(S(spec.user || "")); n.setUserId(typeof spec.userId === "number" ? spec.userId : -1); }
  else if (spec.type === WFC.TYPE_BEGINNODE) { n.setUserName("Eigent\u00fcmer"); n.setUserId(WFC.USERID_OWNER); }
  else { n.setUserName(""); n.setUserId(-1); }
  if (spec.type === WFC.TYPE_SPLITNODE && spec.onExit) n.setIconId(FUNC_ICON);
  else if (spec.type === WFC.TYPE_PERSONNODE) n.setIconId(PERSON_ICON);
  n.setTimeLimitEscalations(eskalationen(spec));
  if (spec.timeLimitDays) { n.setTimeLimit(Math.round(spec.timeLimitDays * 1440)); flags = flags | WFC.FLAG_WORKINGDAYS; } else n.setTimeLimit(0);
  n.setAllowActivate(true); n.setTag(-1); n.setDepartment2(-1);
  n.setFlags(flags);
  n.setNbOfDonesToExit(typeof spec.dones === "number" ? spec.dones : 0);
  return n;
}

function leererKnoten(i) {
  var n = new IXC.WFNode(); n.setId(i); n.setType(WFC.TYPE_NOTHING); n.setName(""); n.setUserId(-1); n.setUserName("");
  n.setTimeLimitEscalations(eskalationen(null)); n.setTag(-1); n.setDepartment2(-1);
  return n;
}

function sichereVorlage(id, suffix) {
  var opts = new IXC.WorkflowExportOptions(); opts.setFlowId(S(id)); opts.setCharacterSet("UTF-8");
  var fd = ELO.ix().exportWorkflow(opts);
  var f = new java.io.File(sicherungsOrdner(), "wf-" + id + "-" + zeitstempel() + suffix + ".ewf");
  var os = new java.io.FileOutputStream(f); try { os.write(fd.getData()); } finally { os.close(); }
  return S(f.getAbsolutePath());
}

function vorlageSchreiben(spec, updateId) {
  var wf, alt = null;
  if (updateId) {
    wf = ELO.ix().checkoutWorkFlow(S(updateId), IXC.WFTypeC.TEMPLATE, IXC.WFDiagramC.mbAll, IXC.LockC.YES);
    alt = wf.getNodes();
  } else {
    wf = ELO.ix().createWorkFlow(S(spec.name), IXC.WFTypeC.TEMPLATE);
  }
  try {
    var maxId = 0;
    for (var i = 0; i < spec.nodes.length; i++) if (spec.nodes[i].id > maxId) maxId = spec.nodes[i].id;
    if (alt) for (var i2 = 0; i2 < alt.length; i2++) if (alt[i2].getId() > maxId) maxId = alt[i2].getId();
    var size = maxId + 1, byId = {};
    for (var j = 0; j < spec.nodes.length; j++) byId[spec.nodes[j].id] = spec.nodes[j];
    var altById = {}; if (alt) for (var a = 0; a < alt.length; a++) altById[alt[a].getId()] = alt[a];
    var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.WFNode"), size);
    for (var k = 0; k < size; k++) {
      var s = byId[k], vorhanden = altById[k];
      if (!s) { arr[k] = leererKnoten(k); continue; }
      var n = (vorhanden && vorhanden.getType() === s.type) ? vorhanden : leererKnoten(k);
      arr[k] = knotenBauen(s, n);
    }
    wf.setNodes(arr);
    var as = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.WFNodeAssoc"), spec.assocs.length);
    for (var e = 0; e < spec.assocs.length; e++) {
      var x = spec.assocs[e];
      as[e] = new IXC.WFNodeAssoc(x[0], x[1], x[2] === "ja" ? -1 : (x[2] === "nein" ? -2 : -3));
    }
    var m = new IXC.WFNodeMatrix(); m.setAssocs(as); wf.setMatrix(m);
    return S(ELO.ix().checkinWorkFlow(wf, IXC.WFDiagramC.mbAll, updateId ? IXC.LockC.YES : IXC.LockC.NO));
  } catch (err) {
    if (updateId) { try { ELO.ix().checkinWorkFlow(wf, IXC.WFDiagramC.mbOnlyLock, IXC.LockC.YES); } catch (e2) { log("Vorlage " + updateId + " entsperren fehlgeschlagen: " + e2); } }
    throw err;
  }
}

tool("elo_workflow_export",
  "Liest eine Workflow-Vorlage als Bauplan (JSON) im Format von elo_workflow_build: name, nodes (id, type, name, user/userId, form, onExit, cond, props, timeLimitDays, escalateTo, dones, x, y), assocs [von, nach, 'ja'|'nein']. Zum Aendern exportieren, anpassen, mit elo_workflow_build zurueckschreiben.",
  { vorlage: { type: "string", description: "Vorlagen-ID oder exakter Name" } }, ["vorlage"], function (a) {
    var wf = ELO.ix().checkoutWorkFlow(trim(a.vorlage), IXC.WFTypeC.TEMPLATE, IXC.WFDiagramC.mbAll, IXC.LockC.NO);
    var r = specFromWf(wf);
    var res = { vorlageId: S(wf.getId()), bauplan: r.spec };
    if (r.nichtUnterstuetzt.length) res.warnung = "Knotentypen ohne Bauunterstuetzung: " + r.nichtUnterstuetzt.join(", ") + " - diese Vorlage nicht mit elo_workflow_build zurueckschreiben.";
    return res;
  });

/* Bauplan aus dem Argument oder aus einer lokalen Datei. Der Inhalt geht in den Fingerabdruck:
   aendert sich die Datei zwischen Vorschau und Ausfuehrung, wird abgelehnt. */
function bauplanLesen(a) {
  if (a.bauplan !== undefined && a.bauplanDatei) fail("Entweder bauplan oder bauplanDatei angeben, nicht beides.");
  if (a.bauplanDatei) {
    var d = lokaleDatei(a.bauplanDatei), t = S(new java.lang.String(java.nio.file.Files.readAllBytes(d.file.toPath()), "UTF-8")).replace(/^\ufeff/, "");
    try { return JSON.parse(t); } catch (e) { fail("bauplanDatei ist kein gueltiges JSON: " + S(e.message || e)); }
  }
  if (a.bauplan === undefined || a.bauplan === null) fail("bauplan oder bauplanDatei fehlt.");
  return JSON.parse(JSON.stringify(a.bauplan));
}

tool("elo_workflow_build",
  "Legt eine Workflow-Vorlage aus einem Bauplan an oder ersetzt eine vorhandene (vorlageId; ID und Name bleiben, Sicherung vorher). Zweistufig. Prueft Start/Ende, Erreichbarkeit, Kanten, Personen, Formulare, Sammler-Zaehler. Laufende Vorgaenge behalten ihre alte Kopie der Vorlage. Nur mit -Bauen.",
  { bauplan: { type: "object", description: "Bauplan wie aus elo_workflow_export" },
    bauplanDatei: { type: "string", description: "Alternativ: lokale JSON-Datei mit dem Bauplan (UTF-8)" },
    vorlageId: { type: "string", description: "Zum Ersetzen einer vorhandenen Vorlage; leer = neu anlegen" },
    token: P_TOKEN },
  [], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_workflow_build", a, function () {
      var spec = bauplanLesen(a), p = pruefePlan(spec), warn = p.warn.slice(), fp, diff = null, aktuell = null;
      if (p.fehler.length) fail("Bauplan fehlerhaft:\n- " + p.fehler.join("\n- ") + (warn.length ? "\nHinweise:\n- " + warn.join("\n- ") : ""));
      var gleich = vorlageNachName(S(spec.name));
      if (a.vorlageId) {
        var wf = ELO.ix().checkoutWorkFlow(trim(a.vorlageId), IXC.WFTypeC.TEMPLATE, IXC.WFDiagramC.mbAll, IXC.LockC.NO);
        if (S(wf.getName()) !== S(spec.name)) fail("Vorlage " + a.vorlageId + " heisst '" + S(wf.getName()) + "', der Bauplan '" + spec.name + "'. Umbenennen geht hier nicht.");
        if (S(wf.getLockName())) fail("Vorlage ist gesperrt von " + S(wf.getLockName()) + ".");
        aktuell = specFromWf(wf);
        if (aktuell.nichtUnterstuetzt.length) fail("Vorlage enthaelt Knotentypen ohne Bauunterstuetzung: " + aktuell.nichtUnterstuetzt.join(", "));
        diff = planDiff(aktuell.spec, spec);
        if (!diff.neueKnoten.length && !diff.entfernteKnoten.length && !diff.geaenderteKnoten.length && !diff.neueKanten.length && !diff.entfernteKanten.length) {
          warn.push("Keine inhaltliche Aenderung (hoechstens Positionen).");
        }
        warn.push("Laufende Vorgaenge dieser Vorlage aendern sich nicht - sie laufen mit ihrer Kopie der alten Vorlage weiter.");
        fp = "upd|" + S(wf.getId()) + "|" + norm({ s: JSON.stringify(aktuell.spec) });
      } else {
        if (gleich.length) fail("Es gibt schon eine Vorlage '" + spec.name + "' (" + gleich.join(", ") + "). Zum Ersetzen vorlageId angeben.");
        fp = "neu|" + S(spec.name);
      }
      var knoten = [];
      for (var k = 0; k < spec.nodes.length; k++) { var n = spec.nodes[k]; knoten.push(n.id + " " + (NODE_TYPE[n.type] || n.type) + " " + n.name + (n.user ? " (" + n.user + ")" : "") + (n.onExit ? " [" + n.onExit + "]" : "") + (n.form ? " " + n.form : "")); }
      var forms = []; for (var k2 = 0; k2 < spec.nodes.length; k2++) if (spec.nodes[k2].form) forms.push(spec.nodes[k2].form);
      if (forms.length) warn.push("Neue oder geaenderte Formulare erst nach 'Aktualisieren' im Formulardesigner sichtbar.");
      return { vorschau: { aktion: a.vorlageId ? "Vorlage ersetzen" : "Vorlage anlegen", vorlage: S(spec.name) + (a.vorlageId ? " [" + a.vorlageId + "]" : ""),
                           knoten: knoten, kanten: spec.assocs.length, aenderungen: diff },
               warnungen: warn, fp: fp + "|" + JSON.stringify(spec), spec: spec, updateId: a.vorlageId ? trim(a.vorlageId) : null };
    }, function (p) {
      var sich = p.updateId ? sichereVorlage(p.updateId, "-vorher") : null;
      var id = vorlageSchreiben(p.spec, p.updateId);
      var nach = sichereVorlage(id, "-nachher");
      var chk = ELO.ix().checkoutWorkFlow(id, IXC.WFTypeC.TEMPLATE, IXC.WFDiagramC.mbAll, IXC.LockC.NO), cn = chk.getNodes(), real = 0;
      for (var i = 0; i < cn.length; i++) if (cn[i].getType() !== 0) real++;
      return { vorlageId: id, name: S(chk.getName()), knotenGelesen: real, kantenGelesen: chk.getMatrix().getAssocs().length,
               sicherungVorher: sich, sicherungNachher: nach };
    });
  }, 3);

/* ---------- Skripte, Regeln, Formulare ---------- */

function dekodiere(bytes) {
  var dec = java.nio.charset.StandardCharsets.UTF_8.newDecoder();
  try { var s = S(dec.decode(java.nio.ByteBuffer.wrap(bytes)).toString()); return { text: s.replace(/^\ufeff/, ""), charset: "UTF-8", bom: s.charAt(0) === "\ufeff" }; }
  catch (e) { return { text: S(new java.lang.String(bytes, "windows-1252")), charset: "windows-1252", bom: false }; }
}

function kompiliere(src, name) {
  // ToolErrorReporter schreibt jede Meldung mit Zeile in den Puffer (eigener JavaAdapter-Reporter fuehrte zu StackOverflow).
  var cx = Packages.org.mozilla.javascript.Context.enter(), alt = cx.getErrorReporter();
  var puffer = new java.io.ByteArrayOutputStream();
  cx.setErrorReporter(new Packages.org.mozilla.javascript.tools.ToolErrorReporter(false, new java.io.PrintStream(puffer, true, "UTF-8")));
  try { cx.compileString(src, name, 1, null); return null; }
  catch (e) {
    var m = trim(S(puffer.toString("UTF-8"))).split(/\r?\n/).filter(function (l) { return trim(l) && !/^(js:)?\s*\.*\^\s*$/.test(l); }).slice(0, 6).join(" | ");
    return m || S(e.message || e).replace(/^.*?EvaluatorException:\s*/, "");
  }
  finally { cx.setErrorReporter(alt); Packages.org.mozilla.javascript.Context.exit(); }
}

function includePruefen(text, f, w) {
  var lines = text.split(/\r?\n/), kopf = true, incs = [];
  for (var i = 0; i < lines.length; i++) {
    var l = trim(lines[i]);
    if (kopf && (l === "" || /^\/\//.test(l))) { var m = /^\/\/@include\s+(\S+)/.exec(l); if (m) incs.push(m[1]); continue; }
    kopf = false;
    if (lines[i].indexOf("@include") >= 0) f.push("Zeile " + (i + 1) + ": '@include' ausserhalb der Kopfzeilen - der Indexserver liest das ueberall als Include und stoppt bei Fehlern den ganzen Skript-Motor.");
  }
  for (var k = 0; k < incs.length; k++) {
    var nm = incs[k].replace(/\.js$/i, ""), fi = new IXC.FindInfo(), fb = new IXC.FindByIndex(), fc = new IXC.FindChildren();
    fb.setName(nm); fi.setFindByIndex(fb);
    fc.setParentId(S(sordOf("Administration").getId())); fc.setEndLevel(-1); fi.setFindChildren(fc);
    var r = findSords(fi, 3, IXC.SordC.mbLean), da = false;
    for (var j = 0; j < r.sords.length; j++) if (S(r.sords[j].getName()) === nm) da = true;
    if (!da) f.push("Include '" + incs[k] + "' unter Administration nicht gefunden - wuerde den Skript-Motor stoppen.");
  }
  if (incs.length) w.push("Includes: " + incs.join(", ") + " (gefunden; ob sie aus diesem Ordner aufloesbar sind, haengt vom Paket ab - eigene Skripte gehoeren in ein Paket unter Business Solutions Custom mit Referenz in IndexServer Scripting Base/_ALL/business_solutions).");
}

/* Prueft Inhalt je nach Art. Liefert { fehler, warn, art } */
function pruefeSkript(text, ext, pfad) {
  var f = [], w = [], art = "Text";
  ext = S(ext).toLowerCase();
  if (/<ruleset[\s>]/.test(text)) {
    art = "ELOas-Regel";
    try {
      var dbf = javax.xml.parsers.DocumentBuilderFactory.newInstance();
      dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      var doc = dbf.newDocumentBuilder().parse(new org.xml.sax.InputSource(new java.io.StringReader(text)));
      var tags = ["script", "onstart", "onend", "condition"], n = 0;
      for (var t = 0; t < tags.length; t++) {
        var nl = doc.getElementsByTagName(tags[t]);
        for (var i = 0; i < nl.getLength(); i++) {
          var src = S(nl.item(i).getTextContent()); if (!trim(src)) continue; n++;
          var err = kompiliere(src, tags[t] + "#" + (i + 1)); if (err) f.push("<" + tags[t] + "> Nr. " + (i + 1) + ": " + err);
        }
      }
      w.push(n + " Skriptteile kompiliert (nur Syntax).");
    } catch (e) { f.push("XML nicht wohlgeformt: " + S(e.message || e)); }
  } else if (ext === "js" || /IndexServer Scripting Base|Business Solutions/.test(pfad) && /function|var |sol\.define/.test(text)) {
    art = "JavaScript";
    var err2 = kompiliere(text, "skript.js"); if (err2) f.push("Syntaxfehler: " + err2);
  } else if (ext === "json") {
    art = "JSON";
    try { JSON.parse(text); } catch (e) { f.push("JSON ungueltig: " + S(e.message || e)); }
  }
  if (/IndexServer Scripting Base|Business Solutions/.test(pfad) && art === "JavaScript") {
    includePruefen(text, f, w);
    if (/[^\x00-\x7f]/.test(text)) f.push("Nicht-ASCII-Zeichen gefunden: IX-Skripte werden als cp1252 gelesen - Umlaute als \\uXXXX schreiben.");
  }
  return { fehler: f, warn: w, art: art };
}

function zeilenDiff(alt, neu) {
  var a = alt.split(/\r?\n/), b = neu.split(/\r?\n/), p = 0, s = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  var raus = a.slice(p, a.length - s), rein = b.slice(p, b.length - s);
  return { zeilenAlt: a.length, zeilenNeu: b.length, ab: p + 1, entfernt: raus.length, eingefuegt: rein.length,
           alt: raus.slice(0, 30).join("\n") + (raus.length > 30 ? "\n..." : ""), neu: rein.slice(0, 30).join("\n") + (rein.length > 30 ? "\n..." : "") };
}

function nachArbeit(pfad) {
  if (/ELOas Base/.test(pfad)) return "ELOas-Regel neu laden (ELOas-Statusseite).";
  if (/ELOwf Base\/Forms/.test(pfad)) return "Formulardesigner 'Aktualisieren'.";
  if (/IndexServer Scripting Base|Business Solutions/.test(pfad)) return "IX-Skripte neu laden und danach die Statusseite des Indexservers pruefen: Skript-Motor 'Running'.";
  return "";
}

function inhaltLesen(a) {
  if (a.inhalt !== undefined && a.datei) fail("Entweder inhalt oder datei angeben, nicht beides.");
  if (a.datei) { var d = lokaleDatei(a.datei); return S(new java.lang.String(java.nio.file.Files.readAllBytes(d.file.toPath()), "UTF-8")).replace(/^\ufeff/, ""); }
  if (a.inhalt === undefined) fail("inhalt oder datei fehlt.");
  return S(a.inhalt);
}

function tempDatei(text, charset, bom, ext) {
  var f = java.io.File.createTempFile("elo-mcp-", "." + (ext || "txt"));
  f.deleteOnExit();
  var os = new java.io.FileOutputStream(f);
  try { if (bom) { os.write(0xEF); os.write(0xBB); os.write(0xBF); } os.write(new java.lang.String(text).getBytes(charset)); } finally { os.close(); }
  return f;
}

function unterAdministration(s) {
  var p = pathOf(s);
  if (!/^Administration(\/|$)/.test(p)) fail("Nur Objekte unter Administration (ELOas Base, ELOwf Base, IndexServer Scripting Base, Business Solutions ...). Pfad: " + p);
  return p;
}

tool("elo_script_update",
  "Neue Version eines Skript-, Regel- oder Formulardokuments unter Administration (zweistufig). Prueft vorher: ELOas-Regeln (XML + alle Skriptteile kompilieren), JavaScript (Syntax), IX-Skripte (Includes, @include nur in Kopfzeilen, nur ASCII), JSON. Zeigt die Aenderung als Zeilenvergleich. Neu laden bleibt Handarbeit. Nur mit -Bauen.",
  { objekt: P_OBJ, inhalt: { type: "string", description: "Neuer vollstaendiger Inhalt (Text)" },
    datei: { type: "string", description: "Alternativ: lokale Datei mit dem neuen Inhalt" },
    kommentar: { type: "string", description: "Versionskommentar, Pflicht, max. 64 Zeichen" }, token: P_TOKEN },
  ["objekt", "kommentar"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_script_update", a, function () {
      var v = versionsOf(a.objekt), s = v.sord, akt = null;
      if (isFolder(s)) fail("Ordner, kein Dokument.");
      var pfad = unterAdministration(s) + "/" + S(s.getName());
      var kommentar = trim(a.kommentar); if (!kommentar) fail("kommentar ist Pflicht."); if (kommentar.length > 64) fail("Versionskommentar hoechstens 64 Zeichen.");
      if (S(s.getLockName())) fail("Dokument ist gesperrt von " + S(s.getLockName()) + ".");
      for (var i = 0; i < v.docs.length; i++) if (v.docs[i].isWorkVersion()) akt = v.docs[i];
      if (!akt) fail("Keine aktuelle Version.");
      var altBytes = readAll(ELO.connect().download(akt.getUrl(), 0, -1), LIMIT.dateiBytes), alt = dekodiere(altBytes);
      var neu = inhaltLesen(a);
      if (neu === alt.text) fail("Inhalt ist identisch mit der aktuellen Version.");
      var chk = pruefeSkript(neu, akt.getExt(), pfad);
      if (chk.fehler.length) fail(chk.art + " fehlerhaft, nichts hochgeladen:\n- " + chk.fehler.join("\n- "));
      var warn = chk.warn.slice(), na = nachArbeit(pfad); if (na) warn.push("Danach: " + na);
      if (alt.charset !== "UTF-8") warn.push("Bisherige Version ist " + alt.charset + " - neue wird ebenso gespeichert.");
      return { vorschau: { aktion: "Skript/Regel/Formular aktualisieren", objekt: S(s.getName()) + " [" + S(s.getId()) + "]", pfad: pfad, art: chk.art,
                           kommentar: kommentar, aenderung: zeilenDiff(alt.text, neu) },
               warnungen: warn, fp: fingerprintSord(s) + "|" + S(akt.getId()) + "|" + S(akt.getMd5()), sord: s, akt: akt, neu: neu, alt: alt, kommentar: kommentar };
    }, function (p) {
      var id = S(p.sord.getId()), f = tempDatei(p.neu, p.alt.charset, p.alt.bom, S(p.akt.getExt()));
      try {
        var ed = ELO.ix().checkoutDoc(id, null, IXC.EditInfoC.mbAll, IXC.LockC.YES);
        try {
          var dv = new IXC.DocVersion(); dv.setExt(S(p.akt.getExt())); dv.setComment(p.kommentar); dv.setPathId(p.akt.getPathId());
          var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.DocVersion"), 1); arr[0] = dv;
          var doc = ed.getDocument(); doc.setDocs(arr);
          doc = ELO.ix().checkinDocBegin(doc);
          doc.getDocs()[0].setUploadResult(ELO.connect().upload(doc.getDocs()[0].getUrl(), f));
          doc = ELO.ix().checkinDocEnd(ed.getSord(), IXC.SordC.mbAll, doc, IXC.LockC.YES);
          return { id: id, name: S(p.sord.getName()), neueVersionId: S(doc.getDocs()[0].getId()), vorherigeVersionId: S(p.akt.getId()), danach: nachArbeit(pathOf(p.sord)) };
        } catch (e) { unlockSord(id); throw e; }
      } finally { f["delete"](); }
    });
  }, 3);

tool("elo_script_create",
  "Legt ein neues Skript-, Regel- oder Formulardokument in einem Ordner unter Administration an (zweistufig). Maske, Rechte, Typ und Endung kommen von einem Geschwisterdokument, sonst angeben. Gleiche Pruefungen wie elo_script_update. Nur mit -Bauen.",
  { ordner: { type: "string", description: "Zielordner unter Administration" }, name: { type: "string" },
    inhalt: { type: "string" }, datei: { type: "string" },
    endung: { type: "string", description: "Dateiendung, Standard: die des Vorbilds" },
    wie: { type: "string", description: "Vorbild-Objekt fuer Maske/Rechte/Typ, Standard: erstes Dokument im Ordner" },
    kommentar: { type: "string" }, token: P_TOKEN },
  ["ordner", "name"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_script_create", a, function () {
      var o = ordnerPruefen(a.ordner), opfad = unterAdministration(o) + "/" + S(o.getName()), name = trim(a.name), warn = [];
      if (!name) fail("name ist leer.");
      var gleich = namensgleiche(o.getId(), name); if (gleich.length) fail("Im Ordner gibt es schon '" + name + "' (" + gleich.join(", ") + "). Dafuer elo_script_update nehmen.");
      var vorbild = null;
      if (a.wie) vorbild = sordOf(a.wie);
      else { var k = ELO.children(S(o.getId()), 50); for (var i = 0; i < k.length; i++) if (!isFolder(k[i])) { vorbild = k[i]; break; } }
      if (!vorbild) fail("Kein Vorbilddokument im Ordner - bitte wie angeben.");
      var vv = versionsOf(S(vorbild.getId())), vext = "";
      for (var j = 0; j < vv.docs.length; j++) if (vv.docs[j].isWorkVersion()) vext = S(vv.docs[j].getExt());
      var ext = trim(a.endung) || vext || "txt", neu = inhaltLesen(a);
      var chk = pruefeSkript(neu, ext, opfad);
      if (chk.fehler.length) fail(chk.art + " fehlerhaft, nichts angelegt:\n- " + chk.fehler.join("\n- "));
      warn = warn.concat(chk.warn);
      if (/IndexServer Scripting Base\/_ALL\/(?!business_solutions)/.test(opfad + "/")) warn.push("Direkt unter IndexServer Scripting Base/_ALL werden Includes aus Business-Solutions-Paketen nicht aufgeloest, und ein nicht aufloesbarer Include stoppt den ganzen Skript-Motor. Eigene Skripte besser in ein Paket unter Business Solutions Custom.");
      var na = nachArbeit(opfad); if (na) warn.push("Danach: " + na);
      var kommentar = trim(a.kommentar) || "angelegt ueber ELO-MCP"; if (kommentar.length > 64) fail("Versionskommentar hoechstens 64 Zeichen.");
      return { vorschau: { aktion: "Skript/Regel/Formular anlegen", in: opfad + " [" + S(o.getId()) + "]", name: name, endung: ext, art: chk.art,
                           vorbild: S(vorbild.getName()) + " [" + S(vorbild.getId()) + "], Maske " + S(vorbild.getMaskName()), zeilen: neu.split(/\r?\n/).length },
               warnungen: warn, fp: S(o.getId()) + "|" + gleich.join(",") + "|" + S(vorbild.getId()), ordner: o, vorbild: vorbild, ext: ext, neu: neu, name: name, kommentar: kommentar };
    }, function (p) {
      var f = tempDatei(p.neu, "UTF-8", false, p.ext);
      try {
        var ed = ELO.ix().createDoc(S(p.ordner.getId()), S(p.vorbild.getMask()), null, IXC.EditInfoC.mbSordDoc), s = ed.getSord();
        s.setName(p.name); s.setType(p.vorbild.getType()); s.setAclItems(p.vorbild.getAclItems());
        var dv = new IXC.DocVersion(); dv.setExt(p.ext); dv.setComment(p.kommentar);
        var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.DocVersion"), 1); arr[0] = dv;
        var doc = ed.getDocument(); doc.setDocs(arr);
        doc = ELO.ix().checkinDocBegin(doc);
        doc.getDocs()[0].setUploadResult(ELO.connect().upload(doc.getDocs()[0].getUrl(), f));
        doc = ELO.ix().checkinDocEnd(s, IXC.SordC.mbAll, doc, IXC.LockC.NO);
        return { id: S(doc.getObjId()), name: p.name, danach: nachArbeit(pathOf(p.ordner) + "/" + S(p.ordner.getName())) };
      } finally { f["delete"](); }
    });
  }, 3);
