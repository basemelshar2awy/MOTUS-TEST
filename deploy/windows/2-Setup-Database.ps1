<#
 MOTUS - step 2: database setup, end to end.  Run as Administrator.
 What it does (safe to run again - it never changes existing passwords or data):
   1. finds PostgreSQL and makes sure its Windows service starts automatically and is running
   2. creates the dedicated database "motus" and two dedicated users with strong random passwords:
        motus_owner  - runs migrations and backups (never used by the web application while it serves users)
        motus_app    - used by the application; cannot bypass row-level security, cannot change the schema
   3. writes the secret configuration file  C:\Website\Motus\config\motus.env  (restricted permissions)
   4. applies the database migrations
   5. creates the first platform administrator (and optionally the first company with its admin) securely
 Options: -PostgresBin <folder>  -PostgresPassword <SecureString>  -AdminEmail  -AdminName  -CompanyCode  -CompanyName  -CompanyAdminEmail
          -NonInteractive (use only the options given; generate passwords)
#>
[CmdletBinding()]
param(
    [string]$PostgresBin = '', [securestring]$PostgresPassword = $null, [string]$PgHost = '127.0.0.1', [int]$PgPort = 0,
    [string]$DatabaseName = 'motus', [string]$AppUser = 'motus_app', [string]$OwnerUser = 'motus_owner',
    [string]$PublicOrigin = 'https://motus.sabeelbus.com',
    [string]$AdminEmail = '', [string]$AdminName = '', [securestring]$AdminPassword = $null,
    [string]$CompanyCode = '', [string]$CompanyName = '', [string]$CompanyAdminEmail = '',
    [switch]$NonInteractive, [switch]$SkipAdmin
)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'database-setup'
Assert-Admin
Assert-Layout

function ConvertFrom-Secure([securestring]$s) {
    if (-not $s) { return $null }
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Read-Required([string]$Prompt, [string]$Pattern = '.+', [string]$Hint = '') {
    while ($true) { $v = (Read-Host $Prompt).Trim(); if ($v -match $Pattern) { return $v }; Write-Host ("  " + $Hint) -ForegroundColor Yellow }
}

Write-Log 'PostgreSQL' 'STEP'
$pg = Find-Postgres $PostgresBin
if (-not $pg) { Stop-WithError 'PostgreSQL (version 14 or newer) was not found on this server.' 'Run 1-Install-Prerequisites.ps1 first (or give -PostgresBin "C:\Program Files\PostgreSQL\16\bin").' }
Write-Log ("Using PostgreSQL " + $pg.Major + " in " + $pg.Bin) 'OK'
if ($pg.Service) {
    try { Set-Service -Name $pg.Service.Name -StartupType Automatic; Write-Log ("Service " + $pg.Service.Name + " is set to start automatically with Windows") 'OK' } catch { Write-Log ("Could not set automatic start: " + $_.Exception.Message) 'WARN' }
    if ($pg.Service.Status -ne 'Running') { Start-Service -Name $pg.Service.Name; Start-Sleep -Seconds 4 }
} elseif ($script:IsWin) { Write-Log 'No PostgreSQL Windows service was detected (a remote or custom installation?). Make sure it starts automatically.' 'WARN' }

# ---- superuser access (only needed to create/repair roles and the database)
$existing = Read-EnvFile
$superPw = ConvertFrom-Secure $PostgresPassword
$superFile = Join-Path $script:ConfigDir 'postgres-superuser.txt'
$port = $PgPort
if (-not $superPw -and (Test-Path $superFile)) {
    foreach ($l in (Get-Content $superFile -Encoding UTF8)) { if ($l -match '^PASSWORD=(.+)$') { $superPw = $Matches[1] } elseif ($l -match '^PORT=(\d+)$' -and $port -eq 0) { $port = [int]$Matches[1] } }
    if ($superPw) { Write-Log 'Using the PostgreSQL administrator password saved by the installer' }
}
if ($port -eq 0) { if ($existing.Contains('PGPORT')) { $port = [int]$existing['PGPORT'] } else { $port = 5432 } }
$haveConfig = ($existing.Contains('MOTUS_DB_OWNER_PASSWORD') -and $existing.Contains('MOTUS_DB_APP_PASSWORD'))
$needSuper = $true
if ($haveConfig) {
    # existing installation: if the owner login works and the database exists, no superuser is needed
    try { $null = Invoke-Psql $pg $PgHost $port $existing['MOTUS_DB_OWNER_USER'] $existing['MOTUS_DB_OWNER_PASSWORD'] $existing['PGDATABASE'] 'SELECT 1' -Scalar; $needSuper = $false; Write-Log 'Existing configuration works - the database users already exist.' 'OK' } catch { Write-Log 'Existing configuration does not work yet; the administrator password is needed to repair it.' 'WARN' }
}
if ($needSuper) {
    if (-not $superPw) {
        if ($NonInteractive) { Stop-WithError 'The PostgreSQL administrator ("postgres") password is required.' 'Run again with -PostgresPassword (ConvertTo-SecureString "..." -AsPlainText -Force), or without -NonInteractive to be asked.' }
        Write-Host ''
        Write-Host 'Enter the password of the PostgreSQL administrator account ("postgres").' -ForegroundColor Cyan
        Write-Host '(If PostgreSQL was installed by 1-Install-Prerequisites.ps1 you are not asked; this is for an installation that already existed.)'
        $superPw = ConvertFrom-Secure (Read-Host 'postgres password' -AsSecureString)
    }
    try { $ver = Invoke-Psql $pg $PgHost $port 'postgres' $superPw 'postgres' 'SHOW server_version' -Scalar } catch { Stop-WithError ("Cannot sign in to PostgreSQL as 'postgres' at " + $PgHost + ":" + $port + " - " + $_.Exception.Message) 'Check the password and that the PostgreSQL service is running (services.msc -> postgresql-x64-NN). If PostgreSQL uses a port other than 5432, add -PgPort <port>.' }
    Write-Log ("Connected as the PostgreSQL administrator (server " + $ver + ")") 'OK'
}

# ---- credentials (never overwritten when they already exist)
$cfg = [ordered]@{}
foreach ($k in $existing.Keys) { $cfg[$k] = $existing[$k] }
function Set-Default([string]$k, [string]$v) { if (-not $cfg.Contains($k) -or -not $cfg[$k]) { $cfg[$k] = $v; return $true }; return $false }
$null = Set-Default 'PGHOST' $PgHost
$null = Set-Default 'PGPORT' ([string]$port)
$null = Set-Default 'PGDATABASE' $DatabaseName
$null = Set-Default 'MOTUS_DB_OWNER_USER' $OwnerUser
$newOwnerPw = Set-Default 'MOTUS_DB_OWNER_PASSWORD' (New-Secret 40)
$null = Set-Default 'MOTUS_DB_APP_USER' $AppUser
$newAppPw = Set-Default 'MOTUS_DB_APP_PASSWORD' (New-Secret 40)
$null = Set-Default 'MOTUS_CREDENTIALS_KEY' (New-HexKey 32)
$null = Set-Default 'PUBLIC_ORIGIN' $PublicOrigin
$null = Set-Default 'MOTUS_HOST' '127.0.0.1'
$null = Set-Default 'MOTUS_PORT' '3000'
$null = Set-Default 'MOTUS_TIMEZONE' 'Africa/Cairo'
$null = Set-Default 'MOTUS_LOG_DIR' 'logs'
$null = Set-Default 'MOTUS_TRUST_PROXY' '1'
foreach ($n in @($cfg['MOTUS_DB_OWNER_USER'], $cfg['MOTUS_DB_APP_USER'], $cfg['PGDATABASE'])) { if ($n -notmatch '^[a-z_][a-z0-9_]{0,62}$') { Stop-WithError ("Invalid database/user name: " + $n) 'Use only lowercase letters, digits and underscore.' } }

# ---- roles and database
if ($needSuper -or $newOwnerPw -or $newAppPw) {
    Write-Log 'Database users and database' 'STEP'
    $o = $cfg['MOTUS_DB_OWNER_USER']; $a = $cfg['MOTUS_DB_APP_USER']; $d = $cfg['PGDATABASE']
    $sq = { param($sql, $db) Invoke-Psql $pg $PgHost $port 'postgres' $superPw $db $sql -Scalar }
    function Invoke-Super([string]$sql, [string]$db = 'postgres') { Invoke-Psql $pg $PgHost $port 'postgres' $superPw $db $sql -Scalar }
    $hasOwner = Invoke-Super ("SELECT 1 FROM pg_roles WHERE rolname = " + (Format-SqlLiteral $o))
    if ($hasOwner -eq '1') { Invoke-Super ("ALTER ROLE " + $o + " LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD " + (Format-SqlLiteral $cfg['MOTUS_DB_OWNER_PASSWORD'])) | Out-Null; Write-Log ("Role " + $o + " updated") 'OK' }
    else { Invoke-Super ("CREATE ROLE " + $o + " LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD " + (Format-SqlLiteral $cfg['MOTUS_DB_OWNER_PASSWORD'])) | Out-Null; Write-Log ("Role " + $o + " created") 'OK' }
    $hasApp = Invoke-Super ("SELECT 1 FROM pg_roles WHERE rolname = " + (Format-SqlLiteral $a))
    if ($hasApp -eq '1') { Invoke-Super ("ALTER ROLE " + $a + " LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD " + (Format-SqlLiteral $cfg['MOTUS_DB_APP_PASSWORD'])) | Out-Null; Write-Log ("Role " + $a + " updated") 'OK' }
    else { Invoke-Super ("CREATE ROLE " + $a + " LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD " + (Format-SqlLiteral $cfg['MOTUS_DB_APP_PASSWORD'])) | Out-Null; Write-Log ("Role " + $a + " created") 'OK' }
    $hasDb = Invoke-Super ("SELECT 1 FROM pg_database WHERE datname = " + (Format-SqlLiteral $d))
    if ($hasDb -ne '1') { Invoke-Super ("CREATE DATABASE " + $d + " OWNER " + $o + " TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'") | Out-Null; Write-Log ("Database " + $d + " created") 'OK' } else { Write-Log ("Database " + $d + " already exists - kept as it is") 'OK' }
    Invoke-Super ("REVOKE ALL ON DATABASE " + $d + " FROM PUBLIC") | Out-Null
    Invoke-Super ("GRANT CONNECT ON DATABASE " + $d + " TO " + $a) | Out-Null
    Invoke-Super ("GRANT CONNECT ON DATABASE " + $d + " TO " + $o) | Out-Null
    Invoke-Super "REVOKE CREATE ON SCHEMA public FROM PUBLIC" $d | Out-Null
    Invoke-Super ("ALTER SCHEMA public OWNER TO " + $o) $d | Out-Null
    # PostgreSQL should only listen on this computer
    $listen = Invoke-Super 'SHOW listen_addresses'
    if ($listen -notmatch '^(localhost|127\.0\.0\.1|::1|localhost,\s*127\.0\.0\.1)$') {
        $installedByUs = Test-Path $superFile
        if ($installedByUs) {
            Invoke-Super "ALTER SYSTEM SET listen_addresses = 'localhost'" | Out-Null
            if ($pg.Service) { Restart-Service -Name $pg.Service.Name -Force; Start-Sleep -Seconds 5 }
            Write-Log 'PostgreSQL now listens only on this computer (listen_addresses = localhost)' 'OK'
        } else { Write-Log ("PostgreSQL listens on '" + $listen + "'. MOTUS only needs localhost. If no other application needs remote access, set listen_addresses = 'localhost' in postgresql.conf and restart the service, and make sure the Windows Firewall blocks port " + $port + " from outside.") 'WARN' }
    }
}

# ---- write the secret configuration file
Write-Log 'Configuration file' 'STEP'
Write-EnvFile $cfg
Set-SecretAcl $script:ConfigDir 'R'
Set-SecretAcl $script:EnvFile 'R'
if (Test-Path $superFile) { Set-SecretAcl $superFile '' }
Write-Log ("Secrets saved in " + $script:EnvFile + " (readable only by Administrators, SYSTEM and the MOTUS service account). It is outside the IIS folder and the web files.") 'OK'
if ($newOwnerPw -or $newAppPw) { Write-Log 'New database passwords were generated. You never need to type them; they live only in that file.' }

# ---- migrations
Write-Log 'Database migrations' 'STEP'
$m = Invoke-Node @((Join-Path $script:AppDir 'server\tools\migrate.js'))
Add-Content -Path $script:LogFile -Value ($m.Stdout + $m.Stderr) -Encoding UTF8
if ($m.ExitCode -ne 0) { Stop-WithError ("Applying the database migrations failed: " + (($m.Stdout + $m.Stderr).Trim())) 'Fix the reason shown above and run this script again; migrations are transactional, nothing is half-applied.' }
foreach ($l in ($m.Stdout -split "`r?`n")) { if ($l.Trim()) { Write-Log $l.Trim() } }
Write-Log 'The database schema is up to date' 'OK'

# ---- first administrator
if ($SkipAdmin) { Write-Log 'Administrator creation skipped.' 'WARN'; exit 0 }
Write-Log 'First administrator' 'STEP'
$countRaw = Invoke-Psql $pg $PgHost $port $cfg['MOTUS_DB_APP_USER'] $cfg['MOTUS_DB_APP_PASSWORD'] $cfg['PGDATABASE'] "SELECT count(*) FROM users WHERE role IN ('super_admin','company_admin') AND status = 'active'" -Scalar
if ([int]$countRaw -gt 0) { Write-Log ("An active administrator already exists (" + $countRaw + "). Nothing to create. Use Reset-Password.ps1 if someone is locked out.") 'OK'; exit 0 }
if (-not $AdminEmail) {
    if ($NonInteractive) { Stop-WithError 'No administrator exists yet and -AdminEmail was not given.' 'Run again with -AdminEmail you@company.com -AdminName "Your Name".' }
    Write-Host 'No administrator exists yet. This account manages companies and users for the whole platform.' -ForegroundColor Cyan
    $AdminEmail = Read-Required 'Platform administrator e-mail' '^[^@\s]+@[^@\s]+\.[^@\s]+$' 'Type a valid e-mail address.'
    $AdminName = Read-Required 'Platform administrator name' '.+' 'Type a name.'
}
if (-not $AdminName) { $AdminName = $AdminEmail }
$adminPw = ConvertFrom-Secure $AdminPassword
$generated = $false
if (-not $adminPw) {
    if (-not $NonInteractive) {
        Write-Host 'Choose a password (at least 10 characters, 3 kinds of characters), or just press Enter to generate a strong one.'
        $p1 = ConvertFrom-Secure (Read-Host 'Password' -AsSecureString)
        if ($p1) { $p2 = ConvertFrom-Secure (Read-Host 'Repeat password' -AsSecureString); if ($p1 -ne $p2) { Stop-WithError 'The two passwords are different.' 'Run the script again.' }; $adminPw = $p1 }
    }
    if (-not $adminPw) { $adminPw = New-Secret 18 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#%*-_'; $generated = $true }
}
if (-not $NonInteractive -and -not $CompanyCode) {
    $yn = Read-Host 'Create the first company now? (Y/N)'
    if ($yn -match '^[Yy]') {
        $CompanyCode = Read-Required 'Company code (2-8 capital letters/digits, e.g. SBS)' '^[A-Z0-9]{2,8}$' 'Use 2 to 8 capital letters or digits.'
        $CompanyName = Read-Required 'Company name' '.+' 'Type the company name.'
        $CompanyAdminEmail = Read-Required 'Company administrator e-mail (a different address from the platform administrator)' '^[^@\s]+@[^@\s]+\.[^@\s]+$' 'Type a valid e-mail address.'
    }
}
$cargs = @((Join-Path $script:AppDir 'server\tools\create-admin.js'), '--email', $AdminEmail, '--name', $AdminName)
if ($CompanyCode) { $cargs += @('--company', $CompanyCode, '--company-name', $CompanyName, '--company-admin', $CompanyAdminEmail) }
$envp = @{}
if ($generated) { $cargs += '--generate' } else { $envp['MOTUS_ADMIN_PASSWORD'] = $adminPw }
$r = Invoke-Node $cargs $envp
if ($r.ExitCode -ne 0) { Stop-WithError ("Could not create the administrator: " + $r.Stderr.Trim() + $r.Stdout.Trim()) 'Fix the reason shown and run this script again.' }
Write-Log ($r.Stdout.Trim() -replace '(?m)^Temporary password.*$', '[temporary password(s) shown below and saved in a restricted file]')
$pwLines = @($r.Stdout -split "`r?`n" | Where-Object { $_ -match 'Temporary password' -or $_ -match 'created' })
if ($generated -or ($r.Stdout -match 'Temporary password')) {
    $cred = Join-Path $script:ConfigDir 'initial-credentials.txt'
    Set-Content -Path $cred -Value (@('MOTUS first sign-in details (temporary passwords must be changed at the first sign-in).', 'DELETE THIS FILE after you have signed in and changed the passwords.', '') + $pwLines) -Encoding UTF8
    Set-SecretAcl $cred ''
    Write-Host ''
    Write-Host '--------------------------------------------------------------' -ForegroundColor Yellow
    foreach ($l in $pwLines) { Write-Host $l -ForegroundColor Yellow }
    Write-Host ("(also saved in " + $cred + " - delete it after the first sign-in)") -ForegroundColor Yellow
    Write-Host '--------------------------------------------------------------' -ForegroundColor Yellow
}
Write-Log 'Database setup finished.' 'OK'
