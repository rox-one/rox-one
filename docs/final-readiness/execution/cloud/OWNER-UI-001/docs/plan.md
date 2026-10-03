# UI-001: план интеграции и доставки

Владелец всех шагов: OWNER-UI-001. Делегирование не выполняется; исходная конкретная граница одного писателя сохраняется.

1. Проверить исходный SHA, инструкции, literal acceptance и живой origin/main; сохранить оба конфликтующих варианта и все отрицательные результаты.
2. Объединить новый main с ремонтом без потери возможностей; устранить проблемы в общем парсере, реальном NavigationProvider и редакторе навыка.
3. Закрыть P1 global-selection/AppShell-loader bypass с отрицательными контролями и проверкой metadata recovery. Выполнить исходную app-shell регрессию, parser/layout проверки, реальные callbacks и mounted NavigationProvider/Chromium с reload/history/race/failure/field-draft сценариями; проверить типы и сборку.
4. Создать PR в rox-one/rox-one, прикрепить к чату, наблюдать проверки exact HEAD и исправить причины ошибок. Дополнительный UI-001 Recovery workflow удерживает поведенческие проверки на CI; проверки Windows/macOS native/hosted не подменяются.
5. Слить проверенный HEAD в main по явной авторизации; прочитать GitHub PR/main повторно, сверить исходники/parentage и сформировать новый outputs delivery с SHA, результатами и внешними prerequisites.

Зависимости исходного acceptance: SVC-003 transport/backend receipts, WIN-002/MAC-002 реальные target artifacts, WEB-001/WEB-003 actual hosted target, INT-016 immutable release replay. Независимый ремонт и GitHub delivery выполняются сейчас; fullDoD остаётся открытым.
