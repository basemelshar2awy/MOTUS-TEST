<#
 MOTUS - one-click installation.  Run Install-Motus.cmd as Administrator (it calls this file).
 Runs, in order, and stops at the first problem with a plain explanation:
   1-Install-Prerequisites.ps1   Node.js (downloaded + checksum verified) and PostgreSQL (detect / install)
   2-Setup-Database.ps1          database, users, secret config file, migrations, first administrator
   3-Configure-IIS.ps1           checks the IIS site, URL Rewrite, ARR, bindings, certificate
   4-Install-AutoStart.ps1       start at boot + restart after crash + nightly backup
   5-Verify-Deployment.ps1       automated end-to-end verification
 Safe to run again (it never replaces existing passwords or data).
 Options are passed on: -AdminEmail -AdminName -CompanyCode -CompanyName -CompanyAdminEmail -SkipIis -SkipSandbox
#>
[CmdletBinding()]
param([string]$AdminEmail = '', [string]$AdminName = '', [string]$CompanyCode = '', [string]$CompanyName = '', [string]$CompanyAdminEmail = '', [switch]$SkipIis, [switch]$SkipSandbox, [switch]$EnableArrProxy)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'install'
Assert-Admin
Assert-Layout
Get-ChildItem -Path $script:Root -Recurse -Include *.ps1, *.cmd, *.exe -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
function Step([string]$file, [hashtable]$p = @{}) {
    Write-Host ''; Write-Log ('=== ' + $file + ' ===') 'STEP'
    & (Join-Path $PSScriptRoot $file) @p
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Stop-WithError ($file + ' stopped with an error.') 'Read the message above, fix it and run Install-Motus.cmd again - it continues safely.' }
}
Step '1-Install-Prerequisites.ps1'
$db = @{}
if ($AdminEmail) { $db.AdminEmail = $AdminEmail }; if ($AdminName) { $db.AdminName = $AdminName }
if ($CompanyCode) { $db.CompanyCode = $CompanyCode }; if ($CompanyName) { $db.CompanyName = $CompanyName }; if ($CompanyAdminEmail) { $db.CompanyAdminEmail = $CompanyAdminEmail }
Step '2-Setup-Database.ps1' $db
if (-not $SkipIis) { $i = @{}; if ($EnableArrProxy) { $i.EnableArrProxy = $true }; Step '3-Configure-IIS.ps1' $i }
Step '4-Install-AutoStart.ps1'
$v = @{}; if ($SkipIis) { $v.SkipIis = $true }; if ($SkipSandbox) { $v.SkipSandbox = $true }
Step '5-Verify-Deployment.ps1' $v
Write-Host ''
Write-Log 'MOTUS is installed and verified.' 'OK'
$cred = Join-Path $script:ConfigDir 'initial-credentials.txt'
if (Test-Path $cred) { Write-Host ('First administrator sign-in details: ' + $cred + '  (read it, sign in, change the password, then DELETE that file).') -ForegroundColor Yellow }
Write-Host ('Open https://' + $script:Domain + ' in a browser.') -ForegroundColor Green
