<#
.SYNOPSIS
  Hinterlegt die ELO-Zugangsdaten verschluesselt fuer elo-mcp.ps1.

.DESCRIPTION
  Fragt Benutzer und Passwort ab und legt sie als PSCredential (Export-CliXml) ab.
  Die Verschluesselung erfolgt ueber die Windows-DPAPI: die Datei laesst sich nur von
  diesem Windows-Konto auf diesem Rechner wieder entschluesseln. Auf einen anderen
  Rechner oder ein anderes Konto kopiert ist sie wertlos.

  Das Passwort wird verdeckt eingegeben und nirgends im Klartext gespeichert.
  Bitte selbst im Terminal ausfuehren - nicht von einer KI eintippen lassen.

.EXAMPLE
  .\Set-EloCredential.ps1
.EXAMPLE
  .\Set-EloCredential.ps1 -UserName "Mustermann, Max" -CredentialFile "$env:LOCALAPPDATA\elo-mcp\elo-test.xml"
#>
[CmdletBinding()]
param(
  [string] $UserName,
  [string] $CredentialFile = (Join-Path $env:LOCALAPPDATA "elo-mcp\elo-credential.xml")
)

$ErrorActionPreference = "Stop"

if (-not $UserName) {
  $UserName = Read-Host "ELO-Benutzername (Anmeldename oder 'Nachname, Vorname')"
}
$secret = Read-Host "Passwort fuer '$UserName'" -AsSecureString

$dir = Split-Path -Parent $CredentialFile
if ($dir -and -not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Force $dir) }

$cred = New-Object System.Management.Automation.PSCredential($UserName, $secret)
$cred | Export-CliXml -Path $CredentialFile

# Datei nur fuer den eigenen Benutzer lesbar machen
$ich = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl $CredentialFile
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($ich, "FullControl", "Allow")))
Set-Acl -Path $CredentialFile -AclObject $acl

Write-Host ""
Write-Host "Gespeichert: $CredentialFile"
Write-Host "Verschluesselt fuer $env:USERDOMAIN\$env:USERNAME auf $env:COMPUTERNAME."
Write-Host ""
Write-Host "Verbindung testen:"
Write-Host "  python -I test\test-mcp.py test\beispiel-lesen.json -- -IxUrl <IX-URL>"
