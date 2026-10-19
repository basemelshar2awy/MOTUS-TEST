# MOTUS Fleet - shared helpers for the install / maintenance scripts.
# Written for Windows PowerShell 5.1 (Windows Server 2022). Dot-source this file; do not run it directly.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

$script:IsWin = ($env:OS -eq 'Windows_NT')
if ($env:MOTUS_ROOT) { $script:Root = $env:MOTUS_ROOT } else { $script:Root = Split-Path -Parent $PSScriptRoot }
$script:AppDir     = Join-Path $script:Root 'app'
$script:ConfigDir  = Join-Path $script:Root 'config'
$script:EnvFile    = Join-Path $script:ConfigDir 'motus.env'
$script:RuntimeDir = Join-Path $script:Root 'runtime'
$script:LogDir     = Join-Path $script:Root 'logs'
$script:BackupDir  = Join-Path $script:Root 'backups'
$script:IisDir     = Join-Path $script:Root 'iis'
if ($env:MOTUS_NODE_EXE) { $script:NodeExe = $env:MOTUS_NODE_EXE } else { $script:NodeExe = Join-Path $script:RuntimeDir 'node\node.exe' }
$script:Domain     = 'motus.sabeelbus.com'
$script:SiteName   = 'motus'
$script:SiteId     = 29
$script:AppPort    = 3000
$script:TaskName   = 'Motus-App'
$script:BackupTask = 'Motus-Backup'
$script:LogFile    = $null

# ---------------------------------------------------------------- logging / errors
function Start-MotusLog([string]$Name) {
    if (-not (Test-Path $script:LogDir)) { New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null }
    $script:LogFile = Join-Path $script:LogDir ("{0}-{1}.log" -f $Name, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Add-Content -Path $script:LogFile -Value ("MOTUS {0} started {1} as {2} on {3}" -f $Name, (Get-Date -Format 'o'), [Environment]::UserName, [Environment]::MachineName) -Encoding UTF8
}
function Write-Log([string]$Message, [string]$Level = 'INFO') {
    $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    if ($script:LogFile) { try { Add-Content -Path $script:LogFile -Value $line -Encoding UTF8 } catch { } }
    switch ($Level) {
        'ERROR' { Write-Host $Message -ForegroundColor Red }
        'WARN'  { Write-Host ("WARNING: " + $Message) -ForegroundColor Yellow }
        'OK'    { Write-Host ("[OK] " + $Message) -ForegroundColor Green }
        'STEP'  { Write-Host ""; Write-Host ("=== " + $Message + " ===") -ForegroundColor Cyan }
        default { Write-Host $Message }
    }
}
function Stop-WithError([string]$Message, [string]$Fix = '') {
    Write-Log '' 'INFO'
    Write-Log ("STOPPED: " + $Message) 'ERROR'
    if ($Fix) { Write-Log ("What to do: " + $Fix) 'ERROR' }
    if ($script:LogFile) { Write-Host ("Details were saved in: " + $script:LogFile) -ForegroundColor Yellow }
    exit 1
}
function Test-IsAdmin {
    if (-not $script:IsWin) { return $true }
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Assert-Admin {
    if (-not (Test-IsAdmin)) { Stop-WithError 'This script must run as Administrator.' 'Right-click the file (or Command Prompt / PowerShell) and choose "Run as administrator", then run it again.' }
}
function Assert-Layout {
    if (-not (Test-Path (Join-Path $script:AppDir 'server.js'))) { Stop-WithError ("The application files were not found in " + $script:AppDir) 'Extract the deployment ZIP into C:\Website\Motus so that C:\Website\Motus\app\server.js exists.' }
}

# ---------------------------------------------------------------- secrets / env file
function New-Secret([int]$Length = 32, [string]$Alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $sb = New-Object System.Text.StringBuilder
        $buf = New-Object byte[] 1
        $limit = 256 - (256 % $Alphabet.Length)
        while ($sb.Length -lt $Length) { $rng.GetBytes($buf); if ($buf[0] -lt $limit) { [void]$sb.Append($Alphabet[$buf[0] % $Alphabet.Length]) } }
        return $sb.ToString()
    } finally { $rng.Dispose() }
}
function New-HexKey([int]$Bytes = 32) {
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $b = New-Object byte[] $Bytes; $rng.GetBytes($b); return (($b | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $rng.Dispose() }
}
function Read-EnvFile([string]$Path = $script:EnvFile) {
    $h = [ordered]@{}
    if (-not (Test-Path $Path)) { return $h }
    foreach ($raw in (Get-Content -Path $Path -Encoding UTF8)) {
        $line = $raw.Trim()
        if (-not $line -or $line.StartsWith('#')) { continue }
        $i = $line.IndexOf('=')
        if ($i -lt 1) { continue }
        $h[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
    }
    return $h
}
function Write-EnvFile([hashtable]$Values, [string]$Path = $script:EnvFile) {
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $lines = @('# MOTUS server configuration - SECRET FILE. Never copy it into e-mails, tickets or the web folder.', ('# Written by the MOTUS setup scripts ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')))
    foreach ($k in $Values.Keys) { $lines += ("{0}={1}" -f $k, $Values[$k]) }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, (($lines -join "`r`n") + "`r`n"), $enc)
}
# Locks a file/folder to SYSTEM + Administrators (full) and, optionally, LOCAL SERVICE (read or modify).
function Set-SecretAcl([string]$Path, [string]$ServiceAccess = 'R') {
    if (-not $script:IsWin) { return }
    $grants = @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
    if ($ServiceAccess) { $grants += ('*S-1-5-19:(OI)(CI)' + $ServiceAccess) }
    $args = @($Path, '/inheritance:r', '/grant:r') + $grants
    $r = Invoke-Native 'icacls.exe' $args
    if ($r.ExitCode -ne 0) { Stop-WithError ("Could not restrict permissions on " + $Path + ": " + $r.Stderr + $r.Stdout) 'Run the script as Administrator.' }
}

# ---------------------------------------------------------------- running programs (robust stdout/stderr capture)
function ConvertTo-QuotedArg([string]$a) {
    if ($a -eq '') { return '""' }
    if ($a -notmatch '[\s"]') { return $a }
    return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}
function Invoke-Native([string]$File, [string[]]$Arguments = @(), [hashtable]$Env = @{}, [string]$Stdin = $null, [int]$TimeoutSec = 3600) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File
    $psi.Arguments = (($Arguments | ForEach-Object { ConvertTo-QuotedArg ([string]$_) }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = ($Stdin -ne $null)
    $psi.CreateNoWindow = $true
    foreach ($k in $Env.Keys) { $psi.EnvironmentVariables[$k] = [string]$Env[$k] }
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    if ($Stdin -ne $null) { $p.StandardInput.Write($Stdin); $p.StandardInput.Close() }
    $o = $p.StandardOutput.ReadToEndAsync()
    $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { try { $p.Kill() } catch { } return [pscustomobject]@{ ExitCode = 124; Stdout = ''; Stderr = "timed out after $TimeoutSec seconds" } }
    $p.WaitForExit()
    return [pscustomobject]@{ ExitCode = $p.ExitCode; Stdout = $o.Result; Stderr = $e.Result }
}
function Get-NodeExe {
    if (-not (Test-Path $script:NodeExe)) { Stop-WithError ("Node.js was not found at " + $script:NodeExe) 'Run 1-Install-Prerequisites.ps1 (it downloads and verifies Node.js).' }
    return $script:NodeExe
}
# Runs a Node script of the app with the production configuration.
function Invoke-Node([string[]]$Arguments, [hashtable]$Env = @{}, [string]$Stdin = $null, [int]$TimeoutSec = 3600) {
    $e = @{ MOTUS_ROOT = $script:Root; MOTUS_CONFIG = $script:EnvFile }
    foreach ($k in $Env.Keys) { $e[$k] = $Env[$k] }
    return Invoke-Native (Get-NodeExe) $Arguments $e $Stdin $TimeoutSec
}

# ---------------------------------------------------------------- PostgreSQL discovery / psql
function Resolve-PgExe([string]$Bin, [string]$Name) {
    foreach ($n in @(($Name + '.exe'), $Name)) { $p = Join-Path $Bin $n; if (Test-Path $p) { return $p } }
    return $null
}
function Find-Postgres([string]$ExplicitBin = '') {
    $bins = @()
    if ($ExplicitBin) { $bins += $ExplicitBin }
    elseif ($script:IsWin) {
        try {
            foreach ($k in (Get-ChildItem 'HKLM:\SOFTWARE\PostgreSQL\Installations' -ErrorAction SilentlyContinue)) {
                $base = (Get-ItemProperty $k.PSPath).'Base Directory'
                if ($base) { $bins += (Join-Path $base 'bin') }
            }
        } catch { }
        foreach ($v in 17, 16, 15, 14) { $bins += ("C:\Program Files\PostgreSQL\$v\bin") }
        try {
            foreach ($s in (Get-CimInstance Win32_Service -Filter "Name LIKE 'postgresql%'" -ErrorAction SilentlyContinue)) {
                if ($s.PathName -match '"?([^"]*\\bin)\\pg_ctl\.exe') { $bins += $Matches[1] }
            }
        } catch { }
    } else { $bins += '/usr/lib/postgresql/16/bin' }
    foreach ($b in ($bins | Select-Object -Unique)) {
        $psql = Resolve-PgExe $b 'psql'
        if (-not $psql) { continue }
        $r = Invoke-Native $psql @('--version')
        if ($r.ExitCode -ne 0 -or $r.Stdout -notmatch '(\d+)(\.\d+)?') { continue }
        $major = [int]$Matches[1]
        if ($major -lt 14) { continue }
        $svc = $null
        if ($script:IsWin) { $svc = Get-Service | Where-Object { $_.Name -like 'postgresql*' } | Sort-Object Name -Descending | Select-Object -First 1 }
        return [pscustomobject]@{ Bin = $b; Psql = $psql; PgDump = (Resolve-PgExe $b 'pg_dump'); PgRestore = (Resolve-PgExe $b 'pg_restore'); Major = $major; Service = $svc }
    }
    return $null
}
function Invoke-Psql($Pg, [string]$HostName, [int]$Port, [string]$User, [string]$Password, [string]$Database, [string]$Sql, [switch]$Scalar) {
    $a = @('-h', $HostName, '-p', [string]$Port, '-U', $User, '-d', $Database, '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t', '-c', $Sql)
    $r = Invoke-Native $Pg.Psql $a @{ PGPASSWORD = $Password; PGCONNECT_TIMEOUT = '10' }
    if ($r.ExitCode -ne 0) { throw ("psql failed: " + $r.Stderr.Trim()) }
    if ($Scalar) { return $r.Stdout.Trim() }
    return $r
}
function Format-SqlLiteral([string]$s) { return "'" + $s.Replace("'", "''") + "'" }
function Get-MotusEnv {
    if (-not (Test-Path $script:EnvFile)) { Stop-WithError ("Configuration file not found: " + $script:EnvFile) 'Run 2-Setup-Database.ps1 first (it creates the file).' }
    $e = Read-EnvFile
    foreach ($k in 'PGHOST', 'PGPORT', 'PGDATABASE', 'MOTUS_DB_APP_USER', 'MOTUS_DB_APP_PASSWORD', 'MOTUS_DB_OWNER_USER', 'MOTUS_DB_OWNER_PASSWORD') {
        if (-not $e.Contains($k) -or -not $e[$k]) { Stop-WithError ("The configuration file is missing " + $k) 'Run 2-Setup-Database.ps1 again; it repairs the file without changing existing secrets.' }
    }
    return $e
}

# ---------------------------------------------------------------- app control
function Get-NodeProcesses {
    if (-not $script:IsWin) { return @() }
    $needle = (Join-Path $script:AppDir 'server.js')
    return @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) })
}
function Stop-MotusApp {
    $flag = Join-Path $script:RuntimeDir 'stop.flag'
    if (-not (Test-Path $script:RuntimeDir)) { New-Item -ItemType Directory -Path $script:RuntimeDir -Force | Out-Null }
    Set-Content -Path $flag -Value (Get-Date -Format 'o') -Encoding ASCII
    if ($script:IsWin) {
        $t = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
        if ($t -and $t.State -eq 'Running') { Stop-ScheduledTask -TaskName $script:TaskName }
        foreach ($p in (Get-NodeProcesses)) { try { Stop-Process -Id $p.ProcessId -Force } catch { } }
        for ($i = 0; $i -lt 30 -and (Get-NodeProcesses).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
    }
}
function Start-MotusApp {
    $flag = Join-Path $script:RuntimeDir 'stop.flag'
    if (Test-Path $flag) { Remove-Item $flag -Force }
    if ($script:IsWin) {
        $t = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
        if (-not $t) { Stop-WithError 'The MOTUS auto-start task is not installed.' 'Run 4-Install-AutoStart.ps1.' }
        Start-ScheduledTask -TaskName $script:TaskName
    }
}
function Wait-MotusHealthy([int]$TimeoutSec = 60) {
    $url = "http://127.0.0.1:$($script:AppPort)/healthz"
    $until = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $until) {
        try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { return $true } } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}
function Get-LastLines([string]$Path, [int]$N = 15) {
    if (Test-Path $Path) { return ((Get-Content -Path $Path -Tail $N -ErrorAction SilentlyContinue) -join "`n") }
    return ''
}

# ---------------------------------------------------------------- database context / backup helpers
function Get-DbContext {
    $cfg = Get-MotusEnv
    $bin = ''
    if ($env:MOTUS_PG_BIN) { $bin = $env:MOTUS_PG_BIN }
    $pg = Find-Postgres $bin
    if (-not $pg) { Stop-WithError 'PostgreSQL command-line tools were not found.' 'Run 1-Install-Prerequisites.ps1, or set the environment variable MOTUS_PG_BIN to the PostgreSQL "bin" folder.' }
    return [pscustomobject]@{ Cfg = $cfg; Pg = $pg; Host = $cfg['PGHOST']; Port = [int]$cfg['PGPORT']; Db = $cfg['PGDATABASE']; Owner = $cfg['MOTUS_DB_OWNER_USER']; OwnerPw = $cfg['MOTUS_DB_OWNER_PASSWORD']; App = $cfg['MOTUS_DB_APP_USER']; AppPw = $cfg['MOTUS_DB_APP_PASSWORD'] }
}
function Invoke-OwnerSql($Ctx, [string]$Sql, [string]$Database = '') {
    if (-not $Database) { $Database = $Ctx.Db }
    return Invoke-Psql $Ctx.Pg $Ctx.Host $Ctx.Port $Ctx.Owner $Ctx.OwnerPw $Database $Sql -Scalar
}
function New-DatabaseBackup($Ctx, [string]$File) {
    if (-not $Ctx.Pg.PgDump) { Stop-WithError 'pg_dump was not found.' 'Reinstall PostgreSQL with the command-line tools.' }
    $dir = Split-Path -Parent $File
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null; Set-SecretAcl $dir '' }
    $r = Invoke-Native $Ctx.Pg.PgDump @('-h', $Ctx.Host, '-p', [string]$Ctx.Port, '-U', $Ctx.Owner, '-d', $Ctx.Db, '-Fc', '-Z', '6', '--no-owner', '--no-privileges', '-f', $File) @{ PGPASSWORD = $Ctx.OwnerPw } $null 7200
    if ($r.ExitCode -ne 0) { if (Test-Path $File) { Remove-Item $File -Force }; throw ("pg_dump failed: " + $r.Stderr.Trim()) }
    if (-not (Test-Path $File) -or (Get-Item $File).Length -lt 1024) { throw 'The backup file is empty or missing.' }
    $l = Invoke-Native $Ctx.Pg.PgRestore @('--list', $File)
    if ($l.ExitCode -ne 0) { throw ("The backup file failed its integrity check (pg_restore --list): " + $l.Stderr.Trim()) }
    $sha = (Get-FileHash -Path $File -Algorithm SHA256).Hash.ToLower()
    Set-Content -Path ($File + '.sha256') -Value ("{0}  {1}" -f $sha, (Split-Path -Leaf $File)) -Encoding ASCII
    Set-SecretAcl $File ''
    Set-SecretAcl ($File + '.sha256') ''
    return [pscustomobject]@{ File = $File; Bytes = (Get-Item $File).Length; Sha256 = $sha }
}
function Get-TableCounts($Ctx, [string]$Database) {
    $gen = "SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM public.%I', tablename, tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'"
    $q = Invoke-OwnerSql $Ctx $gen $Database
    $r = Invoke-Psql $Ctx.Pg $Ctx.Host $Ctx.Port $Ctx.Owner $Ctx.OwnerPw $Database $q
    $h = @{}
    foreach ($l in ($r.Stdout -split "`r?`n")) { if ($l -match '^([^|]+)\|(\d+)$') { $h[$Matches[1]] = [int64]$Matches[2] } }
    return $h
}

# ---------------------------------------------------------------- tiny raw HTTP/HTTPS clients (control Host header and SNI)
function Invoke-HttpRaw([string]$HostName, [int]$Port, [string]$PathAndQuery = '/', [string]$HostHeader = '', [bool]$Tls = $false, [string]$Sni = '') {
    $res = [ordered]@{ Ok = $false; Status = 0; Headers = @{}; Body = ''; Error = ''; CertSubject = ''; CertNames = @(); CertNotAfter = $null; TlsErrors = 'None' }
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(8000)) { $res.Error = "connection to ${HostName}:$Port timed out"; return [pscustomobject]$res }
        $client.EndConnect($iar)
        $stream = $client.GetStream(); $stream.ReadTimeout = 15000; $stream.WriteTimeout = 15000
        if ($Tls) {
            $captured = @{ errors = 'None'; cert = $null }
            $cb = [System.Net.Security.RemoteCertificateValidationCallback]{ param($s, $c, $ch, $e) $captured.errors = [string]$e; $captured.cert = $c; return $true }
            $ssl = New-Object System.Net.Security.SslStream($stream, $false, $cb)
            if (-not $Sni) { $Sni = $HostHeader }
            $ssl.AuthenticateAsClient($Sni)
            $stream = $ssl
            if ($captured.cert) {
                $x = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($captured.cert)
                $res.CertSubject = $x.Subject; $res.CertNotAfter = $x.NotAfter; $res.TlsErrors = $captured.errors
                $names = @()
                foreach ($ext in $x.Extensions) { if ($ext.Oid.Value -eq '2.5.29.17') { $names += (($ext.Format($false) -split ',\s*') | ForEach-Object { ($_ -replace '^DNS Name=', '') }) } }
                if (-not $names) { $names = @($x.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::DnsName, $false)) }
                $res.CertNames = $names
            }
        }
        if (-not $HostHeader) { $HostHeader = $HostName }
        $req = "GET $PathAndQuery HTTP/1.1`r`nHost: $HostHeader`r`nUser-Agent: motus-verify`r`nAccept: */*`r`nAccept-Encoding: identity`r`nConnection: close`r`n`r`n"
        $bytes = [Text.Encoding]::ASCII.GetBytes($req)
        $stream.Write($bytes, 0, $bytes.Length); $stream.Flush()
        $ms = New-Object System.IO.MemoryStream
        $buf = New-Object byte[] 8192
        try { while (($n = $stream.Read($buf, 0, $buf.Length)) -gt 0) { $ms.Write($buf, 0, $n); if ($ms.Length -gt 2MB) { break } } } catch { }
        $text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
        $i = $text.IndexOf("`r`n`r`n")
        $head = if ($i -ge 0) { $text.Substring(0, $i) } else { $text }
        $res.Body = if ($i -ge 0) { $text.Substring($i + 4) } else { '' }
        $lines = $head -split "`r`n"
        if ($lines[0] -match '^HTTP/\d\.\d (\d{3})') { $res.Status = [int]$Matches[1]; $res.Ok = $true }
        foreach ($l in ($lines | Select-Object -Skip 1)) { $j = $l.IndexOf(':'); if ($j -gt 0) { $res.Headers[$l.Substring(0, $j).Trim().ToLower()] = $l.Substring($j + 1).Trim() } }
    } catch { $res.Error = $_.Exception.Message } finally { $client.Close() }
    return [pscustomobject]$res
}
function Test-CertCoversHost($Names, [string]$HostName) {
    foreach ($n in $Names) {
        if ($n -eq $HostName) { return $true }
        if ($n.StartsWith('*.')) { $suffix = $n.Substring(1); if ($HostName.EndsWith($suffix) -and ($HostName.Substring(0, $HostName.Length - $suffix.Length) -notmatch '\.')) { return $true } }
    }
    return $false
}
