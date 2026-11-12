/*
 * elo-mcp-benutzer.js - Benutzerkonten: Windows-Anmeldename und Mail lesen, doppelte finden, setzen.
 * Wird nach elo-mcp-masken.js geladen (nutzt zweiSchritte, bauenPruefen, sicherungsOrdner, zeitstempel).
 *
 * Hintergrund: Die Anmeldung per SSO (Kerberos/NTLM) ordnet den Windows-Namen dem ELO-Konto ueber die
 * Benutzereigenschaft 0 (UserInfoC.PROP_NAME_OS) zu. Tragen zwei Konten denselben Windows-Namen,
 * findet der Indexserver kein eindeutiges Konto und die Anmeldung scheitert.
 *
 * elo_user (Stufe 1)           - ein Konto mit Windows-Name, Mail, letzter Anmeldung, Gruppen und Konten
 *                                mit gleichem Windows-Namen; oder alle doppelten Windows-Namen und Mails
 * elo_user_set_login (Stufe 3) - Windows-Name und/oder Mail eines Kontos setzen oder leeren (zweistufig,
 *                                Sicherung vorher und nachher, zuruecklesen). Rechte, Gruppen, Name und
 *                                Passwort bleiben unberuehrt. Anlegen und Loeschen von Konten gibt es nicht.
 */

var PROP_OS = 0, PROP_MAIL = 1;

function uProp(u, i) { var p = u.getUserProps(); return (p && p.length > i && p[i] !== null) ? trim(p[i]) : ""; }
function uTyp(u) { return u.getType() === IXC.UserInfoC.TYPE_GROUP ? "Gruppe" : "Benutzer"; }
function uKurz(u) {
  return { id: S(u.getId()), name: S(u.getName()), typ: uTyp(u), windowsName: uProp(u, PROP_OS), mail: uProp(u, PROP_MAIL),
           letzteAnmeldung: S(u.getLastLoginIso()) };
}
/* Windows-Namen vergleichen: Gross-/Kleinschreibung egal, 'DOMAENE\name' passt auch zu 'name'. */
function osKey(s) { s = trim(s).toLowerCase(); return s; }
function osKurz(s) { s = osKey(s); var i = s.lastIndexOf("\\"); return i >= 0 ? s.substring(i + 1) : s; }
function osGleich(a, b) { return !!osKey(a) && !!osKey(b) && (osKey(a) === osKey(b) || osKurz(a) === osKurz(b)); }

/* Ein Aufruf, alle Benutzer ohne Gruppen, ohne geerbte Rechte. */
function alleBenutzer() { return ELO.ix().checkoutUsers(null, IXC.CheckoutUsersC.ALL_USERS_RAW, IXC.LockC.NO); }

/* ID oder ELO-Name direkt, sonst Windows-Name oder Mail ueber die Benutzerliste. */
function benutzerFinden(who) {
  who = trim(who);
  if (!who) fail("benutzer ist leer.");
  try { return { u: ELO.ix().checkoutUser(who, IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO) }; } catch (e) { /* weiter */ }
  var all = alleBenutzer(), hits = [];
  for (var i = 0; i < all.length; i++)
    if (osGleich(uProp(all[i], PROP_OS), who) || uProp(all[i], PROP_MAIL).toLowerCase() === who.toLowerCase()) hits.push(all[i]);
  if (hits.length === 0) fail("Benutzer nicht gefunden: " + who + " (gesucht nach ID, ELO-Name, Windows-Name und Mail).");
  return { u: hits[0], alle: all, mehrdeutig: hits.length > 1 ? hits : null };
}

function andereMit(all, u, wert, prop) {
  var res = [];
  if (!trim(wert)) return res;
  for (var i = 0; i < all.length; i++) {
    if (S(all[i].getId()) === S(u.getId())) continue;
    var v = uProp(all[i], prop);
    if (prop === PROP_OS ? osGleich(v, wert) : (v && v.toLowerCase() === trim(wert).toLowerCase())) res.push(uKurz(all[i]));
  }
  return res;
}

function doppelte(all, prop) {
  var map = {}, res = [];
  for (var i = 0; i < all.length; i++) {
    var v = uProp(all[i], prop);
    if (!v) continue;
    var k = prop === PROP_OS ? osKurz(v) : v.toLowerCase();
    (map[k] = map[k] || []).push(uKurz(all[i]));
  }
  for (var k in map) if (map[k].length > 1) res.push({ wert: k, konten: map[k] });
  return res;
}

tool("elo_user",
  "Liest ein ELO-Benutzerkonto: ID, Name, Windows-Anmeldename (fuer SSO), Mail, letzte Anmeldung, Gruppen und andere Konten mit demselben Windows-Namen bzw. derselben Mail. " +
  "Gesucht wird nach ID, ELO-Name ('Nachname, Vorname'), Windows-Name (mit oder ohne Domaene) oder Mail. " +
  "doppelte=true listet stattdessen alle Windows-Namen und Mails, die an mehr als einem Konto stehen - zwei Konten mit demselben Windows-Namen lassen die SSO-Anmeldung scheitern. Ein Aufruf holt dafuer die Benutzerliste einmal.",
  { benutzer: { type: "string", description: "ID, ELO-Name, Windows-Name oder Mail" },
    doppelte: { type: "boolean", description: "Alle doppelten Windows-Namen und Mails im Archiv auflisten" } },
  [], function (a) {
    if (a.doppelte) {
      var all = alleBenutzer(), dw = doppelte(all, PROP_OS), dm = doppelte(all, PROP_MAIL);
      return { benutzerGeprueft: all.length, doppelteWindowsNamen: dw, doppelteMails: dm,
               hinweis: dw.length ? "Konten mit gleichem Windows-Namen: SSO-Anmeldung scheitert. Am nicht genutzten Konto den Windows-Namen leeren (elo_user_set_login)." : "Keine doppelten Windows-Namen." };
    }
    if (!trim(a.benutzer)) fail("benutzer oder doppelte=true angeben.");
    var f = benutzerFinden(a.benutzer), u = f.u, all = f.alle || alleBenutzer(), res = uKurz(u);
    res.guid = uProp(u, IXC.UserInfoC.PROP_GUID) || undefined;
    var gs = allGroups(u); res.gruppen = [];
    for (var i = 0; i < gs.length; i++) res.gruppen.push({ id: S(gs[i].info.getId()), name: S(gs[i].info.getName()), verschachtelt: gs[i].ueber });
    var gw = andereMit(all, u, res.windowsName, PROP_OS), gm = andereMit(all, u, res.mail, PROP_MAIL);
    if (gw.length) { res.gleicherWindowsName = gw; res.warnung = "Weitere Konten tragen denselben Windows-Namen - die SSO-Anmeldung ist nicht eindeutig."; }
    if (gm.length) res.gleicheMail = gm;
    if (f.mehrdeutig) { res.weitereTreffer = []; for (var j = 1; j < f.mehrdeutig.length; j++) res.weitereTreffer.push(uKurz(f.mehrdeutig[j])); }
    return res;
  });

function benutzerSichern(u, suffix) {
  var f = new java.io.File(sicherungsOrdner(), "benutzer-" + S(u.getId()) + "-" + zeitstempel() + suffix + ".json");
  var p = u.getUserProps(), props = [];
  for (var i = 0; p && i < p.length; i++) props.push(p[i] === null ? null : S(p[i]));
  var gl = u.getGroupList(), gruppen = [];
  for (var j = 0; gl && j < gl.length; j++) gruppen.push(S(gl[j]));
  var daten = { id: S(u.getId()), name: S(u.getName()), typ: uTyp(u), flags: u.getFlags(), flags2: u.getFlags2(), userProps: props, gruppen: gruppen };
  var w = new java.io.OutputStreamWriter(new java.io.FileOutputStream(f), "UTF-8");
  try { w.write(JSON.stringify(daten, null, 1)); } finally { w.close(); }
  return S(f.getAbsolutePath());
}

function loginPlan(a) {
  if (a.windowsName === undefined && a.mail === undefined) fail("windowsName und/oder mail angeben (leere Zeichenkette = leeren).");
  var who = trim(a.benutzer), u;
  if (!who) fail("benutzer ist leer.");
  try { u = ELO.ix().checkoutUser(who, IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO); }
  catch (e) { fail("Benutzer nicht gefunden: " + who + ". Hier nur ID oder ELO-Name - Windows-Name und Mail sind ja gerade das, was sich aendert. Suche mit elo_user."); }
  if (u.getType() !== IXC.UserInfoC.TYPE_USER) fail(S(u.getName()) + " ist eine Gruppe, kein Benutzer.");
  var bisher = { windowsName: uProp(u, PROP_OS), mail: uProp(u, PROP_MAIL) };
  var neu = { windowsName: a.windowsName === undefined ? bisher.windowsName : trim(a.windowsName),
              mail: a.mail === undefined ? bisher.mail : trim(a.mail) };
  if (neu.windowsName === bisher.windowsName && neu.mail === bisher.mail) fail("Keine Aenderung: Werte stehen schon so am Konto.");
  if (neu.mail && !/^[^@\s]+@[^@\s]+$/.test(neu.mail)) fail("mail sieht nicht wie eine Mailadresse aus: " + neu.mail);
  var all = alleBenutzer(), warn = [];
  if (neu.windowsName && neu.windowsName !== bisher.windowsName) {
    var gw = andereMit(all, u, neu.windowsName, PROP_OS);
    if (gw.length) fail("Windows-Name " + neu.windowsName + " steht schon an " + gw[0].name + " (ID " + gw[0].id + "). Zwei Konten mit demselben Windows-Namen lassen die SSO-Anmeldung scheitern. Erst dort leeren.");
  }
  if (neu.mail && neu.mail.toLowerCase() !== bisher.mail.toLowerCase()) {
    var gm = andereMit(all, u, neu.mail, PROP_MAIL);
    if (gm.length) warn.push("Mail " + neu.mail + " steht auch an " + gm[0].name + " (ID " + gm[0].id + ").");
  }
  if (!neu.windowsName && bisher.windowsName) warn.push("Ohne Windows-Namen meldet sich dieses Konto nicht mehr per SSO an.");
  warn.push("Ein AD-Abgleich (LDAP-Synchronisation) kann Windows-Name und Mail wieder setzen.");
  var p = u.getUserProps(), pa = [];
  for (var i = 0; p && i < p.length; i++) pa.push(p[i] === null ? null : S(p[i]));
  var fp = JSON.stringify([S(u.getName()), pa, u.getFlags(), u.getFlags2()]);
  return { u: u, bisher: bisher, neu: neu, warn: warn, fp: fp,
           vorschau: { aktion: "Windows-Name/Mail am Benutzerkonto setzen", benutzer: S(u.getName()), id: S(u.getId()),
                       letzteAnmeldung: S(u.getLastLoginIso()), bisher: bisher, neu: neu } };
}

tool("elo_user_set_login",
  "Setzt oder leert Windows-Anmeldename (fuer SSO) und/oder Mail an einem ELO-Benutzerkonto (zweistufig, Stufe 3 bauen, Sicherung vorher). " +
  "Typischer Fall: zwei Konten tragen denselben Windows-Namen, die SSO-Anmeldung scheitert - am nicht genutzten Konto windowsName='' setzen. " +
  "Nicht angegebene Werte bleiben, leere Zeichenkette leert. Ein Windows-Name, der schon an einem anderen Konto steht, wird abgelehnt. Rechte, Gruppen, Name und Passwort bleiben unberuehrt.",
  { benutzer: { type: "string", description: "ID oder ELO-Name des Kontos ('Nachname, Vorname')" },
    windowsName: { type: "string", description: "Neuer Windows-Anmeldename, z. B. 'DOMAENE\\name'; '' leert" },
    mail: { type: "string", description: "Neue Mailadresse; '' leert" },
    token: P_TOKEN },
  ["benutzer"], function (a) {
    bauenPruefen();
    return zweiSchritte("elo_user_set_login", a, function () {
      var p = loginPlan(a);
      return { vorschau: p.vorschau, warnungen: p.warn, fp: p.fp };
    }, function () {
      var p = loginPlan(a), id = S(p.u.getId());
      var u = ELO.ix().checkoutUsers([id], IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.YES)[0];
      var vorher = benutzerSichern(u, "-vorher");
      try {
        var props = u.getUserProps();
        if (!props || props.length <= PROP_MAIL) { var np = java.lang.reflect.Array.newInstance(java.lang.String, IXC.UserInfoC.MAX_USERPROP); for (var i = 0; props && i < props.length; i++) np[i] = props[i]; props = np; }
        props[PROP_OS] = p.neu.windowsName; props[PROP_MAIL] = p.neu.mail;
        u.setUserProps(props);
        ELO.ix().checkinUsers([u], IXC.CheckinUsersC.WRITE, IXC.LockC.YES);
      } catch (e) {
        try { ELO.ix().checkinUsers([u], IXC.CheckinUsersC.NOTHING, IXC.LockC.YES); } catch (e2) { /* Sperre ggf. schon frei */ }
        throw e;
      }
      var ist = ELO.ix().checkoutUser(id, IXC.CheckoutUsersC.BY_IDS_RAW, IXC.LockC.NO);
      var istW = { windowsName: uProp(ist, PROP_OS), mail: uProp(ist, PROP_MAIL) };
      var gleich = istW.windowsName === p.neu.windowsName && istW.mail === p.neu.mail;
      return { benutzer: S(ist.getName()), id: id, bisher: p.bisher, jetzt: istW, rueckgelesen: gleich ? "ok, wie geplant" : "ABWEICHUNG",
               soll: gleich ? undefined : p.neu, sicherungVorher: vorher, sicherungNachher: benutzerSichern(ist, "-nachher"),
               hinweis: "Wirkt bei der naechsten Anmeldung des Benutzers. Zuruecknehmen: dasselbe Werkzeug mit den Werten aus 'bisher'." };
    });
  }, 3);
