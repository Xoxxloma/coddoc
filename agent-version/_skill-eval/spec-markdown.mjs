// Оформление заголовка не меняет его номер, текст, уровень или положение.
// Нормализация сохраняет строки и содержимое, включая открытые вопросы.
export function normalizeSpecHeadings (text) {
  let fence = null
  return text.split(/\r?\n/).map((line) => {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (mark) {
      if (!fence) fence = mark[1]
      else if (mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null
      return line
    }
    if (fence) return line
    return line.replace(/^(#{1,6}[ \t]+)~~(.+?)~~[ \t]*$/, '$1$2')
  }).join('\n')
}
