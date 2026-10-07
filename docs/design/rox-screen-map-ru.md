# Карта экранов Rox (2026-10-07)

Для комментариев по UI. Слева → центр → справа.

## Оболочка

| Зона | Содержимое |
|------|------------|
| Левый mode-rail | Главная, Сессии, Задачи, Встречи, Заметки, Входящие, Лента, … + ⚙ + collapse |
| Центр | Панели (`panel-stack`), вкладки surface при unified shell |
| Правый rail | Action: +сессия, задача, событие, заметка, браузер; pin, терминал, скрыть |
| Inspector | Сессия: files/git/context; глобально: browser pane |
| Низ | Bottom terminal dock, git/status при включении |

## Режимы (navigator)

- **home** — хаб / empty project
- **allSessions** — чат и workbench
- **tasks** — Things-style задачи
- **meetings** — локальные встречи + запись
- **notes** — markdown vault
- **inbox / feed** — mode screens
- **settings** — подстраницы (Runtime, Cloud runs, Appearance, Zen…)
- **sources / skills / automations / projects** — каталоги

## Настройки (ключевые)

- **Runtime** — toolchain install (не «запрещено», а «не скачано»)
- **Облачные запуски** — Daytona, `~/rox/cloud-runs.env`
- **Внешний вид** — kanban status, tool-icons `~/rox/tool-icons/`, workspace rail off по умолчанию

Комментируй: экран → что убрать/добавить/переименовать.
