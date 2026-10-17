# Änderungen

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
