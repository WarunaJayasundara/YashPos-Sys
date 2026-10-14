# Daily MySQL backup for YASH MOBILE POS (Windows). Schedule with Task Scheduler.
# Usage: powershell -File scripts\backup.ps1 [-MysqlBin "C:\xampp\mysql\bin"] [-Keep 30]
param(
  [string]$MysqlBin = "C:\xampp\mysql\bin",
  [string]$Database = "yash_pos",
  [string]$User = "root",
  [string]$OutDir = "$PSScriptRoot\..\backups",
  [int]$Keep = 30
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $OutDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = Join-Path $OutDir "$Database-$stamp.sql"
# Password comes from the MYSQL_PWD environment variable (never put it in this file).
& "$MysqlBin\mysqldump.exe" --user=$User --single-transaction --routines --triggers --default-character-set=utf8mb4 --result-file="$file" $Database
if ($LASTEXITCODE -ne 0) { throw "mysqldump failed ($LASTEXITCODE)" }
Compress-Archive -Path $file -DestinationPath "$file.zip" -Force
Remove-Item $file
# copy uploaded images / attachments too
$uploads = Join-Path $PSScriptRoot "..\server\uploads"
if (Test-Path $uploads) { Compress-Archive -Path "$uploads\*" -DestinationPath (Join-Path $OutDir "uploads-$stamp.zip") -Force -ErrorAction SilentlyContinue }
Get-ChildItem $OutDir -Filter "*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -Skip ($Keep * 2) | Remove-Item
Write-Output "Backup written: $file.zip"
