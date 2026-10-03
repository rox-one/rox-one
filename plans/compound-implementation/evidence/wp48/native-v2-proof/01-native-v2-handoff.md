# WP-48 native v2: исправления и передача интегратору

## Запечатанная композиция

- `native-v2/manifest.json`: SHA256 `9be658a3be679eb23158d88cc5007477832c67688453d5ca052ac1636de19531`.
- Это **10 delta-патчей**, а не замена полного native-v1 пакета.
- Сначала применяются **30 product-патчей native-v1**, исключая его устаревший `wp-48-domain.test.ts`. Затем применяются десять v2 delta-патчей. Итог — **32 файла**.
- Восемь баз — запечатанные результаты v1; один файл новый; база domain fixture — текущий root SHA256 `3e3e65c75dffe74af561949ff69281c86b702274e171b2a0156c826d6f779279`. Исправление root для реального разрешения зависимостей сохранено.
- Все source/patch bytes совпадают с frozen review snapshot `f9fe52b70997e6e635be5384764306d672005a1e4e6b7b2476932af31267d8f5`.

## Исправленный механизм

1. Receipt validator вычисляет SHA256 канонического schemaV2 command через WebCrypto и проверяет точный requestHash. Старый receipt никогда не переписывается при изменении текущей политики.
2. Readback сохраняет точные immutable Resource/evidence/revision/watermark/time/digest bindings. Новый policy epoch допускается только монотонно и с согласованным decision manifest; текущий canAudit может измениться при новом epoch. Понижение epoch и подмена immutable данных запрещены.
3. Main требует всю триаду **receipt + точное durable event + текущий GET** и свежую identity перед удалением зашифрованного intent. При отсутствии события intent сохраняется с исходным ключом и неопределённым результатом.
4. Event proof проверяет live actor, command causation/correlation, entity, revision, исходный epoch, время и digests. Событие ищется через реальный cursor; максимум 100 страниц по 25 событий. Отсутствие доказательства, повтор event ID между страницами, цикл cursor и смена scope завершаются отказом.
5. Settings централизованно скрывает список, выбранную Resource, evidence, receipt, history, cursors и intent proof при отказе доступа. Denied connection и blocked auth/scope в refresh применяют эту очистку до сохранения pending view.
6. После storage/authority await проверяется актуальность window/connection generation перед следующим RPC либо возвратом приватного command.
7. Тестовая fixture получила идемпотентный dispose, await listener.close и явный finally в двух использующих её отдельных файлах. Это сохраняет исходные domain assertions и устраняет ошибку владения Bun file-scoped hooks.

## Фактическая проверка

| Проверка | Результат | Доказательство |
|---|---:|---|
| Все четыре тестовых файла без фильтра | 34 pass / 0 fail / 537 assertions | `native-v2-final-lifecycle-tests.log` |
| Строгий тестовый TS graph с настоящими declarations | exit 0 | `native-v2-test-only-lifecycle-final.log` |
| Electron TS во внешней физической копии | 128 baseline / 128 proposed / 0 new | `native-v2-electron-lifecycle-final.log`, `native-baseline-ts2.log` |
| Точное source соответствие для десяти файлов | PASS | `native-v2-final-type-source-proof.json` |
| Новые any / non-null / suppressions / disabled tests | 0 / 0 / 0 / 0 | `native-v2-syntax-proof.json` |
| Пять независимых мутаций source | Все отвергнуты исходными assertions | `native-v2-negative-controls.json` |
| Остаточные PG schemas / приватные каталоги | 0 / 0 | `native-v2-final-cleanup.json` |
| Независимые DTO/page-port проверки | 20 pass / 0 fail / 27 assertions | reviewer log `/tmp/rox-wp48-native-independent-ultra-20260930/v2/execution.log` |

Прогон использовал настоящий PostgreSQL, общую HTTP/WS authority, зашифрованное хранилище credentials/intents, подпроцессы с SIGKILL и перезапуск настоящего service. Проверены сохранение intent при отсутствующем event, единственный receipt/event/effect после восстановления, READ revoke/restore с более новым policy epoch и сохранением оригинального receipt, а также девять исходных WP-01 offline сценариев.

Физическая внешняя копия меняет только адреса импортов на точные существующие exports. Resolver использует Bun.resolveSync для import-only export `@earendil-works/pi-ai/compat`; байты установленного пакета читаются из checkout без записи. Тестовый временный symlink root fixture указывает на принадлежащий worker пустой каталог во внешней копии. Новый SDK, shim либо mock для этой ошибки не создан.

## Сохранённые ошибки и исправление окружения

- Первый final lifecycle прогон: 33/1/534, realpath отсутствующего внешнего dependency ancestor. Следующий: 24/10/238, import-only `pi-ai/compat` не разрешался через прежний require-based adapter. Оба лога сохранены; итоговый 34/0/537 получен только после исправления внешнего resolver.
- Пять source controls ранее включали collector false negative: validator правильно бросил ошибку при policy regression, но collector требовал literal expect line. Исправлен критерий collector — точный failed target, exit 1 и один failure; смысл тестовых assertions сохранён.
- Шесть прошлых policy fixtures были оставлены из-за cached imported Bun hook. Перед удалением каждая привязана к собственной Resource/workspace, приватной registry и точному эффекту policy-test. Удалены только эти шесть доказанно собственных схем и каталогов. Неизвестные схемы не удалялись.
- Предыдущая проверка только `/tmp` не охватывала macOS os.tmpdir. Исторический receipt не исправлялся задним числом; итоговая read-only проверка использует реальный `/private/var/folders/.../T` и PG catalog.

## Оставшиеся gate владельцев

Root применяет точные патчи и повторяет сборки/TS в обычном dependency context; исходный outside Electron baseline не заменяет root gate. Root также владеет фактическим Electron UI прогоном: доступная RU Settings surface, клавиатура/геометрия, две реальные учётные записи, privacy retraction, offline/reload/recovery. Этот worker не запускал UI и не заявляет подтверждённые пиксели.

Legal/release gate остаётся `review_required`, если нет настоящего qualified review или полного accepted attribution для выпуска. Автоматические проверки не создают человеческое одобрение. Будущие WP03 generic grants и WP04 durable DLQ не подменяются параллельным Actor/command/notification контуром либо вымышленной DLQ.

Checkout, Git, UI и root build этим worker не изменялись. Исторические v1/v2/backend receipts и failure controls сохранены.
