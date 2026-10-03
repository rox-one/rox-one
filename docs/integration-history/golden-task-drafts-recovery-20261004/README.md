# Golden Tasks: черновики текущей формы

Source `5def9ffd36dc160fdc7c908784e0ef97ba6a732e` сохранял незавершённые поля по task ID. Текущий keyed `TaskDetail` терял введённую ссылку при выборе другой задачи; actual two-task negative показал0/1. Теперь современная форма сохраняет только незавершённые tag/link поля и выбранный тип ссылки. Данные задач/notes остаются в текущем canonical store с native ownership, CAS/ACK/readback и Product Learning observations.

Captured actor generation, workspace и lifetime панели определяют владельца черновика. Смена пользователя/workspace, ABA и unmount очищают ввод. Уже отрисованная кнопка не может отправить старый черновик до React rerender. Submit очищает только всё ещё совпадающее отправленное поле; другие поля и черновики задач остаются. CSV tags уже поддерживались современным consumer; legacy notes map не возвращён поверх per-edit canonical staging.

После отрицательного0/1 проходят весь actual Tasks DOM20/0, затем rebuilt combined22/0 со strict date1470, native import10/0/34 и adjacent native/Product23/0/80. Full Electron types0 использует точные текущие workspace UI/session-tools-core source вместо устаревших ссылок shared dependencies; include/exclude/strict flags сохранены. [Exact receipt](verification.json) содержит source fingerprints, конфигурацию и все ошибки/журналы. [Portable equivalent configuration](typecheck-config.json) воспроизводит только исправление workspace resolution. Default4 stale-link diagnostics,19/1 fixture tab assumption и20-body teardown failure сохранены; последний полный22-case gate прошёл с cleanup.

Reconciliation preserves every current main doc section; spec/plan each append5/delete0. Это принятие указанного поведения формы, а не всего Golden/native/OS релиза. Исходные ветки сохранены.
