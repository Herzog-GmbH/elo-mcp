# Änderungen

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
