<#
 MOTUS supervisor - started at boot by the scheduled task "Motus-App" (account: LOCAL SERVICE).
 Keeps  runtime\node\node.exe app\server.js  running:
   * restarts it whenever it exits or crashes (waits 2, 5, 10, 20, 30 seconds between quick repeated failures)
   * checks http://127.0.0.1:3000/healthz every 20 seconds and restarts the app after 3 failed checks in a row
   * stops cleanly when the file  runtime\stop.flag  exists (that is what Stop-Motus.cmd / updates create)
 Logs: logs\supervisor.log (this script), logs\node-out.log / logs\node-err.log (console output), logs\motus-*.log (the application).
#>
$ErrorActionPreference = 'Continue'
$Root = if ($env:MOTUS_ROOT) { $env:MOTUS_ROOT } else { Split-Path -Parent $PSScriptRoot }
$AppDir = Join-Path $Root 'app'; $LogDir = Join-Path $Root 'logs'; $RunDir = Join-Path $Root 'runtime'
$EnvFile = Join-Path $Root 'config\motus.env'
$NodeExe = if ($env:MOTUS_NODE_EXE) { $env:MOTUS_NODE_EXE } else { Join-Path $RunDir 'node\node.exe' }
$Flag = Join-Path $RunDir 'stop.flag'
$Port = 3000
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$SupLog = Join-Path $LogDir 'supervisor.log'

function Log([string]$m) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    try {
        if ((Test-Path $SupLog) -and (Get-Item $SupLog).Length -gt 5MB) { Move-Item $SupLog ($SupLog + '.1') -Force }
        Add-Content -Path $SupLog -Value $line -Encoding UTF8
    } catch { }
}
function Rotate([string]$p) { try { if ((Test-Path $p) -and (Get-Item $p).Length -gt 10MB) { Move-Item $p ($p + '.1') -Force } } catch { } }
function Test-Health {
    try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/healthz" -UseBasicParsing -TimeoutSec 5; return ($r.StatusCode -eq 200) } catch { return $false }
}

# only one supervisor at a time
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\MotusSupervisor', [ref]$created)
if (-not $created) { Log 'another supervisor is already running - exiting'; exit 0 }

Log "supervisor started (root $Root)"
if (-not (Test-Path $NodeExe)) { Log "ERROR: $NodeExe not found - run 1-Install-Prerequisites.ps1"; exit 2 }
$failures = 0
while ($true) {
    if (Test-Path $Flag) { Log 'stop.flag present - supervisor stopping'; break }
    Rotate (Join-Path $LogDir 'node-out.log'); Rotate (Join-Path $LogDir 'node-err.log')
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NodeExe
    $psi.Arguments = '"' + (Join-Path $AppDir 'server.js') + '"'
    $psi.WorkingDirectory = $AppDir
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables['MOTUS_ROOT'] = $Root
    $psi.EnvironmentVariables['MOTUS_CONFIG'] = $EnvFile
    $psi.EnvironmentVariables['NODE_ENV'] = 'production'
    $outFile = Join-Path $LogDir 'node-out.log'; $errFile = Join-Path $LogDir 'node-err.log'
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $outW = New-Object System.IO.StreamWriter($outFile, $true); $errW = New-Object System.IO.StreamWriter($errFile, $true)
    $outW.AutoFlush = $true; $errW.AutoFlush = $true
    $null = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -MessageData $outW -Action { if ($EventArgs.Data -ne $null) { $Event.MessageData.WriteLine($EventArgs.Data) } }
    $null = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -MessageData $errW -Action { if ($EventArgs.Data -ne $null) { $Event.MessageData.WriteLine($EventArgs.Data) } }
    $started = Get-Date
    try {
        [void]$proc.Start(); $proc.BeginOutputReadLine(); $proc.BeginErrorReadLine()
        Log ("node started, pid " + $proc.Id)
    } catch { Log ("ERROR starting node: " + $_.Exception.Message); $failures++; Start-Sleep -Seconds 10; continue }

    $bad = 0; $lastCheck = Get-Date; $graceUntil = (Get-Date).AddSeconds(45); $reason = 'exited'
    while (-not $proc.HasExited) {
        Start-Sleep -Seconds 1
        if (Test-Path $Flag) { $reason = 'stop requested'; break }
        if (((Get-Date) - $lastCheck).TotalSeconds -ge 20) {
            $lastCheck = Get-Date
            if (Test-Health) { $bad = 0 } elseif ((Get-Date) -gt $graceUntil) { $bad++; Log "health check failed ($bad/3)"; if ($bad -ge 3) { $reason = 'health check failed 3 times'; break } }
        }
    }
    if (-not $proc.HasExited) {
        Log "stopping node ($reason)"
        try { $proc.Kill() } catch { }
        [void]$proc.WaitForExit(10000)
    } else { Log ("node exited with code " + $proc.ExitCode) }
    Get-EventSubscriber | Where-Object { $_.SourceObject -eq $proc } | Unregister-Event -Force -ErrorAction SilentlyContinue
    Get-Job | Where-Object { $_.State -ne 'Running' -or $true } | Remove-Job -Force -ErrorAction SilentlyContinue
    try { $outW.Dispose(); $errW.Dispose() } catch { }
    if ($reason -eq 'stop requested') { Log 'stop.flag present - supervisor stopping'; break }
    if (((Get-Date) - $started).TotalSeconds -gt 120) { $failures = 0 } else { $failures++ }
    $waits = @(2, 5, 10, 20, 30); $wait = $waits[[Math]::Min($failures, $waits.Count - 1)]
    Log ("restarting in $wait s (quick failures in a row: $failures)")
    Start-Sleep -Seconds $wait
}
try { $mutex.ReleaseMutex() } catch { }
Log 'supervisor ended'
