/* Rox workstream whiteboard — engine v2.
 * Ten directions, thirty groups, sixty tasks, fourteen parked items, five hiring
 * anchors, seven guilds and one explainer card. Data files:
 * ./task-board-v2.json and ./open-roles-summary-20261122.json.
 * No external libraries, no build step. Public API: window.__whiteboard.
 */
(function () {
  'use strict';

  if (window.__whiteboard && window.__whiteboard.version === 2) return;

  var VERSION = 2;
  var STORAGE_KEY = 'rox-whiteboard:v3';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MIN_SCALE = 0.1;
  var MAX_SCALE = 2.2;
  var READABLE_SCALE = 0.7;
  var STRUCTURE_LABEL_SCALE = 1.05;
  var DRAG_THRESHOLD = 4;

  var BOARD_URL = './task-board-v2.json';
  var ROLES_URL = './open-roles-summary-20261122.json';

  /* Layout contract: division frames, anchor row, guild row, parked grid. */
  var L = {
    anchors: { x0: 80, y: 40, w: 280, h: 110, step: 300 },
    divisions: { x0: 80, y: 260, w: 760, h: 1480, step: 800 },
    groups: { dx: 20, dy: 210, w: 720, h: 400, step: 420 },
    tasks: { dx: 14, dy: 100, w: 692, h: 158, step: 168 },
    guilds: { x0: 80, y: 1780, w: 360, h: 120, step: 380 },
    parked: { x0: 80, y: 2120, w: 320, h: 120, gap: 16, cols: 7 }
  };

  var WORLD = { w: 8240, h: 2400 };

  var ACCENTS = {
    research: '#2f5bea',
    'applied-ai': '#0f8060',
    engineering: '#a86400',
    product: '#6b4fd8',
    cloud: '#0b6d8f',
    security: '#b42318',
    enterprise: '#8d3f8a',
    gtm: '#c2410c',
    ecosystem: '#4d7c0f',
    hardware: '#475569'
  };

  var ACCENT_FALLBACK = '#5a6573';
  var ACCENT_PARKED = '#b9c1cc';
  var ACCENT_ANCHOR = '#39414c';
  var ACCENT_GUILD = '#4a5b6e';
  var ACCENT_GUILD_INFO = '#8a94a6';

  var STATUS_RU = { ready: 'готова', proposed: 'предложена' };

  var TYPE_RU = {
    division: 'Направление',
    group: 'Группа',
    task: 'Задача',
    parked: 'Отложенная задача',
    anchor: 'Якорь найма',
    guild: 'Гильдия',
    'guild-info': 'Справка о гильдиях'
  };

  var TYPE_Z = { division: 1, group: 2, task: 3, parked: 2, anchor: 2, guild: 2, 'guild-info': 2 };

  var LAYER_IDS = {
    structure: 'toggle-structure',
    dependency: 'toggle-dependencies',
    handoff: 'toggle-handoffs',
    market: 'toggle-market',
    labels: 'toggle-labels'
  };

  var LAYER_TITLES = {
    structure: 'Структура: входит в, содержит',
    dependency: 'Зависимости: зависит от',
    handoff: 'Передачи: передаёт результат',
    market: 'Спрос: подтверждает спрос',
    labels: 'Подписи связей'
  };

  var GUILD_INFO = {
    title: 'Что такое гильдия',
    short: 'Добровольное сообщество практики поперёк направлений: владеет форматами и проверками, а не кодом.',
    what: 'Гильдия — добровольное сообщество практики поперёк направлений, а не второй отдел и не ещё один начальник. В неё вступают по интересу к теме, а не по разнарядке.',
    time: 'На гильдию уходит 10–20 % рабочего времени; остальное время человек работает в своём направлении.',
    owns: 'Гильдия владеет форматами и проверками: шаблон заметки, набор случаев проверки, правила разбора. Код за направления она не пишет.',
    output: 'Одна гильдия выдаёт один результат за квартал — заметку, проверку или опубликованный формат.',
    cadence: 'Раз в месяц — встреча на 60–90 минут. Раз в две недели — короткий разбор на 30–45 минут. Раз в квартал — большой обзор и публичный выход. Раз в неделю — только срочная тема на 30–45 минут и не больше трёх встреч подряд; в этой карте ни одна гильдия так не собирается.',
    sunset: 'Если два квартала подряд на выходе пусто, гильдию распускают.'
  };

  var els = {};
  var records = [];
  var byId = Object.create(null);
  var edges = [];
  var board = null;
  var roles = null;
  var drag = null;
  var minimapDrag = false;
  var saveTimer = null;
  var toastTimer = null;
  var pathsLayer = null;
  var labelsLayer = null;

  var state = {
    ready: false,
    error: null,
    camera: { s: READABLE_SCALE, tx: 0, ty: 0 },
    positions: Object.create(null),
    selectedId: null,
    focusDivisionId: null,
    locked: false,
    layers: { structure: true, dependency: true, handoff: true, market: false, labels: true },
    layersOpen: true,
    search: '',
    helpOpen: false
  };

  /* ---------------------------------------------------------------- utils */

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function rich(value) {
    return esc(value).replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function slugify(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function num(n) { return Math.round(n * 10) / 10; }
  function num3(n) { return Math.round(n * 1000) / 1000; }
  function num5(n) { return Math.round(n * 100000) / 100000; }
  function two(n) { return n < 10 ? '0' + n : String(n); }

  function plural(n, forms) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function norm(value) {
    var v = String(value == null ? '' : value).trim().toLowerCase();
    if (v === '' || v === 'all' || v === 'все' || v === '*') return '';
    return v;
  }

  function normStatus(value) {
    var v = norm(value);
    if (!v) return '';
    if (v.indexOf('готов') !== -1 || v === 'ready') return 'ready';
    if (v.indexOf('предлож') !== -1 || v === 'proposed') return 'proposed';
    return v;
  }

  function statusText(status) { return STATUS_RU[status] || String(status || ''); }

  function waveMatches(taskWave, value) {
    if (String(taskWave) === value) return true;
    var digits = String(value).replace(/\D+/g, '');
    return digits !== '' && digits === String(taskWave);
  }

  function on(el, event, fn, opts) {
    if (el && el.addEventListener) el.addEventListener(event, fn, opts);
  }

  function setClass(el, name, active) {
    if (!el || !el.classList) return;
    el.classList.toggle(name, !!active);
  }

  function setPressed(el, pressed, title) {
    if (!el) return;
    el.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    setClass(el, 'is-active', pressed);
    if (title) el.title = title;
  }

  function accentFor(slug) { return ACCENTS[slug] || ACCENT_FALLBACK; }

  function isCheckbox(el) { return !!el && String(el.tagName).toLowerCase() === 'input'; }

  function controlOn(el, fallback) {
    if (!el) return fallback;
    if (isCheckbox(el)) return !!el.checked;
    var pressed = el.getAttribute('aria-pressed');
    if (pressed === null) return fallback;
    return pressed === 'true';
  }

  function compact(value, limit) {
    var s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (limit && s.length > limit) s = s.slice(0, limit - 1).trim() + '…';
    return s;
  }

  /* ---------------------------------------------------------------- chrome fallback */

  function ensureChrome() {
    var app = $('app') || document.body;
    var stage = $('stage');
    var topbar = $('topbar');

    if (!$('rail')) {
      var rail = document.createElement('aside');
      rail.id = 'rail';
      rail.className = 'rail';
      rail.setAttribute('data-fallback', '1');
      rail.setAttribute('aria-label', 'Направления');
      rail.setAttribute('style', 'position:absolute;left:0;top:0;bottom:0;width:236px;z-index:30;overflow:auto;background:#fbfbfc;border-right:1px solid #e2e5ea;padding:8px;box-sizing:border-box');
      rail.innerHTML =
        '<div class="rail__head">' +
          '<span class="rail__title">Направления</span>' +
          '<button id="rail-toggle" class="btn btn--icon rail__toggle" type="button" aria-expanded="true" aria-controls="rail-list" title="Свернуть список направлений">‹</button>' +
        '</div>' +
        '<div id="rail-list" class="rail__list" role="navigation" aria-label="Список направлений"></div>';
      if (stage) stage.appendChild(rail); else app.appendChild(rail);
    }

    if ($('rail') && !$('rail-list')) {
      var list = document.createElement('div');
      list.id = 'rail-list';
      list.className = 'rail__list';
      $('rail').appendChild(list);
    }
    if ($('rail') && !$('rail-toggle')) {
      var toggle = document.createElement('button');
      toggle.id = 'rail-toggle';
      toggle.type = 'button';
      toggle.className = 'btn btn--icon rail__toggle';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-controls', 'rail-list');
      toggle.title = 'Свернуть список направлений';
      toggle.textContent = '‹';
      $('rail').appendChild(toggle);
    }

    if (!$('minimap')) {
      var minimap = document.createElement('div');
      minimap.id = 'minimap';
      minimap.className = 'minimap';
      minimap.setAttribute('data-fallback', '1');
      minimap.setAttribute('aria-label', 'Общий вид доски');
      minimap.setAttribute('style', 'position:absolute;right:14px;bottom:44px;z-index:25;width:260px;height:150px;background:rgba(255,255,255,.94);border:1px solid #dfe3ea;border-radius:10px;box-shadow:0 6px 18px rgba(22,26,31,.08);overflow:hidden');
      (stage || app).appendChild(minimap);
    }
    if ($('minimap') && !$('minimap-canvas') && String($('minimap').tagName).toLowerCase() !== 'canvas') {
      var canvas = document.createElement('canvas');
      canvas.id = 'minimap-canvas';
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      $('minimap').appendChild(canvas);
    }

    if (!$('layers')) {
      var layers = document.createElement('div');
      layers.id = 'layers';
      layers.className = 'layers';
      layers.setAttribute('data-fallback', '1');
      layers.setAttribute('role', 'group');
      layers.setAttribute('aria-label', 'Слои связей');
      layers.setAttribute('style', 'position:absolute;right:14px;top:64px;z-index:40;background:#fff;border:1px solid #dfe3ea;border-radius:10px;padding:8px 10px;font:12px/1.5 ui-monospace,monospace;box-shadow:0 6px 18px rgba(22,26,31,.08)');
      (topbar || app).appendChild(layers);
    }
    ensureLayerControls();

    if (!$('toggle-layers')) {
      var layersBtn = document.createElement('button');
      layersBtn.id = 'toggle-layers';
      layersBtn.type = 'button';
      layersBtn.className = 'btn';
      layersBtn.setAttribute('aria-pressed', 'true');
      layersBtn.textContent = 'Слои';
      layersBtn.title = 'Показать или скрыть панель слоёв';
      var actions = topbar ? topbar.querySelector('.actions') : null;
      (actions || topbar || app).appendChild(layersBtn);
    }
  }

  function ensureLayerControls() {
    var panel = $('layers');
    if (!panel) return;
    var order = ['structure', 'dependency', 'handoff', 'market', 'labels'];
    order.forEach(function (key) {
      if ($(LAYER_IDS[key])) return;
      var label = document.createElement('label');
      label.className = 'layers__item';
      label.style.display = 'flex';
      label.style.gap = '6px';
      label.style.alignItems = 'center';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.id = LAYER_IDS[key];
      input.checked = !!state.layers[key];
      var text = document.createElement('span');
      text.textContent = LAYER_TITLES[key];
      label.appendChild(input);
      label.appendChild(text);
      panel.appendChild(label);
    });
  }

  /* ---------------------------------------------------------------- boot */

  function boot() {
    if (window.__whiteboard && window.__whiteboard.version === 2) return;

    ensureChrome();

    els = {
      app: $('app'),
      topbar: $('topbar'),
      search: $('search'),
      divisionFilter: $('division-filter'),
      waveFilter: $('wave-filter'),
      statusFilter: $('status-filter'),
      fit: $('fit'),
      zoomOut: $('zoom-out'),
      zoomLabel: $('zoom-label'),
      zoomIn: $('zoom-in'),
      toggleEdges: $('toggle-edges'),
      toggleLayers: $('toggle-layers'),
      layers: $('layers'),
      rail: $('rail'),
      railList: $('rail-list'),
      railToggle: $('rail-toggle'),
      minimap: $('minimap'),
      minimapCanvas: $('minimap-canvas') ||
        ($('minimap') && String($('minimap').tagName).toLowerCase() === 'canvas' ? $('minimap') : null),
      lock: $('lock'),
      reset: $('reset'),
      download: $('download'),
      print: $('print'),
      help: $('help'),
      helpOverlay: $('help-overlay'),
      stage: $('stage'),
      world: $('world'),
      edges: $('edges'),
      nodes: $('nodes'),
      legend: $('legend'),
      statusbar: $('statusbar'),
      countLabel: $('count-label'),
      hint: $('hint'),
      details: $('details'),
      detailsClose: $('details-close'),
      detailsBody: $('details-body'),
      toast: $('toast')
    };

    if (!els.stage || !els.world || !els.edges || !els.nodes) {
      if (els.toast) {
        els.toast.textContent = 'Разметка страницы не найдена: нужны #stage, #world, #edges и #nodes.';
        els.toast.hidden = false;
      }
      return;
    }

    state.layersOpen = !(els.layers && els.layers.hidden);

    exposeApi();
    wireUi();
    restoreChrome();
    loadData();
  }

  function restoreChrome() {
    if (els.hint && !els.hint.textContent.trim()) {
      els.hint.textContent = 'Колесо — масштаб · фон — сдвиг · карточка — детали · / — поиск · F — вписать';
    }
    if (els.countLabel) els.countLabel.textContent = 'Загрузка доски…';
    if (els.zoomLabel) els.zoomLabel.textContent = Math.round(state.camera.s * 100) + '%';
    if (els.details) {
      els.details.hidden = true;
      setClass(els.details, 'is-open', false);
    }
    if (els.helpOverlay) {
      els.helpOverlay.hidden = true;
      setClass(els.helpOverlay, 'is-open', false);
    }
    if (els.toast) els.toast.hidden = true;
    if (els.stage) els.stage.style.touchAction = 'none';
    if (els.world) els.world.style.transformOrigin = '0 0';
    if (els.edges) {
      els.edges.style.overflow = 'visible';
      /* Division frames are z 1, group frames z 2, cards z 3. Edges belong
         between them so hierarchy and dependency lines stay visible. */
      els.edges.style.zIndex = '3';
    }
    setPressed(els.lock, state.locked, 'Запретить перенос карточек (L)');
    setClass(els.stage, 'is-locked', state.locked);
    if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches && els.rail && !els.rail.classList.contains('is-collapsed')) {
      toggleRail();
    }
    syncLayersPanel();
    syncLayerControls();
  }

  function exposeApi() {
    window.__whiteboard = {
      version: VERSION,
      getState: getState,
      fit: fit,
      focusDivision: focusDivision,
      select: select,
      reset: resetLayout,
      zoom: zoomBy,
      focusRail: focusRail,
      get nodes() { return nodesSnapshot(); },
      get edges() {
        return edges.map(function (edge) {
          return { from: edge.from, to: edge.to, family: edge.family, label: edge.label };
        });
      },
      get board() { return board; }
    };
  }

  /* ---------------------------------------------------------------- data */

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status) + ' для ' + url);
      return res.json();
    });
  }

  function loadData() {
    var rolesMissing = false;

    Promise.all([
      fetchJson(BOARD_URL),
      fetchJson(ROLES_URL).catch(function (err) {
        rolesMissing = true;
        if (window.console && console.warn) console.warn('Сводка вакансий не загрузилась:', err);
        return null;
      })
    ]).then(function (result) {
      board = result[0];
      roles = result[1];
      if (!board || !Array.isArray(board.divisions) || !Array.isArray(board.tasks)) {
        throw new Error('task-board-v2.json имеет неожиданную структуру');
      }
      build();
      state.ready = true;
      state.error = null;
      if (rolesMissing) {
        toast('Сводка вакансий не загрузилась: у якорей будут только названия');
      } else {
        toast('Доска собрана: 10 направлений, 60 задач');
      }
    }).catch(function (err) {
      state.ready = false;
      state.error = 'fetch-failed';
      if (window.console && console.error) console.error('Доска не загрузилась:', err);
      showLoadError(err && err.message ? err.message : '');
      if (els.countLabel) els.countLabel.textContent = 'Нет данных';
      toast('Нужен локальный сервер');
    });
  }

  function showLoadError(detail) {
    if (els.nodes) {
      els.nodes.textContent = '';
      var box = document.createElement('div');
      box.className = 'empty-state';
      box.setAttribute('style', 'position:absolute;left:40px;top:40px;max-width:640px;padding:22px 24px;background:#fff;border:1px solid #dfe3ea;border-radius:12px;font:14px/1.6 system-ui,-apple-system,sans-serif;color:#161a1f;box-shadow:0 10px 30px rgba(22,26,31,.08)');
      box.innerHTML =
        '<h2 style="margin:0 0 10px;font-size:18px">Не удалось загрузить данные доски</h2>' +
        '<p style="margin:0 0 10px">Браузер открыл страницу без локального сервера и не отдаёт файлы <code>task-board-v2.json</code> и <code>open-roles-summary-20261122.json</code>.</p>' +
        '<p style="margin:0 0 6px">Запустите сервер из корня репозитория:</p>' +
        '<pre style="margin:0 0 12px;padding:10px 12px;background:#f4f6f9;border-radius:8px;overflow:auto"><code>python3 docs/workstreams/serve_whiteboard.py</code></pre>' +
        '<p style="margin:0 0 6px">и откройте адрес:</p>' +
        '<pre style="margin:0 0 12px;padding:10px 12px;background:#f4f6f9;border-radius:8px;overflow:auto"><code>http://127.0.0.1:8799/whiteboard.html</code></pre>' +
        '<p style="margin:0;color:#6a7482">После запуска сервера обновите страницу.</p>' +
        (detail ? '<p style="margin:12px 0 0;color:#8a94a6;font-size:12px">' + esc(detail) + '</p>' : '');
      els.nodes.appendChild(box);
    }
    if (els.edges) els.edges.textContent = '';
    records = [];
    byId = Object.create(null);
    edges = [];
    pathsLayer = null;
    labelsLayer = null;
    if (els.zoomLabel) els.zoomLabel.textContent = '100%';
    if (els.railList) els.railList.textContent = '';
    drawMinimap();
  }

  /* ---------------------------------------------------------------- build */

  function build() {
    records = [];
    byId = Object.create(null);
    edges = [];
    pathsLayer = null;
    labelsLayer = null;
    drag = null;

    els.nodes.textContent = '';
    els.edges.textContent = '';

    ensureEdgeLayers();
    populateFilters();
    ensureLegendTerms();
    state.search = els.search && els.search.value ? els.search.value : '';

    var tasks = board.tasks.slice();

    board.divisions.forEach(function (division, index) {
      var slug = division.slug || slugify(division.name);
      var divId = 'div-' + slug;
      var accent = accentFor(slug);
      var dx = L.divisions.x0 + index * L.divisions.step;
      var dy = L.divisions.y;
      var divTasks = tasks.filter(function (task) { return task.division === division.name; });
      var mission = division.mission || '';

      var divRec = addNode({
        id: divId,
        type: 'division',
        x: dx, y: dy, w: L.divisions.w, h: L.divisions.h,
        idText: two(index + 1),
        title: division.name,
        badge: divTasks.length + ' ' + plural(divTasks.length, ['задача', 'задачи', 'задач']),
        meta: division.groups.length + ' ' + plural(division.groups.length, ['группа', 'группы', 'групп']) +
          ' · ' + divTasks.length + ' ' + plural(divTasks.length, ['задача', 'задачи', 'задач']),
        body: mission,
        accent: accent,
        divisionSlug: slug,
        divisionName: division.name,
        data: division,
        searchExtra: [division.nameEn, division.slug, mission, division.groups.join(' ')].join(' '),
        label: 'Направление «' + division.name + '». ' + compact(mission, 180)
      });

      division.groups.forEach(function (groupName, groupIndex) {
        var gx = dx + L.groups.dx;
        var gy = dy + L.groups.dy + groupIndex * L.groups.step;
        var gTasks = divTasks.filter(function (task) { return task.group === groupName; });
        var group = (board.groups || []).filter(function (item) {
          return item.name === groupName && item.division === division.name;
        })[0] || { name: groupName, nameEn: '', division: division.name, outcome: groupName };

        var groupRec = addNode({
          id: 'group-' + slug + '-' + (groupIndex + 1),
          type: 'group',
          x: gx, y: gy, w: L.groups.w, h: L.groups.h,
          idText: two(index + 1) + '.' + (groupIndex + 1),
          title: groupName,
          badge: gTasks.length + ' ' + plural(gTasks.length, ['задача', 'задачи', 'задач']),
          meta: group.outcome || '',
          body: '',
          accent: accent,
          parentId: divRec.id,
          divisionSlug: slug,
          divisionName: division.name,
          groupName: groupName,
          data: group,
          searchExtra: [group.nameEn, groupName, group.outcome].join(' '),
          label: 'Группа «' + groupName + '» направления «' + division.name + '». ' + compact(group.outcome, 160)
        });

        gTasks.forEach(function (task, taskIndex) {
          addNode({
            id: 'task-' + task.id,
            type: 'task',
            x: gx + L.tasks.dx,
            y: gy + L.tasks.dy + taskIndex * L.tasks.step,
            w: L.tasks.w,
            h: L.tasks.h,
            idText: task.id,
            title: task.title,
            badge: 'В' + task.wave + ' · ' + statusText(task.status),
            meta: (task.roles || []).join(' · '),
            body: task.whyNow || '',
            accent: accent,
            parentId: groupRec.id,
            divisionSlug: slug,
            divisionName: division.name,
            groupName: groupName,
            status: task.status,
            wave: task.wave,
            data: task,
            searchExtra: [
              task.whyNow, (task.roles || []).join(' '), task.acceptance,
              (task.acceptanceChecks || []).join(' '), (task.dependsOn || []).join(' '), task.source
            ].join(' '),
            label: 'Задача ' + task.id + ' «' + task.title + '». Волна ' + task.wave + ', ' + statusText(task.status) + '.'
          });
        });
      });
    });

    buildAnchorNodes();
    buildGuildNodes();
    buildParkedNodes();

    restoreSaved();

    buildEdges();
    syncLockClasses();
    buildRail();
    syncLayerControls();
    syncLayersPanel();
    applyView();

    if (savedCamera()) {
      applyCamera();
    } else {
      initialView();
    }

    drawMinimap();
    setStatusMeta();
  }

  function buildAnchorNodes() {
    var names = [];
    (board.anchorLinks || []).forEach(function (link) {
      if (names.indexOf(link.anchor) === -1) names.push(link.anchor);
    });

    names.forEach(function (name, index) {
      var company = roles && roles.companies ? roles.companies[name] : null;
      var links = (board.anchorLinks || []).filter(function (link) { return link.anchor === name; });
      var total = company && company.total != null ? company.total : null;
      var last30 = company && company.last30 != null ? company.last30 : null;
      var deptLine = topDepartments(company, 2).map(function (item) {
        return item[0] + ' ' + item[1];
      }).join(' · ');

      addNode({
        id: 'anchor-' + slugify(name),
        type: 'anchor',
        x: L.anchors.x0 + index * L.anchors.step,
        y: L.anchors.y,
        w: L.anchors.w,
        h: L.anchors.h,
        idText: 'Якорь',
        title: name,
        badge: total != null ? String(total) : '',
        meta: total != null
          ? 'вакансий ' + total + (last30 != null ? ' · за 30 дней ' + last30 : '')
          : 'сводка не загрузилась',
        body: '',
        accent: ACCENT_ANCHOR,
        data: { name: name, links: links },
        searchExtra: [name, deptLine, links.map(function (l) { return l.division; }).join(' ')].join(' '),
        label: 'Якорь найма «' + name + '»' + (total != null ? ': ' + total + ' вакансий' : '') + '.'
      });
    });
  }

  function buildGuildNodes() {
    addNode({
      id: 'guild-info',
      type: 'guild-info',
      x: L.guilds.x0,
      y: L.guilds.y,
      w: L.guilds.w,
      h: L.guilds.h,
      idText: 'Справка',
      title: GUILD_INFO.title,
      badge: '',
      meta: '10–20 % времени · результат раз в квартал',
      body: '',
      accent: ACCENT_GUILD_INFO,
      data: GUILD_INFO,
      searchExtra: [GUILD_INFO.short, GUILD_INFO.what, GUILD_INFO.time, GUILD_INFO.owns, GUILD_INFO.output, GUILD_INFO.sunset].join(' '),
      label: 'Пояснение: что такое гильдия, сколько времени она занимает и когда её распускают.'
    });

    (board.guilds || []).forEach(function (guild, index) {
      addNode({
        id: 'guild-' + (guild.slug || slugify(guild.name)),
        type: 'guild',
        x: L.guilds.x0 + (index + 1) * L.guilds.step,
        y: L.guilds.y,
        w: L.guilds.w,
        h: L.guilds.h,
        idText: 'Гильдия',
        title: guild.name,
        badge: '',
        meta: guild.cadence || '',
        body: '',
        accent: ACCENT_GUILD,
        data: guild,
        searchExtra: [guild.nameEn, guild.purpose, guild.cadence, guild.output, guild.explain].join(' '),
        label: 'Гильдия «' + guild.name + '». ' + compact(guild.cadence, 120)
      });
    });
  }

  function buildParkedNodes() {
    (board.parked || []).forEach(function (parked, index) {
      var col = index % L.parked.cols;
      var row = Math.floor(index / L.parked.cols);
      addNode({
        id: 'parked-' + parked.id,
        type: 'parked',
        x: L.parked.x0 + col * (L.parked.w + L.parked.gap),
        y: L.parked.y + row * (L.parked.h + L.parked.gap),
        w: L.parked.w,
        h: L.parked.h,
        idText: parked.id,
        title: parked.title,
        badge: statusText(parked.status),
        meta: (parked.roles || []).join(' · '),
        body: parked.whyParked || '',
        accent: ACCENT_PARKED,
        status: parked.status,
        data: parked,
        searchExtra: [parked.whyParked, (parked.roles || []).join(' '), parked.acceptance].join(' '),
        label: 'Отложенная задача ' + parked.id + ' «' + parked.title + '».'
      });
    });
  }

  function addNode(cfg) {
    var el = document.createElement('div');
    el.className = 'node node--' + cfg.type;
    el.id = cfg.id;
    el.setAttribute('data-node-id', cfg.id);
    el.setAttribute('data-node-type', cfg.type);
    el.style.position = 'absolute';
    el.style.left = cfg.x + 'px';
    el.style.top = cfg.y + 'px';
    el.style.width = cfg.w + 'px';
    el.style.height = cfg.h + 'px';
    el.style.zIndex = String(TYPE_Z[cfg.type] || 1);
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', cfg.label || cfg.title || cfg.id);
    el.title = cfg.label || cfg.title || cfg.id;
    if (cfg.accent) el.style.setProperty('--accent', cfg.accent);
    if (cfg.divisionSlug) el.setAttribute('data-division', cfg.divisionSlug);
    if (cfg.type === 'task' && cfg.idText) el.setAttribute('data-id', cfg.idText);
    if (cfg.wave != null) el.setAttribute('data-wave', String(cfg.wave));
    if (cfg.status) el.setAttribute('data-status', String(cfg.status));

    var html = '<div class="node__head">' +
      '<span class="node__id">' + esc(cfg.idText || '') + '</span>' +
      (cfg.badge ? '<span class="node__badge">' + esc(cfg.badge) + '</span>' : '') +
      '</div>' +
      '<div class="node__title">' + esc(cfg.title || '') + '</div>' +
      (cfg.meta ? '<div class="node__meta">' + esc(cfg.meta) + '</div>' : '') +
      (cfg.body ? '<div class="node__body">' + esc(cfg.body) + '</div>' : '');
    el.innerHTML = html;

    els.nodes.appendChild(el);

    var rec = {
      id: cfg.id,
      type: cfg.type,
      x: cfg.x, y: cfg.y, w: cfg.w, h: cfg.h,
      baseX: cfg.x, baseY: cfg.y,
      el: el,
      title: cfg.title || '',
      idText: cfg.idText || '',
      meta: cfg.meta || '',
      body: cfg.body || '',
      accent: cfg.accent || ACCENT_FALLBACK,
      data: cfg.data || null,
      parentId: cfg.parentId || null,
      divisionSlug: cfg.divisionSlug || '',
      divisionName: cfg.divisionName || '',
      groupName: cfg.groupName || '',
      status: cfg.status || '',
      wave: cfg.wave != null ? cfg.wave : '',
      hidden: false,
      baseVisible: true,
      isMatch: false,
      isDim: false,
      searchText: [
        cfg.id, cfg.idText, cfg.title, cfg.meta, cfg.body,
        cfg.divisionName, cfg.groupName, cfg.status, statusText(cfg.status),
        cfg.searchExtra
      ].join(' ').toLowerCase()
    };

    records.push(rec);
    byId[rec.id] = rec;
    return rec;
  }

  /* ---------------------------------------------------------------- edges */

  function ensureEdgeLayers() {
    if (!els.edges) return;
    pathsLayer = document.createElementNS(SVG_NS, 'g');
    pathsLayer.setAttribute('class', 'edge-paths');
    labelsLayer = document.createElementNS(SVG_NS, 'g');
    labelsLayer.setAttribute('class', 'edge-labels');
    els.edges.appendChild(pathsLayer);
    els.edges.appendChild(labelsLayer);
  }

  function buildEdges() {
    edges = [];

    records.forEach(function (rec) {
      if (rec.type === 'group' && rec.parentId) {
        var division = byId[rec.parentId];
        if (division) {
          addEdge(division, rec, 'structure', {
            label: 'входит в',
            short: 'входит',
            kind: 'in',
            sentence: 'Группа «' + rec.title + '» входит в направление «' + division.title + '».'
          });
        }
      }
      if (rec.type === 'task') {
        var group = byId[rec.parentId];
        if (group) {
          addEdge(group, rec, 'structure', {
            label: 'содержит',
            short: 'содержит',
            kind: 'contains',
            sentence: 'Задача ' + rec.data.id + ' «' + rec.title + '» содержится в группе «' + group.title + '».'
          });
        }
        ((rec.data && rec.data.dependsOn) || []).forEach(function (depId) {
          var target = byId['task-' + depId];
          if (!target) return;
          addEdge(rec, target, 'dependency', {
            label: 'зависит от',
            short: 'зависит',
            sentence: 'Задача ' + rec.data.id + ' «' + rec.title + '» зависит от задачи ' + depId + ' «' + target.title + '».'
          });
        });
      }
    });

    (board.interfaces || []).forEach(function (iface) {
      var from = byId[iface.from];
      var to = byId[iface.to];
      if (!from || !to) return;
      addEdge(from, to, 'handoff', {
        label: 'передаёт результат',
        short: 'передаёт',
        sentence: 'Направление «' + from.title + '» передаёт результат направлению «' + to.title + '»: ' +
          trimTransfer(iface.label) + '. ' + (iface.description || '')
      });
    });

    (board.anchorLinks || []).forEach(function (link) {
      var anchor = byId['anchor-' + slugify(link.anchor)];
      var division = byId[link.division];
      if (!anchor || !division) return;
      addEdge(anchor, division, 'market', {
        label: 'подтверждает спрос',
        short: 'спрос',
        sentence: 'Якорь найма «' + link.anchor + '» подтверждает спрос направления «' + division.title + '»: ' +
          (link.description || '')
      });
    });

    updateEdges();
  }

  function trimTransfer(label) {
    var text = String(label || '').trim();
    return text.replace(/^передаёт\s+/i, '');
  }

  function addEdge(from, to, family, opts) {
    if (!from || !to || !pathsLayer || !labelsLayer) return;

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'edge edge--' + family + (opts.kind === 'contains' ? ' edge--contains' : ''));
    path.setAttribute('fill', 'none');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('data-from', from.id);
    path.setAttribute('data-to', to.id);
    path.setAttribute('data-family', family);
    if (opts.kind) path.setAttribute('data-kind', opts.kind);

    var title = document.createElementNS(SVG_NS, 'title');
    title.textContent = opts.sentence;
    path.appendChild(title);
    pathsLayer.appendChild(path);

    var label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'edge-label edge-label--' + family);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.textContent = opts.short || opts.label || family;
    label.style.pointerEvents = 'none';
    labelsLayer.appendChild(label);

    var edge = {
      el: path,
      labelEl: label,
      from: from.id,
      to: to.id,
      family: family,
      label: opts.label || family,
      sentence: opts.sentence || '',
      hover: false,
      hidden: false
    };

    path.addEventListener('pointerenter', function () {
      edge.hover = true;
      path.classList.add('is-hover');
      syncLabels();
    });
    path.addEventListener('pointerleave', function () {
      edge.hover = false;
      path.classList.remove('is-hover');
      syncLabels();
    });

    edges.push(edge);
  }

  function updateEdges() {
    if (!els.edges) return;
    edges.forEach(function (edge) {
      var from = byId[edge.from];
      var to = byId[edge.to];
      if (!from || !to) return;
      var geom = geometryFor(from, to, edge.family);
      edge.el.setAttribute('d', geom.d);
      edge.labelEl.setAttribute('x', String(num(geom.lx)));
      edge.labelEl.setAttribute('y', String(num(geom.ly)));
      if (geom.rotate) {
        edge.labelEl.setAttribute('transform', 'rotate(-90 ' + num(geom.lx) + ' ' + num(geom.ly) + ')');
      } else {
        edge.labelEl.removeAttribute('transform');
      }
    });
    sizeEdgeLayer();
  }

  function geometryFor(a, b, family) {
    if (family === 'structure') return structureGeometry(a, b);
    if (family === 'dependency') return dependencyGeometry(a, b);
    if (family === 'handoff') return handoffGeometry(a, b);
    return marketGeometry(a, b);
  }

  function structureGeometry(a, b) {
    if (a.type === 'division') {
      var x = a.x + 12;
      var y0 = a.y + 118;
      var y1 = b.y + 30;
      return {
        d: 'M ' + num(x) + ' ' + num(y0) +
          ' L ' + num(x) + ' ' + num(y1) +
          ' L ' + num(b.x) + ' ' + num(y1),
        lx: x + 4,
        ly: (y0 + y1) / 2,
        rotate: true
      };
    }
    var gx = a.x + 8;
    var gy = a.y + 76;
    var ty = b.y + 24;
    return {
      d: 'M ' + num(gx) + ' ' + num(gy) +
        ' L ' + num(gx) + ' ' + num(ty) +
        ' L ' + num(b.x) + ' ' + num(ty),
      lx: gx + 2,
      ly: (gy + ty) / 2,
      rotate: true
    };
  }

  function dependencyGeometry(a, b) {
    var centerA = a.x + a.w / 2;
    var centerB = b.x + b.w / 2;

    if (Math.abs(centerA - centerB) < 80) {
      var ax = centerA;
      var ay = a.y;
      var bx = centerB;
      var by = b.y + b.h;
      if (a.y + a.h < b.y) { ay = a.y + a.h; by = b.y; }
      var bend = Math.max(24, Math.abs(ay - by) * 0.2);
      return {
        d: 'M ' + num(ax) + ' ' + num(ay) +
          ' C ' + num(ax) + ' ' + num(ay + (by > ay ? bend : -bend)) + ', ' +
          num(bx) + ' ' + num(by + (by > ay ? -bend : bend)) + ', ' + num(bx) + ' ' + num(by),
        lx: (ax + bx) / 2,
        ly: (ay + by) / 2,
        rotate: false
      };
    }

    var startRight = centerB >= centerA;
    var hx = startRight ? a.x + a.w : a.x;
    var hy = a.y + a.h / 2;
    var tx = startRight ? b.x : b.x + b.w;
    var ty = b.y + b.h / 2;
    var pull = Math.max(48, Math.abs(tx - hx) * 0.35);
    var c1x = startRight ? hx + pull : hx - pull;
    var c2x = startRight ? tx - pull : tx + pull;
    return {
      d: 'M ' + num(hx) + ' ' + num(hy) +
        ' C ' + num(c1x) + ' ' + num(hy) + ', ' + num(c2x) + ' ' + num(ty) + ', ' + num(tx) + ' ' + num(ty),
      lx: (hx + 3 * c1x + 3 * c2x + tx) / 8,
      ly: (hy + ty) / 2 - 7,
      rotate: false
    };
  }

  function handoffGeometry(a, b) {
    var ax = a.x + a.w / 2;
    var ay = a.y;
    var bx = b.x + b.w / 2;
    var by = b.y;
    var lift = 130;
    var c1x = ax, c1y = ay - lift;
    var c2x = bx, c2y = by - lift;
    return {
      d: 'M ' + num(ax) + ' ' + num(ay) +
        ' C ' + num(c1x) + ' ' + num(c1y) + ', ' + num(c2x) + ' ' + num(c2y) + ', ' + num(bx) + ' ' + num(by),
      lx: (ax + 3 * c1x + 3 * c2x + bx) / 8,
      ly: (ay + 3 * c1y + 3 * c2y + by) / 8,
      rotate: false
    };
  }

  function marketGeometry(a, b) {
    var ax = a.x + a.w / 2;
    var ay = a.y + a.h;
    var bx = b.x + b.w / 2;
    var by = b.y;
    var c1x = ax, c1y = ay + 60;
    var c2x = bx, c2y = by - 60;
    return {
      d: 'M ' + num(ax) + ' ' + num(ay) +
        ' C ' + num(c1x) + ' ' + num(c1y) + ', ' + num(c2x) + ' ' + num(c2y) + ', ' + num(bx) + ' ' + num(by),
      lx: (ax + 3 * c1x + 3 * c2x + bx) / 8,
      ly: (ay + 3 * c1y + 3 * c2y + by) / 8,
      rotate: false
    };
  }

  function sizeEdgeLayer() {
    if (!els.edges) return;
    var maxX = WORLD.w;
    var maxY = WORLD.h;
    records.forEach(function (rec) {
      maxX = Math.max(maxX, rec.x + rec.w + 240);
      maxY = Math.max(maxY, rec.y + rec.h + 240);
    });
    els.edges.setAttribute('width', String(maxX));
    els.edges.setAttribute('height', String(maxY));
    els.edges.setAttribute('viewBox', '0 0 ' + maxX + ' ' + maxY);
    els.edges.style.width = maxX + 'px';
    els.edges.style.height = maxY + 'px';
  }

  /* ---------------------------------------------------------------- rail */

  function buildRail() {
    var list = $('rail-list');
    if (!list) return;
    list.textContent = '';
    var listIsSemantic = /^(ol|ul)$/i.test(list.tagName);

    board.divisions.forEach(function (division, index) {
      var slug = division.slug || slugify(division.name);
      var rec = byId['div-' + slug];
      var count = 0;
      records.forEach(function (item) {
        if (item.type === 'task' && item.divisionSlug === slug) count += 1;
      });

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rail__item';
      btn.setAttribute('data-division', slug);
      btn.setAttribute('title', division.mission || division.name);
      btn.style.setProperty('--accent', accentFor(slug));
      btn.innerHTML =
        '<span class="rail__index">' + two(index + 1) + '</span>' +
        '<span class="rail__name">' + esc(division.name) + '</span>' +
        '<span class="rail__count">' + count + '</span>';
      on(btn, 'click', function () { focusDivision(slug); });

      if (listIsSemantic) {
        var li = document.createElement('li');
        li.appendChild(btn);
        list.appendChild(li);
      } else {
        list.appendChild(btn);
      }
    });
  }

  function syncRail() {
    var list = $('rail-list');
    if (!list) return;
    var active = '';
    if (state.selectedId && byId[state.selectedId]) {
      var selected = byId[state.selectedId];
      active = selected.divisionSlug || '';
      if (!active && selected.type === 'division' && selected.data) active = selected.data.slug || '';
    }
    if (!active && state.focusDivisionId) active = state.focusDivisionId;
    if (!active) {
      var filter = els.divisionFilter ? norm(els.divisionFilter.value) : '';
      active = filter;
    }
    Array.prototype.forEach.call(list.querySelectorAll('[data-division]'), function (btn) {
      var isActive = btn.getAttribute('data-division') === active;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  }

  function toggleRail() {
    var rail = $('rail');
    if (!rail) return;
    var collapsed = !rail.classList.contains('is-collapsed');
    rail.classList.toggle('is-collapsed', collapsed);
    rail.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    var toggle = $('rail-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.title = collapsed ? 'Развернуть список направлений' : 'Свернуть список направлений';
    }
    if (rail.getAttribute('data-fallback') === '1') {
      rail.style.width = collapsed ? '44px' : '236px';
      rail.style.padding = collapsed ? '8px 4px' : '8px';
    }
    drawMinimap();
  }

  function focusRail(raw) {
    return focusDivision(raw);
  }

  function findDivision(raw) {
    if (raw == null) return null;
    var value = String(raw).trim();
    if (!value) return null;
    var direct = byId['div-' + value] || byId[value];
    if (direct && direct.type === 'division') return direct;
    for (var i = 0; i < records.length; i += 1) {
      var rec = records[i];
      if (rec.type !== 'division' || !rec.data) continue;
      if (rec.data.name === value || rec.data.slug === value || rec.data.nameEn === value) return rec;
    }
    return null;
  }

  function focusDivision(raw) {
    var rec = findDivision(raw);
    if (!rec) return false;
    var slug = rec.divisionSlug || (rec.data && rec.data.slug) || '';

    if (els.divisionFilter && norm(els.divisionFilter.value) && norm(els.divisionFilter.value) !== slug) {
      els.divisionFilter.value = 'all';
      applyView();
    }

    var size = stageSize();
    var reserve = detailsReserve();
    var available = Math.max(360, size.w - reserve - 40);
    var scale = clamp(available / (L.divisions.w + 60), 0.55, 0.85);

    state.camera.s = scale;
    state.camera.tx = (size.w - reserve - L.divisions.w * scale) / 2 - rec.x * scale;
    state.camera.ty = 30 - rec.y * scale;
    state.focusDivisionId = slug;
    applyCamera();
    selectNode(rec.id, false);
    saveNow();
    toast('Направление «' + rec.title + '» на экране');
    return true;
  }

  /* ---------------------------------------------------------------- view */

  function readFilter(el) { return el ? norm(el.value) : ''; }

  function divisionMatches(rec, value) {
    if (!value) return true;
    if (rec.divisionSlug && (rec.divisionSlug === value || 'div-' + rec.divisionSlug === value)) return true;
    if (rec.divisionName && rec.divisionName.toLowerCase() === value) return true;
    return false;
  }

  function tasksOf(rec) {
    if (rec.type === 'division') {
      return records.filter(function (item) { return item.type === 'task' && item.divisionSlug === rec.divisionSlug; });
    }
    if (rec.type === 'group') {
      return records.filter(function (item) { return item.type === 'task' && item.parentId === rec.id; });
    }
    return [];
  }

  function basePass(rec, divValue, waveValue, statusValue) {
    var anyFilter = !!(divValue || waveValue || statusValue);

    if (rec.type === 'anchor' || rec.type === 'guild' || rec.type === 'guild-info') return !anyFilter;

    if (rec.type === 'parked') {
      if (divValue || waveValue) return false;
      if (statusValue && rec.status !== statusValue) return false;
      return true;
    }

    if (rec.type === 'division' || rec.type === 'group') {
      if (divValue && !divisionMatches(rec, divValue)) return false;
      var tasks = tasksOf(rec);
      if (waveValue && !tasks.some(function (task) { return waveMatches(task.wave, waveValue); })) return false;
      if (statusValue && !tasks.some(function (task) { return task.status === statusValue; })) return false;
      return true;
    }

    if (divValue && !divisionMatches(rec, divValue)) return false;
    if (waveValue && !waveMatches(rec.wave, waveValue)) return false;
    if (statusValue && rec.status !== statusValue) return false;
    return true;
  }

  function applyView() {
    if (!records.length) {
      updateCounts();
      return;
    }

    var q = norm(state.search);
    var divValue = readFilter(els.divisionFilter);
    var waveValue = readFilter(els.waveFilter);
    var statusValue = normStatus(els.statusFilter ? els.statusFilter.value : '');

    records.forEach(function (rec) {
      rec.baseVisible = basePass(rec, divValue, waveValue, statusValue);
      rec.hidden = !rec.baseVisible;
      rec.isMatch = false;
      rec.isDim = false;
    });

    if (q) {
      var matches = Object.create(null);
      records.forEach(function (rec) {
        if (rec.baseVisible && rec.searchText.indexOf(q) !== -1) matches[rec.id] = true;
      });

      var keep = Object.create(null);
      Object.keys(matches).forEach(function (id) {
        keep[id] = true;
        var current = byId[id];
        while (current && current.parentId) {
          keep[current.parentId] = true;
          current = byId[current.parentId];
        }
      });
      Object.keys(matches).forEach(function (id) {
        var rec = byId[id];
        if (!rec) return;
        if (rec.type === 'division') {
          records.forEach(function (child) {
            if (child.parentId === rec.id) {
              keep[child.id] = true;
              records.forEach(function (grand) {
                if (grand.parentId === child.id) keep[grand.id] = true;
              });
            }
          });
        } else if (rec.type === 'group') {
          records.forEach(function (child) {
            if (child.parentId === rec.id) keep[child.id] = true;
          });
        }
      });

      records.forEach(function (rec) {
        rec.hidden = !rec.baseVisible || !keep[rec.id];
        rec.isMatch = !!matches[rec.id] && !rec.hidden;
        rec.isDim = !rec.hidden && !rec.isMatch;
      });
    }

    records.forEach(function (rec) {
      rec.el.classList.toggle('is-hidden', rec.hidden);
      rec.el.classList.toggle('is-match', rec.isMatch);
      rec.el.classList.toggle('is-dim', rec.isDim);
      rec.el.style.display = rec.hidden ? 'none' : '';
    });

    edges.forEach(function (edge) {
      var from = byId[edge.from];
      var to = byId[edge.to];
      var endpointsHidden = !from || !to || from.hidden || to.hidden;
      var familyOn = !!state.layers[edge.family];
      edge.hidden = endpointsHidden;
      var hidden = endpointsHidden || !familyOn;
      edge.el.classList.toggle('is-hidden', hidden);
      edge.el.style.display = hidden ? 'none' : '';
      edge.el.classList.toggle('is-dim', !!q && !hidden && !from.isMatch && !to.isMatch);
      edge.el.classList.toggle('is-selected', !!state.selectedId && (edge.from === state.selectedId || edge.to === state.selectedId));
      edge.el.classList.toggle('is-active', !!state.selectedId && (edge.from === state.selectedId || edge.to === state.selectedId));
    });

    syncLabels();
    updateCounts();
    syncRail();
    drawMinimap();
  }

  function syncLabels() {
    var master = !!state.layers.labels;
    edges.forEach(function (edge) {
      var from = byId[edge.from];
      var to = byId[edge.to];
      var visible = !edge.hidden && !!state.layers[edge.family] && from && to && !from.hidden && !to.hidden;
      var show = master && visible;
      if (show && edge.family === 'structure') {
        show = state.camera.s > STRUCTURE_LABEL_SCALE || edge.hover;
      }
      edge.labelEl.style.display = show ? '' : 'none';
      if (show && edge.family === 'structure' && edge.hover) {
        edge.labelEl.classList.add('is-hover');
      } else {
        edge.labelEl.classList.remove('is-hover');
      }
    });
  }

  function census() {
    var totals = { division: 0, group: 0, task: 0, parked: 0, anchor: 0, guild: 0, 'guild-info': 0 };
    var visible = { division: 0, group: 0, task: 0, parked: 0, anchor: 0, guild: 0, 'guild-info': 0 };
    records.forEach(function (rec) {
      totals[rec.type] = (totals[rec.type] || 0) + 1;
      if (!rec.hidden) visible[rec.type] = (visible[rec.type] || 0) + 1;
    });
    return { totals: totals, visible: visible };
  }

  function updateCounts() {
    if (!els.countLabel) return;
    var data = census();
    var totals = data.totals;
    var visible = data.visible;

    var text = 'Направлений ' + totals.division +
      ' · групп ' + totals.group +
      ' · задач ' + totals.task +
      ' · отложено ' + totals.parked +
      ' · гильдий ' + totals.guild;

    var narrowed = !!(readFilter(els.divisionFilter) || readFilter(els.waveFilter) ||
      normStatus(els.statusFilter ? els.statusFilter.value : '') || norm(state.search));
    if (narrowed) {
      text += ' · видно: направлений ' + visible.division +
        ', групп ' + visible.group +
        ', задач ' + visible.task +
        ' из ' + totals.task;
    }

    els.countLabel.textContent = text;
    updateZoomLabel();
  }

  function updateZoomLabel() {
    if (els.zoomLabel) els.zoomLabel.textContent = Math.round(state.camera.s * 100) + '%';
  }

  /* ---------------------------------------------------------------- camera */

  function applyCamera() {
    if (!els.world) return;
    var camera = state.camera;
    els.world.style.transform = 'translate3d(' + num(camera.tx) + 'px,' + num(camera.ty) + 'px,0) scale(' + camera.s + ')';
    updateZoomLabel();
    syncLabels();
    drawMinimap();
  }

  function stageSize() {
    var rect = els.stage.getBoundingClientRect();
    return {
      w: rect.width || window.innerWidth || 1200,
      h: rect.height || (window.innerHeight - 60) || 800
    };
  }

  function initialView() {
    var scale = READABLE_SCALE;

    state.camera.s = scale;
    state.camera.tx = 32 - L.divisions.x0 * scale;
    state.camera.ty = 24 - L.anchors.y * scale;
    applyCamera();
    save();
  }

  function fit() {
    var list = records.filter(function (rec) { return !rec.hidden; });
    if (!list.length) list = records;
    if (!list.length) return;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach(function (rec) {
      minX = Math.min(minX, rec.x);
      minY = Math.min(minY, rec.y);
      maxX = Math.max(maxX, rec.x + rec.w);
      maxY = Math.max(maxY, rec.y + rec.h);
    });

    var size = stageSize();
    var pad = 40;
    var boxW = Math.max(1, maxX - minX);
    var boxH = Math.max(1, maxY - minY);
    var scale = clamp(Math.min((size.w - pad * 2) / boxW, (size.h - pad * 2) / boxH), MIN_SCALE, 1);

    state.camera.s = scale;
    state.camera.tx = (size.w - boxW * scale) / 2 - minX * scale;
    state.camera.ty = (size.h - boxH * scale) / 2 - minY * scale;
    applyCamera();
    save();
    return scale;
  }

  function zoomAt(factor, clientX, clientY) {
    var rect = els.stage.getBoundingClientRect();
    var px = clientX - rect.left;
    var py = clientY - rect.top;
    var camera = state.camera;
    var wx = (px - camera.tx) / camera.s;
    var wy = (py - camera.ty) / camera.s;
    var next = clamp(camera.s * factor, MIN_SCALE, MAX_SCALE);
    if (next === camera.s) return;
    camera.s = next;
    camera.tx = px - wx * camera.s;
    camera.ty = py - wy * camera.s;
    applyCamera();
    save();
  }

  function zoomBy(factor) {
    var rect = els.stage.getBoundingClientRect();
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function resetLayout() {
    state.positions = Object.create(null);
    records.forEach(function (rec) {
      rec.x = rec.baseX;
      rec.y = rec.baseY;
      rec.el.style.left = rec.x + 'px';
      rec.el.style.top = rec.y + 'px';
    });
    state.focusDivisionId = null;
    updateEdges();
    initialView();
    saveNow();
    toast('Раскладка возвращена к исходной');
  }

  /* ---------------------------------------------------------------- minimap */

  function worldBounds() {
    var minX = 0, minY = 0, maxX = WORLD.w, maxY = WORLD.h;
    records.forEach(function (rec) {
      minX = Math.min(minX, rec.x);
      minY = Math.min(minY, rec.y);
      maxX = Math.max(maxX, rec.x + rec.w);
      maxY = Math.max(maxY, rec.y + rec.h);
    });
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function minimapMap(w, h) {
    var pad = 6;
    var bounds = worldBounds();
    var scale = Math.min((w - pad * 2) / bounds.w, (h - pad * 2) / bounds.h);
    return {
      scale: scale || 0.01,
      ox: (w - bounds.w * scale) / 2 - bounds.x * scale,
      oy: (h - bounds.h * scale) / 2 - bounds.y * scale,
      bounds: bounds
    };
  }

  function minimapCanvasEl() {
    var child = $('minimap-canvas');
    if (child) return child;
    var host = $('minimap');
    if (host && String(host.tagName).toLowerCase() === 'canvas') return host;
    return null;
  }

  function drawMinimap() {
    var host = $('minimap');
    var canvas = minimapCanvasEl();
    if (!host || !canvas || !canvas.getContext) return;

    var rect = canvas.getBoundingClientRect();
    var width = Math.round(rect.width) || host.clientWidth || 240;
    var height = Math.round(rect.height) || host.clientHeight || 164;
    var dpr = window.devicePixelRatio || 1;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    if (canvas.id === 'minimap-canvas') {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    }

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var map = minimapMap(width, height);
    var scale = map.scale;
    var ox = map.ox;
    var oy = map.oy;

    ctx.fillStyle = 'rgba(22, 26, 31, .035)';
    ctx.fillRect(map.bounds.x * scale + ox, map.bounds.y * scale + oy, map.bounds.w * scale, map.bounds.h * scale);

    records.forEach(function (rec) {
      if (rec.hidden) return;
      var color = rec.accent || ACCENT_FALLBACK;
      var x = rec.x * scale + ox;
      var y = rec.y * scale + oy;
      var w = Math.max(1, rec.w * scale);
      var h = Math.max(1, rec.h * scale);
      ctx.globalAlpha = rec.type === 'division' ? 0.22 : 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      if (rec.type === 'division') {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
      }
    });
    ctx.globalAlpha = 1;

    var size = stageSize();
    var camera = state.camera;
    var vx = (-camera.tx) / camera.s;
    var vy = (-camera.ty) / camera.s;
    var vw = size.w / camera.s;
    var vh = size.h / camera.s;
    ctx.strokeStyle = 'rgba(22, 26, 31, .55)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(vx * scale + ox, vy * scale + oy, vw * scale, vh * scale);
    ctx.fillStyle = 'rgba(22, 26, 31, .06)';
    ctx.fillRect(vx * scale + ox, vy * scale + oy, vw * scale, vh * scale);
  }

  function minimapWorldPoint(clientX, clientY) {
    var host = $('minimap');
    if (!host) return null;
    var rect = host.getBoundingClientRect();
    var map = minimapMap(rect.width, rect.height);
    return {
      x: (clientX - rect.left - map.ox) / map.scale,
      y: (clientY - rect.top - map.oy) / map.scale
    };
  }

  function moveCameraToWorld(point) {
    if (!point) return;
    var size = stageSize();
    state.camera.tx = size.w / 2 - point.x * state.camera.s;
    state.camera.ty = size.h / 2 - point.y * state.camera.s;
    applyCamera();
  }

  /* ---------------------------------------------------------------- layers */

  function syncLayerControls() {
    Object.keys(LAYER_IDS).forEach(function (key) {
      var control = $(LAYER_IDS[key]);
      if (!control) return;
      if (isCheckbox(control)) {
        control.checked = !!state.layers[key];
      } else {
        control.setAttribute('aria-pressed', state.layers[key] ? 'true' : 'false');
        control.classList.toggle('is-active', !!state.layers[key]);
        control.title = (state.layers[key] ? 'Скрыть: ' : 'Показать: ') + LAYER_TITLES[key];
      }
    });
    if (els.toggleEdges) {
      els.toggleEdges.setAttribute('aria-pressed', state.layers.dependency ? 'true' : 'false');
      els.toggleEdges.classList.toggle('is-active', !!state.layers.dependency);
    }
    var layersBtn = $('toggle-layers');
    if (layersBtn && !isCheckbox(layersBtn)) {
      layersBtn.classList.toggle('is-active', !!state.layersOpen);
    }
  }

  function syncLayersPanel() {
    var panel = $('layers');
    if (!panel) return;
    panel.hidden = !state.layersOpen;
    panel.classList.toggle('is-hidden', !state.layersOpen);
    var button = $('toggle-layers');
    if (button) {
      if (isCheckbox(button)) button.checked = state.layersOpen;
      else button.setAttribute('aria-expanded', state.layersOpen ? 'true' : 'false');
    }
  }

  function toggleLayer(key) {
    state.layers[key] = !state.layers[key];
    syncLayerControls();
    applyView();
    saveNow();
    var names = {
      structure: 'Структура',
      dependency: 'Зависимости',
      handoff: 'Передачи результата',
      market: 'Спрос рынка',
      labels: 'Подписи связей'
    };
    toast((state.layers[key] ? 'Включено: ' : 'Скрыто: ') + (names[key] || key));
  }

  /* ---------------------------------------------------------------- selection & details */

  function resolveId(raw) {
    if (raw == null) return null;
    var value = String(raw).trim();
    if (byId[value]) return value;
    var candidates = [
      'task-' + value,
      'parked-' + value,
      'div-' + value,
      'guild-' + value,
      'anchor-' + slugify(value)
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      if (byId[candidates[i]]) return candidates[i];
    }
    for (var j = 0; j < records.length; j += 1) {
      var rec = records[j];
      if (rec.data && (rec.data.slug === value || rec.data.name === value)) return rec.id;
    }
    return null;
  }

  function select(raw) {
    var id = resolveId(raw);
    if (!id) return false;
    selectNode(id, true);
    return true;
  }

  function zFor(type, selected) {
    var base = TYPE_Z[type] || 1;
    if (!selected) return base;
    if (type === 'division' || type === 'group') return base;
    return base + 10;
  }

  function selectNode(id, reveal) {
    var rec = byId[id];
    if (!rec) return;

    if (state.selectedId && byId[state.selectedId]) {
      var previous = byId[state.selectedId];
      previous.el.classList.remove('is-selected');
      previous.el.style.zIndex = String(zFor(previous.type, false));
    }

    state.selectedId = id;
    rec.el.classList.add('is-selected');
    rec.el.style.zIndex = String(zFor(rec.type, true));
    if (reveal) ensureVisible(rec);
    openDetails(rec);
    syncEdgeSelection();
    syncRail();
  }

  function clearSelection() {
    if (state.selectedId && byId[state.selectedId]) {
      var rec = byId[state.selectedId];
      rec.el.classList.remove('is-selected');
      rec.el.style.zIndex = String(zFor(rec.type, false));
    }
    state.selectedId = null;
    hideDetails();
    syncEdgeSelection();
    syncRail();
  }

  function syncEdgeSelection() {
    edges.forEach(function (edge) {
      var active = !!state.selectedId && (edge.from === state.selectedId || edge.to === state.selectedId);
      edge.el.classList.toggle('is-selected', active);
      edge.el.classList.toggle('is-active', active);
    });
  }

  function detailsReserve() {
    var size = stageSize();
    if (size.w < 900) return 0;
    return Math.min(400, Math.round(size.w * 0.3));
  }

  function ensureVisible(rec) {
    var size = stageSize();
    var camera = state.camera;
    var sx = rec.x * camera.s + camera.tx;
    var sy = rec.y * camera.s + camera.ty;
    var sw = rec.w * camera.s;
    var sh = rec.h * camera.s;
    var margin = 24;
    var reserve = els.details && !els.details.hidden ? detailsReserve() : 0;
    if (sx < margin || sy < margin || sx + sw > size.w - reserve - margin || sy + sh > size.h - margin) {
      var focusH = Math.min(rec.h, 520);
      state.camera.tx = (size.w - reserve) / 2 - (rec.x + rec.w / 2) * camera.s;
      state.camera.ty = size.h / 2 - (rec.y + focusH / 2) * camera.s;
      applyCamera();
    }
  }

  function hideDetails() {
    if (!els.details) return;
    els.details.hidden = true;
    els.details.classList.remove('is-open');
  }

  function openDetails(rec) {
    if (!els.details || !els.detailsBody) return;
    els.detailsBody.innerHTML = detailsHtml(rec);
    els.details.hidden = false;
    els.details.classList.add('is-open');
    els.detailsBody.scrollTop = 0;
  }

  function detailsHtml(rec) {
    var head = '<div class="details__label">' + esc(TYPE_RU[rec.type] || 'Узел') + '</div>' +
      '<h2 class="details__title">' + esc(rec.title) + '</h2>';

    if (rec.type === 'task') return head + taskDetails(rec);
    if (rec.type === 'group') return head + groupDetails(rec);
    if (rec.type === 'division') return head + divisionDetails(rec);
    if (rec.type === 'parked') return head + parkedDetails(rec);
    if (rec.type === 'anchor') return head + anchorDetails(rec);
    if (rec.type === 'guild') return head + guildDetails(rec);
    if (rec.type === 'guild-info') return head + guildInfoDetails();
    return head;
  }

  function row(label, value) {
    return '<dt>' + esc(label) + '</dt><dd>' + value + '</dd>';
  }

  function rows(pairs) {
    return '<dl class="details__rows">' + pairs + '</dl>';
  }

  function sectionHtml(label, html) {
    return '<section class="details__section"><h4>' + esc(label) + '</h4>' + html + '</section>';
  }

  function listHtml(items) {
    if (!items || !items.length) return '<p class="details__muted">нет</p>';
    return '<ul>' + items.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>';
  }

  function chip(status) {
    return '<span class="chip" data-status="' + esc(status) + '">' + esc(statusText(status)) + '</span>';
  }

  function linkTo(rec, labelHtml) {
    return '<a href="#" data-goto="' + esc(rec.id) + '">' + labelHtml + '</a>';
  }

  function taskLink(rec) {
    return linkTo(rec, '<code>' + esc(rec.idText) + '</code> — ' + esc(rec.title));
  }

  function divisionLinkById(divId) {
    var rec = byId[divId];
    return rec ? linkTo(rec, esc(rec.title)) : esc(divId);
  }

  function taskDetails(rec) {
    var task = rec.data || {};
    var deps = (task.dependsOn || []).map(function (depId) {
      var target = byId['task-' + depId];
      return target ? taskLink(target) : '<code>' + esc(depId) + '</code>';
    });
    var unlocks = records.filter(function (item) {
      return item.type === 'task' && item.data && (item.data.dependsOn || []).indexOf(task.id) !== -1;
    }).map(taskLink);
    var checks = (task.acceptanceChecks || []).map(function (check) { return rich(check); });

    return rows(
      row('ID', '<code>' + esc(task.id) + '</code>') +
      row('Направление', esc(task.division)) +
      row('Группа', esc(task.group)) +
      row('Волна', String(task.wave)) +
      row('Статус', chip(task.status))
    ) +
      sectionHtml('Что это',
        '<p>Задача направления «' + esc(task.division) + '», группа «' + esc(task.group) + '».</p>' +
        '<p class="details__muted">Волна ' + esc(task.wave) + ' · статус: ' + esc(statusText(task.status)) + '.</p>') +
      sectionHtml('Почему сейчас', '<p>' + rich(task.whyNow) + '</p>') +
      sectionHtml('Кто делает', listHtml((task.roles || []).map(function (role) { return esc(role); }))) +
      sectionHtml('Как принять',
        '<p>' + rich(task.acceptance) + '</p>' +
        (checks.length ? '<ul>' + checks.map(function (check) { return '<li>' + check + '</li>'; }).join('') + '</ul>' : '')) +
      sectionHtml('От чего зависит',
        deps.length ? listHtml(deps) : '<p class="details__muted">Ни от чего не зависит — можно начинать сразу.</p>') +
      sectionHtml('Что разблокирует',
        unlocks.length ? listHtml(unlocks) : '<p class="details__muted">Пока ничего не разблокирует.</p>') +
      sectionHtml('Источник', '<p class="details__muted"><code>' + esc(task.source) + '</code></p>');
  }

  function groupDetails(rec) {
    var division = byId[rec.parentId];
    var group = rec.data || {};
    var tasks = tasksOf(rec);

    return rows(
      row('Направление', division ? esc(division.title) : esc(rec.divisionName)) +
      row('Задач', String(tasks.length))
    ) +
      sectionHtml('Результат группы', '<p>' + rich(group.outcome) + '</p>') +
      sectionHtml('Задачи группы', listHtml(tasks.map(taskLink))) +
      sectionHtml('Передачи с другими направлениями',
        division ? handoffHtml(division.id) : '<p class="details__muted">нет</p>');
  }

  function divisionDetails(rec) {
    var slug = rec.divisionSlug || (rec.data && rec.data.slug) || '';
    var groups = records.filter(function (item) { return item.type === 'group' && item.parentId === rec.id; });
    var tasks = tasksOf(rec);

    var groupLinks = groups.map(function (groupRec) {
      var count = tasksOf(groupRec).length;
      return linkTo(groupRec, '<code>' + esc(groupRec.idText) + '</code> — ' + esc(groupRec.title)) +
        ' <span class="details__muted">(' + count + ' ' + plural(count, ['задача', 'задачи', 'задач']) + ')</span>';
    });

    var anchors = (board.anchorLinks || []).filter(function (link) { return link.division === rec.id; });

    return rows(
      row('Групп', String(groups.length)) +
      row('Задач', String(tasks.length))
    ) +
      sectionHtml('Миссия', '<p>' + rich((rec.data && rec.data.mission) || '') + '</p>') +
      sectionHtml('Группы', listHtml(groupLinks)) +
      sectionHtml('Отдаёт результат', outgoingHtml(slug)) +
      sectionHtml('Получает результат', incomingHtml(slug)) +
      sectionHtml('Якоря найма',
        anchors.length
          ? listHtml(anchors.map(function (link) {
              return '<b>' + esc(link.anchor) + '</b> — ' + esc(link.label) + '. <span class="details__muted">' + rich(link.description) + '</span>';
            }))
          : '<p class="details__muted">Нет прямых якорей найма.</p>');
  }

  function handoffHtml(divId) {
    var slug = String(divId).replace(/^div-/, '');
    return '<p><b>Отдаёт результат</b></p>' + outgoingHtml(slug) +
      '<p><b>Получает результат</b></p>' + incomingHtml(slug);
  }

  function outgoingHtml(slug) {
    var items = (board.interfaces || []).filter(function (iface) { return iface.from === 'div-' + slug; });
    if (!items.length) return '<p class="details__muted">Нет исходящих передач.</p>';
    return '<ul>' + items.map(function (iface) {
      var target = byId[iface.to];
      return '<li>Передаёт ' + (target ? linkTo(target, '<b>' + esc(target.title) + '</b>') : esc(iface.to)) +
        ': ' + esc(trimTransfer(iface.label)) + '. <span class="details__muted">' + rich(iface.description) + '</span></li>';
    }).join('') + '</ul>';
  }

  function incomingHtml(slug) {
    var items = (board.interfaces || []).filter(function (iface) { return iface.to === 'div-' + slug; });
    if (!items.length) return '<p class="details__muted">Нет входящих передач.</p>';
    return '<ul>' + items.map(function (iface) {
      var source = byId[iface.from];
      return '<li>Получает от ' + (source ? linkTo(source, '<b>' + esc(source.title) + '</b>') : esc(iface.from)) +
        ': ' + esc(trimTransfer(iface.label)) + '. <span class="details__muted">' + rich(iface.description) + '</span></li>';
    }).join('') + '</ul>';
  }

  function parkedDetails(rec) {
    var item = rec.data || {};
    return rows(
      row('ID', '<code>' + esc(item.id) + '</code>') +
      row('Статус', chip(item.status))
    ) +
      sectionHtml('Почему отложено', '<p>' + rich(item.whyParked) + '</p>') +
      sectionHtml('Кто делает', listHtml((item.roles || []).map(function (role) { return esc(role); }))) +
      sectionHtml('Как принять', '<p>' + rich(item.acceptance) + '</p>');
  }

  function anchorDetails(rec) {
    var name = rec.data && rec.data.name ? rec.data.name : rec.title;
    var company = roles && roles.companies ? roles.companies[name] : null;
    var links = (rec.data && rec.data.links) || [];

    if (!company) {
      return sectionHtml('Якорь найма', '<p>Компания «' + esc(name) + '».</p>') +
        sectionHtml('Данные', '<p class="details__muted">Сводка вакансий не загрузилась; числа недоступны.</p>') +
        sectionHtml('Какие направления поддерживает',
          listHtml(links.map(function (link) {
            return divisionLinkById(link.division) + ' — ' + esc(link.label) + '. <span class="details__muted">' + rich(link.description) + '</span>';
          })));
    }

    var depts = topDepartments(company, 5).map(function (item) {
      return esc(item[0]) + ' — <code>' + esc(item[1]) + '</code>';
    });

    var boardUrl = company.board || '';
    var boardMatch = String(boardUrl).match(/https?:\/\/[^\s)]+/);
    var boardLink = boardMatch
      ? '<a href="' + esc(boardMatch[0]) + '" target="_blank" rel="noreferrer noopener">' + esc(boardUrl) + '</a>'
      : esc(boardUrl);

    return rows(
      row('Всего вакансий', '<code>' + esc(company.total) + '</code>') +
      row('За 30 дней', '<code>' + esc(company.last30 != null ? company.last30 : '—') + '</code>') +
      row('За 90 дней', '<code>' + esc(company.last90 != null ? company.last90 : '—') + '</code>')
    ) +
      sectionHtml('Крупные отделы', listHtml(depts)) +
      sectionHtml('Какие направления поддерживает',
        listHtml(links.map(function (link) {
          return divisionLinkById(link.division) + ' — ' + esc(link.label) + '. <span class="details__muted">' + rich(link.description) + '</span>';
        }))) +
      (boardUrl ? sectionHtml('Доска вакансий', '<p>' + boardLink + '</p>') : '');
  }

  function guildDetails(rec) {
    var guild = rec.data || {};
    return sectionHtml('Зачем нужна', '<p>' + rich(guild.purpose) + '</p>') +
      sectionHtml('Ритм встреч', '<p>' + rich(guild.cadence) + '</p>') +
      sectionHtml('Что даёт', '<p>' + rich(guild.output) + '</p>') +
      sectionHtml('Как устроена', '<p>' + rich(guild.explain) + '</p>');
  }

  function guildInfoDetails() {
    var guildLinks = records.filter(function (rec) { return rec.type === 'guild'; }).map(function (rec) {
      return linkTo(rec, '<b>' + esc(rec.title) + '</b>') + ' <span class="details__muted">— ' + esc(rec.meta) + '</span>';
    });
    return sectionHtml('Что такое гильдия', '<p>' + esc(GUILD_INFO.what) + '</p>') +
      sectionHtml('Сколько времени', '<p>' + esc(GUILD_INFO.time) + '</p>') +
      sectionHtml('Чем владеет', '<p>' + esc(GUILD_INFO.owns) + '</p>') +
      sectionHtml('Результат', '<p>' + esc(GUILD_INFO.output) + '</p>') +
      sectionHtml('Как читать ритм', '<p>' + esc(GUILD_INFO.cadence) + '</p>') +
      sectionHtml('Когда распускают', '<p>' + esc(GUILD_INFO.sunset) + '</p>') +
      sectionHtml('Все гильдии', listHtml(guildLinks));
  }

  function topDepartments(company, limit) {
    if (!company || !company.departments) return [];
    return Object.keys(company.departments).map(function (name) {
      return [name, company.departments[name]];
    }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, limit || 5);
  }

  function onDetailsClick(event) {
    var goto = event.target.closest ? event.target.closest('[data-goto]') : null;
    if (!goto) return;
    event.preventDefault();
    var id = resolveId(goto.getAttribute('data-goto'));
    if (id) selectNode(id, true);
  }

  /* ---------------------------------------------------------------- pointer */

  function isChromeTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('#details, #legend, #statusbar, #toast, #help-overlay, #rail, #layers, #minimap, #topbar');
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (drag || isChromeTarget(event.target)) return;
    if (!els.stage.contains(event.target)) return;

    var nodeEl = event.target.closest ? event.target.closest('.node') : null;
    if (nodeEl) {
      var id = nodeEl.getAttribute('data-node-id');
      var rec = byId[id];
      if (!rec) return;
      if (event.preventDefault) event.preventDefault();
      if (state.locked) {
        selectNode(rec.id, false);
        return;
      }
      drag = {
        mode: 'node',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        rec: rec,
        origX: rec.x,
        origY: rec.y
      };
      capturePointer(event.pointerId);
      return;
    }

    if (event.preventDefault) event.preventDefault();
    drag = {
      mode: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      tx: state.camera.tx,
      ty: state.camera.ty
    };
    capturePointer(event.pointerId);
  }

  function capturePointer(pointerId) {
    if (els.stage.setPointerCapture) {
      try { els.stage.setPointerCapture(pointerId); } catch (err) { /* ignore */ }
    }
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;

    if (!drag.started) {
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      drag.started = true;
      if (drag.mode === 'pan') setClass(els.stage, 'is-panning', true);
    }

    if (drag.mode === 'pan') {
      state.camera.tx = drag.tx + dx;
      state.camera.ty = drag.ty + dy;
      applyCamera();
      return;
    }

    if (state.locked) return;
    var rec = drag.rec;
    rec.el.classList.add('is-dragging');
    rec.x = Math.round(drag.origX + dx / state.camera.s);
    rec.y = Math.round(drag.origY + dy / state.camera.s);
    rec.el.style.left = rec.x + 'px';
    rec.el.style.top = rec.y + 'px';
    updateEdges();
    syncLabels();
    drawMinimap();
  }

  function onPointerUp(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    var current = drag;
    drag = null;

    if (els.stage.releasePointerCapture) {
      try { els.stage.releasePointerCapture(current.pointerId); } catch (err) { /* ignore */ }
    }
    setClass(els.stage, 'is-panning', false);
    if (current.rec && current.rec.el) current.rec.el.classList.remove('is-dragging');

    if (current.mode === 'node') {
      if (current.started && !state.locked) {
        state.positions[current.rec.id] = { x: current.rec.x, y: current.rec.y };
        save();
        sizeEdgeLayer();
      } else if (!current.started) {
        selectNode(current.rec.id, false);
      }
      return;
    }

    if (current.started) {
      save();
    } else {
      clearSelection();
    }
  }

  function onPointerCancel() {
    if (!drag) return;
    setClass(els.stage, 'is-panning', false);
    if (drag.rec && drag.rec.el) drag.rec.el.classList.remove('is-dragging');
    drag = null;
  }

  function onWheel(event) {
    if (isChromeTarget(event.target)) return;
    if (event.target.closest && event.target.closest('#details, #help-overlay, #minimap, #rail, #layers')) return;
    event.preventDefault();
    var factor = Math.exp(-event.deltaY * 0.0015);
    if (!isFinite(factor) || factor <= 0) factor = 1;
    zoomAt(factor, event.clientX, event.clientY);
  }

  /* ---------------------------------------------------------------- minimap interaction */

  function onMinimapDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    minimapDrag = true;
    if (els.minimap && els.minimap.setPointerCapture) {
      try { els.minimap.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
    moveCameraToWorld(minimapWorldPoint(event.clientX, event.clientY));
  }

  function onMinimapMove(event) {
    if (!minimapDrag) return;
    event.preventDefault();
    moveCameraToWorld(minimapWorldPoint(event.clientX, event.clientY));
  }

  function onMinimapUp() {
    minimapDrag = false;
    save();
  }

  /* ---------------------------------------------------------------- persistence */

  function savedCamera() {
    var saved = loadSaved();
    return !!(saved && saved.camera && isFinite(saved.camera.s) && isFinite(saved.camera.tx) && isFinite(saved.camera.ty));
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || saved.v !== 3) return null;
      return saved;
    } catch (err) {
      return null;
    }
  }

  function restoreSaved() {
    var saved = loadSaved();
    if (!saved) return;

    if (saved.positions && typeof saved.positions === 'object') {
      Object.keys(saved.positions).forEach(function (id) {
        var rec = byId[id];
        var pos = saved.positions[id];
        if (rec && pos && isFinite(pos.x) && isFinite(pos.y)) {
          rec.x = pos.x;
          rec.y = pos.y;
          rec.el.style.left = rec.x + 'px';
          rec.el.style.top = rec.y + 'px';
          state.positions[id] = { x: rec.x, y: rec.y };
        }
      });
    }

    if (saved.layers && typeof saved.layers === 'object') {
      Object.keys(state.layers).forEach(function (key) {
        if (typeof saved.layers[key] === 'boolean') state.layers[key] = saved.layers[key];
      });
    }

    if (typeof saved.locked === 'boolean') state.locked = saved.locked;

    if (saved.camera && isFinite(saved.camera.s) && isFinite(saved.camera.tx) && isFinite(saved.camera.ty)) {
      state.camera = {
        s: clamp(saved.camera.s, MIN_SCALE, MAX_SCALE),
        tx: saved.camera.tx,
        ty: saved.camera.ty
      };
    }

    setPressed(els.lock, state.locked, 'Запретить перенос карточек (L)');
    syncLockClasses();
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 180);
  }

  function saveNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: 3,
        camera: { s: state.camera.s, tx: state.camera.tx, ty: state.camera.ty },
        positions: state.positions,
        locked: state.locked,
        layers: state.layers
      }));
    } catch (err) {
      /* storage may be disabled — the board still works */
    }
  }

  /* ---------------------------------------------------------------- chrome actions */

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-visible');
      els.toast.hidden = true;
    }, 2600);
  }

  function syncLockClasses() {
    records.forEach(function (rec) {
      rec.el.classList.toggle('is-locked', state.locked);
    });
    setClass(els.stage, 'is-locked', state.locked);
    setPressed(els.lock, state.locked, state.locked ? 'Разрешить перенос карточек (L)' : 'Зафиксировать раскладку (L)');
    if (els.lock) els.lock.textContent = state.locked ? 'Разблокировать' : 'Зафиксировать';
  }

  function toggleLock() {
    state.locked = !state.locked;
    syncLockClasses();
    saveNow();
    toast(state.locked ? 'Раскладка зафиксирована' : 'Раскладка разблокирована');
  }

  function setHelp(open) {
    state.helpOpen = typeof open === 'boolean' ? open : !state.helpOpen;
    if (!els.helpOverlay) return;
    els.helpOverlay.hidden = !state.helpOpen;
    els.helpOverlay.classList.toggle('is-open', state.helpOpen);
    if (els.help) els.help.setAttribute('aria-expanded', state.helpOpen ? 'true' : 'false');
  }

  function download() {
    var data = census();
    var payload = {
      version: VERSION,
      kind: 'rox-whiteboard-export',
      exportedAt: new Date().toISOString(),
      generatedAt: board ? board.generatedAt : null,
      camera: { s: num5(state.camera.s), tx: num3(state.camera.tx), ty: num3(state.camera.ty) },
      layers: state.layers,
      locked: state.locked,
      filters: currentFilters(),
      selected: state.selectedId,
      counts: data,
      nodes: nodesSnapshot(),
      edges: edges.map(function (edge) {
        return {
          from: edge.from,
          to: edge.to,
          family: edge.family,
          label: edge.label,
          sentence: edge.sentence,
          hidden: edge.hidden
        };
      })
    };

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    var stamp = board && board.generatedAt ? String(board.generatedAt).replace(/-/g, '') : 'export';
    link.href = url;
    link.download = 'rox-whiteboard-' + stamp + '.json';
    document.body.appendChild(link);
    link.click();
    if (link.parentNode) link.parentNode.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    toast('JSON доски скачан');
  }

  function printBoard() {
    window.print();
  }

  /* ---------------------------------------------------------------- state api */

  function currentFilters() {
    return {
      search: state.search,
      division: readFilter(els.divisionFilter),
      wave: readFilter(els.waveFilter),
      status: normStatus(els.statusFilter ? els.statusFilter.value : '')
    };
  }

  function nodesSnapshot() {
    return records.map(function (rec) {
      return {
        id: rec.id,
        type: rec.type,
        title: rec.title,
        division: rec.divisionName || null,
        group: rec.groupName || null,
        status: rec.status || null,
        wave: rec.wave === '' ? null : rec.wave,
        x: rec.x,
        y: rec.y,
        w: rec.w,
        h: rec.h,
        hidden: rec.hidden,
        selected: rec.id === state.selectedId
      };
    });
  }

  function getState() {
    var data = census();
    var byFamily = { structure: 0, dependency: 0, handoff: 0, market: 0 };
    edges.forEach(function (edge) { byFamily[edge.family] = (byFamily[edge.family] || 0) + 1; });
    return {
      version: VERSION,
      ready: state.ready,
      error: state.error,
      camera: { s: num5(state.camera.s), tx: num3(state.camera.tx), ty: num3(state.camera.ty) },
      zoomPercent: Math.round(state.camera.s * 100),
      selected: state.selectedId,
      focusDivision: state.focusDivisionId,
      locked: state.locked,
      layers: {
        structure: state.layers.structure,
        dependency: state.layers.dependency,
        handoff: state.layers.handoff,
        market: state.layers.market,
        labels: state.layers.labels
      },
      filters: currentFilters(),
      counts: data.totals,
      visible: data.visible,
      edges: { total: edges.length, byFamily: byFamily },
      nodes: nodesSnapshot()
    };
  }

  /* ---------------------------------------------------------------- wiring */

  function wireUi() {
    on(els.search, 'input', function () {
      state.search = els.search.value;
      applyView();
    });
    on(els.divisionFilter, 'change', function () {
      state.focusDivisionId = '';
      applyView();
    });
    on(els.waveFilter, 'change', applyView);
    on(els.statusFilter, 'change', applyView);

    on(els.fit, 'click', function () { fit(); toast('Вся доска вписана в экран'); });
    on(els.zoomOut, 'click', function () { zoomBy(1 / 1.2); });
    on(els.zoomIn, 'click', function () { zoomBy(1.2); });
    on(els.reset, 'click', resetLayout);
    on(els.download, 'click', download);
    on(els.print, 'click', printBoard);
    on(els.lock, 'click', toggleLock);
    on(els.help, 'click', function () { setHelp(); });

    if (els.toggleEdges) {
      on(els.toggleEdges, 'click', function () { toggleLayer('dependency'); });
    }

    Object.keys(LAYER_IDS).forEach(function (key) {
      var control = $(LAYER_IDS[key]);
      if (!control) return;
      var eventName = isCheckbox(control) ? 'change' : 'click';
      on(control, eventName, function () {
        if (isCheckbox(control)) {
          state.layers[key] = !!control.checked;
          syncLayerControls();
          applyView();
          saveNow();
          toast((control.checked ? 'Включено: ' : 'Скрыто: ') + LAYER_TITLES[key]);
        } else {
          toggleLayer(key);
        }
      });
    });

    var layersBtn = $('toggle-layers');
    if (layersBtn) {
      if (isCheckbox(layersBtn)) {
        on(layersBtn, 'change', function () {
          state.layersOpen = !!layersBtn.checked;
          syncLayersPanel();
        });
      } else {
        on(layersBtn, 'click', function () {
          state.layersOpen = !state.layersOpen;
          syncLayersPanel();
          syncLayerControls();
        });
      }
    }

    on(els.railToggle, 'click', toggleRail);

    on(els.detailsClose, 'click', function (event) {
      if (event) event.preventDefault();
      clearSelection();
    });
    on(els.detailsBody, 'click', onDetailsClick);

    on(els.helpOverlay, 'click', function (event) {
      var close = event.target.closest ? event.target.closest('[data-close]') : null;
      var panel = event.target.closest ? event.target.closest('.help-overlay__panel') : null;
      if (close || !panel) setHelp(false);
    });

    on(els.stage, 'pointerdown', onPointerDown);
    on(els.stage, 'pointermove', onPointerMove);
    on(els.stage, 'pointerup', onPointerUp);
    on(els.stage, 'pointercancel', onPointerCancel);
    on(els.stage, 'lostpointercapture', onPointerCancel);
    if (els.stage.addEventListener) {
      els.stage.addEventListener('wheel', onWheel, { passive: false });
    }

    on(els.minimap, 'pointerdown', onMinimapDown);
    on(els.minimap, 'pointermove', onMinimapMove);
    on(els.minimap, 'pointerup', onMinimapUp);
    on(els.minimap, 'pointercancel', onMinimapUp);

    on(els.stage, 'dblclick', function (event) {
      if (event.target.closest && event.target.closest('.node')) return;
      if (isChromeTarget(event.target)) return;
      event.preventDefault();
      zoomAt(1.25, event.clientX, event.clientY);
    });

    on(els.stage, 'keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        var nodeEl = event.target.closest ? event.target.closest('.node') : null;
        if (nodeEl) {
          event.preventDefault();
          selectNode(nodeEl.getAttribute('data-node-id'), false);
        }
      }
    });

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', saveNow);
    window.addEventListener('resize', function () {
      drawMinimap();
    });
  }

  function onKeyDown(event) {
    var target = event.target;
    var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable);

    if (event.key === 'Escape') {
      if (state.helpOpen) { setHelp(false); return; }
      if (state.selectedId) { clearSelection(); return; }
      if (typing && target.blur) target.blur();
      return;
    }

    if (typing) return;

    var key = event.key;
    if (key === '/') {
      event.preventDefault();
      if (els.search) els.search.focus();
    } else if (key === 'f' || key === 'F' || key === 'а' || key === 'А') {
      event.preventDefault();
      fit();
    } else if (key === '+' || key === '=' || key === 'Add') {
      event.preventDefault();
      zoomBy(1.2);
    } else if (key === '-' || key === '_' || key === 'Subtract') {
      event.preventDefault();
      zoomBy(1 / 1.2);
    } else if (key === '0') {
      event.preventDefault();
      var rect = els.stage.getBoundingClientRect();
      zoomAt(1 / state.camera.s, rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else if (key === 'e' || key === 'E' || key === 'у' || key === 'У') {
      event.preventDefault();
      toggleLayer('dependency');
    } else if (key === 'l' || key === 'L' || key === 'д' || key === 'Д') {
      event.preventDefault();
      toggleLock();
    } else if (key === 'h' || key === 'H' || key === '?' || key === 'р' || key === 'Р') {
      event.preventDefault();
      setHelp();
    }
  }

  function setStatusMeta() {
    if (!els.statusbar) return;
    var byFamily = { structure: 0, dependency: 0, handoff: 0, market: 0 };
    edges.forEach(function (edge) { byFamily[edge.family] += 1; });
    var text = 'Данные на ' + (board.generatedAt || '—') +
      ' · схема v' + VERSION +
      ' · узлов ' + records.length +
      ' · связей ' + edges.length +
      ' (структура ' + byFamily.structure + ', зависимости ' + byFamily.dependency +
      ', передачи ' + byFamily.handoff + ', спрос ' + byFamily.market + ')';
    els.statusbar.title = text;
    var meta = els.statusbar.querySelector('.statusbar__meta');
    if (!meta) {
      meta = document.createElement('span');
      meta.className = 'statusbar__meta';
      els.statusbar.appendChild(meta);
    }
    meta.textContent = 'Данные на ' + (board.generatedAt || '—') +
      ' · узлов ' + records.length + ' · связей ' + edges.length;
  }

  function populateFilters() {
    if (!board) return;

    if (els.divisionFilter) {
      els.divisionFilter.textContent = '';
      var all = document.createElement('option');
      all.value = 'all';
      all.textContent = 'Все направления';
      els.divisionFilter.appendChild(all);
      board.divisions.forEach(function (division) {
        var option = document.createElement('option');
        option.value = division.slug || slugify(division.name);
        option.textContent = division.name;
        els.divisionFilter.appendChild(option);
      });
      els.divisionFilter.value = 'all';
    }

    if (els.waveFilter) {
      els.waveFilter.textContent = '';
      var anyWave = document.createElement('option');
      anyWave.value = 'all';
      anyWave.textContent = 'Любая волна';
      els.waveFilter.appendChild(anyWave);
      var waves = [];
      (board.tasks || []).forEach(function (task) {
        if (waves.indexOf(task.wave) === -1) waves.push(task.wave);
      });
      waves.sort(function (a, b) { return a - b; });
      waves.forEach(function (wave) {
        var option = document.createElement('option');
        option.value = String(wave);
        option.textContent = 'Волна ' + wave;
        els.waveFilter.appendChild(option);
      });
      els.waveFilter.value = 'all';
    }

    if (els.statusFilter) {
      els.statusFilter.textContent = '';
      var anyStatus = document.createElement('option');
      anyStatus.value = 'all';
      anyStatus.textContent = 'Любой статус';
      els.statusFilter.appendChild(anyStatus);
      [['ready', 'готова'], ['proposed', 'предложена']].forEach(function (pair) {
        var option = document.createElement('option');
        option.value = pair[0];
        option.textContent = pair[1];
        els.statusFilter.appendChild(option);
      });
      els.statusFilter.value = 'all';
    }
  }

  function ensureLegendTerms() {
    var legend = $('legend');
    if (!legend) return;
    if (legend.textContent.indexOf('входит в') !== -1) return;
    var box = document.createElement('div');
    box.className = 'legend__edges';
    box.innerHTML =
      '<span><i class="line line--structure"></i>входит в</span>' +
      '<span><i class="line line--structure"></i>содержит</span>' +
      '<span><i class="line line--dependency"></i>зависит от</span>' +
      '<span><i class="line line--handoff"></i>передаёт результат</span>' +
      '<span><i class="line line--market"></i>подтверждает спрос</span>';
    legend.appendChild(box);
  }

  /* ---------------------------------------------------------------- start */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
