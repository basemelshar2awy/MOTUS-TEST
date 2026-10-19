<#
 MOTUS - database backup.  Run as Administrator (also run automatically every night by the "Motus-Backup" task).
 Creates C:\Website\Motus\backups\motus-<date>.dump (PostgreSQL custom format, compressed) + a .sha256 checksum file,
 checks the file can be read back, and keeps the newest -Keep automatic backups.
 Options: -Keep 14   -OutFile <path>   -Quiet
#>
[CmdletBinding()]
param([int]$Keep = 14, [string]$OutFile = '', [switch]$Quiet)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'backup'
Assert-Admin
$ctx = Get-DbContext
if (-not $OutFile) { $OutFile = Join-Path $script:BackupDir ("motus-{0}-{1}.dump" -f $ctx.Db, (Get-Date -Format 'yyyyMMdd-HHmmss')) }
try { $b = New-DatabaseBackup $ctx $OutFile } catch { Stop-WithError ("Backup failed: " + $_.Exception.Message) 'Check that PostgreSQL is running and that there is free disk space on the drive, then run the backup again.' }
Write-Log ("Backup created: " + $b.File + " (" + [math]::Round($b.Bytes / 1MB, 2) + " MB, SHA-256 " + $b.Sha256 + ")") 'OK'
if (-not $PSBoundParameters.ContainsKey('OutFile')) {
    $old = @(Get-ChildItem -Path $script:BackupDir -Filter ("motus-{0}-*.dump" -f $ctx.Db) | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep)
    foreach ($f in $old) { Remove-Item $f.FullName -Force; if (Test-Path ($f.FullName + '.sha256')) { Remove-Item ($f.FullName + '.sha256') -Force }; Write-Log ("Removed old backup " + $f.Name) }
}
if (-not $Quiet) { Write-Host ''; Write-Host 'Copy backups to another computer or storage regularly - a backup on the same disk does not protect against disk failure.' -ForegroundColor Yellow }
