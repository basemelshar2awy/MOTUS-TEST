param([Parameter(Mandatory = $true)][ValidateSet('start', 'stop', 'restart')][string]$Action)
. (Join-Path $PSScriptRoot 'Motus.Common.ps1')
Start-MotusLog 'control'
Assert-Admin
if ($Action -in @('stop', 'restart')) { Write-Log 'Stopping MOTUS...' 'STEP'; Stop-MotusApp; Write-Log 'Stopped' 'OK' }
if ($Action -in @('start', 'restart')) {
    Write-Log 'Starting MOTUS...' 'STEP'; Start-MotusApp
    if (Wait-MotusHealthy 90) { Write-Log 'MOTUS is running (http://127.0.0.1:3000/healthz answers).' 'OK' }
    else { $e = Get-LastLines (Join-Path $script:LogDir 'node-err.log') 15; if ($e) { Write-Host $e }; Stop-WithError 'MOTUS did not become healthy in 90 seconds.' 'Read logs\node-err.log and logs\supervisor.log (PostgreSQL running? password in config\motus.env right?).' }
}
