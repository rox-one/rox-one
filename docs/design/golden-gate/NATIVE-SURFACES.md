# GG-004: native surfaces — фактический контракт и приёмка

Дата: 2026-09-14. Поверхности: браузер, SiYuan, UI расширений и браузер инспектора.

## Исправленные регрессии

`PanelSlot` сохраняет скрытые панели в DOM. В режиме focus они получают `visibility: hidden`, `aria-hidden` и `inert`; в compact режиме весь workspace может быть inert при сохранённом focused id. `RetainedSurface` сохраняет вспомогательные поверхности через `display: none`, `aria-hidden` и `inert`. Старые native hosts проверяли только focus и прямоугольник, поэтому WebContentsView мог оставаться поверх навигатора или другой панели. ResizeObserver также не замечал перемещение панели при прокрутке grid.

Общий `useNativeSurfaceBounds` теперь применяет одинаковый контракт к BrowserPanelPage, KnowledgeSurfacePage и ExtensionSurfacePage:

- наследует фактический focus от `AppShellContext`, включая SiYuan внутри вкладки чата;
- учитывает hidden/inert/aria-hidden и CSS visibility/display всей цепочки предков, видимость документа и отсоединение DOM-узла;
- проверяет viewport и независимое clipping по X/Y у overflow-предков;
- обновляет геометрию при scroll, resize, изменении предков и завершении transition;
- скрывает native view на время renderer overlay и изменения размеров панелей;
- сохраняет instance при временном скрытии: отправляет `rect: null`, не навигирует и не уничтожает WebContentsView;
- восстанавливает текущие bounds после возвращения панели в видимую область.

`InspectorHost` больше не перечисляет и не скрывает все embedded instances при закрытии инспектора. Уборка относится только к instance его браузера. Позднее завершение async create после закрытия не присваивает instance размонтированному компоненту.

Renderer ownership coordinator защищает общий durable instance: `null` или release скрытого владельца не перетирает bounds другого видимого владельца. Один WebContentsView остаётся одним представлением; при нескольких видимых владельцах он закрепляется за последним открытым владельцем. Coordinator не клонирует вкладки и не меняет backend API.

Bounds отправляются последовательной очередью на instance. Пока предыдущий Promise не завершён, промежуточная геометрия заменяется последним требуемым значением; финальный `null` не может быть обогнан старым update. Запись владельцев живёт до завершения очереди, включая закрытие и повторное открытие. Signature считается подтверждённой только после успешного sync; rejected update разрешает повтор при следующем invalidation без polling или автоматического цикла retries.

## Ограничения текущего native режима

DOM-панели остаются одновременно видимыми в 2×2 / 3×2. Для native WebContentsView сохранено прежнее ограничение: поверхность панели отображается при её focus. Соседняя native панель показывает локализованное предложение выбрать её. Инспектор может показывать собственную поверхность параллельно, если её instance не совпадает с instance другой видимой поверхности.

Частичное clipping native view внутри renderer scroll-контейнера в текущем backend не представлено. Поэтому частично обрезанная native поверхность временно скрывается целиком. Вместо неё показано объяснение и действие «Показать панель», которое прокручивает панель в область просмотра и фокусирует её. Если panel/viewport слишком малы, пользователю нужно увеличить доступную область. Instance, история и состояние страницы сохраняются. Полностью одновременный интерактивный native grid не заявляется готовым.

Для снятия этого ограничения нужен отдельный native gate: согласовать представление нескольких WebContentsViews, clipping в main process относительно renderer viewport, порядок слоёв/оверлеев и владение общим durable instance. Затем выполнить проверку на Electron/macOS. Это не входит в текущий renderer-only fix.

## Производительность

Geometry invalidations объединяются максимум в одно чтение за animation frame. Постоянного rAF-цикла нет. Отменённый callback защищён generation/alive guard и не может вернуть старые bounds после скрытия или unmount. Для unfocused, removed, document-hidden и явно hidden/inert hosts не выполняются getComputedStyle/getBoundingClientRect.

Наблюдение class/style ограничено цепочкой предков. Наблюдение overlay subtree подключается только для видимого focused host; скрытые retained hosts сохраняют только события, нужные для восстановления. Повторная одинаковая геометрия не вызывает IPC.

## Проверено и остаётся проверить

Поведенческие Bun-тесты проверяют hidden/inert/CSS-предков, document suspension, clipping по обеим осям, восстановление после scroll, подписки/отписки, once-per-frame invalidation, отменённые callbacks, owner-only cleanup, передачу общего instance и async attachment после закрытия. Deferred-promise сценарии проверяют update A → update B → release, повтор rejected A и новое владение до завершения старого запроса. Существующие проверки native visibility leases, inspector lifecycle и локализации также проходят: всего 31 тест, 207 assertions.

На реальном Electron/macOS остаются обязательными:

1. Открыть Browser/SiYuan/extension, переключить grid → focus → grid и убедиться, что история/редактор не сброшены.
2. Скрыть compact workspace и retained inspector: native view не закрывает навигатор и соседние панели.
3. Прокрутить обе оси grid: нет native view по старым координатам; частично скрытая панель показывает recovery, полностью видимая восстанавливает view.
4. Закрыть инспектор при открытой отдельной browser/SiYuan/extension панели: соседние поверхности остаются видимыми.
5. Проверить общий durable instance, быстрый focus transfer, закрытие во время create, overlay и resize одновременно.
6. Проверить CPU/IPC во время typing/streaming при нескольких скрытых native панелях и после скрытия окна.

Эти native сценарии не запускались в текущей среде; тесты модели и TypeScript не заменяют проверку compositor на macOS.
