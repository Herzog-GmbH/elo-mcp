/*
 * elo-mcp-ergaenzungen.js - Objektfarben, registrierte Funktionen, Formulardesigner "Aktualisieren".
 * Wird nach elo-mcp-notizen.js geladen (nutzt sordOf, pathOf, isFolder, errText aus elo-mcp.js; zweiSchritte,
 * P_TOKEN, unlockSord aus elo-mcp-schreiben.js; sicherungsOrdner, zeitstempel, bauenPruefen aus elo-mcp-bauen.js;
 * hat, objektListe aus elo-mcp-notizen.js).
 *
 * elo_colors (Stufe 1)         Farbliste des Archivs, auf Wunsch die Farbe einzelner Objekte
 * elo_color_set (Stufe 2)      Farbe eines Objekts setzen (ID oder Name), Vorschau bisher/neu, Sicherung
 * elo_function_read (Stufe 1)  registrierte Funktion aufrufen, nur eine feste Liste lesender Funktionen
 * elo_function_call (Stufe 3)  beliebige registrierte Funktion, zweistufig mit Vorschau des Aufrufs
 * elo_form_reload (Stufe 3)    Formulardesigner "Aktualisieren": ELOwf liest die Formulare neu
 *
 * Fallen:
 *   - Die Standardfarben heissen in ELO 25 "ELO.COLOR.RED" usw., der Anzeigename ("Rot") haengt an der Sprache.
 *     Eigene Farben (Business Solutions, von Hand angelegt) haben nur einen Namen, zwei Farben koennen gleich
 *     angezeigt werden. Deshalb nimmt elo_color_set ID oder Name und lehnt mehrdeutige Namen ab.
 *   - RGB steht als Windows-COLORREF (0x00BBGGRR) im Archiv, nicht als #RRGGBB.
 *   - Ob eine registrierte Funktion schreibt, sieht man ihr nicht an; nur die Liste RF_LESEND gilt als lesend.
 *   - edit.jsp?reload=1 braucht das Anmeldeticket als Parameter; es geht nur an den Server des Indexservers.
 */

var LIMIT_FARBE = { objekte: 10, workflows: 5 };
var LIMIT_RF = { parameter: 20000, antwort: 50000, vorschau: 4000, ids: 50, treffer: 300, standardTreffer: 100 };
var RX_RF = /^RF_[A-Za-z0-9_]{1,200}$/;

function jsonSichern(name, inhalt) {
  var f = new java.io.File(sicherungsOrdner(), name + "-" + zeitstempel() + ".json");
  var w = new java.io.OutputStreamWriter(new java.io.FileOutputStream(f), "UTF-8");
  try { w.write(JSON.stringify(inhalt, null, 1)); } finally { w.close(); }
  return S(f.getAbsolutePath());
}

/* ---------- Farben ---------- */

var farbenCache = null;

/* ELO speichert die Farbe als Windows-COLORREF (0x00BBGGRR). */
function farbeHex(v) {
  function h(n) { var s = n.toString(16).toUpperCase(); return s.length < 2 ? "0" + s : s; }
  return "#" + h(v & 255) + h((v >> 8) & 255) + h((v >> 16) & 255);
}

function farbeAus(c) {
  function opt(f) { try { return S(f()); } catch (e) { return ""; } }
  var f = { id: Number(c.getId()), name: S(c.getName()), anzeige: opt(function () { return c.getDisplayName(); }),
            kurz: opt(function () { return c.getSpecName(); }), rgb: farbeHex(Number(c.getRGB())) };
  try { if (c.isHidden()) f.ausgeblendet = true; } catch (e) {}
  try { if (c.isDeleted()) f.geloescht = true; } catch (e) {}
  return f;
}

function farbenLesen() {
  if (farbenCache) return farbenCache;
  var c = ELO.ix().checkoutColors(IXC.LockC.NO), out = [];
  for (var i = 0; c && i < c.length; i++) out.push(farbeAus(c[i]));
  farbenCache = out;
  return out;
}

function farbeText(f) { return f.id + " " + f.name + (f.anzeige && f.anzeige !== f.name ? " (" + f.anzeige + ")" : ""); }

/* Farbe eines Objekts (Sord.kind) mit Name; 0 ist die Systemfarbe, also keine eigene Farbe. */
function farbeKurz(id, liste) {
  id = Number(id);
  liste = liste || farbenLesen();
  for (var i = 0; i < liste.length; i++) {
    if (liste[i].id !== id) continue;
    var o = { id: id, name: liste[i].name };
    if (liste[i].anzeige && liste[i].anzeige !== liste[i].name) o.anzeige = liste[i].anzeige;
    if (liste[i].geloescht) o.hinweis = "Farbe ist geloescht";
    return o;
  }
  return id === 0 ? { id: 0, name: "(keine Farbe)" } : { id: id, hinweis: "nicht in der Farbliste des Archivs" };
}

function farbenAuswahl(liste) {
  var t = [];
  for (var i = 0; i < liste.length; i++) if (!liste[i].geloescht) t.push(farbeText(liste[i]));
  return "Moeglich: " + t.join(", ") + ".";
}

/* ID, Name ("ELO.COLOR.RED"), Kurzname ("red", auch "ELO.COLOR." davor ergaenzt) oder Anzeigename ("Rot"). */
function farbeFinden(v, liste) {
  liste = liste || farbenLesen();
  var t = trim(v), treffer = [], i;
  if (t === "") fail("farbe fehlt.");
  if (/^\d+$/.test(t)) {
    for (i = 0; i < liste.length; i++) if (liste[i].id === parseInt(t, 10)) treffer.push(liste[i]);
    if (!treffer.length) fail("Eine Farbe mit der ID " + t + " gibt es nicht. " + farbenAuswahl(liste));
  } else {
    var k = t.toLowerCase();
    for (i = 0; i < liste.length; i++) {
      var f = liste[i], n = f.name.toLowerCase();
      if (n === k || n === "elo.color." + k || f.anzeige.toLowerCase() === k || f.kurz.toLowerCase() === k) treffer.push(f);
    }
    if (!treffer.length) fail("Farbe '" + t + "' nicht gefunden. " + farbenAuswahl(liste));
    if (treffer.length > 1) {
      var m = [];
      for (i = 0; i < treffer.length; i++) m.push(farbeText(treffer[i]));
      fail("Farbe '" + t + "' ist mehrdeutig: " + m.join(", ") + ". Bitte die ID angeben.");
    }
  }
  if (treffer[0].geloescht) fail("Farbe " + farbeText(treffer[0]) + " ist geloescht.");
  return treffer[0];
}

function laufendeWorkflows(objId) {
  var fwi = new IXC.FindWorkflowInfo(); fwi.setType(IXC.WFTypeC.ACTIVE); fwi.setObjId(S(objId));
  var fr = ELO.ix().findFirstWorkflows(fwi, LIMIT_FARBE.workflows, IXC.WFDiagramC.mbLean), out = [];
  try { var w = fr.getWorkflows(); for (var i = 0; w && i < w.length; i++) out.push(S(w[i].getId()) + " '" + S(w[i].getName()) + "'"); }
  finally { try { ELO.ix().findClose(fr.getSearchId()); } catch (e) {} }
  return out;
}

tool("elo_colors",
  "Farbliste des Archivs (ID, Name, Anzeigename, Kurzname, RGB) und auf Wunsch die Farbe einzelner Objekte. " +
  "In ELO 25 heissen die Standardfarben ELO.COLOR.RED usw., der Anzeigename haengt an der Sprache; eigene Farben haben nur einen Namen. " +
  "Farbe 0 ist die Systemfarbe (keine eigene Farbe). Setzen: elo_color_set mit ID oder Name.",
  { objekt: { description: "Optional: Objekt (ID, GUID oder Archivpfad) oder Liste bis " + LIMIT_FARBE.objekte + ", deren Farbe gezeigt wird",
              anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    ohneListe: { type: "boolean", description: "Nur mit objekt: die Farbliste weglassen" } },
  [], function (a) {
    var liste = farbenLesen(), o = {}, mitObjekt = a.objekt !== undefined && a.objekt !== null && a.objekt !== "";
    if (a.ohneListe && !mitObjekt) fail("ohneListe gilt nur zusammen mit objekt.");
    if (mitObjekt) {
      var ids = objektListe(a.objekt, LIMIT_FARBE.objekte), res = [];
      for (var i = 0; i < ids.length; i++) {
        var s = sordOf(ids[i]);
        res.push({ id: S(s.getId()), name: S(s.getName()), art: isFolder(s) ? "Ordner" : "Dokument", farbe: farbeKurz(s.getKind(), liste) });
      }
      o.objekte = res;
    }
    if (!a.ohneListe) { o.farben = liste.length; o.liste = liste; }
    return o;
  });

function farbePlan(a) {
  var s = sordOf(a.objekt), id = S(s.getId()), liste = farbenLesen(), neu = farbeFinden(a.farbe, liste), alt = Number(s.getKind()), warn = [];
  if (S(s.getLockName())) fail("Objekt ist gesperrt von " + S(s.getLockName()) + ".");
  if (alt === neu.id) fail("Keine Aenderung: Das Objekt hat schon die Farbe " + farbeText(neu) + ".");
  if (neu.ausgeblendet) warn.push("Die Farbe " + farbeText(neu) + " ist in der Farbliste ausgeblendet.");
  var wf = laufendeWorkflows(id);
  if (wf.length) warn.push("Auf dem Objekt laeuft Workflow " + wf.join(", ") + ". Setzt dessen Skript die Farbe (Status), gilt nach dem naechsten Schritt wieder dessen Farbe.");
  return { id: id, name: S(s.getName()), pfad: pathOf(s), alt: alt, neu: neu, warnungen: warn,
           fp: id + "|" + alt + "|" + S(s.getLockId()),
           vorschau: { aktion: "Farbe setzen", objekt: S(s.getName()) + " [" + id + "]", pfad: pathOf(s), bisher: farbeKurz(alt, liste), neu: farbeKurz(neu.id, liste) } };
}

tool("elo_color_set",
  "Setzt die Farbe eines Objekts (zweistufig: Vorschau bisher/neu mit ID und Name, dann mit token ausfuehren; Sicherung der alten Farbe, danach zuruecklesen). " +
  "farbe: ID (aus elo_colors), Name (ELO.COLOR.RED), Kurzname (red) oder Anzeigename (Rot); mehrdeutige Namen werden abgelehnt. 0 = keine eigene Farbe. " +
  "Sonst aendert sich nichts am Objekt. Steuert ein Workflow die Farbe als Status, gehoert die Aenderung dorthin.",
  { objekt: P_OBJ, farbe: { description: "ID oder Name der Farbe", anyOf: [{ type: "string" }, { type: "integer" }] }, token: P_TOKEN },
  ["objekt", "farbe"], function (a) {
    return zweiSchritte("elo_color_set", a, function () { return farbePlan(a); }, function (p) {
      var sicherung = jsonSichern("farbe-" + p.id + "-vorher", { id: p.id, name: p.name, pfad: p.pfad, farbe: farbeKurz(p.alt) });
      var s = ELO.ix().checkoutSord(p.id, IXC.EditInfoC.mbSord, IXC.LockC.YES).getSord();
      try {
        s.setKind(p.neu.id);
        ELO.ix().checkinSord(s, new IXC.SordZ(IXC.SordC.mbKind), IXC.LockC.YES);
      } catch (e) { unlockSord(p.id); throw e; }
      var ist = Number(sordOf(p.id).getKind());
      return { objekt: p.name, id: p.id, farbe: farbeKurz(ist), rueckgelesen: ist === p.neu.id ? "ok, wie geplant" : "ABWEICHUNG: Farbe ist " + ist,
               sicherungVorher: sicherung, hinweis: "Zuruecknehmen: elo_color_set mit farbe=\"" + p.alt + "\"." };
    });
  }, 2);

/* ---------- Registrierte Funktionen ---------- */

function kopie(o) { return JSON.parse(JSON.stringify(o)); }
function istObjekt(o) { return !!o && typeof o === "object" && !(o instanceof Array); }

/* Lesende Funktionen, die elo_function_read ohne Freigabe aufruft. Jede pruefen-Funktion grenzt die Abfrage ein. */
var RF_LESEND = {
  RF_sol_common_service_SordProvider: {
    text: "Business Solutions common: liest Objekte zu IDs (ids, hoechstens " + LIMIT_RF.ids + ") oder per Suche (masks und search, hoechstens " + LIMIT_RF.treffer +
          " Treffer) mit den Rechten des Anwenders. output nennt die Werte: {source: {type: SORD|GRP|MAP, key}, target: {prop}}.",
    pruefen: function (p, warn) {
      if (!istObjekt(p)) fail("parameter: Objekt erwartet, z. B. {\"ids\": [\"4711\"], \"output\": [{\"source\": {\"type\": \"SORD\", \"key\": \"name\"}, \"target\": {\"prop\": \"name\"}}]}.");
      if (!(p.output instanceof Array) || !p.output.length) fail("SordProvider: output (Liste der gewuenschten Werte) fehlt.");
      if (p.ids !== undefined) {
        if (p.search !== undefined || p.masks !== undefined) fail("SordProvider: entweder ids oder masks mit search.");
        if (!(p.ids instanceof Array) || !p.ids.length) fail("ids: Liste von Objekt-IDs erwartet.");
        if (p.ids.length > LIMIT_RF.ids) fail("Hoechstens " + LIMIT_RF.ids + " ids je Aufruf.");
      } else {
        if (!(p.masks instanceof Array) || !p.masks.length) fail("SordProvider: ids oder masks mit search angeben. Eine Suche ohne Maske ist gesperrt (Massenabfrage).");
        if (!(p.search instanceof Array) || !p.search.length) fail("SordProvider: search (Liste von {key, value}) fehlt. Eine ganze Maske ohne Eingrenzung wird nicht gelesen.");
        if (!istObjekt(p.options)) p.options = {};
        var m = parseInt(p.options.maxResults, 10);
        if (!(m > 0)) { p.options.maxResults = LIMIT_RF.standardTreffer; warn.push("options.maxResults fehlte, auf " + LIMIT_RF.standardTreffer + " gesetzt."); }
        else if (m > LIMIT_RF.treffer) { p.options.maxResults = LIMIT_RF.treffer; warn.push("options.maxResults auf " + LIMIT_RF.treffer + " begrenzt."); }
      }
      return p;
    }
  }
};
function rfLesendNamen() { var n = []; for (var k in RF_LESEND) if (hat(RF_LESEND, k)) n.push(k); return n; }

function rfParameterText(v) {
  var t;
  if (v === undefined || v === null) t = "";
  else if (typeof v === "string") t = v;
  else t = JSON.stringify(v);
  if (t.length > LIMIT_RF.parameter) fail("parameter hat " + t.length + " Zeichen, hoechstens " + LIMIT_RF.parameter + ".");
  return t;
}

function rfAufrufen(name, text) {
  var any = new IXC.Any(), C = IXC.AnyC;
  any.setType(C.TYPE_STRING); any.setStringValue(text);
  var r = ELO.ix().executeRegisteredFunction(name, any);
  if (r === null) return { text: "" };
  var t = Number(r.getType());
  if (t === C.TYPE_STRING) return { text: S(r.getStringValue()) };
  if (t === C.TYPE_INT) return { wert: Number(r.getIntValue()) };
  if (t === C.TYPE_LONG) return { wert: S(r.getLongValue()) };
  if (t === C.TYPE_DOUBLE) return { wert: Number(r.getDoubleValue()) };
  return { text: S(r.getStringValue()), typ: t, hinweis: "Antworttyp " + t + " (AnyC) wird nicht ausgewertet, gezeigt ist nur der Textwert." };
}

function rfAntwort(name, r, warn) {
  var o = { funktion: name }, t = r.text;
  if (warn && warn.length) o.hinweise = warn;
  if (r.typ !== undefined) { o.typ = r.typ; o.hinweis = r.hinweis; }
  if (t === undefined) { o.ergebnis = r.wert; return o; }
  if (t.length > LIMIT_RF.antwort) { o.zeichen = t.length; o.abgeschnitten = true; o.text = t.substring(0, LIMIT_RF.antwort); return o; }
  try { o.ergebnis = JSON.parse(t); } catch (e) { o.text = t; }
  return o;
}

tool("elo_function_read",
  "Ruft eine lesende registrierte Funktion des Indexservers auf (ohne Freigabe), nur aus einer festen Liste: " + (function () {
    var t = []; for (var k in RF_LESEND) if (hat(RF_LESEND, k)) t.push(k + " (" + RF_LESEND[k].text + ")"); return t.join("; ");
  })() + ". Die Antwort kommt als JSON, hoechstens " + LIMIT_RF.antwort + " Zeichen. Andere Funktionen: elo_function_call (Stufe 3).",
  { funktion: { type: "string", enum: rfLesendNamen(), description: "Name der Funktion" },
    parameter: { type: "object", description: "Parameter als JSON-Objekt, wie die Funktion ihn erwartet" } },
  ["funktion", "parameter"], function (a) {
    var name = trim(a.funktion), warn = [], p = a.parameter;
    if (!hat(RF_LESEND, name)) fail("'" + name + "' steht nicht in der Liste lesender Funktionen (" + rfLesendNamen().join(", ") + "). Andere: elo_function_call.");
    if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { fail("parameter ist kein gueltiges JSON."); } }
    p = RF_LESEND[name].pruefen(istObjekt(p) ? kopie(p) : p, warn);
    return rfAntwort(name, rfAufrufen(name, rfParameterText(p)), warn);
  });

function rfPlan(a) {
  var name = trim(a.funktion), warn = [], konto = "";
  if (!RX_RF.test(name)) fail("funktion: Name einer registrierten Funktion, beginnt mit RF_ (Buchstaben, Ziffern, _).");
  var text = rfParameterText(a.parameter), zeigen = text;
  try { zeigen = text ? JSON.parse(text) : "(leer)"; } catch (e) {}
  if (text.length > LIMIT_RF.vorschau) zeigen = text.substring(0, LIMIT_RF.vorschau) + " ...";
  if (hat(RF_LESEND, name)) warn.push("Diese Funktion liest nur; ohne Freigabe geht sie ueber elo_function_read (mit Grenzen fuer die Abfrage).");
  else warn.push("Was die Funktion tut, prueft dieser Server nicht. Registrierte Funktionen laufen auf dem Indexserver und koennen schreiben, loeschen oder mit Adminrechten arbeiten. " +
                 "Vorher den Quelltext der Funktion ansehen.");
  try { konto = S(ELO.connect().getLoginResult().getUser().getName()); } catch (e) {}
  return { name: name, text: text, warnungen: warn, fp: name + "|" + text,
           vorschau: { aktion: "Registrierte Funktion aufrufen", funktion: name, parameter: zeigen, unterKonto: konto || undefined } };
}

tool("elo_function_call",
  "Ruft eine beliebige registrierte Funktion des Indexservers auf (RF_..., z. B. aus Business Solutions oder eigenen IX-Skripten), zweistufig: " +
  "Vorschau zeigt Funktion und Parameter, erst mit token wird aufgerufen. Was die Funktion tut, prueft der Server nicht; sie kann schreiben. " +
  "Parameter gehen als Text (JSON) an die Funktion, die Antwort kommt als JSON oder Text, hoechstens " + LIMIT_RF.antwort + " Zeichen. Nur mit -Bauen. " +
  "Lesende Funktionen aus der festen Liste gehen ohne Freigabe ueber elo_function_read.",
  { funktion: { type: "string", description: "Name, beginnt mit RF_" },
    parameter: { description: "Parameter als JSON-Objekt oder als Text", anyOf: [{ type: "object" }, { type: "string" }] },
    token: P_TOKEN },
  ["funktion"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_function_call", a, function () { return rfPlan(a); }, function (p) {
      return rfAntwort(p.name, rfAufrufen(p.name, p.text));
    });
  }, 3);

/* ---------- Formulardesigner "Aktualisieren" ---------- */

var RX_ADRESSE = /^(https?:\/\/[^\/?#]+)(\/[^?#]*)?$/i;

function ixAdresse() { return trim(java.lang.System.getenv("ELO_IX_URL")); }

/* Basisadresse von ELOwf (mit / am Ende). Standard: ELOwf ueber den Proxy des Indexservers. */
function wfBasis(adresse) {
  var ix = ixAdresse(), m = RX_ADRESSE.exec(ix), basis = trim(adresse);
  if (!m) fail("ELO_IX_URL fehlt oder ist keine http(s)-Adresse.");
  if (!basis) {
    if (!/\/ix\/?$/i.test(ix)) fail("Aus der IX-Adresse laesst sich die Adresse von ELOwf nicht ableiten (endet nicht auf /ix). Bitte adresse angeben.");
    return ix.replace(/\/ix\/?$/i, "") + "/plugin/de.elo.ix.plugin.proxy/wf/wf/";
  }
  var b = RX_ADRESSE.exec(basis);
  if (!b) fail("adresse: http(s)-Adresse ohne ? und # erwartet, z. B. https://elo.example.com:9093/ix-Archiv/plugin/de.elo.ix.plugin.proxy/wf/wf/");
  if (b[1].toLowerCase() !== m[1].toLowerCase()) fail("adresse muss auf demselben Server liegen wie der Indexserver (" + m[1] + "): Dorthin geht das Anmeldeticket.");
  return /\/$/.test(basis) ? basis : basis + "/";
}

function httpHolen(url) {
  var c = new java.net.URL(url).openConnection();
  c.setConnectTimeout(10000); c.setReadTimeout(60000); c.setInstanceFollowRedirects(false);
  c.setRequestProperty("User-Agent", "elo-mcp/" + SERVER_VERSION);
  c.setRequestProperty("Accept", "text/html,*/*");
  var code = Number(c.getResponseCode()), ein = code < 400 ? c.getInputStream() : c.getErrorStream(), text = "";
  if (ein) text = S(new java.lang.String(readAll(ein, 2 * 1024 * 1024), "UTF-8"));
  return { code: code, text: text, ziel: S(c.getHeaderField("Location")) };
}

function seitenText(html) {
  return S(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

tool("elo_form_reload",
  "Formulardesigner 'Aktualisieren' (zweistufig): ELOwf liest die Formulare und die Formularliste neu, wie edit.jsp?reload=1 im Browser. " +
  "Noetig nach neuen Formularen, neuen Seiten oder einem geaenderten gemeinsamen Rahmen (Header); vorher liefern neue Formulare 404. " +
  "An den Formularen selbst aendert sich nichts. Das Anmeldeticket dieser Sitzung geht dabei an ELOwf, nur auf dem Server des Indexservers. Nur mit -Bauen.",
  { adresse: { type: "string", description: "Optional: Basisadresse von ELOwf mit /wf/ am Ende. Standard: ELOwf ueber den Proxy des Indexservers (<IX ohne /ix>/plugin/de.elo.ix.plugin.proxy/wf/wf/)" },
    token: P_TOKEN },
  [], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_form_reload", a, function () {
      var basis = wfBasis(a.adresse);
      return { basis: basis, fp: basis, warnungen: ["Das Anmeldeticket dieser Sitzung geht als Parameter an " + basis + "edit.jsp."],
               vorschau: { aktion: "Formulardesigner 'Aktualisieren'", adresse: basis + "edit.jsp?reload=1",
                           wirkung: "ELOwf liest Formulare und Formularliste neu. Formulare werden nicht geaendert; offene Formulare zeigen Neues erst nach dem Neuladen." } };
    }, function (p) {
      var ticket = S(ELO.connect().getLoginResult().getClientInfo().getTicket()), r;
      function ohneTicket(s) { s = S(s); if (ticket) s = s.split(ticket).join("..."); return s.replace(/ticket=[^&\s"'<>]+/gi, "ticket=..."); }
      try { r = httpHolen(p.basis + "edit.jsp?lang=de&reload=1&ticket=" + java.net.URLEncoder.encode(ticket, "UTF-8")); }
      catch (e) { fail("ELOwf nicht erreichbar: " + ohneTicket(errText(e))); }
      var text = ohneTicket(seitenText(r.text)).substring(0, 300);
      if (r.code >= 300 && r.code < 400) fail("ELOwf leitet um (HTTP " + r.code + " nach " + ohneTicket(r.ziel) + "), vermutlich zur Anmeldung. Aktualisieren nicht bestaetigt.");
      if (r.code !== 200) fail("ELOwf antwortet mit HTTP " + r.code + ": " + text);
      return { http: r.code, adresse: p.basis + "edit.jsp?reload=1", seite: text, hinweis: "ELOwf hat die Formulare neu gelesen. Offene Formulare im Client neu laden." };
    });
  }, 3);
