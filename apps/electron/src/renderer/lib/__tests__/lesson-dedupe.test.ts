import { describe, expect, it } from 'bun:test'
import { dedupeSimilarLessons, lessonSimilarity } from '../lesson-dedupe'

const lessons = [
  { rule: 'Результаты параллельных спецификаций сводить через единый integration gate, устраняя дубли и противоречащие решения до финальной проверки.' },
  { rule: 'Раскрытые ранее credentials НЕ использовать повторно; для проверки создавать временные scoped-ключи.' },
  { rule: 'HTTP 200 и успешный health endpoint НЕ считать достаточным доказательством готовности фонового сервиса; проверять полный путь ingestion → worker → readback.' },
  { rule: 'Готовность сервисов Render подтверждать сквозным сценарием ingestion → worker → readback; одного HTTP 200 на health endpoint недостаточно.' },
  { rule: 'Никогда не использовать ранее раскрытые credentials; для проверок создавать временные scoped-ключи.' },
  { rule: 'Результаты параллельных спецификаций сводить через единый integration gate, чтобы исключить дублирование и противоречащие решения.' },
]

describe('memory lesson dedupe', () => {
  it('collapses the same rule written twice', () => {
    const { unique, similar } = dedupeSimilarLessons(lessons)
    expect(unique.map((l) => l.rule)).toEqual([lessons[0]!.rule, lessons[1]!.rule, lessons[2]!.rule, lessons[3]!.rule])
    expect(similar.map((l) => l.rule)).toEqual([lessons[4]!.rule, lessons[5]!.rule])
  })

  it('keeps related but distinct rules apart', () => {
    expect(lessonSimilarity(lessons[2]!.rule, lessons[3]!.rule)).toBeLessThan(0.5)
  })

  it('treats exact duplicates as similar', () => {
    expect(lessonSimilarity('Use bun', 'use bun ')).toBe(1)
  })
})
