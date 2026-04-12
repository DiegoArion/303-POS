# Ejecuta este script UNA SOLA VEZ para crear el acceso directo en el escritorio
$ruta     = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs      = Join-Path $ruta "iniciar.vbs"
$icono    = Join-Path $ruta "extras\icono.ico"
$escritorio = [System.Environment]::GetFolderPath("Desktop")
$acceso   = Join-Path $escritorio "POS - Punto de Venta.lnk"

$wsh  = New-Object -ComObject WScript.Shell
$link = $wsh.CreateShortcut($acceso)
$link.TargetPath       = "wscript.exe"
$link.Arguments        = "`"$vbs`""
$link.WorkingDirectory = $ruta
$link.Description      = "Iniciar sistema de punto de venta"

# Usar icono personalizado si existe, si no usar uno de Windows
if (Test-Path $icono) {
    $link.IconLocation = $icono
} else {
    $link.IconLocation = "C:\Windows\System32\shell32.dll,174"
}

$link.Save()
Write-Host "Acceso directo creado en el escritorio." -ForegroundColor Green
