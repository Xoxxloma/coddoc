# skills.ps1 — то же, что skills.sh, для Windows: установить или обновить скиллы в репозитории со спеками.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .gigacode/skills/analyst-skills-update/reference/skills.ps1                 # → .\.gigacode\skills
#   powershell -NoProfile -ExecutionPolicy Bypass -File .gigacode/skills/analyst-skills-update/reference/skills.ps1 .claude/skills  # → другая папка
#
# Слэши прямые: если агент выполняет команды через bash, обратные он съест.
#
# Если запуск .ps1 запрещён групповой политикой, тот же скрипт читается как текст (другая папка — в SDD_SKILLS_DEST).
# Запускает сам пользователь в терминале: агенту GigaCode `powershell -Command` закрыт корпоративным режимом.
# Обёртка `powershell -Command` нужна: `exit` при ошибке закрыл бы окно пользователя вместе с текстом ошибки.
#
#   powershell -NoProfile -Command "Invoke-Expression (Get-Content -Raw -Encoding UTF8 .gigacode/skills/analyst-skills-update/reference/skills.ps1)"
#
# Что копируется и что печатается, список .analyst-skills и установка скриптом из клона — как в skills.sh;
# правятся оба файла вместе. Нужен только git.
# Пишется под Windows PowerShell 5.1 и ограниченный режим языка: только командлеты, без вызовов .NET.
# Файл хранится в UTF-8 с BOM — без него 5.1 читает русские строки как cp1251.
# Временная копия себя, как в skills.sh, не нужна: PowerShell читает скрипт целиком до запуска.
param([string]$Dest = $env:SDD_SKILLS_DEST)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Сначала https, при отказе — ssh; SDD_SKILLS_REPO заменяет оба — как в skills.sh.
$repos = if ($env:SDD_SKILLS_REPO) { @($env:SDD_SKILLS_REPO -split '\s+' | Where-Object { $_ }) } else {
  @('https://api.sc-ci.sber.ru/ai-security-deparment/AI-SDD-SKILLS.git',
    'ssh://sc@api.sc-ci.sber.ru:7998/ai-security-deparment/AI-SDD-SKILLS.git')
}
$ref = $env:SDD_SKILLS_REF            # ветка или тег; пусто — ветка по умолчанию
if (-not $Dest) { $Dest = '.gigacode\skills' }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Output 'нужен git'; exit 1 }

# Запросы пароля и «yes/no» про новый хост выключены, своя настройка ssh не трогается — как в skills.sh.
# Окно входа Git Credential Manager остаётся: его закроют — скрипт перейдёт к ssh.
$env:GIT_TERMINAL_PROMPT = '0'
if (-not $env:GIT_SSH_COMMAND -and -not $env:GIT_SSH) {
  & git config --get core.sshCommand | Out-Null
  if ($LASTEXITCODE -ne 0) { $env:GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10' }
}

# Папка клона, если нас запустила установленная версия (см. ниже). Клон убирает она.
$from = $env:SDD_SKILLS_FROM
$src = if ($from) { $from } else { Join-Path $env:TEMP ('sdd-skills.' + (Get-Random)) }
try {
  if (-not $from) {
    $cloneArgs = @('clone', '-q', '--depth', '1')
    if ($ref) { $cloneArgs += @('--branch', $ref) }
    $cloned = $false
    foreach ($repo in $repos) {
      if ($ref) { Write-Output "скиллы: $repo #$ref" } else { Write-Output "скиллы: $repo" }
      # Предупреждения git в stderr не должны обрывать скрипт: решает только код возврата.
      $ErrorActionPreference = 'Continue'
      & git @cloneArgs $repo $src
      $ErrorActionPreference = 'Stop'
      if ($LASTEXITCODE -eq 0) { $cloned = $true; break }
    }
    if (-not $cloned) { Write-Output 'не удалось получить скиллы ни по одному адресу'; exit 1 }
  }

  $skills = Join-Path $src 'skills'
  if (-not (Test-Path -LiteralPath $skills -PathType Container)) { $skills = Join-Path $src '.gigacode' }
  if (-not (Test-Path -LiteralPath $skills -PathType Container)) { Write-Output 'в репозитории со скиллами нет папки skills/'; exit 1 }

  # Ставит skills.ps1 из клона, а не этот — как в skills.sh. Текстом, а не `& $next`: запуск .ps1 бывает запрещён
  # политикой, и тогда этот скрипт тоже читали как текст. В `& { }` — чтобы его переменные не затёрли наши.
  $next = Join-Path $skills 'analyst-skills-update\reference\skills.ps1'
  if (-not $from -and (Test-Path -LiteralPath $next -PathType Leaf)) {
    $env:SDD_SKILLS_FROM = $src
    Invoke-Expression ("& {`n" + (Get-Content -Raw -Encoding UTF8 -LiteralPath $next) + "`n} '" + ($Dest -replace "'", "''") + "'")
    return
  }

  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  $list = Join-Path $Dest '.analyst-skills'
  $installed = @()
  $count = 0
  foreach ($dir in Get-ChildItem -LiteralPath $skills -Directory | Sort-Object Name) {
    $name = $dir.Name
    if ($name -like '_*') { continue }
    $skillMd = Join-Path $dir.FullName 'SKILL.md'
    if (-not (Test-Path -LiteralPath $skillMd -PathType Leaf)) { continue }
    $target = Join-Path $Dest $name
    # Поверх на месте, а не «удалить и скопировать»: Remove-Item в 5.1 падает на папке, которую кто-то
    # держит открытой, и скилл остаётся пустым. robocopy /MIR перезаписывает файлы и убирает лишние.
    $out = & robocopy $dir.FullName $target /MIR /R:3 /W:1 /NJH /NJS /NFL /NDL /NP
    if ($LASTEXITCODE -ge 8) { $out; Write-Output "не удалось обновить $name"; exit 1 }
    $version = '—'
    $found = Select-String -LiteralPath $skillMd -Pattern '^version:\s*(.*)$' -CaseSensitive | Select-Object -First 1
    if ($found -and $found.Matches[0].Groups[1].Value.Trim()) { $version = $found.Matches[0].Groups[1].Value.Trim() }
    Write-Output ('  {0,-28} {1}' -f $name, $version)
    $installed += $name
    $count++
  }
  if ($count -eq 0) { Write-Output "в $(Split-Path -Leaf $skills)/ не нашлось ни одной папки со SKILL.md"; exit 1 }
  # Скилл из прошлого списка, которого в наборе больше нет, снят — как в skills.sh.
  if (Test-Path -LiteralPath $list -PathType Leaf) {
    foreach ($line in @(Get-Content -LiteralPath $list)) {
      $name = $line.Trim()
      if (-not $name -or $name -like '.*' -or $name -like '_*' -or $name.Contains('/') -or $name.Contains('\')) { continue }
      if ($installed -contains $name) { continue }
      $target = Join-Path $Dest $name
      if (-not (Test-Path -LiteralPath $target -PathType Container)) { continue }
      try { Remove-Item -LiteralPath $target -Recurse -Force; Write-Output ('  {0,-28} {1}' -f $name, 'снят из набора, удалён') }
      catch {
        Write-Output ('  {0,-28} {1}' -f $name, "снят из набора, удалить не вышло — удалите папку $target")
        $installed += $name
      }
    }
  }
  Set-Content -LiteralPath $list -Value $installed -Encoding ASCII
  Write-Output "установлено в ${Dest}: $count скиллов; точка входа — analyst-workspace"
} finally {
  Remove-Item -LiteralPath Env:SDD_SKILLS_FROM -ErrorAction SilentlyContinue
  if (-not $from) { Remove-Item -LiteralPath $src -Recurse -Force -ErrorAction SilentlyContinue }
}
