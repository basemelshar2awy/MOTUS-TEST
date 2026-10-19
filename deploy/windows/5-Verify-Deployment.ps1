<#
 MOTUS - step 5: automated deployment verification.  Run as Administrator.  Writes logs\verify-*.log.
 Checks, in order:
   A. the scheduled tasks exist and the app is running; port 3000 listens ONLY on 127.0.0.1; /healthz answers
   B. the application test (server\tools\verify.js): configuration, database connection, migration status, row level
      security, administrator exists, then on a THROW-AWAY database: admin sign-in + forced password change, real
      create / read / update, booking->trip->invoice->payment, company isolation, data still there after an app restart.
      (Your real data is never modified.)
   C. IIS and the domain: HTTP->HTTPS redirect, validation file, HTTPS certificate covers motus.sabeelbus.com,
      the home page and /healthz through https://motus.sabeelbus.com (from this server), public IP is only informational
 Options: -SkipSandbox (skip the throw-away database test)  -SkipIis (only test the application and database)
 Exit code 0 = ready. Anything else = NOT ready (the failing lines say what to fix).
#>
[CmdletBinding()]
param([switch]$SkipSandbox, [switch]$SkipIis)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'verify'
Assert-Admin
Assert-Layout
$fail = 0; $warn = 0
function Pass([string]$m) { Write-Log $m 'OK' }
function Fail([string]$m, [string]$fix = '') { $script:fail++; Write-Log ($m + $(if ($fix) { '  ->  ' + $fix } else { '' })) 'ERROR' }
function Warn([string]$m) { $script:warn++; Write-Log $m 'WARN' }

Write-Log 'A. Application process' 'STEP'
if ($script:IsWin) {
    foreach ($tn in @($script:TaskName, $script:BackupTask)) {
        $t = Get-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue
        if ($t) { Pass ("Scheduled task " + $tn + " exists (state " + $t.State + ")") } else { Fail ("Scheduled task " + $tn + " is missing") 'Run 4-Install-AutoStart.ps1' }
    }
    $t = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
    if ($t -and ($t.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' })) { Pass 'Motus-App starts at boot' } elseif ($t) { Fail 'Motus-App has no boot trigger' 'Run 4-Install-AutoStart.ps1' }
    $pgSvc = Get-Service | Where-Object { $_.Name -like 'postgresql*' } | Select-Object -First 1
    if ($pgSvc -and $pgSvc.Status -eq 'Running' -and $pgSvc.StartType -eq 'Automatic') { Pass ("PostgreSQL service " + $pgSvc.Name + " is running and starts automatically") } elseif ($pgSvc) { Fail ("PostgreSQL service " + $pgSvc.Name + " is " + $pgSvc.Status + " / " + $pgSvc.StartType) 'Set it to Automatic and start it (services.msc).' } else { Warn 'No Windows service named postgresql* found (PostgreSQL may be remote or named differently).' }
}
if (-not (Wait-MotusHealthy 10)) {
    Fail 'http://127.0.0.1:3000/healthz does not answer' 'Run Start-Motus.cmd and read logs\node-err.log and logs\supervisor.log'
} else {
    Pass 'http://127.0.0.1:3000/healthz answers (the application is running and connected to the database)'
    if ($script:IsWin) {
        $l = @(Get-NetTCPConnection -State Listen -LocalPort $script:AppPort -ErrorAction SilentlyContinue)
        $nonLoop = @($l | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })
        if ($l.Count -eq 0) { Fail 'Nothing is listening on port 3000' }
        elseif ($nonLoop.Count) { Fail ("Port 3000 listens on " + (($nonLoop | ForEach-Object { $_.LocalAddress }) -join ', ') + " - it must listen only on 127.0.0.1") 'Check MOTUS_HOST in config\motus.env' }
        else { Pass 'Port 3000 listens only on 127.0.0.1' }
    }
    $h = Invoke-HttpRaw '127.0.0.1' $script:AppPort '/' ''
    if ($h.Status -eq 200 -and $h.Body -match '<html') { Pass 'Home page is served by the application' } else { Fail ("Home page returned status " + $h.Status) }
    $s = Invoke-HttpRaw '127.0.0.1' $script:AppPort '/api/session' ''
    if ($s.Status -eq 200) { Pass 'API answers (not signed in)' } else { Fail ("/api/session returned " + $s.Status) }
}

Write-Log 'B. Database and application workflows (server\tools\verify.js)' 'STEP'
$vargs = @((Join-Path $script:AppDir 'server\tools\verify.js'))
if ($SkipSandbox) { $vargs += '--skip-sandbox' }
$r = Invoke-Node $vargs @{} $null 1800
foreach ($line in (($r.Stdout + "`n" + $r.Stderr) -split "`r?`n")) { if ($line.Trim()) { Write-Host ('    ' + $line); Add-Content -Path $script:LogFile -Value ('    ' + $line) -Encoding UTF8 } }
if ($r.ExitCode -eq 0) { Pass 'verify.js: every database / workflow / isolation check passed' } else { Fail ("verify.js reported failures (exit code " + $r.ExitCode + ")") 'Fix the [FAIL] lines above.' }

if (-not $SkipIis) {
    Write-Log 'C. IIS and the domain' 'STEP'
    $a = Invoke-HttpRaw '127.0.0.1' 80 '/motus-iis-check.txt' $script:Domain
    if ($a.Status -eq 200 -and $a.Body -match 'MOTUS IIS check') { Pass 'IIS site motus serves the validation file on port 80' } else { Fail ("Validation file over HTTP: status " + $a.Status + " " + $a.Error) 'Run 3-Configure-IIS.ps1' }
    $b = Invoke-HttpRaw '127.0.0.1' 80 '/dashboard' $script:Domain
    if ($b.Status -eq 301 -and $b.Headers['location'] -eq ('https://' + $script:Domain + '/dashboard')) { Pass 'HTTP is redirected (301) to HTTPS' } else { Fail ("HTTP->HTTPS redirect: status " + $b.Status + " location " + $b.Headers['location']) 'Run 3-Configure-IIS.ps1' }
    $c = Invoke-HttpRaw '127.0.0.1' 443 '/healthz' $script:Domain $true $script:Domain
    if ($c.Status -eq 200 -and $c.Body -match '"ok":true') { Pass 'https://motus.sabeelbus.com/healthz reaches the application through IIS' } else { Fail ("HTTPS /healthz through IIS: status " + $c.Status + " " + $c.Error) 'Check ARR proxy is enabled and the rewrite rule is active (3-Configure-IIS.ps1)' }
    if ($c.CertNames) {
        if (Test-CertCoversHost $c.CertNames $script:Domain) { Pass ("TLS certificate covers " + $script:Domain + " (valid until " + $c.CertNotAfter.ToString('yyyy-MM-dd') + ")") } else { Fail ("TLS certificate does not cover " + $script:Domain + ": " + ($c.CertNames -join ', ')) 'Bind a certificate that includes this name.' }
        if ($c.CertNotAfter -lt (Get-Date)) { Fail 'The TLS certificate has expired' }
        if ($c.TlsErrors -ne 'None' -and $c.TlsErrors -ne '') { Warn ("Windows does not fully trust the chain from this server: " + $c.TlsErrors + " (install the intermediate certificate if browsers complain)") }
    }
    $d = Invoke-HttpRaw '127.0.0.1' 443 '/' $script:Domain $true $script:Domain
    if ($d.Status -eq 200 -and $d.Body -match '<html') { Pass 'Home page loads through HTTPS' } else { Fail ("Home page through HTTPS: status " + $d.Status) }
    if ($d.Headers['strict-transport-security']) { Pass 'HSTS header present' } else { Warn 'No Strict-Transport-Security header seen' }
    $e = Invoke-HttpRaw '127.0.0.1' 443 '/api/snapshot' $script:Domain $true $script:Domain
    if ($e.Status -eq 401) { Pass 'API refuses unauthenticated access through IIS (401)' } else { Fail ("Unauthenticated /api/snapshot returned " + $e.Status + " (expected 401)") }
    $f = Invoke-HttpRaw '127.0.0.1' 443 '/config/motus.env' $script:Domain $true $script:Domain
    if ($f.Status -ne 200 -or $f.Body -notmatch 'PGPASSWORD|MOTUS_DB') { Pass 'Configuration file is not reachable from the web' } else { Fail 'config\motus.env is downloadable from the web!' 'Stop the site and fix the IIS physical path immediately.' }
    try { $dns = [System.Net.Dns]::GetHostAddresses($script:Domain) | ForEach-Object { $_.IPAddressToString }; if ($dns -contains '45.85.147.186') { Pass 'DNS points motus.sabeelbus.com at 45.85.147.186' } else { Warn ("DNS for " + $script:Domain + " resolves to " + ($dns -join ', ') + " (expected 45.85.147.186). Check the DNS record if users cannot reach the site.") } } catch { Warn ('DNS lookup failed: ' + $_.Exception.Message) }
}
Write-Host ''
if ($fail -gt 0) { Write-Log ("NOT READY: " + $fail + " check(s) failed, " + $warn + " warning(s). Log: " + $script:LogFile) 'ERROR'; exit 1 }
Write-Log ("READY: all checks passed (" + $warn + " warning(s)). Log: " + $script:LogFile) 'OK'
