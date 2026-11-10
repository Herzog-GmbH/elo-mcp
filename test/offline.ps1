<#
.SYNOPSIS
  Prueft den ELO-MCP ohne ELO-Verbindung (Protokoll, Stufen, Datum, Bauplan- und Skriptpruefungen).

.DESCRIPTION
  Laedt die Quellen unter Rhino aus dem ELO Client (bzw. ELO Java Client) und dazu test\offline.js.
  Laeuft zweimal: nur lesen, und mit allen Stufen.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File test\offline.ps1
#>
param([string] $ClientDir)

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$kandidaten = @()
if ($ClientDir) { $kandidaten += $ClientDir }
$kandidaten += @((Join-Path $env:ProgramFiles "ELO Client"), (Join-Path $env:ProgramFiles "ELO Java Client"))
$clientDir = $kandidaten | Where-Object { Test-Path (Join-Path $_ "jre\bin\java.exe") } | Select-Object -First 1
if (-not $clientDir) { Write-Host "ELO Client (bzw. ELO Java Client) nicht gefunden, -ClientDir angeben."; exit 2 }

$java = Join-Path $clientDir "jre\bin\java.exe"
$jvmArgs = @("-XX:+UseSerialGC", "-Dfile.encoding=UTF-8", "-cp", (Join-Path $clientDir "lib\*"), "org.mozilla.javascript.tools.shell.Main")
foreach ($s in "elo.js", "elo-mcp.js", "elo-mcp-schreiben.js", "elo-mcp-bauen.js", "elo-mcp-masken.js") { $jvmArgs += "-f", (Join-Path $root "src\$s") }
$jvmArgs += "-f", (Join-Path $root "test\offline.js")

# Dritter Lauf wie ein Java-Prozess fuer das zweite von zwei Archiven (so startet ihn elo-mcp.ps1 mit -IxUrl2).
$zweiArchive = '[{"name":"Prod","stufen":"1 lesen","schreiben":false,"bauen":false,"text":""},' +
               '{"name":"Test","stufen":"1 lesen, 2 arbeiten, 3 bauen","schreiben":true,"bauen":true,"text":"Testarchiv"}]'
$fehler = 0
foreach ($lauf in @(@{ name = "nur lesen"; an = $null },
                    @{ name = "lesen, schreiben, bauen"; an = "1" },
                    @{ name = "zwei Archive, dieses ist 'Test' mit allen Stufen"; an = "1"; archive = $zweiArchive; archiv = "Test" })) {
  Write-Host ""
  Write-Host "=== $($lauf.name) ==="
  $env:ELO_MCP_SCHREIBEN = $lauf.an
  $env:ELO_MCP_BAUEN = $lauf.an
  $env:ELO_MCP_ARCHIVE = $lauf.archive
  $env:ELO_MCP_ARCHIV_NAME = $lauf.archiv
  & $java @jvmArgs 2>$null   # stderr ist das Log des Servers
  if ($LASTEXITCODE -ne 0) { $fehler++ }
}
$env:ELO_MCP_SCHREIBEN = $null
$env:ELO_MCP_BAUEN = $null
$env:ELO_MCP_ARCHIVE = $null
$env:ELO_MCP_ARCHIV_NAME = $null

Write-Host ""
if ($fehler) { Write-Host "Offline-Test FEHLGESCHLAGEN"; exit 1 }
Write-Host "Offline-Test bestanden"
