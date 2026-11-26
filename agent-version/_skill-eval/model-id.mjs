// model-id.mjs — модель прогона только полным именем; пара к `model-id.sh` (почему — там).
const ALIASES = new Set(['', 'default', 'best', 'sonnet', 'haiku', 'opus', 'fable', 'opusplan', 'sonnet[1m]', 'opus[1m]']);

export function modelId(m) {
  if (ALIASES.has(String(m ?? ''))) throw new Error(`модель прогона — полным именем, не псевдонимом: '${m}' (модель стенда — claude-sonnet-5)`);
  return m;
}
