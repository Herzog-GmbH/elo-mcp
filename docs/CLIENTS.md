# MCP-Clients anbinden

Der Server läuft **lokal über stdio**: Der Client startet `elo-mcp.ps1` selbst und spricht über stdin/stdout mit ihm. Jeder Client braucht deshalb nur einen Startbefehl:

| | |
|---|---|
| Befehl | `powershell` (Windows PowerShell 5.1, nicht `pwsh`) |
| Argumente | `-NoProfile -ExecutionPolicy Bypass -File <Pfad>\elo-mcp.ps1 -IxUrl <IX-URL>` und bei Bedarf `-Schreiben`, `-Bauen`, `-Archiv "<name>"` |

Im Folgenden liegt der Server unter `C:\Tools\elo-mcp`, die IX-URL ist `https://elo.example.com:9093/ix-Archiv/ix`. Zugangsdaten stehen in keiner Konfiguration: Die hinterlegt ihr vorher einmal mit `Set-EloCredential.ps1`.

> Konfigurationsformate ändern sich bei den Clients gelegentlich. Funktioniert eine Vorlage nicht, in der Doku des Clients unter „MCP" / „stdio" / „local server" nachsehen. Befehl und Argumente oben bleiben gleich.

Der erste Werkzeugaufruf einer Sitzung startet Java und dauert 2–8 Sekunden. Danach antwortet der Server sofort. Nur der allererste Start nach einer Änderung an Code oder Schaltern dauert rund 10 Sekunden, weil der Vorschalt die Werkzeugliste einmal von Java holt. Bricht ein Client dabei mit Zeitüberschreitung ab, einfach neu verbinden.

## Claude Code
```powershell
claude mcp add elo --scope user -- powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Tools\elo-mcp\elo-mcp.ps1" -IxUrl "https://elo.example.com:9093/ix-Archiv/ix"
```
Zweiter Eintrag für ein Testarchiv mit allen Stufen:
```powershell
claude mcp add elo-test --scope user -- powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Tools\elo-mcp\elo-mcp.ps1" -IxUrl "https://elo-test.example.com:9093/ix-Archiv/ix" -Schreiben -Bauen -Archiv "(Testarchiv)"
```

## Claude Desktop
Am einfachsten als Paket (`elo-mcp-<version>.mcpb` aus dem Release), siehe [README](../README.md#claude-desktop-als-paket-installieren). Die IX-URL und die Stufen stellt ihr dann in den Einstellungen der Erweiterung ein, Pfade am besten über „Durchsuchen". Meldet Claude Desktop „Verbindung zum Erweiterungs-Server nicht möglich", steht der Grund in `mcp-server-ELO-MCP-Server.log` im Log-Ordner von Claude Desktop.

Von Hand in `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "elo": {
      "command": "powershell",
      "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Tools\\elo-mcp\\elo-mcp.ps1",
               "-IxUrl", "https://elo.example.com:9093/ix-Archiv/ix"]
    }
  }
}
```

## OpenAI Codex CLI
`%USERPROFILE%\.codex\config.toml` (einfache Anführungszeichen, damit die Backslashes bleiben):
```toml
[mcp_servers.elo]
command = "powershell"
args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", 'C:\Tools\elo-mcp\elo-mcp.ps1', "-IxUrl", "https://elo.example.com:9093/ix-Archiv/ix"]
```

## VS Code / GitHub Copilot (Agent-Modus)
`.vscode/mcp.json` im Arbeitsordner oder in der Benutzerkonfiguration:
```json
{
  "servers": {
    "elo": {
      "type": "stdio",
      "command": "powershell",
      "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Tools\\elo-mcp\\elo-mcp.ps1",
               "-IxUrl", "https://elo.example.com:9093/ix-Archiv/ix"]
    }
  }
}
```

## Cursor
`%USERPROFILE%\.cursor\mcp.json`:
```json
{
  "mcpServers": {
    "elo": {
      "command": "powershell",
      "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Tools\\elo-mcp\\elo-mcp.ps1",
               "-IxUrl", "https://elo.example.com:9093/ix-Archiv/ix"]
    }
  }
}
```

## Gemini CLI
`%USERPROFILE%\.gemini\settings.json`:
```json
{
  "mcpServers": {
    "elo": {
      "command": "powershell",
      "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Tools\\elo-mcp\\elo-mcp.ps1",
               "-IxUrl", "https://elo.example.com:9093/ix-Archiv/ix"]
    }
  }
}
```

## Andere Clients
- **Mit stdio-Unterstützung:** Befehl und Argumente von oben eintragen.
- **Nur entfernte Server (HTTP):** Das geht mit diesem Server nicht direkt. Er ist bewusst lokal, damit jede Person mit dem eigenen ELO-Konto arbeitet.

## Test
Nach dem Verbinden „Wer bin ich in ELO?" fragen. `elo_whoami` zeigt Konto, Server, IX-Version und die freigeschalteten Stufen. Ohne `-Schreiben` und `-Bauen` sieht die KI nur die 13 lesenden Werkzeuge.
