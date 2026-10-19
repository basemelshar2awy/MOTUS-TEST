<#
 MOTUS - step 1: prerequisites (Node.js runtime + PostgreSQL).  Run as Administrator.
 * Node.js 22 LTS is downloaded from the official site https://nodejs.org, the ZIP's SHA-256 is compared with the
   official SHASUMS256.txt published by the Node.js project, and node.exe's digital signature (OpenJS Foundation)
   is verified. It is stored privately in C:\Website\Motus\runtime\node (nothing is installed system-wide).
 * PostgreSQL: an existing installation (version 14 or newer) is used when found. If none is found, the official
   Windows installer (EnterpriseDB, the build linked from postgresql.org) is downloaded, its digital signature is
   verified and it is installed silently. The service starts automatically with Windows.
 Options:  -NodeZip <file> -NodeSha256 <hash>   use a ZIP you downloaded yourself (offline server)
           -PostgresInstaller <file>            use an installer you downloaded yourself
           -PostgresBin <folder>                use a specific PostgreSQL "bin" folder
           -SkipPostgres                        PostgreSQL is on another machine (not recommended)
#>
[CmdletBinding()]
param(
    [string]$NodeZip = '', [string]$NodeSha256 = '', [string]$PostgresInstaller = '', [string]$PostgresBin = '',
    [int]$PostgresMajor = 16, [int]$PostgresPort = 5432, [switch]$SkipPostgres, [switch]$SkipSignatureCheck
)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'prerequisites'
Assert-Admin
Assert-Layout

function Test-Signature([string]$File, [string]$ExpectedSigner) {
    if (-not $script:IsWin) { return $true }
    $sig = Get-AuthenticodeSignature -FilePath $File
    if ($sig.Status -ne 'Valid') { return ("signature status is '" + $sig.Status + "'") }
    if ($sig.SignerCertificate.Subject -notlike ("*" + $ExpectedSigner + "*")) { return ("signed by '" + $sig.SignerCertificate.Subject + "', expected '" + $ExpectedSigner + "'") }
    return $true
}

# ------------------------------------------------------------------ Node.js
Write-Log 'Node.js runtime' 'STEP'
$nodeOk = $false
if (Test-Path $script:NodeExe) {
    $v = Invoke-Native $script:NodeExe @('--version')
    if ($v.ExitCode -eq 0 -and $v.Stdout -match '^v(\d+)\.') { if ([int]$Matches[1] -ge 22) { $nodeOk = $true; Write-Log ("Node.js already present: " + $v.Stdout.Trim()) 'OK' } }
}
if (-not $nodeOk) {
    $work = Join-Path $env:TEMP ('motus-node-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    try {
        $zip = $null; $expected = $null; $source = $null
        if ($NodeZip) {
            if (-not (Test-Path $NodeZip)) { Stop-WithError ("File not found: " + $NodeZip) }
            if (-not $NodeSha256) { Stop-WithError 'When you give your own Node.js ZIP you must also give -NodeSha256 (copy it from https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt).' }
            $zip = $NodeZip; $expected = $NodeSha256.ToLower(); $source = 'local file ' + $NodeZip
        } else {
            $base = 'https://nodejs.org/dist/latest-v22.x/'
            Write-Log ("Reading the official checksum list: " + $base + 'SHASUMS256.txt')
            try { $sums = (Invoke-WebRequest -Uri ($base + 'SHASUMS256.txt') -UseBasicParsing -TimeoutSec 60).Content } catch { Stop-WithError ("Could not reach nodejs.org: " + $_.Exception.Message) 'Check that this server can open https://nodejs.org . If it cannot, download "node-v22.x.y-win-x64.zip" and SHASUMS256.txt on another computer, copy them here and run: 1-Install-Prerequisites.ps1 -NodeZip <zip> -NodeSha256 <hash from SHASUMS256.txt>' }
            $line = ($sums -split "`n" | Where-Object { $_ -match '\s(node-v22\.\d+\.\d+-win-x64\.zip)\s*$' } | Select-Object -First 1)
            if (-not $line) { Stop-WithError 'The official checksum list does not contain a Windows x64 ZIP for Node.js 22.' }
            $expected = ($line.Trim() -split '\s+')[0].ToLower(); $name = ($line.Trim() -split '\s+')[1]
            $zip = Join-Path $work $name
            Write-Log ("Downloading " + $name + " ...")
            try { Invoke-WebRequest -Uri ($base + $name) -OutFile $zip -UseBasicParsing -TimeoutSec 900 } catch { Stop-WithError ("Download failed: " + $_.Exception.Message) }
            $source = $base + $name
        }
        $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected) { Stop-WithError ("SHA-256 of the Node.js ZIP does not match the official value. Expected " + $expected + " but the file is " + $actual + ". The file was NOT used.") 'Delete it and download again; if it keeps failing, do not continue and ask your IT contact.' }
        Write-Log ("SHA-256 matches the official checksum (" + $actual + ")") 'OK'
        $ex = Join-Path $work 'x'
        Expand-Archive -Path $zip -DestinationPath $ex -Force
        $inner = Get-ChildItem -Path $ex -Directory | Select-Object -First 1
        if (-not $inner -or -not (Test-Path (Join-Path $inner.FullName 'node.exe'))) { Stop-WithError 'The Node.js ZIP does not contain node.exe.' }
        if (-not $SkipSignatureCheck) {
            $sg = Test-Signature (Join-Path $inner.FullName 'node.exe') 'OpenJS Foundation'
            if ($sg -ne $true) { Stop-WithError ("node.exe digital signature check failed: " + $sg) 'Do not continue. (Use -SkipSignatureCheck only if you verified the file another way.)' }
            Write-Log 'node.exe is signed by the OpenJS Foundation (valid signature)' 'OK'
        }
        $dest = Join-Path $script:RuntimeDir 'node'
        if (Test-Path $dest) { Remove-Item -Path $dest -Recurse -Force }
        New-Item -ItemType Directory -Path $script:RuntimeDir -Force | Out-Null
        Move-Item -Path $inner.FullName -Destination $dest
        $v = Invoke-Native $script:NodeExe @('--version')
        if ($v.ExitCode -ne 0) { Stop-WithError ("node.exe does not run: " + $v.Stderr) }
        Set-Content -Path (Join-Path $dest 'MOTUS-SOURCE.txt') -Value @("Node.js $($v.Stdout.Trim())", "Source: $source", "SHA-256: $actual", ("Installed: " + (Get-Date -Format 'o'))) -Encoding UTF8
        Write-Log ("Node.js " + $v.Stdout.Trim() + " installed in " + $dest) 'OK'
    } finally { Remove-Item -Path $work -Recurse -Force -ErrorAction SilentlyContinue }
}
# the app files are read by the service account; the runtime folder is read-only for it
if ($script:IsWin) {
    foreach ($d in @($script:AppDir, $script:RuntimeDir)) { $r = Invoke-Native 'icacls.exe' @($d, '/grant', '*S-1-5-19:(OI)(CI)RX', '/T', '/C', '/Q'); if ($r.ExitCode -ne 0) { Write-Log ("icacls warning: " + $r.Stderr) 'WARN' } }
}

# ------------------------------------------------------------------ PostgreSQL
Write-Log 'PostgreSQL' 'STEP'
if ($SkipPostgres) { Write-Log 'PostgreSQL step skipped as requested.' 'WARN'; Write-Log 'Prerequisites finished.' 'OK'; exit 0 }
$pg = Find-Postgres $PostgresBin
if ($pg) {
    Write-Log ("Found PostgreSQL " + $pg.Major + " in " + $pg.Bin) 'OK'
    if ($pg.Service) {
        Write-Log ("Service: " + $pg.Service.Name + " (" + $pg.Service.Status + ")")
        try { Set-Service -Name $pg.Service.Name -StartupType Automatic } catch { Write-Log ("Could not set automatic start: " + $_.Exception.Message) 'WARN' }
        if ($pg.Service.Status -ne 'Running') { Start-Service -Name $pg.Service.Name }
    }
    Write-Log 'Prerequisites finished.' 'OK'
    exit 0
}
Write-Log ('No supported PostgreSQL (14 or newer) was found. Installing the official PostgreSQL ' + $PostgresMajor) 'INFO'
$installer = $PostgresInstaller
$work = Join-Path $env:TEMP ('motus-pg-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    if (-not $installer) {
        $minor = $null
        try { $vj = Invoke-RestMethod -Uri 'https://www.postgresql.org/versions.json' -TimeoutSec 60; $minor = ($vj | Where-Object { [string]$_.major -eq [string]$PostgresMajor } | Select-Object -First 1).latestMinor } catch { Write-Log ("Could not read the PostgreSQL version list: " + $_.Exception.Message) 'WARN' }
        $candidates = @()
        if ($minor) { foreach ($b in 1, 2, 3) { $candidates += ("postgresql-{0}.{1}-{2}-windows-x64.exe" -f $PostgresMajor, $minor, $b) } }
        else { foreach ($m in 30..8) { $candidates += ("postgresql-{0}.{1}-1-windows-x64.exe" -f $PostgresMajor, $m) } }
        foreach ($c in $candidates) {
            $url = 'https://get.enterprisedb.com/postgresql/' + $c
            try { $h = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 30; if ($h.StatusCode -eq 200) { $installer = Join-Path $work $c; Write-Log ("Downloading " + $url + " (about 300 MB) ..."); Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing -TimeoutSec 3600; break } } catch { }
        }
        if (-not $installer -or -not (Test-Path $installer)) { Stop-WithError 'Could not download the PostgreSQL installer automatically.' ('Open https://www.postgresql.org/download/windows/ on any computer, download the PostgreSQL ' + $PostgresMajor + ' Windows x64 installer, copy it to this server and run: 1-Install-Prerequisites.ps1 -PostgresInstaller <path to the .exe>') }
    } elseif (-not (Test-Path $installer)) { Stop-WithError ("File not found: " + $installer) }
    $hash = (Get-FileHash -Path $installer -Algorithm SHA256).Hash
    Write-Log ("Installer SHA-256: " + $hash + "  (you can compare it with the value shown on the EnterpriseDB download page)")
    if (-not $SkipSignatureCheck) {
        $sg = Test-Signature $installer 'EnterpriseDB'
        if ($sg -ne $true) { Stop-WithError ("The PostgreSQL installer's digital signature is not valid: " + $sg) 'Do not run it. Download the installer again from https://www.postgresql.org/download/windows/ .' }
        Write-Log 'Installer is signed by EnterpriseDB (valid signature)' 'OK'
    }
    $superPw = New-Secret 28
    $prefix = "C:\Program Files\PostgreSQL\$PostgresMajor"
    $svcName = "postgresql-x64-$PostgresMajor"
    Write-Log 'Installing PostgreSQL silently (this takes a few minutes) ...'
    $args = @('--mode', 'unattended', '--unattendedmodeui', 'none', '--superpassword', $superPw, '--serverport', [string]$PostgresPort, '--servicename', $svcName, '--prefix', $prefix, '--datadir', "$prefix\data", '--enable-components', 'server,commandlinetools', '--disable-components', 'pgAdmin,stackbuilder')
    $r = Invoke-Native $installer $args @{} $null 3600
    if ($r.ExitCode -ne 0) { Stop-WithError ("The PostgreSQL installer failed (exit code " + $r.ExitCode + "): " + $r.Stderr + $r.Stdout) ('Look at the installer log in %TEMP% (install-postgresql.log), fix the reason, and run this script again.') }
    # keep the superuser password for the database setup step (administrators + SYSTEM only)
    if (-not (Test-Path $script:ConfigDir)) { New-Item -ItemType Directory -Path $script:ConfigDir -Force | Out-Null }
    Set-SecretAcl $script:ConfigDir ''
    $pf = Join-Path $script:ConfigDir 'postgres-superuser.txt'
    Set-Content -Path $pf -Value @('PostgreSQL administrator ("postgres") password - created by the MOTUS installer.', 'Needed only for database repairs. Keep it safe; you may delete this file after saving the password elsewhere.', ('USER=postgres'), ('PASSWORD=' + $superPw), ('PORT=' + $PostgresPort)) -Encoding UTF8
    Set-SecretAcl $pf ''
    Write-Log ("PostgreSQL installed. The administrator password was saved (restricted) in " + $pf) 'OK'
    $pg = Find-Postgres ''
    if (-not $pg) { Stop-WithError 'PostgreSQL was installed but could not be found afterwards.' ('Check C:\Program Files\PostgreSQL and run 2-Setup-Database.ps1 -PostgresBin <bin folder>.') }
    if ($pg.Service) { Set-Service -Name $pg.Service.Name -StartupType Automatic; if ($pg.Service.Status -ne 'Running') { Start-Service -Name $pg.Service.Name } }
} finally { Remove-Item -Path $work -Recurse -Force -ErrorAction SilentlyContinue }
Write-Log 'Prerequisites finished.' 'OK'
