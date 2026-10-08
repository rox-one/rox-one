# База Product Learning

Пользовательский checkout `/workspace/rox-one` чистый. Работа ведётся в отдельном worktree `/workspace/rox-product-learning`, ветка `codex/product-learning-20261003`.

Фактический main после fetch: `c9b7330357fb55a5e88a223783029d2768849828`. Аудит входного пакета: `192558583b3f7acc84e0636a4e5fc7ba8d9a7435`. В renderer/shared/defaults с тех пор изменено 897 файлов. Импорты новых компонентов используют `@rox/*`; транспорт OMP и native recovery не меняются. Sharing host находится внутри NavigationProvider и участвует в существующем modal registry. Поля complete и default allow-all/cycle сохранены.

Первый `bun run typecheck:electron`: exit 127, `tsc: command not found` в новом worktree без node_modules. Это ограничение первоначальной среды; повтор после установки фиксируется в отчёте проверок. Зависимости устанавливаются по существующему frozen lockfile.

Контракт DOM registration не содержит runToken. Runtime hooks захватывают binding при начале операции; completion получает ранее захваченный observation. Чистый engine не получает mutation API. Feature flag default off.
