# UI-001 — продолжение 3

Исходная ревизия: `76228cc33e44518e5fab5e59f5c754f4051d1e8c`. Интеграционная база: `b1526a85f6db5a6cdf668438e484f62ce15e6f29`. Фаза: github-pr. Пользователь разрешил полный ремонт связанных исходников и merge main. Истории предыдущего bounded результата и входящего main сохранены в integration-history, старые ошибки не удалены.

Исправлены неизвестные/повреждённые ссылки, сохранение явной сессии после удаления, workspace mismatch, очередь адресов/параметров/панелей, scoped live skill catalogs и сохранение локальных полей редактора. Существующие retry/lazy-load/error-boundary функции main сохранены. Размеры и межоконная синхронизация используют каноническое состояние хранилища.

Проверки привязаны к текущим source hashes в source-manifest-v3.json и отдельным evidence receipts. Текущая квалификация: ожидает завершения запусков. Подробные команды, отрицательные результаты и snapshot hashes находятся в result.json.

GitHub delivery/merge: ожидает завершения CI и точного remote readback. Слияние разрешено напрямую пользователем; дополнительного согласования не требуется.

`fullDoDClosed: false`. Не наблюдались все original targets: Windows 10/11 native DPI matrix, native macOS compositor/Retina/modal focus, actual hosted C с canonical backend receipts и INT-016 integrated replay. Локальные component/Chromium проверки не называются установленным продуктом или fullDoD.
