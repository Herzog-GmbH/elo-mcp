<div align="center">

# ELO-MCP-Server

**ELO für jede KI: suchen, lesen, ablegen, Workflows steuern und bauen, mit den Rechten des eigenen ELO-Kontos.**

[![Getestet mit ELO 25](https://img.shields.io/badge/getestet%20mit-ELO%2025%20(IX%2025.00)-0067b8)](#voraussetzungen)
[![MCP stdio](https://img.shields.io/badge/MCP-stdio-6f42c1)](https://modelcontextprotocol.io/)
[![26 Werkzeuge](https://img.shields.io/badge/Werkzeuge-26-2ea44f)](#werkzeuge)
[![Vorschau und Token](https://img.shields.io/badge/Schreiben-Vorschau%20%2B%20Token-e36209)](#sicherheit)
<br>
[![Windows](https://img.shields.io/badge/Plattform-Windows-0078d4)](#voraussetzungen)
[![Lizenz MIT](https://img.shields.io/github/license/Herzog-GmbH/elo-mcp?label=Lizenz&color=blue)](LICENSE)

[Schnellstart](#schnellstart) · [Werkzeuge](#werkzeuge) · [Sicherheit](#sicherheit) · [Clients](docs/CLIENTS.md) · [Bauplan](docs/BAUPLAN.md) · [IX-Fallen](docs/FALLEN.md)

</div>

> [!NOTE]
> **English:** MCP server for the ELO ECM Suite (ELO Digital Office). Runs locally next to the ELO Client (ELO 25) or ELO Java Client and signs in with the user's own ELO account, so ELO enforces that user's permissions. Beyond search and text extraction it can file documents, set index fields, start and forward workflows, and (optionally) build workflow templates and ELOas rules/IX scripts with syntax checks. Every write is a two-step preview + one-time token. Docs are in German because ELO's user base is mostly DACH; issues in English are welcome.

Ein [MCP](https://modelcontextprotocol.io/)-Server für das **ELO ECM** der ELO Digital Office GmbH. Ihr fragt in normaler Sprache, etwa „Zeig mir die offenen Aufgaben zu Rechnung 4711" oder „Bau mir eine Freigabe-Vorlage mit zwei parallelen Prüfern", und die KI arbeitet direkt mit eurem Archiv.

## Auf einen Blick

- **Jeder MCP-Client:** Claude Code, Claude Desktop, Codex, GitHub Copilot, Gemini CLI, Cursor, … ([docs/CLIENTS.md](docs/CLIENTS.md))
- **Rechte je Person:** Der Server läuft lokal beim Anwender und meldet sich mit dessen eigenem ELO-Konto an. ELO prüft jeden Zugriff selbst. Kein Dienstkonto, kein Nachbau von Rechten.
- **Mehr als Suchen:** Volltext- und Feldsuche, Textauszug aus PDF/Office/E-Mail, wirksame Rechte mit Herkunft, Workflows lesen, starten und weiterleiten.
- **Bauen mit Prüfungen:** Workflow-Vorlagen als JSON-Bauplan exportieren, ändern und zurückschreiben. ELOas-Regeln, IX-Skripte und Formularseiten hochladen, vorher kompiliert und auf bekannte Fallen geprüft. Verschlagwortungsmasken anlegen und erweitern, mit Regeln für Reiter, Zeilen und Rechte.
- **Drei Stufen:** Lesen ist immer an. Schreiben (`-Schreiben`) und Bauen (`-Bauen`) schaltet ihr einzeln frei. Ohne Schalter sieht die KI die Werkzeuge gar nicht.
- **Zweistufig schreiben:** Jede Änderung liefert zuerst eine Vorschau und ein Einmal-Token. Erst ein zweiter Aufruf mit Token führt aus.
- **Schonend für den Indexserver:** eine Anfrage zur Zeit, harte Obergrenzen, keine Massenabfragen über Workflows.
- **Keine zusätzlichen Downloads:** nutzt Java, Rhino, IX-Client-Bibliothek, PDFBox und POI aus dem installierten ELO Client bzw. ELO Java Client.

## Voraussetzungen

| | Getestet bzw. vorausgesetzt |
|---|---|
| **ELO-Server** | Indexserver 25.00 (ELO 25). Ältere Versionen mit Java-API sollten gehen, sind aber nicht geprüft. |
| **ELO Client** | installiert auf dem Rechner, auf dem die KI läuft: der **ELO Client 25** oder der ältere **ELO Java Client**. Getestet gegen Indexserver 25.00 mit dem ELO Client 25 (IX-Client-Bibliothek 25.00, Rhino 1.9, PDFBox 3) und mit dem ELO Java Client (IX-Client-Bibliothek 20.09). Gesucht wird unter `Programme\ELO Client`, dann `Programme\ELO Java Client`, sonst `-ClientDir`. |
| **Windows** | Windows 10/11 mit **Windows PowerShell 5.1** (`powershell.exe`). PowerShell 7 reicht nicht, der Vorschalt braucht `System.Web.Extensions`. |
| **ELO-Konto** | ein normales Benutzerkonto. Die KI kann genau das, was das Konto darf. |
| **Zertifikat** | Bei `https` muss das Server-Zertifikat im Windows-Zertifikatsspeicher vertrauenswürdig sein (Java nutzt `Windows-ROOT`). |

> [!IMPORTANT]
> Jede Sitzung baut eine eigene IX-Verbindung mit eurem Konto auf (Client-Name `elo-mcp`). Ob das bei euch eine zusätzliche ELO-Lizenz belegt, klärt bitte mit eurem ELO-Partner.

## Schnellstart

1. **Holen**, z. B. nach `C:\Tools\elo-mcp`:
   ```powershell
   git clone https://github.com/Herzog-GmbH/elo-mcp.git C:\Tools\elo-mcp
   ```
2. **Zugangsdaten hinterlegen**, einmalig und selbst im Terminal (nicht von der KI eintippen lassen). Das Passwort wird per DPAPI für euer Windows-Konto verschlüsselt:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Tools\elo-mcp\Set-EloCredential.ps1
   ```
3. **Prüfen**, ohne ELO-Verbindung:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Tools\elo-mcp\test\offline.ps1
   ```
4. **Eintragen**, hier in Claude Code (andere Clients: [docs/CLIENTS.md](docs/CLIENTS.md)). Die IX-URL steht im Anmeldeprofil des ELO Java Client oder kommt von eurem ELO-Administrator:
   ```powershell
   claude mcp add elo --scope user -- powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Tools\elo-mcp\elo-mcp.ps1" -IxUrl "https://elo.example.com:9093/ix-Archiv/ix"
   ```
5. **Testen:** In einer neuen Sitzung „Wer bin ich in ELO?" fragen. Das ruft `elo_whoami` auf und zeigt Konto, Server, IX-Version und freigeschaltete Stufen.

Ihr wollt, dass eure KI das selbst einrichtet? Gebt ihr diesen Satz: *„Richte den ELO-MCP-Server nach der AGENTS.md in diesem Ordner ein."*

### Claude Desktop: als Paket installieren

Für Claude Desktop gibt es den Server auch als Paket (MCPB), ohne Git und ohne Konfigurationsdatei:

1. Aus dem [neuesten Release](https://github.com/Herzog-GmbH/elo-mcp/releases/latest) `elo-mcp-<version>.mcpb` und `Set-EloCredential.ps1` laden.
2. **Zugangsdaten hinterlegen**, selbst im Terminal:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\Set-EloCredential.ps1"
   ```
3. In Claude Desktop unter **Einstellungen → Erweiterungen → Erweiterte Einstellungen → Erweiterung installieren** (Settings → Extensions → Advanced settings → Install Extension) die `.mcpb`-Datei wählen.
4. **IX-URL** eintragen. Schreiben und Bauen nur bei Bedarf einschalten. Zugangsdatei und Client-Ordner bleiben leer, solange ihr die Standards nutzt. Für ein zweites Archiv (z. B. Test) die Felder „Archiv 2“ ausfüllen und beiden Archiven einen Kurznamen geben, siehe [Zwei Archive](#zwei-archive).
5. In einem neuen Chat „Wer bin ich in ELO?" fragen.

Im Paket stecken nur die Skripte aus diesem Repo (rund 70 KB). Java und die ELO-Bibliotheken kommen wie sonst aus dem installierten ELO Client. Für ein Update installiert ihr einfach die neue `.mcpb`.

## Schalter

Alle Schalter stehen hinter dem Skriptpfad in der Client-Konfiguration.

| Schalter | Wirkung |
|---|---|
| `-IxUrl <url>` | IX-URL des ELO-Servers (Pflicht, alternativ Umgebungsvariable `ELO_IX_URL`) |
| `-Schreiben` | Stufe 2 freischalten: ablegen, neue Version, Indexfelder, Workflow starten, Aufgabe weiterleiten |
| `-Bauen` | Stufe 3 freischalten: Workflow-Vorlagen, Skripte, ELOas-Regeln, Formularseiten, Verschlagwortungsmasken. **Am besten nur gegen ein Testarchiv.** |
| `-CredentialFile <pfad>` | andere Zugangsdaten, z. B. ein zweites Konto für das Testarchiv. Standard `%LOCALAPPDATA%\elo-mcp\elo-credential.xml` |
| `-ClientDir <pfad>` | Ordner des ELO Client bzw. ELO Java Client, wenn er nicht unter `Programme` liegt |
| `-Archiv "<name>"` | Name des Archivs in den Hinweisen an die KI, z. B. `"der Muster GmbH (Test)"` |
| `-TextDatumJJJJMMTT` | Hausregel mancher Archive: Textfelder, deren Name auf `DAT`/`DATUM` endet, bekommen Datumsangaben als `JJJJMMTT` |
| `-LeerlaufMinuten <n>` | Java nach so vielen Minuten ohne Aufruf beenden (Standard 10, nicht unter 5) |
| `-Direkt` | ohne Vorschalt, Java sofort starten (Rückfall bei Problemen, nur ein Archiv) |
| `-IxUrl2 <url>` | zweites Archiv, z. B. das Testarchiv (siehe unten) |
| `-Name <name>`, `-Name2 <name>` | Kurznamen der beiden Archive für den Parameter `archiv`, z. B. `Produktiv` und `Test` (Standard `1` und `2`) |
| `-Schreiben2`, `-Bauen2` | Stufen nur für das zweite Archiv |
| `-CredentialFile2 <pfad>`, `-Archiv2 "<name>"` | Zugangsdaten (Standard: dieselben wie fürs erste) und Archivname für das zweite Archiv |

### Zwei Archive

Ein Eintrag kann zwei Archive bedienen, z. B. Produktiv nur lesend und Test mit allen Stufen:

```powershell
claude mcp add elo --scope user -- powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Tools\elo-mcp\elo-mcp.ps1" -IxUrl "https://elo.example.com:9093/ix-Archiv/ix" -Name Produktiv -IxUrl2 "https://elo-test.example.com:9093/ix-Archiv/ix" -Name2 Test -Schreiben2 -Bauen2
```

- Jedes Werkzeug hat dann den Parameter `archiv` (`Produktiv` oder `Test`). Ohne Angabe gilt das erste Archiv. Ihr sagt der KI einfach „im Test“ oder „in Produktiv“.
- Die Stufen gelten je Archiv. Im Beispiel kann die KI in Produktiv nichts ändern, auch wenn sie es versucht. Schreib- und Bauwerkzeuge sagen in ihrer Beschreibung, in welchem Archiv sie gehen.
- Jedes Archiv läuft in einem eigenen Java-Prozess, der erst beim ersten Aufruf startet. Verbindungen, Zwischenspeicher und Tokens mischen sich nicht. Ein Token aus einer Vorschau im Test wirkt nie in Produktiv.
- `elo_whoami`, jede Vorschau und das Protokoll nennen das Archiv. Objekt-IDs, Masken und Vorlagen gelten nur im jeweiligen Archiv.

## Werkzeuge

### Stufe 1: lesen (immer an)

| Werkzeug | Zweck |
|---|---|
| `elo_whoami` | Konto, Server, IX-Version, freigeschaltete Stufen |
| `elo_search` | iSearch über Titel, Volltext und Indexfelder, optional auf einen Ordner samt Unterordnern begrenzt, höchstens 50 Treffer |
| `elo_find_by_fields` | Datenbanksuche über Maske und Indexfelder, Platzhalter `*`. Ohne Feld oder Namen abgelehnt |
| `elo_list` | Ordnerinhalt, eine Ebene, höchstens 300 |
| `elo_get_object` | Metadaten, Indexfelder mit Bezeichnung, Pfad, aktuelle Version, `elodms://`-Link |
| `elo_get_versions` | Versionsliste, neueste zuerst |
| `elo_get_text` | Text aus PDF (mit Textebene), DOCX, XLSX, PPTX, XLS, EML und Textdateien, höchstens 50.000 Zeichen je Aufruf, Weiterlesen mit `abZeichen` |
| `elo_user_rights` | Wirksame Funktionsrechte eines Benutzers mit Herkunft (direkt oder über welche Gruppe, auch verschachtelt) |
| `elo_workflow_templates` | Alle Workflow-Vorlagen |
| `elo_workflow` | Vorlage oder laufender/beendeter Workflow im Detail: Knoten, Bearbeiter, Skripte, Formular, JSON-Konfiguration, Verbindungen |
| `elo_workflows_of_object` | Laufende (mit aktiven Knoten) oder beendete Workflows zu genau einem Objekt |
| `elo_my_tasks` | Eigene Aufgaben, auch über Gruppen |
| `elo_workflow_export` | Vorlage als JSON-Bauplan ([Format](docs/BAUPLAN.md)) |
| `elo_mask` | Verschlagwortungsmaske: Art, Reiter, alle Felder mit Typ, Reiter, Zeile, Spalten, Länge, Pflicht und Rechten. Dazu eine Layout-Prüfung (Reiter ohne Namen, Felder vor Zeile 4, übereinanderliegende Felder, Felder ohne Rechte, Klammern) |

### Stufe 2: arbeiten (`-Schreiben`)

| Werkzeug | Zweck |
|---|---|
| `elo_create_folder` | Ordner anlegen (nur Ordnermasken), warnt bei gleichem Namen und leeren Pflichtfeldern |
| `elo_create_document` | Lokale Datei als Dokument ablegen (nur Dokumentmasken), höchstens 50 MB |
| `elo_new_version` | Neue Version. Lehnt eine identische Datei ab, warnt bei anderer Endung |
| `elo_set_fields` | Indexfelder und Kurzbezeichnung setzen, Vorschau bisher → neu |
| `elo_start_workflow` | Workflow aus Vorlage starten, warnt, wenn dieselbe Vorlage schon läuft |
| `elo_forward_task` | Aufgabe weiterleiten. Bei mehreren Nachfolgern Pflichtangabe. Knoten mit Formular nur mit `trotzFormular`, weil Formularprüfungen über die API nicht laufen |

Feldwerte werden vorher gegen die Maske geprüft: Feld vorhanden, Länge, Zahl, Datum (31.02. wird abgelehnt), Stichwortliste bei „nur Liste". Datumsfelder schreibt der Server im ELO-Format `JJJJMMTT000000`.

### Stufe 3: bauen (`-Bauen`)

| Werkzeug | Zweck |
|---|---|
| `elo_workflow_build` | Vorlage aus Bauplan anlegen oder ersetzen (ID und Name bleiben). Vorschau mit Änderungsliste, Sicherung `.ewf` vorher und nachher |
| `elo_script_update` | Neue Version eines Dokuments unter `Administration` (ELOas-Regel, IX-Skript, Formularseite …), Vorschau mit Zeilenvergleich, Kodierung bleibt |
| `elo_script_create` | Neues Dokument unter `Administration`, Maske, Rechte und Typ vom Vorbild |
| `elo_mask_create` | Neue Verschlagwortungsmaske als Kopie einer vorhandenen: alle oder ausgewählte Felder, andere Anzeigenamen und Reiter, Dokument-, Ordner- oder reine Suchmaske |
| `elo_mask_fields` | Felder hinten anhängen (nächste freie Zeile oder direkt unter einem Feld) oder vorhandene ändern: Name, Typ, Länge, Spalte, nur Stichwortliste, Pflicht, Rechte |
| `elo_mask_tabs` | Reiter benennen, Felder auf einen anderen Reiter oder Platz verschieben, Zeilen lückenlos ordnen |

Die Prüfungen beim Bauen stammen alle aus echten Störungen:

- **Workflows:** genau ein Start, mindestens ein Ende, alle Kanten auf vorhandene Knoten, jeder Knoten erreichbar und mit Weg zum Ende, **jeder Knoten außer Ende hat einen Nachfolger** (sonst bleibt der Vorgang hängen), Entscheidung mit Bedingung, **Sammler mit festem Zähler** (0 leitet beim ersten Vorgänger weiter, -1 bleibt nach übersprungenen IF-Zweigen hängen), Bearbeiter und Formulare existieren.
- **ELOas-Regeln:** XML wohlgeformt, jeder Skriptteil wird mit Rhino kompiliert.
- **IX-Skripte:** kompiliert, jeder `//@include` ist auflösbar, `@include` steht nur in den Kopfzeilen, nur ASCII. Ein nicht auflösbarer Include stoppt sonst den **ganzen** Skript-Motor des Indexservers.
- **Masken:** Felder nur auf Reitern mit Namen (sonst „Index1" im Client), auf Reiter 0 ab Zeile 4 (darüber liegen Kurzbezeichnung und Datum), keine übereinanderliegenden Felder, **Rechte an jeder Zeile** (sonst sehen nur Administratoren den Wert), Eingabefeld nach der Beschriftung, keine Klammern im Anzeigenamen, Zeilen-IDs 50 bis 59 frei. Die Reihenfolge der Zeilen bleibt immer, neue Felder kommen hinten dran. Vorher und nachher eine Sicherung als JSON, nach dem Speichern zurücklesen und vergleichen.

Neu laden (ELOas, IX-Skripte), „Aktualisieren" im Formulardesigner und die Neuanmeldung nach einer Maskenänderung bleiben Handarbeit. Das sagt der Server nach jeder Änderung dazu.

## Sicherheit

- **Eigenes Konto:** ELO prüft jeden Zugriff mit den Rechten der angemeldeten Person. Ein zentraler Server bräuchte ein Dienstkonto mit Hauptadministrator-Recht: Die Anmeldung im Namen anderer (`runAsUser`) lehnt der Indexserver für normale Konten ab. Ein solches Konto vermeidet dieser Server bewusst, er läuft lokal mit dem Konto der Person.
- **Zugangsdaten:** per DPAPI verschlüsselt, nur für euer Windows-Konto lesbar. Der Vorschalt entschlüsselt sie erst beim Java-Start und gibt sie nur an den Java-Prozess weiter.
- **Zweistufig:** Erster Aufruf = Prüfung + Vorschau + Token. Das Token gilt 5 Minuten, einmal, nur für exakt dieselben Argumente und nur, wenn sich das Objekt seit der Vorschau nicht verändert hat (Fingerabdruck aus Name, Maske, Indexfeldern, Sperre, Version). Die Hinweise an die KI verlangen, die Vorschau zu zeigen und auf Zustimmung zu warten.
- **Nicht im Code:** Löschen (auch keine Masken und Maskenfelder), Verschieben und Rechte an Objekten ändern. Das ist nicht abgeschaltet, das gibt es schlicht nicht.
- **Protokoll:** Jede Ausführung, auch fehlgeschlagene, steht in `%LOCALAPPDATA%\elo-mcp\protokoll-JJJJ-MM.jsonl` (Zeit, Konto, Server, Werkzeug, Argumente, Ergebnis).
- **Keine Wiederholung beim Schreiben:** Lesewerkzeuge melden sich nach einer abgelaufenen Sitzung einmal neu an. Schreibende nie, damit nichts doppelt passiert.
- **Fremder Text:** Dokumentinhalte (`elo_get_text`) können Anweisungen an die KI enthalten (Prompt-Injection). Lest deshalb jede Vorschau, bevor ihr zustimmt.

## Start und Speicher

MCP-Clients starten jeden Server einmal je Sitzung. Eine JVM je Sitzung kostet rund 650 MB, auch wenn ELO nie gebraucht wird. Deshalb steht `elo-mcp.ps1` als schlanker Vorschalt (rund 75 MB) vor Java:

- `initialize`, `tools/list` und `ping` beantwortet der Vorschalt aus `%LOCALAPPDATA%\elo-mcp\werkzeuge-<hash>.txt`. Nach einer Änderung an Code oder Schaltern holt die erste Sitzung die Liste einmal von Java.
- Java startet erst beim ersten Werkzeugaufruf (2–8 s) und endet nach 10 Minuten ohne Aufruf. Die JVM läuft mit `-XX:+UseSerialGC -Xms32m -XX:TieredStopAtLevel=1` (rund 90–130 MB). Bei zwei Archiven gilt das je Archiv.

## Grenzen

- Nur Windows und nur stdio (kein HTTP-Server). Der Kern unter `src\` läuft überall, wo Rhino und die IX-Client-Bibliothek laufen. Ein Startskript für andere Systeme gibt es noch nicht.
- Kein Text aus `.doc`, `.msg` und Scans ohne Textebene (kein OCR).
- Links nur als `elodms://(GUID)` für den Java Client, noch nicht für den Web Client.
- Beim Bauen nur die Knotentypen 1–6 (Start, Person, Verteiler, Entscheidung, Sammler, Ende). Vorlagen mit Zyklus, Serverübergabe oder Subworkflow lassen sich exportieren, aber nicht zurückschreiben.
- Kein Neuladen von ELOas/IX-Skripten und kein Veröffentlichen.

## Aufbau

| Datei | Zweck |
|---|---|
| `elo-mcp.ps1` | Startskript und Vorschalt |
| `Set-EloCredential.ps1` | Zugangsdaten verschlüsselt hinterlegen |
| `src/elo.js` | IX-Verbindung, Archivpfade |
| `src/elo-mcp.js` | Kern, Protokoll, Textauszug, Stufe 1 |
| `src/elo-mcp-schreiben.js` | Stufe 2, Vorschau/Token, Feldprüfung, Protokoll |
| `src/elo-mcp-bauen.js` | Stufe 3, Bauplan, Skriptprüfungen |
| `src/elo-mcp-masken.js` | Masken lesen (Stufe 1) und bauen (Stufe 3), Layout-Regeln |
| `src/elo-mcp-start.js` | Hauptschleife |
| `test/offline.ps1` | Prüfungen ohne ELO (Protokoll, Stufen, Bauplan, Skripte, Masken) |
| `test/test-mcp.py` | Aufrufe gegen ein echtes ELO, z. B. `python -I test\test-mcp.py test\beispiel-lesen.json -- -IxUrl <url>` |
| `mcpb/` | Paket für Claude Desktop: `manifest.json`, Startskript `mcpb-start.ps1` (Einstellungen → Schalter), Symbol |
| `tools/build-mcpb.ps1` | baut `dist\elo-mcp-<version>.mcpb` und trägt Prüfsumme und Download-URL in `server.json` ein |
| `server.json` | Eintrag für die [MCP Registry](https://registry.modelcontextprotocol.io/) |
| `test/test-mcpb.py` | startet das gebaute Paket wie Claude Desktop, z. B. `python -I test\test-mcpb.py dist\elo-mcp-0.5.0.mcpb -- ix_url=<url>` |

Fallen der IX-API, auf die wir beim Bau gestoßen sind, stehen in [docs/FALLEN.md](docs/FALLEN.md).

## Mitmachen

Issues und Pull Requests sind willkommen, gern auch mit Erfahrungen aus anderen ELO-Versionen. Bitte keine internen Daten (Hostnamen, Benutzer, Objekt-IDs, Mandantennamen) in Issues, Logs oder Testdateien. Vor einem Pull Request `test\offline.ps1` laufen lassen. Sicherheitslücken bitte nicht öffentlich melden, sondern wie in [SECURITY.md](SECURITY.md) beschrieben.

## Lizenz und Marken

MIT, siehe [LICENSE](LICENSE). Ohne Gewähr: Probiert Schreiben und Bauen zuerst an einem Testarchiv aus.

Dies ist kein Produkt der ELO Digital Office GmbH und wird von ihr weder unterstützt noch geprüft. ELO ist eine Marke der ELO Digital Office GmbH. Die ELO-Bibliotheken sind nicht Teil dieses Repos und nicht im Paket. Sie kommen aus eurem lizenzierten ELO Java Client.
