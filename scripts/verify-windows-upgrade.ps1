param(
  [Parameter(Mandatory = $true)]
  [string]$CurrentInstaller
)

$ErrorActionPreference = 'Stop'
$oldReleaseDirectory = Join-Path $env:RUNNER_TEMP 'arava-old-release'
New-Item -ItemType Directory -Force -Path $oldReleaseDirectory | Out-Null

gh release download v0.5.1 `
  --repo archigoood-sudo/ARAVA-CRM `
  --pattern 'ARAVA-CRM-0.5.1-x64.exe' `
  --dir $oldReleaseDirectory

$oldInstaller = Join-Path $oldReleaseDirectory 'ARAVA-CRM-0.5.1-x64.exe'
$installDirectory = Join-Path $env:LOCALAPPDATA 'Programs\ARAVA CRM'
$installedExecutable = Join-Path $installDirectory 'ARAVA CRM.exe'

Start-Process -FilePath $oldInstaller -ArgumentList '/S' -Wait
if (-not (Test-Path $installedExecutable)) {
  throw "The 0.5.1 installer did not create $installedExecutable"
}

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

Start-Process -FilePath $CurrentInstaller -ArgumentList '/S' -Wait
if (-not (Test-Path $installedExecutable)) {
  throw "The current installer did not preserve $installedExecutable"
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
