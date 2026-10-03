import type { TourDefinition } from '../contracts'

/** Declarative authoring content; navigation and actions belong to runtime ports. */
const definitions = [
  {
    "id": "OBT-01",
    "slug": "first-result",
    "version": 1,
    "title": "Первый результат",
    "goal": "Получить первый новый ответ на собственный запрос.",
    "why": "Убирает изучение меню перед первой пользой; использует уже существующий welcome.",
    "trigger": "Ручной Start в welcome или центре обучения; компактное приглашение после нового welcome.",
    "requires": [
      "shell.ready",
      "sessions.available"
    ],
    "owner": "A4",
    "evidence": [
      "E01",
      "E02",
      "E03",
      "E07",
      "E08",
      "E20",
      "E27"
    ],
    "priority": "P0",
    "steps": [
      {
        "id": "first.session",
        "version": 1,
        "target": "session.entry",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Начни с этой сессии",
            "body": "Это рабочий разговор с Rox. Используй открытый первый чат; новую сессию можно создать отдельно."
          },
          "en": {
            "title": "Start in this session",
            "body": "This is a working conversation with Rox. Use the first chat already open; you can create another session separately."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "session.ready",
          "evidence": "observed",
          "priorState": "allow-current-state",
          "requireAcknowledgementAfterEvidence": true
        },
        "handoff": false,
        "optional": false,
        "notes": "Если сессии нет, подсветить существующий New session и ждать её создания пользователем. Самому не создавать.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.first-result.first.session.",
        "testId": "T-FIRST-SESSION",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "first.permissions",
        "version": 1,
        "target": "composer.permissions",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь разрешения",
            "body": "Сейчас выбран режим «{{mode}}». Он определяет согласование действий, но не заменяет права доступа к файлам и сервисам."
          },
          "en": {
            "title": "Check permissions",
            "body": "The current mode is “{{mode}}”. It controls approvals; it does not replace file or service access controls."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Показать актуальные подпись и описание из mode.*. Не переключать режим и не требовать Auto/Execute для продолжения.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.first-result.first.permissions.",
        "testId": "T-FIRST-PERMISSIONS",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "first.compose",
        "version": 1,
        "target": "composer.input",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Опиши нужный результат",
            "body": "Напиши, что нужно получить и на каких материалах работать. Можно продолжить уже набранный текст."
          },
          "en": {
            "title": "Describe the result",
            "body": "Say what you need and which materials to use. You can keep the text you have already entered."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "draft.nonempty",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Событие содержит только boolean, не текст. Пример вставляется лишь по явной кнопке и только в пустой черновик.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.first-result.first.compose.",
        "testId": "T-FIRST-COMPOSE",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "first.send",
        "version": 1,
        "target": "composer.send",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Отправь задачу",
            "body": "Кнопка отправит текст выбранной модели. Обработка может расходовать доступный баланс."
          },
          "en": {
            "title": "Send your task",
            "body": "This sends your text to the selected model. Processing may use your available balance."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "user-turn.accepted",
          "evidence": "verified",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Считается после принятия сообщения обычным механизмом, не по pointer click. Тур не вызывает отправку.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.first-result.first.send.",
        "testId": "T-FIRST-SEND",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "first.execution",
        "version": 1,
        "target": "session.execution",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Следи за выполнением",
            "body": "Здесь видны ход работы и действия агента. Во время выполнения здесь же доступна остановка."
          },
          "en": {
            "title": "Follow execution",
            "body": "This area shows progress and agent actions. While the task is running, you can stop it here."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "execution.state-visible",
          "evidence": "observed",
          "priorState": "allow-current-state",
          "requireAcknowledgementAfterEvidence": true
        },
        "handoff": false,
        "optional": false,
        "notes": "Если ответ уже готов, разрешён target с завершённым ходом/логом. Не создавать искусственную длительную задачу и не требовать нажатия Stop.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.first-result.first.execution.",
        "testId": "T-FIRST-EXECUTION",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "first.result",
        "version": 1,
        "target": "session.final-result",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь ответ",
            "body": "Открой результат и проверь, подходит ли он для твоей задачи. При необходимости уточни запрос в этой же сессии."
          },
          "en": {
            "title": "Review the answer",
            "body": "Read the result and check whether it meets your needs. Continue in this session to refine it."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "user-turn.final-delivered",
          "evidence": "verified",
          "priorState": "same-attempt",
          "requireAcknowledgementAfterEvidence": true
        },
        "handoff": false,
        "optional": false,
        "notes": "Только новый final после отправки из этого запуска; welcome, промежуточный текст, error/interrupted/timeout не подходят. Доставка ответа не равна качественному выполнению задачи.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.first-result.first.result.",
        "testId": "T-FIRST-RESULT",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "welcome-created",
      "learning-manual-start"
    ],
    "titleKey": "productTour.first-result.name",
    "goalKey": "productTour.first-result.goal",
    "whyKey": "productTour.first-result.why"
  },
  {
    "id": "OBT-02",
    "slug": "workspace",
    "version": 1,
    "title": "Рабочее пространство",
    "goal": "Понять активный контекст и способ переключения.",
    "why": "Не путать workspace с проектом и не делать ложных обещаний безопасности.",
    "trigger": "При первом открытии переключателя workspace.",
    "requires": [
      "shell.ready"
    ],
    "owner": "A0",
    "evidence": [
      "E18",
      "E20"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "workspace.scope",
        "version": 1,
        "target": "workspace.switcher",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Твой текущий контекст",
            "body": "Рабочее пространство группирует рабочие материалы и настройки. Общие подключения и память могут иметь отдельную область действия."
          },
          "en": {
            "title": "Your current context",
            "body": "A workspace groups work and settings. Shared connections and memory can have a different scope."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Не утверждать строгую изоляцию всех сущностей без проверки их scope; переключение не обязательно.",
        "scope": "shell",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.workspace.workspace.scope.",
        "testId": "T-WORKSPACE-SCOPE",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "workspace-menu-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.workspace.name",
    "goalKey": "productTour.workspace.goal",
    "whyKey": "productTour.workspace.why"
  },
  {
    "id": "OBT-03",
    "slug": "models",
    "version": 1,
    "title": "Модель и поставщик",
    "goal": "Найти модель сессии и настройки LLM.",
    "why": "Отделить LLM connection от Connection Fabric.",
    "trigger": "Первое открытие model picker или Settings → ИИ.",
    "requires": [
      "sessions.available"
    ],
    "owner": "A7",
    "evidence": [
      "E11",
      "E08",
      "E09"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "models.picker",
        "version": 1,
        "target": "composer.model",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Модель для этой задачи",
            "body": "Посмотри доступные модели и текущий выбор. Менять модель для прохождения обучения не нужно."
          },
          "en": {
            "title": "Model for this task",
            "body": "Review the available models and the current selection. You do not need to change models to finish this tour."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "model-picker.opened",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.models.models.picker.",
        "testId": "T-MODELS-PICKER",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "models.settings",
        "version": 1,
        "target": "settings.ai",
        "routeKey": "settings-ai",
        "copy": {
          "ru": {
            "title": "Настройки ИИ",
            "body": "Здесь находятся настройки моделей и подключения к ним. Доступные варианты и их применение определяет текущий runtime Rox."
          },
          "en": {
            "title": "AI settings",
            "body": "Manage model settings and their connections here. The current Rox runtime determines which options are available and how they apply."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": " Latest HEAD: не приравнивать модельное подключение к отдельному runtime; читать эффективное состояние после OMP migration.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.models.models.settings.",
        "testId": "T-MODELS-SETTINGS",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "model-picker-opened",
      "settings-ai-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.models.name",
    "goalKey": "productTour.models.goal",
    "whyKey": "productTour.models.why"
  },
  {
    "id": "OBT-04",
    "slug": "working-directory",
    "version": 1,
    "title": "Рабочая папка",
    "goal": "Понять cwd локальной задачи.",
    "why": "Предотвратить ошибочное понимание cwd как песочницы.",
    "trigger": "Первое открытие выбора рабочей папки.",
    "requires": [
      "sessions.available",
      "filesystem.selector"
    ],
    "owner": "A4",
    "evidence": [
      "E39",
      "E07"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "cwd.inspect",
        "version": 1,
        "target": "composer.directory",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Где выполняется задача",
            "body": "Рабочая папка задаёт начальный каталог для файловых действий. Сама по себе она не запрещает доступ к другим разрешённым путям."
          },
          "en": {
            "title": "Working directory",
            "body": "This is the starting directory for file operations. It does not, by itself, block access to other permitted paths."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Не читать диск, не выбирать системные папки и не менять cwd автоматически.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.working-directory.cwd.inspect.",
        "testId": "T-CWD-INSPECT",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "working-directory-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.working-directory.name",
    "goalKey": "productTour.working-directory.goal",
    "whyKey": "productTour.working-directory.why"
  },
  {
    "id": "OBT-05",
    "slug": "attachments",
    "version": 1,
    "title": "Файлы в запросе",
    "goal": "Самостоятельно приложить материал и увидеть его в черновике.",
    "why": "Дать контекст без настройки внешней интеграции.",
    "trigger": "Первое открытие Attach после базового тура.",
    "requires": [
      "sessions.available",
      "attachments.available"
    ],
    "owner": "A4",
    "evidence": [
      "E20",
      "E41"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "attachments.add",
        "version": 1,
        "target": "composer.attach",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Добавь материал",
            "body": "Выбери файл, который можно передать выбранной модели. Системный диалог откроется после твоего нажатия."
          },
          "en": {
            "title": "Add material",
            "body": "Choose a file that may be sent to the selected model. The system picker opens only after you click."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "attachment.ready",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.attachments.attachments.add.",
        "testId": "T-ATTACHMENTS-ADD",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "attachments.review",
        "version": 1,
        "target": "composer.attachments",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь вложение",
            "body": "Убедись, что выбран нужный файл. Его можно убрать до отправки; сам тур ничего не отправляет."
          },
          "en": {
            "title": "Review the attachment",
            "body": "Check that this is the correct file. Remove it before sending if needed; the tour sends nothing."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.attachments.attachments.review.",
        "testId": "T-ATTACHMENTS-REVIEW",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "attachment-control-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.attachments.name",
    "goalKey": "productTour.attachments.goal",
    "whyKey": "productTour.attachments.why"
  },
  {
    "id": "OBT-06",
    "slug": "dictation",
    "version": 1,
    "title": "Голосовой ввод",
    "goal": "Продиктовать черновик и проверить текст.",
    "why": "Упростить ввод, не связывая обучение с постоянной записью.",
    "trigger": "Пользователь сам открывает микрофон.",
    "requires": [
      "voice.available"
    ],
    "owner": "A4",
    "evidence": [
      "E40"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "voice.start",
        "version": 1,
        "target": "composer.voice",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Продиктуй черновик",
            "body": "Микрофон включается только по твоему действию. Разрешение системы можно отклонить и продолжить ввод с клавиатуры."
          },
          "en": {
            "title": "Dictate a draft",
            "body": "The microphone starts only when you choose. You can deny system permission and keep typing."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.dictation.voice.start.",
        "testId": "T-VOICE-START",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "voice.review",
        "version": 1,
        "target": "composer.input",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь распознанный текст",
            "body": "Исправь текст перед отправкой. Остановка записи и отправка сообщения — отдельные действия."
          },
          "en": {
            "title": "Review the transcription",
            "body": "Edit the text before sending. Stopping recording and sending a message are separate actions."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "dictation.inserted",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Не считать обычный ввод доказательством диктовки. Отказ в разрешении не считать ошибкой пользователя.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.dictation.voice.review.",
        "testId": "T-VOICE-REVIEW",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "voice-control-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.dictation.name",
    "goalKey": "productTour.dictation.goal",
    "whyKey": "productTour.dictation.why"
  },
  {
    "id": "OBT-07",
    "slug": "builtin-sources",
    "version": 1,
    "title": "Готовность встроенных источников",
    "goal": "Отличать включённый Source от рабочего подключения.",
    "why": "Встроенные MCP устанавливаются асинхронно; не обещать невозможное.",
    "trigger": "Первое открытие Sources.",
    "requires": [
      "sources.list"
    ],
    "owner": "A7",
    "evidence": [
      "E04",
      "E42"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "sources.status",
        "version": 1,
        "target": "sources.list",
        "routeKey": "sources",
        "copy": {
          "ru": {
            "title": "Выбери источник",
            "body": "Открой один источник из списка. Он может быть готов, устанавливаться или ждать авторизации; само наличие в списке не означает готовность."
          },
          "en": {
            "title": "Choose a source",
            "body": "Open a source from the list. It may be ready, installing or waiting for authentication; being listed does not mean it is ready."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "source.details-visible",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.builtin-sources.sources.status.",
        "testId": "T-SOURCES-STATUS",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "sources.details",
        "version": 1,
        "target": "source.status",
        "routeKey": "selected-source",
        "copy": {
          "ru": {
            "title": "Узнай, что требуется",
            "body": "Открой источник и посмотри статус, инструменты и причину ожидания. Можно продолжать работу, пока другие источники настраиваются."
          },
          "en": {
            "title": "See what is needed",
            "body": "Open a source to inspect its status, tools and setup requirements. You can keep working while other sources are being prepared."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "source.details-visible",
          "evidence": "observed",
          "priorState": "allow-current-state",
          "requireAcknowledgementAfterEvidence": true
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.builtin-sources.sources.details.",
        "testId": "T-SOURCES-DETAILS",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "sources-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.builtin-sources.name",
    "goalKey": "productTour.builtin-sources.goal",
    "whyKey": "productTour.builtin-sources.why"
  },
  {
    "id": "OBT-08",
    "slug": "source-use",
    "version": 2,
    "title": "Использование источника",
    "goal": "Выбрать готовый источник для сессии и увидеть обращение к нему.",
    "why": "Связать меню Sources с реальной работой агента.",
    "trigger": "После первого ответа и при наличии доступного подключённого источника.",
    "requires": [
      "sessions.available",
      "sources.ready"
    ],
    "owner": "A7",
    "evidence": [
      "E04",
      "E27"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "sources.select",
        "version": 1,
        "target": "composer.sources",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Выбери данные для задачи",
            "body": "Подключи подходящий готовый источник к этой сессии. Не все доступные источники нужны в каждом запросе."
          },
          "en": {
            "title": "Choose data for this task",
            "body": "Select a suitable ready source for this session. You do not need every source in every request."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "session.sources-committed",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.source-use.sources.select.",
        "testId": "T-SOURCES-SELECT",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "sources.ask",
        "version": 1,
        "target": "composer.input",
        "routeKey": "current-session",
        "scope": "bound-panel",
        "copyKey": "productTour.source-use.sources.ask.",
        "copy": {
          "ru": {
            "title": "Задай вопрос по этим данным",
            "body": "Напиши вопрос по выбранному источнику и отправь его обычной кнопкой. Тур не отправляет запрос и не расходует баланс самостоятельно."
          },
          "en": {
            "title": "Ask about these data",
            "body": "Write a question about the selected source and send it with the normal control. The tour never sends a request or uses your balance on its own."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "user-turn.accepted",
          "evidence": "verified",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "requires": [],
        "onUnavailable": "block",
        "missingTarget": "block-and-offer-retry-or-pause",
        "notes": "Отдельный шаг предотвращает ожидание tool result до того, как пользователь вообще задал вопрос. Привязать следующую проверку инструмента к этой операции.",
        "testId": "T-SOURCES-ASK"
      },
      {
        "id": "sources.result",
        "version": 2,
        "target": "session.tool-result",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь работу с источником",
            "body": "После собственного запроса открой действие агента. Здесь можно проверить, был ли источник использован и завершился ли вызов без ошибки."
          },
          "en": {
            "title": "Inspect source use",
            "body": "After sending your own request, open the agent action. Check whether the source was used and the call returned without an error."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "source.tool-succeeded",
          "evidence": "verified",
          "priorState": "same-attempt",
          "requireAcknowledgementAfterEvidence": true
        },
        "handoff": false,
        "optional": false,
        "notes": "sources_changed подтверждает выбор, но не использование. Требуются correlated tool_start/tool_result без isError и совпавший выбранный source.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.source-use.sources.result.",
        "testId": "T-SOURCES-RESULT",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "first-answer-delivered",
      "ready-source-available",
      "learning-manual-start"
    ],
    "titleKey": "productTour.source-use.name",
    "goalKey": "productTour.source-use.goal",
    "whyKey": "productTour.source-use.why"
  },
  {
    "id": "OBT-09",
    "slug": "skills",
    "version": 1,
    "title": "Навыки",
    "goal": "Выбрать повторно используемый способ работы.",
    "why": "Отделить инструкции от источников и памяти.",
    "trigger": "Первое открытие Skills или выбора навыка.",
    "requires": [
      "skills.available",
      "sessions.available"
    ],
    "owner": "A7",
    "evidence": [
      "E19",
      "E33"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "skills.explain",
        "version": 1,
        "target": "skills.list",
        "routeKey": "skills",
        "copy": {
          "ru": {
            "title": "Навык задаёт способ работы",
            "body": "Навык содержит инструкции для повторяемой задачи. Источник даёт данные, а навык описывает, как с ними работать."
          },
          "en": {
            "title": "A skill defines how to work",
            "body": "A skill contains instructions for a repeatable task. A source provides data; a skill explains how to work with it."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.skills.skills.explain.",
        "testId": "T-SKILLS-EXPLAIN",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "skills.select",
        "version": 1,
        "target": "composer.skills",
        "routeKey": "current-session",
        "copy": {
          "ru": {
            "title": "Добавь подходящий навык",
            "body": "Выбери один навык для своей задачи и проверь его отметку в запросе. Это выбор инструкции, а не гарантия качества ответа."
          },
          "en": {
            "title": "Choose a suitable skill",
            "body": "Select one skill and check its badge in the request. This selects instructions; it does not guarantee answer quality."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "skill.selected",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.skills.skills.select.",
        "testId": "T-SKILLS-SELECT",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "skills-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.skills.name",
    "goalKey": "productTour.skills.goal",
    "whyKey": "productTour.skills.why"
  },
  {
    "id": "OBT-10",
    "slug": "approval",
    "version": 1,
    "title": "Запрос разрешения",
    "goal": "Осознанно разрешить или отклонить действие.",
    "why": "Обучать контролю, не склонять к выдаче полномочий.",
    "trigger": "Первый настоящий permission request.",
    "requires": [
      "permissions.pending"
    ],
    "owner": "A4",
    "evidence": [
      "E27",
      "E22"
    ],
    "priority": "P0",
    "steps": [
      {
        "id": "approval.inspect",
        "version": 1,
        "target": "permission.request",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь предлагаемое действие",
            "body": "Прочитай действие и его область. Обучение не требует соглашаться: отказ — нормальный вариант."
          },
          "en": {
            "title": "Inspect the proposed action",
            "body": "Read the action and its scope. This tour does not require approval; denying is a valid choice."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.approval.approval.inspect.",
        "testId": "T-APPROVAL-INSPECT",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "approval.resolve",
        "version": 1,
        "target": "permission.actions",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Прими решение",
            "body": "Выбери разрешение или отказ в обычном диалоге Rox. Подсказка не нажимает эти кнопки вместо тебя."
          },
          "en": {
            "title": "Make your decision",
            "body": "Approve or deny using Rox’s normal controls. The tour never presses these buttons for you."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "permission.resolved-by-user",
          "evidence": "verified",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "Timeout/исчезновение запроса без действия пользователя не равно успешному разрешению шага.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.approval.approval.resolve.",
        "testId": "T-APPROVAL-RESOLVE",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "permission-request-present",
      "learning-manual-start"
    ],
    "titleKey": "productTour.approval.name",
    "goalKey": "productTour.approval.goal",
    "whyKey": "productTour.approval.why"
  },
  {
    "id": "OBT-11",
    "slug": "parallel-work",
    "version": 1,
    "title": "Несколько сессий",
    "goal": "Переключаться между задачами и находить предыдущую.",
    "why": "Показать агентную работу без обещания долговечности после закрытия приложения.",
    "trigger": "После первого ответа или при второй открытой задаче.",
    "requires": [
      "sessions.available"
    ],
    "owner": "A4",
    "evidence": [
      "E20",
      "E18"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "parallel.new",
        "version": 1,
        "target": "session.new",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Отдельная задача — отдельная сессия",
            "body": "Создай новый разговор для другой задачи. Первый останется в списке сессий."
          },
          "en": {
            "title": "Use a session for each task",
            "body": "Create a new conversation for another task. The first stays in your session list."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "session.created",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.parallel-work.parallel.new.",
        "testId": "T-PARALLEL-NEW",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "parallel.return",
        "version": 1,
        "target": "session.list",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Вернись к предыдущей работе",
            "body": "Переключение экрана не означает остановку агента. Продолжение после закрытия приложения зависит от используемого runtime."
          },
          "en": {
            "title": "Return to earlier work",
            "body": "Switching views does not itself stop an agent. Continuing after the app closes depends on the runtime in use."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "session.reopened",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Если есть реальная background task, дополнительная контекстная подсветка её чипа входит в вариант этого шага; не требовать появления такого чипа.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.parallel-work.parallel.return.",
        "testId": "T-PARALLEL-RETURN",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "first-answer-delivered",
      "second-session-created",
      "learning-manual-start"
    ],
    "titleKey": "productTour.parallel-work.name",
    "goalKey": "productTour.parallel-work.goal",
    "whyKey": "productTour.parallel-work.why"
  },
  {
    "id": "OBT-12",
    "slug": "agent-center",
    "version": 1,
    "title": "Центр агентов",
    "goal": "Найти активные задачи, ожидания и доступный бюджет.",
    "why": "Сделать контроль нескольких процессов доступным из одного места.",
    "trigger": "Открытие Ещё → Центр агентов.",
    "requires": [
      "agent-center.available"
    ],
    "owner": "A4",
    "evidence": [
      "E15",
      "E16"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "agents.overview",
        "version": 1,
        "target": "agents.summary",
        "routeKey": "agents",
        "copy": {
          "ru": {
            "title": "Проверь состояние работы",
            "body": "Здесь собраны выполняющиеся задачи и запросы, которые ждут тебя. Пустой список означает, что подходящих активных задач сейчас нет."
          },
          "en": {
            "title": "Review work status",
            "body": "Find running tasks and requests waiting for you. An empty list means there are no matching active tasks right now."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.agent-center.agents.overview.",
        "testId": "T-AGENTS-OVERVIEW",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "agents.budget",
        "version": 1,
        "target": "agents.budget",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь доступные расходы",
            "body": "Бюджет показывается по доступным данным runtime. Неизвестная стоимость не считается нулевой; менять лимит для обучения не нужно."
          },
          "en": {
            "title": "Review available cost data",
            "body": "Budget information comes from the runtime. Unknown cost is not zero; you do not need to change a limit for this tour."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "При unavailable budget показать честное unavailable-состояние, не подставлять 0 и не обещать hard limit для неподтверждённого backend.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.agent-center.agents.budget.",
        "testId": "T-AGENTS-BUDGET",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "agent-center-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.agent-center.name",
    "goalKey": "productTour.agent-center.goal",
    "whyKey": "productTour.agent-center.why"
  },
  {
    "id": "OBT-13",
    "slug": "session-workflow",
    "version": 1,
    "title": "Организация сессий",
    "goal": "Использовать статусы, метки и представления.",
    "why": "Не превращать список рабочих диалогов в свалку.",
    "trigger": "После нескольких сессий или при открытии фильтра/статуса.",
    "requires": [
      "sessions.available"
    ],
    "owner": "A4",
    "evidence": [
      "E09",
      "E27"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "workflow.status",
        "version": 1,
        "target": "session.status",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Обозначь состояние задачи",
            "body": "Выбери подходящий статус сессии. Статус помогает организовать работу, но сам по себе не подтверждает её успешность."
          },
          "en": {
            "title": "Set a work status",
            "body": "Choose an appropriate session status. Status organizes work; it does not prove success."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "session.status-committed",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.session-workflow.workflow.status.",
        "testId": "T-WORKFLOW-STATUS",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "workflow.label",
        "version": 1,
        "target": "session.labels",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Добавь полезную метку",
            "body": "Метки помогают группировать и находить связанные сессии. Сохрани одну осмысленную метку или пропусти шаг."
          },
          "en": {
            "title": "Add a useful label",
            "body": "Labels help group and find related sessions. Save one meaningful label or skip this step."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "session.labels-committed",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": true,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.session-workflow.workflow.label.",
        "testId": "T-WORKFLOW-LABEL",
        "requires": [
          "labels.available"
        ],
        "onUnavailable": "not-applicable"
      },
      {
        "id": "workflow.board",
        "version": 1,
        "target": "sessions.view-switcher",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Выбери представление",
            "body": "Список, таблица и доска могут показывать сессии по-разному. Эта доска не заменяет отдельный раздел личных задач."
          },
          "en": {
            "title": "Choose a view",
            "body": "Lists, tables and boards can show sessions differently. This board is not the separate personal Tasks feature."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "sessions.view-visible",
          "evidence": "observed",
          "priorState": "allow-current-state",
          "requireAcknowledgementAfterEvidence": true
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.session-workflow.workflow.board.",
        "testId": "T-WORKFLOW-BOARD",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "session-workflow-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.session-workflow.name",
    "goalKey": "productTour.session-workflow.goal",
    "whyKey": "productTour.session-workflow.why"
  },
  {
    "id": "OBT-14",
    "slug": "projects",
    "version": 1,
    "title": "Проекты",
    "goal": "Сгруппировать работу вокруг цели.",
    "why": "Отделить долгую цель от workspace и отдельного диалога.",
    "trigger": "Первое открытие проекта.",
    "requires": [
      "projects.available"
    ],
    "owner": "A5",
    "evidence": [
      "E09",
      "E19"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "project.open",
        "version": 1,
        "target": "projects.list",
        "routeKey": "projects",
        "copy": {
          "ru": {
            "title": "Собери работу вокруг цели",
            "body": "Открой существующий проект или создай свой обычной кнопкой Rox. Рабочее пространство может содержать несколько проектов."
          },
          "en": {
            "title": "Group work around a goal",
            "body": "Open an existing project or create one with Rox’s normal control. A workspace can contain several projects."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "project.visible",
          "evidence": "observed",
          "priorState": "allow-current-state",
          "requireAcknowledgementAfterEvidence": true
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.projects.project.open.",
        "testId": "T-PROJECT-OPEN",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "project.link",
        "version": 1,
        "target": "session.project",
        "routeKey": "current-session",
        "copy": {
          "ru": {
            "title": "Свяжи сессию с проектом",
            "body": "Укажи, к какой цели относится этот разговор. Привязка не переносит материалы и не меняет разрешения автоматически."
          },
          "en": {
            "title": "Link a session to the project",
            "body": "Choose the goal this conversation belongs to. Linking does not automatically move materials or change permissions."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "session.project-committed",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.projects.project.link.",
        "testId": "T-PROJECT-LINK",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "project-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.projects.name",
    "goalKey": "productTour.projects.goal",
    "whyKey": "productTour.projects.why"
  },
  {
    "id": "OBT-15",
    "slug": "personal-tasks",
    "version": 1,
    "title": "Личные задачи",
    "goal": "Сохранить задачу и при необходимости поручить её агенту.",
    "why": "Показать рабочий переход от собственного списка к агентной сессии.",
    "trigger": "Первое открытие Tasks.",
    "requires": [
      "personal-tasks.available"
    ],
    "owner": "A5",
    "evidence": [
      "E12"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "tasks.create",
        "version": 1,
        "target": "tasks.quick-entry",
        "routeKey": "tasks",
        "copy": {
          "ru": {
            "title": "Запиши задачу",
            "body": "Создай личную задачу. Она появится в списке после сохранения; это отдельный объект, не статус чата."
          },
          "en": {
            "title": "Capture a task",
            "body": "Create a personal task. It appears after saving and is a separate object, not a chat status."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "personal-task.persisted",
          "evidence": "verified",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.personal-tasks.tasks.create.",
        "testId": "T-TASKS-CREATE",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "tasks.delegate",
        "version": 1,
        "target": "tasks.delegate",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Поручи задачу агенту",
            "body": "Эта команда создаёт связанную сессию. Используй её для настоящей задачи или пропусти шаг без изменений."
          },
          "en": {
            "title": "Delegate to an agent",
            "body": "This creates a linked session. Use it for a real task or skip without changing anything."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "personal-task.delegated",
          "evidence": "verified",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": true,
        "notes": "Нужны созданная сессия и сохранённая обратная ссылка; локальный optimistic checkbox не подходит.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.personal-tasks.tasks.delegate.",
        "testId": "T-TASKS-DELEGATE",
        "requires": [
          "task.delegation-available"
        ],
        "onUnavailable": "not-applicable"
      }
    ],
    "entryTriggers": [
      "tasks-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.personal-tasks.name",
    "goalKey": "productTour.personal-tasks.goal",
    "whyKey": "productTour.personal-tasks.why"
  },
  {
    "id": "OBT-16",
    "slug": "pages",
    "version": 1,
    "title": "Страницы",
    "goal": "Открыть постоянное встроенное представление и увидеть его состояние.",
    "why": "Отличить Pages от Markdown Notes и не скрывать правила доступа.",
    "trigger": "Первое открытие готовой Page.",
    "requires": [
      "pages.available",
      "pages.entity-present"
    ],
    "owner": "A6",
    "evidence": [
      "E14"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "pages.open",
        "version": 1,
        "target": "pages.host",
        "routeKey": "selected-page",
        "copy": {
          "ru": {
            "title": "Открой рабочую страницу",
            "body": "Pages показывают сохранённые представления и мини-приложения. Это отдельная поверхность, а не продолжение текста чата."
          },
          "en": {
            "title": "Open a working page",
            "body": "Pages contain saved views and mini-apps. This is a separate surface rather than another chat message."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "page.rendered",
          "evidence": "observed",
          "priorState": "allow-current-state",
          "requireAcknowledgementAfterEvidence": true
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.pages.pages.open.",
        "testId": "T-PAGES-OPEN",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "pages.state",
        "version": 1,
        "target": "pages.freshness",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь данные и доступ",
            "body": "Обрати внимание на обновление данных и разрешения страницы. Тур не включает публикацию и не выдаёт ей новые права."
          },
          "en": {
            "title": "Check data and access",
            "body": "Review data freshness and page permissions. This tour does not publish the page or grant new access."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Только host chrome; нельзя искать DOM цели внутри PageFrame или выполнять код страницы.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.pages.pages.state.",
        "testId": "T-PAGES-STATE",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "page-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.pages.name",
    "goalKey": "productTour.pages.goal",
    "whyKey": "productTour.pages.why"
  },
  {
    "id": "OBT-17",
    "slug": "notes",
    "version": 2,
    "title": "Заметки",
    "goal": "Создать и сохранить собственную заметку.",
    "why": "Получить повторно используемый материал после разговора.",
    "trigger": "Первое открытие native Notes.",
    "requires": [
      "notes.available"
    ],
    "owner": "A6",
    "evidence": [
      "E35"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "notes.create",
        "version": 2,
        "target": "notes.create",
        "routeKey": "notes",
        "copy": {
          "ru": {
            "title": "Создай заметку",
            "body": "Сохрани нужную мысль или материал отдельно от диалога. Создание выполняется обычной кнопкой Notes."
          },
          "en": {
            "title": "Create a note",
            "body": "Keep a useful idea or material separate from the conversation. Create it with the normal Notes control."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "note.created",
          "evidence": "verified",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.notes.notes.create.",
        "testId": "T-NOTES-CREATE",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "notes.save",
        "version": 1,
        "target": "notes.editor",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь сохранение",
            "body": "Добавь свой текст и дождись подтверждения сохранения. Видимый текст в редакторе ещё не доказывает запись в хранилище."
          },
          "en": {
            "title": "Check saving",
            "body": "Add your text and wait for save confirmation. Text visible in the editor does not by itself prove persistence."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "note.persisted",
          "evidence": "verified",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.notes.notes.save.",
        "testId": "T-NOTES-SAVE",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "notes-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.notes.name",
    "goalKey": "productTour.notes.goal",
    "whyKey": "productTour.notes.why"
  },
  {
    "id": "OBT-18",
    "slug": "memory",
    "version": 1,
    "title": "Память",
    "goal": "Понять правила памяти, её область и управление.",
    "why": "Сделать накопление контекста прозрачным и исправляемым.",
    "trigger": "Первое явное открытие Memory; не поверх первого разговора.",
    "requires": [
      "memory.available"
    ],
    "owner": "A6",
    "evidence": [
      "E05",
      "E38",
      "E04"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "memory.inspect",
        "version": 1,
        "target": "memory.list",
        "routeKey": "memory",
        "copy": {
          "ru": {
            "title": "Что Rox должен помнить",
            "body": "Здесь находятся устойчивые правила и предпочтения. Это не полная история чата и не индекс всех файлов."
          },
          "en": {
            "title": "What Rox should remember",
            "body": "This holds reusable rules and preferences. It is neither the full chat history nor an index of every file."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.memory.memory.inspect.",
        "testId": "T-MEMORY-INSPECT",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "memory.scope",
        "version": 1,
        "target": "memory.scope",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь область памяти",
            "body": "Правило может относиться к текущей работе или иметь общую область действия. Проверь область перед сохранением."
          },
          "en": {
            "title": "Check memory scope",
            "body": "A rule may apply to the current workspace or more broadly. Check its scope before saving."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "У существующего Memory seed dialog scope=global. Тур обязан показать это; Mem0 cloud не приравнивается к native Memory.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.memory.memory.scope.",
        "testId": "T-MEMORY-SCOPE",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "memory.save",
        "version": 1,
        "target": "memory.editor",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Сохрани только нужное правило",
            "body": "Добавь или подтверди полезное правило осознанно. Его наличие проверяется после записи; пропуск не создаёт никаких предпочтений."
          },
          "en": {
            "title": "Save only a useful rule",
            "body": "Add or confirm a useful rule deliberately. It is checked after saving; skipping creates no preferences."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "memory.persisted",
          "evidence": "verified",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": true,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.memory.memory.save.",
        "testId": "T-MEMORY-SAVE",
        "requires": [
          "memory.write-available"
        ],
        "onUnavailable": "not-applicable"
      }
    ],
    "entryTriggers": [
      "memory-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.memory.name",
    "goalKey": "productTour.memory.goal",
    "whyKey": "productTour.memory.why"
  },
  {
    "id": "OBT-19",
    "slug": "search",
    "version": 1,
    "title": "Единый поиск",
    "goal": "Найти и открыть сохранённый материал.",
    "why": "Замкнуть цикл: создал → сохранил → нашёл снова.",
    "trigger": "После первой заметки или первой полезной сессии.",
    "requires": [
      "search.available"
    ],
    "owner": "A6",
    "evidence": [
      "E34",
      "E09"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "search.query",
        "version": 1,
        "target": "search.input",
        "routeKey": "search",
        "copy": {
          "ru": {
            "title": "Найди свой материал",
            "body": "Введи слово из заметки или разговора. Доступность источников поиска отображается отдельно."
          },
          "en": {
            "title": "Find your material",
            "body": "Enter a word from a note or conversation. Search-source availability is shown separately."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "search.finished",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.search.search.query.",
        "testId": "T-SEARCH-QUERY",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "search.open",
        "version": 1,
        "target": "search.results",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Открой найденное",
            "body": "Перейди из результата к исходному материалу. Если совпадений нет, измени запрос; отсутствие результата не означает успешный поиск."
          },
          "en": {
            "title": "Open a result",
            "body": "Go from a search result to its source material. If nothing matches, change your query; no results do not count as a successful retrieval."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "search.result-opened",
          "evidence": "verified",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.search.search.open.",
        "testId": "T-SEARCH-OPEN",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "material-persisted",
      "learning-manual-start"
    ],
    "titleKey": "productTour.search.name",
    "goalKey": "productTour.search.goal",
    "whyKey": "productTour.search.why"
  },
  {
    "id": "OBT-20",
    "slug": "inbox",
    "version": 1,
    "title": "Входящие решения",
    "goal": "Отличать решения и запросы внимания от истории чатов.",
    "why": "Помочь управлять ожиданиями агентов без случайных разрешений.",
    "trigger": "Первое открытие Inbox.",
    "requires": [
      "inbox.available"
    ],
    "owner": "A10",
    "evidence": [
      "E13"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "inbox.queue",
        "version": 1,
        "target": "inbox.list",
        "routeKey": "inbox",
        "copy": {
          "ru": {
            "title": "Что сейчас ждёт тебя",
            "body": "Здесь собраны запросы разрешений, планы, предложения памяти и другие элементы внимания. Это не список всех сессий."
          },
          "en": {
            "title": "What needs your attention",
            "body": "This queue contains permissions, plans, memory proposals and other items needing attention. It is not the full session list."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.inbox.inbox.queue.",
        "testId": "T-INBOX-QUEUE",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "inbox.triage",
        "version": 1,
        "target": "inbox.actions",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Разделяй решение и сортировку",
            "body": "«Готово» и «Отложить» управляют очередью. Выдача разрешения или принятие предложения выполняется отдельным действием."
          },
          "en": {
            "title": "Separate decisions from triage",
            "body": "Done and Snooze organize the queue. Granting permission or accepting a proposal is a separate action."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "При пустой очереди подсветить её empty state; не генерировать фиктивный запрос.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.inbox.inbox.triage.",
        "testId": "T-INBOX-TRIAGE",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "inbox-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.inbox.name",
    "goalKey": "productTour.inbox.goal",
    "whyKey": "productTour.inbox.why"
  },
  {
    "id": "OBT-21",
    "slug": "feed",
    "version": 1,
    "title": "Лента и RSS",
    "goal": "Открыть внешний материал и управлять входящим потоком.",
    "why": "Показать пользу Feed без смешения с решениями Inbox.",
    "trigger": "Первое открытие Feed.",
    "requires": [
      "feed.available"
    ],
    "owner": "A10",
    "evidence": [
      "E36"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "feed.sources",
        "version": 1,
        "target": "feed.sources",
        "routeKey": "feed",
        "copy": {
          "ru": {
            "title": "Выбери входящий поток",
            "body": "Лента собирает подключённые материалы. Новый источник добавляй только тогда, когда он нужен для твоей работы."
          },
          "en": {
            "title": "Choose your information flow",
            "body": "The feed collects connected material. Add a source only when it is useful for your work."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.feed.feed.sources.",
        "testId": "T-FEED-SOURCES",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "feed.read",
        "version": 1,
        "target": "feed.reader",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Открой материал",
            "body": "Прочитай доступную публикацию и найди её исходную ссылку. Лента не означает, что материал автоматически добавлен в память."
          },
          "en": {
            "title": "Read an item",
            "body": "Open an available item and locate its source link. A feed item is not automatically a memory."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "feed.item-opened",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Если контент отсутствует/сеть недоступна, waiting-content; можно выйти. Не подставлять mock articles.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.feed.feed.read.",
        "testId": "T-FEED-READ",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "feed-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.feed.name",
    "goalKey": "productTour.feed.goal",
    "whyKey": "productTour.feed.why"
  },
  {
    "id": "OBT-22",
    "slug": "meetings",
    "version": 1,
    "title": "Встречи",
    "goal": "Найти материалы встречи и понять условия записи.",
    "why": "Связать разговор с артефактами, не включать запись без согласия.",
    "trigger": "Первое открытие Meetings либо готового результата встречи.",
    "requires": [
      "meetings.available"
    ],
    "owner": "A11",
    "evidence": [
      "E37",
      "E19"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "meetings.list",
        "version": 1,
        "target": "meetings.list",
        "routeKey": "meetings",
        "copy": {
          "ru": {
            "title": "Встречи и их материалы",
            "body": "Здесь находятся доступные встречи и результаты обработки. Запись и доступ к микрофону запускаются отдельно по твоему действию."
          },
          "en": {
            "title": "Meetings and their material",
            "body": "Find available meetings and processed results here. Recording and microphone access require a separate action from you."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.meetings.meetings.list.",
        "testId": "T-MEETINGS-LIST",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "meetings.result",
        "version": 1,
        "target": "meetings.artifacts",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь результат встречи",
            "body": "Открой существующий результат и проверь его содержание. Появление раздела не доказывает, что запись уже выполняется или завершена."
          },
          "en": {
            "title": "Review a meeting result",
            "body": "Open an existing result and inspect it. The presence of this screen does not mean recording is running or has finished."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "meeting.artifact-opened",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": true,
        "notes": "Не запускать запись, внешнего bot, экспорт или публикацию автоматически. Нет артефактов — шаг отложен, не verified.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.meetings.meetings.result.",
        "testId": "T-MEETINGS-RESULT",
        "requires": [
          "meeting.artifact-present"
        ],
        "onUnavailable": "not-applicable"
      }
    ],
    "entryTriggers": [
      "meetings-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.meetings.name",
    "goalKey": "productTour.meetings.goal",
    "whyKey": "productTour.meetings.why"
  },
  {
    "id": "OBT-23",
    "slug": "automations",
    "version": 1,
    "title": "Автоматизации",
    "goal": "Понять условие запуска, действие и контроль.",
    "why": "Отделить настройку от немедленного исполнения.",
    "trigger": "Первое открытие существующего AutomationEditor.",
    "requires": [
      "automations.available",
      "automation.entity-present"
    ],
    "owner": "A11",
    "evidence": [
      "E17"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "automation.trigger",
        "version": 1,
        "target": "automation.trigger",
        "routeKey": "selected-automation",
        "copy": {
          "ru": {
            "title": "Когда запускать работу",
            "body": "Проверь событие или расписание. Для расписания важны часовой пояс и ближайший запуск."
          },
          "en": {
            "title": "When should work run?",
            "body": "Review the event or schedule. A schedule also needs the correct timezone and next-run time."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.automations.automation.trigger.",
        "testId": "T-AUTOMATION-TRIGGER",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "automation.action",
        "version": 1,
        "target": "automation.action",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Что будет сделано",
            "body": "Проверь текст задачи, модель и разрешения. Сохранение настроек и запуск выполнения — разные действия."
          },
          "en": {
            "title": "What will happen?",
            "body": "Review the task, model and permissions. Saving settings and running the work are different actions."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.automations.automation.action.",
        "testId": "T-AUTOMATION-ACTION",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "automation.control",
        "version": 1,
        "target": "automation.controls",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Контролируй запуск",
            "body": "Переключатель и «Запустить сейчас» действуют сразу. Проверь историю и состояние; обучение не требует включать автоматизацию."
          },
          "en": {
            "title": "Control execution",
            "body": "The toggle and Run now act immediately. Inspect history and state; the tour does not require enabling this automation."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "По явному пользовательскому запуску можно отдельно собрать automation.run-succeeded, но просмотр подсказки его не имитирует.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.automations.automation.control.",
        "testId": "T-AUTOMATION-CONTROL",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "automation-editor-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.automations.name",
    "goalKey": "productTour.automations.goal",
    "whyKey": "productTour.automations.why"
  },
  {
    "id": "OBT-24",
    "slug": "connection-fabric",
    "version": 1,
    "title": "Подключения и права",
    "goal": "Найти сервисы, credentials, policies и audit.",
    "why": "Не смешивать инфраструктуру доступа с LLM selector.",
    "trigger": "Первое открытие Connections.",
    "requires": [
      "connection-fabric.available"
    ],
    "owner": "A7",
    "evidence": [
      "E10",
      "E11"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "connections.services",
        "version": 1,
        "target": "connections.services",
        "routeKey": "connections",
        "copy": {
          "ru": {
            "title": "Доступ к сервисам",
            "body": "Здесь управляют доступом к сервисам и их учётными данными. Настройки моделей находятся отдельно, в разделе ИИ."
          },
          "en": {
            "title": "Service access",
            "body": "Manage service access and credentials here. Model settings are separate, in AI settings."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.connection-fabric.connections.services.",
        "testId": "T-CONNECTIONS-SERVICES",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "connections.audit",
        "version": 1,
        "target": "connections.audit",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Проверь права и историю",
            "body": "Открой доступные политики и журнал. Тур не импортирует секреты и не выдаёт новые права."
          },
          "en": {
            "title": "Review access and history",
            "body": "Inspect available policies and audit entries. The tour neither imports secrets nor grants new access."
          }
        },
        "completion": {
          "kind": "signal",
          "signal": "connections.audit-visible",
          "evidence": "observed",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": true,
        "optional": false,
        "notes": "Отсутствие API/прав — unavailable, не пустая успешная интеграция. Маскированные секреты не читать и не включать в telemetry.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.connection-fabric.connections.audit.",
        "testId": "T-CONNECTIONS-AUDIT",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "connections-opened",
      "learning-manual-start"
    ],
    "titleKey": "productTour.connection-fabric.name",
    "goalKey": "productTour.connection-fabric.goal",
    "whyKey": "productTour.connection-fabric.why"
  },
  {
    "id": "OBT-25",
    "slug": "learning-control",
    "version": 1,
    "title": "Управление обучением",
    "goal": "Вернуться к обучению и управлять его данными.",
    "why": "Сохранить добровольность и повторяемость, дать путь для опытных пользователей.",
    "trigger": "Ручное открытие Settings → Обучение.",
    "requires": [
      "shell.ready"
    ],
    "owner": "A0",
    "evidence": [
      "E06",
      "E30",
      "E25"
    ],
    "priority": "P1",
    "steps": [
      {
        "id": "learning.library",
        "version": 1,
        "target": "learning.library",
        "routeKey": "learning",
        "copy": {
          "ru": {
            "title": "Продолжи нужный сценарий",
            "body": "Здесь можно продолжить или повторить отдельный маршрут. Закрытие подсказки не означает прохождение всех действий."
          },
          "en": {
            "title": "Continue a useful tour",
            "body": "Resume or replay one route here. Closing a hint does not mean its actions were completed."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.learning-control.learning.library.",
        "testId": "T-LEARNING-LIBRARY",
        "requires": [],
        "onUnavailable": "block"
      },
      {
        "id": "learning.controls",
        "version": 1,
        "target": "learning.preferences",
        "routeKey": "keep",
        "copy": {
          "ru": {
            "title": "Ты управляешь подсказками",
            "body": "Отключи приглашения или сбрось только прогресс обучения. Диалоги, заметки, разрешения и память при этом не изменяются."
          },
          "en": {
            "title": "You control the hints",
            "body": "Disable invitations or reset only learning progress. Conversations, notes, permissions and memory remain unchanged."
          }
        },
        "completion": {
          "kind": "ack",
          "signal": null,
          "evidence": "acknowledged",
          "priorState": "after-activation",
          "requireAcknowledgementAfterEvidence": false
        },
        "handoff": false,
        "optional": false,
        "notes": "Сброс только по отдельной подтверждённой кнопке; для прохождения шага сбрасывать прогресс не нужно.",
        "scope": "bound-panel",
        "missingTarget": "block-and-offer-retry-or-pause",
        "copyKey": "productTour.learning-control.learning.controls.",
        "testId": "T-LEARNING-CONTROLS",
        "requires": [],
        "onUnavailable": "block"
      }
    ],
    "entryTriggers": [
      "learning-manual-start"
    ],
    "titleKey": "productTour.learning-control.name",
    "goalKey": "productTour.learning-control.goal",
    "whyKey": "productTour.learning-control.why"
  }
] as const satisfies readonly TourDefinition[]

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}

export const productTourCatalogue: readonly TourDefinition[] = freeze(definitions)
