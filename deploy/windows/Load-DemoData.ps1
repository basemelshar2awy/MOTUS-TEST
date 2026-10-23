<#
 MOTUS - load the review companies with sample data (TEST SERVERS ONLY).  Run as Administrator.
 Usage: .\Load-DemoData.ps1                     (sign-in e-mails end in @motus.test)
        .\Load-DemoData.ps1 -Domain example.com
 Adds companies whose codes start with D: one per activity (DTR tourism, DSC schools, DST staff,
 DIC intercity, DCG cargo), DMX with two activities, DKS in Saudi Arabia and DNW new without data;
 fills them with sample data (lines, shipments with delivery codes), one driver working for two
 companies, a truck driver with an open shipment, and operating contracts.
 Prints every sign-in with a temporary password (shown once). Runs only once per database.
#>
[CmdletBinding()]
param([string]$Domain = 'motus.test')
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'demo-data'
Assert-Admin
Write-Host ''
Write-Host 'This adds REVIEW companies with sample data to this server''s database.' -ForegroundColor Yellow
Write-Host 'Use it on a test server only.' -ForegroundColor Yellow
$ok = Read-Host 'Type YES to continue'
if ($ok -cne 'YES') { Write-Log 'Cancelled - nothing changed.' 'INFO'; exit 0 }
$r = Invoke-Node @((Join-Path $script:AppDir 'server\tools\demo-data.js'), '--yes', '--domain', $Domain)
if ($r.ExitCode -ne 0) { Stop-WithError ('Loading the review data failed: ' + ($r.Stderr + $r.Stdout).Trim()) 'Is PostgreSQL running and the update applied (migrations 003-008)?' }
Write-Host $r.Stdout
$out = Join-Path $script:Root ('demo-sign-ins-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
Set-Content -Path $out -Value $r.Stdout -Encoding UTF8
Write-Log ('Done. The sign-ins were also saved to ' + $out + ' - delete that file after you copy them.') 'OK'
