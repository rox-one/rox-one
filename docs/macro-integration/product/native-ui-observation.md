# Наблюдение установленного ROX — ограниченный UI audit

Дата: 2026-09-30, Europe/Moscow. Приложение: `/Applications/Rox.app`. Метод: native CUA accessibility tree + screenshot; навигация без создания/редактирования сущностей, отправки сообщений, записи медиа или изменения настроек.

## Что фактически наблюдалось

| Экран | Наблюдение | Значение для спецификации |
|---|---|---|
| Shell | Русская навигация, rail, tabs, текущая тёмная тема и фиолетовый акцент | Наследовать выбранную тему/акцент; light fixture default не заменяет пользовательские настройки |
| Задачи | Три колонки: списки, задачи, detail/help. Inbox/Сегодня/Планы/В любое время/Когда-нибудь/Журнал/Корзина; поиск, новая задача, проект/область, подсказки клавиш | Расширять существующие списки и detail; shared collaboration должна дополнять текущую личную модель |
| Встречи | Все/Сегодня/Предстоящие/Прошедшие/Идёт запись/Ждут действий; поиск, подключение календаря, планирование, импорт аудио, начало записи; empty state | Calendar и Calls встраиваются в эту поверхность; наличие кнопки подключения не доказывает provider sync |
| Досье | Поиск и фильтры Все/Люди/Компании, empty state и добавление | CRM использует существующий entry point и развивается внутри Досье |
| Страницы | Существующий список, создание и элемент стартовой страницы | Document/Artifact representations используют текущую поверхность Pages |
| Входящие | Общая поверхность с фильтрами внимания, Messages/Snoozed/Done | Сохранить смешанную attention/mail модель; read state не является разрешением agent action |

Screenshot shell/Tasks визуально просмотрен в текущей сессии. AX контролы перечисленных экранов прочитаны. Исходный экран сессии восстановлен после навигации. Raw screenshots и AX с частным содержимым не экспортированы в репозиторий.

## Границы доказательства

- Commit provenance установленного бинарника **не установлен**. Это installed-UI observation, не доказательство визуального результата pinned source build.
- Computed font family, hover/focus timing, responsive widths, persistence, provider readback, concurrent/offline behavior **не проверены** этим probe.
- Новые 61 screen contracts и 219 controls — целевой spec; новые продуктовые сценарии **PLANNED_NOT_RUN**.
- Первоначальный screenshot failed image destination при полном диске; следующая AX+screenshot попытка timed out с reset kernel. После восстановления свободного места screenshot и AX navigation успешно выполнены. История неудачных попыток сохранена, окончательное наблюдение их не скрывает.
- Native lane cloud packets требует отдельного source-pinned build, controlled test workspace, actual font/IPC/device checks и доказательств по completion contract.
