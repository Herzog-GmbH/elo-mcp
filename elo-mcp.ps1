<#
.SYNOPSIS
  Startet den ELO-MCP-Server (stdio) mit den eigenen ELO-Zugangsdaten.

.DESCRIPTION
  Wird vom MCP-Client (Claude Code, Claude Desktop, VS Code, Codex ...) gestartet, nicht von Hand.
  Der eigentliche Server (src\*.js unter Rhino) laeuft in der Java-VM des ELO Client (ELO 25) bzw.
  ELO Java Client.

  Dieses Skript steht als schlanker Vorschalt davor. MCP-Clients starten jeden Server einmal je
  Sitzung; eine JVM je Sitzung kostet rund 650 MB Commit, auch wenn ELO nie gebraucht wird.
    - initialize, tools/list und ping beantwortet der Vorschalt selbst, aus dem Zwischenspeicher
      %LOCALAPPDATA%\elo-mcp\werkzeuge-<schluessel>.txt. Den holt er einmalig von Java, wenn
      sich Skripte, Server oder Schalter geaendert haben (Schluessel = Hash darueber).
    - Java startet erst beim ersten tools/call und endet nach -LeerlaufMinuten ohne Aufruf
      (stdin zu, elo-mcp-start.js meldet sich ab). Der naechste Aufruf startet es neu.
    - Die JVM laeuft mit SerialGC und kleinem Start-Heap (rund 130 statt 650 MB Commit).
  Die Zugangsdaten (DPAPI, angelegt mit Set-EloCredential.ps1) liest er erst beim Java-Start
  und gibt sie nur an Java weiter.

  Zwei Archive (-IxUrl2): Jedes Archiv bekommt einen eigenen Java-Prozess mit eigenen Zugangsdaten
  und Stufen; Zwischenspeicher, Tokens und Verbindungen mischen sich nie. Jedes Werkzeug hat dann den
  Parameter archiv (Name des Archivs, ohne Angabe das erste), danach leitet der Vorschalt weiter.
  Die Werkzeugliste umfasst alle Werkzeuge, die in mindestens einem Archiv frei sind; ob ein
  Aufruf im gewaehlten Archiv erlaubt ist, prueft dessen Java-Prozess.

  -Direkt: ohne Vorschalt, Java sofort, stdin/stdout direkt durchgereicht (Rueckfall, nur ein Archiv).

  Benoetigt Windows PowerShell 5.1 (powershell.exe), nicht PowerShell 7.

.EXAMPLE
  claude mcp add elo --scope user -- powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Tools\elo-mcp\elo-mcp.ps1" -IxUrl "https://elo.example.com:9093/ix-Archiv/ix"
.EXAMPLE
  ... -File "C:\Tools\elo-mcp\elo-mcp.ps1" -IxUrl "https://elo.example.com:9093/ix-Archiv/ix" -Name Produktiv -IxUrl2 "https://elo-test.example.com:9093/ix-Archiv/ix" -Name2 Test -Schreiben2 -Bauen2
#>
[CmdletBinding()]
param(
  # IX-URL des ELO-Servers, z. B. https://elo.example.com:9093/ix-Archiv/ix (alternativ Umgebungsvariable ELO_IX_URL).
  [string] $IxUrl = $env:ELO_IX_URL,
  # Stufe 2 freischalten: ablegen, neue Version, Indexfelder, Workflow starten, Aufgabe weiterleiten.
  [switch] $Schreiben,
  # Stufe 3 freischalten: Workflow-Vorlagen, Skripte, ELOas-Regeln, Formularseiten bauen. Am besten nur gegen ein Testarchiv.
  [switch] $Bauen,
  # Zugangsdaten (DPAPI-verschluesselt), angelegt mit Set-EloCredential.ps1.
  [string] $CredentialFile = (Join-Path $env:LOCALAPPDATA "elo-mcp\elo-credential.xml"),
  # Ordner des ELO Client bzw. ELO Java Client (mit jre\bin\java.exe und lib\). Standard: unter Programme suchen.
  [string] $ClientDir,
  # Optionaler Name des Archivs fuer die Hinweise an die KI, z. B. "der Muster GmbH (Test)".
  [string] $Archiv,
  # Nur mit -IxUrl2: Kurzname des ersten Archivs fuer den Parameter archiv, z. B. "Produktiv". Standard "1".
  [string] $Name,
  # Zweites Archiv (optional), z. B. das Testarchiv. Die Schalter mit 2 gelten nur dafuer.
  [string] $IxUrl2,
  # Kurzname des zweiten Archivs, z. B. "Test". Standard "2".
  [string] $Name2,
  [switch] $Schreiben2,
  [switch] $Bauen2,
  # Zugangsdaten fuer das zweite Archiv. Standard: dieselbe Datei wie fuer das erste.
  [string] $CredentialFile2,
  [string] $Archiv2,
  # Hausregel mancher Archive: Textfelder, deren Name auf DAT/DATUM endet, bekommen Datumsangaben als JJJJMMTT.
  [switch] $TextDatumJJJJMMTT,
  # Java nach so vielen Minuten ohne Werkzeugaufruf beenden. Nicht unter 5: so lange gilt ein
  # Vorschau-Token der schreibenden Werkzeuge, und es lebt nur in der JVM.
  [double] $LeerlaufMinuten = 10,
  # Ohne Vorschalt: Java sofort starten und stdin/stdout direkt durchreichen.
  [switch] $Direkt
)

$ErrorActionPreference = "Stop"
function Log([string] $m) { [Console]::Error.WriteLine("[elo-mcp] $m") }

$mcpDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcDir = Join-Path $mcpDir "src"

if (-not $IxUrl) { Log "Keine IX-URL. -IxUrl https://<server>:<port>/ix-<archiv>/ix angeben (oder ELO_IX_URL setzen)."; exit 1 }

# ---------- Archive ----------
$archive = New-Object System.Collections.ArrayList
[void] $archive.Add(@{ Name = $(if ($Name) { $Name.Trim() } else { "1" }); IxUrl = $IxUrl; CredentialFile = $CredentialFile
                       Schreiben = [bool] $Schreiben; Bauen = [bool] $Bauen; Text = $Archiv })
if ($IxUrl2) {
  [void] $archive.Add(@{ Name = $(if ($Name2) { $Name2.Trim() } else { "2" }); IxUrl = $IxUrl2
                         CredentialFile = $(if ($CredentialFile2) { $CredentialFile2 } else { $CredentialFile })
                         Schreiben = [bool] $Schreiben2; Bauen = [bool] $Bauen2; Text = $Archiv2 })
} elseif ($Name2 -or $Schreiben2 -or $Bauen2 -or $CredentialFile2 -or $Archiv2) {
  Log "Angaben fuer das zweite Archiv ohne -IxUrl2."; exit 1
}
$mehrere = $archive.Count -gt 1
if ($mehrere) {
  if ($archive[0].Name -eq $archive[1].Name) { Log "Beide Archive heissen '$($archive[0].Name)'. -Name und -Name2 verschieden setzen."; exit 1 }
  if ($Direkt) { Log "-Direkt geht nur mit einem Archiv."; exit 1 }
}

$kandidaten = @()
if ($ClientDir) { $kandidaten += $ClientDir }
# Zuerst der neuere "ELO Client" (ab ELO 25), dann der alte "ELO Java Client": Sind beide da, bringt der
# alte oft noch eine aeltere IX-Client-Bibliothek mit.
$kandidaten += @((Join-Path $env:ProgramFiles "ELO Client"), (Join-Path $env:ProgramFiles "ELO Java Client"))
if (${env:ProgramFiles(x86)}) { $kandidaten += @((Join-Path ${env:ProgramFiles(x86)} "ELO Client"), (Join-Path ${env:ProgramFiles(x86)} "ELO Java Client")) }
$clientDir = $kandidaten | Where-Object { Test-Path (Join-Path $_ "jre\bin\java.exe") } | Select-Object -First 1
if (-not $clientDir) { Log "ELO Client (bzw. ELO Java Client) nicht gefunden (gesucht: $($kandidaten -join '; ')). Mit -ClientDir angeben."; exit 1 }

foreach ($a in $archive) {
  if (-not (Test-Path $a.CredentialFile)) {
    Log "Keine Zugangsdaten unter $($a.CredentialFile)$(if ($mehrere) { " (Archiv '$($a.Name)')" }). Einmalig ausfuehren: $mcpDir\Set-EloCredential.ps1"
    exit 1
  }
}

$javaExe = Join-Path $clientDir "jre\bin\java.exe"
$skripte = @("elo.js", "elo-mcp.js", "elo-mcp-schreiben.js", "elo-mcp-bauen.js", "elo-mcp-masken.js", "elo-mcp-benutzer.js", "elo-mcp-rechte.js", "elo-mcp-vorgaenge.js", "elo-mcp-start.js") | ForEach-Object { Join-Path $srcDir $_ }
# G1 legt sonst sofort 1/64 des RAM als Heap fest (508 MB bei 32 GB). Der C2-Compiler lohnt sich
# fuer eine JVM, die nur Minuten laeuft und meist auf den IX wartet, nicht.
$argList = @("-XX:+UseSerialGC", "-Xms32m", "-XX:TieredStopAtLevel=1",
             "-Djavax.net.ssl.trustStoreType=Windows-ROOT", "-Dfile.encoding=UTF-8",
             "-cp", "`"$(Join-Path $clientDir 'lib\*')`"", "org.mozilla.javascript.tools.shell.Main")
foreach ($s in $skripte) { $argList += "-f", "`"$s`"" }

function Stufen($a) { "1 lesen" + $(if ($a.Schreiben) { ", 2 arbeiten" } else { "" }) + $(if ($a.Bauen) { ", 3 bauen" } else { "" }) }
function JsonText([string] $s) { '"' + $s.Replace('\', '\\').Replace('"', '\"') + '"' }

# Liste aller Archive fuer Java (Parameter archiv, Hinweise an die KI), nur bei mehreren.
$archivListe = $null
if ($mehrere) {
  $teile = foreach ($a in $archive) {
    '{"name":' + (JsonText $a.Name) + ',"stufen":' + (JsonText (Stufen $a)) +
    ',"schreiben":' + $(if ($a.Schreiben) { "true" } else { "false" }) + ',"bauen":' + $(if ($a.Bauen) { "true" } else { "false" }) +
    ',"text":' + (JsonText ([string] $a.Text)) + '}'
  }
  $archivListe = "[" + ($teile -join ",") + "]"
}

# Alles, was Java ausser den Zugangsdaten bekommt. Geht auch in den Schluessel des Zwischenspeichers ein.
foreach ($a in $archive) {
  $a.Umgebung = [ordered]@{
    ELO_IX_URL          = $a.IxUrl
    ELO_MCP_SCHREIBEN   = if ($a.Schreiben) { "1" } else { $null }
    ELO_MCP_BAUEN       = if ($a.Bauen) { "1" } else { $null }
    ELO_MCP_ARCHIV      = if ($a.Text) { $a.Text } else { $null }
    ELO_MCP_TEXTDATUM   = if ($TextDatumJJJJMMTT) { "JJJJMMTT" } else { $null }
    ELO_MCP_ARCHIV_NAME = if ($mehrere) { $a.Name } else { $null }
    ELO_MCP_ARCHIVE     = $archivListe
  }
}
# Werkzeugliste und Hinweise: bei einem Archiv von dessen Java, bei mehreren von einem eigenen Java ohne
# Zugangsdaten mit allen Stufen, die irgendwo frei sind. Der bedient nie einen Werkzeugaufruf.
if ($mehrere) {
  $katalog = [ordered]@{
    ELO_IX_URL          = $archive[0].IxUrl
    ELO_MCP_SCHREIBEN   = if ($archive | Where-Object { $_.Schreiben }) { "1" } else { $null }
    ELO_MCP_BAUEN       = if ($archive | Where-Object { $_.Bauen }) { "1" } else { $null }
    ELO_MCP_ARCHIV      = $null
    ELO_MCP_TEXTDATUM   = if ($TextDatumJJJJMMTT) { "JJJJMMTT" } else { $null }
    ELO_MCP_ARCHIV_NAME = $null
    ELO_MCP_ARCHIVE     = $archivListe
  }
} else {
  $katalog = $archive[0].Umgebung
}
$archivNach = @{}   # Name -> Archiv, Gross-/Kleinschreibung egal
foreach ($a in $archive) { $archivNach[$a.Name] = $a }

if ($Direkt) {
  $umgebung = $archive[0].Umgebung
  $cred = Import-CliXml $CredentialFile
  foreach ($k in $umgebung.Keys) {
    if ($null -ne $umgebung[$k]) { Set-Item "env:$k" $umgebung[$k] } else { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
  }
  $env:ELO_USER = $cred.UserName
  $env:ELO_PASS = $cred.GetNetworkCredential().Password
  try {
    # Start-Process -NoNewWindow: stdin/stdout gehen direkt an Java, PowerShell kodiert und puffert nichts.
    $p = Start-Process -FilePath $javaExe -ArgumentList $argList -NoNewWindow -Wait -PassThru
    exit $p.ExitCode
  }
  finally {
    $env:ELO_PASS = $null
    $env:ELO_USER = $null
  }
}

# ---------- Vorschalt ----------

Add-Type -AssemblyName System.Web.Extensions
$JSON = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$JSON.MaxJsonLength = [int]::MaxValue
$JSON.RecursionLimit = 1000
$utf8 = New-Object System.Text.UTF8Encoding $false
# Mit "UTF-8 weltweit" (Codepage 65001) ist [Console]::InputEncoding UTF-8 mit BOM, und .NET schreibt das BOM
# beim Anlegen von Process.StandardInput sofort in die Pipe; Rhino haelt die erste Zeile dann fuer kaputtes JSON.
try { [Console]::InputEncoding = $utf8 } catch { Log "InputEncoding nicht setzbar: $($_.Exception.Message)" }
$PV_STANDARD = "2025-06-18"   # wie elo-mcp.js, wenn der Client keine Version nennt
$RX_PV = New-Object System.Text.RegularExpressions.Regex('"protocolVersion":"[^"]*"')

function Text-Umgebung($u) { ($u.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join '|' }

# Zwischenspeicher fuer initialize/tools/list; Schluessel ueber alles, was die beiden Antworten bestimmt.
$cacheDir = Join-Path $env:LOCALAPPDATA "elo-mcp"
$puffer = New-Object System.IO.MemoryStream
# Auch dieses Skript selbst: Es bestimmt mit, wie die Werkzeugliste entsteht (Katalog bei mehreren Archiven).
foreach ($s in @($skripte) + $MyInvocation.MyCommand.Path) { $b = [System.IO.File]::ReadAllBytes($s); $puffer.Write($b, 0, $b.Length) }
$b = $utf8.GetBytes("|$javaExe|$(Text-Umgebung $katalog)|$(($archive | ForEach-Object { Text-Umgebung $_.Umgebung }) -join '||')|$($argList -join ' ')")
$puffer.Write($b, 0, $b.Length)
$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($puffer.ToArray())
$cacheFile = Join-Path $cacheDir ("werkzeuge-" + (-join ($hash[0..7] | ForEach-Object { $_.ToString("x2") })) + ".txt")

# Laufende Java-Prozesse: Schluessel = Archivname (bzw. "#katalog"), Wert = @{ p; w; zuletzt }.
$script:laeufe = @{}
$script:cache = $null
$KATALOG_NAME = "#katalog"   # nicht $KATALOG: PowerShell-Variablen sind nicht case-sensitiv, das waere $katalog

function Zusatz([string] $schluessel) { if ($mehrere) { " (Archiv '$schluessel')" } else { "" } }

# Eine Anfrage an Java, eine Antwortzeile zurueck ($null, wenn Java weg ist).
function An-Java($l, [string] $zeile) {
  try { $l.w.WriteLine($zeile); return $l.p.StandardOutput.ReadLine() }
  catch { Log "Java nicht erreichbar: $($_.Exception.Message)"; return $null }
}

# Rohes "result" aus einer Antwort von Java (elo-mcp.js schreibt jsonrpc, id, result in dieser Reihenfolge).
function Ergebnis([string] $zeile, [string] $id) {
  $vorn = '{"jsonrpc":"2.0","id":"' + $id + '","result":'
  if ($zeile -and $zeile.StartsWith($vorn, [StringComparison]::Ordinal) -and $zeile.EndsWith("}")) {
    return $zeile.Substring($vorn.Length, $zeile.Length - $vorn.Length - 1)
  }
  throw "unerwartete Antwort von Java auf $id`: $(if ($zeile) { $zeile.Substring(0, [Math]::Min(200, $zeile.Length)) } else { '(keine)' })"
}

# $credFile leer: ohne Zugangsdaten (nur fuer den Katalog, der nie an ELO geht).
function Start-Java([string] $schluessel, $umgebung, [string] $credFile) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $javaExe
  $psi.Arguments = $argList -join " "
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true      # stderr nicht: das bleibt das Log des MCP-Servers im Client
  $psi.StandardOutputEncoding = $utf8
  $e = $psi.EnvironmentVariables
  foreach ($k in $umgebung.Keys) { if ($null -ne $umgebung[$k]) { $e[$k] = $umgebung[$k] } else { $e.Remove($k) } }
  if ($credFile) {
    $cred = Import-CliXml $credFile
    $e["ELO_USER"] = $cred.UserName
    $e["ELO_PASS"] = $cred.GetNetworkCredential().Password
  } else { $e.Remove("ELO_USER"); $e.Remove("ELO_PASS") }
  $p = [System.Diagnostics.Process]::Start($psi)
  $e.Remove("ELO_PASS")
  # Process.StandardInput nimmt [Console]::InputEncoding; deshalb eigener UTF-8-Schreiber auf denselben Strom.
  $w = New-Object System.IO.StreamWriter($p.StandardInput.BaseStream, $utf8)
  $w.AutoFlush = $true
  $w.NewLine = "`n"
  $l = @{ p = $p; w = $w; zuletzt = [DateTime]::UtcNow }
  $script:laeufe[$schluessel] = $l
  try {
    # Hat .NET schon ein BOM in die Pipe geschrieben (siehe InputEncoding oben), steht es so allein in
    # einer Zeile: Java ueberspringt sie oder meldet "Kein gueltiges JSON" mit id null, das unten verworfen wird.
    if ($p.StandardInput.Encoding.GetPreamble().Length -gt 0) { $w.WriteLine("") }
    # Handshake wie ein Client, damit Java denselben Stand hat wie bei direktem Start.
    $antwort = An-Java $l ('{"jsonrpc":"2.0","id":"vorschalt-start","method":"initialize","params":{"protocolVersion":"' + $PV_STANDARD +
                           '","capabilities":{},"clientInfo":{"name":"elo-mcp-vorschalt","version":"1"}}}')
    if ($antwort -and $antwort.StartsWith('{"jsonrpc":"2.0","id":null,')) { $antwort = $p.StandardOutput.ReadLine() }
    [void](Ergebnis $antwort "vorschalt-start")
    $w.WriteLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')
  } catch { Stop-Java $schluessel "Start fehlgeschlagen"; throw }
  Log "Java gestartet (PID $($p.Id))$(Zusatz $schluessel)"
  return $l
}

function Stop-Java([string] $schluessel, [string] $grund) {
  $l = $script:laeufe[$schluessel]
  if (-not $l) { return }
  $script:laeufe.Remove($schluessel)
  try { $l.w.Close() } catch {}
  # Bei stdin-Ende meldet sich elo-mcp-start.js beim IX ab und ruft System.exit(0).
  if (-not $l.p.WaitForExit(15000)) { try { $l.p.Kill() } catch {}; Log "Java reagierte nicht, hart beendet$(Zusatz $schluessel)" }
  Log "Java beendet ($grund)$(Zusatz $schluessel)"
  $l.p.Dispose()
}

# Java fuer ein Archiv bereitstellen (laeuft schon oder wird gestartet).
function Java-Bereit($a) {
  $l = $script:laeufe[$a.Name]
  if ($l -and $l.p.HasExited) { Log "Java unerwartet beendet (Exit $($l.p.ExitCode))$(Zusatz $a.Name)"; $script:laeufe.Remove($a.Name); $l = $null }
  if (-not $l) { $l = Start-Java $a.Name $a.Umgebung $a.CredentialFile }
  return $l
}

function Cache {
  if ($script:cache) { return $script:cache }
  if (Test-Path $cacheFile) {
    $z = [System.IO.File]::ReadAllLines($cacheFile, $utf8)
    if ($z.Count -eq 2 -and $z[0].StartsWith('{"protocolVersion":') -and $z[1].StartsWith('{"tools":[')) {
      $script:cache = @{ init = $z[0]; tools = $z[1] }
      return $script:cache
    }
  }
  # Fehlt oder ist veraltet: einmal bei Java holen. Bei einem Archiv bleibt Java danach bis zum Leerlauf
  # stehen; der Katalog-Prozess bei mehreren Archiven endet sofort.
  Log "Werkzeugliste neu von Java holen: $cacheFile"
  if ($mehrere) { $l = Start-Java $KATALOG_NAME $katalog $null } else { $l = Java-Bereit $archive[0] }
  try {
    $init  = Ergebnis (An-Java $l ('{"jsonrpc":"2.0","id":"vorschalt-init","method":"initialize","params":{"protocolVersion":"' + $PV_STANDARD +
                       '","capabilities":{},"clientInfo":{"name":"elo-mcp-vorschalt","version":"1"}}}')) "vorschalt-init"
    $tools = Ergebnis (An-Java $l '{"jsonrpc":"2.0","id":"vorschalt-tools","method":"tools/list"}') "vorschalt-tools"
  } finally {
    if ($mehrere) { Stop-Java $KATALOG_NAME "Werkzeugliste geholt" }
  }
  $script:cache = @{ init = $init; tools = $tools }
  $tmp = "$cacheFile.$PID.tmp"
  try {
    [void](New-Item -ItemType Directory -Force $cacheDir)
    [System.IO.File]::WriteAllLines($tmp, [string[]] @($init, $tools), $utf8)
    if (Test-Path $cacheFile) { Remove-Item $cacheFile -Force }
    [System.IO.File]::Move($tmp, $cacheFile)   # erst komplett schreiben, dann umbenennen: parallele Sitzungen lesen nie halbe Dateien
  } catch {
    Log "Zwischenspeicher nicht geschrieben: $($_.Exception.Message)"
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
  return $script:cache
}

function Antwort([string] $zeile) { $stdout.WriteLine($zeile) }
function Ok([string] $id, [string] $result) { Antwort ('{"jsonrpc":"2.0","id":' + $id + ',"result":' + $result + '}') }
function Fehler([string] $id, [int] $code, [string] $text) {
  Antwort ('{"jsonrpc":"2.0","id":' + $id + ',"error":{"code":' + $code + ',"message":' + $JSON.Serialize($text) + '}}')
}
function Werkzeugfehler([string] $id, [string] $text) {
  Ok $id ('{"content":[{"type":"text","text":' + $JSON.Serialize("Fehler: " + $text) + '}],"isError":true}')
}

# Ziel eines Werkzeugaufrufs: Parameter archiv, ohne Angabe das erste Archiv. $null bei unbekanntem Namen.
function Ziel($msg) {
  if (-not $mehrere) { return $archive[0] }
  $par = if ($msg.ContainsKey("params")) { $msg["params"] } else { $null }
  $arg = if ($par -is [System.Collections.IDictionary] -and $par.ContainsKey("arguments")) { $par["arguments"] } else { $null }
  if ($arg -isnot [System.Collections.IDictionary] -or -not $arg.ContainsKey("archiv") -or -not "$($arg['archiv'])".Trim()) { return $archive[0] }
  return $archivNach["$($arg['archiv'])".Trim()]
}

function Behandle([string] $zeile) {
  if (-not $zeile.Trim()) { return }
  $msg = $null
  try { $msg = $JSON.DeserializeObject($zeile) } catch { Fehler "null" -32700 "Kein gueltiges JSON"; return }
  if ($msg -isnot [System.Collections.IDictionary]) { Log "Nachricht ist kein Objekt, ignoriert"; return }
  # Benachrichtigungen (ohne id) wertet elo-mcp.js nicht aus; sie brauchen keine JVM.
  if (-not $msg.ContainsKey("id") -or $null -eq $msg["id"]) { return }
  $id = $JSON.Serialize($msg["id"])
  $m = if ($msg.ContainsKey("method")) { [string] $msg["method"] } else { "" }
  try {
    switch -CaseSensitive ($m) {
      "initialize" {
        $pv = $PV_STANDARD
        $par = if ($msg.ContainsKey("params")) { $msg["params"] } else { $null }
        if ($par -is [System.Collections.IDictionary] -and $par.ContainsKey("protocolVersion") -and $par["protocolVersion"]) { $pv = [string] $par["protocolVersion"] }
        $c = Cache
        # elo-mcp.js nennt die Protokollversion, die der Client geschickt hat.
        Ok $id ($RX_PV.Replace($c.init, ('"protocolVersion":' + $JSON.Serialize($pv)).Replace('$', '$$'), 1))
      }
      "tools/list" { $c = Cache; Ok $id $c.tools }
      "ping"       { Ok $id "{}" }
      "tools/call" {
        $a = Ziel $msg
        if (-not $a) {
          Werkzeugfehler $id ("Unbekanntes Archiv. Moeglich: " + (($archive | ForEach-Object { "'" + $_.Name + "'" }) -join ", ") + ".")
          return
        }
        try { $l = Java-Bereit $a }
        catch { Log "Java-Start fehlgeschlagen$(Zusatz $a.Name): $($_.Exception.Message)"; Werkzeugfehler $id "ELO-MCP konnte Java nicht starten: $($_.Exception.Message)"; return }
        $antwort = An-Java $l $zeile
        $l.zuletzt = [DateTime]::UtcNow
        if ($null -eq $antwort) {
          Stop-Java $a.Name "keine Antwort"
          Werkzeugfehler $id ("Der ELO-MCP-Server (Java) hat sich waehrend des Aufrufs beendet. Bei schreibenden Werkzeugen " +
                              "erst pruefen, ob die Aenderung angekommen ist, bevor erneut aufgerufen wird.")
          return
        }
        Antwort $antwort
      }
      default { Fehler $id -32601 "Methode nicht unterstuetzt: $m" }
    }
  } catch {
    Log "Fehler bei ${m}: $($_.Exception.Message)"
    Fehler $id -32603 "elo-mcp: $($_.Exception.Message)"
  }
}

# stdin/stdout selbst als UTF-8 oeffnen; [Console]::In/Out nutzen sonst die OEM-Codepage.
$stdin  = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true
$stdout.NewLine = "`n"
$leerlaufMs = [Math]::Max(1000, $LeerlaufMinuten * 60000)

$bereit = ($archive | ForEach-Object {
  $(if ($mehrere) { "Archiv '$($_.Name)': " } else { "" }) + "Server $($_.IxUrl), Stufen: lesen" +
  $(if ($_.Schreiben) { ", schreiben" } else { "" }) + $(if ($_.Bauen) { ", bauen" } else { "" })
}) -join "; "
Log "Vorschalt bereit ($bereit), Java erst beim ersten Werkzeugaufruf, Ende nach $LeerlaufMinuten min Leerlauf"
try {
  $lesen = $stdin.ReadLineAsync()
  while ($true) {
    # Laufende Java-Prozesse nach Leerlauf beenden; bis zum naechsten Ablauf auf stdin warten.
    $warte = -1
    foreach ($k in @($script:laeufe.Keys)) {
      $rest = $leerlaufMs - ([DateTime]::UtcNow - $script:laeufe[$k].zuletzt).TotalMilliseconds
      if ($rest -le 0) { Stop-Java $k "$LeerlaufMinuten min ohne Aufruf"; continue }
      if ($warte -lt 0 -or $rest -lt $warte) { $warte = $rest }
    }
    if ($warte -ge 0) {
      if (-not $lesen.Wait([int] [Math]::Ceiling($warte))) { continue }
    } else {
      [void] $lesen.Wait()
    }
    $zeile = $lesen.Result
    if ($null -eq $zeile) { break }
    $lesen = $stdin.ReadLineAsync()
    Behandle $zeile
  }
}
finally {
  foreach ($k in @($script:laeufe.Keys)) { Stop-Java $k "stdin geschlossen" }
}
exit 0
