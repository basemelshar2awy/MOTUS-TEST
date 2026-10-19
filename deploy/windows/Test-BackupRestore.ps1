<#
 MOTUS - proves that backups can really be restored.  Run as Administrator. It never touches production data:
   1. takes a backup of the live database
   2. restores it into a temporary database
   3. compares the number of rows in every table with the live database
   4. deletes the temporary database (and the test backup unless -KeepBackup)
#>
[CmdletBinding()]
param([switch]$KeepBackup)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'test-backup-restore'
Assert-Admin
$ctx = Get-DbContext
$scratch = 'motus_restoretest_' + (New-Secret 6 'abcdefghijklmnopqrstuvwxyz0123456789')
$file = Join-Path $script:BackupDir ("restoretest-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$failed = $false
try {
    Write-Log 'Counting rows in the live database' 'STEP'
    $before = Get-TableCounts $ctx $ctx.Db
    Write-Log ("Tables: " + $before.Count + ", rows: " + (($before.Values | Measure-Object -Sum).Sum))
    Write-Log 'Taking a backup' 'STEP'
    $b = New-DatabaseBackup $ctx $file
    Write-Log ("Backup: " + [math]::Round($b.Bytes / 1KB) + " KB") 'OK'
    $after = Get-TableCounts $ctx $ctx.Db
    Write-Log 'Restoring into a temporary database' 'STEP'
    Invoke-OwnerSql $ctx ("CREATE DATABASE " + $scratch + " OWNER " + $ctx.Owner + " TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'") 'postgres' | Out-Null
    $r = Invoke-Native $ctx.Pg.PgRestore @('-h', $ctx.Host, '-p', [string]$ctx.Port, '-U', $ctx.Owner, '-d', $scratch, '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', $file) @{ PGPASSWORD = $ctx.OwnerPw } $null 7200
    if ($r.ExitCode -ne 0) { throw ("restore into the temporary database failed: " + $r.Stderr.Trim()) }
    $restored = Get-TableCounts $ctx $scratch
    Write-Log 'Comparing row counts' 'STEP'
    $volatile = @('sessions', 'login_attempts', 'webhook_deliveries', 'idempotency_keys')
    foreach ($t in ($before.Keys | Sort-Object)) {
        $lo = [math]::Min($before[$t], $after[$t]); $hi = [math]::Max($before[$t], $after[$t])
        if (-not $restored.ContainsKey($t)) { Write-Log ("MISSING table " + $t) 'ERROR'; $failed = $true; continue }
        if ($volatile -contains $t) { continue }
        if ($restored[$t] -lt $lo -or $restored[$t] -gt $hi) { Write-Log ("DIFFERENT " + $t + ": live " + $before[$t] + ", restored " + $restored[$t]) 'ERROR'; $failed = $true }
    }
    if (-not $failed) { Write-Log ("All " + $before.Count + " tables restored with matching row counts") 'OK' }
} catch { Write-Log $_.Exception.Message 'ERROR'; $failed = $true }
finally {
    try { Invoke-OwnerSql $ctx ("DROP DATABASE IF EXISTS " + $scratch + " WITH (FORCE)") 'postgres' | Out-Null; Write-Log 'Temporary database removed' } catch { Write-Log ("Could not remove the temporary database " + $scratch + ": " + $_.Exception.Message) 'WARN' }
    if (-not $KeepBackup) { foreach ($f in @($file, ($file + '.sha256'))) { if (Test-Path $f) { Remove-Item $f -Force } } }
}
if ($failed) { Stop-WithError 'BACKUP/RESTORE TEST FAILED.' 'Do not rely on backups until this passes. Send the log file to your support contact.' }
Write-Log 'BACKUP/RESTORE TEST PASSED - backups can be restored.' 'OK'
