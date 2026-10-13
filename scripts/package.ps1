$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionPath = Join-Path $projectRoot 'extension'
$outputPath = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$archivePath = Join-Path $outputPath 'discord-checker.zip'
Compress-Archive -Path (Join-Path $extensionPath '*') -DestinationPath $archivePath -Force
Write-Output "Packaged extension: $archivePath"
