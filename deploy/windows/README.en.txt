MOTUS FLEET - Windows Server 2022 deployment (English)
=======================================================
Domain: motus.sabeelbus.com   IIS site: motus (ID 29)   Folder: C:\Website\Motus   App: Node.js on 127.0.0.1:3000 only

WHAT YOU NEED BEFORE YOU START
  1. Windows Server 2022 x64 and an Administrator account.
  2. IIS with the "URL Rewrite" module and "Application Request Routing (ARR)" installed.
  3. The IIS site "motus" with physical path C:\Website\Motus\iis and bindings for motus.sabeelbus.com on HTTP 80 and
     HTTPS 443 (SNI). The HTTPS binding must use a certificate that covers motus.sabeelbus.com (a certificate is NOT
     included in this package, on purpose). Other IIS sites are never touched.
  4. Internet access from the server to nodejs.org and get.enterprisedb.com (to download Node.js and PostgreSQL), or
     the installers copied by hand (see "Without internet" below). About 3 GB free disk space.
  5. About 20 minutes. You do not need to know PostgreSQL, Node.js or npm. You do NOT run "npm install" or "npm run build".

INSTALL (one step)
  1. Extract the ZIP so that this file exists:  C:\Website\Motus\app\server.js   (and C:\Website\Motus\Install-Motus.cmd).
  2. Right-click  Install-Motus.cmd  ->  Run as administrator.
  3. Answer the few questions (first administrator e-mail and name; optionally the first company).
  4. Wait for "MOTUS is installed and verified". If a step fails it stops, explains in plain words what to do, and
     you run Install-Motus.cmd again - it continues safely and never replaces existing passwords or data.
  5. Open  C:\Website\Motus\config\initial-credentials.txt , sign in at https://motus.sabeelbus.com, choose a new
     password when asked, then DELETE that file.
  Logs of every step: C:\Website\Motus\logs\

WHAT THE INSTALLER DOES (each step can also be run alone, as Administrator, in PowerShell or by double-click on the .ps1 via "Run with PowerShell")
  1-Install-Prerequisites.ps1  Downloads Node.js 22 LTS from nodejs.org, checks its SHA-256 against the official SHASUMS256.txt
                               and its digital signature (OpenJS Foundation), unpacks it into runtime\node. Detects PostgreSQL
                               (14 or newer); if absent downloads the EnterpriseDB installer for the current PostgreSQL 16.x,
                               checks its signature and installs it silently, service starts automatically. The PostgreSQL
                               "postgres" password is generated and saved in config\postgres-superuser.txt (restricted).
  2-Setup-Database.ps1         Creates database "motus", users motus_owner (migrations/backups) and motus_app (the application,
                               cannot bypass security), strong random passwords, writes config\motus.env (only Administrators,
                               SYSTEM and LOCAL SERVICE can read it), runs migrations, creates the first administrator.
  3-Configure-IIS.ps1          Checks IIS, URL Rewrite, ARR (enabling the ARR proxy is a server-wide switch: it asks first, or use
                               -EnableArrProxy), site folder, bindings, that the certificate covers motus.sabeelbus.com,
                               and tests the redirect and the validation file. Only the motus site is looked at.
  4-Install-AutoStart.ps1      Scheduled tasks: Motus-App (starts at boot, restarts after a crash, watches /healthz) and
                               Motus-Backup (every night 02:30, keeps 14 backups in backups\).
  5-Verify-Deployment.ps1      Automatic verification: database connection, migration status, admin sign-in, real create/read/update
                               (on a throw-away database, your data is not changed), company isolation, data kept after
                               an application restart, port 3000 bound to 127.0.0.1 only, HTTP->HTTPS redirect, certificate.

ENVIRONMENT VARIABLES (file config\motus.env - created for you; template: config\motus.env.example)
  MOTUS_HOST=127.0.0.1  MOTUS_PORT=3000  PUBLIC_ORIGIN=https://motus.sabeelbus.com  MOTUS_TRUST_PROXY=1
  PGHOST PGPORT PGDATABASE  MOTUS_DB_APP_USER/PASSWORD  MOTUS_DB_OWNER_USER/PASSWORD
  MOTUS_CREDENTIALS_KEY (64 hex characters; encrypts stored provider credentials - NEVER change or lose it)
  MOTUS_TIMEZONE=Africa/Cairo  MOTUS_LOG_LEVEL=info  MOTUS_SESSION_HOURS=12  MOTUS_SESSION_IDLE_MINUTES=120
  Never copy this file into the iis folder or send it by e-mail.

MIGRATION COMMANDS (only if you want to run them by hand; the installer and updater already do this)
  set MOTUS_ROOT=C:\Website\Motus
  set MOTUS_CONFIG=C:\Website\Motus\config\motus.env
  C:\Website\Motus\runtime\node\node.exe C:\Website\Motus\app\server\tools\migrate.js --status
  C:\Website\Motus\runtime\node\node.exe C:\Website\Motus\app\server\tools\migrate.js
FIRST ADMINISTRATOR BY HAND:  ...\node.exe ...\app\server\tools\create-admin.js --email you@example.com --name "Your Name" --generate

TEST 1 - ON THE SERVER ITSELF (application only)
  Open a browser on the server: http://127.0.0.1:3000  (login page)  and  http://127.0.0.1:3000/healthz  -> {"ok":true,...}
  Or run Verify-Motus.cmd (as Administrator).

TEST 2 - IIS AND DOMAIN
  From the server: http://motus.sabeelbus.com must jump to https://motus.sabeelbus.com ; the login page appears.
  From another computer: https://motus.sabeelbus.com (DNS must point to 45.85.147.186; ports 80 and 443 open in the firewall).
  http://motus.sabeelbus.com/motus-iis-check.txt shows a short text before the redirect rule is active; if you see it the site folder is right.

TEST 3 - HTTPS
  Click the padlock in the browser: the certificate must be issued to motus.sabeelbus.com and not expired.
  Verify-Motus.cmd checks the same from the server and reports PASS/FAIL for each item.

DAILY OPERATION
  Start-Motus.cmd / Stop-Motus.cmd / Restart-Motus.cmd (as Administrator). After a server reboot MOTUS starts by itself; after a crash it is restarted within seconds.
  Backup-Motus.cmd makes a backup now. Nightly backups are in C:\Website\Motus\backups. COPY THEM to another computer regularly.
  Restore:  powershell -ExecutionPolicy Bypass -File Restore-Database.ps1 -File C:\Website\Motus\backups\<file>.dump   (replaces all data; asks you to type RESTORE)
  Prove that restore works:  powershell -ExecutionPolicy Bypass -File Test-BackupRestore.ps1   (takes a backup, restores it into the live DB, compares row counts)
  Forgot the administrator password:  Reset-Password.cmd  (prints a temporary password once)
  Logs: logs\motus-*.log (application), logs\supervisor.log, logs\node-err.log, logs\install-*.log

UPDATE TO A NEW VERSION (keeps database, passwords and settings)
  1. Extract the new ZIP to a temporary folder, e.g. C:\Temp\Motus-new  (NOT over C:\Website\Motus).
  2. As Administrator in PowerShell:
        cd C:\Website\Motus
        powershell -ExecutionPolicy Bypass -File .\Update-Motus.ps1 -NewPackage C:\Temp\Motus-new
  The script backs up the database, swaps the application (old copy kept as app.previous), applies migrations, starts the
  new version, verifies it and - if anything fails - puts the old version back automatically.

ROLLBACK
  powershell -ExecutionPolicy Bypass -File .\Rollback-Motus.ps1                    (application files only)
  powershell -ExecutionPolicy Bypass -File .\Rollback-Motus.ps1 -RestoreDatabase   (also restores the pre-update backup; data entered after the update is lost)

WITHOUT INTERNET ON THE SERVER
  Download on another computer: Node.js 22 LTS "win-x64.zip" from nodejs.org (and copy its SHA-256 from SHASUMS256.txt on the same site), and the
  PostgreSQL 16 Windows installer from postgresql.org (EnterpriseDB). Copy them to the server and run, as Administrator:
    powershell -ExecutionPolicy Bypass -File 1-Install-Prerequisites.ps1 -NodeZip C:\Temp\node-v22.x.y-win-x64.zip -NodeSha256 <sha256> -PostgresInstaller C:\Temp\postgresql-16.x-windows-x64.exe
  then run Install-Motus.cmd (it detects what is already installed).

NOT IN THIS ZIP (on purpose) AND WHAT TO DO
  * node.exe and the PostgreSQL installer: downloaded and verified by step 1 (they could not be fetched where this package was built).
  * TLS certificate/private key: obtain one for motus.sabeelbus.com (win-acme/Let's Encrypt or your CA) and bind it in IIS.
  * Passwords/keys: generated on your server by step 2; they exist only in config\.
  * Vendor connections (GPS vendor, fuel/toll cards, ERP product, SMS/WhatsApp, e-invoice submission, AI model): the application has the data model, APIs and webhooks; each vendor needs its own credentials entered in Settings.

TROUBLESHOOTING
  "The site shows 502/503": run Verify-Motus.cmd; check Start-Motus.cmd output and logs\node-err.log (is PostgreSQL running? password in config\motus.env?).
  "Port 3000 in use": another program uses it; stop it, MOTUS must use 127.0.0.1:3000.
  "Login works on the server but not through the domain": PUBLIC_ORIGIN in config\motus.env must be exactly https://motus.sabeelbus.com ; restart MOTUS.
  "Certificate warning": the bound certificate does not cover the name or is expired - run 3-Configure-IIS.ps1 and read the message.
