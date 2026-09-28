$ErrorActionPreference = 'Stop'
try {
  if (Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue) { throw '请先正常退出 DSH Desktop，再双击安装。安装器不会强制关闭你的任务。' }
  $candidates = @()
  foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
    Get-ItemProperty "$root\*" -ErrorAction SilentlyContinue | Where-Object DisplayName -Like '*DSH*' | ForEach-Object { if ($_.InstallLocation) { $candidates += $_.InstallLocation } }
  }
  $candidates += @("$env:LOCALAPPDATA\Programs\DSH Desktop", "$env:ProgramFiles\DSH Desktop")
  function Find-BundledNode($directory) {
    foreach ($layout in @('app.asar.unpacked','app')) {
      $candidate = Join-Path $directory "resources\$layout\node_modules\node\bin\node.exe"
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  $dshDir = $candidates | Where-Object { Find-BundledNode $_ } | Select-Object -First 1
  if (!$dshDir) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = '请选择 DSH Desktop.exe（只需选择一次）'
    $picker.Filter = 'DSH Desktop|DSH Desktop.exe'
    if ($picker.ShowDialog() -ne 'OK') { throw '已取消安装，未修改工作台。' }
    $dshDir = Split-Path -Parent $picker.FileName
  }
  $nodePath = Find-BundledNode $dshDir
  if (!$nodePath) { throw '该目录没有 DSH 自带的 Node，请先安装完整的 DSH Desktop。' }
  & $nodePath (Join-Path $PSScriptRoot 'install-portable.mjs')
  if ($LASTEXITCODE -ne 0) { throw '安装失败，请保留上方错误信息。' }
  Start-Process (Join-Path $PSScriptRoot '使用说明.html')
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
