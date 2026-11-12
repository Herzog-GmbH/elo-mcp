/*
 * elo-mcp-rechte.js - Objektrechte (ACL) und Vertretungen. Wird nach elo-mcp-benutzer.js geladen
 * (nutzt rechteText, rechteBits, aclArt aus elo-mcp-masken.js; zweiSchritte, bauenPruefen, sicherungsOrdner,
 * zeitstempel aus elo-mcp-schreiben.js/elo-mcp-bauen.js; allGroups, sordOf aus elo-mcp.js).
 *
 * elo_acl (Stufe 1)                - Rechte eines Objekts; mit benutzer die wirksamen Rechte je Person
 *                                    (direkt, ueber Gruppen, geerbt, Eigentuemer); mit unterordner=true
 *                                    dasselbe fuer die Ordner eine Ebene darunter und alle Abweichungen
 * elo_acl_set (Stufe 3)            - Rechte EINES Objekts aendern: Eintraege setzen, wie bei einer anderen
 *                                    Person/Gruppe, entfernen. Unterordner und Dokumente bleiben unberuehrt.
 * elo_substitutions (Stufe 1)      - Vertretungen: wer vertritt die Person, wen vertritt sie
 * elo_substitution_set (Stufe 3)   - Vertretung mit Zeitraum anlegen oder eine bestehende beenden
 *
 * Alles zweistufig mit Vorschau und Token, Sicherung als JSON vorher und nachher, zuruecklesen.
 * Rechte an Masken, Funktionsrechte und Gruppenmitgliedschaften aendern diese Werkzeuge nicht.
 */

var ACL_T = { GRUPPE: 0, BENUTZER: 1, SCHLUESSEL: 10, ERBE: 100, EIGENTUEMER: 200, BETEILIGTE: 300 };
var JEDER = 9999;
var LIMIT_UNTERORDNER = 50, LIMIT_VERGLEICH = 5, LIMIT_ERBE = 20;

function aclArtLang(t) {
  return t === ACL_T.SCHLUESSEL ? "Schluessel" : (t === ACL_T.BETEILIGTE ? "Beteiligte" : aclArt(t));
}

function sordMitAcl(id) {
  if (!trim(id)) fail("Objekt fehlt (ID, GUID oder Archivpfad).");
  return ELO.ix().checkoutSord(ELO.arcpath(trim(id)), IXC.SordC.mbAll, IXC.LockC.NO);
}

function aclEintraege(items) {
  var out = [];
  for (var i = 0; items && i < items.length; i++)
    out.push({ name: S(items[i].getName()), id: S(items[i].getId()), art: aclArtLang(items[i].getType()), rechte: rechteText(items[i].getAccess()) });
  return out;
}

/* Person oder Gruppe mit allen Gruppen, in denen sie (auch verschachtelt) steckt. */
function personMitGruppen(wer) {
  var u;
  try { u = ELO.ix().checkoutUser(trim(wer), IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO); }
  catch (e) { fail("Benutzer oder Gruppe nicht gefunden: " + wer); }
  var ids = {}, gs = allGroups(u);
  ids[S(u.getId())] = S(u.getName());
  for (var i = 0; i < gs.length; i++) ids[S(gs[i].info.getId())] = S(gs[i].info.getName());
  if (u.getType() !== ACL_T.GRUPPE) ids[S(JEDER)] = ids[S(JEDER)] || "Jeder";
  return { u: u, id: S(u.getId()), name: S(u.getName()), ids: ids };
}

/* Wirksame Rechte einer Person an einem Sord: Bits und Herkunft je Eintrag. Erbt der Eintrag vom
   Elternordner (Typ 100), wird dort weitergerechnet. Schluessel und Beteiligte werden nur gemeldet. */
function wirksam(sord, p, tiefe, cache) {
  var items = sord.getAclItems(), bits = 0, quelle = [], offen = [];
  for (var i = 0; items && i < items.length; i++) {
    var it = items[i], t = it.getType(), acc = it.getAccess();
    if ((t === ACL_T.GRUPPE || t === ACL_T.BENUTZER) && p.ids[S(it.getId())] !== undefined) {
      bits |= acc; quelle.push((S(it.getId()) === p.id ? "direkt" : "ueber " + p.ids[S(it.getId())]) + " " + rechteText(acc));
    } else if (t === ACL_T.EIGENTUEMER && S(sord.getOwnerId()) === p.id) {
      bits |= acc; quelle.push("als Eigentuemer " + rechteText(acc));
    } else if (t === ACL_T.ERBE) {
      if ((tiefe || 0) >= LIMIT_ERBE) { offen.push("Vererbung tiefer als " + LIMIT_ERBE + " Ebenen nicht verfolgt"); continue; }
      var pid = S(sord.getParentId());
      if (!pid || pid === "0") continue;
      var eltern = cache[pid] || (cache[pid] = sordMitAcl(pid));
      var w = wirksam(eltern, p, (tiefe || 0) + 1, cache), geerbt = w.bits & acc;
      if (geerbt) { bits |= geerbt; quelle.push("geerbt von " + S(eltern.getName()) + " " + rechteText(geerbt)); }
      offen = offen.concat(w.offen);
    } else if (t === ACL_T.SCHLUESSEL || t === ACL_T.BETEILIGTE) {
      offen.push(aclArtLang(t) + " '" + S(it.getName()) + "' " + rechteText(acc) + " nicht ausgewertet");
    }
  }
  return { bits: bits, quelle: quelle, offen: offen };
}

function personenAus(liste) {
  if (liste === undefined || liste === null || liste === "") return [];
  if (typeof liste === "string") liste = [liste];
  if (!liste.length) return [];
  if (liste.length > LIMIT_VERGLEICH) fail("Hoechstens " + LIMIT_VERGLEICH + " Personen auf einmal.");
  var out = [];
  for (var i = 0; i < liste.length; i++) out.push(personMitGruppen(liste[i]));
  return out;
}

function zeileFuer(sord, personen, cache) {
  var z = { id: S(sord.getId()), name: S(sord.getName()), rechte: {} }, hinweise = [];
  for (var i = 0; i < personen.length; i++) {
    var w = wirksam(sord, personen[i], 0, cache);
    z.rechte[personen[i].name] = rechteText(w.bits);
    for (var k = 0; k < w.offen.length; k++) if (hinweise.indexOf(w.offen[k]) < 0) hinweise.push(w.offen[k]);
  }
  if (hinweise.length) z.hinweise = hinweise;
  return z;
}

function unterordnerVon(sord) {
  var fi = new IXC.FindInfo(), fc = new IXC.FindChildren();
  fc.setParentId(S(sord.getId())); fc.setEndLevel(1); fi.setFindChildren(fc);
  var r = findSords(fi, LIMIT.liste, IXC.SordC.mbAll), out = [];
  for (var i = 0; i < r.sords.length; i++) if (isFolder(r.sords[i])) out.push(r.sords[i]);
  return { ordner: out, mehr: r.mehr };
}

tool("elo_acl",
  "Rechte (ACL) eines Archiveintrags: alle Eintraege mit Art und Rechten (R lesen, W Metadaten, D loeschen, E Dokument bearbeiten, L Liste, P Rechte). " +
  "Mit benutzer (Name, ID; auch eine Liste bis " + LIMIT_VERGLEICH + ") die wirksamen Rechte jeder Person mit Herkunft (direkt, ueber Gruppe, geerbt vom Elternordner, als Eigentuemer). " +
  "Mit unterordner=true zusaetzlich die Ordner eine Ebene darunter (hoechstens " + LIMIT_UNTERORDNER + ") und bei mehreren Personen nur die Stellen, an denen sie verschiedene Rechte haben - " +
  "so findet man z. B., wo einer Vertretung ein Recht fehlt.",
  { objekt: P_OBJ,
    benutzer: { description: "Person oder Gruppe (Name 'Nachname, Vorname' oder ID) bzw. Liste davon", anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    unterordner: { type: "boolean", description: "Auch die Ordner direkt darunter pruefen (eine Ebene)" } },
  ["objekt"], function (a) {
    var s = sordMitAcl(a.objekt), personen = personenAus(a.benutzer), cache = {};
    var res = { id: S(s.getId()), name: S(s.getName()), art: isFolder(s) ? "Ordner" : "Dokument", pfad: pathOf(s),
                eigentuemer: S(s.getOwnerName()), eintraege: aclEintraege(s.getAclItems()) };
    if (personen.length) {
      res.wirksam = [];
      for (var i = 0; i < personen.length; i++) {
        var w = wirksam(s, personen[i], 0, cache);
        res.wirksam.push({ person: personen[i].name, id: personen[i].id, rechte: rechteText(w.bits), herkunft: w.quelle, hinweise: w.offen.length ? w.offen : undefined });
      }
    }
    if (a.unterordner) {
      if (!isFolder(s)) fail("unterordner geht nur bei einem Ordner.");
      if (!personen.length) fail("unterordner braucht benutzer (eine oder mehrere Personen).");
      var u = unterordnerVon(s), zeilen = [], abw = [];
      if (u.ordner.length > LIMIT_UNTERORDNER) fail("Mehr als " + LIMIT_UNTERORDNER + " Unterordner - bitte einen engeren Ordner nehmen.");
      for (var j = 0; j < u.ordner.length; j++) {
        var z = zeileFuer(u.ordner[j], personen, cache);
        zeilen.push(z);
        if (personen.length > 1) {
          var werte = {}, n = 0;
          for (var k in z.rechte) if (!werte[z.rechte[k]]) { werte[z.rechte[k]] = true; n++; }
          if (n > 1) abw.push(z);
        }
      }
      res.unterordner = { anzahl: zeilen.length, mehrVorhanden: u.mehr || undefined };
      if (personen.length > 1) { res.unterordner.abweichungen = abw; res.unterordner.gleich = zeilen.length - abw.length; }
      else res.unterordner.liste = zeilen;
    }
    return res;
  });

/* ---------- Rechte setzen ---------- */

function aclSichern(s, suffix) {
  var f = new java.io.File(sicherungsOrdner(), "acl-" + S(s.getId()) + "-" + zeitstempel() + suffix + ".json");
  var items = s.getAclItems(), roh = [];
  for (var i = 0; items && i < items.length; i++) roh.push({ id: items[i].getId(), name: S(items[i].getName()), type: items[i].getType(), access: items[i].getAccess() });
  var w = new java.io.OutputStreamWriter(new java.io.FileOutputStream(f), "UTF-8");
  try { w.write(JSON.stringify({ id: S(s.getId()), name: S(s.getName()), pfad: pathOf(s), acl: roh }, null, 1)); } finally { w.close(); }
  return S(f.getAbsolutePath());
}

function aclFp(s) {
  var items = s.getAclItems(), t = [];
  for (var i = 0; items && i < items.length; i++) t.push(items[i].getType() + "/" + items[i].getId() + ":" + items[i].getAccess());
  t.sort();
  return S(s.getId()) + "|" + S(s.getName()) + "|" + S(s.getLockId()) + "|" + t.join(",");
}

/* aenderungen: [{name, rechte}] mit rechte "RW..."/"voll"/"entfernen" oder [{name, wie}] (Rechte wie ein anderer Eintrag). */
function aclPlan(a) {
  var s = sordMitAcl(a.objekt), items = s.getAclItems(), liste = [], i, j;
  for (i = 0; items && i < items.length; i++) liste.push({ id: items[i].getId(), name: S(items[i].getName()), type: items[i].getType(), access: items[i].getAccess() });
  var ae = a.aenderungen;
  if (!ae || !ae.length) fail("aenderungen fehlt: Liste [{\"name\": \"Nachname, Vorname\", \"rechte\": \"RWE\"}] oder [{\"name\": ..., \"wie\": \"andere Person\"}]; rechte \"entfernen\" nimmt den Eintrag heraus.");
  var schritte = [], warn = [];
  for (j = 0; j < ae.length; j++) {
    var e = ae[j] || {}, nm = trim(e.name);
    if (!nm) fail("aenderungen[" + j + "]: name fehlt.");
    var p = personMitGruppen(nm), typ = p.u.getType() === ACL_T.GRUPPE ? ACL_T.GRUPPE : ACL_T.BENUTZER;
    var pos = -1;
    for (i = 0; i < liste.length; i++) if (liste[i].id === p.u.getId() && liste[i].type === typ) pos = i;
    var bisher = pos >= 0 ? rechteText(liste[pos].access) : "-", neu;
    if (trim(e.wie)) {
      if (e.rechte) fail("aenderungen[" + j + "]: entweder rechte oder wie, nicht beides.");
      var v = personMitGruppen(e.wie), vt = v.u.getType() === ACL_T.GRUPPE ? ACL_T.GRUPPE : ACL_T.BENUTZER, vacc = null;
      for (i = 0; i < liste.length; i++) if (liste[i].id === v.u.getId() && liste[i].type === vt) vacc = liste[i].access;
      if (vacc === null) fail(v.name + " steht nicht direkt in den Rechten von " + S(s.getName()) + " - 'wie' kopiert nur direkte Eintraege. Rechte ausdruecklich angeben.");
      neu = vacc;
    } else if (/^(entfernen|-|keine)$/i.test(trim(e.rechte))) {
      if (pos < 0) fail(p.name + " steht nicht in den Rechten von " + S(s.getName()) + ", nichts zu entfernen.");
      neu = 0;
    } else {
      if (!trim(e.rechte)) fail("aenderungen[" + j + "]: rechte oder wie angeben.");
      neu = rechteBits(e.rechte);
    }
    if (pos >= 0 && liste[pos].access === neu) { warn.push(p.name + ": hat schon " + bisher + ", keine Aenderung."); continue; }
    if (neu === 0) liste.splice(pos, 1);
    else if (pos >= 0) liste[pos].access = neu;
    else liste.push({ id: p.u.getId(), name: p.name, type: typ, access: neu });
    schritte.push({ name: p.name, art: aclArtLang(typ), bisher: bisher, neu: neu ? rechteText(neu) : "entfernt" });
  }
  if (!schritte.length) fail("Keine Aenderung: " + warn.join(" "));
  var eigene = S(ELO.connect().getLoginResult().getUser().getId()), pBehalten = false;
  for (i = 0; i < liste.length; i++) if ((liste[i].access & 32) && (S(liste[i].id) === eigene || liste[i].type === ACL_T.GRUPPE)) pBehalten = true;
  if (!pBehalten) warn.push("Nach der Aenderung hat das eigene Konto kein P (Rechte setzen) mehr direkt am Objekt - Zuruecknehmen geht dann nur ueber ein Administratorkonto.");
  if (isFolder(s)) warn.push("Gilt nur fuer diesen Ordner. Unterordner und Dokumente behalten ihre Rechte (ausser sie erben ausdruecklich vom Elternordner).");
  return { s: s, liste: liste, warn: warn, fp: aclFp(s),
           vorschau: { aktion: "Rechte eines Objekts aendern", objekt: S(s.getName()), id: S(s.getId()), pfad: pathOf(s), aenderungen: schritte,
                       danach: aclEintraege(aclListeZuItems(liste)) } };
}

function aclListeZuItems(liste) {
  var arr = java.lang.reflect.Array.newInstance(IXC.AclItem, liste.length);
  for (var i = 0; i < liste.length; i++) {
    var it = new IXC.AclItem(); it.setId(liste[i].id); it.setType(liste[i].type); it.setAccess(liste[i].access);
    if (liste[i].name) it.setName(S(liste[i].name));
    arr[i] = it;
  }
  return arr;
}

tool("elo_acl_set",
  "Aendert die Rechte (ACL) EINES Archiveintrags (zweistufig, Stufe 3 bauen, Sicherung vorher und nachher, zuruecklesen). " +
  "aenderungen: Liste von {name, rechte} mit rechte aus R W D E L P (oder 'voll', 'entfernen') oder {name, wie} = dieselben Rechte wie ein anderer direkter Eintrag, " +
  "z. B. fuer eine Vertretung {\"name\": \"Muster, Max\", \"wie\": \"Muster, Maria\"}. Andere Eintraege bleiben. Unterordner und Dokumente werden nicht angefasst.",
  { objekt: P_OBJ,
    aenderungen: { type: "array", description: "[{\"name\": \"Nachname, Vorname\" oder Gruppe oder ID, \"rechte\": \"RWE\" | \"voll\" | \"entfernen\"} oder {\"name\": ..., \"wie\": \"Vorbild\"}]",
                   items: { type: "object", properties: { name: { type: "string" }, rechte: { type: "string" }, wie: { type: "string" } }, required: ["name"] } },
    token: P_TOKEN },
  ["objekt", "aenderungen"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_acl_set", a, function () {
      var p = aclPlan(a);
      return { vorschau: p.vorschau, warnungen: p.warn, fp: p.fp };
    }, function () {
      var p = aclPlan(a), id = S(p.s.getId());
      var s = ELO.ix().checkoutSord(id, IXC.SordC.mbAll, IXC.LockC.YES);
      var vorher = aclSichern(s, "-vorher");
      try {
        s.setAclItems(aclListeZuItems(p.liste));
        ELO.ix().checkinSord(s, IXC.SordC.mbAll, IXC.LockC.YES);
      } catch (e) {
        try { ELO.ix().checkinSord(s, IXC.SordC.mbOnlyUnlock, IXC.LockC.YES); } catch (e2) { /* Sperre ggf. schon frei */ }
        throw e;
      }
      var ist = sordMitAcl(id), soll = aclListeZuItems(p.liste);
      var gleich = aclSig(ist.getAclItems()) === aclSig(soll);
      return { objekt: S(ist.getName()), id: id, jetzt: aclEintraege(ist.getAclItems()), rueckgelesen: gleich ? "ok, wie geplant" : "ABWEICHUNG",
               sicherungVorher: vorher, sicherungNachher: aclSichern(ist, "-nachher"),
               hinweis: "Wirkt sofort; der Client zeigt neue Rechte an Knoepfen und Aktionen oft erst nach neuer Anmeldung. Zuruecknehmen: elo_acl_set mit den Werten aus der Sicherung." };
    });
  }, 3);

/* ---------- Vertretungen ---------- */

var SUBS = Packages.de.elo.ix.client.subs;

function isoDatum(v, ende) {
  v = trim(v);
  var m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(v) || /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
  if (!m) fail("Datum '" + v + "': JJJJ-MM-TT oder TT.MM.JJJJ.");
  var j = m[1].length === 4 ? m[1] : m[3], mo = m[2], t = m[1].length === 4 ? m[3] : m[1];
  return j + mo + t + (ende ? "235959" : "000000");
}
function isoLesbar(s) { s = S(s); return s.length >= 8 ? s.substring(6, 8) + "." + s.substring(4, 6) + "." + s.substring(0, 4) : s; }
function heuteIso() { return S(new java.text.SimpleDateFormat("yyyyMMddHHmmss").format(new java.util.Date())); }
function gesternIso() { var c = java.util.Calendar.getInstance(); c.add(java.util.Calendar.DATE, -1); return S(new java.text.SimpleDateFormat("yyyyMMdd").format(c.getTime())) + "235959"; }

function intListe(ids) { var l = new java.util.ArrayList(); for (var i = 0; i < ids.length; i++) l.add(java.lang.Integer.valueOf(parseInt(ids[i], 10))); return l; }

function vertretungenLesen(feld, id) {
  var ci = new SUBS.CheckoutSubstitutionsInfo();
  if (feld === "abwesend") ci.setUserIds(intListe([id])); else ci.setSubstituteIds(intListe([id]));
  var r = ELO.ix().checkoutSubstitutions(ci, SUBS.SubstitutionC.mbAll, IXC.LockC.NO), l = r.getSubstitutions(), out = [];
  for (var i = 0; l && i < l.size(); i++) out.push(l.get(i));
  return out;
}

function vertretungKurz(s) {
  var st = s.getSettings(), p = s.getSubstitutionPeriods(), z = [], jetzt = heuteIso(), laeuft = false;
  for (var i = 0; p && i < p.size(); i++) {
    var a = S(p.get(i).getStartIsodate()), b = S(p.get(i).getEndIsodate());
    z.push((a ? isoLesbar(a) : "offen") + " bis " + (b ? isoLesbar(b) : "offen"));
    if ((!a || a <= jetzt) && (!b || jetzt <= b)) laeuft = true;
  }
  var status = S(s.getStatus());
  return { guid: S(s.getGuid()), abwesend: S(s.getUserName()), abwesendId: S(s.getUserId()),
           vertreter: S(s.getSubstituteName()), vertreterId: S(s.getSubstituteId()),
           status: status, aktivJetzt: status === "ACTIVATED_MANUALLY" || (status === "ACTIVATED_BY_PERIOD" && laeuft),
           zeitraum: z, heuteImZeitraum: laeuft,
           aufgaben: st ? st.isCanAccessPersonalTasks() : undefined, postbox: st ? st.isCanAccessPostbox() : undefined,
           automatisch: st ? st.isActivatePeriodsAutomatically() : undefined,
           angelegtVon: S(s.getCreatorName()) || undefined, nachricht: trim(s.getMessage()) || undefined };
}

tool("elo_substitutions",
  "Vertretungen einer Person in ELO: wer sie vertritt (sie ist abwesend) und wen sie vertritt. Mit Zeitraum, Status, ob der Vertreter die persoenlichen Aufgaben und die Postbox sieht.",
  { benutzer: { type: "string", description: "Name ('Nachname, Vorname') oder ID" } },
  ["benutzer"], function (a) {
    var p = personMitGruppen(a.benutzer), f = vertretungenLesen("abwesend", p.id), v = vertretungenLesen("vertreter", p.id), i;
    var res = { benutzer: p.name, id: p.id, wirdVertretenVon: [], vertritt: [] };
    for (i = 0; i < f.length; i++) res.wirdVertretenVon.push(vertretungKurz(f[i]));
    for (i = 0; i < v.length; i++) res.vertritt.push(vertretungKurz(v[i]));
    return res;
  });

function vertretungPlan(a) {
  var p = personMitGruppen(a.benutzer);
  if (p.u.getType() === ACL_T.GRUPPE) fail(p.name + " ist eine Gruppe.");
  var bestand = vertretungenLesen("abwesend", p.id), fp = [], i;
  for (i = 0; i < bestand.length; i++) fp.push(JSON.stringify(vertretungKurz(bestand[i])));
  fp = fp.sort().join("\n");
  if (trim(a.beenden)) {
    var treffer = null;
    for (i = 0; i < bestand.length; i++) if (S(bestand[i].getGuid()) === trim(a.beenden)) treffer = bestand[i];
    if (!treffer) fail("Vertretung " + a.beenden + " gehoert nicht zu " + p.name + ". GUIDs liefert elo_substitutions.");
    return { aktion: "beenden", p: p, ziel: treffer, fp: fp, warn: [],
             vorschau: { aktion: S(treffer.getStatus()) === "ACTIVATED_MANUALLY" ? "Vertretung beenden (deaktivieren, nicht loeschen)"
                                 : "Vertretung beenden (ELO rechnet tageweise: laufender Zeitraum endet gestern, was heute oder spaeter beginnt, faellt weg; nicht loeschen)",
                         vertretung: vertretungKurz(treffer) } };
  }
  if (!trim(a.vertreter)) fail("vertreter fehlt (oder beenden mit der GUID einer bestehenden Vertretung).");
  if (!trim(a.bis)) fail("bis fehlt: Ende der Vertretung als JJJJ-MM-TT.");
  var v = personMitGruppen(a.vertreter);
  if (v.id === p.id) fail("Niemand vertritt sich selbst.");
  var von = trim(a.von) ? isoDatum(a.von, false) : heuteIso().substring(0, 8) + "000000", bis = isoDatum(a.bis, true);
  if (bis < von) fail("bis liegt vor von.");
  if (bis < heuteIso()) fail("bis liegt in der Vergangenheit.");
  var warn = [];
  for (i = 0; i < bestand.length; i++) if (S(bestand[i].getSubstituteId()) === v.id) warn.push("Es gibt schon eine Vertretung " + p.name + " -> " + v.name + " (" + vertretungKurz(bestand[i]).zeitraum.join(", ") + "); es kommt eine zweite dazu.");
  var aufgaben = a.aufgaben !== false, postbox = a.postbox === true;
  if (!aufgaben) warn.push("Ohne Aufgaben sieht der Vertreter nichts von " + p.name + ".");
  warn.push("Objektrechte bekommt der Vertreter dadurch nicht. Fehlende Rechte an Ordnern oder Knoepfen pruefen (elo_acl mit beiden Personen, unterordner=true).");
  return { aktion: "anlegen", p: p, v: v, von: von, bis: bis, aufgaben: aufgaben, postbox: postbox, fp: fp, warn: warn,
           vorschau: { aktion: "Vertretung anlegen", abwesend: p.name, vertreter: v.name, von: isoLesbar(von), bis: isoLesbar(bis),
                       persoenlicheAufgaben: aufgaben, postbox: postbox, aktiv: "automatisch im Zeitraum", nachricht: trim(a.nachricht) || undefined } };
}

tool("elo_substitution_set",
  "Legt eine ELO-Vertretung an (Person ist abwesend, Vertreter sieht im Zeitraum ihre persoenlichen Aufgaben, auf Wunsch auch die Postbox) oder beendet eine bestehende (beenden = GUID aus elo_substitutions; wird deaktiviert, nicht geloescht). " +
  "Zweistufig, Stufe 3 bauen, Sicherung vorher, zuruecklesen. Objektrechte aendert eine Vertretung nicht.",
  { benutzer: { type: "string", description: "Die abwesende Person (Name oder ID)" },
    vertreter: { type: "string", description: "Wer vertritt (Name oder ID)" },
    von: { type: "string", description: "Beginn JJJJ-MM-TT oder TT.MM.JJJJ, Standard heute" },
    bis: { type: "string", description: "Ende JJJJ-MM-TT oder TT.MM.JJJJ (einschliesslich)" },
    aufgaben: { type: "boolean", description: "Persoenliche Aufgaben sehen, Standard true" },
    postbox: { type: "boolean", description: "Postbox sehen, Standard false" },
    nachricht: { type: "string", description: "Optionaler Hinweis an den Vertreter" },
    beenden: { type: "string", description: "GUID einer bestehenden Vertretung, die beendet werden soll (statt anlegen)" },
    token: P_TOKEN },
  ["benutzer"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_substitution_set", a, function () {
      var p = vertretungPlan(a);
      return { vorschau: p.vorschau, warnungen: p.warn, fp: p.fp };
    }, function () {
      var p = vertretungPlan(a), vorherListe = [], i;
      var bestand = vertretungenLesen("abwesend", p.p.id);
      for (i = 0; i < bestand.length; i++) vorherListe.push(vertretungKurz(bestand[i]));
      var f = new java.io.File(sicherungsOrdner(), "vertretung-" + p.p.id + "-" + zeitstempel() + "-vorher.json");
      var w = new java.io.OutputStreamWriter(new java.io.FileOutputStream(f), "UTF-8");
      try { w.write(JSON.stringify(vorherListe, null, 1)); } finally { w.close(); }
      var guid;
      if (p.aktion === "beenden") {
        guid = S(p.ziel.getGuid());
        if (S(p.ziel.getStatus()) === "ACTIVATED_MANUALLY") {
          ELO.ix().deactivateSubstitution(guid, IXC.LockC.NO);
        } else {
          // Zeitraeume: was schon vorbei ist, bleibt; ein laufender endet jetzt; kuenftige fallen weg.
          // deactivateSubstitution lehnt ELO bei zeitgesteuerten Vertretungen ab (ELOIX:5071).
          var ci = new SUBS.CheckoutSubstitutionsInfo(), gl = new java.util.ArrayList(); gl.add(guid); ci.setSubstitutionGuids(gl);
          var sub = ELO.ix().checkoutSubstitutions(ci, SUBS.SubstitutionC.mbAll, IXC.LockC.YES).getSubstitutions().get(0);
          try {
            // ELO rechnet Zeitraeume tageweise: Ende = gestern, was heute oder spaeter beginnt, faellt weg.
            var heute0 = heuteIso().substring(0, 8) + "000000", gestern = gesternIso();
            var alt = sub.getSubstitutionPeriods(), neuP = new java.util.ArrayList();
            for (i = 0; alt && i < alt.size(); i++) {
              var a0 = S(alt.get(i).getStartIsodate()), b0 = S(alt.get(i).getEndIsodate());
              if (a0 && a0 >= heute0) continue;
              if (!b0 || b0 >= heute0) alt.get(i).setEndIsodate(gestern);
              neuP.add(alt.get(i));
            }
            sub.setSubstitutionPeriods(neuP);
            var ci2 = new SUBS.CheckinSubstitutionsInfo(), sl2 = new java.util.ArrayList(); sl2.add(sub); ci2.setSubstitutions(sl2);
            ELO.ix().checkinSubstitutions(ci2, SUBS.SubstitutionC.mbAll, IXC.LockC.YES);
          } catch (e) {
            try { var ci3 = new SUBS.CheckinSubstitutionsInfo(), sl3 = new java.util.ArrayList(); ci3.setSubstitutions(sl3); ELO.ix().checkinSubstitutions(ci3, SUBS.SubstitutionC.mbAll, IXC.LockC.YES); } catch (e2) { /* Sperre ggf. schon frei */ }
            throw e;
          }
        }
      } else {
        var s = new SUBS.Substitution();
        s.setUserId(parseInt(p.p.id, 10)); s.setSubstituteId(parseInt(p.v.id, 10));
        var per = new SUBS.SubstitutionPeriod(); per.setStartIsodate(p.von); per.setEndIsodate(p.bis);
        var pl = new java.util.ArrayList(); pl.add(per); s.setSubstitutionPeriods(pl);
        var st = new SUBS.SubstitutionSettings();
        st.setActivatePeriodsAutomatically(true); st.setCanBeActivatedManually(true); st.setCanBeForwarded(false);
        st.setCanAccessPersonalTasks(p.aufgaben); st.setCanAccessPostbox(p.postbox);
        s.setSettings(st);
        if (trim(a.nachricht)) s.setMessage(trim(a.nachricht));
        var info = new SUBS.CheckinSubstitutionsInfo(), sl = new java.util.ArrayList(); sl.add(s); info.setSubstitutions(sl);
        var r = ELO.ix().checkinSubstitutions(info, SUBS.SubstitutionC.mbAll, IXC.LockC.NO), g = r.getSubstitutionGuids();
        guid = g && g.size() ? S(g.get(0)) : "";
      }
      var nach = vertretungenLesen("abwesend", p.p.id), jetzt = null;
      for (i = 0; i < nach.length; i++) if (S(nach[i].getGuid()) === guid) jetzt = vertretungKurz(nach[i]);
      var ok = !!jetzt && (p.aktion === "beenden" ? !jetzt.aktivJetzt || /DEACTIVATED/.test(jetzt.status) : jetzt.vertreterId === p.v.id);
      return { aktion: p.aktion, vertretung: jetzt, rueckgelesen: ok ? "ok, wie geplant" : "ABWEICHUNG", sicherungVorher: S(f.getAbsolutePath()),
               hinweis: p.aktion === "beenden" ? "Beendet. Die Vertretung bleibt als Eintrag stehen; neu anlegen mit elo_substitution_set, falls sie doch weiterlaufen soll." :
                        "Der Vertreter sieht die Aufgaben nach neuer Anmeldung bzw. Aktualisieren der Aufgabenliste. Beenden: elo_substitution_set mit beenden=\"" + guid + "\"." };
    });
  }, 3);
