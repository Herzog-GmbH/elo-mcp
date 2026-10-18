<#
.SYNOPSIS
  Startet elo-mcp.ps1 aus dem MCPB-Paket (Claude Desktop) mit den Einstellungen der Erweiterung.

.DESCRIPTION
  Claude Desktop reicht die Einstellungen der Erweiterung (user_config in manifest.json) als
  Umgebungsvariablen ELO_MCPB_* herein. Ein leeres oder nie gesetztes Feld kommt je nach Client
  als "" oder als unersetzter Platzhalter "${user_config....}" an; beides gilt als nicht gesetzt.
  Schalter kommen als "true" bzw. "false".

  Zugangsdaten stehen nicht in den Einstellungen. Die legt der Anwender vorher einmal mit
  Set-EloCredential.ps1 an (DPAPI), genau wie ohne Paket.
#>
$ErrorActionPreference = "Stop"

function Wert([string] $name) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ($v) { $v = $v.Trim() }
  if (-not $v -or $v.StartsWith('${') -or $v -eq "undefined" -or $v -eq "null") { return $null }
  return $v
}
function Schalter([string] $name) {
  $v = Wert $name
  return [bool] ($v -and $v -match '^(true|1|ja|yes)$')
}

# Pfad aus den Einstellungen pruefen; ein Tippfehler (z. B. "|" statt "\") soll eine klare Meldung im Log
# ergeben statt eines Fehlers von Test-Path in elo-mcp.ps1.
function Pfad([string] $name, [string] $titel, [string] $art) {
  $v = Wert $name
  if (-not $v) { return $null }
  $ok = $false
  try { $ok = Test-Path -LiteralPath $v -PathType $art } catch {}
  if (-not $ok) {
    [Console]::Error.WriteLine("[elo-mcp] $titel aus den Einstellungen der Erweiterung nicht gefunden: $v")
    exit 1
  }
  return $v
}

$p = @{}
$v = Wert "ELO_MCPB_IX_URL"; if ($v) { $p.IxUrl = $v }
$v = Pfad "ELO_MCPB_CREDENTIAL_FILE" "Zugangsdatei" "Leaf"; if ($v) { $p.CredentialFile = $v }
$v = Pfad "ELO_MCPB_CLIENT_DIR" "Ordner des ELO Client" "Container"; if ($v) { $p.ClientDir = $v }
$v = Wert "ELO_MCPB_ARCHIV";          if ($v) { $p.Archiv = $v }
if (Schalter "ELO_MCPB_SCHREIBEN") { $p.Schreiben = $true }
if (Schalter "ELO_MCPB_BAUEN")     { $p.Bauen = $true }

# Zweites Archiv nur mit IX-URL; die uebrigen Felder dafuer bleiben sonst unbeachtet.
$v = Wert "ELO_MCPB_IX_URL2"
if ($v) {
  $p.IxUrl2 = $v
  $v = Wert "ELO_MCPB_NAME";  if ($v) { $p.Name = $v }
  $v = Wert "ELO_MCPB_NAME2"; if ($v) { $p.Name2 = $v }
  $v = Pfad "ELO_MCPB_CREDENTIAL_FILE2" "Zugangsdatei fuer Archiv 2" "Leaf"; if ($v) { $p.CredentialFile2 = $v }
  $v = Wert "ELO_MCPB_ARCHIV2"; if ($v) { $p.Archiv2 = $v }
  if (Schalter "ELO_MCPB_SCHREIBEN2") { $p.Schreiben2 = $true }
  if (Schalter "ELO_MCPB_BAUEN2")     { $p.Bauen2 = $true }
}

# Nicht an Java weiterreichen; elo-mcp.ps1 setzt seine eigenen Variablen.
foreach ($n in "IX_URL", "CREDENTIAL_FILE", "CLIENT_DIR", "ARCHIV", "SCHREIBEN", "BAUEN",
               "NAME", "IX_URL2", "NAME2", "CREDENTIAL_FILE2", "ARCHIV2", "SCHREIBEN2", "BAUEN2") {
  Remove-Item "env:ELO_MCPB_$n" -ErrorAction SilentlyContinue
}

& (Join-Path $PSScriptRoot "elo-mcp.ps1") @p
exit $LASTEXITCODE
