/*
 * elo-mcp-anzeigeprofile.js - Anzeigeprofile (Vorschauprofile) des ELO Client, wie im Dialog "Anzeigeprofile verwalten".
 * Wird nach elo-mcp-wiedervorlagen.js geladen (nutzt benutzerFinden aus elo-mcp-benutzer.js; zweiSchritte, P_TOKEN aus
 * elo-mcp-schreiben.js; jsonSichern aus elo-mcp-ergaenzungen.js; hat aus elo-mcp-notizen.js).
 *
 * elo_display_profiles (Stufe 1)     Profile, Zuordnung zu Funktionsbereichen und Masken eines Benutzers oder einer Gruppe
 * elo_display_profile_set (Stufe 3)  ein Profil von einem Vorbild auf Benutzer (Gruppen = ihre Mitglieder) uebertragen
 *
 * Ablage im IX-Benutzerprofil (checkoutUserProfile/checkinUserProfile), Trennzeichen <P> = U+00B6 (ELO.PILCROW):
 *   EloJ.S.EViewProfiles.(<GUID>)    = <Version><P><Name><P><Element>=0,<Bereich>;...<P><Teiler>=<Groesse>;...<P><Bereich>=<aktiver Reiter>;...<P>(<GUID>)
 *                                      Eingebaute Profile haben einen leeren Namen (der Client uebersetzt ihn) und GUIDs (E10E1000-...-E10E10E10E0n).
 *                                      Ein leerer Wert heisst: im Client geloescht.
 *   EloJ.S.EViewUsedProfile.<n>       = (<GUID>)  je Funktionsbereich: 1 Ablage, 2 Postbox, 3 Klemmbrett, 4 Aufgaben, 5 Bearbeitung, 6 Suche;
 *                                      0 = Rueckfall. EViewUsedProfile.<n>.<Ansicht> gilt fuer eine einzelne Ansicht.
 *   EloJ.S.PreviewProfileMaskModel<i> = <Masken-ID>#(<GUID>), i = 0, 1, ...; danach ein Eintrag <P>END<P>. Der Client sortiert nach Masken-ID (als Text).
 * Vorrang im Client: Maske vor Funktionsbereich.Ansicht vor Funktionsbereich vor Bereich 0 vor erstem Profil.
 * Hat ein Benutzer gar keine Profile, legt der Client beim Start die fuenf Standardprofile und deren Zuordnung an - aber nur dann.
 * Ein einzelnes neues Profil wuerde also alle Bereiche uebernehmen; deshalb schreibt elo_display_profile_set in diesem Fall
 * die Standardprofile mit.
 * Ebenen: Benutzer vor Optionengruppe (Gruppe mit Schalter "Optionengruppe") vor Global (Jeder) vor Standard des Clients.
 * Der Client liest alle Ebenen zusammen und schreibt beim Speichern nur Schluessel, die er in seiner Sitzung geaendert hat.
 * Gilt fuer den ELO Client bzw. ELO Java Client; der Web Client speichert seine Ansicht unter webclient.options.*.
 */

var LIMIT_AP = { ziele: 50, bereiche: 7, masken: 20 };
var AP_PRE = "EloJ.S.EViewProfiles.", AP_USED = "EloJ.S.EViewUsedProfile.", AP_MASK = "EloJ.S.PreviewProfileMaskModel";
var AP_END = ELO.PILCROW + "END" + ELO.PILCROW;
var AP_BEREICHE = { 0: "Standard (Rueckfall)", 1: "Ablage", 2: "Postbox", 3: "Klemmbrett", 4: "Aufgaben", 5: "Bearbeitung", 6: "Suche" };
var AP_BEREICH_NAMEN = { standard: 0, rueckfall: 0, ablage: 1, archiv: 1, archive: 1, postbox: 2, intray: 2, klemmbrett: 3, clipboard: 3,
                         aufgaben: 4, aufgabe: 4, tasks: 4, appointment: 4, bearbeitung: 5, "in bearbeitung": 5, checkout: 5, suche: 6, search: 6 };
var AP_INHALT = { DocumentPreview: "Inhalt", Formular: "Formular", Feed: "Feed", Task: "Aufgabe", Fulltext: "Volltext", WebApplication: "Webanwendung",
                  Cover: "Uebergeordnete Metadaten", IndexPreview: "Metadaten", Empty: "Leer" };
var AP_PLATZ = { LeftColumn: "links", UpperRow: "oben", MidLeftColumn: "Mitte links", MidRightColumn: "Mitte rechts", RightColumn: "rechts" };

/* Eingebaute Profile: Name wie im Client (deutsch) und Wert, wie ihn der ELO Client 25 beim ersten Start anlegt. */
var AP_EINGEBAUT = (function () {
  var P = ELO.PILCROW, g = function (n) { return "(E10E1000-E100-E100-E100-E10E10E10E" + n + ")"; }, m = {};
  function def(n, name, layout, teiler) { m[g(n)] = { name: name, wert: layout === null ? null : "3" + P + P + layout + P + teiler + P + P + g(n) }; }
  def("00", "Klassisch", "Formular=0,UpperRow;Cover=0,UpperRow;Task=0,UpperRow;DocumentPreview=0,MidRightColumn;", "0,TopBottom=25;");
  def("01", "Zusammenarbeit", "DocumentPreview=0,MidRightColumn;Feed=0,RightColumn;", "0,RightColumn=75;");
  def("02", "Vollst\u00e4ndig", "DocumentPreview=0,UpperRow;Formular=0,UpperRow;Fulltext=0,UpperRow;Feed=0,UpperRow;WebApplication=0,UpperRow;Cover=0,UpperRow;Task=0,UpperRow;", "0,RightColumn=75;");
  def("03", "Formularbearbeitung", "Feed=0,RightColumn;Formular=0,MidRightColumn;DocumentPreview=0,MidRightColumn;Cover=0,MidRightColumn;Task=0,MidRightColumn;", "0,RightColumn=75;");
  def("04", "Vollst\u00e4ndig (Feed separat)", "DocumentPreview=0,UpperRow;Formular=0,UpperRow;Fulltext=0,UpperRow;WebApplication=0,UpperRow;Cover=0,UpperRow;Task=0,UpperRow;Feed=0,RightColumn;", "0,RightColumn=75;");
  def("10", "WebApp mit Dokument", null); def("11", "WebApp mit Dokument und Feed", null); def("12", "WebApp mit Dokument und Formular", null);
  def("13", "WebApp mit Dokument, Formular und Feed", null); def("14", "WebApp", null); def("15", "WebApp mit Feed", null);
  return m;
})();
/* Standardzuordnung des Clients, wenn noch keine Profile da sind (PreviewProfileOptionsHelper.getAllProfiles). */
var AP_STANDARD_ZUORDNUNG = { 0: "02", 1: "04", 2: "00", 3: "04", 4: "03", 5: "04", 6: "04" };
var AP_STANDARD_FUENF = ["00", "01", "02", "03", "04"];
function apGuidE(n) { return "(E10E1000-E100-E100-E100-E10E10E10E" + n + ")"; }

/* GUID vereinheitlichen: Klammern, Grossbuchstaben. "" wenn keine GUID. */
function apGuid(v) {
  var m = /^\s*\(?([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\)?\s*$/.exec(S(v));
  return m ? "(" + m[1].toUpperCase() + ")" : "";
}

/* Profilwert zerlegen. Liefert null, wenn leer (im Client geloescht). */
function apProfilLesen(wert) {
  wert = S(wert);
  if (!wert) return null;
  var t = wert.split(ELO.PILCROW), guid = apGuid(t[5] || ""), aufteilung = {}, elemente = [], teiler = {}, reiter = {};
  var lay = S(t[2]).split(";");
  for (var i = 0; i < lay.length; i++) {
    var m = /^([A-Za-z]+)=\d+,([A-Za-z]+)$/.exec(trim(lay[i]));
    if (!m) continue;
    var platz = AP_PLATZ[m[2]] || m[2], el = AP_INHALT[m[1]] || m[1];
    (aufteilung[platz] = aufteilung[platz] || []).push(el);
    elemente.push(m[1]);
  }
  var tl = S(t[3]).split(";");
  for (var j = 0; j < tl.length; j++) { var mt = /^\d+,([A-Za-z]+)=(-?\d+)$/.exec(trim(tl[j])); if (mt) teiler[mt[1]] = parseInt(mt[2], 10); }
  var rl = S(t[4]).split(";");
  for (var k = 0; k < rl.length; k++) { var mr = /^\d+,([A-Za-z]+)=(-?\d+)$/.exec(trim(rl[k])); if (mr) reiter[AP_PLATZ[mr[1]] || mr[1]] = parseInt(mr[2], 10); }
  var name = S(t[1]), e = AP_EINGEBAUT[guid];
  return { version: S(t[0]), name: name || (e ? e.name : "(ohne Namen)"), eigenerName: name, guid: guid, eingebaut: !!e,
           aufteilung: aufteilung, elemente: elemente, teiler: teiler, aktiverReiter: reiter, wert: wert };
}

/* Profilwert fuer eine andere GUID ist nicht noetig: uebertragen wird immer mit derselben GUID wie beim Vorbild. */

/* ---------- Lesen aus dem IX ---------- */

function apRelevant(k) { return k.indexOf(AP_PRE) === 0 || k.indexOf(AP_USED) === 0 || /^EloJ\.S\.PreviewProfileMaskModel\d+$/.test(k); }

/* Alle Ebenen eines Kontos (Benutzer oder Gruppe): je Schluessel Wert und Quelle (eigen, Optionengruppe, Global). */
function apOptionen(uid) {
  var up = new IXC.UserProfile(); up.setUserId(S(uid));
  var r = ELO.ix().checkoutUserProfile(up, IXC.LockC.NO), ebenen = [["Global", r.getDefaultOptions()], ["Optionengruppe", r.getGroupOptions()], ["eigen", r.getUserOptions()]];
  var werte = {}, eigen = {}, anzahl = 0;
  for (var e = 0; e < ebenen.length; e++) {
    var o = ebenen[e][1];
    for (var i = 0; o && i < o.length; i++) {
      var k = S(o[i].getKey());
      if (!apRelevant(k)) continue;
      werte[k] = { wert: S(o[i].getValue()), quelle: ebenen[e][0] };
      if (ebenen[e][0] === "eigen") { eigen[k] = S(o[i].getValue()); anzahl++; }
    }
  }
  var gid = r.getGroupId();
  return { werte: werte, eigen: eigen, eigeneAnzahl: anzahl, optionengruppe: gid > 0 ? S(gid) : "" };
}

function apMaskenliste(werte) {
  var out = [];
  for (var i = 0; i < 1000; i++) {
    var e = werte[AP_MASK + i];
    if (!e || !e.wert || e.wert === AP_END) break;
    var t = e.wert.split("#");
    if (t.length === 2) out.push({ maskeId: trim(t[0]), guid: apGuid(t[1]) || trim(t[1]), quelle: e.quelle });
  }
  return out;
}

/* Profilsammlung eines Kontos. leer: keine Profile auf irgendeiner Ebene (dann gelten die Standardprofile des Clients). */
function apStand(uid) {
  var o = apOptionen(uid), profile = {}, reihenfolge = [], zuordnung = {}, ansichten = [];
  for (var k in o.werte) {
    var w = o.werte[k];
    if (k.indexOf(AP_PRE) === 0) {
      var p = apProfilLesen(w.wert);
      if (!p) continue;
      p.quelle = w.quelle; p.schluessel = k;
      if (!p.guid) p.guid = apGuid(k.substring(AP_PRE.length));
      profile[p.guid] = p; reihenfolge.push(p.guid);
    } else if (k.indexOf(AP_USED) === 0) {
      var rest = k.substring(AP_USED.length), punkt = rest.indexOf(".");
      if (punkt < 0) zuordnung[rest] = { guid: apGuid(w.wert) || w.wert, quelle: w.quelle };
      else ansichten.push({ bereichNr: rest.substring(0, punkt), ansicht: rest.substring(punkt + 1), guid: apGuid(w.wert) || w.wert, quelle: w.quelle });
    }
  }
  reihenfolge.sort();
  return { optionen: o, profile: profile, guids: reihenfolge, leer: reihenfolge.length === 0, zuordnung: zuordnung, ansichten: ansichten, masken: apMaskenliste(o.werte) };
}

/* Profil, das der Client fuer einen Bereich zeigt (getProfileForView ohne Ansicht). */
function apProfilFuerBereich(st, nr) {
  if (st.leer) return { guid: apGuidE(AP_STANDARD_ZUORDNUNG[nr]), quelle: "Standard des Clients" };
  var z = st.zuordnung[S(nr)];
  if (z && st.profile[z.guid]) return { guid: z.guid, quelle: z.quelle };
  var z0 = st.zuordnung["0"];
  if (z0 && st.profile[z0.guid]) return { guid: z0.guid, quelle: "Rueckfall auf Bereich 0" + (z ? " (zugeordnetes Profil " + z.guid + " fehlt)" : "") };
  return { guid: st.guids[0], quelle: "erstes Profil (keine Zuordnung)" };
}

function apProfilName(st, guid) {
  var p = st.profile[guid];
  if (p) return p.name;
  if (st.leer && AP_EINGEBAUT[guid]) return AP_EINGEBAUT[guid].name;
  return AP_EINGEBAUT[guid] ? AP_EINGEBAUT[guid].name + " (nicht gespeichert)" : "(fehlt: " + guid + ")";
}

var apMaskCache = {};
function apMaskeName(id) {
  var k = S(id);
  if (apMaskCache[k] === undefined) {
    try { apMaskCache[k] = S(ELO.ix().checkoutDocMask(k, IXC.DocMaskC.mbAll, IXC.LockC.NO).getName()); }
    catch (e) { apMaskCache[k] = ""; }
  }
  return apMaskCache[k];
}
function apMaskeFinden(v) {
  var m;
  try { m = ELO.ix().checkoutDocMask(trim(v), IXC.DocMaskC.mbAll, IXC.LockC.NO); }
  catch (e) { fail("Maske nicht gefunden: " + v); }
  apMaskCache[S(m.getId())] = S(m.getName());
  return { id: S(m.getId()), name: S(m.getName()) };
}

function apBereichNr(v) {
  var s = trim(v).toLowerCase();
  if (/^[0-6]$/.test(s)) return parseInt(s, 10);
  var n = AP_BEREICH_NAMEN[s];
  if (n === undefined) fail("Funktionsbereich unbekannt: " + v + ". Erlaubt: Ablage, Postbox, Klemmbrett, Aufgaben, Bearbeitung, Suche (oder 0-6).");
  return n;
}

/* Sitzungen eines Kontos (Programm, Rechner). desktop = vermutlich ELO Client / Java Client. */
function apSitzungen(uid) {
  try {
    var arr = java.lang.reflect.Array.newInstance(java.lang.String, 1); arr[0] = S(uid);
    var us = ELO.ix().checkoutUsers(arr, IXC.CheckoutUsersC.SESSION_USERS_RAW, IXC.LockC.NO), out = [];
    for (var i = 0; us && i < us.length; i++) {
      if (S(us[i].getId()) !== S(uid)) continue;
      var s = us[i].getSessions();
      for (var j = 0; s && j < s.length; j++) {
        var opt = s[j].getSessionOptions(), app = "";
        try { app = opt ? S(opt.get("clientApp.name")) : ""; } catch (e1) { app = ""; }
        out.push({ programm: app || "(unbekannt)", rechner: S(s[j].getClientComputer()) || undefined,
                   desktop: /client/i.test(app) && !/web/i.test(app) });
      }
    }
    return out;
  } catch (e) { return null; }
}

function apKonto(who) {
  var f = benutzerFinden(who), u = f.u;
  return { u: u, id: S(u.getId()), name: S(u.getName()), gruppe: u.getType() === IXC.UserInfoC.TYPE_GROUP,
           optionengruppe: u.getType() === IXC.UserInfoC.TYPE_GROUP && (u.getFlags() & IXC.AccessC.FLAG_IS_OPTION_GROUP) !== 0 };
}

function apProfilAusgabe(st, p, mitWert) {
  var verwendet = [];
  for (var nr = 1; nr <= 6; nr++) if (apProfilFuerBereich(st, nr).guid === p.guid) verwendet.push(AP_BEREICHE[nr]);
  for (var i = 0; i < st.masken.length; i++) if (st.masken[i].guid === p.guid) verwendet.push("Maske " + (apMaskeName(st.masken[i].maskeId) || st.masken[i].maskeId));
  return { name: p.name, guid: p.guid, eingebaut: p.eingebaut || undefined, quelle: p.quelle !== "eigen" ? p.quelle : undefined,
           aufteilung: p.aufteilung, teiler: p.teiler, verwendetIn: verwendet.length ? verwendet : undefined, wert: mitWert ? p.wert : undefined };
}

tool("elo_display_profiles",
  "Anzeigeprofile (Vorschauprofile) des ELO Client wie im Dialog 'Anzeigeprofile verwalten' mit 'Benutzer auswaehlen': je Profil Name, GUID und Aufteilung " +
  "(welches Element - Inhalt, Formular, Feed, Aufgabe, Volltext, Webanwendung - in welchem Bereich), dazu die Zuordnung zu den Funktionsbereichen " +
  "(Ablage, Postbox, Klemmbrett, Aufgaben, Bearbeitung, Suche) und zu Masken (Maske hat Vorrang). Quelle je Wert: eigen, Optionengruppe oder Global. " +
  "Ohne benutzer das angemeldete Konto; bei einer Gruppe deren eigene Werte (wirken nur, wenn sie Optionengruppe ist). Zeigt auch die Sitzungen " +
  "(offener ELO Client schreibt beim Beenden geaenderte Einstellungen zurueck). Nur ELO Client / Java Client, nicht Web Client.",
  { benutzer: { type: "string", description: "ID, ELO-Name, Windows-Name oder Mail eines Benutzers oder einer Gruppe, Standard: angemeldetes Konto" },
    roh: { type: "boolean", description: "Auch die gespeicherten Profilwerte (fuer Vergleiche), Standard false" } },
  [], function (a) {
    var k;
    if (trim(a.benutzer)) k = apKonto(a.benutzer);
    else { var ich = ELO.connect().getLoginResult().getUser(); k = { id: S(ich.getId()), name: S(ich.getName()), gruppe: false }; }
    var st = apStand(k.id), res = { konto: k.name + " [" + k.id + "]", art: k.gruppe ? (k.optionengruppe ? "Gruppe (Optionengruppe)" : "Gruppe") : "Benutzer" };
    var hinweise = [];
    if (k.gruppe && !k.optionengruppe) hinweise.push("Die Gruppe ist keine Optionengruppe; eigene Werte der Gruppe wirken nicht auf die Mitglieder.");
    if (st.leer) hinweise.push("Keine gespeicherten Anzeigeprofile: Der Client legt beim naechsten Start die Standardprofile an und nutzt deren Zuordnung (unten so angezeigt).");
    if (st.optionen.optionengruppe) res.optionengruppe = st.optionen.optionengruppe;
    res.profile = [];
    if (st.leer) { for (var s = 0; s < AP_STANDARD_FUENF.length; s++) { var g = apGuidE(AP_STANDARD_FUENF[s]), pp = apProfilLesen(AP_EINGEBAUT[g].wert); pp.quelle = "Standard des Clients"; st.profile[g] = pp; } st.guids = AP_STANDARD_FUENF.map(apGuidE); }
    for (var i = 0; i < st.guids.length; i++) res.profile.push(apProfilAusgabe(st, st.profile[st.guids[i]], a.roh === true));
    if (st.leer) { st.profile = {}; }
    res.funktionsbereiche = [];
    for (var nr = 1; nr <= 6; nr++) {
      var z = apProfilFuerBereich(st, nr);
      res.funktionsbereiche.push({ bereich: AP_BEREICHE[nr], nr: nr, profil: apProfilName(st, z.guid), guid: z.guid, quelle: z.quelle !== "eigen" ? z.quelle : undefined });
    }
    if (st.zuordnung["0"]) res.rueckfall = { profil: apProfilName(st, st.zuordnung["0"].guid), guid: st.zuordnung["0"].guid };
    if (st.ansichten.length) res.ansichten = st.ansichten.map(function (x) { return { bereich: AP_BEREICHE[x.bereichNr] || x.bereichNr, ansicht: x.ansicht, profil: apProfilName(st, x.guid), guid: x.guid }; });
    res.masken = st.masken.map(function (m) {
      var e = { maskeId: m.maskeId, maske: apMaskeName(m.maskeId) || "(Maske fehlt)", profil: apProfilName(st, m.guid), guid: m.guid, quelle: m.quelle !== "eigen" ? m.quelle : undefined };
      if (!st.profile[m.guid] && !st.leer) e.warnung = "Profil fehlt in der Profilliste; der Client ignoriert diese Zuordnung.";
      return e;
    });
    var sz = k.gruppe ? null : apSitzungen(k.id);
    if (sz) { res.sitzungen = sz; if (sz.filter(function (x) { return x.desktop; }).length) hinweise.push("Im ELO Client angemeldet: Aenderungen wirken erst nach einem Neustart des Clients."); }
    if (hinweise.length) res.hinweise = hinweise;
    return res;
  });

/* ---------- Uebertragen ---------- */

/* Ziele: Benutzer direkt, Gruppen aufgeloest in ihre Benutzer (auch verschachtelt). */
function apZiele(liste) {
  if (liste === undefined || liste === null || liste === "" || (liste instanceof Array && !liste.length)) fail("ziele fehlt.");
  if (!(liste instanceof Array)) liste = [liste];
  var out = [], gesehen = {}, herkunft = [];
  for (var i = 0; i < liste.length; i++) {
    var k = apKonto(liste[i]);
    if (!k.gruppe) { if (!hat(gesehen, k.id)) { gesehen[k.id] = true; out.push({ id: k.id, name: k.name }); } herkunft.push(k.name + " [" + k.id + "]"); continue; }
    var arr = java.lang.reflect.Array.newInstance(java.lang.String, 1); arr[0] = k.id;
    var mit = ELO.ix().checkoutUsers(arr, IXC.CheckoutUsersC.USERS_OF_GROUP_RECURSIVE_RAW, IXC.LockC.NO), n = 0;
    for (var j = 0; mit && j < mit.length; j++) {
      if (mit[j].getType() === IXC.UserInfoC.TYPE_GROUP) continue;
      var id = S(mit[j].getId());
      n++;
      if (!hat(gesehen, id)) { gesehen[id] = true; out.push({ id: id, name: S(mit[j].getName()) }); }
    }
    herkunft.push(k.name + " [" + k.id + "] (Gruppe, " + n + " Benutzer)");
    if (out.length > LIMIT_AP.ziele) break;
  }
  if (!out.length) fail("Keine Benutzer in den Zielen.");
  if (out.length > LIMIT_AP.ziele) fail("Mehr als " + LIMIT_AP.ziele + " Zielbenutzer; bitte aufteilen.");
  return { liste: out, herkunft: herkunft };
}

function apVorbildProfil(st, wer, profil) {
  var g = apGuid(profil), treffer = [];
  if (g) {
    if (st.profile[g]) return st.profile[g];
    if (st.leer && AP_EINGEBAUT[g] && AP_EINGEBAUT[g].wert) { var pe = apProfilLesen(AP_EINGEBAUT[g].wert); pe.quelle = "Standard des Clients"; return pe; }
    fail("Profil " + g + " gibt es bei " + wer + " nicht.");
  }
  var n = trim(profil).toLowerCase();
  if (!n) fail("profil fehlt (Name oder GUID).");
  if (st.leer) {
    for (var e in AP_EINGEBAUT) if (AP_EINGEBAUT[e].wert && AP_EINGEBAUT[e].name.toLowerCase() === n) { var p2 = apProfilLesen(AP_EINGEBAUT[e].wert); p2.quelle = "Standard des Clients"; return p2; }
  }
  for (var i = 0; i < st.guids.length; i++) if (st.profile[st.guids[i]].name.toLowerCase() === n) treffer.push(st.profile[st.guids[i]]);
  if (!treffer.length) fail("Profil '" + profil + "' gibt es bei " + wer + " nicht. Vorhanden: " + st.guids.map(function (x) { return st.profile[x].name; }).join(", ") + ".");
  if (treffer.length > 1) fail("Mehrere Profile heissen '" + profil + "' (" + treffer.map(function (x) { return x.guid; }).join(", ") + "); bitte die GUID angeben.");
  return treffer[0];
}

/* ---------- Neues Profil aus einer Aufteilung ----------
 * Anordnung im Client (EViewRootPanel.updateStructure), von aussen nach innen:
 *   links (LeftColumn) | [ oben (UpperRow) ueber ( Mitte links (MidLeftColumn) | Mitte rechts (MidRightColumn) ) ] | rechts (RightColumn)
 * Teiler in Prozent der jeweiligen Teilung, fehlend oder ausserhalb 1..99 = 50 (PreviewProfile.getDividerPos):
 *   LeftColumn = Breite links, RightColumn = Lage des Teilers vor rechts (100 - Breite rechts),
 *   TopBottom = Hoehe oben, MiddleColumns = Anteil Mitte links an der Mitte.
 * Mehrere Elemente in einem Bereich werden Reiter; der erste ist aktiv. */
var AP_NEU_PLATZ = { links: "LeftColumn", oben: "UpperRow", mitteLinks: "MidLeftColumn", mitteRechts: "MidRightColumn", rechts: "RightColumn" };
var AP_NEU_ELEMENT = { inhalt: "DocumentPreview", dokument: "DocumentPreview", documentpreview: "DocumentPreview", formular: "Formular",
                       feed: "Feed", aufgabe: "Task", task: "Task", volltext: "Fulltext", fulltext: "Fulltext", webanwendung: "WebApplication",
                       webapplication: "WebApplication", "uebergeordnete metadaten": "Cover", "\u00fcbergeordnete metadaten": "Cover", cover: "Cover" };
var AP_NEU_BREITE = { links: 30, rechts: 20, mitteLinks: 50, oben: 40 };

function apNeuGuid(neu) {
  if (trim(neu.guid)) { var g = apGuid(neu.guid); if (!g) fail("neu.guid ist keine GUID."); if (AP_EINGEBAUT[g]) fail("neu.guid ist die GUID eines eingebauten Profils."); return g; }
  // Gleicher Name = gleiche GUID: bei allen Zielen dasselbe Profil, ein zweiter Lauf legt kein zweites an.
  var u = java.util.UUID.nameUUIDFromBytes(new java.lang.String("elo-mcp:anzeigeprofil:" + trim(neu.name).toLowerCase()).getBytes("UTF-8"));
  return "(" + S(u.toString()).toUpperCase() + ")";
}

function apNeuesProfil(neu, warn) {
  if (!neu || typeof neu !== "object") fail("neu: Objekt mit name und aufteilung.");
  var name = trim(neu.name);
  if (!name) fail("neu.name fehlt.");
  if (name.length > 100 || /[;=\u00b6#]/.test(name)) fail("neu.name: hoechstens 100 Zeichen, ohne ; = # und Absatzzeichen.");
  var auf = neu.aufteilung;
  if (!auf || typeof auf !== "object") fail("neu.aufteilung fehlt, z. B. {\"mitteLinks\": [\"Formular\"], \"mitteRechts\": [\"Inhalt\"], \"rechts\": [\"Feed\"]}.");
  var layout = "", benutzt = {}, gesehen = {}, anzahl = 0, slotVon = {};
  for (var k in auf) {
    var slot = AP_NEU_PLATZ[k];
    if (!slot) fail("neu.aufteilung: Bereich '" + k + "' unbekannt. Erlaubt: links, oben, mitteLinks, mitteRechts, rechts.");
    var liste = auf[k] instanceof Array ? auf[k] : [auf[k]];
    if (!liste.length) continue;
    for (var i = 0; i < liste.length; i++) {
      var el = AP_NEU_ELEMENT[trim(liste[i]).toLowerCase()];
      if (!el) fail("neu.aufteilung." + k + ": Element '" + liste[i] + "' unbekannt. Erlaubt: Inhalt, Formular, Aufgabe, Feed, Volltext, Webanwendung, Uebergeordnete Metadaten.");
      if (hat(gesehen, el)) fail("Element " + (AP_INHALT[el] || el) + " steht zweimal in der Aufteilung.");
      gesehen[el] = true; anzahl++; slotVon[el] = slot;
      layout += el + "=0," + slot + ";";
    }
    benutzt[k] = true;
  }
  if (!anzahl) fail("neu.aufteilung ist leer.");
  // Wie PreviewProfile.loadProfile im ELO Client 25: Steht Formular im Profil, kommen Uebergeordnete Metadaten und Aufgabe in denselben Bereich
  // (hinten an). So geschrieben, wie der Client es selbst speichern wuerde.
  var ergaenzt = [];
  if (gesehen.Formular) for (var z = 0, ex = ["Cover", "Task"]; z < ex.length; z++)
    if (!gesehen[ex[z]]) { layout += ex[z] + "=0," + slotVon.Formular + ";"; gesehen[ex[z]] = true; ergaenzt.push(AP_INHALT[ex[z]]); }
  if (ergaenzt.length) warn.push("Der ELO Client 25 stellt " + ergaenzt.join(" und ") + " immer in den Bereich von Formular (als weitere Reiter); so wird es auch geschrieben.");
  var br = neu.breiten || {}, teiler = "";
  for (var b in br) if (!hat(AP_NEU_BREITE, b)) fail("neu.breiten: '" + b + "' unbekannt. Erlaubt: links, rechts, mitteLinks, oben (Prozent).");
  function pz(n) { var v = br[n] === undefined ? AP_NEU_BREITE[n] : parseInt(br[n], 10); if (!(v >= 5 && v <= 95)) fail("neu.breiten." + n + ": 5 bis 95 Prozent."); return v; }
  // Der Client speichert Teiler nur, wenn sie nicht 50 sind, und aktive Reiter nur, wenn nicht der erste (0) aktiv ist.
  function teil(n, v) { if (v !== 50) teiler += "0," + n + "=" + v + ";"; }
  var mitte = benutzt.oben || benutzt.mitteLinks || benutzt.mitteRechts;
  if (benutzt.links && (mitte || benutzt.rechts)) teil("LeftColumn", pz("links"));
  if (benutzt.rechts && mitte) teil("RightColumn", 100 - pz("rechts"));
  if (benutzt.oben && (benutzt.mitteLinks || benutzt.mitteRechts)) teil("TopBottom", pz("oben"));
  if (benutzt.mitteLinks && benutzt.mitteRechts) teil("MiddleColumns", pz("mitteLinks"));
  if (gesehen.Task) warn.push("Formular und Aufgabe zeigen bei einer Aufgabe mit Formular dasselbe Workflow-Formular (ELO Client 25). Formular zeigt sonst das Maskenformular bzw. die Metadaten. Der ELO Java Client 20 kennt Aufgabe nicht.");
  if (!gesehen.DocumentPreview) warn.push("Ohne Inhalt zeigt das Profil kein Dokument.");
  var guid = apNeuGuid(neu), wert = "3" + ELO.PILCROW + name + ELO.PILCROW + layout + ELO.PILCROW + teiler + ELO.PILCROW + ELO.PILCROW + guid;
  var p = apProfilLesen(wert);
  p.quelle = "neu";
  return p;
}

function apKurzAufteilung(p) {
  if (!p) return "fehlt";
  var t = [];
  for (var platz in p.aufteilung) t.push(platz + ": " + p.aufteilung[platz].join(", "));
  return t.join("; ");
}

/* Plan fuer ein Ziel: neue Schluessel, zu loeschende Schluessel, Vorschau bisher/neu. */
function apZielPlan(ziel, quelle, bereiche, masken, warn) {
  var st = apStand(ziel.id), setzen = {}, loeschen = [], v = { ziel: ziel.name + " [" + ziel.id + "]" };
  var schl = AP_PRE + quelle.guid, alt = st.profile[quelle.guid];
  if (st.leer) {
    v.standardprofile = "werden mitgeschrieben (Ziel hat noch keine Profile; sonst saehe es nur das neue Profil)";
    for (var s = 0; s < AP_STANDARD_FUENF.length; s++) { var g = apGuidE(AP_STANDARD_FUENF[s]); if (g !== quelle.guid) setzen[AP_PRE + g] = AP_EINGEBAUT[g].wert; }
    for (var nr0 = 0; nr0 <= 6; nr0++) setzen[AP_USED + nr0] = apGuidE(AP_STANDARD_ZUORDNUNG[nr0]);
  }
  if (!alt) v.profil = { bisher: "fehlt", neu: apKurzAufteilung(quelle) };
  else if (alt.wert === quelle.wert) v.profil = { bisher: "vorhanden, gleich", neu: "unveraendert" };
  else v.profil = { bisher: apKurzAufteilung(alt) + (alt.name !== quelle.name ? " (Name " + alt.name + ")" : "") + (alt.quelle !== "eigen" ? " [" + alt.quelle + "]" : ""), neu: apKurzAufteilung(quelle) };
  if (!alt || alt.wert !== quelle.wert || alt.quelle !== "eigen") setzen[schl] = quelle.wert;
  for (var gi = 0; gi < st.guids.length; gi++) {
    var andere = st.profile[st.guids[gi]];
    if (andere.guid !== quelle.guid && andere.name.toLowerCase() === quelle.name.toLowerCase())
      warn.push(ziel.name + " hat schon ein anderes Profil namens '" + andere.name + "' (" + andere.guid + "); im Dialog stehen dann zwei mit diesem Namen.");
  }
  if (bereiche.length) {
    v.bereiche = [];
    for (var b = 0; b < bereiche.length; b++) {
      var nr = bereiche[b], bisher = apProfilFuerBereich(st, nr), zb = st.zuordnung[S(nr)];
      var gleich = !st.leer && !!zb && zb.guid === quelle.guid && zb.quelle === "eigen";
      v.bereiche.push({ bereich: AP_BEREICHE[nr], bisher: apProfilName(st, bisher.guid), neu: gleich ? "unveraendert" : quelle.name });
      if (!gleich) setzen[AP_USED + nr] = quelle.guid;
    }
  }
  if (masken.length) {
    var liste = {}, eigeneIdx = [];
    for (var m = 0; m < st.masken.length; m++) liste[st.masken[m].maskeId] = st.masken[m].guid;
    for (var k in st.optionen.eigen) { var mi = /^EloJ\.S\.PreviewProfileMaskModel(\d+)$/.exec(k); if (mi) eigeneIdx.push(parseInt(mi[1], 10)); }
    v.masken = [];
    var geaendert = false;
    for (var j = 0; j < masken.length; j++) {
      var mk = masken[j], vorher = liste[mk.id];
      v.masken.push({ maske: mk.name + " [" + mk.id + "]", bisher: vorher ? apProfilName(st, vorher) : "keine Zuordnung", neu: vorher === quelle.guid ? "unveraendert" : quelle.name });
      if (vorher !== quelle.guid) { liste[mk.id] = quelle.guid; geaendert = true; }
    }
    if (st.masken.some(function (x) { return x.quelle !== "eigen"; })) { geaendert = true; warn.push(ziel.name + ": Maskenzuordnungen kommen teils aus " + st.masken.filter(function (x) { return x.quelle !== "eigen"; })[0].quelle + "; sie werden als eigene Werte uebernommen."); }
    if (geaendert) {
      var ids = []; for (var id in liste) ids.push(id);
      ids.sort();   // wie der Client (SortedMap nach Masken-ID als Text)
      for (var x = 0; x < ids.length; x++) setzen[AP_MASK + x] = ids[x] + "#" + liste[ids[x]];
      setzen[AP_MASK + ids.length] = AP_END;
      for (var y = 0; y < eigeneIdx.length; y++) if (eigeneIdx[y] > ids.length) loeschen.push(AP_MASK + eigeneIdx[y]);
      loeschen.sort();
    }
  }
  var sz = apSitzungen(ziel.id);
  if (sz && sz.length) {
    v.sitzungen = sz.map(function (x) { return x.programm + (x.rechner ? " auf " + x.rechner : ""); });
    if (sz.some(function (x) { return x.desktop; }))
      warn.push(ziel.name + " ist im ELO Client angemeldet: Die Aenderung wirkt erst nach einem Neustart. Aendert er vorher Anzeigeprofile im Client, schreibt der Client seinen alten Stand zurueck.");
  }
  var fp = [];
  for (var fk in st.optionen.werte) fp.push(fk + "=" + st.optionen.werte[fk].quelle + ":" + st.optionen.werte[fk].wert);
  fp.sort();
  var anz = 0; for (var c in setzen) anz++;
  v.schluessel = anz + loeschen.length ? anz + " setzen" + (loeschen.length ? ", " + loeschen.length + " loeschen" : "") : "nichts zu tun";
  return { ziel: ziel, setzen: setzen, loeschen: loeschen, vorschau: v, fp: ziel.id + "{" + fp.join("|") + "}", eigenVorher: st.optionen.eigen, nichts: anz + loeschen.length === 0 };
}

function apSetPlan(a) {
  var vk = null, quelle, warn = [];
  if (a.neu !== undefined && a.neu !== null) {
    if (trim(a.profil) || trim(a.vorbild)) fail("Entweder neu oder profil/vorbild angeben.");
    quelle = apNeuesProfil(a.neu, warn);
  } else {
    if (!trim(a.profil)) fail("profil (Name oder GUID beim Vorbild) oder neu (Aufteilung) angeben.");
    if (trim(a.vorbild)) vk = apKonto(a.vorbild);
    else { var ich = ELO.connect().getLoginResult().getUser(); vk = { id: S(ich.getId()), name: S(ich.getName()), gruppe: false }; }
    quelle = apVorbildProfil(apStand(vk.id), vk.name, a.profil);
  }
  var bereiche = [], masken = [], gesehenB = {}, gesehenM = {};
  var lb = a.bereiche === undefined || a.bereiche === null ? [] : (a.bereiche instanceof Array ? a.bereiche : [a.bereiche]);
  var lm = a.masken === undefined || a.masken === null ? [] : (a.masken instanceof Array ? a.masken : [a.masken]);
  if (lb.length > LIMIT_AP.bereiche) fail("Hoechstens " + LIMIT_AP.bereiche + " Funktionsbereiche.");
  if (lm.length > LIMIT_AP.masken) fail("Hoechstens " + LIMIT_AP.masken + " Masken.");
  for (var i = 0; i < lb.length; i++) { var nr = apBereichNr(lb[i]); if (!hat(gesehenB, nr)) { gesehenB[nr] = true; bereiche.push(nr); } }
  for (var j = 0; j < lm.length; j++) { var mk = apMaskeFinden(lm[j]); if (!hat(gesehenM, mk.id)) { gesehenM[mk.id] = true; masken.push(mk); } }
  var z = apZiele(a.ziele), plaene = [], fp = [quelle.guid + ":" + quelle.wert];
  for (var k = 0; k < z.liste.length; k++) {
    if (k && k % 10 === 0) warte(100);
    var p = apZielPlan(z.liste[k], quelle, bereiche, masken, warn);
    plaene.push(p); fp.push(p.fp);
  }
  if (!bereiche.length && !masken.length) warn.push("Weder bereiche noch masken: Das Profil steht danach nur in der Profilliste der Ziele.");
  warn.push("Wirkt im ELO Client (Desktop) ab dem naechsten Start, nicht im Web Client. Vorher wird der bisherige Stand jedes Ziels gesichert.");
  var tun = plaene.filter(function (p) { return !p.nichts; });
  return { quelle: quelle, vorbild: vk, plaene: tun, warnungen: warn, fp: fp.join("#"),
           vorschau: { aktion: vk ? "Anzeigeprofil uebertragen (checkinUserProfile)" : "Anzeigeprofil neu anlegen und verteilen (checkinUserProfile)",
                       vorbild: vk ? vk.name + " [" + vk.id + "]" : undefined,
                       profil: { name: quelle.name, guid: quelle.guid, aufteilung: quelle.aufteilung, teiler: quelle.teiler,
                                 quelle: quelle.quelle !== "eigen" ? quelle.quelle : undefined, wert: vk ? undefined : quelle.wert },
                       bereiche: bereiche.map(function (n) { return AP_BEREICHE[n]; }), masken: masken.map(function (m) { return m.name + " [" + m.id + "]"; }),
                       zieleAngegeben: z.herkunft, zielbenutzer: z.liste.length, zuAendern: tun.length,
                       ziele: plaene.map(function (p) { return p.vorschau; }) } };
}

function apSchreiben(uid, setzen, loeschen) {
  var kv = [];
  for (var k in setzen) kv.push(new IXC.KeyValue(k, setzen[k]));
  if (kv.length) { var up = new IXC.UserProfile(); up.setUserId(S(uid)); up.setOptions(kv); ELO.ix().checkinUserProfile(up, IXC.LockC.NO); }
  if (loeschen.length) {
    var kd = []; for (var i = 0; i < loeschen.length; i++) kd.push(new IXC.KeyValue(loeschen[i], ""));
    var ud = new IXC.UserProfile(); ud.setUserId(S(uid)); ud.setOptions(kd); ELO.ix().deleteUserProfile(ud, IXC.LockC.NO);
  }
}

tool("elo_display_profile_set",
  "Uebertraegt ein Anzeigeprofil des ELO Client (zweistufig) von einem Vorbild (Standard: angemeldetes Konto) auf Zielbenutzer, wie 'Anzeigeprofile verwalten' " +
  "mit 'Benutzer auswaehlen'. Gruppen in ziele werden in ihre Benutzer aufgeloest (jeder bekommt eigene Werte). Wahlweise ordnet es das Profil " +
  "Funktionsbereichen (Ablage, Postbox, Klemmbrett, Aufgaben, Bearbeitung, Suche) und/oder Masken zu (Maske hat Vorrang). Andere Profile und " +
  "Zuordnungen der Ziele bleiben. Hat ein Ziel noch keine Profile, kommen die Standardprofile des Clients mit. Vorher Sicherung unter " +
  "%LOCALAPPDATA%\\elo-mcp\\sicherung, danach Ruecklesen. Wirkt ab dem naechsten Start des Clients; hoechstens " + LIMIT_AP.ziele + " Zielbenutzer. Lesen: elo_display_profiles. " +
  "Statt profil kann neu ein Profil aus einer Aufteilung anlegen: Bereiche links | (oben ueber Mitte links | Mitte rechts) | rechts; drei Spalten nebeneinander " +
  "z. B. {\"name\": \"Rechnungsfreigabe\", \"aufteilung\": {\"mitteLinks\": [\"Formular\"], \"mitteRechts\": [\"Inhalt\"], \"rechts\": [\"Feed\"]}}. " +
  "Mehrere Elemente in einem Bereich werden Reiter. Gleicher Name ergibt dieselbe GUID (bei allen Zielen dasselbe Profil).",
  { vorbild: { type: "string", description: "Konto mit dem Profil (ID, ELO-Name, Windows-Name, Mail), Standard: angemeldetes Konto" },
    profil: { type: "string", description: "Name oder GUID des Profils beim Vorbild (auch eingebaute wie 'Formularbearbeitung'); entfaellt mit neu" },
    neu: { type: "object", description: "Neues Profil statt profil: name, aufteilung, optional breiten und guid",
           properties: { name: { type: "string", description: "Profilname, wie er im Client erscheint" },
                         aufteilung: { type: "object", description: "Bereich -> Elemente (Reiter in dieser Reihenfolge). Bereiche: links, oben, mitteLinks, mitteRechts, rechts. " +
                                       "Elemente: Inhalt, Formular, Aufgabe, Feed, Volltext, Webanwendung, Uebergeordnete Metadaten",
                                       additionalProperties: { type: "array", items: { type: "string" } } },
                         breiten: { type: "object", description: "Prozent: links (Breite links, Standard 30), rechts (Breite rechts, 20), mitteLinks (Anteil an der Mitte, 50), oben (Hoehe oben, 40)",
                                    additionalProperties: { type: "integer" } },
                         guid: { type: "string", description: "Optional feste GUID; Standard aus dem Namen abgeleitet" } },
           required: ["name", "aufteilung"] },
    ziele: { description: "Benutzer oder Gruppen (ID, Name, Windows-Name, Mail) bzw. Liste", anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    bereiche: { type: "array", items: { type: "string", enum: ["Ablage", "Postbox", "Klemmbrett", "Aufgaben", "Bearbeitung", "Suche"] }, description: "Funktionsbereiche, denen das Profil zugeordnet wird" },
    masken: { type: "array", items: { type: "string" }, description: "Masken (Name oder ID), denen das Profil zugeordnet wird" },
    token: P_TOKEN },
  ["ziele"], function (a) {
    return zweiSchritte("elo_display_profile_set", a, function () { return apSetPlan(a); }, function (p) {
      if (!p.plaene.length) return { geaendert: 0, hinweis: "Alle Ziele haben schon diesen Stand." };
      var sicherung = jsonSichern("anzeigeprofile", { aktion: "Anzeigeprofil uebertragen", archiv: ARCHIV_NAME || undefined, profil: p.quelle.name, guid: p.quelle.guid,
        hinweis: "Je Ziel die eigenen Werte vorher (alle Anzeigeprofil-Schluessel). Wiederherstellen: Werte setzen, neu dazugekommene Schluessel loeschen.",
        ziele: p.plaene.map(function (x) { return { id: x.ziel.id, name: x.ziel.name, vorher: x.eigenVorher, gesetzt: x.setzen, geloescht: x.loeschen }; }) });
      var erg = [];
      for (var i = 0; i < p.plaene.length; i++) {
        var pl = p.plaene[i], e = { ziel: pl.ziel.name + " [" + pl.ziel.id + "]" };
        if (i && i % 10 === 0) warte(100);
        try { apSchreiben(pl.ziel.id, pl.setzen, pl.loeschen); }
        catch (ex) { e.fehler = errText(ex); erg.push(e); continue; }
        var nach = apOptionen(pl.ziel.id).eigen, abw = [];
        for (var k in pl.setzen) if (nach[k] !== pl.setzen[k]) abw.push(k);
        for (var j = 0; j < pl.loeschen.length; j++) if (hat(nach, pl.loeschen[j])) abw.push(pl.loeschen[j] + " (noch da)");
        e.rueckgelesen = abw.length ? "ABWEICHUNG bei " + abw.join(", ") : "ok, wie geplant";
        erg.push(e);
      }
      var fehler = erg.filter(function (x) { return x.fehler || /ABWEICHUNG/.test(x.rueckgelesen); }).length;
      return { geaendert: erg.length - fehler, fehler: fehler || undefined, ziele: erg, sicherung: sicherung,
               hinweis: "Wirkt ab dem naechsten Start des ELO Client. Kontrolle: elo_display_profiles mit benutzer." };
    });
  }, 3);
