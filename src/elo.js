/*
 * elo.js - Verbindung zum ELO Indexserver fuer den ELO-MCP-Server.
 *
 * Laeuft unter Rhino (org.mozilla.javascript) mit den Jars des ELO Java Client
 * im Klassenpfad. Damit ist die Sprache dieselbe wie bei ELO-Serverskripten und
 * die API identisch zu de.elo.ix.client.
 *
 * Gestartet von elo-mcp.ps1; das setzt Klassenpfad und Umgebung
 * (ELO_IX_URL, ELO_USER, ELO_PASS).
 */

var ELO = (function () {

  var IXConnFactory = Packages.de.elo.ix.client.IXConnFactory;
  var SordC         = Packages.de.elo.ix.client.SordC;
  var FindInfo      = Packages.de.elo.ix.client.FindInfo;
  var FindChildren  = Packages.de.elo.ix.client.FindChildren;

  // ELO-Pfadtrenner: Absatzzeichen U+00B6.
  // Bewusst als Escape geschrieben, damit die Datei-Kodierung keine Rolle spielt.
  var PILCROW = "\u00b6";
  var conn = null;

  function env(name, fallback) {
    var v = java.lang.System.getenv(name);
    return (v === null || String(v) === "") ? fallback : String(v);
  }

  /* Verbindung aufbauen (einmal, danach wiederverwendet). Ohne ELO_USER wird SSO versucht. */
  function connect() {
    if (conn !== null) return conn;

    var url  = env("ELO_IX_URL", null);
    if (url === null) throw { userError: "ELO_IX_URL fehlt (elo-mcp.ps1 -IxUrl https://<server>/ix-<archiv>/ix)." };
    var user = env("ELO_USER", null);
    var pwd  = env("ELO_PASS", null);
    var host = String(java.net.InetAddress.getLocalHost().getHostName());

    var factory = new IXConnFactory(url, "elo-mcp", "1.0");
    conn = (user === null) ? factory.createSso(host)
                           : factory.create(user, pwd, host, null);
    return conn;
  }

  function ix() { return connect().ix(); }

  function close() {
    if (conn !== null) { conn.close(); conn = null; }
  }

  /* Archivpfad in eine ELO-Objektkennung umwandeln.
     path: "Administration/Business Solutions/common" oder mit Pilcrow. */
  function arcpath(path) {
    var p = String(path);
    if (p.indexOf("ARCPATH:") === 0) return p;   // schon fertig
    if (/^\d+$/.test(p)) return p;                // Objekt-ID
    if (/^\(?[0-9A-F]{8}-/i.test(p)) return p;    // GUID
    p = p.replace(/[\/\\]/g, PILCROW);
    if (p.charAt(0) !== PILCROW) p = PILCROW + p;
    return "ARCPATH:" + p;
  }

  /* Direkte Unterobjekte eines Ordners. Gibt ein JS-Array von Sord zurueck. */
  function children(parentId, max) {
    max = max || 5000;
    var fi = new FindInfo();
    var fc = new FindChildren();
    fc.setParentId(String(arcpath(parentId)));
    fc.setEndLevel(1);
    fi.setFindChildren(fc);

    var result = [];
    var fr = ix().findFirstSords(fi, Math.min(max, 500), SordC.mbAllIndex);
    try {
      while (true) {
        var sords = fr.getSords();
        for (var i = 0; i < sords.length && result.length < max; i++) result.push(sords[i]);
        if (!fr.isMoreResults() || result.length >= max) break;
        fr = ix().findNextSords(fr.getSearchId(), result.length, 500, SordC.mbAllIndex);
      }
    } finally {
      try { ix().findClose(fr.getSearchId()); } catch (e) {}
    }
    return result;
  }

  return { PILCROW: PILCROW, connect: connect, ix: ix, close: close, arcpath: arcpath, children: children };
})();
