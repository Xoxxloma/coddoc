# pack.ps1 — то же, что pack.sh, для Windows: собрать карту сервисов из слепка services\ и открыть её в браузере.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File <папка скилла>/reference/pack.ps1 [-NoOpen] [папка слепка] [сервис]
#
# Что берётся, куда пишется, формат data.js и что печатается — как в pack.sh; правятся оба файла вместе.
# Слэши в путях прямые: если агент выполняет команды через bash, обратные он съест.
# LANDSCAPE_NO_OPEN=1 в окружении — не открывать браузер, вывод как обычно (проверки без экрана).
#
# Пишется под Windows PowerShell 5.1 и ограниченный режим языка: только командлеты, без вызовов .NET.
# Поэтому base64 — через Export-Clixml: массив байтов он записывает именно так (<BA>…</BA>), а
# [Convert] в ограниченном режиме закрыт. По той же причине не поменять кодировку консоли — последняя
# строка вывода только ASCII, её и читает агент.
# Файл хранится в UTF-8 с BOM — без него 5.1 читает русские строки как cp1251.
param(
  [switch]$NoOpen,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Где разрешено (не ограниченный режим) — русский вывод в UTF-8; где нет — остаётся как есть.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$MaxText = 5MB

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$viewer = Join-Path $here 'viewer'
$cwd = (Get-Location).ProviderPath

function Fail([string]$code, [string]$msg) {
  Write-Output $msg
  Write-Output "landscape: error $code"
  exit 1
}

# Строка JSON: в путях и именах из того, что надо экранировать, бывают только \ и ".
function J([string]$s) { return '"' + ($s -replace '\\', '\\' -replace '"', '\"') + '"' }

# base64 для списка файлов одним проходом Export-Clixml.
function Get-Base64([string[]]$fulls) {
  if ($fulls.Count -eq 0) { return ,@() }
  $blobs = @()
  foreach ($f in $fulls) {
    $b = Get-Content -LiteralPath $f -Encoding Byte -Raw
    if ($null -eq $b) { $b = [byte[]]@() }
    $blobs += , ([byte[]]$b)
  }
  $xml = Join-Path $script:work ('base64-' + (Get-Random) + '.xml')
  try {
    Export-Clixml -LiteralPath $xml -InputObject $blobs -Encoding UTF8
    $raw = Get-Content -LiteralPath $xml -Raw -Encoding UTF8
  } finally {
    Remove-Item -LiteralPath $xml -ErrorAction SilentlyContinue
  }
  $out = @([regex]::Matches($raw, '<BA>([^<]*)</BA>|<BA\s*/>') | ForEach-Object { $_.Groups[1].Value })
  if ($out.Count -ne $fulls.Count) { throw "base64: ждали $($fulls.Count), вышло $($out.Count)" }
  return ,$out
}

function Write-Utf8([string]$path, [string]$text) {
  Set-Content -LiteralPath "$path.tmp" -Value $text -Encoding UTF8 -NoNewline
  Move-Item -LiteralPath "$path.tmp" -Destination $path -Force
}

# Аргумент — папка слепка, если это папка с карточками *.md или manifest.yaml; остальное — имя сервиса
# (сервис может зваться как папка в корне — context, notes).
function Test-Snapshot([string]$p) {
  if (-not (Test-Path -LiteralPath $p -PathType Container)) { return $false }
  return [bool](@(Get-ChildItem -LiteralPath $p -File | Where-Object { $_.Name -match '\.md$' -or $_.Name -match '^manifest\.ya?ml$' }).Count)
}

# ---------------------------------------------------------------- вход
$dir = ''
$focus = ''
foreach ($a in @($Rest | Where-Object { $_ })) {
  if ($a -eq '--no-open') { $NoOpen = $true; continue }
  if (-not $dir -and (Test-Snapshot $a)) { $dir = $a; continue }
  if (-not $focus) { $focus = $a }
}

# Временные файлы скиллов — в одной папке .coddoc-tmp\ в корне репозитория, у каждого скилла своя подпапка.
# Нет git или не репозиторий — от текущей папки.
$top = $cwd
try {
  # stderr git («not a git repository») не должен обрывать скрипт: решает код возврата.
  $ErrorActionPreference = 'Continue'
  $t = & git rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -eq 0 -and $t) { $top = (Resolve-Path -LiteralPath $t).ProviderPath.TrimEnd('\') }
} catch { }
$ErrorActionPreference = 'Stop'

if (-not $dir) {
  # Имя сервиса похоже на путь (есть слэш) — значит, папку назвали, а её нет.
  if ($focus -match '[\\/]') { Fail 'not-found' "нет такой папки: $focus" }
  if (Test-Path -LiteralPath (Join-Path $top 'services') -PathType Container) { $dir = Join-Path $top 'services' }
  elseif (Test-Path -LiteralPath (Join-Path $cwd 'services') -PathType Container) { $dir = Join-Path $cwd 'services' }
  else { Fail 'not-found' "нет папки services\ в $top — назови папку слепка" }
}
$root = (Resolve-Path -LiteralPath $dir).ProviderPath.TrimEnd('\')

# Подпись набора: путь от корня репозитория, вне его — как есть.
if ($root -eq $top) { $label = '.' }
elseif ($root.ToLower().StartsWith(($top.TrimEnd('\') + '\').ToLower())) {
  $label = $root.Substring($top.TrimEnd('\').Length + 1) -replace '\\', '/'
} else { $label = $root -replace '\\', '/' }

# ---------------------------------------------------------------- что берём
$list = @(Get-ChildItem -LiteralPath $root -File | Where-Object { $_.Name -match '\.md$' -or $_.Name -match '^manifest\.ya?ml$' } |
  Sort-Object Name | ForEach-Object { $_.Name })
$histDir = Join-Path $root '_history'
if (Test-Path -LiteralPath $histDir -PathType Container) {
  $list += @(Get-ChildItem -LiteralPath $histDir -File | Where-Object { $_.Name -match '\.md$' } |
    Sort-Object Name | ForEach-Object { '_history/' + $_.Name })
}

$nCards = @($list | Where-Object { $_ -notmatch '/' -and $_ -match '\.md$' }).Count
$nHist = @($list | Where-Object { $_ -match '^_history/' }).Count
$manifest = if (@($list | Where-Object { $_ -match '^manifest\.ya?ml$' }).Count) { 'yes' } else { 'no' }
if ($nCards -eq 0) { Fail 'no-cards' "в $root нет карточек *.md" }

$script:work = Join-Path (Join-Path $top '.coddoc-tmp') 'landscape'
try {
  New-Item -ItemType Directory -Force -Path $script:work | Out-Null
  $ignore = Join-Path $top '.coddoc-tmp\.gitignore'
  if (-not (Test-Path -LiteralPath $ignore)) { Set-Content -LiteralPath $ignore -Value '*' -Encoding Ascii }
} catch {
  Fail 'no-write' "не могу писать в $($script:work)"
}

$made = Get-Date -Format 'yyyy-MM-dd HH:mm'
$stamp = Get-Date -Format 'yyyyMMddHHmmss'

# ---------------------------------------------------------------- data.js
$sizes = @{}
foreach ($f in $list) { $sizes[$f] = (Get-Item -LiteralPath (Join-Path $root ($f -replace '/', '\'))).Length }
$small = @($list | Where-Object { $sizes[$_] -le $MaxText })
$b64 = Get-Base64 @($small | ForEach-Object { Join-Path $root ($_ -replace '/', '\') })
$content = @{}
for ($i = 0; $i -lt $small.Count; $i++) { $content[$small[$i]] = $b64[$i] }

$rows = @()
foreach ($f in $list) {
  $c = if ($content.ContainsKey($f)) { '"' + $content[$f] + '"' } else { 'null' }
  $rows += '[' + (J $f) + ',' + $c + ']'
}
$data = "// создано pack.ps1 $made — не править руками`n" +
  'window.LANDSCAPE_DATA = {"v":1,"made":' + (J $made) + ',"root":' + (J $label) + ',"focus":' + (J $focus) +
  ',"files":[' + "`n" + ($rows -join ",`n") + "`n]};`n"
try { Write-Utf8 (Join-Path $script:work 'data.js') $data } catch { Fail 'no-write' "не могу писать в $($script:work)" }

# ---------------------------------------------------------------- страница
# Поверх на месте: robocopy /E дописывает и перезаписывает файлы viewer\, не трогая data.js.
$rc = & robocopy $viewer $script:work /E /R:3 /W:1 /NJH /NJS /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { $rc; Fail 'no-write' "не могу скопировать страницу в $($script:work)" }
$page = Join-Path $script:work 'index.html'
$html = (Get-Content -LiteralPath (Join-Path $viewer 'index.html') -Raw -Encoding UTF8) -replace '__MADE__', $stamp
Write-Utf8 $page $html
$url = ([uri]$page).AbsoluteUri

$hasManifest = if ($manifest -eq 'yes') { 'есть' } else { 'нет' }
Write-Output "собрано: $label — карточек $nCards, манифест: $hasManifest, история: $nHist"

$status = 'ok'
if ($NoOpen) {
  $status = 'updated'
  Write-Output 'обновлено — нажми F5 во вкладке'
} elseif (-not $env:LANDSCAPE_NO_OPEN) {
  Invoke-Item -LiteralPath $page
}
Write-Output "landscape: $status cards=$nCards manifest=$manifest history=$nHist page=$url"
# Явно: иначе код выхода у вызывающего — от последней внешней команды (robocopy отвечает 1 на «скопировал»).
exit 0
