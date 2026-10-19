<#
 MOTUS - go back to the version that was installed before the last update.  Run as Administrator.
 By default only the application files are swapped back (your current data is kept) - correct when the last update had no database changes.
 -RestoreDatabase also restores the pre-update database backup (data entered after the update is LOST) - needed if the update changed the database.
#>
[CmdletBinding()]
param([switch]$RestoreDatabase, [switch]$Yes)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'rollback'
Assert-Admin
Assert-Layout
$stateFile = Join-Path $script:RuntimeDir 'last-update.json'
$prev = Join-Path $script:Root 'app.previous'
if (-not (Test-Path $prev) -or -not (Test-Path $stateFile)) { Stop-WithError 'There is no previous version to go back to (no update has been done, or app.previous was removed).' }
$st = Get-Content $stateFile -Raw | ConvertFrom-Json
Write-Host ("Rolling back from version " + $st.to + " to " + $st.from + $(if ($RestoreDatabase) { " AND restoring the database from " + $st.databaseBackup } else { " (application files only)" })) -ForegroundColor Yellow
if ($st.migrated -and -not $RestoreDatabase) { Write-Host 'Note: the last update changed the database. The old version may not work with the new database. If it fails to start, run again with -RestoreDatabase.' -ForegroundColor Yellow }
if (-not $Yes -and (Read-Host 'Type ROLLBACK to continue') -ne 'ROLLBACK') { Write-Host 'Cancelled. Nothing was changed.'; exit 0 }
Stop-MotusApp
$cur = Join-Path $script:Root ('app.rolled-back-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
Move-Item $script:AppDir $cur
Move-Item $prev $script:AppDir
Write-Log ("Application files restored (the replaced version is kept in " + (Split-Path -Leaf $cur) + ")") 'OK'
if ($RestoreDatabase) {
    if (-not (Test-Path $st.databaseBackup)) { Stop-WithError ("The pre-update backup was not found: " + $st.databaseBackup) }
    & (Join-Path $PSScriptRoot 'Restore-Database.ps1') -File $st.databaseBackup -Yes -NoStart
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'Database restore failed.' ('Run Restore-Database.ps1 -File ' + $st.databaseBackup) }
}
Remove-Item $stateFile -Force
Start-MotusApp
if (Wait-MotusHealthy 90) { Write-Log ("Version " + $st.from + " is running again.") 'OK' } else { Stop-WithError 'The previous version did not start.' 'Read logs\node-err.log. If the database was changed by the update, run Rollback-Motus.ps1 again with -RestoreDatabase.' }
