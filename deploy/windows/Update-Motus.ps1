<#
 MOTUS - update to a new version without losing data or settings.  Run as Administrator.
 1. Extract the NEW deployment ZIP into a temporary folder (NOT over C:\Website\Motus), e.g. C:\Temp\Motus-new
 2. Run:   .\Update-Motus.ps1 -NewPackage C:\Temp\Motus-new
 What happens: new package checked -> database backup (pre-update) -> application stopped -> old app\ folder kept as
 app.previous -> new app\ and scripts installed -> database migrations applied -> application started -> health +
 verification. If anything fails, the old version is put back automatically (and the database restored from the
 pre-update backup if migrations had already run). Kept untouched: config\ (passwords, keys), runtime\ (Node.js), logs\, backups\, your database.
 Options: -SkipVerify  -KeepIisConfig (do not replace iis\web.config)
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$NewPackage, [switch]$SkipVerify, [switch]$KeepIisConfig)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'update'
Assert-Admin
Assert-Layout
$new = (Resolve-Path $NewPackage -ErrorAction SilentlyContinue)
if (-not $new) { Stop-WithError ("Folder not found: " + $NewPackage) 'Extract the new deployment ZIP to a temporary folder and give that folder.' }
$new = $new.Path.TrimEnd('\')
if ($new -ieq $script:Root.TrimEnd('\')) { Stop-WithError 'The new package must be extracted to a DIFFERENT folder than C:\Website\Motus.' }
if (-not (Test-Path (Join-Path $new 'app\server.js')) -or -not (Test-Path (Join-Path $new 'app\package.json'))) { Stop-WithError ("This is not a MOTUS deployment package (app\server.js missing in " + $new + ")") }
function Get-Ver([string]$dir) { try { return (Get-Content (Join-Path $dir 'package.json') -Raw | ConvertFrom-Json).version } catch { return 'unknown' } }
$oldVer = Get-Ver $script:AppDir; $newVer = Get-Ver (Join-Path $new 'app')
Write-Log ("Installed version: " + $oldVer + "  ->  new version: " + $newVer) 'INFO'
$ctx = Get-DbContext
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$pre = Join-Path $script:BackupDir ("pre-update-" + $ts + ".dump")
$prev = Join-Path $script:Root 'app.previous'
$stateFile = Join-Path $script:RuntimeDir 'last-update.json'

Write-Log 'Backing up the database' 'STEP'
try { $b = New-DatabaseBackup $ctx $pre } catch { Stop-WithError ("Pre-update backup failed: " + $_.Exception.Message) 'Nothing was changed. Fix the problem (is PostgreSQL running? disk space?) and try again.' }
Write-Log ("Backup: " + $pre) 'OK'

$swapped = $false; $migrated = $false
function Restore-OldVersion([string]$why) {
    Write-Log ("Update failed (" + $why + "). Putting the previous version back...") 'ERROR'
    Stop-MotusApp
    if ($script:swapped -and (Test-Path $prev)) {
        if (Test-Path $script:AppDir) { Remove-Item $script:AppDir -Recurse -Force }
        Move-Item $prev $script:AppDir
        Write-Log 'Previous application files restored' 'OK'
    }
    if ($script:migrated) {
        Write-Log 'Restoring the database from the pre-update backup (migrations had already run)' 'WARN'
        & (Join-Path $PSScriptRoot 'Restore-Database.ps1') -File $pre -Yes -NoStart
        if ($LASTEXITCODE -ne 0) { Write-Log ("Automatic database restore failed. Run Restore-Database.ps1 -File " + $pre + " manually.") 'ERROR' }
    }
    Start-MotusApp
    if (Wait-MotusHealthy 60) { Write-Log 'The previous version is running again. No data was lost.' 'OK' } else { Write-Log 'The previous version did not start - see logs\node-err.log.' 'ERROR' }
    exit 1
}

Write-Log 'Stopping the application' 'STEP'
Stop-MotusApp
Write-Log 'Installing the new files' 'STEP'
try {
    if (Test-Path $prev) { Remove-Item $prev -Recurse -Force }
    Move-Item $script:AppDir $prev; $swapped = $true
    Copy-Item (Join-Path $new 'app') $script:AppDir -Recurse -Force
    # scripts, helpers and guides in the root
    Get-ChildItem -Path $new -File | Where-Object { $_.Extension -in @('.ps1', '.cmd', '.html', '.txt', '.md') } | ForEach-Object { Copy-Item $_.FullName (Join-Path $script:Root $_.Name) -Force }
    if (Test-Path (Join-Path $new 'scripts')) { Copy-Item (Join-Path $new 'scripts\*') (Join-Path $script:Root 'scripts') -Recurse -Force }
    if (-not $KeepIisConfig -and (Test-Path (Join-Path $new 'iis\web.config'))) {
        $cur = Join-Path $script:IisDir 'web.config'
        if ((Test-Path $cur) -and ((Get-FileHash $cur).Hash -ne (Get-FileHash (Join-Path $new 'iis\web.config')).Hash)) { Copy-Item $cur (Join-Path $script:BackupDir ("web.config." + $ts)) -Force; Copy-Item (Join-Path $new 'iis\web.config') $cur -Force; Write-Log 'iis\web.config updated (old copy saved in backups)' 'OK' }
    }
    $i = Invoke-Native 'icacls.exe' @($script:AppDir, '/grant', '*S-1-5-19:(OI)(CI)RX', '/T', '/C', '/Q')
} catch { Restore-OldVersion ("copying files: " + $_.Exception.Message) }

Write-Log 'Applying database migrations' 'STEP'
$m = Invoke-Node @((Join-Path $script:AppDir 'server\tools\migrate.js')) @{} $null 1800
if ($m.Stdout.Trim()) { Write-Host $m.Stdout.Trim() }
if ($m.ExitCode -ne 0) { Write-Host $m.Stderr; $migrated = $true; Restore-OldVersion 'database migration failed' }
if ($m.Stdout -match 'applied|Applying') { $migrated = $true }

Write-Log 'Starting the new version' 'STEP'
Start-MotusApp
if (-not (Wait-MotusHealthy 90)) { Write-Host (Get-LastLines (Join-Path $script:LogDir 'node-err.log') 15); Restore-OldVersion 'the new version did not start' }
Write-Log 'New version is healthy' 'OK'
if (-not $SkipVerify) {
    $v = Invoke-Node @((Join-Path $script:AppDir 'server\tools\verify.js'), '--skip-sandbox') @{} $null 900
    if ($v.ExitCode -ne 0) { Write-Host $v.Stdout; Restore-OldVersion 'post-update verification failed' }
    Write-Log 'Post-update verification passed' 'OK'
}
@{ updated = (Get-Date -Format 'o'); from = $oldVer; to = $newVer; previousApp = $prev; databaseBackup = $pre; migrated = $migrated } | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
Write-Log ("Updated " + $oldVer + " -> " + $newVer + ". The previous version is kept in app.previous; the pre-update backup is " + $pre) 'OK'
Write-Host 'If something looks wrong later, run Rollback-Motus.cmd.' -ForegroundColor Yellow
