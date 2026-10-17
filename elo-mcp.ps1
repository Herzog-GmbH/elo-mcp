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

  -Direkt: ohne Vorschalt, Java sofort, stdin/stdout direkt durchgereicht (Rueckfall).

  Benoetigt Windows PowerShell 5.1 (powershell.exe), nicht PowerShell 7.

.EXAMPLE
  claude mcp add elo --scope user -- powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Tools\elo-mcp\elo-mcp.ps1" -IxUrl "https://elo.example.com:9093/ix-Archiv/ix"
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

$kandidaten = @()
if ($ClientDir) { $kandidaten += $ClientDir }
# Zuerst der neuere "ELO Client" (ab ELO 25), dann der alte "ELO Java Client": Sind beide da, bringt der
# alte oft noch eine aeltere IX-Client-Bibliothek mit.
$kandidaten += @((Join-Path $env:ProgramFiles "ELO Client"), (Join-Path $env:ProgramFiles "ELO Java Client"))
if (${env:ProgramFiles(x86)}) { $kandidaten += @((Join-Path ${env:ProgramFiles(x86)} "ELO Client"), (Join-Path ${env:ProgramFiles(x86)} "ELO Java Client")) }
$clientDir = $kandidaten | Where-Object { Test-Path (Join-Path $_ "jre\bin\java.exe") } | Select-Object -First 1
if (-not $clientDir) { Log "ELO Client (bzw. ELO Java Client) nicht gefunden (gesucht: $($kandidaten -join '; ')). Mit -ClientDir angeben."; exit 1 }

if (-not (Test-Path $CredentialFile)) {
  Log "Keine Zugangsdaten unter $CredentialFile. Einmalig ausfuehren: $mcpDir\Set-EloCredential.ps1"
  exit 1
}

$javaExe = Join-Path $clientDir "jre\bin\java.exe"
$skripte = @("elo.js", "elo-mcp.js", "elo-mcp-schreiben.js", "elo-mcp-bauen.js", "elo-mcp-start.js") | ForEach-Object { Join-Path $srcDir $_ }
# G1 legt sonst sofort 1/64 des RAM als Heap fest (508 MB bei 32 GB). Der C2-Compiler lohnt sich
# fuer eine JVM, die nur Minuten laeuft und meist auf den IX wartet, nicht.
$argList = @("-XX:+UseSerialGC", "-Xms32m", "-XX:TieredStopAtLevel=1",
             "-Djavax.net.ssl.trustStoreType=Windows-ROOT", "-Dfile.encoding=UTF-8",
             "-cp", "`"$(Join-Path $clientDir 'lib\*')`"", "org.mozilla.javascript.tools.shell.Main")
foreach ($s in $skripte) { $argList += "-f", "`"$s`"" }

# Alles, was Java ausser den Zugangsdaten bekommt. Geht auch in den Schluessel des Zwischenspeichers ein.
$umgebung = [ordered]@{
  ELO_IX_URL         = $IxUrl
  ELO_MCP_SCHREIBEN  = if ($Schreiben) { "1" } else { $null }
  ELO_MCP_BAUEN      = if ($Bauen) { "1" } else { $null }
  ELO_MCP_ARCHIV     = if ($Archiv) { $Archiv } else { $null }
  ELO_MCP_TEXTDATUM  = if ($TextDatumJJJJMMTT) { "JJJJMMTT" } else { $null }
}

if ($Direkt) {
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

# Zwischenspeicher fuer initialize/tools/list; Schluessel ueber alles, was die beiden Antworten bestimmt.
$cacheDir = Join-Path $env:LOCALAPPDATA "elo-mcp"
$puffer = New-Object System.IO.MemoryStream
foreach ($s in $skripte) { $b = [System.IO.File]::ReadAllBytes($s); $puffer.Write($b, 0, $b.Length) }
$b = $utf8.GetBytes("|$javaExe|$(($umgebung.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join '|')|$($argList -join ' ')")
$puffer.Write($b, 0, $b.Length)
$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($puffer.ToArray())
$cacheFile = Join-Path $cacheDir ("werkzeuge-" + (-join ($hash[0..7] | ForEach-Object { $_.ToString("x2") })) + ".txt")

$script:jvm = $null       # laufender Java-Prozess oder $null
$script:jvmIn = $null
$script:zuletzt = [DateTime]::UtcNow
$script:cache = $null

# Eine Anfrage an Java, eine Antwortzeile zurueck ($null, wenn Java weg ist).
function An-Java([string] $zeile) {
  try { $script:jvmIn.WriteLine($zeile); return $script:jvm.StandardOutput.ReadLine() }
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

function Start-Java {
  $cred = Import-CliXml $CredentialFile
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $javaExe
  $psi.Arguments = $argList -join " "
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true      # stderr nicht: das bleibt das Log des MCP-Servers im Client
  $psi.StandardOutputEncoding = $utf8
  $e = $psi.EnvironmentVariables
  foreach ($k in $umgebung.Keys) { if ($null -ne $umgebung[$k]) { $e[$k] = $umgebung[$k] } else { $e.Remove($k) } }
  $e["ELO_USER"] = $cred.UserName
  $e["ELO_PASS"] = $cred.GetNetworkCredential().Password
  $p = [System.Diagnostics.Process]::Start($psi)
  $e.Remove("ELO_PASS")
  # Process.StandardInput nimmt [Console]::InputEncoding; deshalb eigener UTF-8-Schreiber auf denselben Strom.
  $w = New-Object System.IO.StreamWriter($p.StandardInput.BaseStream, $utf8)
  $w.AutoFlush = $true
  $w.NewLine = "`n"
  $script:jvm = $p; $script:jvmIn = $w; $script:zuletzt = [DateTime]::UtcNow
  try {
    # Hat .NET schon ein BOM in die Pipe geschrieben (siehe InputEncoding oben), steht es so allein in
    # einer Zeile: Java ueberspringt sie oder meldet "Kein gueltiges JSON" mit id null, das unten verworfen wird.
    if ($p.StandardInput.Encoding.GetPreamble().Length -gt 0) { $w.WriteLine("") }
    # Handshake wie ein Client, damit Java denselben Stand hat wie bei direktem Start.
    $antwort = An-Java ('{"jsonrpc":"2.0","id":"vorschalt-start","method":"initialize","params":{"protocolVersion":"' + $PV_STANDARD +
                        '","capabilities":{},"clientInfo":{"name":"elo-mcp-vorschalt","version":"1"}}}')
    if ($antwort -and $antwort.StartsWith('{"jsonrpc":"2.0","id":null,')) { $antwort = $p.StandardOutput.ReadLine() }
    [void](Ergebnis $antwort "vorschalt-start")
    $w.WriteLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')
  } catch { Stop-Java "Start fehlgeschlagen"; throw }
  Log "Java gestartet (PID $($p.Id))"
}

function Stop-Java([string] $grund) {
  if (-not $script:jvm) { return }
  $p = $script:jvm; $script:jvm = $null
  try { $script:jvmIn.Close() } catch {}
  # Bei stdin-Ende meldet sich elo-mcp-start.js beim IX ab und ruft System.exit(0).
  if (-not $p.WaitForExit(15000)) { try { $p.Kill() } catch {}; Log "Java reagierte nicht, hart beendet" }
  Log "Java beendet ($grund)"
  $p.Dispose()
}

function Java-Bereit {
  if ($script:jvm -and $script:jvm.HasExited) { Log "Java unerwartet beendet (Exit $($script:jvm.ExitCode))"; $script:jvm = $null }
  if (-not $script:jvm) { Start-Java }
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
  # Fehlt oder ist veraltet: einmal bei Java holen. Java bleibt danach bis zum Leerlauf stehen.
  Log "Werkzeugliste neu von Java holen: $cacheFile"
  Java-Bereit
  $init  = Ergebnis (An-Java ('{"jsonrpc":"2.0","id":"vorschalt-init","method":"initialize","params":{"protocolVersion":"' + $PV_STANDARD +
                     '","capabilities":{},"clientInfo":{"name":"elo-mcp-vorschalt","version":"1"}}}')) "vorschalt-init"
  $tools = Ergebnis (An-Java '{"jsonrpc":"2.0","id":"vorschalt-tools","method":"tools/list"}') "vorschalt-tools"
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
        try { Java-Bereit }
        catch { Log "Java-Start fehlgeschlagen: $($_.Exception.Message)"; Werkzeugfehler $id "ELO-MCP konnte Java nicht starten: $($_.Exception.Message)"; return }
        $antwort = An-Java $zeile
        $script:zuletzt = [DateTime]::UtcNow
        if ($null -eq $antwort) {
          Stop-Java "keine Antwort"
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

$frei = "lesen" + $(if ($Schreiben) { ", schreiben" } else { "" }) + $(if ($Bauen) { ", bauen" } else { "" })
Log "Vorschalt bereit (Server $IxUrl, Stufen: $frei), Java erst beim ersten Werkzeugaufruf, Ende nach $LeerlaufMinuten min Leerlauf"
try {
  $lesen = $stdin.ReadLineAsync()
  while ($true) {
    if ($script:jvm) {
      $rest = $leerlaufMs - ([DateTime]::UtcNow - $script:zuletzt).TotalMilliseconds
      if ($rest -le 0) { Stop-Java "$LeerlaufMinuten min ohne Aufruf"; continue }
      if (-not $lesen.Wait([int] [Math]::Ceiling($rest))) { continue }
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
  Stop-Java "stdin geschlossen"
}
exit 0
