<#
.SYNOPSIS
  Descarga los adjuntos de cada fila de la lista de SharePoint a una carpeta local,
  organizada por ID de fila (la misma que usan los reportes de la app).

.DESCRIPTION
  Requiere el módulo PnP.PowerShell (se instala solo la primera vez) e inicio de
  sesión interactivo con Microsoft 365. Cada fila genera una subcarpeta con su ID
  y dentro los archivos de imagen numerados en orden de adjunto.

.EXAMPLE
  .\scripts\download-sharepoint-attachments.ps1

.EXAMPLE
  .\scripts\download-sharepoint-attachments.ps1 -OutFolder "C:\fotos\sharepoint-photos" -Force
#>
[CmdletBinding()]
param(
  [string]$SiteUrl = 'https://novedadesplasticas-my.sharepoint.com/personal/vivian_garces_novedadesplasticas_com',
  [string]$ListTitle = 'REPORTE Y SEGUIMIENTO DE HALLAZGOS',
  [string]$OutFolder = (Join-Path $PSScriptRoot '..\sharepoint-photos'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Fail($msg) {
  Write-Host "ERROR: $msg" -ForegroundColor Red
  exit 1
}

if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
  Write-Host 'Instalando modulo PnP.PowerShell (solo la primera vez)...' -ForegroundColor Cyan
  try {
    Install-Module PnP.PowerShell -Scope CurrentUser -Force -AllowClobber
  } catch {
    Fail "No se pudo instalar PnP.PowerShell. Ejecute en PowerShell: Install-Module PnP.PowerShell -Scope CurrentUser -Force. Detalle: $_"
  }
}
Import-Module PnP.PowerShell -ErrorAction Stop

Write-Host "Conectando a $SiteUrl ..." -ForegroundColor Cyan
try {
  Connect-PnPOnline -Url $SiteUrl -Interactive -ErrorAction Stop
} catch {
  Fail "No se pudo conectar. Verifique la URL y su inicio de sesión de Microsoft 365. Detalle: $_"
}

$OutFolder = [System.IO.Path]::GetFullPath($OutFolder)
New-Item -ItemType Directory -Path $OutFolder -Force | Out-Null

Write-Host "Leyendo lista '$ListTitle'..." -ForegroundColor Cyan
try {
  $items = Get-PnPListItem -List $ListTitle -PageSize 100 -ErrorAction Stop
} catch {
  Fail "No se pudo leer la lista '$ListTitle'. Verifique el nombre. Detalle: $_"
}

$total = 0
$rowsWithPhotos = 0
$downloaded = 0
$skipped = 0
$errors = 0

foreach ($item in $items) {
  $total++
  $id = $item.Id
  try {
    Get-PnPProperty -Identity $item -ClientProperty 'Attachments' -ErrorAction Stop
    $files = @($item.AttachmentFiles)
  } catch {
    $files = @()
  }
  if ($files.Count -eq 0) { continue }

  $rowsWithPhotos++
  $dir = Join-Path $OutFolder ([string]$id)
  New-Item -ItemType Directory -Path $dir -Force | Out-Null

  $n = 0
  foreach ($f in $files) {
    $n++
    $name = '{0}_{1}' -f $n, $f.FileName
    $target = Join-Path $dir $name
    if ((Test-Path $target) -and -not $Force) { $skipped++; continue }
    try {
      Get-PnPFile -Url $f.ServerRelativeUrl -Path $dir -FileName $name -AsFile -Force -ErrorAction Stop | Out-Null
      $downloaded++
      Write-Host ("  [{0}] {1}" -f $id, $name) -ForegroundColor DarkGray
    } catch {
      $errors++
      Write-Host ("  Fila {0}: no se pudo descargar {1} - {2}" -f $id, $f.FileName, $_) -ForegroundColor Yellow
    }
  }
}

Disconnect-PnPOnline -WarningAction SilentlyContinue

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ("Filas en la lista:        {0}" -f $total)
Write-Host ("Filas con adjuntos:       {0}" -f $rowsWithPhotos)
Write-Host ("Archivos descargados:     {0}" -f $downloaded)
Write-Host ("Ya existian (omitidos):   {0}" -f $skipped)
Write-Host ("Errores:                  {0}" -f $errors)
Write-Host ("Carpeta:                  {0}" -f $OutFolder)
Write-Host '==============================================' -ForegroundColor Cyan
if ($downloaded -eq 0 -and $skipped -gt 0) {
  Write-Host 'Nada nuevo que descargar: la carpeta ya contiene los adjuntos.' -ForegroundColor Green
}
Write-Host 'Siguiente paso:  npm run import-photos -- "<esta carpeta>" --dry-run' -ForegroundColor Cyan
