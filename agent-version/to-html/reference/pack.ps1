# pack.ps1 — то же, что pack.sh, для Windows: собрать markdown в страницу и открыть её в браузере.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File <папка скилла>/reference/pack.ps1 [-NoOpen] [путь ...]
#
# Что собирается, куда пишется, формат data.js и что печатается — как в pack.sh; правятся оба файла вместе.
# Слэши в путях прямые: если агент выполняет команды через bash, обратные он съест.
# TO_HTML_NO_OPEN=1 в окружении — не открывать браузер, вывод как обычно (проверки без экрана).
#
# Пишется под Windows PowerShell 5.1 и ограниченный режим языка: только командлеты, без вызовов .NET.
# Поэтому base64 — через Export-Clixml: массив байтов он записывает именно так (<BA>…</BA>), а
# [Convert] в ограниченном режиме закрыт. По той же причине не поменять кодировку консоли — последняя
# строка вывода только ASCII, её и читает агент.
# Файл хранится в UTF-8 с BOM — без него 5.1 читает русские строки как cp1251.
param(
  [switch]$NoOpen,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Paths
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Где разрешено (не ограниченный режим) — русский вывод в UTF-8; где нет — остаётся как есть.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$MaxFiles = 2000
$MaxText = 5MB
$MaxImg = 15MB
$MaxSets = 10
$TextExt = @('md', 'markdown', 'txt', 'puml', 'plantuml', 'mmd', 'yaml', 'yml', 'json')
$Mime = @{ png = 'image/png'; jpg = 'image/jpeg'; jpeg = 'image/jpeg'; gif = 'image/gif'; webp = 'image/webp'; svg = 'image/svg+xml' }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$viewer = Join-Path $here 'viewer'
$cwd = (Get-Location).ProviderPath

function Fail([string]$code, [string]$msg) {
  Write-Output $msg
  Write-Output "to-html: error $code"
  exit 1
}

function Get-Kind([string]$rel) {
  if ($rel -match '\.([^./]+)$') {
    $e = $Matches[1].ToLower()
    if ($TextExt -contains $e) { return 'text' }
    if ($Mime.ContainsKey($e)) { return 'img' }
  }
  return 'other'
}

# Строка JSON: в путях Windows из того, что надо экранировать, бывают только \ и ".
function J([string]$s) { return '"' + ($s -replace '\\', '\\' -replace '"', '\"') + '"' }

function Get-Full([string]$rel) { return Join-Path $script:root ($rel -replace '/', '\') }

# Нормализует a/./b/../c → a/c; путь выше корня набора — пусто.
function Get-NormRel([string]$rel) {
  $out = @()
  foreach ($part in ($rel -split '/')) {
    if ($part -eq '' -or $part -eq '.') { continue }
    if ($part -eq '..') {
      if ($out.Count -eq 0) { return '' }
      $out = @($out | Select-Object -First ($out.Count - 1))
      continue
    }
    $out += $part
  }
  return ($out -join '/')
}

# Файлы под папкой; $depth — сколько уровней подпапок ещё можно открыть (-1 — без предела). Скрытые и
# node_modules не заходим; на MAX_FILES + 1 останавливаемся, чтобы не обходить огромные деревья.
function Add-Files([string]$full, [string]$prefix, [int]$depth) {
  foreach ($e in @(Get-ChildItem -LiteralPath $full)) {
    if ($script:list.Count -gt $MaxFiles) { return }
    if ($e.Name.StartsWith('.') -or $e.Name -eq 'node_modules') { continue }
    $rel = if ($prefix) { $prefix + '/' + $e.Name } else { $e.Name }
    if ($e.PSIsContainer) {
      if ($depth -ne 0) { Add-Files $e.FullName $rel ($depth - 1) }
    } else {
      $script:list += $rel
    }
  }
}

# Режим «файл и его ссылки»: на что ссылается файл — ](…), [[…]], ![[…]].
function Get-Links([string]$rel) {
  $text = Get-Content -LiteralPath (Get-Full $rel) -Raw -Encoding UTF8
  if ($null -eq $text) { return }
  $dir = ''
  $i = $rel.LastIndexOf('/')
  if ($i -ge 0) { $dir = $rel.Substring(0, $i) }
  foreach ($m in [regex]::Matches($text, '\]\(<([^>]+)>|\]\(([^) ]+)')) {
    $t = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
    if ($t -match '^(https?:|mailto:|#|/)') { continue }
    $t = ($t -split '#')[0]
    $t = ($t -split '\?')[0]
    $t = [uri]::UnescapeDataString($t)
    $n = Get-NormRel $(if ($dir) { "$dir/$t" } else { $t })
    if ($n -and (Test-Path -LiteralPath (Get-Full $n) -PathType Leaf)) { $n }
  }
  foreach ($m in [regex]::Matches($text, '\[\[([^\]|#]+)')) {
    $name = $m.Groups[1].Value
    $found = ''
    foreach ($c in @($name, "$name.md")) {
      $t = if ($dir) { "$dir/$c" } else { $c }
      if (Test-Path -LiteralPath (Get-Full $t) -PathType Leaf) { $found = $t; break }
    }
    if (-not $found) {
      $hit = Get-ChildItem -LiteralPath $script:root -Recurse -Depth 2 -File |
        Where-Object { ($_.Name -eq $name -or $_.Name -eq "$name.md") -and $_.FullName -notmatch '\\(\.[^\\]*|node_modules)\\' } |
        Select-Object -First 1
      if ($hit) { $found = $hit.FullName.Substring($script:root.Length).TrimStart('\') -replace '\\', '/' }
    }
    if ($found) { $found }
  }
}

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

# ---------------------------------------------------------------- вход
$inputs = @()
foreach ($p in @($Paths | Where-Object { $_ })) {
  if ($p -eq '--no-open') { $NoOpen = $true; continue }
  if (-not (Test-Path -LiteralPath $p)) { Fail 'not-found' "нет такого пути: $p" }
  $inputs += (Resolve-Path -LiteralPath $p).ProviderPath.TrimEnd('\')
}

# Временные файлы скиллов — в одной папке .coddoc-tmp\ в корне репозитория, у каждого скилла своя подпапка;
# запуск из подпапки репозитория пишет туда же. Нет git или не репозиторий — от текущей папки.
$top = $cwd
try {
  # stderr git («not a git repository») не должен обрывать скрипт: решает код возврата.
  $ErrorActionPreference = 'Continue'
  $t = & git rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -eq 0 -and $t) { $top = (Resolve-Path -LiteralPath $t).ProviderPath.TrimEnd('\') }
} catch { }
$ErrorActionPreference = 'Stop'
$script:work = Join-Path (Join-Path $top '.coddoc-tmp') 'to-html'
try {
  New-Item -ItemType Directory -Force -Path $script:work | Out-Null
  $ignore = Join-Path $top '.coddoc-tmp\.gitignore'
  if (-not (Test-Path -LiteralPath $ignore)) { Set-Content -LiteralPath $ignore -Value '*' -Encoding Ascii }
} catch {
  Fail 'no-write' "не могу писать в $($script:work)"
}

$mode = 'blank'
$script:root = ''
$open = ''
$script:list = @()

if ($inputs.Count -eq 1 -and (Test-Path -LiteralPath $inputs[0] -PathType Container)) {
  $mode = 'dir'
  $script:root = $inputs[0]
  Add-Files $script:root '' -1
} elseif ($inputs.Count -eq 1) {
  $mode = 'file'
  $script:root = Split-Path -Parent $inputs[0]
  $open = Split-Path -Leaf $inputs[0]
  Add-Files $script:root '' 2
  if ($script:list.Count -gt $MaxFiles) {
    $mode = 'links'
    $script:list = @($open)
    $frontier = @($open)
    foreach ($step in 1, 2) {
      $next = @()
      foreach ($f in $frontier) {
        if ((Get-Kind $f) -ne 'text') { continue }
        foreach ($l in @(Get-Links $f)) { if ($script:list -cnotcontains $l -and $next -cnotcontains $l) { $next += $l } }
      }
      $script:list += $next
      $frontier = $next
    }
  }
} elseif ($inputs.Count -gt 1) {
  $mode = 'list'
  $dirs = @($inputs | ForEach-Object { if (Test-Path -LiteralPath $_ -PathType Container) { $_ } else { Split-Path -Parent $_ } })
  $c = $dirs[0]
  foreach ($d in $dirs) {
    while (-not ($d + '\').ToLower().StartsWith(($c.TrimEnd('\') + '\').ToLower())) {
      $up = Split-Path -Parent $c
      if (-not $up) { break }
      $c = $up
    }
  }
  $script:root = $c.TrimEnd('\')
  foreach ($a in $inputs) {
    $rel = $a.Substring($script:root.Length).TrimStart('\') -replace '\\', '/'
    if (Test-Path -LiteralPath $a -PathType Container) { Add-Files $a $rel -1 }
    else { $script:list += $rel; if (-not $open) { $open = $rel } }
  }
}

$script:list = @($script:list | Select-Object -Unique)
$total = $script:list.Count
if ($total -gt $MaxFiles) { Fail 'too-many' "в $($script:root) больше $MaxFiles файлов — назови папку поуже" }

$nText = 0; $nImg = 0; $nOther = 0
foreach ($f in $script:list) {
  switch (Get-Kind $f) { 'text' { $nText++ } 'img' { $nImg++ } default { $nOther++ } }
}
if (($mode -eq 'dir' -or $mode -eq 'list') -and $nText -eq 0) {
  Fail 'no-text' "в $($script:root) нет ни одного текстового файла (.md, .txt, .puml …)"
}
if ($mode -eq 'dir' -and -not $open) {
  foreach ($c in 'README.md', 'index.md') {
    $hit = @($script:list | Where-Object { $_ -eq $c })
    if ($hit.Count) { $open = $hit[0]; break }
  }
  if (-not $open) {
    $best = -1
    foreach ($f in $script:list) {
      if ($f.Contains('/') -or $f -notmatch '\.(md|markdown)$') { continue }
      $s = (Get-Item -LiteralPath (Get-Full $f)).Length
      if ($s -gt $best) { $best = $s; $open = $f }
    }
  }
}

# ---------------------------------------------------------------- куда писать
if ($mode -eq 'blank') {
  $slug = '_blank'; $label = ''; $base = ''
} elseif ($script:root -eq $top) {
  $slug = Split-Path -Leaf $top; $label = '.'; $base = '../../../'
} elseif ($script:root.ToLower().StartsWith(($top.TrimEnd('\') + '\').ToLower())) {
  $label = $script:root.Substring($top.TrimEnd('\').Length + 1) -replace '\\', '/'
  $slug = $label -replace '/', '--'
  $base = "../../../$label/"
} else {
  $label = $script:root -replace '\\', '/'
  $slug = (Split-Path -Leaf $script:root) + '-' + ('{0:x8}' -f $script:root.ToLower().GetHashCode())
  $base = "file:///$label/"
}
$slug = $slug -replace '[:*?"<>|\\]', '_'
$out = Join-Path $script:work $slug
try {
  New-Item -ItemType Directory -Force -Path $out | Out-Null
} catch {
  Fail 'no-write' "не могу писать в $($script:work)"
}

# Каждый набор — копия страницы (~3 МБ) и тексты с картинками в base64: держим $MaxSets последних,
# текущий — самый свежий. Не удалилось (файл занят) — не беда, сборка идёт дальше.
try {
  Set-ItemProperty -LiteralPath $out -Name LastWriteTime -Value (Get-Date)
  Get-ChildItem -LiteralPath $script:work -Directory | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $MaxSets | Remove-Item -Recurse -Force
} catch { }

$made = Get-Date -Format 'yyyy-MM-dd HH:mm'
$stamp = Get-Date -Format 'yyyyMMddHHmmss'

# ---------------------------------------------------------------- data.js
$sizes = @{}
foreach ($f in $script:list) { $sizes[$f] = (Get-Item -LiteralPath (Get-Full $f)).Length }
$textRel = @($script:list | Where-Object { (Get-Kind $_) -eq 'text' -and $sizes[$_] -le $MaxText })
$b64 = Get-Base64 @($textRel | ForEach-Object { Get-Full $_ })
$content = @{}
for ($i = 0; $i -lt $textRel.Count; $i++) { $content[$textRel[$i]] = $b64[$i] }

$rows = @()
foreach ($f in $script:list) {
  $c = if ($content.ContainsKey($f)) { '"' + $content[$f] + '"' } else { 'null' }
  $rows += '[' + (J $f) + ',' + $sizes[$f] + ',' + $c + ']'
}
$data = "// создано pack.ps1 $made — не править руками`n" +
  'window.MDV_DATA = {"v":1,"made":' + (J $made) + ',"root":' + (J $label) + ',"base":' + (J $base) +
  ',"open":' + (J $open) + ',"files":[' + "`n" + ($rows -join ",`n") + "`n]};`n"
Write-Utf8 (Join-Path $out 'data.js') $data

# ---------------------------------------------------------------- assets.js (только если картинки поменялись)
$imgRel = @($script:list | Where-Object { (Get-Kind $_) -eq 'img' -and $sizes[$_] -le $MaxImg })
$imgList = (@($imgRel | ForEach-Object { "$_`t$($sizes[$_])" }) -join "`n")
$assets = Join-Path $out 'assets.js'
$assetsList = Join-Path $out 'assets.list'
$rebuild = -not (Test-Path -LiteralPath $assets) -or -not (Test-Path -LiteralPath $assetsList)
if (-not $rebuild) { $rebuild = ((Get-Content -LiteralPath $assetsList -Raw -Encoding UTF8) -ne $imgList) }
if (-not $rebuild) {
  $assetsTime = (Get-Item -LiteralPath $assets).LastWriteTime
  foreach ($f in $imgRel) { if ((Get-Item -LiteralPath (Get-Full $f)).LastWriteTime -gt $assetsTime) { $rebuild = $true; break } }
}
if ($rebuild) {
  $ib64 = Get-Base64 @($imgRel | ForEach-Object { Get-Full $_ })
  $arows = @()
  for ($i = 0; $i -lt $imgRel.Count; $i++) {
    $e = ([regex]::Match($imgRel[$i], '\.([^./]+)$')).Groups[1].Value.ToLower()
    $arows += '[' + (J $imgRel[$i]) + ',"' + $Mime[$e] + '","' + $ib64[$i] + '"]'
  }
  Write-Utf8 $assets ("window.MDV_ASSETS = [`n" + ($arows -join ",`n") + "`n];`n")
  Write-Utf8 $assetsList $imgList
}

# ---------------------------------------------------------------- страница
# Поверх на месте: robocopy /E дописывает и перезаписывает файлы viewer/, не трогая data.js и assets.js.
$rc = & robocopy $viewer $out /E /R:3 /W:1 /NJH /NJS /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { $rc; Fail 'no-write' "не могу скопировать страницу в $out" }
$page = Join-Path $out 'index.html'
$html = (Get-Content -LiteralPath (Join-Path $viewer 'index.html') -Raw -Encoding UTF8) -replace '__MADE__', $stamp
Write-Utf8 $page $html
$url = ([uri]$page).AbsoluteUri

$shown = if ($label) { $label } else { '.' }
switch ($mode) {
  'blank' { Write-Output 'пустая страница — перетащи в неё папку или файлы' }
  'links' { Write-Output "папка $($script:root) больше $MaxFiles файлов — взял $open и то, на что он ссылается" }
  default { Write-Output "собрано: $shown — файлов $total (текстовых $nText, картинок $nImg, прочих $nOther)" }
}

$status = 'ok'
if ($NoOpen) {
  $status = 'updated'
  Write-Output 'обновлено — нажми F5 во вкладке'
} elseif (-not $env:TO_HTML_NO_OPEN) {
  Invoke-Item -LiteralPath $page
}
Write-Output "to-html: $status files=$total text=$nText img=$nImg other=$nOther page=$url"
# Явно: иначе код выхода у вызывающего — от последней внешней команды (robocopy отвечает 1 на «скопировал»).
exit 0
