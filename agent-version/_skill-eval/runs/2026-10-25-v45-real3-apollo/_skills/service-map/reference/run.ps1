# run.ps1 — запуск скрипта скилла на Windows: тот же .sh, но bash — из Git for Windows, а не WSL.
#   powershell -NoProfile -ExecutionPolicy Bypass -File run.ps1 <скрипт.sh> [ИМЯ=значение …] [аргументы …] [--out <файл>]
# ИМЯ=значение сразу после имени скрипта — переменные окружения скрипта (на bash они стоят перед `bash`).
# --out <файл> — вывод скрипта в файл байт в байт: `>` в PowerShell пишет UTF-16 и портит кириллицу.
# Во всех аргументах `\` → `/`: путь с обратной косой ломается в `awk -v`.
# Git Bash вызывающего переписывает `/x` в `<папка Git>/x` (`/api` → `C:/Program Files/Git/api`) — значению,
# которое начинается с папки найденного Git, возвращается `/x`. Путей внутри папки Git скрипту не передают.
# bash: переменная SM_BASH, иначе по git.exe из PATH, иначе стандартные папки Git; System32 (WSL) — никогда.
# Только командлеты: у пользователей PowerShell 5.1 в ConstrainedLanguage. Отказ — последней строкой ASCII.

function Fail($code) { Write-Output "service-map: error $code"; exit 2 }

if ($args.Count -lt 1) { Fail 'usage' }
$name = Split-Path -Leaf ([string]$args[0])
$script = Join-Path $PSScriptRoot $name
if ($name -notmatch '\.sh$' -or -not (Test-Path -LiteralPath $script -PathType Leaf)) { Fail 'unknown-script' }

# аргументы — до поиска bash: SM_BASH словом после имени скрипта тоже в счёт
$rest = @(); $out = $null; $vars = $true; $names = @()
for ($i = 1; $i -lt $args.Count; $i++) {
  $a = [string]$args[$i]
  if ($a -eq '--out') {
    if ($i + 1 -ge $args.Count) { Fail 'usage' }
    $i++; $out = ([string]$args[$i]) -replace '\\', '/'; continue
  }
  if ($vars -and $a -cmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
    Set-Item -Path ('env:' + $Matches[1]) -Value ($Matches[2] -replace '\\', '/'); $names += $Matches[1]; continue
  }
  $vars = $false
  $rest += ($a -replace '\\', '/')
}

$cand = @()
if ($env:SM_BASH) { $cand += $env:SM_BASH }
else {
  $git = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($git) { $cand += Join-Path (Split-Path (Split-Path $git.Source -Parent) -Parent) 'bin\bash.exe' }
  foreach ($root in @($env:ProgramFiles, $env:ProgramW6432, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if ($root) { $cand += Join-Path $root 'Git\bin\bash.exe'; $cand += Join-Path $root 'Programs\Git\bin\bash.exe' }
  }
}
$bash = $null
foreach ($c in $cand) {
  if (($c -replace '/', '\') -notmatch '\\(System32|SysWOW64|Sysnative|WindowsApps)\\' -and (Test-Path -LiteralPath $c -PathType Leaf)) { $bash = $c; break }
}
if (-not $bash) { Fail 'no-git-bash' }

$root = Split-Path (Split-Path $bash -Parent) -Parent   # Git\bin\bash.exe → Git
if ((Split-Path $root -Leaf) -eq 'usr') { $root = Split-Path $root -Parent }   # Git\usr\bin\bash.exe → Git
$root = ($root -replace '\\', '/') + '/'
function Unmsys($v) { if ($v.Length -ge $root.Length -and $v.Substring(0, $root.Length) -eq $root) { '/' + $v.Substring($root.Length) } else { $v } }
foreach ($n in $names) {
  $v = (Get-Item -Path ('env:' + $n) -ErrorAction SilentlyContinue).Value
  if ($v) { Set-Item -Path ('env:' + $n) -Value (Unmsys $v) }
}
$rest = @($rest | ForEach-Object { Unmsys $_ })
if ($out) { $out = Unmsys $out }
$script = $script -replace '\\', '/'

if ($out) {
  # перенаправление делает bash: строка без двойных кавычек — PowerShell 5.1 передаёт их программе битыми
  $env:SM_RUN_OUT = $out
  & $bash -c 'set -f; IFS=; exec $BASH $@ >$SM_RUN_OUT' run $script @rest
} else {
  & $bash $script @rest
}
exit $LASTEXITCODE
