<#
 MOTUS - step 4: start automatically after every reboot and restart after crashes.  Run as Administrator.
 Creates two Windows Scheduled Tasks (visible in Task Scheduler):
   Motus-App     starts at boot (no login needed) as LOCAL SERVICE, runs scripts\Supervisor.ps1 which keeps the app alive
   Motus-Backup  every night 02:30, as SYSTEM, runs Backup-Database.ps1 (keeps 14 backups)
 Also sets folder permissions: the service account can read app\, config\ and write only logs\.
 Safe to run again. Options: -NoStart (do not start the app now)  -BackupTime 02:30
#>
[CmdletBinding()]
param([switch]$NoStart, [string]$BackupTime = '02:30')
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'autostart'
Assert-Admin
Assert-Layout
if (-not $script:IsWin) { Stop-WithError 'This step only runs on Windows Server.' }
if (-not (Test-Path $script:EnvFile)) { Stop-WithError 'config\motus.env does not exist yet.' 'Run 2-Setup-Database.ps1 first.' }
Get-NodeExe | Out-Null

Write-Log 'Folder permissions' 'STEP'
foreach ($d in @($script:LogDir, $script:RuntimeDir, $script:BackupDir)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }
$ls = '*S-1-5-19'
$grant = @(
    @($script:AppDir, '(OI)(CI)RX'), @($script:RuntimeDir, '(OI)(CI)RX'), @((Join-Path $script:Root 'scripts'), '(OI)(CI)RX'),
    @($script:LogDir, '(OI)(CI)M')
)
foreach ($g in $grant) {
    $r = Invoke-Native 'icacls.exe' @($g[0], '/grant', ($ls + ':' + $g[1]), '/T', '/C', '/Q')
    if ($r.ExitCode -ne 0) { Write-Log ("icacls on " + $g[0] + ": " + $r.Stderr.Trim()) 'WARN' }
}
Set-SecretAcl $script:ConfigDir 'R'
foreach ($n in @('postgres-superuser.txt', 'initial-credentials.txt')) { $f = Join-Path $script:ConfigDir $n; if (Test-Path $f) { Set-SecretAcl $f '' } }   # the application account must NOT read these
if (Test-Path $script:EnvFile) { Set-SecretAcl $script:EnvFile 'R' }
Set-SecretAcl $script:BackupDir ''
Write-Log 'LOCAL SERVICE can read the application and the configuration and write the logs; backups are readable only by Administrators/SYSTEM' 'OK'

Write-Log 'Scheduled task Motus-App' 'STEP'
$ps = Join-Path $env:windir 'System32\WindowsPowerShell\v1.0\powershell.exe'
$sup = Join-Path $script:Root 'scripts\Supervisor.ps1'
$action = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $sup + '"') -WorkingDirectory $script:Root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$existing = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
if ($existing) { if ($existing.State -eq 'Running') { Stop-MotusApp }; Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false }
Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'MOTUS Fleet application (Node.js on 127.0.0.1:3000). Starts at boot and is restarted by the supervisor if it stops.' | Out-Null
Write-Log 'Task Motus-App registered (runs at startup as LOCAL SERVICE)' 'OK'

Write-Log 'Scheduled task Motus-Backup' 'STEP'
$bat = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $script:Root 'Backup-Database.ps1') + '" -Quiet') -WorkingDirectory $script:Root
$bt = New-ScheduledTaskTrigger -Daily -At $BackupTime
$bp = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$bs = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
if (Get-ScheduledTask -TaskName $script:BackupTask -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $script:BackupTask -Confirm:$false }
Register-ScheduledTask -TaskName $script:BackupTask -Action $bat -Trigger $bt -Principal $bp -Settings $bs -Description 'MOTUS nightly database backup (kept in C:\Website\Motus\backups).' | Out-Null
Write-Log ("Task Motus-Backup registered (every day at " + $BackupTime + ")") 'OK'

if ($NoStart) { Write-Log 'Not starting the application now (-NoStart). It will start at the next boot, or run Start-Motus.cmd.'; exit 0 }
Write-Log 'Starting the application' 'STEP'
Stop-MotusApp
Start-MotusApp
if (Wait-MotusHealthy 90) { Write-Log 'MOTUS is running: http://127.0.0.1:3000/healthz answers' 'OK' }
else {
    Write-Log 'The application did not become healthy within 90 seconds.' 'ERROR'
    $e = Get-LastLines (Join-Path $script:LogDir 'node-err.log') 15; if ($e) { Write-Host $e }
    $s = Get-LastLines (Join-Path $script:LogDir 'supervisor.log') 10; if ($s) { Write-Host $s }
    Stop-WithError 'MOTUS did not start.' 'Read the lines above and logs\node-err.log. Common causes: PostgreSQL not running, wrong password in config\motus.env, port 3000 used by another program.'
}
