param(
  [Parameter(Mandatory = $true)]
  [string]$CurrentInstaller,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'

function Find-InstalledExecutable([string]$ExpectedPath) {
  if (Test-Path $ExpectedPath) { return (Resolve-Path $ExpectedPath).Path }

  $uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($entry in Get-ItemProperty $uninstallRoots -ErrorAction SilentlyContinue) {
    if ($entry.DisplayName -notlike 'ARAVA CRM*') { continue }
    if ($entry.InstallLocation) {
      $registeredPath = Join-Path $entry.InstallLocation 'ARAVA CRM.exe'
      if (Test-Path $registeredPath) { return (Resolve-Path $registeredPath).Path }
    }
    if ($entry.DisplayIcon) {
      $registeredPath = $entry.DisplayIcon.Trim('"').Split(',')[0]
      if (Test-Path $registeredPath) { return (Resolve-Path $registeredPath).Path }
    }
  }

  $programsRoot = Join-Path $env:LOCALAPPDATA 'Programs'
  if (Test-Path $programsRoot) {
    $candidate = Get-ChildItem $programsRoot -Filter 'ARAVA CRM.exe' -File -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }

  return $null
}

function Wait-ForInstalledExecutable([string]$ExpectedPath, [string]$InstallerName) {
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    $installedPath = Find-InstalledExecutable $ExpectedPath
    if ($installedPath) { return $installedPath }
    Start-Sleep -Seconds 1
  }
  throw "$InstallerName installer did not register or create ARAVA CRM.exe"
}

function Install-IntoTestDirectory([string]$InstallerPath, [string]$InstallerName, [string]$InstallDirectory) {
  $process = Start-Process -FilePath $InstallerPath -ArgumentList @('/S', "/D=$InstallDirectory") -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "$InstallerName installer exited with code $($process.ExitCode)"
  }
}

$oldReleaseDirectory = Join-Path $env:RUNNER_TEMP 'arava-old-release'
New-Item -ItemType Directory -Force -Path $oldReleaseDirectory | Out-Null

gh release download v0.5.1 `
  --repo archigoood-sudo/ARAVA-CRM `
  --pattern 'ARAVA-CRM-0.5.1-x64.exe' `
  --dir $oldReleaseDirectory

$oldInstaller = Join-Path $oldReleaseDirectory 'ARAVA-CRM-0.5.1-x64.exe'
$installDirectory = Join-Path $env:LOCALAPPDATA 'ARAVA-CRM-upgrade-verification'
$installedExecutable = Join-Path $installDirectory 'ARAVA CRM.exe'

Install-IntoTestDirectory $oldInstaller 'The 0.5.1' $installDirectory
$installedExecutable = Wait-ForInstalledExecutable $installedExecutable 'The 0.5.1'

$dataDirectory = Join-Path $env:APPDATA '@arava\desktop'
$mediaDirectory = Join-Path $dataDirectory 'managed-media\customer-display'
New-Item -ItemType Directory -Force -Path $mediaDirectory | Out-Null

$databasePath = Join-Path $dataDirectory 'arava.db'
$settingsPath = Join-Path $dataDirectory 'settings.json'
$mediaPath = Join-Path $mediaDirectory 'upgrade-sentinel.png'
[IO.File]::WriteAllBytes($databasePath, [Text.Encoding]::UTF8.GetBytes('existing-sqlite-data'))
[IO.File]::WriteAllText($settingsPath, '{"deviceId":"existing-device"}')
[IO.File]::WriteAllBytes($mediaPath, [byte[]](1, 2, 3, 4, 5))

$before = @{
  database = (Get-FileHash $databasePath -Algorithm SHA256).Hash
  settings = (Get-FileHash $settingsPath -Algorithm SHA256).Hash
  media = (Get-FileHash $mediaPath -Algorithm SHA256).Hash
}

Install-IntoTestDirectory $CurrentInstaller 'The current' $installDirectory
$updatedExecutable = Wait-ForInstalledExecutable $installedExecutable 'The current'
if ($updatedExecutable -ne $installedExecutable) {
  throw "The current installer did not update the existing installation in place"
}

$metadataPath = Join-Path (Split-Path $updatedExecutable -Parent) 'resources\\app-metadata.json'
if (-not (Test-Path $metadataPath)) {
  throw 'The current installer did not include app-metadata.json'
}
$metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
$installedVersion = $metadata.appVersion
if ([string]::IsNullOrWhiteSpace($installedVersion)) {
  $metadataKeys = ($metadata.PSObject.Properties.Name | Sort-Object) -join ', '
  throw "The current installer version metadata is missing appVersion. Available keys: $metadataKeys"
}
if ($installedVersion -ne $ExpectedVersion) {
  throw "The current installer version '$installedVersion' does not match expected '$ExpectedVersion'"
}

$after = @{
  database = (Get-FileHash $databasePath -Algorithm SHA256).Hash
  settings = (Get-FileHash $settingsPath -Algorithm SHA256).Hash
  media = (Get-FileHash $mediaPath -Algorithm SHA256).Hash
}

foreach ($key in $before.Keys) {
  if ($before[$key] -ne $after[$key]) {
    throw "Windows upgrade changed installation-bound $key data"
  }
}

Write-Host 'Windows in-place upgrade preserved SQLite, settings and managed media.'
