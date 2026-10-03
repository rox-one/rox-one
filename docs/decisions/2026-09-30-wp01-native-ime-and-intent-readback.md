# WP-01: нативный IME и строгий readback encrypted intent

Выбрано автономно, 2026-09-30. Требования пакета, все пользовательские сценарии и полный DoD сохраняются. Изменены только ошибочные условия новых native acceptance helpers; production не изменён этим решением.

## Сохранённые отказы

1. Primary actual Electron: `~/Pictures/Shots/Agents/rox-wp01-electron-1790777966380/result.json`, SHA256 `03a373d621fbb6f319f74c6822403da19d045b68c3d18ad630155ad657fe3a70`. 0 pass / 1 fail / 74 assertions. Trusted start и composing Enter прошли, ни CREATE frame, ни SQL receipt не появились; условие `compositionend.isTrusted === true` не выполнилось.
2. Самостоятельный HTML input без ROX/React/preload/credentials/network воспроизвёл тот же false-флаг в Electron 39.2.7 / Chrome 142.0.7444.235. Две реальные последовательности: `Input.insertText` и Tab; обе сохранили точный candidate, genuine trusted start/update/input/Enter, end с точными data/value и следующий trusted ArrowRight с `isComposing: false`. Это engine mechanism control, не product acceptance. [Полный receipt](../../plans/compound-implementation/evidence/wp01/ime-engine-control-current.json), SHA256 `b5be280afe0d9c2ba350d17e31ee92d557d053282fb8abc447e73448c54ab705`. Предыдущий контроль с одним focusable input также сохранён с его собственным отказом.
3. Offline actual Electron: `~/Pictures/Shots/Agents/rox-wp01-offline-electron-1790780033596/result.json`, SHA256 `5290aa8d0eecf019fd3a77e26880242d39f7a7539b86b515f2c882d03e6318bb`. 0 pass / 1 fail / 67 assertions. Оба настоящих профиля сохранили queued intents, production читал их, а readback helper ошибочно применял public token reader к JSON credential value и получал отсутствие. Read-only disk diagnostic подтвердил существующий encrypted slot и unchanged credential/config hashes; UI и source не менялись. Первый отказ fixture lifetime 1800, превышавшего действующий maximum 900, тоже сохранён отдельно.

## Почему заменено условие IME

[Пинованный Chromium 142 source, InputMethodController::DispatchCompositionEndEvent](https://chromium.googlesource.com/chromium/src/+/refs/tags/142.0.7444.235/third_party/blink/renderer/core/editing/ime/input_method_controller.cc) создаёт CompositionEvent и отправляет его через scoped queue. SHA256 исходника `73e5fb8189df0db88136369baa8f03955831c1bf50e5a256efeebed39318d843`, строки 392–406. Само false-значение доказано двумя независимыми actual engine controls, а не выведено из названия метода. WP-01 требует настоящий IME, точный текст и отсутствие случайной команды во время composition; browser implementation flag не является продуктовым требованием.

Новый oracle требует в fresh trace именно этого input упорядоченную последовательность: trusted start → trusted update с exact candidate → trusted composing input с exact value → trusted composing Enter → end с exact data/value → trusted post-end ArrowRight с `isComposing: false`. Дополнительно SQL Project/receipt/project.created counts равны нулю ПОСЛЕ commit candidate, CREATE frames отсутствуют, durable intent до и после полностью равен, форма видна, имя точное. Существующие privacy/restart/revoke/keyboard/theme/200-percent/narrow/receipt assertions остаются. Fake DOM events, подмена isTrusted, отключение теста и synthetic store запрещены.

## Почему заменён intent reader

`createAuthorityJournalPorts` — действующий production strict read port: SecureStorageBackend instanceof, repairState == ok и strict stored-credential decoder. Structured intent и binding читаются через этот порт. Bearer token читается через существующий CredentialManager public reader. Все assertions о present/tokenType/command/immutable key/actor/session/workspace, ciphertext/config confidentiality и owner mode 0600 сохраняются. Helper не пишет и не меняет очередь.

## Приёмка

Эти исправления тестовых предпосылок не закрывают WP-01. Нужны свежие actual primary/offline consumers на новых helper hashes, просмотр PNG и сопоставление DOM/pixels, затем exact Git delivery. Каждый новый отказ возвращается в работу.

## Отдельный бюджет подготовки runtime

Последующий fresh run прекратился до Electron и до первого runtime aggregate: 0 pass / 1 fail / 2 assertions, 91.19 s. Receipt `~/Pictures/Shots/Agents/rox-wp01-offline-electron-1790780473769/result.json`, SHA256 `1e3cd0d4922d25dcb4da36b8b7e4c2105f2af0940c093ae31f57f2b4d4cd9689`. Первоначальный helper не сохранял exitCode/timedOut; watchdog 90 s и partial clone свидетельствуют о подготовительном deadline, но это обозначено как вывод, а не наблюдённый signal.

Для одной только `--verify-runtime-clone` введён отдельный bounded filesystem budget 240 s: проверка всех 31 824 файлов, 1.7 GB, modes, links, completion markers и genuine ensureAll сохраняется. Общий budget — два runtime preparation budgets плюс прежние 420 s native scenario. Обычные helpers сохраняют 90 s, UI polling 30 s, service/transport deadlines не изменены. Новый отказ helper содержит конкретные exitCode/timedOut/helper label/budget без env, raw argv и секретов. Результат подготовки не подменяется готовым marker или предыдущим снимком. Это исправление границы fixture preparation, не разрешение медленного продуктового ответа.
