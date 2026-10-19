<#
 MOTUS - step 3: check / prepare IIS for the existing site "motus" (ID 29, motus.sabeelbus.com).  Run as Administrator.
 It ONLY looks at and changes the "motus" site. Other sites, their bindings and their configuration are never touched.
 What it does:
   * verifies IIS, the URL Rewrite module and Application Request Routing (ARR) with the proxy enabled
   * verifies the site's physical path is C:\Website\Motus\iis and its HTTP (80) + HTTPS (443, SNI) bindings
   * verifies the TLS certificate bound to the HTTPS binding really covers motus.sabeelbus.com (no certificate is ever created)
   * gives the IIS worker identity read access to the iis folder and checks that the folder contains only IIS files
   * tests that IIS serves the validation file and redirects HTTP to HTTPS
 Options: -SetPhysicalPath (point the motus site at the iis folder)  -AddMissingBindings (add the HTTP binding if absent)
          -EnableArrProxy (turn on the ARR proxy server-wide if it is off - a global switch, so it asks unless given)
#>
[CmdletBinding()]
param([switch]$SetPhysicalPath, [switch]$AddMissingBindings, [switch]$EnableArrProxy)
. (Join-Path $PSScriptRoot 'scripts\Motus.Common.ps1')
Start-MotusLog 'iis'
Assert-Admin
if (-not $script:IsWin) { Stop-WithError 'This step only runs on Windows Server.' }
$problems = New-Object System.Collections.ArrayList
function Add-Problem([string]$m, [string]$fix) { [void]$problems.Add(@($m, $fix)); Write-Log ($m + "  ->  " + $fix) 'ERROR' }

Write-Log 'IIS prerequisites' 'STEP'
if (-not (Get-Service -Name W3SVC -ErrorAction SilentlyContinue)) { Stop-WithError 'IIS (World Wide Web Publishing Service) is not installed.' 'Install the Web Server (IIS) role in Server Manager, then the URL Rewrite and Application Request Routing modules.' }
Import-Module WebAdministration -ErrorAction Stop
Write-Log 'IIS is installed' 'OK'
$modules = @(Get-WebGlobalModule | ForEach-Object { $_.Name })
if ($modules -contains 'RewriteModule') { Write-Log 'URL Rewrite module is installed' 'OK' } else { Add-Problem 'The IIS URL Rewrite module is not installed.' 'Install "URL Rewrite" from https://www.iis.net/downloads/microsoft/url-rewrite (or Web Platform Installer) and run this step again.' }
if ($modules -contains 'ApplicationRequestRouting') { Write-Log 'Application Request Routing (ARR) is installed' 'OK' } else { Add-Problem 'Application Request Routing (ARR) is not installed.' 'Install "Application Request Routing 3.0" from https://www.iis.net/downloads/microsoft/application-request-routing and run this step again.' }
if ($modules -contains 'ApplicationRequestRouting') {
    $proxyOn = $false
    try { $proxyOn = [bool](Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled').Value } catch { }
    if ($proxyOn) { Write-Log 'ARR reverse proxy is enabled' 'OK' }
    else {
        $go = $EnableArrProxy.IsPresent
        if (-not $go) { Write-Host 'The ARR reverse proxy is switched OFF. Turning it on is a server-wide IIS setting (needed for any reverse-proxy site). It does not change how other sites behave unless they use proxy rules.' -ForegroundColor Yellow; $go = ((Read-Host 'Turn it on now? (Y/N)') -match '^[Yy]') }
        if ($go) {
            $backup = Join-Path $script:BackupDir ('applicationHost-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.config')
            if (-not (Test-Path $script:BackupDir)) { New-Item -ItemType Directory -Path $script:BackupDir -Force | Out-Null }
            Copy-Item -Path (Join-Path $env:windir 'System32\inetsrv\config\applicationHost.config') -Destination $backup
            Write-Log ("Backup of the IIS configuration saved: " + $backup)
            Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value $true
            Write-Log 'ARR reverse proxy enabled' 'OK'
        } else { Add-Problem 'The ARR reverse proxy is disabled.' 'IIS Manager -> server node -> Application Request Routing Cache -> Server Proxy Settings -> tick "Enable proxy", or run this script with -EnableArrProxy.' }
    }
}

Write-Log ('IIS site "' + $script:SiteName + '"') 'STEP'
$site = Get-Website -Name $script:SiteName -ErrorAction SilentlyContinue
if (-not $site) { Stop-WithError ('The IIS site "' + $script:SiteName + '" does not exist.') 'Create it in IIS Manager (Sites -> Add Website) with physical path C:\Website\Motus\iis and host name motus.sabeelbus.com, then run this step again.' }
if ($site.Id -ne $script:SiteId) { Write-Log ("The site's ID is " + $site.Id + " (expected " + $script:SiteId + "). This is only informational.") 'WARN' } else { Write-Log ("Site found (ID " + $site.Id + ", state " + $site.State + ")") 'OK' }
$phys = [Environment]::ExpandEnvironmentVariables($site.PhysicalPath).TrimEnd('\')
if ($phys -ieq $script:IisDir.TrimEnd('\')) { Write-Log ("Physical path is " + $phys) 'OK' }
elseif ($SetPhysicalPath) { Set-ItemProperty -Path ('IIS:\Sites\' + $script:SiteName) -Name physicalPath -Value $script:IisDir; Write-Log ("Physical path changed from " + $phys + " to " + $script:IisDir) 'OK' }
else { Add-Problem ("The site's physical path is " + $phys + " but it must be " + $script:IisDir) 'Run this step with -SetPhysicalPath (changes only the motus site) or change it in IIS Manager.' }
$bindings = @(Get-WebBinding -Name $script:SiteName)
$http = $bindings | Where-Object { $_.protocol -eq 'http' -and $_.bindingInformation -eq ('*:80:' + $script:Domain) }
$https = $bindings | Where-Object { $_.protocol -eq 'https' -and $_.bindingInformation -eq ('*:443:' + $script:Domain) }
if ($http) { Write-Log ("HTTP binding present (*:80:" + $script:Domain + ")") 'OK' }
elseif ($AddMissingBindings) { New-WebBinding -Name $script:SiteName -Protocol http -Port 80 -HostHeader $script:Domain; Write-Log 'HTTP binding added to the motus site' 'OK' }
else { Add-Problem ("The motus site has no HTTP binding for " + $script:Domain + " on port 80.") 'Run this step with -AddMissingBindings, or add it in IIS Manager (Edit Bindings).' }
$cert = $null
if (-not $https) { Add-Problem ("The motus site has no HTTPS binding for " + $script:Domain + " on port 443.") ("In IIS Manager: Sites -> motus -> Bindings -> Add: type https, port 443, host name " + $script:Domain + ", tick 'Require Server Name Indication', choose the certificate for " + $script:Domain + ".") }
else {
    if ([int]$https.sslFlags -band 1) { Write-Log 'HTTPS binding uses SNI' 'OK' } else { Write-Log 'The HTTPS binding does not have "Require Server Name Indication" ticked. With other HTTPS sites on this IP that can serve the wrong certificate.' 'WARN' }
    $hash = [string]$https.certificateHash
    if (-not $hash) { Add-Problem 'The HTTPS binding has no certificate selected.' ("Choose a certificate that covers " + $script:Domain + " in the binding.") }
    else {
        $store = [string]$https.certificateStoreName; if (-not $store) { $store = 'My' }
        $cert = Get-Item -Path ("Cert:\LocalMachine\" + $store + "\" + $hash) -ErrorAction SilentlyContinue
        if (-not $cert) { Add-Problem ("The certificate selected for the HTTPS binding (" + $hash + ") was not found in the store.") 'Select a valid certificate in the binding.' }
        else {
            $names = @($cert.DnsNameList | ForEach-Object { $_.Unicode })
            if (Test-CertCoversHost $names $script:Domain) { Write-Log ("The certificate covers " + $script:Domain + " (names: " + ($names -join ', ') + ")") 'OK' } else { Add-Problem ("The bound certificate does NOT cover " + $script:Domain + " (it covers: " + ($names -join ', ') + ").") ("Obtain a certificate that includes " + $script:Domain + " (for example with win-acme / Let's Encrypt, or import your own .pfx) and select it for the HTTPS binding. No certificate is included with MOTUS on purpose.") }
            if ($cert.NotAfter -lt (Get-Date)) { Add-Problem ("The certificate expired on " + $cert.NotAfter.ToString('yyyy-MM-dd')) 'Renew it and select the new one in the binding.' }
            elseif ($cert.NotAfter -lt (Get-Date).AddDays(21)) { Write-Log ("The certificate expires soon: " + $cert.NotAfter.ToString('yyyy-MM-dd')) 'WARN' }
            else { Write-Log ("Certificate valid until " + $cert.NotAfter.ToString('yyyy-MM-dd')) 'OK' }
        }
    }
}
$others = @(Get-Website | Where-Object { $_.Name -ne $script:SiteName })
Write-Log ("Other IIS sites on this server (" + $others.Count + ") were not touched.")

Write-Log 'IIS folder' 'STEP'
if (-not (Test-Path (Join-Path $script:IisDir 'web.config'))) { Add-Problem ("web.config is missing from " + $script:IisDir) 'Extract the deployment ZIP again.' }
else {
    try { [xml]$null = Get-Content (Join-Path $script:IisDir 'web.config') -Raw; Write-Log 'web.config is valid XML' 'OK' } catch { Add-Problem ('web.config is not valid XML: ' + $_.Exception.Message) 'Extract the deployment ZIP again.' }
}
$acme = Join-Path $script:IisDir '.well-known\acme-challenge'
if (-not (Test-Path $acme)) { New-Item -ItemType Directory -Path $acme -Force | Out-Null }
$r = Invoke-Native 'icacls.exe' @($script:IisDir, '/grant', '*S-1-5-32-568:(OI)(CI)RX', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/T', '/C', '/Q')
if ($r.ExitCode -eq 0) { Write-Log 'IIS_IUSRS can read the iis folder' 'OK' } else { Write-Log ("icacls warning: " + $r.Stderr) 'WARN' }
$extra = @(Get-ChildItem -Path $script:IisDir -Force -Recurse | Where-Object { -not $_.PSIsContainer -and $_.Name -notin @('web.config', 'motus-iis-check.txt') -and $_.FullName -notlike '*\.well-known\*' })
if ($extra.Count) { Write-Log ("The iis folder contains files other than IIS configuration/validation files: " + (($extra | ForEach-Object { $_.Name }) -join ', ') + ". Application files and secrets must stay in ..\app and ..\config.") 'WARN' } else { Write-Log 'The iis folder contains only IIS files' 'OK' }

if ($problems.Count -eq 0) {
    Write-Log 'Live checks through IIS' 'STEP'
    $a = Invoke-HttpRaw '127.0.0.1' 80 '/motus-iis-check.txt' $script:Domain
    if ($a.Ok -and $a.Status -eq 200 -and $a.Body -match 'MOTUS IIS check') { Write-Log 'IIS serves the validation file for http://motus.sabeelbus.com (the site points at the right folder)' 'OK' }
    else { Add-Problem ("Expected the validation file over HTTP, got status " + $a.Status + " " + $a.Error) 'Check that the site is started and its physical path and bindings are right; also that the URL Rewrite module is working (IIS Manager -> motus -> URL Rewrite shows the MOTUS rules).' }
    $b = Invoke-HttpRaw '127.0.0.1' 80 '/' $script:Domain
    if ($b.Status -eq 301 -and $b.Headers['location'] -like 'https://*') { Write-Log 'HTTP is redirected to HTTPS' 'OK' } else { Add-Problem ("Expected a redirect from HTTP to HTTPS, got status " + $b.Status) 'Make sure the motus rules are active (URL Rewrite) and nothing else answers on port 80 for this host name.' }
    $c = Invoke-HttpRaw '127.0.0.1' 443 '/motus-iis-check.txt' $script:Domain $true $script:Domain
    if ($c.Ok -and $c.Status -eq 200) {
        Write-Log 'IIS answers on HTTPS for this host name' 'OK'
        if (Test-CertCoversHost $c.CertNames $script:Domain) { Write-Log ("Certificate presented to browsers: " + $c.CertSubject + " (valid until " + $c.CertNotAfter.ToString('yyyy-MM-dd') + ")") 'OK' } else { Add-Problem ("The certificate IIS presents for " + $script:Domain + " does not cover it: " + ($c.CertNames -join ', ')) 'Fix the certificate in the HTTPS binding.' }
    } else { Add-Problem ("HTTPS check failed: status " + $c.Status + " " + $c.Error) 'Check the HTTPS binding and certificate (see above).' }
}
if ($problems.Count) { Write-Log '' 'INFO'; Write-Log ("IIS is NOT ready: " + $problems.Count + " problem(s). Fix them and run 3-Configure-IIS.ps1 again.") 'ERROR'; exit 1 }
Write-Log 'IIS is ready for MOTUS.' 'OK'
