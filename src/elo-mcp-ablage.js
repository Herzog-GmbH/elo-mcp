/*
 * elo-mcp-ablage.js - Verweise, Verschieben, Loeschen und Wiederherstellen.
 * Wird nach elo-mcp-ergaenzungen.js geladen (nutzt sordOf, pathOf, isFolder, findSords, brief aus elo-mcp.js; zweiSchritte,
 * P_TOKEN, ordnerPruefen aus elo-mcp-schreiben.js; benutzerName aus elo-mcp-bauen.js; hat, objektListe aus elo-mcp-notizen.js;
 * warte aus elo-mcp-vorgaenge.js; jsonSichern aus elo-mcp-ergaenzungen.js).
 *
 * elo_references (Stufe 1)     Hauptablage und Verweise eines Objekts, oder die Verweise in einem Ordner
 * elo_reference_set (Stufe 2)  Verweise anlegen oder entfernen, nie die Hauptablage
 * elo_move (Stufe 2)           Objekte in einen anderen Ordner verschieben (Hauptablage oder einen Verweis)
 * elo_delete (Stufe 3)         als geloescht markieren, nie endgueltig; ohne Schalter nur leere Ordnerbaeume
 * elo_restore (Stufe 3)        geloeschte Objekte wiederherstellen
 *
 * Begriffe: Ein Objekt hat genau eine Hauptablage (parentId) und beliebig viele Verweise. Ein Ordner listet beides
 * als Kinder; ein Verweis ist ein Kind, dessen parentId nicht der Ordner ist. Die Ablageorte stehen in refPaths:
 * je Ort der Pfad bis zum Ordner, das letzte Glied ist der Ordner selbst.
 *
 * IX-Aufrufe:
 *   Verweis anlegen       refSord("", ordner, obj, -1)
 *   verschieben           refSord(alterOrdner, neuerOrdner, obj, -1) - alterOrdner = Hauptablage oder ein Verweisordner
 *   Verweis entfernen     deleteSord(verweisOrdner, obj) - das Objekt selbst bleibt
 *   loeschen              deleteSord(hauptablage, obj, DeleteOptions deleteFinally=false) - nur markiert, im Client
 *                         unter "geloeschte Eintraege einblenden" sichtbar und wiederherstellbar
 *   wiederherstellen      restoreSord(obj, RestoreOptions singleObject bzw. minDeleteDate = Loeschzeitpunkt des Objekts)
 * Endgueltiges Loeschen (deleteFinally) gibt es hier nicht.
 *
 * Im Testarchiv (IX 25.00) belegt:
 *   - deleteSord auf einen Ordner markiert jeden Eintrag darin mit demselben Zeitpunkt (deleteDateIso, UTC, minutengenau).
 *   - Ein entfernter Verweis ist nur ein als geloescht markierter Verweis: Mit inclDeleted erscheint er als Kind mit
 *     deleted=true und eigenem Zeitpunkt. restoreSord mit minDeleteDate holt ihn mit zurueck, wenn er ab dem
 *     Loeschzeitpunkt des Ordners (gleiche Minute oder spaeter) entfernt wurde; frueher entfernte bleiben weg.
 *   - singleObject=true holt nur den Ordner, sein Inhalt bleibt geloescht und laesst sich danach einzeln holen.
 *
 * Sperren: Ein Objekt, das ein anderes Konto gesperrt (oder als Dokument ausgecheckt) hat, wird abgelehnt. Die Werkzeuge
 * setzen selbst keine Sperre; zwischen Vorschau und Ausfuehrung schuetzt der Fingerabdruck der Vorschau.
 */

var LIMIT_ABLAGE = { objekte: 200, kinder: 300, baumEintraege: 2000, beispiele: 10, pauseAlle: 20, pauseMs: 100 };
var P_OBJEKTE = { type: "array", items: { type: "string" }, description: "Objekte (ID, GUID oder Archivpfad), hoechstens " + LIMIT_ABLAGE.objekte };

/* ---------- Hilfen ---------- */

/* Auch geloeschte Objekte lesen. checkoutSord liefert sie; falls ein IX das ablehnt, Suche mit inclDeleted. */
function sordAblage(id) {
  if (!trim(id)) fail("Objekt fehlt (ID, GUID oder Archivpfad).");
  try { return sordOf(id); }
  catch (e) {
    if (!/^\d+$/.test(trim(id))) throw e;
    var fi = new IXC.FindInfo(), fo = new IXC.FindOptions();
    fo.setObjIds([trim(id)]); fo.setInclDeleted(true); fi.setFindOptions(fo);
    var r;
    try { r = findSords(fi, 1, IXC.SordC.mbAll); } catch (e2) { throw e; }
    if (!r.sords.length) throw e;
    return r.sords[0];
  }
}

function ortVon(ap) {
  var p = ap.getPath(), namen = [];
  for (var i = 0; p && i < p.length; i++) namen.push(S(p[i].getName()));
  return { ordner: p && p.length ? S(p[p.length - 1].getId()) : "1", pfad: namen.join("/") };
}

/* Hauptablage und Verweise eines Objekts; ids: alle Ordner auf allen Pfaden (fuer die Ringpruefung). */
function ablageOrte(s) {
  var rp = null, parent = S(s.getParentId()), haupt = null, verweise = [], ids = {};
  try { rp = s.getRefPaths(); } catch (e) {}
  for (var i = 0; rp && i < rp.length; i++) {
    var o = ortVon(rp[i]), p = rp[i].getPath();
    for (var j = 0; p && j < p.length; j++) ids[S(p[j].getId())] = true;
    if (!haupt && o.ordner === parent) haupt = o; else verweise.push(o);
  }
  return { haupt: haupt || { ordner: parent, pfad: "" }, verweise: verweise, ids: ids };
}

function istIn(orte, ordnerId) {
  if (orte.haupt.ordner === ordnerId) return "haupt";
  for (var i = 0; i < orte.verweise.length; i++) if (orte.verweise[i].ordner === ordnerId) return "verweis";
  return "";
}

function meineId() { return S(ELO.connect().getLoginResult().getUser().getId()); }

/* Name des fremden Kontos, das das Objekt sperrt (oder das Dokument ausgecheckt hat); "" wenn frei oder eigene Sperre. */
function fremdGesperrt(s, ich) {
  var teile = [["getLockId", "getLockName", ""], ["getLockIdDoc", "getLockNameDoc", " (Dokument ausgecheckt)"]];
  for (var i = 0; i < teile.length; i++) {
    var id = -1, name = "";
    try { id = Number(s[teile[i][0]]()); name = S(s[teile[i][1]]()); } catch (e) { continue; }
    if (id >= 0 && S(id) !== ich) return (name || "Konto " + id) + teile[i][2];
  }
  return "";
}

function kurz(s) { return S(s.getName()) + " [" + S(s.getId()) + "]"; }
function ortText(o) { return (o.pfad || "(Archivwurzel)") + " [" + o.ordner + "]"; }
function geloeschtVon(s) {
  var u = -1; try { u = Number(s.getDeleteUser()); } catch (e) {}
  if (!(u >= 0)) return "";
  var n = ""; try { n = benutzerName(u); } catch (e) {}
  return n || ("Konto " + u);
}
/* Loeschzeitpunkt (deleteDateIso, UTC, minutengenau). delDateIso ist etwas anderes (Verfallsdatum aus den Metadaten). */
function geloeschtAm(s) { try { return S(s.getDeleteDateIso()); } catch (e) { return ""; } }
function utcLesbar(d) {
  d = S(d);
  return d.length >= 12 ? d.substring(6, 8) + "." + d.substring(4, 6) + "." + d.substring(0, 4) + " " + d.substring(8, 10) + ":" + d.substring(10, 12) + " UTC" : d;
}

/* Geloeschte Kinder eines Ordners (inclDeleted). Ein entfernter Verweis erscheint hier als Kind mit deleted=true
   und eigenem Loeschzeitpunkt, obwohl das Objekt selbst nicht geloescht ist. */
function kinderMitGeloeschten(ordnerId) {
  var fi = new IXC.FindInfo(), fc = new IXC.FindChildren(), fo = new IXC.FindOptions();
  fc.setParentId(S(ordnerId)); fc.setEndLevel(1); fi.setFindChildren(fc); fo.setInclDeleted(true); fi.setFindOptions(fo);
  var r = findSords(fi, LIMIT_ABLAGE.kinder, IXC.SordC.mbAll);
  if (r.mehr) fail("Ordner " + ordnerId + " hat mit geloeschten Eintraegen mehr als " + LIMIT_ABLAGE.kinder + " - zu gross fuer dieses Werkzeug.");
  return r.sords;
}

/* Was restoreSord(ordner, minDeleteDate=ab) mit zurueckholt: alles im geloeschten Baum, das ab diesem Zeitpunkt
   geloescht wurde, auch entfernte Verweise. Frueher Geloeschtes bleibt. */
function mitZurueck(wurzelId, ab, budget) {
  var z = { unterordner: 0, dokumente: 0, verweise: [], bleiben: 0 }, todo = [S(wurzelId)];
  while (todo.length) {
    var oid = todo.shift(), k = kinderMitGeloeschten(oid);
    warte(LIMIT_ABLAGE.pauseMs);
    for (var i = 0; i < k.length; i++) {
      var c = k[i];
      if (++budget.eintraege > LIMIT_ABLAGE.baumEintraege) fail("Mehr als " + LIMIT_ABLAGE.baumEintraege + " Eintraege in den Ordnerbaeumen - bitte in kleineren Teilen.");
      if (!c.isDeleted()) continue;
      if (geloeschtAm(c) < ab) { z.bleiben++; continue; }
      if (S(c.getParentId()) !== oid) z.verweise.push({ id: S(c.getId()), name: S(c.getName()), ordner: oid });
      else if (isFolder(c)) { z.unterordner++; todo.push(S(c.getId())); }
      else z.dokumente++;
    }
  }
  return z;
}

/* Direkte Kinder eines Ordners (Hauptablage und Verweise, ohne geloeschte). */
function kinderVon(ordnerId, mussVollstaendig) {
  var fi = new IXC.FindInfo(), fc = new IXC.FindChildren();
  fc.setParentId(S(ordnerId)); fc.setEndLevel(1); fi.setFindChildren(fc);
  var r = findSords(fi, LIMIT_ABLAGE.kinder, IXC.SordC.mbAll);
  if (r.mehr && mussVollstaendig) fail("Ordner " + ordnerId + " hat mehr als " + LIMIT_ABLAGE.kinder + " Eintraege - zu gross fuer dieses Werkzeug.");
  return r;
}

/* Ordnerbaum unter einem Ordner zaehlen, Ebene fuer Ebene, mit Pause zwischen den Ordnern.
   budget = { eintraege } gilt fuer den ganzen Aufruf. Verweise ins Innere des Baums zaehlen nicht als fremd. */
function baumLesen(wurzelId, budget, ich) {
  var b = { unterordner: 0, ordnerIds: [], dokumente: [], verweise: [], anderswo: [], gesperrt: [] }, todo = [S(wurzelId)], baumIds = {}, kandidaten = [];
  baumIds[S(wurzelId)] = true;
  while (todo.length) {
    var oid = todo.shift(), k = kinderVon(oid, true).sords;
    warte(LIMIT_ABLAGE.pauseMs);
    for (var i = 0; i < k.length; i++) {
      var c = k[i], cid = S(c.getId());
      if (++budget.eintraege > LIMIT_ABLAGE.baumEintraege) fail("Mehr als " + LIMIT_ABLAGE.baumEintraege + " Eintraege in den Ordnerbaeumen - bitte in kleineren Teilen.");
      if (S(c.getParentId()) !== oid) { b.verweise.push({ ordner: oid, id: cid, name: S(c.getName()) }); continue; }
      baumIds[cid] = true;
      if (isFolder(c)) { b.unterordner++; b.ordnerIds.push(cid); todo.push(cid); }
      else b.dokumente.push({ id: cid, name: S(c.getName()) });
      var g = fremdGesperrt(c, ich);
      if (g) b.gesperrt.push({ id: cid, name: S(c.getName()), von: g });
      kandidaten.push(c);
    }
  }
  for (var j = 0; j < kandidaten.length; j++) {
    var orte = ablageOrte(kandidaten[j]), fremd = [];
    for (var v = 0; v < orte.verweise.length; v++) if (!baumIds[orte.verweise[v].ordner]) fremd.push(ortText(orte.verweise[v]));
    if (fremd.length) b.anderswo.push({ id: S(kandidaten[j].getId()), name: S(kandidaten[j].getName()), verweise: fremd });
  }
  b.ids = baumIds;
  return b;
}

function beispiele(liste, f) {
  var out = [];
  for (var i = 0; i < liste.length && i < LIMIT_ABLAGE.beispiele; i++) out.push(f ? f(liste[i]) : liste[i]);
  if (liste.length > LIMIT_ABLAGE.beispiele) out.push("... " + (liste.length - LIMIT_ABLAGE.beispiele) + " weitere");
  return out;
}

function objekteListe(werte) {
  if (werte === undefined || werte === null || (werte instanceof Array && !werte.length)) fail("objekte fehlt.");
  return objektListe(werte, LIMIT_ABLAGE.objekte);
}

function pauseNach(i) { if (i % LIMIT_ABLAGE.pauseAlle === LIMIT_ABLAGE.pauseAlle - 1) warte(LIMIT_ABLAGE.pauseMs); }

/* Ein Ordner darf nicht in sich selbst oder seinen eigenen Baum. */
function ringPruefen(s, ziel, zielOrte, was) {
  var id = S(s.getId());
  if (isFolder(s) && (S(ziel.getId()) === id || zielOrte.ids[id]))
    fail(kurz(s) + ": Ziel " + kurz(ziel) + " liegt in diesem Ordner selbst - " + was + " ergaebe einen Ring.");
}

/* ---------- Stufe 1: Verweise lesen ---------- */

tool("elo_references",
  "Zeigt, wo ein Objekt liegt: Hauptablage und alle Verweise (Pfad und Ordner-ID), auch bei geloeschten Objekten. " +
  "Alternativ mit ordner: welche Eintraege dort nur Verweise sind (parentId ungleich dem Ordner) und wo ihre Hauptablage ist, hoechstens " + LIMIT_ABLAGE.kinder + " Eintraege.",
  { objekt: { type: "string", description: "Objekt (ID, GUID oder Archivpfad)" },
    ordner: { type: "string", description: "Alternativ: Ordner, dessen Verweise gelistet werden" } },
  [], function (a) {
    if (!trim(a.objekt) === !trim(a.ordner)) fail("Entweder objekt oder ordner angeben.");
    if (trim(a.objekt)) {
      var s = sordAblage(a.objekt), orte = ablageOrte(s), o = brief(s);
      o.pfad = orte.haupt.pfad; o.hauptablage = orte.haupt; o.verweise = orte.verweise; o.anzahlVerweise = orte.verweise.length;
      if (s.isDeleted()) { o.geloescht = true; o.geloeschtAm = utcLesbar(geloeschtAm(s)); o.geloeschtVon = geloeschtVon(s); }
      return o;
    }
    var ord = sordOf(a.ordner);
    if (!isFolder(ord)) fail("Kein Ordner: " + kurz(ord));
    var r = kinderVon(S(ord.getId()), false), hier = 0, verweise = [];
    for (var i = 0; i < r.sords.length; i++) {
      var c = r.sords[i];
      if (S(c.getParentId()) === S(ord.getId())) { hier++; continue; }
      var co = ablageOrte(c), e = brief(c);
      e.hauptablage = co.haupt;
      verweise.push(e);
    }
    return { ordner: S(ord.getName()), id: S(ord.getId()), pfad: pathOf(ord), eintraege: r.sords.length, mehrVorhanden: r.mehr,
             hierAbgelegt: hier, anzahlVerweise: verweise.length, verweise: verweise };
  });

/* ---------- Stufe 2: Verweise anlegen und entfernen ---------- */

function verweisPlan(a) {
  var aktion = trim(a.aktion);
  if (aktion !== "anlegen" && aktion !== "entfernen") fail("aktion: anlegen oder entfernen.");
  var liste = a.verweise;
  if (!(liste instanceof Array) || !liste.length) fail("verweise fehlt: Liste von {objekt, ordner}.");
  if (liste.length > LIMIT_ABLAGE.objekte) fail("Hoechstens " + LIMIT_ABLAGE.objekte + " Verweise je Aufruf.");
  var ich = meineId(), plan = [], gesehen = {}, warn = [], fp = [], ordnerCache = {};
  for (var i = 0; i < liste.length; i++) {
    var v = liste[i] || {};
    if (!trim(v.objekt) || !trim(v.ordner)) fail("verweise[" + i + "]: objekt und ordner angeben.");
    var ord = ordnerCache[trim(v.ordner)] || (ordnerCache[trim(v.ordner)] = ordnerPruefen(v.ordner));
    var s = sordOf(v.objekt), sid = S(s.getId()), oid = S(ord.getId()), schluessel = sid + ">" + oid;
    if (hat(gesehen, schluessel)) continue;
    gesehen[schluessel] = true;
    if (s.isDeleted()) fail(kurz(s) + " ist geloescht.");
    if (ord.isDeleted()) fail("Ordner " + kurz(ord) + " ist geloescht.");
    var orte = ablageOrte(s), drin = istIn(orte, oid), g = fremdGesperrt(s, ich);
    if (g) fail(kurz(s) + " ist gesperrt von " + g + ".");
    if (aktion === "anlegen") {
      if (drin === "haupt") fail(kurz(s) + " liegt in " + kurz(ord) + " schon in der Hauptablage.");
      if (drin === "verweis") fail(kurz(s) + " hat in " + kurz(ord) + " schon einen Verweis.");
      ringPruefen(s, ord, ablageOrte(ord), "der Verweis");
    } else {
      if (drin === "haupt") fail(kurz(s) + ": " + kurz(ord) + " ist die Hauptablage, kein Verweis. Verschieben: elo_move, loeschen: elo_delete.");
      if (!drin) fail(kurz(s) + " hat in " + kurz(ord) + " keinen Verweis.");
    }
    plan.push({ id: sid, name: S(s.getName()), art: isFolder(s) ? "Ordner" : "Dokument", ordner: oid, ordnerPfad: ortText({ ordner: oid, pfad: pathOf(ord) + "/" + S(ord.getName()) }),
                hauptablage: ortText(orte.haupt), verweiseVorher: orte.verweise.length });
    fp.push(schluessel + "|" + S(s.getParentId()) + "|" + orte.verweise.map(function (x) { return x.ordner; }).sort().join(","));
    pauseNach(i);
  }
  if (!plan.length) fail("Keine Verweise uebrig.");
  if (aktion === "entfernen") warn.push("Nur die Verweise verschwinden, die Objekte bleiben in ihrer Hauptablage.");
  return { aktion: aktion, plan: plan, warnungen: warn, fp: aktion + "|" + fp.join(";"),
           vorschau: { aktion: aktion === "anlegen" ? "Verweise anlegen" : "Verweise entfernen", anzahl: plan.length,
                       verweise: plan.map(function (p) { return { objekt: p.name + " [" + p.id + "]", art: p.art, ordner: p.ordnerPfad, hauptablage: p.hauptablage }; }) } };
}

tool("elo_reference_set",
  "Legt Verweise an oder entfernt sie (zweistufig). Ein Verweis zeigt ein Objekt in einem weiteren Ordner, das Objekt bleibt in seiner Hauptablage. " +
  "Entfernen nimmt nur Verweise weg, nie die Hauptablage (dafuer elo_move bzw. elo_delete); vorher Sicherung der entfernten Verweise. Hoechstens " + LIMIT_ABLAGE.objekte + " je Aufruf.",
  { aktion: { type: "string", enum: ["anlegen", "entfernen"] },
    verweise: { type: "array", items: { type: "object", properties: { objekt: { type: "string" }, ordner: { type: "string" } }, required: ["objekt", "ordner"], additionalProperties: false },
                description: "Liste von {objekt, ordner}: Objekt (ID, GUID, Pfad) und der Ordner, in dem der Verweis angelegt bzw. entfernt wird" },
    token: P_TOKEN },
  ["aktion", "verweise"], function (a) {
    return zweiSchritte("elo_reference_set", a, function () { return verweisPlan(a); }, function (p) {
      var sicherung, ok = [], fehler = [];
      if (p.aktion === "entfernen") sicherung = jsonSichern("verweise-entfernt", { aktion: "Verweise entfernt", archiv: ARCHIV_NAME || undefined, verweise: p.plan,
                                                                                 hinweis: "Wiederherstellen: elo_reference_set aktion=anlegen mit denselben objekt/ordner." });
      for (var i = 0; i < p.plan.length; i++) {
        var e = p.plan[i];
        try {
          if (p.aktion === "anlegen") ELO.ix().refSord("", e.ordner, e.id, -1);
          else ELO.ix().deleteSord(e.ordner, e.id, IXC.LockC.NO, null);
          var n = sordOf(e.id), drin = istIn(ablageOrte(n), e.ordner);
          if (p.aktion === "anlegen" ? drin === "verweis" : (!drin && !n.isDeleted())) ok.push(e.id + ">" + e.ordner);
          else fehler.push({ objekt: e.id, ordner: e.ordner, fehler: "ABWEICHUNG beim Zuruecklesen" + (n.isDeleted() ? ": Objekt ist geloescht" : "") });
        } catch (ex) { fehler.push({ objekt: e.id, ordner: e.ordner, fehler: errText(ex) }); }
        pauseNach(i);
      }
      return { aktion: p.aktion, erledigt: ok.length, fehler: fehler.length ? fehler : undefined, sicherung: sicherung };
    });
  }, 2);

/* ---------- Stufe 2: verschieben ---------- */

function verschiebenPlan(a) {
  var ids = objekteListe(a.objekte), ziel = ordnerPruefen(a.ziel), zid = S(ziel.getId()), zielOrte = ablageOrte(ziel), von = trim(a.von);
  if (ziel.isDeleted()) fail("Zielordner " + kurz(ziel) + " ist geloescht.");
  if (von && ids.length > 1) fail("von geht nur mit einem Objekt.");
  var ich = meineId(), plan = [], warn = [], fp = [];
  for (var i = 0; i < ids.length; i++) {
    var s = sordOf(ids[i]), sid = S(s.getId()), orte = ablageOrte(s), quelle = orte.haupt.ordner, verweis = false;
    if (s.isDeleted()) fail(kurz(s) + " ist geloescht.");
    var g = fremdGesperrt(s, ich);
    if (g) fail(kurz(s) + " ist gesperrt von " + g + ".");
    if (von) {
      var vo = S(sordOf(von).getId()), drin = istIn(orte, vo);
      if (!drin) fail(kurz(s) + " liegt nicht in Ordner " + vo + ". Ablageorte: " + [ortText(orte.haupt)].concat(orte.verweise.map(ortText)).join("; "));
      quelle = vo; verweis = drin === "verweis";
    }
    if (quelle === zid) fail(kurz(s) + " liegt schon in " + kurz(ziel) + ".");
    var imZiel = istIn(orte, zid);
    if (imZiel) fail(kurz(s) + " hat in " + kurz(ziel) + " schon " + (imZiel === "haupt" ? "die Hauptablage" : "einen Verweis") + ". Verweis entfernen: elo_reference_set.");
    ringPruefen(s, ziel, zielOrte, "das Verschieben");
    plan.push({ id: sid, name: S(s.getName()), art: isFolder(s) ? "Ordner" : "Dokument", von: quelle, verweis: verweis,
                vonPfad: verweis ? ortText(orte.verweise.filter(function (x) { return x.ordner === quelle; })[0]) : ortText(orte.haupt), verweise: orte.verweise.length });
    fp.push(sid + "|" + S(s.getParentId()) + "|" + orte.verweise.map(function (x) { return x.ordner; }).sort().join(","));
    pauseNach(i);
  }
  var ordner = plan.filter(function (p) { return p.art === "Ordner"; }).length;
  if (ordner) warn.push(ordner + " Ordner werden mit allem darin verschoben.");
  if (plan.some(function (p) { return !p.verweis && p.verweise; })) warn.push("Vorhandene Verweise der Objekte bleiben, wo sie sind.");
  warn.push("Die Rechte der Objekte bleiben unveraendert; ob sie zum Zielordner passen, zeigt elo_acl.");
  return { plan: plan, ziel: zid, warnungen: warn, fp: zid + "|" + fp.join(";"),
           vorschau: { aktion: "verschieben", ziel: ortText({ ordner: zid, pfad: pathOf(ziel) + "/" + S(ziel.getName()) }), anzahl: plan.length,
                       objekte: plan.map(function (p) { return { objekt: p.name + " [" + p.id + "]", art: p.art, von: p.vonPfad, was: p.verweis ? "Verweis" : "Hauptablage" }; }) } };
}

tool("elo_move",
  "Verschiebt Objekte in einen anderen Ordner (zweistufig), wie Ausschneiden und Einfuegen im Client. Standard: die Hauptablage; mit von (nur bei einem Objekt) " +
  "einen bestimmten Ablageort, auch einen Verweis. Ordner wandern mit allem darin. Lehnt Ringe ab (Ordner in sich selbst) und Ziele, in denen das Objekt schon liegt. Hoechstens " + LIMIT_ABLAGE.objekte + " Objekte.",
  { objekte: P_OBJEKTE, ziel: { type: "string", description: "Zielordner (ID, GUID oder Pfad)" },
    von: { type: "string", description: "Optional, nur bei einem Objekt: der Ordner, aus dem es weg soll (Hauptablage oder Verweisordner)" }, token: P_TOKEN },
  ["objekte", "ziel"], function (a) {
    return zweiSchritte("elo_move", a, function () { return verschiebenPlan(a); }, function (p) {
      var ok = [], fehler = [];
      for (var i = 0; i < p.plan.length; i++) {
        var e = p.plan[i];
        try {
          ELO.ix().refSord(e.von, p.ziel, e.id, -1);
          var n = sordOf(e.id), orte = ablageOrte(n), weg = !istIn(orte, e.von);
          if ((e.verweis ? istIn(orte, p.ziel) === "verweis" : S(n.getParentId()) === p.ziel) && weg) ok.push(e.id);
          else fehler.push({ objekt: e.id, fehler: "ABWEICHUNG beim Zuruecklesen: Hauptablage " + ortText(orte.haupt) });
        } catch (ex) { fehler.push({ objekt: e.id, fehler: errText(ex) }); }
        pauseNach(i);
      }
      return { verschoben: ok.length, ziel: p.ziel, fehler: fehler.length ? fehler : undefined,
               hinweis: "Zurueck: elo_move mit ziel = bisheriger Ordner (steht in der Vorschau unter von)." };
    });
  }, 2);

/* ---------- Stufe 3: loeschen ---------- */

function loeschenPlan(a) {
  var ids = objekteListe(a.objekte), mitInhalt = a.mitInhalt === true, ueberspringen = a.ueberspringen === true;
  var ich = meineId(), budget = { eintraege: 0 }, eintraege = [], bleibt = [], warn = [];
  for (var i = 0; i < ids.length; i++) {
    var s = sordOf(ids[i]), sid = S(s.getId()), grund = [];
    if (sid === "1") fail("Die Archivwurzel wird nicht geloescht.");
    if (s.isDeleted()) fail(kurz(s) + " ist schon geloescht.");
    var orte = ablageOrte(s), b = isFolder(s) ? baumLesen(sid, budget, ich) : null, g = fremdGesperrt(s, ich);
    if (g) grund.push("gesperrt von " + g);
    if (b && b.gesperrt.length) grund.push(b.gesperrt.length + " Eintraege darin gesperrt: " + beispiele(b.gesperrt, function (x) { return x.name + " [" + x.id + "] von " + x.von; }).join(" | "));
    if (!mitInhalt) {
      if (!b) grund.push("ist ein Dokument (nur mit mitInhalt=true)");
      else {
        if (b.dokumente.length) grund.push(b.dokumente.length + " Dokumente darin: " + beispiele(b.dokumente, function (x) { return x.name + " [" + x.id + "]"; }).join(" | "));
        if (b.verweise.length) grund.push(b.verweise.length + " Verweise darin: " + beispiele(b.verweise, function (x) { return x.name + " [" + x.id + "] in " + x.ordner; }).join(" | "));
      }
    }
    var e = { id: sid, name: S(s.getName()), art: b ? "Ordner" : "Dokument", maske: S(s.getMaskName()), guid: S(s.getGuid()), eltern: orte.haupt.ordner, pfad: orte.haupt.pfad,
              verweise: orte.verweise, unterordner: b ? b.unterordner : 0, dokumente: b ? b.dokumente : [], verweiseDarin: b ? b.verweise : [],
              anderswoVerwiesen: b ? b.anderswo : [], ids: b ? b.ids : {} };
    e.ids[sid] = true;
    if (grund.length) {
      if (!ueberspringen) fail(kurz(s) + " bleibt: " + grund.join("; ") + ". Mit ueberspringen=true werden solche Objekte ausgelassen" + (mitInhalt ? "." : ", mit mitInhalt=true samt Inhalt geloescht."));
      bleibt.push({ objekt: kurz(s), grund: grund.join("; ") });
      continue;
    }
    eintraege.push(e);
    pauseNach(i);
  }
  /* Objekte, die im Baum eines anderen gelisteten Ordners liegen, gehen mit diesem; einzeln loeschen entfaellt. */
  var plan = [], mit = [];
  for (var j = 0; j < eintraege.length; j++) {
    var in_ = "";
    for (var k = 0; k < eintraege.length && !in_; k++) if (k !== j && eintraege[k].art === "Ordner" && hat(eintraege[k].ids, eintraege[j].id)) in_ = eintraege[k].id;
    if (in_) mit.push(eintraege[j].name + " [" + eintraege[j].id + "] liegt in [" + in_ + "]"); else plan.push(eintraege[j]);
  }
  if (!plan.length) fail("Nichts zu loeschen." + (bleibt.length ? " Ausgelassen: " + JSON.stringify(bleibt) : ""));
  var summe = { ordner: 0, unterordner: 0, dokumente: 0, verweiseDarin: 0 }, fp = [];
  for (var m = 0; m < plan.length; m++) {
    var p = plan[m];
    if (p.art === "Ordner") summe.ordner++; else summe.dokumente++;
    summe.unterordner += p.unterordner; summe.dokumente += p.dokumente.length; summe.verweiseDarin += p.verweiseDarin.length;
    if (p.verweise.length) warn.push(p.name + " [" + p.id + "] hat " + p.verweise.length + " Verweise (" + beispiele(p.verweise, ortText).join("; ") + "); dort erscheint es danach als geloescht.");
    if (p.anderswoVerwiesen.length) warn.push(p.name + " [" + p.id + "]: " + p.anderswoVerwiesen.length + " Eintraege darin haben Verweise ausserhalb: " +
                                              beispiele(p.anderswoVerwiesen, function (x) { return x.name + " [" + x.id + "] -> " + x.verweise.join(", "); }).join(" | "));
    if (p.eltern === "1") warn.push(p.name + " [" + p.id + "] liegt direkt unter der Archivwurzel.");
    if (/^Administration(\/|$)/.test(p.pfad)) warn.push(p.name + " [" + p.id + "] liegt unter Administration (Skripte, Regeln, Formulare).");
    var ki = []; for (var key in p.ids) if (hat(p.ids, key)) ki.push(key);
    fp.push(p.id + "|" + p.eltern + "|" + ki.sort().join(",") + "|" + p.verweiseDarin.map(function (x) { return x.ordner + ">" + x.id; }).sort().join(","));
  }
  if (mitInhalt && (summe.dokumente || summe.verweiseDarin)) warn.push("mitInhalt: Dokumente und Verweise in den Ordnern werden mit geloescht.");
  var v = { aktion: "als geloescht markieren (nicht endgueltig, wiederherstellbar)", anzahl: plan.length, summe: summe,
            objekte: plan.map(function (p) {
              var o = { objekt: p.name + " [" + p.id + "]", art: p.art, ort: ortText({ ordner: p.eltern, pfad: p.pfad }) };
              if (p.art === "Ordner") { o.unterordner = p.unterordner; o.dokumente = p.dokumente.length; o.verweiseDarin = p.verweiseDarin.length; }
              if (p.verweise.length) o.verweise = p.verweise.length;
              return o;
            }) };
  if (mit.length) v.gehenMit = mit;
  if (bleibt.length) v.ausgelassen = bleibt;
  return { plan: plan, warnungen: warn, vorschau: v, fp: (mitInhalt ? "mit" : "leer") + "|" + fp.join(";") };
}

tool("elo_delete",
  "Loescht Objekte, d. h. markiert sie als geloescht wie im Client (zweistufig, Stufe 3). Nie endgueltig: Sie bleiben unter 'geloeschte Eintraege' sichtbar und " +
  "lassen sich mit elo_restore wiederherstellen. Ohne mitInhalt nur Ordner bzw. Ordnerbaeume ohne Dokumente und ohne Verweise; die Vorschau zaehlt Unterordner, Dokumente und Verweise " +
  "und warnt vor Verweisen von ausserhalb. Vorher Sicherung (IDs, Pfade, Inhalt) unter %LOCALAPPDATA%\\elo-mcp\\sicherung. Hoechstens " + LIMIT_ABLAGE.objekte + " Objekte, " +
  LIMIT_ABLAGE.baumEintraege + " Eintraege in den Baeumen.",
  { objekte: P_OBJEKTE,
    mitInhalt: { type: "boolean", description: "Auch Dokumente und Ordner mit Dokumenten oder Verweisen loeschen" },
    ueberspringen: { type: "boolean", description: "Objekte, die die Bedingung nicht erfuellen (Inhalt, Sperre), auslassen statt abzubrechen" },
    token: P_TOKEN },
  ["objekte"], function (a) {
    return zweiSchritte("elo_delete", a, function () { return loeschenPlan(a); }, function (p) {
      var sich = [];
      for (var i = 0; i < p.plan.length; i++) {
        var e = p.plan[i];
        sich.push({ id: e.id, guid: e.guid, name: e.name, art: e.art, maske: e.maske, eltern: e.eltern, pfad: e.pfad, verweise: e.verweise,
                    unterordner: e.unterordner, dokumente: e.dokumente, verweiseDarin: e.verweiseDarin });
      }
      var sicherung = jsonSichern("loeschen", { aktion: "als geloescht markiert", archiv: ARCHIV_NAME || undefined, objekte: sich,
                                                hinweis: "Wiederherstellen: elo_restore mit objekte = die IDs oben." });
      var opt = new IXC.DeleteOptions(), ok = [], fehler = [];
      opt.setDeleteFinally(false); opt.setFolderMustBeEmpty(false);
      for (var j = 0; j < p.plan.length; j++) {
        var e2 = p.plan[j];
        try {
          ELO.ix().deleteSord(e2.eltern, e2.id, IXC.LockC.NO, opt);
          var weg = true;
          try { weg = !!sordAblage(e2.id).isDeleted(); } catch (e3) { weg = true; }
          if (weg) ok.push(e2.id); else fehler.push({ objekt: e2.id, fehler: "ABWEICHUNG: nach dem Loeschen nicht als geloescht markiert" });
        } catch (ex) { fehler.push({ objekt: e2.id, fehler: errText(ex) }); }
        pauseNach(j);
      }
      return { geloescht: ok.length, ids: ok, fehler: fehler.length ? fehler : undefined, sicherung: sicherung,
               hinweis: "Wiederherstellen: elo_restore mit objekte=" + JSON.stringify(ok) + "." };
    });
  }, 3);

/* ---------- Stufe 3: wiederherstellen ---------- */

function wiederherstellenPlan(a) {
  var ids = objekteListe(a.objekte), einzeln = a.einzeln === true, eintraege = [], warn = [], fp = [], dabei = {}, budget = { eintraege: 0 };
  for (var i = 0; i < ids.length; i++) {
    var s = sordAblage(ids[i]), sid = S(s.getId());
    if (hat(dabei, sid)) continue;
    dabei[sid] = true;
    if (!s.isDeleted()) fail(kurz(s) + " ist nicht geloescht.");
    var orte = ablageOrte(s);
    eintraege.push({ id: sid, name: S(s.getName()), art: isFolder(s) ? "Ordner" : "Dokument", eltern: S(s.getParentId()), ort: ortText(orte.haupt),
                     am: geloeschtAm(s), von: geloeschtVon(s), tiefe: orte.haupt.pfad ? orte.haupt.pfad.split("/").length : 0 });
    pauseNach(i);
  }
  /* Elternordner vor ihrem Inhalt; ein geloeschter Elternordner, der nicht in der Liste steht, blockiert. */
  eintraege.sort(function (x, y) { return x.tiefe - y.tiefe; });
  for (var j = 0; j < eintraege.length; j++) {
    var e = eintraege[j];
    if (e.eltern !== "1" && !hat(dabei, e.eltern)) {
      var el = null;
      try { el = sordAblage(e.eltern); } catch (ex) {}
      if (el && el.isDeleted()) fail(e.name + " [" + e.id + "]: der Elternordner " + kurz(el) + " ist selbst geloescht. Ihn zuerst wiederherstellen oder mit in objekte nehmen.");
    }
    if (e.art === "Ordner") {
      e.mit = mitZurueck(e.id, e.am, budget);
      if (e.mit.verweise.length && !einzeln)
        warn.push(e.name + " [" + e.id + "]: " + e.mit.verweise.length + " Verweise, die ab dem Loeschzeitpunkt entfernt wurden, kommen mit zurueck: " +
                  beispiele(e.mit.verweise, function (x) { return x.name + " [" + x.id + "] in " + x.ordner; }).join(" | ") + ". Danach ggf. mit elo_reference_set entfernen.");
    }
    fp.push(e.id + "|" + e.eltern + "|" + e.am + (e.mit ? "|" + e.mit.unterordner + "/" + e.mit.dokumente + "/" + e.mit.verweise.length + "/" + e.mit.bleiben : ""));
  }
  if (eintraege.some(function (x) { return x.art === "Ordner"; }))
    warn.push(einzeln ? "einzeln: Der Inhalt der Ordner bleibt geloescht."
                      : "Ordner kommen mit allem zurueck, was ab ihrem Loeschzeitpunkt (minutengenau) darin geloescht wurde, auch mit entfernten Verweisen; frueher Geloeschtes bleibt geloescht. Nur den Ordner selbst: einzeln=true.");
  return { plan: eintraege, einzeln: einzeln, warnungen: warn, fp: (einzeln ? "einzeln" : "baum") + "|" + fp.join(";"),
           vorschau: { aktion: "wiederherstellen" + (einzeln ? " (nur die Objekte selbst)" : ""), anzahl: eintraege.length,
                       objekte: eintraege.map(function (e) {
                         var o = { objekt: e.name + " [" + e.id + "]", art: e.art, ort: e.ort, geloeschtAm: utcLesbar(e.am), geloeschtVon: e.von };
                         if (e.mit && !einzeln) o.mitZurueck = { unterordner: e.mit.unterordner, dokumente: e.mit.dokumente, verweise: e.mit.verweise.length };
                         if (e.mit && (einzeln || e.mit.bleiben)) o.bleibenGeloescht = einzeln ? e.mit.unterordner + e.mit.dokumente + e.mit.verweise.length + e.mit.bleiben : e.mit.bleiben;
                         return o;
                       }),
                       hinweis: "Verweise, die vor dem Loeschen entfernt wurden, stellt elo_reference_set aktion=anlegen wieder her (die Sicherung nennt sie)." } };
}

tool("elo_restore",
  "Stellt geloeschte Objekte wieder her (zweistufig, Stufe 3), wie 'Wiederherstellen' im Client. Ordner kommen mit allem zurueck, was ab ihrem Loeschzeitpunkt darin geloescht wurde, " +
  "auch mit in dieser Zeit entfernten Verweisen; die Vorschau zaehlt das. Mit einzeln=true nur das Objekt selbst. Ein geloeschter Elternordner muss zuerst (oder im selben Aufruf) zurueck. " +
  "Frueher entfernte Verweise stellt elo_reference_set wieder her. Hoechstens " + LIMIT_ABLAGE.objekte + " Objekte.",
  { objekte: P_OBJEKTE, einzeln: { type: "boolean", description: "Nur die Objekte selbst, ohne den mitgeloeschten Inhalt" }, token: P_TOKEN },
  ["objekte"], function (a) {
    return zweiSchritte("elo_restore", a, function () { return wiederherstellenPlan(a); }, function (p) {
      var ok = [], mit = [], fehler = [];
      for (var i = 0; i < p.plan.length; i++) {
        var e = p.plan[i], ro = new IXC.RestoreOptions();
        ro.setSingleObject(p.einzeln);
        if (!p.einzeln && e.am) ro.setMinDeleteDate(e.am);
        try {
          // Kam schon mit einem Elternordner aus derselben Liste zurueck.
          if (i > 0 && !sordAblage(e.id).isDeleted()) { mit.push(e.id); continue; }
          ELO.ix().restoreSord(e.id, ro);
          if (!sordAblage(e.id).isDeleted()) ok.push(e.id);
          else fehler.push({ objekt: e.id, fehler: "ABWEICHUNG: nach dem Wiederherstellen noch geloescht" });
        } catch (ex) { fehler.push({ objekt: e.id, fehler: errText(ex) }); }
        pauseNach(i);
      }
      return { wiederhergestellt: ok.length, ids: ok, mitElternordner: mit.length ? mit : undefined, fehler: fehler.length ? fehler : undefined };
    });
  }, 3);
