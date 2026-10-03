# WP01: ограниченная проверка фактического primary PASS

## Привязка к исполнению

- Квитанция: /Users/t/Pictures/Shots/Agents/rox-wp01-electron-1790787061130/result.json
- Receipt SHA: 79af30eecbbd71b62e6e74b44d943e24eb7e53b618b616857cd76bc9d6131528
- Primary source SHA: cac6ec003b57812e29eb660a39473f939292e3e94edf8d5d87324c5199c26630
- Actual root result: 1 pass / 0 fail / 383 expect; Electron 39.2.7, Node 22.21.1, Chrome 142.0.7444.235, darwin/arm64; errors 0, consoleErrors 0.
- Все 27 PNG прошли SHA-256, CRC и полное ручное декодирование RGBA. Лично просмотрены 14 выбранных экранов вместе с сохранёнными HTML и текстом.
- Оба owned profiles используют существующий Pierre: фактические stored/resolved/app = pierre, workspaceTheme = null, root theme = pierre, scenic отсутствует, включая перезапуск. Production ThemeContext и presets не изменены.
- Исходные 130 primary / 92 offline expect строки сохранены в worker patch. Последующие current CAC type/observer изменения и неизменность assertions подтверждены root; отдельная current CAC source copy этому worker не предоставлена.

## Приватный отказ и декодеры

Before/after PNG 1832×312, текст и raw RGBA строго равны. PNG SHA: 6aa695201da66b3f4aacdbb74d497e07f68ef3595964e86cd915a7a97b8c5a64.

- Raw RGBA SHA: cc3b2dc8d52507618415b06af9b662fcff38bcf1b4cd7de533ec1be9c31fbf67.
- Browser canvas RGBA SHA: 1fca4c96963aa236df719b9686dfed3b2b1e5f29881c12d64ec37619f1ef1a6e.
- PNG содержит ICC profile SHA 4c0ff0fead968dfabb20d3534cab8e0287146c4cfcdce51a61fd1caa9ba1de7c; описание Google/Skia/0E983EAA5A1289650CB7C7F6821DF696.
- Независимый Pillow 11.3.0 подтверждает raw SHA. ImageCms ICC→sRGB выдаёт другой SHA; точное браузерное преобразование цвета не установлено.

Равенство encoded PNG и independently decoded raw pixels подтверждает отсутствие изменения проекции до и после отказа. Между декодерами абсолютный RGBA SHA пока не сопоставлен. Foreign buffer не доказан.

## Граница визуального доказательства при 200%

Строгий DOM прошёл в dark и light: native content 980×800, zoom 2, DPR 4 → renderer 490×400; panel 445×340, clientWidth = scrollWidth = 437. Refresh 80.738×33.75, bottom 400 после исходного scroll 8.75; actual hit и trusted focused Enter подтверждены.

Saved PNG 980×800 показывает обрезанные заголовок и ID, Refresh отсутствует. Видимая проекция составляет приблизительно 4 pixel/CSS и не покрывает полный DOM viewport. **Pixel visual acceptance при 200% остаётся NOT_VERIFIED.** Корректные тема, ID и содержание не доказывают foreign buffer. Причина capture mapping не установлена.

Следующий конечный probe принадлежит root после offline lease: дополнительный снимок именно owned webContents через capturePage, с теми же пред-/пост DOM и native bindings, отдельными PNG/ICC/SHA/CRC/RGBA метаданными. Исходные Playwright capture, 130/92 assertions и строгие viewport, hit и overflow условия сохраняются. Exact outside patch требует frozen current CAC source и локальную signature capturePage.

## 54 строки и 17 исходных native PENDING

Primary даёт шесть конкретных новых native leaf closures: **B6, A1, UI2, UI3, T1, FC2**. T1 добавляет rendered native leaf к прежнему forge/holdout evidence, которое здесь не выполнялось заново.

UI2 empty сохранён в обоих create-reviewed PNG/HTML/text: ready section, ноль shared rows, читаемый текст «Нет доступных общих проектов.» позади creation dialog. UI6 и FC21 имеют частичную поддержку; широкие строки автоматически не закрываются.

Остальные 11: **UI1, UI4, UI5, UI6, FC1, FC17, FC19, FC20, FC21, FC22, GATE**. Старые 32 VERIFIED и 5 deferred сохранены как prior bound matrix; это не повторная проверка current source. Loading leaf отсутствует. Offline native и delivery не подтверждаются этой primary квитанцией.

## История ошибок сохранена

1. 270: отказ theme class wait после успешной dark geometry, не viewport. Точная прежняя preset/Space причина не установлена.
2. 243: strict pixel oracle обнаружил изменение размера 3172×312 → 1162×312 после FORBIDDEN. Причина прежнего изменения не установлена.
3. 253: ArrowRight timeout при aria 198 без A geometry и events. Current trusted separator 320→328→320 проходит; conditional clamp остаётся неподтверждённой гипотезой для старого прогона.

**FullFeatureDoD = false; consumer5Complete = false.** Worker не менял root UI, runtime, PostgreSQL или source и не запускал native приложение.
