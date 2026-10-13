#!/usr/bin/env bash
#
# main-health.sh — ежедневный отчёт «здоровье main» для rox-one/rox-one.
#
# Считает за окно 24ч/7д по ветке main:
#   1) долю успешных запусков workflow (GitHub Actions);
#   2) медиану/максимум времени до первого зелёного по последним merge-коммитам;
#   3) бюджет тестового долга (scripts/test-baseline.json: knownRed/knownRedCeiling
#      + последний запуск nightly-test-all);
#   4) топ мигающих (flaky) workflow-наборов.
#
# Пишет отчёт в ops/main-health/reports/main-health-YYYYMMDD.md и, если main
# остаётся красным дольше порога (по умолчанию 15 минут), шлёт алерт в Telegram.
#
# Зависимости: bash, gh, curl и стандартные POSIX-утилиты (awk/sort/date).
# Секреты НЕ хардкодятся: токен и чат берутся из env-файла
# (по умолчанию ~/.config/rox/main-health.env).
#
# Запуск:
#   bash ops/main-health/main-health.sh --dry-run     # ничего не отправляет
#   bash ops/main-health/main-health.sh               # боевой прогон
#
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORTS_DIR="${SCRIPT_DIR}/reports"
ENV_FILE="${MAIN_HEALTH_ENV_FILE:-${HOME}/.config/rox/main-health.env}"
ENV_EXAMPLE="${SCRIPT_DIR}/main-health.env.example"
STATE_FILE="${MAIN_HEALTH_STATE_FILE:-${HOME}/.local/state/rox-main-health/red-state.env}"
BASELINE_FILE="${MAIN_HEALTH_BASELINE_FILE:-${SCRIPT_DIR}/../../scripts/test-baseline.json}"
NIGHTLY_WORKFLOW_FILE="nightly-test-all.yml"

REPO="${MAIN_HEALTH_REPO:-rox-one/rox-one}"
BRANCH="${MAIN_HEALTH_BRANCH:-main}"
WINDOW_HOURS="${MAIN_HEALTH_WINDOW_HOURS:-168}"   # 7д; 24ч считается внутри того же набора
RED_THRESHOLD_MIN="${MAIN_HEALTH_RED_THRESHOLD_MIN:-15}"
DRY_RUN=0
ERRORS=""
NOTES=""

usage() {
  cat <<'EOF'
main-health.sh — отчёт о здоровье ветки main + алерт при «main красный >15 минут».

Использование:
  main-health.sh [--dry-run] [--window-hours N] [--repo owner/name] [-h|--help]

Опции:
  --dry-run          Не отправлять Telegram-алерт (только записать намерение в отчёт).
  --window-hours N   Глубина выборки запусков в часах (по умолчанию 168 = 7д).
  --repo owner/name  Репозиторий (по умолчанию rox-one/rox-one).
  -h, --help         Эта справка.

Переменные окружения:
  MAIN_HEALTH_REPO, MAIN_HEALTH_BRANCH, MAIN_HEALTH_WINDOW_HOURS,
  MAIN_HEALTH_RED_THRESHOLD_MIN, MAIN_HEALTH_ENV_FILE, MAIN_HEALTH_STATE_FILE,
  MAIN_HEALTH_BASELINE_FILE, MAIN_HEALTH_GH (путь к бинарю gh, по умолчанию gh).

Секреты (только через env-файл, НЕ коммитятся):
  MAIN_HEALTH_TG_BOT_TOKEN, MAIN_HEALTH_TG_CHAT_ID
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --window-hours) WINDOW_HOURS="${2:-}"; shift ;;
    --window-hours=*) WINDOW_HOURS="${1#*=}" ;;
    --repo) REPO="${2:-}"; shift ;;
    --repo=*) REPO="${1#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "main-health: неизвестный аргумент: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

case "$WINDOW_HOURS" in
  ''|*[!0-9]*) echo "main-health: --window-hours должен быть целым числом" >&2; exit 64 ;;
esac
case "$RED_THRESHOLD_MIN" in
  ''|*[!0-9]*) echo "main-health: MAIN_HEALTH_RED_THRESHOLD_MIN должен быть целым числом" >&2; exit 64 ;;
esac

add_error() { ERRORS="${ERRORS}- $1"$'\n'; }
add_note() { NOTES="${NOTES}- $1"$'\n'; }

mkdir -p "$REPORTS_DIR"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/main-health.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
REPORT_BUF="$TMP/report.md"
: >"$REPORT_BUF"
w() { printf '%s\n' "$*" >>"$REPORT_BUF"; }

NOW_EPOCH="$(date -u +%s)"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REPORT_DATE="$(date -u +%Y%m%d)"
REPORT_FILE="${REPORTS_DIR}/main-health-${REPORT_DATE}.md"

CUT7D_ISO="$(date -u -v-"${WINDOW_HOURS}"H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "-${WINDOW_HOURS} hours" +%Y-%m-%dT%H:%M:%SZ)"
CUT24_ISO="$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '-24 hours' +%Y-%m-%dT%H:%M:%SZ)"

# ── env-файл с секретами ──────────────────────────────────────────────────────
ENV_NOTE=""
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  if ! . "$ENV_FILE" 2>"$TMP/env.err"; then
    add_note "не удалось полностью прочитать env-файл ${ENV_FILE}: $(tr '\n' ' ' <"$TMP/env.err" | sed -E 's/[[:space:]]+$//')"
  fi
  set +a
  ENV_NOTE="загружен ${ENV_FILE}"
elif [ -f "$ENV_EXAMPLE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  ENV_NOTE="НЕ БЫЛ найден — создан из образца ${ENV_EXAMPLE}; заполните токен и chat_id (файл не в git)"
  add_note "env-файл ${ENV_FILE} отсутствовал и был создан из образца; до заполнения значений Telegram-алерты отправляться не будут"
else
  ENV_NOTE="отсутствует (${ENV_FILE}) и образец ${ENV_EXAMPLE} не найден"
  add_note "env-файл ${ENV_FILE} отсутствует; Telegram-алерты недоступны"
fi

# ── зависимости ──────────────────────────────────────────────────────────────
GH_BIN="${MAIN_HEALTH_GH:-gh}"
HAVE_GH=0
if command -v "$GH_BIN" >/dev/null 2>&1; then
  HAVE_GH=1
else
  add_error "${GH_BIN} CLI не найден в PATH — данные GitHub Actions недоступны (отчёт сформирован без метрик)"
fi
if ! command -v curl >/dev/null 2>&1; then
  add_error "curl не найден в PATH — Telegram-алерты недоступны"
fi

# ISO -> epoch (awk, чистая арифметика: без mktime, чтобы работать на stock awk в macOS)
AWK_EP='
# days_from_civil (Howard Hinnant)
function ep(iso,   y,mo,d,h,mi,s, yy,era,yoe,doy,doe){
  if (iso == "") return 0;
  y=substr(iso,1,4)+0; mo=substr(iso,6,2)+0; d=substr(iso,9,2)+0;
  h=substr(iso,12,2)+0; mi=substr(iso,15,2)+0; s=substr(iso,18,2)+0;
  yy = y - ((mo <= 2) ? 1 : 0);
  era = int((yy >= 0 ? yy : yy-399) / 400);
  yoe = yy - era*400;
  doy = int((153 * (mo + ((mo > 2) ? -3 : 9)) + 2) / 5) + d - 1;
  doe = yoe*365 + int(yoe/4) - int(yoe/100) + doy;
  return (era*146097 + doe - 719468) * 86400 + h*3600 + mi*60 + s;
}
'
iso_epoch() { TZ=UTC awk -v t="$1" "$AWK_EP"'BEGIN{print ep(t)}'; }

median() { sort -n | awk '{a[NR]=$1} END{ if(NR==0){print "n/a"} else if(NR%2){print a[(NR+1)/2]} else {printf "%.1f\n",(a[NR/2]+a[NR/2+1])/2} }'; }

# ── сбор данных ──────────────────────────────────────────────────────────────
RUNS_TSV="$TMP/runs.tsv"; : >"$RUNS_TSV"
COMMITS_TSV="$TMP/commits.tsv"; : >"$COMMITS_TSV"
HEAD_SHA=""
HEAD_SHORT=""
NIGHTLY_LINE=""

if [ "$HAVE_GH" -eq 1 ]; then
  CUT_ENC="%3E%3D${CUT7D_ISO}"
  if ! "$GH_BIN" api --paginate "repos/${REPO}/actions/runs?branch=${BRANCH}&per_page=100&created=${CUT_ENC}" \
        --jq '.workflow_runs[] | [.created_at,.updated_at,(.conclusion//""),(.status//""),(.name//""),(.head_sha//""),(.run_attempt|tostring),(.event//""),(.html_url//"")] | @tsv' \
        >"$RUNS_TSV" 2>"$TMP/gh.runs.err"; then
    add_error "gh api actions/runs: $(tr '\n' ' ' <"$TMP/gh.runs.err" | sed -E 's/[[:space:]]+$//' | cut -c1-300)"
    : >"$RUNS_TSV"
  fi

  if ! "$GH_BIN" api "repos/${REPO}/commits?sha=${BRANCH}&per_page=100&since=${CUT7D_ISO}" \
        --jq '.[] | [.sha,((.parents|length)|tostring),.commit.committer.date,(.commit.message|split("\n")[0])] | @tsv' \
        >"$COMMITS_TSV" 2>"$TMP/gh.commits.err"; then
    add_error "gh api commits: $(tr '\n' ' ' <"$TMP/gh.commits.err" | sed -E 's/[[:space:]]+$//' | cut -c1-300)"
    : >"$COMMITS_TSV"
  fi

  if HEAD_SHA="$("$GH_BIN" api "repos/${REPO}/commits/${BRANCH}" --jq '.sha' 2>"$TMP/gh.head.err")"; then
    HEAD_SHORT="${HEAD_SHA:0:8}"
  else
    add_error "gh api commits/${BRANCH}: $(tr '\n' ' ' <"$TMP/gh.head.err" | sed -E 's/[[:space:]]+$//' | cut -c1-300)"
    HEAD_SHA=""
  fi

  NIGHTLY_LINE="$("$GH_BIN" api "repos/${REPO}/actions/workflows/${NIGHTLY_WORKFLOW_FILE}/runs?branch=${BRANCH}&per_page=1" \
      --jq '.workflow_runs[0] | [(.conclusion//.status//"unknown"),.created_at,(.html_url//"")] | @tsv' 2>"$TMP/gh.nightly.err")" \
    || { add_error "gh api ${NIGHTLY_WORKFLOW_FILE}/runs: $(tr '\n' ' ' <"$TMP/gh.nightly.err" | sed -E 's/[[:space:]]+$//' | cut -c1-300)"; NIGHTLY_LINE=""; }
fi

RUNS_COUNT="$(wc -l <"$RUNS_TSV" | tr -d ' ')"
if [ "${RUNS_COUNT:-0}" -ge 1000 ]; then
  add_note "выборка запусков достигла лимита GitHub API в 1000 записей за ${WINDOW_HOURS}ч — метрики посчитаны по последним 1000 запускам"
fi

# ── агрегация: доля успешных запусков (24ч / 7д) ─────────────────────────────
SUM="$TMP/summary.tsv"
TZ=UTC awk -F'\t' -v c24="$(iso_epoch "$CUT24_ISO")" -v c7d="$(iso_epoch "$CUT7D_ISO")" "$AWK_EP"'
  { t=ep($1); if (t < c7d) next;
    total7++;
    in24 = (t >= c24); if (in24) total24++;
    if ($4=="completed") {
      comp7++; if (in24) comp24++;
      if ($3=="success") { suc7++; if(in24) suc24++ }
      else if ($3=="failure"||$3=="timed_out"||$3=="startup_failure") { fail7++; if(in24) fail24++ }
      else if ($3=="cancelled") { canc7++; if(in24) canc24++ }
      else { other7++; if(in24) other24++ }
    }
  }
  END {
    printf "24\t%d\t%d\t%d\t%d\t%d\t%d\n", total24,comp24+0,suc24+0,fail24+0,canc24+0,other24+0;
    printf "7d\t%d\t%d\t%d\t%d\t%d\t%d\n", total7,comp7+0,suc7+0,fail7+0,canc7+0,other7+0;
  }' "$RUNS_TSV" >"$SUM"

# ── агрегация: время до первого зелёного по merge-коммитам ───────────────────
GREEN="$TMP/green.tsv"; : >"$GREEN"
TZ=UTC awk -F'\t' "$AWK_EP"'
  FNR==NR {
    if ($2+0 >= 2) { cdate[$1]=$3; cepoch[$1]=ep($3); order[++n]=$1 }
    next
  }
  {
    sha=$6; if (sha=="") next;
    t=ep($1);
    if (!(sha in t0) || t < t0[sha]) t0[sha]=t;
    if ($3=="success") { u=ep($2); if (!(sha in t1) || u < t1[sha]) t1[sha]=u }
  }
  END {
    max = (n < 20) ? n : 20;
    for (i=1;i<=max;i++) {
      s=order[i];
      if (!(s in t0)) continue;
      mins = (s in t1) ? int((t1[s]-t0[s])/60) : -1;
      printf "%s\t%s\t%s\t%d\t%d\n", s, substr(s,1,8), substr(cdate[s],1,16), cepoch[s], mins;
    }
  }' "$COMMITS_TSV" "$RUNS_TSV" >"$GREEN"

# ── агрегация: мигающие наборы (flaky) ───────────────────────────────────────
# Мигающим считаем workflow, у которого (а) был повтор запуска (run_attempt > 1)
# и/или (б) на одном коммите нашлись и успешный, и провальный запуски.
FLAKY="$TMP/flaky.tsv"
TZ=UTC awk -F'\t' '
  {
    w=$5;
    if ($7+0 > 1) { RET[w]++; if ($3=="success") REC[w]++ }
    k=$5"\t"$6;
    if ($3=="success") S[k]++; else if ($3=="failure") F[k]++;
  }
  END {
    for (k in S) if (F[k] > 0) { split(k,a,"\t"); FLIP[a[1]]++ }
    for (w in RET) printf "%s\t%d\t%d\t%d\n", w, RET[w], REC[w]+0, FLIP[w]+0;
    for (w in FLIP) if (!(w in RET)) printf "%s\t0\t0\t%d\n", w, FLIP[w];
  }' "$RUNS_TSV" | sort -t$'\t' -k2,2nr -k4,4nr >"$FLAKY"

# ── статус main (красный > порога?) ──────────────────────────────────────────
# «main красный» = у коммита HEAD на ветке есть хотя бы один завершившийся запуск
# workflow с провалом (failure/timed_out/startup_failure). Длительность считается
# от времени первого провала этого коммита; состояние хранится между запусками,
# чтобы не слать повторный алерт за один и тот же коммит.
RED_STATUS="нет данных"; RED_SINCE_EPOCH=0; RED_RUNS=""; RED_URL=""
if [ -n "$HEAD_SHA" ] && [ -s "$RUNS_TSV" ]; then
  TZ=UTC awk -F'\t' -v sha="$HEAD_SHA" "$AWK_EP"'
    $6 != sha { next }
    ($3=="failure"||$3=="timed_out"||$3=="startup_failure") {
      u=ep($2); if (min==0 || u<min) min=u;
      names = names (names?", ":"") $5;
      if (url=="") url=$9;
    }
    END { if (names!="") printf "red\t%d\t%s\t%s\n", min, names, url; else print "green\t0\t\t" }' \
    "$RUNS_TSV" >"$TMP/red.txt"
  IFS=$'\t' read -r RED_STATUS RED_SINCE_EPOCH RED_RUNS RED_URL <"$TMP/red.txt"
fi

fmt_epoch() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }

# предыдущее состояние
ST_SHA=""; ST_SINCE=0; ST_ALERTED=0
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE" 2>/dev/null || true
fi

ALERT_ACTION="не требовался"; ALERT_DETAIL=""
NEXT_SHA="$HEAD_SHA"; NEXT_SINCE=0; NEXT_ALERTED=0

if [ "$RED_STATUS" = "red" ]; then
  # длительность берём как min(первый провал HEAD, ранее зафиксированный since)
  if [ "$ST_SHA" = "$HEAD_SHA" ] && [ "${ST_SINCE:-0}" -gt 0 ]; then
    NEXT_SINCE="$ST_SINCE"; NEXT_ALERTED="${ST_ALERTED:-0}"
  else
    NEXT_SINCE="$RED_SINCE_EPOCH"; NEXT_ALERTED=0
  fi
  RED_MINUTES=$(( (NOW_EPOCH - NEXT_SINCE) / 60 ))
  if [ "$RED_MINUTES" -gt "$RED_THRESHOLD_MIN" ]; then
    if [ "$NEXT_ALERTED" -eq 1 ]; then
      ALERT_ACTION="уже отправлялся ранее для этого коммита"
    else
      MSG="🔴 main красный ${RED_MINUTES} мин (порог ${RED_THRESHOLD_MIN}): ${REPO}@${HEAD_SHORT}. Падают: ${RED_RUNS}. ${RED_URL}"
      if [ "$DRY_RUN" -eq 1 ]; then
        ALERT_ACTION="dry-run: алерт НЕ отправлен"
        ALERT_DETAIL="$MSG"
      elif [ -z "${MAIN_HEALTH_TG_BOT_TOKEN:-}" ] || [ -z "${MAIN_HEALTH_TG_CHAT_ID:-}" ]; then
        ALERT_ACTION="пропущен: нет MAIN_HEALTH_TG_BOT_TOKEN/MAIN_HEALTH_TG_CHAT_ID"
        add_error "не отправлен Telegram-алерт (${RED_MINUTES} мин красный): не заданы токен/chat_id в ${ENV_FILE}"
      elif command -v curl >/dev/null 2>&1; then
        RESP="$(curl -s "https://api.telegram.org/bot${MAIN_HEALTH_TG_BOT_TOKEN}/sendMessage" \
          -d chat_id="${MAIN_HEALTH_TG_CHAT_ID}" -d text="$MSG" 2>&1 || true)"
        case "$RESP" in
          *'"ok":true'*) ALERT_ACTION="отправлен" ;;
          *) ALERT_ACTION="ошибка отправки"; ALERT_DETAIL="$(printf '%s' "$RESP" | tr '\n' ' ' | sed -E 's/[[:space:]]+$//' | cut -c1-300)"
             add_error "Telegram sendMessage вернул ошибку: ${ALERT_DETAIL}" ;;
        esac
      else
        ALERT_ACTION="пропущен: curl недоступен"
      fi
      NEXT_ALERTED=1
    fi
  fi
  NEXT_SHA="$HEAD_SHA"
else
  RED_MINUTES=0
  NEXT_SHA="$HEAD_SHA"; NEXT_SINCE=0; NEXT_ALERTED=0
fi

if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$(dirname "$STATE_FILE")"
  {
    printf 'ST_SHA=%q\n' "${NEXT_SHA:-}"
    printf 'ST_SINCE=%s\n' "${NEXT_SINCE:-0}"
    printf 'ST_ALERTED=%s\n' "${NEXT_ALERTED:-0}"
  } >"$STATE_FILE"
fi

# для отчёта: откуда считаем «красный с»
RED_SINCE_ISO=""
if [ "$RED_STATUS" = "red" ] && [ "${NEXT_SINCE:-0}" -gt 0 ]; then
  RED_SINCE_ISO="$(fmt_epoch "$NEXT_SINCE")"
fi
RED_MINUTES="${RED_MINUTES:-0}"

# ── бюджет тестового долга ───────────────────────────────────────────────────
DEBT_KNOWN="n/a"; DEBT_CEIL="n/a"; DEBT_VERDICT="n/a"
if [ -f "$BASELINE_FILE" ]; then
  DEBT_KNOWN="$(awk '/"knownRed"[ \t]*:[ \t]*\[/{f=1;next} f&&/\]/{f=0} f&&/"/{c++} END{print c+0}' "$BASELINE_FILE")"
  DEBT_CEIL="$(awk -F: '/"knownRedCeiling"/{gsub(/[^0-9]/,"",$2); print $2}' "$BASELINE_FILE")"
  if [ -n "$DEBT_CEIL" ] && [ "$DEBT_KNOWN" != "n/a" ]; then
    if [ "$DEBT_KNOWN" -gt "$DEBT_CEIL" ]; then DEBT_VERDICT="ПРЕВЫШЕНИЕ потолка"; else DEBT_VERDICT="в пределах потолка"; fi
  fi
else
  add_error "не найден файл базовой линии ${BASELINE_FILE} — бюджет тестового долга недоступен"
fi

# ── генерация отчёта ─────────────────────────────────────────────────────────
w "# Здоровье main — ${REPO}"
w ""
w "- Сформирован: ${NOW_ISO} (UTC)"
w "- Ветка: \`${BRANCH}\`${HEAD_SHORT:+ @ \`${HEAD_SHORT}\`}"
w "- Окно выборки: ${WINDOW_HOURS}ч (24ч считается внутри него)"
w "- Режим: $([ "$DRY_RUN" -eq 1 ] && echo '**dry-run** (алерты не отправляются)' || echo 'боевой')"
w "- Скрипт: \`ops/main-health/main-health.sh\`"
w "- env-файл: ${ENV_NOTE}"
w ""

w "## 1. Доля успешных запусков workflow"
w ""
w "| Окно | Запусков | Завершено | Успех | Провал | Отменено | Прочее | Успех, % | Успех без отмен, % |"
w "|---|---|---|---|---|---|---|---|---|"
while IFS=$'\t' read -r win total comp suc fail canc other; do
  if [ "${comp:-0}" -gt 0 ]; then
    pct="$(awk -v s="$suc" -v c="$comp" 'BEGIN{printf "%.0f%%", 100*s/c}')"
    nc=$(( comp - ${canc:-0} ))
    if [ "$nc" -gt 0 ]; then pct2="$(awk -v s="$suc" -v c="$nc" 'BEGIN{printf "%.0f%%", 100*s/c}')"; else pct2="n/a"; fi
  else
    pct="n/a"; pct2="n/a"
  fi
  w "| ${win} | ${total} | ${comp} | ${suc} | ${fail} | ${canc} | ${other} | ${pct} | ${pct2} |"
done <"$SUM"
w ""
w "> «Успех, %» = успешные / завершённые; «Успех без отмен, %» дополнительно исключает"
w "> отменённые запуски (в основном concurrency-отмены), которые не являются провалом."
w ""

w "## 2. Время до первого зелёного (последние merge-коммиты)"
w ""
w "| Коммит | Merge (UTC) | До зелёного, мин |"
w "|---|---|---|"
for win in 24 7d; do
  if [ "$win" = "24" ]; then cut="$CUT24_ISO"; else cut="$CUT7D_ISO"; fi
  cutep="$(iso_epoch "$cut")"
  vals="$TMP/green.$win"; : >"$vals"
  while IFS=$'\t' read -r sha short date ep mins; do
    [ -z "${sha:-}" ] && continue
    [ "$ep" -lt "$cutep" ] && continue
    if [ "$mins" -ge 0 ]; then
      w "| \`${short}\` | ${date} | ${mins} |"
      printf '%s\n' "$mins" >>"$vals"
    else
      w "| \`${short}\` | ${date} | не позеленел |"
    fi
  done <"$GREEN"
  cnt="$(wc -l <"$vals" | tr -d ' ')"
  if [ "$cnt" -gt 0 ]; then
    med="$(median <"$vals")"; mx="$(sort -n "$vals" | tail -1)"
    w "| **Итого (${win})** | merge-коммитов с зелёным: ${cnt} | **медиана ${med} / макс ${mx}** |"
  else
    w "| **Итого (${win})** | нет данных | — |"
  fi
done
w ""

w "## 3. Бюджет тестового долга"
w ""
w "- \`scripts/test-baseline.json\`: knownRed = **${DEBT_KNOWN}**, knownRedCeiling = **${DEBT_CEIL}** — ${DEBT_VERDICT}"
if [ -n "${NIGHTLY_LINE:-}" ]; then
  IFS=$'\t' read -r nconc ndate nurl <<<"$NIGHTLY_LINE"
  w "- Последний \`${NIGHTLY_WORKFLOW_FILE}\`: **${nconc}** @ ${ndate}${nurl:+ — ${nurl}}"
else
  w "- Последний \`${NIGHTLY_WORKFLOW_FILE}\`: нет данных"
fi
w ""

w "## 4. Топ мигающих (flaky) наборов"
w ""
if [ -s "$FLAKY" ]; then
  w "Мигающим считается workflow с повтором запуска (\`run_attempt > 1\`) и/или с"
  w "разными исходами (успех и провал) на одном и том же коммите."
  w ""
  w "| Workflow | Повторов запуска | из них зелёных | Флипов на коммите |"
  w "|---|---|---|---|"
  head -5 "$FLAKY" | while IFS=$'\t' read -r name ret rec flip; do
    w "| ${name} | ${ret} | ${rec} | ${flip} |"
  done
else
  w "Нет данных: за окно ${WINDOW_HOURS}ч не найдено ни повторов запуска (\`run_attempt > 1\`), ни workflow с разными исходами на одном коммите."
fi
w ""

w "## 5. Статус main и алерт"
w ""
if [ -z "$HEAD_SHA" ]; then
  w "- HEAD: нет данных (gh недоступен или API не ответил)"
else
  case "$RED_STATUS" in
    red)
      w "- HEAD \`${HEAD_SHORT}\`: **КРАСНЫЙ**"
      w "- Красный с: ${RED_SINCE_ISO} (${RED_MINUTES} мин подряд)"
      w "- Падающие наборы: ${RED_RUNS}"
      [ -n "$RED_URL" ] && w "- Последний провал: ${RED_URL}"
      ;;
    green) w "- HEAD \`${HEAD_SHORT}\`: зелёный (провалов среди запусков этого коммита нет)" ;;
    *)     w "- HEAD: ${RED_STATUS}" ;;
  esac
fi
w "- Порог алерта: ${RED_THRESHOLD_MIN} мин"
w "- Действие: ${ALERT_ACTION}"
[ -n "$ALERT_DETAIL" ] && w "- Детали: ${ALERT_DETAIL}"
w ""

w "## Замечания"
w ""
if [ -n "$NOTES" ]; then
  printf '%s' "$NOTES" | while IFS= read -r line; do [ -n "$line" ] && w "${line}"; done
else
  w "нет"
fi
w ""

w "## Ошибки"
w ""
if [ -n "$ERRORS" ]; then
  printf '%s' "$ERRORS" | while IFS= read -r line; do [ -n "$line" ] && w "${line}"; done
else
  w "нет"
fi

mv "$REPORT_BUF" "$REPORT_FILE"
echo "main-health: отчёт записан → ${REPORT_FILE}"

if [ -n "$ERRORS" ]; then
  echo "main-health: завершено с замечаниями:" >&2
  printf '%s' "$ERRORS" >&2
  exit 1
fi
exit 0
