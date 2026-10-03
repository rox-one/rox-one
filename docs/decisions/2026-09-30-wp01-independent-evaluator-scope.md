# WP-01: граница независимого negative-control holdout

**Выбрано автономно** 2026-09-30. Авторизованная программа IMPLEMENT_IT_ALL продолжает работу без вопросов пользователю.

## Нормативное требование

В `plans/macro-integration/work-packages.json:962`, `WP-01.verification.negativeControl.holdout`, требуется `independent evaluator injects second failure variant`. SHA256 всей нормативной спецификации: `79988de46e07d3f5cc103d2c4ccf16d1c2a21f858d3b428a5088dcbae081eac0`. Текущая root integration revision: `51f0a0c7253823766a336653837b1c26050aa206`, repository `rox-one/rox-one`.

Это требование выполняется независимым evaluator, который сам выбирает другую ошибку, строит собственный поведенческий oracle, проверяет неизменённый baseline и доказывает конкретное assertion failure при мутации. В тексте нет дополнительного требования root-custodian, скрытой карты непрозрачных кандидатов и reveal после вердикта. Такая отдельная методика может усилить последующую исследовательскую проверку, но не вводится как новый обязательный prereq WP-01.

## Решение

Проверять буквальный independent second-variant gate. Не называть его custodially blinded и не выдавать mutation run за текущую native product приёмку. Матрица `evidence/wp01/normative-matrix-before-offline-queue.json` остаётся неизменённым историческим audit: её расширенное предложение про blinded custodian не меняет исходную спецификацию. Итоговая criterion matrix должна ссылаться на этот scope и фактический независимый receipt.

## Проверяемые условия

1. Worker session/model/packet и source snapshot имеют реальный launch/result provenance.
2. Worker самостоятельно выбрал второй failure variant, отличный от root body-actor negative control.
3. Неизменённый source snapshot проходит тот же oracle на реальных PostgreSQL/HTTP/WS.
4. При exact source mutation fails конкретный privacy/permission/persistence assertion; ошибки окружения не считаются caught mutation.
5. Сохранены исходные failures, source/evidence/test hashes, seed и cleanup; credentials не публикуются.
6. Исторический snapshot не переименовывается в доказательство изменённой root generation. Native interface, durable offline intent и остальные WP-01 gates проверяются отдельно.

Полный WP-01 и все 143 пакета этим решением не закрыты. Заявление PASS возможно только после фактических source-bound proofs и delivery.
