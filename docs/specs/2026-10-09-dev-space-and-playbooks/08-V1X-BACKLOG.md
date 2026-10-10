# 08-V1X-BACKLOG — рычаги v1.x: статус

Статус 2026-10-10: **весь список поставлен в v1.x-волне** — одна волна = один PR
(PR #1767, #1768, #1770, #1771, #1774; плюс бонусный фикс #1773).

| # | Рычаг | Статус | Где реализовано | PR |
|---|---|---|---|---|
| V1 | Kokoro — третий движок подкаста (offline CLI) | **поставлено** | `packages/server-core/src/playbooks/tts.ts` (`resolveKokoroCommand`, `probePodcastEngines`, `createKokoroSegmentSynthesizer`, голоса `af_heart`/`am_adam`), канал `podcast:engines`, UI-пункт с честным disabled и хинтами | [#1771](https://github.com/rox-one/rox-one/pull/1771) |
| V2 | N-агентный подкаст (2–6 говорящих) | **поставлено** | `packages/server-core/src/playbooks/script.ts` (`PodcastRoleId` = host/expert/guestN, лимиты 2–6), `planPodcastVoices` (голоса по полу с реюзом), `assemble.ts` (обобщённые ярлыки), редактор ролей в `PodcastStudio` + пресет состава | [#1768](https://github.com/rox-one/rox-one/pull/1768) |
| V3 | Auto-watch репозиториев (флаг off by default, без демонов) | **поставлено** | `packages/server-core/src/devspace/watch.ts` (таймер 60 мин, `.unref()`, стоп на shutdown, tick не бросает), `clone.ts` (`runGitFetch`, `readGitTrackingState`), флаг `devspace.autoWatch.v1`, канал `devSpace:setWatch`, `RepoWatchControls` | [#1774](https://github.com/rox-one/rox-one/pull/1774) |
| V4 | Bounded-параллелизм LLM-слоя | **поставлено** | `packages/server-core/src/devspace/stages/llm.ts` (`LLM_STAGE_CONCURRENCY=2`; артефакты и журнал детерминированы порядком адаптеров) | [#1767](https://github.com/rox-one/rox-one/pull/1767) |
| V5 | R16 слайс-2: режим из лендинга реально используется, `?mode=`, операторский выключатель | **поставлено** | `apps/webui/src/App.tsx` + `web-modes.ts`, `ROX_WEBUI_MODES_LANDING` → `/api/config` (`modesLanding`), решение `plans/next-program/decisions/004-web-modes.md` | [#1770](https://github.com/rox-one/rox-one/pull/1770) |
| V6 | Отсутствие ffprobe деградирует к оценкам (не сырой ENOENT) | **поставлено** (бонус) | `packages/server-core/src/playbooks/assemble.ts` (`runProcess` всегда промис; `probeOne` → `null`) | [#1773](https://github.com/rox-one/rox-one/pull/1773) |

## Границы: что осознанно осталось следующим рычагам

- **Per-repo shallow-clone lever** — `CLONE_DEPTH` зафиксирован как `full` (O9); per-repo глубина не вводилась.
- **Авто-регенерация артефактов после auto-pull** — по P6 остаётся ручной кнопкой («проверить свежесть»), watch только помечает `stale`.
- **Выделенная cloud-VM-поверхность в веб-портале** — бэкенд режимов вне этого репо; внутри репо лендинг+оверлей уже честные.
- **Kokoro в диктовке (TtsEngine)** — сознательно не расширялся: движок живёт только в подкасте (`PodcastEngine`).
- **Русские голоса Kokoro** — в Kokoro v1.0 их нет; UI честно предупреждает, для русского остаются `edge`/`system`.