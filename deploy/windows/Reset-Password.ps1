<#
 MOTUS - reset the password of a user (for example a locked-out administrator).  Run as Administrator.
 Usage: .\Reset-Password.ps1 -Email admin@example.com
 A new temporary password is printed once; the user must change it at the next sign-in. The account is unlocked and all its sessions are ended.
#>
[CmdletBinding()]
param([string]$Email = '')
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'reset-password'
Assert-Admin
if (-not $Email) { $Email = Read-Host 'E-mail address of the user' }
if ($Email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Stop-WithError 'That does not look like an e-mail address.' }
$r = Invoke-Node @((Join-Path $script:AppDir 'server\tools\reset-password.js'), '--email', $Email, '--generate')
if ($r.ExitCode -ne 0) { Stop-WithError ('Password reset failed: ' + ($r.Stderr + $r.Stdout).Trim()) 'Check the e-mail address exists, and that PostgreSQL is running.' }
Write-Host $r.Stdout
Write-Log 'Done. Give the temporary password to the user over a private channel.' 'OK'
