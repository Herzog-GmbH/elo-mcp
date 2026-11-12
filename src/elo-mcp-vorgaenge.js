/*
 * elo-mcp-vorgaenge.js - laufende Vorgaenge und Vorlagen gezielt aendern, Formularseiten,
 * Text in einer Akte ersetzen. Wird nach elo-mcp-bauen.js geladen (nutzt zweiSchritte,
 * sicherungsOrdner, sichereVorlage, vorlageNachName, benutzerName, pruefeSkript, zeilenDiff ...).
 *
 *   elo_workflows_of_template  Stufe 1  laufende Vorgaenge einer Vorlage (nur ACTIVE, ueber templateId)
 *   elo_workflow_node_set      Stufe 3  Knoten an Vorlage oder laufenden Vorgaengen aendern
 *   elo_workflow_activate      Stufe 3  nie betretenen Personenknoten aktivieren, Sammler durchschalten
 *   elo_workflow_edges         Stufe 3  Kanten an Vorlage oder Vorgang ergaenzen/entfernen
 *   elo_form_pages             Stufe 3  mehrere Formularseiten in einem Zug, Formularordner nach Vorbild
 *   elo_rename_in_folder       Stufe 2  Wort in Kurzbezeichnung und Feldern einer Akte ersetzen, Vorgangsnamen
 *
 * Fallen, die hier eingebaut sind:
 *   - Gesperrte Vorgaenge nur mit mbOnlyLock entsperren. Mit mbAll eingecheckt landen halb
 *     geaenderte Knoten im Archiv.
 *   - Ein Sammelknoten laesst sich nicht weiterleiten (ELOIX:2000 "is not a person node").
 *     Aktivieren heisst: Ziel betreten, isNext 1; Sammler verlassen, isNext 0, Kante erledigt.
 *     Skripte am Knoten (onEnter) laufen dabei nicht.
 *   - ELOwf beschriftet den Weiterleiten-Knopf mit dem Label des NACHFOLGERS.
 *   - Ohne FLAG_ONE_SUCCESSOR (1) zeigt ELOwf bei mehreren Nachfolgern Checkboxen statt Knoepfe.
 *   - Laufende Vorgaenge haben ihre eigene Kopie der Vorlage; Aenderungen an der Vorlage
 *     erreichen sie nicht.
 */
var LIMIT_VG = { vorgaenge: 20, liste: 100, mitKnoten: 10, objekte: 300, ebenen: 3, seiten: 30 };
var FORMS_PFAD = "Administration/ELOwf Base/Forms";

/* ---------- Hilfen fuer Workflows ---------- */

function wfTyp(art) {
  if (art !== "vorlage" && art !== "aktiv") fail("art muss 'vorlage' oder 'aktiv' sein.");
  return art === "aktiv" ? IXC.WFTypeC.ACTIVE : IXC.WFTypeC.TEMPLATE;
}
function wfLesen(id, art, sperren) {
  if (!/^\d+$/.test(trim(id))) fail("Workflow-ID ist keine Zahl: " + S(id));
  return ELO.ix().checkoutWorkFlow(trim(id), wfTyp(art), IXC.WFDiagramC.mbAll, sperren ? IXC.LockC.YES : IXC.LockC.NO);
}
function wfEntsperren(wf) {
  try { ELO.ix().checkinWorkFlow(wf, IXC.WFDiagramC.mbOnlyLock, IXC.LockC.YES); }
  catch (e) { log("Workflow " + S(wf.getId()) + " entsperren fehlgeschlagen: " + e); }
}
function wfSperre(wf) { try { return S(wf.getLockName()); } catch (e) { return ""; } }
function wfKnoten(wf) {
  var m = {}, n = wf.getNodes();
  for (var i = 0; n && i < n.length; i++) if (n[i].getType() !== 0) m[n[i].getId()] = n[i];
  return m;
}
function wfKanten(wf) {
  var out = [], m = wf.getMatrix(), as = m ? m.getAssocs() : null;
  for (var i = 0; as && i < as.length; i++) out.push(as[i]);
  return out;
}
function kantenTyp(k) { try { return k.getType(); } catch (e) { return -3; } }
function kantenDone(k) { try { return !!k.isDone(); } catch (e) { return false; } }
function knotenZustand(n) {
  var z = { id: n.getId(), typ: n.getType(), name: S(n.getName()), label: S(n.getLabel()), formular: S(n.getFormSpec()),
            bedingung: S(n.getYesNoCondition()), flags: n.getFlags(), bearbeiter: S(n.getUserName()), bearbeiterId: n.getUserId(),
            props: S(n.getProperties()), startSkript: S(n.getOnEnter()), endeSkript: S(n.getOnExit()) };
  try { z.betreten = S(n.getEnterDateIso()); z.verlassen = S(n.getExitDateIso()); z.isNext = n.getIsNext(); } catch (e) {}
  if (n.getType() === 5) z.dones = n.getNbOfDonesToExit();
  return z;
}
function knotenKurz(n) {
  return S(n.getId()) + " " + (NODE_TYPE[n.getType()] || ("Typ " + n.getType())) + " '" + S(n.getName()) + "'" +
         (S(n.getUserName()) ? " (" + S(n.getUserName()) + ")" : "");
}
function wfAbbild(wf, art) {
  var k = wfKnoten(wf), o = { id: S(wf.getId()), name: S(wf.getName()), art: art, sperre: wfSperre(wf), knoten: [], kanten: [] };
  for (var id in k) o.knoten.push(knotenZustand(k[id]));
  var ks = wfKanten(wf);
  for (var i = 0; i < ks.length; i++) o.kanten.push([ks[i].getNodeFrom(), ks[i].getNodeTo(), kantenTyp(ks[i]), kantenDone(ks[i])]);
  return o;
}
function wfFp(wf, art) { return JSON.stringify(wfAbbild(wf, art)); }

/* Sicherung: JSON-Abbild immer, bei Vorlagen zusaetzlich das ELO-Exportformat (.ewf). */
function wfSichern(wf, art, suffix) {
  var f = new java.io.File(sicherungsOrdner(), "wf-" + S(wf.getId()) + "-" + zeitstempel() + suffix + ".json");
  var w = new java.io.OutputStreamWriter(new java.io.FileOutputStream(f), "UTF-8");
  try { w.write(JSON.stringify(wfAbbild(wf, art), null, 1)); } finally { w.close(); }
  var out = [S(f.getAbsolutePath())];
  if (art === "vorlage") { try { out.push(sichereVorlage(S(wf.getId()), suffix)); } catch (e) { log("Sicherung .ewf fehlgeschlagen: " + e); } }
  return out;
}

function idListe(werte, max, was) {
  var out = [], gesehen = {};
  if (werte === undefined || werte === null) return out;
  if (!(werte instanceof Array)) werte = [werte];
  for (var i = 0; i < werte.length; i++) {
    var v = trim(werte[i]);
    if (!/^\d+$/.test(v)) fail(was + ": '" + S(werte[i]) + "' ist keine ID.");
    if (!gesehen[v]) { gesehen[v] = true; out.push(v); }
  }
  if (out.length > max) fail("Hoechstens " + max + " " + was + " je Aufruf.");
  return out;
}
function knotenIds(werte) {
  var out = [];
  if (!(werte instanceof Array)) werte = [werte];
  for (var i = 0; i < werte.length; i++) {
    var n = parseInt(S(werte[i]), 10);
    if (!(n >= 0) || S(n) !== trim(werte[i])) fail("Knoten-ID ungueltig: " + JSON.stringify(werte[i]));
    if (out.indexOf(n) < 0) out.push(n);
  }
  if (!out.length) fail("knoten ist leer.");
  return out;
}
function warte(ms) { try { java.lang.Thread.sleep(ms); } catch (e) {} }

/* ---------- Stufe 1: laufende Vorgaenge einer Vorlage ---------- */

function vorlagenId(v) {
  v = trim(v);
  if (!v) fail("vorlage fehlt.");
  if (/^\d+$/.test(v)) return v;
  var ids = vorlageNachName(v);
  if (!ids.length) fail("Keine Vorlage mit dem Namen '" + v + "'.");
  if (ids.length > 1) fail("Mehrere Vorlagen heissen '" + v + "': " + ids.join(", ") + ". Bitte ID angeben.");
  return ids[0];
}

tool("elo_workflows_of_template",
  "Laufende Vorgaenge einer Workflow-Vorlage (nur aktive, Suche ueber die Vorlagen-ID, hoechstens " + LIMIT_VG.liste + "). Optional fuer die ersten " + LIMIT_VG.mitKnoten + " die aktiven Knoten. Beendete Vorgaenge werden bewusst nicht durchsucht (kann den Indexserver ueberlasten).",
  { vorlage: { type: "string", description: "Vorlagen-ID oder exakter Name" },
    max: { type: "integer", description: "Standard 50, hoechstens " + LIMIT_VG.liste },
    mitAktivenKnoten: { type: "boolean", description: "Fuer die ersten " + LIMIT_VG.mitKnoten + " Vorgaenge die aktiven Knoten nachlesen" } },
  ["vorlage"], function (a) {
    var id = vorlagenId(a.vorlage), name = "";
    try { name = S(ELO.ix().checkoutWorkFlow(id, IXC.WFTypeC.TEMPLATE, IXC.WFDiagramC.mbLean, IXC.LockC.NO).getName()); }
    catch (e) { fail("Vorlage " + id + " nicht gefunden: " + errText(e)); }
    var fwi = new IXC.FindWorkflowInfo(); fwi.setType(IXC.WFTypeC.ACTIVE); fwi.setTemplateId(id);
    var fr = ELO.ix().findFirstWorkflows(fwi, cap(a.max, 50, LIMIT_VG.liste), IXC.WFDiagramC.mbLean), res = [], mehr = false;
    try {
      var w = fr.getWorkflows(); mehr = !!fr.isMoreResults();
      for (var i = 0; w && i < w.length; i++) res.push({ id: S(w[i].getId()), name: S(w[i].getName()), objekt: S(w[i].getObjId()),
                                                         gestartet: S(w[i].getStartDateIso()), eigentuemer: S(w[i].getOwnerName()) });
    } finally { try { ELO.ix().findClose(fr.getSearchId()); } catch (e) {} }
    if (a.mitAktivenKnoten) {
      for (var j = 0; j < res.length && j < LIMIT_VG.mitKnoten; j++) {
        if (j) warte(200);
        try {
          var d = workflowDetail(res[j].id, "aktiv", true), akt = [];
          for (var k = 0; k < d.knoten.length; k++) if (d.knoten[k].aktiv) akt.push(d.knoten[k].id + " " + d.knoten[k].name + (d.knoten[k].bearbeiter ? " (" + d.knoten[k].bearbeiter + ")" : ""));
          res[j].aktiveKnoten = akt;
        } catch (e) { res[j].aktiveKnoten = "nicht lesbar: " + errText(e); }
      }
    }
    return { vorlage: name + " [" + id + "]", aktiv: res.length, mehrAlsAngezeigt: mehr, vorgaenge: res };
  });

/* ---------- Stufe 3: Knoten aendern ---------- */

/* Skripteigenschaften: ganz ersetzen (props) oder einzelne Schluessel ergaenzen/entfernen (propsErgaenzen). */
function propsNeu(alt, ae, warn) {
  if (ae.props !== undefined && ae.propsErgaenzen !== undefined) fail("props und propsErgaenzen nicht zusammen angeben.");
  if (ae.props !== undefined) {
    if (ae.props === null || ae.props === "") return "";
    if (typeof ae.props === "string") {
      try { JSON.parse(ae.props); } catch (e) { warn.push("props ist kein gueltiges JSON und wird als Text gespeichert."); }
      return ae.props;
    }
    return JSON.stringify(ae.props, null, 2);
  }
  if (ae.propsErgaenzen === undefined) return undefined;
  if (!ae.propsErgaenzen || typeof ae.propsErgaenzen !== "object" || ae.propsErgaenzen instanceof Array) fail("propsErgaenzen muss ein Objekt sein, z. B. {\"forwardToAll\": true}.");
  var o = {};
  if (trim(alt)) {
    try { o = JSON.parse(alt); } catch (e) { fail("Die bisherigen Skripteigenschaften sind kein JSON - propsErgaenzen geht nicht, props nehmen."); }
    if (!o || typeof o !== "object" || o instanceof Array) fail("Die bisherigen Skripteigenschaften sind kein JSON-Objekt - propsErgaenzen geht nicht.");
  }
  var vorher = JSON.stringify(o);
  for (var k in ae.propsErgaenzen) {
    if (ae.propsErgaenzen[k] === null) delete o[k]; else o[k] = ae.propsErgaenzen[k];
  }
  return JSON.stringify(o) === vorher ? alt : JSON.stringify(o, null, 2);
}

var AE_FELDER = ["name", "label", "formular", "bedingung", "flags", "bearbeiter", "bearbeiterId", "props", "propsErgaenzen"];

function aenderungPruefen(ae) {
  if (!ae || typeof ae !== "object") fail("aenderung fehlt.");
  var irgendwas = false;
  for (var k in ae) {
    if (AE_FELDER.indexOf(k) < 0) fail("aenderung: unbekanntes Feld '" + k + "'. Erlaubt: " + AE_FELDER.join(", ") + ".");
    irgendwas = true;
  }
  if (!irgendwas) fail("aenderung ist leer.");
  if (ae.flags !== undefined && (typeof ae.flags !== "number" || ae.flags < 0 || ae.flags !== Math.floor(ae.flags))) fail("flags muss eine ganze Zahl >= 0 sein.");
  if (ae.bearbeiterId !== undefined && typeof ae.bearbeiterId !== "number") fail("bearbeiterId muss eine Zahl sein.");
}

/* Bearbeiter einmal aufloesen: Name -> ID oder ID -> Name. */
function bearbeiterAufloesen(ae, warn) {
  if (ae.bearbeiter === undefined && ae.bearbeiterId === undefined) return null;
  var name = trim(ae.bearbeiter), id = ae.bearbeiterId;
  if (id === undefined) {
    if (!name) fail("bearbeiter ist leer.");
    try { var u = ELO.ix().checkoutUser(name, IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO); id = u.getId(); name = S(u.getName()); }
    catch (e) { fail("Benutzer oder Gruppe '" + ae.bearbeiter + "' nicht gefunden."); }
  } else if (id >= 0) {
    var nm = benutzerName(id);
    if (nm === null) fail("Benutzer-ID " + id + " gibt es nicht.");
    if (name && name !== nm) warn.push("bearbeiterId " + id + " ist '" + nm + "', angegeben war '" + name + "'. Die ID gilt.");
    name = nm;
  } else if (!name) fail("Sonderbearbeiter (ID " + id + ") braucht auch bearbeiter (Anzeigename).");
  return { name: name, id: id };
}

/* Zielwerte fuer einen Knoten; liefert nur, was sich aendert: { feld: { bisher, neu } } */
function knotenZiel(n, ae, bearb, warn) {
  var z = {}, alt = knotenZustand(n);
  function setz(feld, neu) { if (neu !== undefined && S(neu) !== S(alt[feld])) z[feld] = { bisher: alt[feld], neu: neu }; }
  if (ae.name !== undefined) { if (!trim(ae.name)) fail("name darf nicht leer sein."); setz("name", S(ae.name)); }
  if (ae.label !== undefined) setz("label", S(ae.label));
  if (ae.formular !== undefined) setz("formular", S(ae.formular));
  if (ae.bedingung !== undefined) setz("bedingung", S(ae.bedingung));
  if (ae.flags !== undefined) setz("flags", ae.flags);
  if (bearb) {
    if (n.getType() !== IXC.WFNodeC.TYPE_PERSONNODE) fail("Knoten " + knotenKurz(n) + " ist kein Personenknoten - Bearbeiter nur dort.");
    setz("bearbeiter", bearb.name); setz("bearbeiterId", bearb.id);
  }
  var p = propsNeu(alt.props, ae, warn);
  if (p !== undefined) setz("props", p);
  return z;
}

function knotenSetzen(n, z) {
  if (z.name) n.setName(S(z.name.neu));
  if (z.label) n.setLabel(S(z.label.neu));
  if (z.formular) n.setFormSpec(S(z.formular.neu));
  if (z.bedingung) n.setYesNoCondition(S(z.bedingung.neu));
  if (z.flags) n.setFlags(z.flags.neu);
  if (z.bearbeiter) n.setUserName(S(z.bearbeiter.neu));
  if (z.bearbeiterId) n.setUserId(z.bearbeiterId.neu);
  if (z.props) n.setProperties(S(z.props.neu));
}

function knotenPlan(a) {
  aenderungPruefen(a.aenderung);
  var art = a.art, ids = idListe(a.ids, art === "aktiv" ? LIMIT_VG.vorgaenge : 1, art === "aktiv" ? "Vorgaenge" : "Vorlagen");
  wfTyp(art);
  if (!ids.length) fail("ids fehlt.");
  var knoten = knotenIds(a.knoten), warn = [], ae = a.aenderung, bearb = bearbeiterAufloesen(ae, warn);
  var vorschau = [], fps = [], plaene = [], summe = 0;
  for (var i = 0; i < ids.length; i++) {
    if (i) warte(150);
    var wf = wfLesen(ids[i], art, false), k = wfKnoten(wf), zeile = { id: S(wf.getId()), name: S(wf.getName()), knoten: [] }, pl = { id: ids[i], ziele: {} };
    if (wfSperre(wf)) fail((art === "aktiv" ? "Vorgang " : "Vorlage ") + ids[i] + " ist gesperrt von " + wfSperre(wf) + ".");
    if (art === "aktiv") zeile.vorlage = S(wf.getTemplateId());
    for (var j = 0; j < knoten.length; j++) {
      var n = k[knoten[j]];
      if (!n) fail((art === "aktiv" ? "Vorgang " : "Vorlage ") + ids[i] + ": Knoten " + knoten[j] + " gibt es nicht.");
      var z = knotenZiel(n, ae, bearb, warn), anz = 0;
      for (var f in z) anz++;
      var zk = { knoten: knotenKurz(n) };
      if (anz) { zk.aenderungen = z; pl.ziele[knoten[j]] = z; summe += anz; } else zk.aenderungen = "bleibt";
      if (art === "aktiv" && anz) {
        var zs = knotenZustand(n);
        if (zs.verlassen) zk.hinweis = "schon verlassen - wirkt nur, wenn der Knoten noch einmal betreten wird";
        else if (zs.betreten) zk.hinweis = "gerade aktiv" + (z.bearbeiter || z.bearbeiterId ? " - die Aufgabe geht an den neuen Bearbeiter" : "");
      }
      zeile.knoten.push(zk);
    }
    vorschau.push(zeile); plaene.push(pl); fps.push(wfFp(wf, art));
  }
  if (!summe) fail("Keine Aenderung - alle Werte sind schon so.");
  if (ae.label !== undefined) warn.push("ELOwf beschriftet den Weiterleiten-Knopf mit dem Label des NACHFOLGERS (ohne Label mit dessen Namen).");
  if (ae.flags !== undefined && !(ae.flags & 1)) warn.push("Ohne Flag 1 (FLAG_ONE_SUCCESSOR) zeigt ELOwf bei mehreren Nachfolgern Checkboxen statt beschrifteter Knoepfe.");
  if (art === "vorlage") warn.push("Laufende Vorgaenge dieser Vorlage aendern sich nicht - dafuer art 'aktiv' mit ihren IDs (elo_workflows_of_template).");
  if (ae.formular !== undefined) warn.push("Neue Formulare erst nach 'Aktualisieren' im Formulardesigner sichtbar.");
  return { vorschau: { aktion: art === "aktiv" ? "Knoten in laufenden Vorgaengen aendern" : "Knoten einer Vorlage aendern", art: art, aenderungen: summe, workflows: vorschau },
           warnungen: warn, fp: fps.join("\n"), plaene: plaene, art: art };
}

tool("elo_workflow_node_set",
  "Aendert Knoten einer Vorlage oder laufender Vorgaenge (zweistufig): Name, Label (Knopftext beim Vorgaenger), Formular, Bedingung, Flags, Bearbeiter, Skripteigenschaften (ganz ersetzen mit props oder einzelne Schluessel mit propsErgaenzen, z. B. {\"forwardToAll\": true}; null entfernt einen Schluessel). Mehrere Knoten und bis zu " + LIMIT_VG.vorgaenge + " Vorgaenge in einem Aufruf. Sicherung vorher, zurueckgelesen danach. Nur mit -Bauen.",
  { ids: { type: "array", items: { type: "string" }, description: "Vorlagen-ID (genau eine) bzw. Vorgangs-IDs (bis " + LIMIT_VG.vorgaenge + ")" },
    art: { type: "string", enum: ["vorlage", "aktiv"], description: "vorlage oder aktiv (laufender Vorgang)" },
    knoten: { type: "array", items: { type: "integer" }, description: "Knoten-IDs, an denen dieselbe Aenderung gemacht wird" },
    aenderung: { type: "object", description: "Felder: name, label, formular, bedingung, flags (Zahl), bearbeiter (Name) und/oder bearbeiterId, props (Objekt oder Text, ersetzt alles), propsErgaenzen (Objekt, setzt einzelne Schluessel)" },
    token: P_TOKEN },
  ["ids", "art", "knoten", "aenderung"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_workflow_node_set", a, function () { return knotenPlan(a); }, function (p) {
      var ergebnis = [];
      for (var i = 0; i < p.plaene.length; i++) {
        var pl = p.plaene[i], r = { id: pl.id }, wf = null, gespeichert = false;
        if (i) warte(300);
        try {
          wf = wfLesen(pl.id, p.art, true);
          r.sicherung = wfSichern(wf, p.art, "-vorher");
          var k = wfKnoten(wf);
          for (var kid in pl.ziele) knotenSetzen(k[kid], pl.ziele[kid]);
          ELO.ix().checkinWorkFlow(wf, IXC.WFDiagramC.mbAll, IXC.LockC.YES); gespeichert = true;
          var chk = wfKnoten(wfLesen(pl.id, p.art, false)), abw = [];
          for (var kid2 in pl.ziele) {
            var ist = knotenZustand(chk[kid2]);
            for (var f in pl.ziele[kid2]) if (S(ist[f]) !== S(pl.ziele[kid2][f].neu)) abw.push("Knoten " + kid2 + " " + f + ": " + JSON.stringify(ist[f]));
          }
          r.gespeichert = true; r.zurueckgelesen = abw.length ? abw : "wie geplant";
        } catch (e) {
          if (wf && !gespeichert) wfEntsperren(wf);
          r.gespeichert = gespeichert; r.fehler = errText(e);
        }
        ergebnis.push(r);
      }
      return { art: p.art, workflows: ergebnis };
    });
  }, 3);

/* ---------- Stufe 3: Knoten aktivieren ---------- */

function jetztIso() {
  return S(java.time.ZonedDateTime.now(java.time.ZoneOffset.UTC).format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMddHHmm"))) + "00";
}

function aktivierenPlan(a) {
  var wf = wfLesen(a.id, "aktiv", false), k = wfKnoten(wf), warn = [];
  if (wfSperre(wf)) fail("Vorgang ist gesperrt von " + wfSperre(wf) + ".");
  var zielId = knotenIds([a.knoten])[0], x = k[zielId];
  if (!x) fail("Knoten " + zielId + " gibt es nicht.");
  var zx = knotenZustand(x);
  if (x.getType() !== IXC.WFNodeC.TYPE_PERSONNODE) fail("Ziel " + knotenKurz(x) + " ist kein Personenknoten.");
  if (zx.isNext !== 0 || zx.betreten) fail("Ziel " + knotenKurz(x) + " wurde schon betreten oder ist aktiv (betreten " + (zx.betreten || "-") + ", isNext " + zx.isNext + ").");
  if (zx.startSkript) warn.push("Das Startskript '" + zx.startSkript + "' am Ziel laeuft dabei NICHT.");
  var v = { aktion: "Knoten aktivieren", vorgang: S(wf.getName()) + " [" + S(wf.getId()) + "]", vorlage: S(wf.getTemplateId()), objekt: S(wf.getObjId()),
            ziel: knotenKurz(x) + ": wird betreten, isNext 1, erscheint als Aufgabe" };
  var sm = null, ks = wfKanten(wf);
  if (a.sammler !== undefined && a.sammler !== null && S(a.sammler) !== "") {
    var smId = knotenIds([a.sammler])[0];
    sm = k[smId];
    if (!sm) fail("Sammler " + smId + " gibt es nicht.");
    var zs = knotenZustand(sm);
    if (sm.getType() !== IXC.WFNodeC.TYPE_COLLECTNODE) fail("Knoten " + knotenKurz(sm) + " ist kein Sammelknoten.");
    if (zs.isNext !== 1 || !zs.betreten || zs.verlassen) fail("Sammler " + knotenKurz(sm) + " ist nicht aktiv (betreten " + (zs.betreten || "-") + ", verlassen " + (zs.verlassen || "-") + ", isNext " + zs.isNext + ").");
    var kante = false, rein = [];
    for (var i = 0; i < ks.length; i++) {
      if (ks[i].getNodeFrom() === smId && ks[i].getNodeTo() === zielId) kante = true;
      if (ks[i].getNodeTo() === smId) rein.push(ks[i].getNodeFrom() + (kantenDone(ks[i]) ? " erledigt" : " offen"));
    }
    if (!kante) fail("Ziel " + zielId + " ist kein direkter Nachfolger des Sammlers " + smId + ".");
    v.sammler = knotenKurz(sm) + ": wird verlassen, isNext 0, Kante " + smId + ">" + zielId + " erledigt";
    v.inDenSammler = rein;
    if (zs.endeSkript) warn.push("Das Ende-Skript '" + zs.endeSkript + "' am Sammler laeuft dabei NICHT.");
    var andere = [];
    for (var j = 0; j < ks.length; j++) if (ks[j].getNodeFrom() === smId && ks[j].getNodeTo() !== zielId) andere.push(ks[j].getNodeTo());
    if (andere.length) warn.push("Der Sammler hat weitere Nachfolger (" + andere.join(", ") + "), die NICHT aktiviert werden.");
  } else {
    var vorg = [];
    for (var m = 0; m < ks.length; m++) if (ks[m].getNodeTo() === zielId) vorg.push(ks[m].getNodeFrom());
    var aktiveVorg = [];
    for (var q = 0; q < vorg.length; q++) { var zq = k[vorg[q]] ? knotenZustand(k[vorg[q]]) : null; if (zq && zq.isNext === 1 && zq.betreten && !zq.verlassen) aktiveVorg.push(knotenKurz(k[vorg[q]])); }
    if (aktiveVorg.length) warn.push("Ein Vorgaenger ist noch aktiv (" + aktiveVorg.join("; ") + ") und bleibt es. Haengt dort ein Sammler, mit sammler durchschalten.");
  }
  warn.push("Entscheidungs- und Verteilerknoten vor dem Ziel werden uebersprungen; ihre Skripte laufen nicht.");
  return { vorschau: v, warnungen: warn, fp: wfFp(wf, "aktiv"), id: S(wf.getId()), zielId: zielId, sammlerId: sm ? sm.getId() : -1 };
}

tool("elo_workflow_activate",
  "Aktiviert in einem laufenden Vorgang einen nie betretenen Personenknoten (betreten jetzt, isNext 1), z. B. wenn ein Warte- oder Verteilerknoten nur den ersten Nachfolger angestossen hat. Mit sammler wird vorher der haengende Sammelknoten durchgeschaltet (verlassen, isNext 0, Kante erledigt) - Sammelknoten lassen sich nicht weiterleiten. Skripte am Knoten laufen dabei nicht. Zweistufig, Sicherung vorher. Nur mit -Bauen.",
  { id: { type: "string", description: "ID des laufenden Vorgangs" },
    knoten: { type: "integer", description: "Ziel: Personenknoten, der aktiviert werden soll" },
    sammler: { type: "integer", description: "Optional: aktiver Sammelknoten direkt vor dem Ziel, der dabei verlassen wird" },
    token: P_TOKEN },
  ["id", "knoten"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_workflow_activate", a, function () { return aktivierenPlan(a); }, function (p) {
      var wf = wfLesen(p.id, "aktiv", true), gespeichert = false, sich;
      try {
        sich = wfSichern(wf, "aktiv", "-vorher");
        var k = wfKnoten(wf), jetzt = jetztIso(), x = k[p.zielId];
        if (p.sammlerId >= 0) {
          var sm = k[p.sammlerId], ks = wfKanten(wf);
          sm.setExitDateIso(jetzt); sm.setInUseDateIso(jetzt); sm.setIsNext(0);
          for (var i = 0; i < ks.length; i++) if (ks[i].getNodeFrom() === p.sammlerId && ks[i].getNodeTo() === p.zielId) ks[i].setDone(true);
        }
        x.setEnterDateIso(jetzt); x.setExitDateIso(""); x.setIsNext(1);
        ELO.ix().checkinWorkFlow(wf, IXC.WFDiagramC.mbAll, IXC.LockC.YES); gespeichert = true;
      } finally { if (!gespeichert) wfEntsperren(wf); }
      var w2 = wfLesen(p.id, "aktiv", false), k2 = wfKnoten(w2), res = { id: p.id, sicherung: sich, ziel: knotenZustand(k2[p.zielId]) };
      res.zielAktiv = res.ziel.isNext === 1 && !!res.ziel.betreten && !res.ziel.verlassen;
      if (p.sammlerId >= 0) {
        res.sammler = knotenZustand(k2[p.sammlerId]);
        var ks2 = wfKanten(w2);
        for (var j = 0; j < ks2.length; j++) if (ks2[j].getNodeFrom() === p.sammlerId && ks2[j].getNodeTo() === p.zielId) res.kanteErledigt = kantenDone(ks2[j]);
      }
      return res;
    });
  }, 3);

/* ---------- Stufe 3: Kanten ---------- */

function kanteLesen(e, mitTyp) {
  if (!(e instanceof Array) || e.length < 2 || e.length > (mitTyp ? 3 : 2)) fail("Kante als [von, nach" + (mitTyp ? ", \"ja\"|\"nein\"" : "") + "] angeben: " + JSON.stringify(e));
  var von = knotenIds([e[0]])[0], nach = knotenIds([e[1]])[0], typ = -3;
  if (mitTyp && e[2] !== undefined && e[2] !== null && e[2] !== "") {
    if (e[2] === "ja") typ = -1; else if (e[2] === "nein") typ = -2; else fail("Dritter Wert nur \"ja\" oder \"nein\": " + JSON.stringify(e));
  }
  return { von: von, nach: nach, typ: typ };
}

function kantenPlan(a) {
  var art = a.art; wfTyp(art);
  var neu = a.neu || [], weg = a.entfernen || [], warn = [];
  if (!(neu instanceof Array) || !(weg instanceof Array)) fail("neu und entfernen sind Listen von Kanten.");
  if (!neu.length && !weg.length) fail("Weder neu noch entfernen angegeben.");
  var wf = wfLesen(a.id, art, false), k = wfKnoten(wf), ks = wfKanten(wf);
  if (wfSperre(wf)) fail("Workflow ist gesperrt von " + wfSperre(wf) + ".");
  var da = {}, nachfolger = {}, plusN = [], minusN = [], zeilen = [];
  for (var i = 0; i < ks.length; i++) {
    var key = ks[i].getNodeFrom() + ">" + ks[i].getNodeTo();
    da[key] = ks[i]; (nachfolger[ks[i].getNodeFrom()] = nachfolger[ks[i].getNodeFrom()] || []).push(ks[i].getNodeTo());
  }
  function name(id) { if (!k[id]) fail("Knoten " + id + " gibt es nicht."); return knotenKurz(k[id]); }
  var wegKeys = {};
  for (var w = 0; w < weg.length; w++) {
    var kw = kanteLesen(weg[w], false), kk = kw.von + ">" + kw.nach;
    name(kw.von); name(kw.nach);
    if (!da[kk]) fail("Kante " + kk + " gibt es nicht.");
    if (art === "aktiv" && kantenDone(da[kk])) fail("Kante " + kk + " ist im Vorgang schon erledigt - nicht entfernen.");
    wegKeys[kk] = true; minusN.push(kk); zeilen.push("entfernen " + kk + ": " + name(kw.von) + " -> " + name(kw.nach));
  }
  var dazu = [];
  for (var n = 0; n < neu.length; n++) {
    var kn = kanteLesen(neu[n], true), kk2 = kn.von + ">" + kn.nach, vn = name(kn.von), nn = name(kn.nach);
    if (da[kk2] && !wegKeys[kk2]) { warn.push("Kante " + kk2 + " gibt es schon - uebersprungen."); continue; }
    if (kn.von === kn.nach) fail("Kante " + kk2 + " verweist auf sich selbst.");
    if (k[kn.nach].getType() === IXC.WFNodeC.TYPE_BEGINNODE) fail("Kante " + kk2 + " fuehrt in den Startknoten.");
    if (k[kn.von].getType() === 6) warn.push("Kante " + kk2 + " beginnt an einem Endknoten.");
    if (kn.typ !== -3 && k[kn.von].getType() !== 4) warn.push("Kante " + kk2 + ": ja/nein gilt nur an Entscheidungsknoten.");
    if (kn.typ === -3 && k[kn.von].getType() === 4) warn.push("Kante " + kk2 + " geht ohne ja/nein von einer Entscheidung ab.");
    dazu.push(kn); plusN.push(kk2); zeilen.push("neu " + kk2 + (kn.typ === -1 ? " ja" : (kn.typ === -2 ? " nein" : "")) + ": " + vn + " -> " + nn);
  }
  if (!dazu.length && !minusN.length) fail("Nichts zu tun.");
  // Nachfolger danach pruefen
  var zahl = {};
  for (var z in k) zahl[z] = 0;
  for (var j = 0; j < ks.length; j++) if (!wegKeys[ks[j].getNodeFrom() + ">" + ks[j].getNodeTo()]) zahl[ks[j].getNodeFrom()]++;
  for (var d = 0; d < dazu.length; d++) zahl[dazu[d].von]++;
  for (var z2 in k) {
    if (zahl[z2] > 20) fail("Knoten " + name(z2) + " haette mehr als 20 Nachfolger.");
    if (zahl[z2] === 0 && k[z2].getType() !== 6 && minusN.length) {
      var betroffen = false; for (var mm = 0; mm < minusN.length; mm++) if (minusN[mm].split(">")[0] === S(z2)) betroffen = true;
      if (betroffen) fail("Knoten " + name(z2) + " haette danach keinen Nachfolger - der Vorgang bliebe dort haengen.");
    }
  }
  if (art === "vorlage") warn.push("Laufende Vorgaenge dieser Vorlage aendern sich nicht.");
  return { vorschau: { aktion: art === "aktiv" ? "Kanten im laufenden Vorgang" : "Kanten der Vorlage", workflow: S(wf.getName()) + " [" + S(wf.getId()) + "]",
                       kantenVorher: ks.length, kantenNachher: ks.length - minusN.length + dazu.length, aenderungen: zeilen },
           warnungen: warn, fp: wfFp(wf, art), id: S(wf.getId()), art: art, dazu: dazu, weg: wegKeys };
}

tool("elo_workflow_edges",
  "Kanten (Verbindungen) an einer Vorlage oder einem laufenden Vorgang ergaenzen oder entfernen (zweistufig). Vorhandene Kanten behalten ihren Erledigt-Stand. Prueft: Knoten vorhanden, keine Kante in den Start, ja/nein nur an Entscheidungen, hoechstens 20 Nachfolger, kein Knoten ohne Nachfolger, erledigte Kanten im Vorgang bleiben. Sicherung vorher. Nur mit -Bauen.",
  { id: { type: "string", description: "Vorlagen- oder Vorgangs-ID" },
    art: { type: "string", enum: ["vorlage", "aktiv"] },
    neu: { type: "array", items: { type: "array" }, description: "Neue Kanten als [von, nach] oder [von, nach, \"ja\"|\"nein\"]" },
    entfernen: { type: "array", items: { type: "array" }, description: "Zu entfernende Kanten als [von, nach]" },
    token: P_TOKEN },
  ["id", "art"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_workflow_edges", a, function () { return kantenPlan(a); }, function (p) {
      var wf = wfLesen(p.id, p.art, true), gespeichert = false, sich;
      try {
        sich = wfSichern(wf, p.art, "-vorher");
        var alt = wfKanten(wf), liste = [];
        for (var i = 0; i < alt.length; i++) if (!p.weg[alt[i].getNodeFrom() + ">" + alt[i].getNodeTo()]) liste.push(alt[i]);
        for (var j = 0; j < p.dazu.length; j++) liste.push(new IXC.WFNodeAssoc(p.dazu[j].von, p.dazu[j].nach, p.dazu[j].typ));
        var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.WFNodeAssoc"), liste.length);
        for (var k = 0; k < liste.length; k++) arr[k] = liste[k];
        var m = new IXC.WFNodeMatrix(); m.setAssocs(arr); wf.setMatrix(m);
        ELO.ix().checkinWorkFlow(wf, IXC.WFDiagramC.mbAll, IXC.LockC.YES); gespeichert = true;
      } finally { if (!gespeichert) wfEntsperren(wf); }
      var chk = wfKanten(wfLesen(p.id, p.art, false)), ist = {}, fehlt = [], nochDa = [];
      for (var c = 0; c < chk.length; c++) ist[chk[c].getNodeFrom() + ">" + chk[c].getNodeTo()] = true;
      for (var d = 0; d < p.dazu.length; d++) if (!ist[p.dazu[d].von + ">" + p.dazu[d].nach]) fehlt.push(p.dazu[d].von + ">" + p.dazu[d].nach);
      for (var w in p.weg) if (ist[w]) nochDa.push(w);
      return { id: p.id, art: p.art, sicherung: sich, kanten: chk.length, zurueckgelesen: (fehlt.length || nochDa.length) ? { fehlen: fehlt, nochDa: nochDa } : "wie geplant" };
    });
  }, 3);

/* ---------- Stufe 3: Formularseiten ---------- */

function kindNachName(ordnerId, name) {
  var ids = namensgleiche(ordnerId, name);
  if (ids.length > 1) fail("Unter " + ordnerId + " gibt es '" + name + "' mehrfach (" + ids.join(", ") + ").");
  return ids.length ? sordOf(ids[0]) : null;
}
function aktuelleVersion(id) {
  var v = versionsOf(id);
  for (var i = 0; i < v.docs.length; i++) if (v.docs[i].isWorkVersion()) return v.docs[i];
  return null;
}
/* Referenzen eines Ordners: Eintraege, deren eigentlicher Elternordner ein anderer ist. */
function referenzenVon(ordner) {
  var k = ELO.children(S(ordner.getId()), 200), out = [];
  for (var i = 0; i < k.length; i++) if (S(k[i].getParentId()) !== S(ordner.getId())) out.push(k[i]);
  return out;
}

function formPlan(a) {
  var name = trim(a.formular), dir = new java.io.File(S(a.verzeichnis)), warn = [];
  if (!name || /[\/\\]/.test(name)) fail("formular: Name des Formularordners unter " + FORMS_PFAD + ".");
  if (!dir.isDirectory()) fail("Verzeichnis nicht gefunden: " + S(a.verzeichnis));
  var seiten = a.seiten;
  if (!(seiten instanceof Array) || !seiten.length) fail("seiten fehlt.");
  if (seiten.length > LIMIT_VG.seiten) fail("Hoechstens " + LIMIT_VG.seiten + " Seiten je Aufruf.");
  var kommentar = trim(a.kommentar) || "ueber ELO-MCP";
  if (kommentar.length > 64) fail("Versionskommentar hoechstens 64 Zeichen.");
  var forms;
  try { forms = sordOf(FORMS_PFAD); } catch (e) { fail(FORMS_PFAD + " nicht gefunden: " + errText(e)); }
  var ordner = kindNachName(S(forms.getId()), name), vorbildOrdner = null, refs = [], vorbild = null, fp = [];
  if (!ordner) {
    if (!trim(a.neuNachVorbild)) fail("Formular '" + name + "' gibt es nicht. Zum Anlegen neuNachVorbild angeben (vorhandenes Formular als Vorbild).");
    vorbildOrdner = kindNachName(S(forms.getId()), trim(a.neuNachVorbild));
    if (!vorbildOrdner) fail("Vorbild-Formular '" + a.neuNachVorbild + "' nicht gefunden.");
    var vk = referenzenVon(vorbildOrdner);
    if (a.referenzen !== undefined) {
      if (!(a.referenzen instanceof Array)) fail("referenzen ist eine Liste von Namen.");
      var alle = ELO.children(S(vorbildOrdner.getId()), 200);
      vk = [];
      for (var r = 0; r < a.referenzen.length; r++) {
        var gef = null; for (var r2 = 0; r2 < alle.length; r2++) if (S(alle[r2].getName()) === S(a.referenzen[r])) gef = alle[r2];
        if (!gef) fail("Referenz '" + a.referenzen[r] + "' gibt es im Vorbild nicht.");
        vk.push(gef);
      }
    }
    for (var q = 0; q < vk.length; q++) refs.push(vk[q]);
    fp.push("neu|" + S(vorbildOrdner.getId()));
  } else {
    if (a.neuNachVorbild) warn.push("Formular gibt es schon - neuNachVorbild wird ignoriert.");
    fp.push(S(ordner.getId()));
  }
  var vorhanden = {}, quelle = ordner || vorbildOrdner, kinder = ELO.children(S(quelle.getId()), 200);
  for (var i = 0; i < kinder.length; i++) {
    if (isFolder(kinder[i])) continue;
    if (ordner) vorhanden[S(kinder[i].getName())] = kinder[i];
    if (S(kinder[i].getName()) === "Header" && !vorbild) vorbild = kinder[i];
  }
  if (!vorbild) for (var i2 = 0; i2 < kinder.length; i2++) if (!isFolder(kinder[i2]) && S(kinder[i2].getParentId()) === S(quelle.getId())) { vorbild = kinder[i2]; break; }
  var vv = vorbild ? aktuelleVersion(S(vorbild.getId())) : null, ext = vv ? S(vv.getExt()) : "";
  var plan = [], zeilen = [], arbeit = 0, pfad = FORMS_PFAD + "/" + name;
  for (var s = 0; s < seiten.length; s++) {
    var sn = trim(seiten[s]);
    if (!sn || /[\/\\]/.test(sn)) fail("Seitenname ungueltig: " + JSON.stringify(seiten[s]));
    var datei = new java.io.File(dir, sn);
    if (!datei.isFile()) fail("Datei fehlt: " + S(datei.getAbsolutePath()));
    var d = lokaleDatei(S(datei.getAbsolutePath())), text = dekodiere(java.nio.file.Files.readAllBytes(datei.toPath())).text;
    var chk = pruefeSkript(text, ext || d.ext, pfad);
    if (chk.fehler.length) fail("Seite " + sn + " (" + chk.art + ") fehlerhaft:\n- " + chk.fehler.join("\n- "));
    var alt = vorhanden[sn];
    if (alt) {
      if (S(alt.getParentId()) !== S(ordner.getId())) fail("Seite " + sn + " ist im Formular nur eine Referenz [" + S(alt.getId()) + "] - die gehoert einem anderen Formular, nicht hier aendern.");
      if (S(alt.getLockName())) fail("Seite " + sn + " ist gesperrt von " + S(alt.getLockName()) + ".");
      var av = aktuelleVersion(S(alt.getId()));
      fp.push(sn + "|" + S(alt.getId()) + "|" + (av ? S(av.getId()) + "|" + S(av.getMd5()) : "") + "|" + d.md5);
      if (av && S(av.getMd5()).toUpperCase() === d.md5) { zeilen.push(sn + ": unveraendert"); continue; }
      var altText = av ? dekodiere(readAll(ELO.connect().download(av.getUrl(), 0, -1), LIMIT.dateiBytes)).text : "";
      var zd = zeilenDiff(altText, text);
      zeilen.push({ seite: sn, aktion: "neue Version [" + S(alt.getId()) + "]", ab: zd.ab, entfernt: zd.entfernt, eingefuegt: zd.eingefuegt, alt: zd.alt, neu: zd.neu });
      plan.push({ seite: sn, id: S(alt.getId()), datei: d, akt: av });
    } else {
      fp.push(sn + "|neu|" + d.md5);
      zeilen.push(sn + ": neu, " + d.bytes + " Bytes, Endung ." + (ext || d.ext || "?"));
      plan.push({ seite: sn, id: null, datei: d });
    }
    arbeit++;
  }
  if (!arbeit && ordner) fail("Nichts zu tun - alle Seiten sind unveraendert.");
  if (plan.length && !vorbild) fail("Kein Vorbild-Dokument (Header) fuer Maske und Rechte neuer Seiten gefunden.");
  warn.push("Danach: Formulardesigner 'Aktualisieren'.");
  var v = { aktion: "Formularseiten", formular: pfad + (ordner ? " [" + S(ordner.getId()) + "]" : " (neu)"), seiten: zeilen, kommentar: kommentar };
  if (vorbild) v.vorbildFuerNeueSeiten = S(vorbild.getName()) + " [" + S(vorbild.getId()) + "], Maske " + S(vorbild.getMaskName()) + ", Endung ." + ext;
  if (!ordner) {
    v.neuerOrdner = "nach Vorbild " + S(vorbildOrdner.getName()) + " [" + S(vorbildOrdner.getId()) + "]: Maske, Typ, Rechte, Beschreibung (Formulareinstellungen)";
    var rn = []; for (var x = 0; x < refs.length; x++) rn.push(S(refs[x].getName()) + " [" + S(refs[x].getId()) + "]");
    v.referenzen = rn.length ? rn : "keine";
  }
  return { vorschau: v, warnungen: warn, fp: fp.join("\n"), name: name, formsId: S(forms.getId()), ordnerId: ordner ? S(ordner.getId()) : null,
           vorbildOrdner: vorbildOrdner, refs: refs, vorbild: vorbild, ext: ext, plan: plan, kommentar: kommentar };
}

function dvFeld(dv) {
  var arr = java.lang.reflect.Array.newInstance(java.lang.Class.forName("de.elo.ix.client.DocVersion"), 1); arr[0] = dv; return arr;
}

tool("elo_form_pages",
  "Legt mehrere Seiten eines ELOwf-Formulars in einem Zug an oder gibt ihnen eine neue Version (zweistufig): Dateien aus einem lokalen Verzeichnis, Dateiname = Seitenname. Unveraenderte Seiten werden uebersprungen, die Vorschau zeigt je Seite den Zeilenvergleich. Fehlt der Formularordner, legt neuNachVorbild ihn nach einem vorhandenen Formular an (Maske, Typ, Rechte, Formulareinstellungen, dazu dessen Referenzen wie ein gemeinsamer Rahmen). Nur mit -Bauen.",
  { formular: { type: "string", description: "Name des Formulars (Ordner unter " + FORMS_PFAD + ")" },
    verzeichnis: { type: "string", description: "Lokales Verzeichnis mit den Seitendateien" },
    seiten: { type: "array", items: { type: "string" }, description: "Seitennamen = Dateinamen im Verzeichnis, hoechstens " + LIMIT_VG.seiten },
    neuNachVorbild: { type: "string", description: "Nur wenn das Formular neu ist: vorhandenes Formular als Vorbild" },
    referenzen: { type: "array", items: { type: "string" }, description: "Nur mit neuNachVorbild: Namen der Eintraege des Vorbilds, die als Referenz in den neuen Ordner kommen. Standard: alle Referenzen des Vorbilds" },
    kommentar: { type: "string", description: "Versionskommentar, max. 64 Zeichen" }, token: P_TOKEN },
  ["formular", "verzeichnis", "seiten"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_form_pages", a, function () { return formPlan(a); }, function (p) {
      var ordnerId = p.ordnerId, res = { seiten: [] };
      if (!ordnerId) {
        var vo = p.vorbildOrdner, ed = ELO.ix().createSord(p.formsId, S(vo.getMask()), IXC.EditInfoC.mbSord), neu = ed.getSord();
        neu.setName(p.name); neu.setType(vo.getType()); neu.setDesc(S(vo.getDesc())); neu.setAclItems(vo.getAclItems());
        ordnerId = S(ELO.ix().checkinSord(neu, IXC.SordC.mbAll, IXC.LockC.NO));
        res.ordnerAngelegt = ordnerId; res.referenzen = [];
        for (var r = 0; r < p.refs.length; r++) { ELO.ix().refSord(null, ordnerId, S(p.refs[r].getId()), -1); res.referenzen.push(S(p.refs[r].getName())); }
      }
      for (var i = 0; i < p.plan.length; i++) {
        var s = p.plan[i];
        try {
          if (s.id) {
            var ed2 = ELO.ix().checkoutDoc(s.id, null, IXC.EditInfoC.mbAll, IXC.LockC.YES);
            try {
              var dv = new IXC.DocVersion(); dv.setExt(s.akt ? S(s.akt.getExt()) : (p.ext || s.datei.ext)); dv.setComment(p.kommentar);
              if (s.akt) dv.setPathId(s.akt.getPathId());
              var doc = ed2.getDocument(); doc.setDocs(dvFeld(dv));
              doc = ELO.ix().checkinDocBegin(doc);
              doc.getDocs()[0].setUploadResult(ELO.connect().upload(doc.getDocs()[0].getUrl(), s.datei.file));
              doc = ELO.ix().checkinDocEnd(ed2.getSord(), IXC.SordC.mbAll, doc, IXC.LockC.YES);
              res.seiten.push({ seite: s.seite, id: s.id, neueVersionId: S(doc.getDocs()[0].getId()) });
            } catch (e) { unlockSord(s.id); throw e; }
          } else {
            var ed3 = ELO.ix().createDoc(ordnerId, S(p.vorbild.getMask()), null, IXC.EditInfoC.mbSordDoc), so = ed3.getSord();
            so.setName(s.seite); so.setType(p.vorbild.getType()); so.setAclItems(p.vorbild.getAclItems());
            var dv2 = new IXC.DocVersion(); dv2.setExt(p.ext || s.datei.ext); dv2.setComment(p.kommentar);
            var doc2 = ed3.getDocument(); doc2.setDocs(dvFeld(dv2));
            doc2 = ELO.ix().checkinDocBegin(doc2);
            doc2.getDocs()[0].setUploadResult(ELO.connect().upload(doc2.getDocs()[0].getUrl(), s.datei.file));
            doc2 = ELO.ix().checkinDocEnd(so, IXC.SordC.mbAll, doc2, IXC.LockC.NO);
            res.seiten.push({ seite: s.seite, angelegt: S(doc2.getObjId()) });
          }
        } catch (e2) { res.seiten.push({ seite: s.seite, fehler: errText(e2) }); }
      }
      res.danach = "Formulardesigner 'Aktualisieren'.";
      return res;
    });
  }, 3);

/* ---------- Stufe 2: Wort in einer Akte ersetzen ---------- */

function wortZeichen(c) { return !!c && /[A-Za-z0-9_\u00c0-\u024f]/.test(c); }
/* Ersetzt alt durch neu nur als ganzes Wort (auch mit Umlauten, anders als \b). Liefert { text, anzahl }. */
function wortErsetzen(text, alt, neu) {
  text = S(text);
  var out = "", i = 0, n = 0;
  if (!alt) return { text: text, anzahl: 0 };
  while (true) {
    var p = text.indexOf(alt, i);
    if (p < 0) break;
    var vor = p > 0 ? text.charAt(p - 1) : "", nach = text.charAt(p + alt.length);
    if (!wortZeichen(vor) && !wortZeichen(nach)) { out += text.substring(i, p) + neu; i = p + alt.length; n++; }
    else { out += text.substring(i, p + 1); i = p + 1; }
  }
  return { text: out + text.substring(i), anzahl: n };
}

function sordAenderung(s, alt, neu, felder) {
  var a = [], nm = wortErsetzen(S(s.getName()), alt, neu);
  if (nm.anzahl) a.push({ feld: "Kurzbezeichnung", bisher: S(s.getName()), neu: nm.text });
  var ok = s.getObjKeys();
  for (var k = 0; ok && k < ok.length; k++) {
    if (felder.indexOf(S(ok[k].getName())) < 0) continue;
    var d = ok[k].getData();
    for (var j = 0; d && j < d.length; j++) {
      var w = wortErsetzen(S(d[j]), alt, neu);
      if (w.anzahl) a.push({ feld: S(ok[k].getName()), bisher: S(d[j]), neu: w.text });
    }
  }
  return a;
}
function sordUmsetzen(s, alt, neu, felder) {
  var nm = wortErsetzen(S(s.getName()), alt, neu);
  if (nm.anzahl) s.setName(nm.text);
  var ok = s.getObjKeys();
  for (var k = 0; ok && k < ok.length; k++) {
    if (felder.indexOf(S(ok[k].getName())) < 0) continue;
    var d = ok[k].getData(), geaendert = false;
    if (!d || !d.length) continue;
    var nd = java.lang.reflect.Array.newInstance(java.lang.Class.forName("java.lang.String"), d.length);
    for (var j = 0; j < d.length; j++) { var w = wortErsetzen(S(d[j]), alt, neu); nd[j] = w.text; if (w.anzahl) geaendert = true; }
    if (geaendert) ok[k].setData(nd);
  }
}

function umbenennenPlan(a) {
  var alt = S(a.alt), neu = S(a.neu), warn = [];
  if (!trim(alt)) fail("alt ist leer.");
  if (alt === neu) fail("alt und neu sind gleich.");
  if (alt !== trim(alt) || neu !== trim(neu)) fail("alt und neu ohne Leerzeichen am Rand angeben.");
  var felder = [];
  if (a.felder !== undefined) { if (!(a.felder instanceof Array)) fail("felder ist eine Liste von Feldgruppen."); for (var f = 0; f < a.felder.length; f++) felder.push(trim(a.felder[f]).toUpperCase()); }
  var ebenen = a.ebenen === undefined ? 2 : a.ebenen;
  if (typeof ebenen !== "number" || ebenen < 0 || ebenen > LIMIT_VG.ebenen || ebenen !== Math.floor(ebenen)) fail("ebenen: 0 bis " + LIMIT_VG.ebenen + ".");
  var start = ELO.ix().checkoutSord(ELO.arcpath(trim(a.objekt)), IXC.EditInfoC.mbSord, IXC.LockC.NO).getSord();
  var alle = [{ sord: start, ebene: 0 }], stufe = [start], uebersprungen = [];
  for (var e = 1; e <= ebenen; e++) {
    var naechste = [];
    for (var i = 0; i < stufe.length; i++) {
      if (!isFolder(stufe[i])) continue;
      var kinder = ELO.children(S(stufe[i].getId()), LIMIT_VG.objekte + 1);
      for (var j = 0; j < kinder.length; j++) {
        if (S(kinder[j].getParentId()) !== S(stufe[i].getId())) { uebersprungen.push(S(kinder[j].getName()) + " [" + S(kinder[j].getId()) + "]"); continue; }
        alle.push({ sord: kinder[j], ebene: e }); naechste.push(kinder[j]);
        if (alle.length > LIMIT_VG.objekte) fail("Mehr als " + LIMIT_VG.objekte + " Objekte - ebenen verringern oder einen Unterordner angeben.");
      }
    }
    stufe = naechste;
  }
  if (uebersprungen.length) warn.push("Referenzen (gehoeren anderen Ordnern) bleiben unberuehrt: " + uebersprungen.slice(0, 10).join(", ") + (uebersprungen.length > 10 ? " ..." : ""));
  var objekte = [], fp = [], gesperrt = [];
  for (var o = 0; o < alle.length; o++) {
    var s = alle[o].sord, ae = sordAenderung(s, alt, neu, felder);
    if (!ae.length) continue;
    if (S(s.getLockName())) gesperrt.push(S(s.getName()) + " [" + S(s.getId()) + "] von " + S(s.getLockName()));
    objekte.push({ id: S(s.getId()), ebene: alle[o].ebene, aenderungen: ae });
    fp.push(fingerprintSord(s));
  }
  if (gesperrt.length) fail("Gesperrt: " + gesperrt.join("; "));
  var vids = idListe(a.vorgaenge, LIMIT_VG.vorgaenge, "Vorgaenge");
  if (a.vorgaengeDesObjekts) {
    var fwi = new IXC.FindWorkflowInfo(); fwi.setType(IXC.WFTypeC.ACTIVE); fwi.setObjId(S(start.getId()));
    var fr = ELO.ix().findFirstWorkflows(fwi, LIMIT_VG.vorgaenge, IXC.WFDiagramC.mbLean);
    try { var ws = fr.getWorkflows(); for (var w = 0; ws && w < ws.length; w++) if (vids.indexOf(S(ws[w].getId())) < 0) vids.push(S(ws[w].getId())); }
    finally { try { ELO.ix().findClose(fr.getSearchId()); } catch (e2) {} }
  }
  var vorgaenge = [];
  for (var v = 0; v < vids.length; v++) {
    var wf = wfLesen(vids[v], "aktiv", false), wn = wortErsetzen(S(wf.getName()), alt, neu);
    if (wfSperre(wf)) fail("Vorgang " + vids[v] + " ist gesperrt von " + wfSperre(wf) + ".");
    fp.push("wf" + vids[v] + "|" + S(wf.getName()));
    if (wn.anzahl) vorgaenge.push({ id: vids[v], bisher: S(wf.getName()), neu: wn.text });
  }
  if (!objekte.length && !vorgaenge.length) fail("'" + alt + "' kommt als ganzes Wort nirgends vor (" + alle.length + " Objekte" + (felder.length ? ", Felder " + felder.join(", ") : ", nur Kurzbezeichnungen") + (vids.length ? ", " + vids.length + " Vorgaenge" : "") + ").");
  warn.push("Dokumentinhalte (Word, PDF, Mappen) bleiben unberuehrt.");
  return { vorschau: { aktion: "Text ersetzen", start: S(start.getName()) + " [" + S(start.getId()) + "]", alt: alt, neu: neu, ebenen: ebenen,
                       felder: felder.length ? felder : "nur Kurzbezeichnung", objekteGeprueft: alle.length, objekteZuAendern: objekte.length,
                       objekte: objekte, vorgaenge: vorgaenge },
           warnungen: warn, fp: fp.join("\n"), alt: alt, neu: neu, felder: felder, objekte: objekte, vorgaenge: vorgaenge };
}

tool("elo_rename_in_folder",
  "Ersetzt ein Wort (z. B. einen falsch geschriebenen Namen) in der Kurzbezeichnung und in angegebenen Feldern eines Objekts und seiner Unterobjekte (Standard 2 Ebenen, hoechstens " + LIMIT_VG.ebenen + " und " + LIMIT_VG.objekte + " Objekte), dazu im Namen laufender Vorgaenge (vorgaenge oder vorgaengeDesObjekts). Nur ganze Woerter, Referenzen bleiben unberuehrt, Dokumentinhalte auch. Zweistufig.",
  { objekt: P_OBJ, alt: { type: "string", description: "Bisheriges Wort, z. B. 'Mxa'" }, neu: { type: "string", description: "Neues Wort" },
    felder: { type: "array", items: { type: "string" }, description: "Feldgruppen, in denen ebenfalls ersetzt wird, z. B. ['VORNAME']. Ohne Angabe nur die Kurzbezeichnung" },
    ebenen: { type: "integer", description: "Wie tief unter dem Objekt: 0 nur das Objekt, Standard 2, hoechstens " + LIMIT_VG.ebenen },
    vorgaenge: { type: "array", items: { type: "string" }, description: "IDs laufender Vorgaenge, deren Name ebenfalls korrigiert wird" },
    vorgaengeDesObjekts: { type: "boolean", description: "Laufende Vorgaenge am Objekt selbst dazunehmen" },
    token: P_TOKEN },
  ["objekt", "alt", "neu"], function (a) {
    return zweiSchritte("elo_rename_in_folder", a, function () { return umbenennenPlan(a); }, function (p) {
      var res = { objekte: 0, vorgaenge: 0, fehler: [] };
      for (var i = 0; i < p.objekte.length; i++) {
        var id = p.objekte[i].id;
        if (i) warte(100);
        try {
          var s = ELO.ix().checkoutSord(id, IXC.EditInfoC.mbSord, IXC.LockC.YES).getSord();
          try { sordUmsetzen(s, p.alt, p.neu, p.felder); ELO.ix().checkinSord(s, IXC.SordC.mbAll, IXC.LockC.YES); res.objekte++; }
          catch (e) { unlockSord(id); throw e; }
        } catch (e2) { res.fehler.push(id + ": " + errText(e2)); }
      }
      for (var j = 0; j < p.vorgaenge.length; j++) {
        var wf = null, ok = false;
        try {
          wf = wfLesen(p.vorgaenge[j].id, "aktiv", true);
          wf.setName(wortErsetzen(S(wf.getName()), p.alt, p.neu).text);
          ELO.ix().checkinWorkFlow(wf, IXC.WFDiagramC.mbAll, IXC.LockC.YES); ok = true; res.vorgaenge++;
        } catch (e3) { res.fehler.push("Vorgang " + p.vorgaenge[j].id + ": " + errText(e3)); }
        finally { if (wf && !ok) wfEntsperren(wf); }
      }
      // Stichprobe: das erste Objekt zuruecklesen
      if (p.objekte.length) { var n = sordOf(p.objekte[0].id); res.stichprobe = { id: p.objekte[0].id, name: S(n.getName()) }; }
      if (!res.fehler.length) delete res.fehler;
      return res;
    });
  }, 2);
