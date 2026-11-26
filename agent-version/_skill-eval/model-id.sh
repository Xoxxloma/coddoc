# model-id.sh — модель прогона только полным именем. Подключается раннерами: `. "$HERE/model-id.sh"`.
#
#   SM_MODEL="$(model_id "${SM_MODEL:-}" claude-sonnet-5)" || exit 2
#
# ПСЕВДОНИМ МЕНЯЕТ СМЫСЛ МОЛЧА. `sonnet` / `haiku` указывают на текущее поколение, и в октябре 2026
# v1 и v2 service-map сравнивались на разных моделях под одним `sonnet`. Полное имя пишется в
# `_settings.txt` и сравнимо между раундами. Модель вне Claude (DeepSeek через ANTHROPIC_BASE_URL)
# идёт своим именем — отбиваются только псевдонимы.
model_id() {
  local m="${1:-$2}"
  case "$m" in
    ''|default|best|sonnet|haiku|opus|fable|opusplan|'sonnet[1m]'|'opus[1m]')
      echo "модель прогона — полным именем, не псевдонимом: '$m' (модель стенда — claude-sonnet-5)" >&2
      return 2 ;;
  esac
  printf '%s\n' "$m"
}
