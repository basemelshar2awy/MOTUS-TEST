<#
 MOTUS - restore the database from a backup file.  Run as Administrator.   *** REPLACES ALL CURRENT DATA ***
 Usage:  .\Restore-Database.ps1 -File C:\Website\Motus\backups\motus-motus-20261017-020000.dump
 A safety backup of the current data is taken first. The application is stopped during the restore and started again.
 -Yes skips the typed confirmation (for automation).
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$File, [switch]$Yes, [switch]$NoStart)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'restore'
Assert-Admin
Assert-Layout
if (-not (Test-Path $File)) { Stop-WithError ("Backup file not found: " + $File) 'Check the path (see the backups folder).' }
$ctx = Get-DbContext
$shaFile = $File + '.sha256'
if (Test-Path $shaFile) {
    $want = ((Get-Content $shaFile -Raw).Trim() -split '\s+')[0].ToLower()
    $have = (Get-FileHash -Path $File -Algorithm SHA256).Hash.ToLower()
    if ($want -ne $have) { Stop-WithError 'The backup file does not match its checksum - it is damaged or was changed.' 'Use another backup file.' }
    Write-Log 'Backup checksum is correct' 'OK'
} else { Write-Log 'No .sha256 file next to the backup; checksum not verified.' 'WARN' }
$l = Invoke-Native $ctx.Pg.PgRestore @('--list', $File)
if ($l.ExitCode -ne 0) { Stop-WithError ("The file is not a readable PostgreSQL backup: " + $l.Stderr.Trim()) }
if (-not $Yes) {
    Write-Host ("This will REPLACE ALL DATA in database '" + $ctx.Db + "' with the contents of:`n  " + $File) -ForegroundColor Yellow
    $a = Read-Host "Type RESTORE to continue"
    if ($a -ne 'RESTORE') { Write-Host 'Cancelled. Nothing was changed.'; exit 0 }
}
Write-Log 'Stopping the application' 'STEP'
Stop-MotusApp
Write-Log 'Safety backup of the current data' 'STEP'
$safe = Join-Path $script:BackupDir ("pre-restore-{0}-{1}.dump" -f $ctx.Db, (Get-Date -Format 'yyyyMMdd-HHmmss'))
try { $sb = New-DatabaseBackup $ctx $safe; Write-Log ("Safety backup: " + $sb.File) 'OK' } catch { Stop-WithError ("Could not take the safety backup, so nothing was restored: " + $_.Exception.Message) 'Fix the reason and try again.' }
Write-Log 'Restoring' 'STEP'
try {
    Invoke-OwnerSql $ctx "DROP SCHEMA public CASCADE" | Out-Null
    Invoke-OwnerSql $ctx ("CREATE SCHEMA public AUTHORIZATION " + $ctx.Owner) | Out-Null
} catch { Stop-WithError ("Could not prepare the database: " + $_.Exception.Message) ("Nothing was lost: restore the safety backup " + $safe + " the same way.") }
$r = Invoke-Native $ctx.Pg.PgRestore @('-h', $ctx.Host, '-p', [string]$ctx.Port, '-U', $ctx.Owner, '-d', $ctx.Db, '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', $File) @{ PGPASSWORD = $ctx.OwnerPw } $null 7200
if ($r.ExitCode -ne 0) { Stop-WithError ("The restore failed and was rolled back: " + $r.Stderr.Trim()) ("The database may be empty now. Restore the safety backup: .\Restore-Database.ps1 -File " + $safe) }
Write-Log 'Data restored' 'OK'
$m = Invoke-Node @((Join-Path $script:AppDir 'server\tools\migrate.js'))
if ($m.ExitCode -ne 0) { Stop-WithError ("Restored, but applying migrations/permissions failed: " + ($m.Stdout + $m.Stderr).Trim()) 'Run 2-Setup-Database.ps1 and then 5-Verify-Deployment.ps1.' }
Write-Log 'Database permissions and schema version checked' 'OK'
if (-not $NoStart) {
    Start-MotusApp
    if (Wait-MotusHealthy 60) { Write-Log 'The application is running again' 'OK' } else { Write-Log ('The application did not answer within 60 seconds. See ' + $script:LogDir) 'WARN' }
}
Write-Log ("Restore finished. Safety copy of the previous data: " + $safe) 'OK'
