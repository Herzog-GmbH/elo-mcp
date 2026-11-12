# Änderungen

## 0.9.0 – 2026-11-12

- **Benutzerkonten**, zwei neue Werkzeuge (jetzt 30):
  - `elo_user` (Stufe 1): Konto mit Windows-Anmeldename (Eigenschaft `PROP_NAME_OS`, daran hängt die SSO-Anmeldung), Mail, letzter Anmeldung und Gruppen. Sucht nach ID, ELO-Name, Windows-Name (mit oder ohne Domäne) oder Mail und nennt andere Konten mit demselben Windows-Namen bzw. derselben Mail. `doppelte=true` listet alle doppelten Windows-Namen und Mails im Archiv (ein Abruf der Benutzerliste).
  - `elo_user_set_login` (Stufe 3): Windows-Name und/oder Mail an einem Konto setzen oder leeren. Anlass: Zwei Konten mit demselben Windows-Namen lassen die SSO-Anmeldung scheitern. Ein Windows-Name, der schon an einem anderen Konto steht, wird abgelehnt, Gruppen ebenso. Vorschau und Token, Sicherung als JSON vorher und nachher, zurücklesen. Rechte, Gruppen, Name und Passwort bleiben unberührt.
- **Rechte und Vertretungen**, vier neue Werkzeuge (jetzt 34), Anlass: Vertretung in der Buchhaltung, bei der ein Recht an einem Knopf fehlte:
  - `elo_acl` (Stufe 1): Rechte eines Eintrags; mit `benutzer` die wirksamen Rechte je Person mit Herkunft (direkt, über Gruppe, geerbt vom Elternordner, als Eigentümer; Schlüssel und Beteiligte werden gemeldet, nicht geraten); mit `unterordner` die Ordner eine Ebene darunter, bei mehreren Personen nur die Abweichungen.
  - `elo_acl_set` (Stufe 3): Rechte eines einzelnen Eintrags setzen, `wie` eine andere Person oder `entfernen`. Nicht rekursiv. Vorschau und Token, Sicherung vorher und nachher, zurücklesen, Warnung bei Verlust des eigenen P-Rechts.
  - `elo_substitutions` (Stufe 1): Vertretungen einer Person in beide Richtungen, mit `aktivJetzt`.
  - `elo_substitution_set` (Stufe 3): Vertretung mit Zeitraum anlegen oder beenden. Falle: `deactivateSubstitution` lehnt ELO bei zeitgesteuerten Vertretungen ab (ELOIX:5071), und Zeiträume gelten tageweise; Beenden kürzt deshalb auf gestern und lässt heute beginnende Zeiträume weg. Gelöscht wird nichts.
- Offline-Test um Benutzer-, Rechte- und Vertretungsprüfungen erweitert.

## 0.8.0 – 2026-11-11

- **Stichwortlisten** (Pull Request #1), zwei neue Werkzeuge (jetzt 28):
  - `elo_keywords` (Stufe 1): Liste einer Feldgruppe lesen, Einträge als Baum, auf Wunsch mit IDs.
  - `elo_keywords_set` (Stufe 3): Liste anlegen oder Einträge ergänzen bzw. ersetzen, Unterlisten, Anzeigename und Paket. Vorschau und Token, Sicherung als JSON vorher und nachher, zurücklesen und vergleichen. IDs nach ELO-Schema `<Liste>¶.AA` (siehe `docs/FALLEN.md`).
  - Die Listen-ID wird wie die Feldgruppe in Großbuchstaben gesetzt (`aw_sign_status` → `AW_SIGN_STATUS`); `elo_keywords` liest eine Liste mit anderer Schreibweise zur Not wie angegeben.
  - Als „neu“ gilt eine Liste nur, wenn der Indexserver sie nicht kennt (`ELOIX:5023`). Andere Fehler beim Holen (Verbindung, Rechte, Sitzung) brechen ab, statt eine vorhandene Liste als neu zu planen.
- `elo_mask_create`: neuer Schalter `ohneFelder` legt eine Maske ohne Felder an (nur Rechte, Art und Reiter des Vorbilds). Vorher kopierte eine leere `felder`-Liste alle Felder, eine Maske ohne Felder ging nicht. Felder danach mit `elo_mask_fields`.
- Offline-Test um Stichwort- und `ohneFelder`-Prüfungen erweitert (102/123/129 Prüfungen).

## 0.7.0 – 2026-11-10

- **Verschlagwortungsmasken** lesen und bauen, vier neue Werkzeuge (jetzt 26):
  - `elo_mask` (Stufe 1): Art, Reiter samt Namen, alle Felder in Maskenreihenfolge mit Typ, Reiter, Zeile, Spalten, Länge, Pflicht und Rechten, dazu eine Layout-Prüfung.
  - `elo_mask_create` (Stufe 3): neue Maske als Kopie einer vorhandenen, alle oder ausgewählte Felder, andere Anzeigenamen und Reiter, Dokument-, Ordner- oder reine Suchmaske.
  - `elo_mask_fields` (Stufe 3): Felder hinten anhängen (nächste freie Zeile oder direkt unter einem Feld) oder vorhandene ändern (Name, Typ, Länge, Spalte, nur Stichwortliste, Pflicht, Rechte).
  - `elo_mask_tabs` (Stufe 3): Reiter benennen, Felder auf einen anderen Reiter oder Platz verschieben, Zeilen lückenlos ordnen.
- Fest eingebaute Regeln aus echten Störungen: Reiter mit Namen, Reiter 0 ab Zeile 4, Rechte an jeder Zeile, Eingabefeld nach der Beschriftung, keine Klammern im Anzeigenamen, Reihenfolge der Zeilen bleibt, IDs 50 bis 59 frei. Details in `docs/FALLEN.md`.
- Wie beim übrigen Bauen: Vorschau und Einmal-Token, Sicherung der Maske als JSON vorher und nachher unter `%LOCALAPPDATA%\elo-mcp\sicherung`, nach dem Speichern zurücklesen und vergleichen. Löschen gibt es nicht.
- Offline-Test mit Maskenprüfungen (86/106/112 Prüfungen).

## 0.6.0 – 2026-10-18

- **Zwei Archive in einem Eintrag**, z. B. Produktiv und Test: `-IxUrl2` mit `-Name`/`-Name2` (Kurznamen), `-Schreiben2`, `-Bauen2`, `-CredentialFile2`, `-Archiv2`. Im Paket für Claude Desktop als „Archiv 2" in den Einstellungen.
- Jedes Werkzeug hat dann den Parameter `archiv`, ohne Angabe gilt das erste Archiv. Die Hinweise an die KI nennen beide Archive mit ihren Stufen, Schreib- und Bauwerkzeuge sagen, in welchem Archiv sie gehen.
- Je Archiv ein eigener Java-Prozess mit eigenen Zugangsdaten und Stufen: Verbindungen, Zwischenspeicher und Tokens mischen sich nicht. Ein Token aus der Vorschau gilt nur im Archiv der Vorschau. Java startet je Archiv erst beim ersten Aufruf.
- `elo_whoami`, Vorschau, Ergebnis und Protokoll nennen das Archiv.
- Der Schlüssel des Zwischenspeichers umfasst jetzt auch `elo-mcp.ps1`.
- Offline-Test mit drittem Lauf „zwei Archive" (50/68/74 Prüfungen).

## 0.5.0 – 2026-10-18

- MCPB-Paket (MCP Bundle) für Claude Desktop: `elo-mcp-<version>.mcpb` aus dem GitHub-Release per Doppelklick installieren, IX-URL und Stufen in den Einstellungen der Erweiterung. Zugangsdaten bleiben bei `Set-EloCredential.ps1`, die ELO-Bibliotheken kommen weiter aus dem installierten Client.
- `mcpb\manifest.json`, Startskript `mcpb\mcpb-start.ps1` (Einstellungen → Schalter von `elo-mcp.ps1`) und `tools\build-mcpb.ps1` (baut reproduzierbar, prüft Version und ASCII, trägt SHA-256 in `server.json` ein).
- `server.json` für die offizielle MCP Registry (`io.github.Herzog-GmbH/elo-mcp`, Paket `mcpb`).
- `test\test-mcpb.py`: startet das gebaute Paket so, wie Claude Desktop es startet, und ruft Werkzeuge auf.

## 0.4.0 – 2026-10-18

Erste öffentliche Fassung.

- 22 Werkzeuge in drei Stufen: 13 lesende (immer an), 6 schreibende (`-Schreiben`), 3 bauende (`-Bauen`).
- Nicht freigeschaltete Werkzeuge stehen nicht in `tools/list` und werden beim Aufruf abgelehnt.
- Schreiben und Bauen zweistufig mit Vorschau und Einmal-Token, lokales Protokoll.
- Bauplan-Prüfungen für Workflow-Vorlagen, Syntax- und Include-Prüfung für ELOas-Regeln und IX-Skripte.
- Vorschalt in Windows PowerShell: Java erst beim ersten Werkzeugaufruf, Ende nach Leerlauf.
- Einstellbar: IX-URL, Zugangsdatei, Client-Ordner, Archivname, Datumsregel für Textfelder.
- Getestet gegen Indexserver 25.00 mit dem ELO Client 25 und dem ELO Java Client. Gesucht wird zuerst `ELO Client`, dann `ELO Java Client`.
- Offline-Test (`test\offline.ps1`, auch Vorschau und Token: einmal benutzbar, Ablauf, Argumente, veränderte Objekte) und Live-Test (`test\test-mcp.py`).
