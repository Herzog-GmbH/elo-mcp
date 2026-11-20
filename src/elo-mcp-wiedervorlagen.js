/*
 * elo-mcp-wiedervorlagen.js - Wiedervorlagen (Reminder). Wird nach elo-mcp-ablage.js geladen
 * (nutzt isoDatum, personMitGruppen, ACL_T aus elo-mcp-rechte.js; zweiSchritte aus elo-mcp-schreiben.js;
 * jsonSichern aus elo-mcp-ergaenzungen.js; hat aus elo-mcp-notizen.js; idListe aus elo-mcp-vorgaenge.js).
 *
 * elo_reminders (Stufe 1)        - Wiedervorlagen eines Kontos (mit Gruppen) oder zu einem Objekt
 * elo_reminder_create (Stufe 2)  - Wiedervorlage zu einem Objekt fuer eine oder mehrere Personen/Gruppen anlegen
 * elo_reminder_delete (Stufe 2)  - Wiedervorlagen loeschen (per ID oder alle zu einem Objekt), Sicherung vorher
 *
 * Gelesen wird ueber findFirstTasks mit inclReminders (wie der Aufgabenbereich des Clients), ohne Workflows,
 * updateInUseDate aus. Zeiten liefert der Indexserver in UTC; angezeigt wird Ortszeit des Rechners.
 * Wiedervorlagen zu als geloescht markierten Objekten liefert die Suche nur mit inclDeleted (der Client zeigt sie nicht).
 * findFirstTasks sucht ohne Angabe nur Prioritaet 0 (hoch); alleTaskPrios setzt 0 bis 2.
 * Beim Anlegen wird das Datum als Mitternacht Ortszeit nach UTC umgerechnet.
 */

var LIMIT_WV = { liste: 50, loeschen: 200, empfaenger: 10, name: 128 };
var WV_PRIO = { "0": "hoch", "1": "mittel", "2": "niedrig" };

var WV_FMT = java.time.format.DateTimeFormatter.ofPattern("yyyyMMddHHmmss");

/* UTC-ISO (yyyyMMddHHmmss) -> Ortszeit "TT.MM.JJJJ" bzw. "TT.MM.JJJJ HH:mm", wenn nicht Mitternacht. */
function wvLokal(iso) {
  iso = S(iso);
  if (iso.length < 14) return iso;
  var z = java.time.LocalDateTime.parse(iso.substring(0, 14), WV_FMT).atOffset(java.time.ZoneOffset.UTC)
            .atZoneSameInstant(java.time.ZoneId.systemDefault());
  var d = S(z.format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy"))), t = S(z.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")));
  return t === "00:00" ? d : d + " " + t;
}

/* Datum (JJJJ-MM-TT oder TT.MM.JJJJ) -> Mitternacht Ortszeit als UTC-ISO. */
function wvUtc(datum) {
  var lokal = isoDatum(datum, false);
  return S(java.time.LocalDateTime.parse(lokal, WV_FMT).atZone(java.time.ZoneId.systemDefault())
             .withZoneSameInstant(java.time.ZoneOffset.UTC).format(WV_FMT));
}
function wvUtcJetzt() { return S(java.time.ZonedDateTime.now(java.time.ZoneOffset.UTC).format(WV_FMT)); }
function wvHeuteUtc() { return wvUtc(S(java.time.LocalDate.now().toString())); }

function wvKurz(r, s) {
  var am = S(r.getPromptDateIso()), due = S(r.getDueDateIso()), p = S(r.getPrio());
  return { id: S(r.getId()), name: S(r.getName()), beschreibung: trim(r.getDesc()) || undefined,
           objektId: S(r.getObjId()), objekt: s ? S(s.getName()) : undefined, objektGeloescht: s && s.isDeleted() ? true : undefined,
           empfaenger: S(r.getReceiverName()), empfaengerId: S(r.getReceiverId()), absender: S(r.getSenderName()) || undefined,
           am: wvLokal(am), frist: due ? wvLokal(due) : undefined, faellig: !!am && am <= wvUtcJetzt(),
           prio: p + (WV_PRIO[p] ? " (" + WV_PRIO[p] + ")" : ""), angelegt: wvLokal(r.getCreateDateIso()) || undefined };
}

/* Wiedervorlagen ueber die Aufgabensuche. o: { userId, gruppen, objId, alle, geloeschte, max } */
function wvSuchen(o) {
  var fi = new IXC.FindTasksInfo(), fr = null, out = [];
  if (o.userId) { var u = java.lang.reflect.Array.newInstance(java.lang.String, 1); u[0] = S(o.userId); fi.setUserIds(u); }
  if (o.alle) fi.setAllUsers(true);
  if (o.objId) fi.setObjId(S(o.objId));
  fi.setInclReminders(true); fi.setInclWorkflows(false); fi.setInclActivities(false);
  fi.setInclGroup(o.gruppen !== false); fi.setUpdateInUseDate(false); fi.setSordZ(IXC.SordC.mbMin);
  if (o.geloeschte) fi.setInclDeleted(true);
  alleTaskPrios(fi);
  try {
    fr = ELO.ix().findFirstTasks(fi, o.max);
    var t = fr.getTasks();
    for (var i = 0; t && i < t.length; i++) { var r = t[i].getReminder(); if (r) out.push(wvKurz(r, t[i].getSord())); }
    return { liste: out, mehr: !!fr.isMoreResults() };
  } finally { if (fr) { try { ELO.ix().findClose(fr.getSearchId()); } catch (e) {} } }
}

function wvObjekt(id) {
  var s;
  try { s = ELO.ix().checkoutSord(ELO.arcpath(trim(id)), IXC.SordC.mbAll, IXC.LockC.NO); }
  catch (e) { fail("Objekt nicht gefunden oder keine Rechte: " + id + " (" + errText(e) + ")"); }
  return s;
}

tool("elo_reminders",
  "Wiedervorlagen (Reminder) wie im Aufgabenbereich des Clients: je Eintrag ID, Name, Objekt, Empfaenger, Absender, Datum (am), Frist, Prioritaet, faellig. " +
  "Ohne Angabe die des angemeldeten Kontos mit seinen Gruppen. Mit benutzer die eines anderen Kontos; mit objekt nur die zu diesem Objekt " +
  "(ohne benutzer: fuer alle Empfaenger). Auch kuenftige Wiedervorlagen. Wiedervorlagen zu geloeschten Objekten zeigt der Client nicht; " +
  "mit geloeschteObjekte=true kommen sie mit (objektGeloescht). Hoechstens " + LIMIT_WV.liste + ". Zeiten in Ortszeit.",
  { benutzer: { type: "string", description: "Konto (ID oder Name), Standard: angemeldetes Konto bzw. mit objekt alle" },
    objekt: P_OBJ,
    gruppen: { type: "boolean", description: "Wiedervorlagen an Gruppen des Kontos dazunehmen, Standard true" },
    geloeschteObjekte: { type: "boolean", description: "Auch Wiedervorlagen zu als geloescht markierten Objekten, Standard false (wie der Client)" },
    max: { type: "integer", description: "Standard 30, hoechstens " + LIMIT_WV.liste } },
  [], function (a) {
    var o = { gruppen: a.gruppen !== false, geloeschte: a.geloeschteObjekte === true, max: cap(a.max, 30, LIMIT_WV.liste) }, res = {};
    if (trim(a.objekt)) { var s = wvObjekt(a.objekt); o.objId = S(s.getId()); res.objekt = S(s.getName()); res.objektId = o.objId; }
    if (trim(a.benutzer)) { var p = personMitGruppen(a.benutzer); o.userId = p.id; res.benutzer = p.name + " [" + p.id + "]"; }
    else if (o.objId) { o.alle = true; res.benutzer = "alle"; }
    else { var ich = ELO.connect().getLoginResult().getUser(); o.userId = S(ich.getId()); res.benutzer = S(ich.getName()) + " [" + o.userId + "]"; }
    var r = wvSuchen(o);
    res.anzahl = r.liste.length; res.faellig = r.liste.filter(function (x) { return x.faellig; }).length;
    res.mehrVorhanden = r.mehr; res.wiedervorlagen = r.liste;
    return res;
  });

/* ---------- Anlegen ---------- */

function wvEmpfaenger(liste) {
  if (liste === undefined || liste === null || liste === "" || (liste instanceof Array && !liste.length)) {
    var ich = ELO.connect().getLoginResult().getUser();
    return [{ id: S(ich.getId()), name: S(ich.getName()), gruppe: false }];
  }
  if (!(liste instanceof Array)) liste = [liste];
  if (liste.length > LIMIT_WV.empfaenger) fail("Hoechstens " + LIMIT_WV.empfaenger + " Empfaenger.");
  var out = [], gesehen = {};
  for (var i = 0; i < liste.length; i++) {
    var p = personMitGruppen(liste[i]);
    if (hat(gesehen, p.id)) continue;
    gesehen[p.id] = true;
    out.push({ id: p.id, name: p.name, gruppe: p.u.getType() === ACL_T.GRUPPE });
  }
  return out;
}

function wvAnlegenPlan(a) {
  if (!trim(a.objekt)) fail("objekt fehlt.");
  var s = wvObjekt(a.objekt), warn = [];
  if (s.isDeleted()) warn.push("Das Objekt ist als geloescht markiert; die Wiedervorlage erscheint erst nach dem Wiederherstellen in der Aufgabenliste.");
  var name = trim(a.name) || ("Wiedervorlage: " + S(s.getName()));
  if (name.length > LIMIT_WV.name) {
    if (trim(a.name)) fail("name ist " + name.length + " Zeichen lang, ELO erlaubt " + LIMIT_WV.name + ".");
    name = name.substring(0, LIMIT_WV.name);
  }
  var am = trim(a.am) ? wvUtc(a.am) : wvHeuteUtc(), frist = trim(a.frist) ? wvUtc(a.frist) : "";
  if (frist && frist < am) fail("frist liegt vor am.");
  if (am < wvHeuteUtc()) warn.push("am liegt in der Vergangenheit; die Wiedervorlage ist sofort faellig.");
  var prio = null;
  if (trim(a.prio)) {
    var pz = { hoch: 0, mittel: 1, niedrig: 2, "0": 0, "1": 1, "2": 2 }[trim(a.prio).toLowerCase()];
    if (pz === undefined) fail("prio: hoch, mittel oder niedrig.");
    prio = pz;
  }
  var empf = wvEmpfaenger(a.empfaenger), bestand = wvSuchen({ objId: S(s.getId()), alle: true, geloeschte: true, max: LIMIT_WV.liste }).liste, fp = [];
  for (var i = 0; i < bestand.length; i++) {
    fp.push(bestand[i].id);
    for (var j = 0; j < empf.length; j++)
      if (bestand[i].empfaengerId === empf[j].id && bestand[i].name === name)
        warn.push(empf[j].name + " hat zu diesem Objekt schon die Wiedervorlage '" + name + "' am " + bestand[i].am + " [" + bestand[i].id + "]; es kommt eine zweite dazu.");
  }
  var gruppen = empf.filter(function (e) { return e.gruppe; });
  if (gruppen.length) warn.push(a.anJedesMitglied ? "Gruppen werden aufgeloest: jedes Mitglied bekommt eine eigene Wiedervorlage." :
                                                    "Gruppen bekommen eine gemeinsame Wiedervorlage (anJedesMitglied=true: eine je Mitglied).");
  return { s: s, name: name, am: am, frist: frist, prio: prio, empf: empf, warnungen: warn, fp: S(s.getId()) + "|" + fp.sort().join(","),
           vorschau: { aktion: "Wiedervorlage anlegen", objekt: S(s.getName()), objektId: S(s.getId()), pfad: pathOf(s) || undefined,
                       name: name, beschreibung: trim(a.beschreibung) || undefined, am: wvLokal(am), frist: frist ? wvLokal(frist) : undefined,
                       prio: prio === null ? "Standard von ELO" : WV_PRIO[S(prio)],
                       empfaenger: empf.map(function (e) { return e.name + " [" + e.id + "]" + (e.gruppe ? " (Gruppe)" : ""); }),
                       vorhandeneZumObjekt: bestand.length } };
}

tool("elo_reminder_create",
  "Legt eine Wiedervorlage zu einem Objekt an (zweistufig), wie 'Wiedervorlage' im Client: Sie erscheint am Datum am in der Aufgabenliste der Empfaenger. " +
  "Ohne empfaenger fuer das angemeldete Konto. Datum als JJJJ-MM-TT oder TT.MM.JJJJ (Ortszeit), Standard heute. name hoechstens " + LIMIT_WV.name + " Zeichen, " +
  "Standard 'Wiedervorlage: <Kurzbezeichnung>'. Danach zuruecklesen. Loeschen: elo_reminder_delete.",
  { objekt: P_OBJ,
    name: { type: "string", description: "Text der Wiedervorlage, hoechstens " + LIMIT_WV.name + " Zeichen" },
    am: { type: "string", description: "Wiedervorlagedatum JJJJ-MM-TT oder TT.MM.JJJJ, Standard heute" },
    frist: { type: "string", description: "Optionale Frist (Termin) JJJJ-MM-TT oder TT.MM.JJJJ, nicht vor am" },
    beschreibung: { type: "string", description: "Optionaler laengerer Text" },
    empfaenger: { description: "Person oder Gruppe (Name oder ID) bzw. Liste bis " + LIMIT_WV.empfaenger + ", Standard das angemeldete Konto",
                  anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    anJedesMitglied: { type: "boolean", description: "Bei Gruppen: eine Wiedervorlage je Mitglied statt einer fuer die Gruppe, Standard false" },
    prio: { type: "string", enum: ["hoch", "mittel", "niedrig"], description: "Prioritaet, Standard wie ELO" },
    token: P_TOKEN },
  ["objekt"], function (a) {
    return zweiSchritte("elo_reminder_create", a, function () { return wvAnlegenPlan(a); }, function (p) {
      var r = ELO.ix().createReminder(S(p.s.getId()));
      r.setName(p.name);
      if (trim(a.beschreibung)) r.setDesc(trim(a.beschreibung));
      r.setPromptDateIso(p.am);
      if (p.frist) r.setDueDateIso(p.frist);
      if (p.prio !== null) r.setPrio(p.prio);
      var ids = java.lang.reflect.Array.newInstance(java.lang.String, p.empf.length);
      for (var i = 0; i < p.empf.length; i++) ids[i] = p.empf[i].id;
      var neu = ELO.ix().checkinReminder(r, ids, a.anJedesMitglied === true, IXC.LockC.NO), liste = [], abw = [];
      if (neu && neu.length) {
        var gelesen = ELO.ix().checkoutReminders(neu, IXC.LockC.NO);
        for (var k = 0; gelesen && k < gelesen.length; k++) {
          var w = wvKurz(gelesen[k], null);
          liste.push(w);
          if (w.name !== p.name || S(gelesen[k].getPromptDateIso()).substring(0, 12) !== p.am.substring(0, 12)) abw.push(w.id);
        }
      }
      return { angelegt: liste.length, wiedervorlagen: liste,
               rueckgelesen: !liste.length ? "ABWEICHUNG: keine Wiedervorlage zurueckgelesen" : (abw.length ? "ABWEICHUNG bei " + abw.join(", ") : "ok, wie geplant"),
               hinweis: "Loeschen: elo_reminder_delete mit ids=" + JSON.stringify(liste.map(function (x) { return x.id; })) + "." };
    });
  }, 2);

/* ---------- Loeschen ---------- */

function wvLesen(ids) {
  var arr = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, ids.length);
  for (var i = 0; i < ids.length; i++) arr[i] = parseInt(ids[i], 10);
  return ELO.ix().checkoutReminders(arr, IXC.LockC.NO);
}

/* Einzeln lesen: checkoutReminders bricht bei einer unbekannten ID den ganzen Aufruf ab. */
function wvEinzeln(id) {
  try {
    var r = wvLesen([id]);
    if (!r || !r.length) return { id: id, fehlt: "nicht gefunden" };
    if (r[0].isDeleted()) return { id: id, fehlt: "schon geloescht" };
    var s = null;
    try { s = ELO.ix().checkoutSord(S(r[0].getObjId()), IXC.SordC.mbMin, IXC.LockC.NO); } catch (e) { /* Objekt ohne Leserecht */ }
    return { id: id, r: r[0], kurz: wvKurz(r[0], s) };
  } catch (e) { return { id: id, fehlt: "nicht lesbar: " + errText(e) }; }
}

function wvLoeschenPlan(a) {
  var mitIds = a.ids !== undefined && a.ids !== null && !(a.ids instanceof Array && !a.ids.length);
  if (mitIds === !!trim(a.objekt)) fail("Entweder ids oder objekt angeben.");
  if (mitIds && trim(a.benutzer)) fail("benutzer gilt nur zusammen mit objekt.");
  var ids, quelle;
  if (mitIds) { ids = idListe(a.ids, LIMIT_WV.loeschen, "Wiedervorlagen"); quelle = { art: "IDs", anzahl: ids.length }; }
  else {
    var s = wvObjekt(a.objekt), o = { objId: S(s.getId()), geloeschte: true, max: LIMIT_WV.liste };
    quelle = { art: "Objekt", objekt: S(s.getName()) + " [" + S(s.getId()) + "]" };
    if (trim(a.benutzer)) { var p = personMitGruppen(a.benutzer); o.userId = p.id; o.gruppen = false; quelle.empfaenger = p.name + " [" + p.id + "]"; }
    else o.alle = true;
    var gef = wvSuchen(o);
    if (gef.mehr) fail("Mehr als " + LIMIT_WV.liste + " Wiedervorlagen zu diesem Objekt; bitte per ids loeschen.");
    ids = gef.liste.filter(function (x) { return !o.userId || x.empfaengerId === o.userId; }).map(function (x) { return x.id; });
    if (!ids.length) fail("Keine Wiedervorlagen zu " + quelle.objekt + (quelle.empfaenger ? " fuer " + quelle.empfaenger : "") + ".");
  }
  var auswahl = [], ausgelassen = [], fp = [];
  for (var i = 0; i < ids.length; i++) {
    if (i && i % 20 === 0) warte(100);
    var w = wvEinzeln(ids[i]);
    if (w.fehlt) { ausgelassen.push({ id: w.id, grund: w.fehlt }); continue; }
    auswahl.push(w);
    fp.push(w.id + ":" + S(w.r.getPromptDateIso()) + ":" + S(w.r.getReceiverId()) + ":" + S(w.r.getLockId()));
  }
  if (!auswahl.length) fail("Nichts zu loeschen." + (ausgelassen.length ? " Ausgelassen: " + JSON.stringify(ausgelassen) : ""));
  var warn = ["Endgueltig: geloeschte Wiedervorlagen lassen sich nicht wiederherstellen, nur aus der Sicherung neu anlegen (neue ID)."];
  for (var j = 0; j < auswahl.length; j++) if (S(auswahl[j].r.getLockName())) warn.push("Wiedervorlage " + auswahl[j].id + " ist gesperrt von " + S(auswahl[j].r.getLockName()) + ".");
  var vs = { aktion: "Wiedervorlagen loeschen (deleteReminders)", auswahl: quelle, anzahl: auswahl.length, wiedervorlagen: auswahl.map(function (x) { return x.kurz; }) };
  if (ausgelassen.length) vs.ausgelassen = ausgelassen;
  return { vorschau: vs, warnungen: warn, auswahl: auswahl, fp: fp.join(";") };
}

tool("elo_reminder_delete",
  "Loescht Wiedervorlagen (zweistufig): entweder ids (aus elo_reminders bzw. elo_my_tasks) oder alle zu einem objekt (auch einem geloeschten), optional nur die eines benutzer. " +
  "Endgueltig (deleteReminders), deshalb vorher Sicherung aller Angaben unter %LOCALAPPDATA%\\elo-mcp\\sicherung; neu anlegen geht mit elo_reminder_create. " +
  "Hoechstens " + LIMIT_WV.loeschen + " je Aufruf. Das Objekt selbst bleibt unveraendert.",
  { ids: { type: "array", items: { type: "string" }, description: "Wiedervorlage-IDs" },
    objekt: P_OBJ,
    benutzer: { type: "string", description: "Nur mit objekt: nur Wiedervorlagen dieses Empfaengers (ID oder Name)" },
    token: P_TOKEN },
  [], function (a) {
    return zweiSchritte("elo_reminder_delete", a, function () { return wvLoeschenPlan(a); }, function (p) {
      var sicherung = jsonSichern("wiedervorlagen-loeschen", { aktion: "Wiedervorlagen geloescht (deleteReminders)", archiv: ARCHIV_NAME || undefined,
        wiedervorlagen: p.auswahl.map(function (w) {
          var r = w.r;
          return { id: S(r.getId()), objId: S(r.getObjId()), objGuid: S(r.getObjGuid()), name: S(r.getName()), desc: S(r.getDesc()),
                   promptDateIso: S(r.getPromptDateIso()), dueDateIso: S(r.getDueDateIso()), prio: r.getPrio(),
                   receiverId: S(r.getReceiverId()), receiverName: S(r.getReceiverName()), senderName: S(r.getSenderName()), createDateIso: S(r.getCreateDateIso()) };
        }) });
      var ids = p.auswahl.map(function (w) { return w.id; }), ok = [], fehler = [];
      try {
        var arr = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, ids.length);
        for (var i = 0; i < ids.length; i++) arr[i] = parseInt(ids[i], 10);
        ELO.ix().deleteReminders(arr, IXC.LockC.NO);
      } catch (e) { return { geloescht: 0, fehler: errText(e), sicherung: sicherung }; }
      for (var j = 0; j < ids.length; j++) {
        var w = wvEinzeln(ids[j]);
        if (w.fehlt) ok.push(ids[j]); else fehler.push({ id: ids[j], fehler: "ABWEICHUNG: noch vorhanden" });
      }
      return { geloescht: ok.length, ids: ok, fehler: fehler.length ? fehler : undefined, sicherung: sicherung };
    });
  }, 2);
