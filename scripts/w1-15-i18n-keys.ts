/**
 * One-off generator (W1-15 #1512): adds the chrome / agent-panel / xfn locale
 * keys to all 12 locales, keeping ASCII key order. Deleted after the run.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hu', 'ja', 'ko', 'pl', 'ru', 'zh-Hans', 'zh-Hant'] as const
type Locale = (typeof LOCALES)[number]

const T: Record<string, Record<Locale, string>> = {
  // ---------------------------------------------------------------- agentPanel
  'agentPanel.title': { ar: '@rox', de: '@rox', en: '@rox', es: '@rox', fr: '@rox', hu: '@rox', ja: '@rox', ko: '@rox', pl: '@rox', ru: '@rox', 'zh-Hans': '@rox', 'zh-Hant': '@rox' },
  'agentPanel.placeholder': {
    ar: 'اسأل @rox أو أعطه مهمة…', de: 'Frage @rox oder gib eine Aufgabe…', en: 'Ask @rox or give it a task…',
    es: 'Pregunta a @rox o dale una tarea…', fr: 'Demandez à @rox ou confiez-lui une tâche…', hu: 'Kérdezd @rox-ot, vagy adj neki feladatot…',
    ja: '@rox に質問するかタスクを依頼…', ko: '@rox에게 묻거나 작업을 맡기세요…', pl: 'Zapytaj @rox lub zleć mu zadanie…',
    ru: 'Спросите @rox или дайте поручение…', 'zh-Hans': '询问 @rox 或交给它一个任务…', 'zh-Hant': '詢問 @rox 或交給它一個任務…',
  },
  'agentPanel.newTopic': {
    ar: 'موضوع جديد', de: 'Neues Thema', en: 'New topic', es: 'Tema nuevo', fr: 'Nouveau sujet', hu: 'Új téma',
    ja: '新しいトピック', ko: '새 주제', pl: 'Nowy wątek', ru: 'Новая тема', 'zh-Hans': '新话题', 'zh-Hant': '新話題',
  },
  'agentPanel.history': {
    ar: 'السجل', de: 'Verlauf', en: 'History', es: 'Historial', fr: 'Historique', hu: 'Előzmények',
    ja: '履歴', ko: '기록', pl: 'Historia', ru: 'История', 'zh-Hans': '历史', 'zh-Hant': '歷史',
  },
  'agentPanel.openInChat': {
    ar: 'فتح في الدردشة', de: 'Im Chat öffnen', en: 'Open in Chat', es: 'Abrir en el chat', fr: 'Ouvrir dans le chat',
    hu: 'Megnyitás csevegésben', ja: 'チャットで開く', ko: '채팅에서 열기', pl: 'Otwórz w czacie', ru: 'Открыть в Чате',
    'zh-Hans': '在聊天中打开', 'zh-Hant': '在聊天中開啟',
  },
  'agentPanel.context': {
    ar: 'السياق', de: 'Kontext', en: 'Context', es: 'Contexto', fr: 'Contexte', hu: 'Kontextus',
    ja: 'コンテキスト', ko: '컨텍스트', pl: 'Kontekst', ru: 'Контекст', 'zh-Hans': '上下文', 'zh-Hant': '上下文',
  },
  'agentPanel.addContext': {
    ar: 'إضافة', de: 'Hinzufügen', en: 'Add', es: 'Añadir', fr: 'Ajouter', hu: 'Hozzáadás',
    ja: '追加', ko: '추가', pl: 'Dodaj', ru: 'Добавить', 'zh-Hans': '添加', 'zh-Hant': '新增',
  },
  'agentPanel.privateChip': {
    ar: 'ملاحظة خاصة — إرفاق؟', de: 'Private Notiz — anhängen?', en: 'Private note — attach?',
    es: 'Nota privada — ¿adjuntar?', fr: 'Note privée — joindre ?', hu: 'Privát jegyzet — csatolod?',
    ja: 'プライベートノート — 添付しますか？', ko: '비공개 노트 — 첨부할까요?', pl: 'Notatka prywatna — dołączyć?',
    ru: 'Личная заметка — добавить?', 'zh-Hans': '私人笔记 — 附加？', 'zh-Hant': '私人筆記 — 附加？',
  },
  'agentPanel.movedTo': {
    ar: 'انتقلت إلى {{surface}} · {{title}}', de: 'Gewechselt zu {{surface}} · {{title}}', en: 'Moved to {{surface}} · {{title}}',
    es: 'Cambió a {{surface}} · {{title}}', fr: 'Passage à {{surface}} · {{title}}', hu: 'Átlépés: {{surface}} · {{title}}',
    ja: '{{surface}} へ移動 · {{title}}', ko: '{{surface}}(으)로 이동 · {{title}}', pl: 'Przejście do {{surface}} · {{title}}',
    ru: 'Перешли в {{surface}} · {{title}}', 'zh-Hans': '已切换到 {{surface}} · {{title}}', 'zh-Hant': '已切換到 {{surface}} · {{title}}',
  },
  'agentPanel.noWidth': {
    ar: 'عرض النافذة غير كافٍ', de: 'Nicht genug Fensterbreite', en: 'Not enough window width',
    es: 'Ancho de ventana insuficiente', fr: 'Largeur de fenêtre insuffisante', hu: 'Nincs elég ablakméret',
    ja: 'ウィンドウ幅が足りません', ko: '창 너비가 부족합니다', pl: 'Za mała szerokość okna',
    ru: 'Недостаточно ширины окна', 'zh-Hans': '窗口宽度不足', 'zh-Hant': '視窗寬度不足',
  },
  'agentPanel.askAbout': {
    ar: 'اسأل @rox', de: '@rox fragen', en: 'Ask @rox', es: 'Preguntar a @rox', fr: 'Demander à @rox',
    hu: '@rox megkérdezése', ja: '@rox に聞く', ko: '@rox에게 묻기', pl: 'Zapytaj @rox', ru: 'Спросить @rox',
    'zh-Hans': '询问 @rox', 'zh-Hant': '詢問 @rox',
  },
  'agentPanel.privacyHint': {
    ar: 'يرى الوكيل فقط ما يمكنك الوصول إليه وما هو موجود في شريط السياق',
    de: 'Der Agent sieht nur, worauf du Zugriff hast und was in der Kontextleiste steht',
    en: 'The agent sees only what you can access and what is in the context bar',
    es: 'El agente solo ve lo que puedes ver tú y lo que está en la barra de contexto',
    fr: "L'agent ne voit que ce à quoi vous avez accès et ce qui figure dans la barre de contexte",
    hu: 'Az ügynök csak azt látja, amihez hozzáférésed van, és ami a kontextussávban van',
    ja: 'エージェントが見るのは、あなたがアクセスできるものとコンテキストバーにあるものだけです',
    ko: '에이전트는 접근 권한이 있는 항목과 컨텍스트 표시줄의 내용만 봅니다',
    pl: 'Agent widzi tylko to, do czego masz dostęp, i to, co jest na pasku kontekstu',
    ru: 'Агент видит только то, к чему у вас есть доступ, и только то, что в строке контекста',
    'zh-Hans': '代理只能看到你有权访问的内容以及上下文栏中的内容',
    'zh-Hant': '代理只能看到你有權存取的內容以及上下文列中的內容',
  },
  'agentPanel.minimise': {
    ar: 'تصغير', de: 'Minimieren', en: 'Minimise', es: 'Minimizar', fr: 'Réduire', hu: 'Kis méret',
    ja: '最小化', ko: '최소화', pl: 'Zwiń', ru: 'Свернуть', 'zh-Hans': '最小化', 'zh-Hant': '最小化',
  },
  'agentPanel.hide': {
    ar: 'إخفاء', de: 'Ausblenden', en: 'Hide', es: 'Ocultar', fr: 'Masquer', hu: 'Elrejtés',
    ja: '非表示', ko: '숨기기', pl: 'Ukryj', ru: 'Скрыть', 'zh-Hans': '隐藏', 'zh-Hant': '隱藏',
  },
  'agentPanel.quickActions': {
    ar: 'إجراءات سريعة', de: 'Schnellaktionen', en: 'Quick actions', es: 'Acciones rápidas', fr: 'Actions rapides',
    hu: 'Gyors műveletek', ja: 'クイック操作', ko: '빠른 작업', pl: 'Szybkie akcje', ru: 'Быстрые действия',
    'zh-Hans': '快捷操作', 'zh-Hant': '快速操作',
  },
  'agentPanel.paused': {
    ar: 'الوكيل متوقف مؤقتًا', de: 'Agent pausiert', en: 'Agent paused', es: 'Agente en pausa', fr: 'Agent en pause',
    hu: 'Az ügynök szünetel', ja: 'エージェントは一時停止中', ko: '에이전트 일시 중지됨', pl: 'Agent wstrzymany',
    ru: 'Агент приостановлен', 'zh-Hans': '代理已暂停', 'zh-Hant': '代理已暫停',
  },
  'agentPanel.resume': {
    ar: 'استئناف', de: 'Fortsetzen', en: 'Resume', es: 'Reanudar', fr: 'Reprendre', hu: 'Folytatás',
    ja: '再開', ko: '재개', pl: 'Wznów', ru: 'Возобновить', 'zh-Hans': '继续', 'zh-Hant': '繼續',
  },
  'agentPanel.restricted': {
    ar: 'لا يوجد وصول', de: 'Kein Zugriff', en: 'No access', es: 'Sin acceso', fr: 'Aucun accès',
    hu: 'Nincs hozzáférés', ja: 'アクセスなし', ko: '접근 권한 없음', pl: 'Brak dostępu', ru: 'Нет доступа',
    'zh-Hans': '无访问权限', 'zh-Hant': '無存取權限',
  },
  'agentPanel.thinking': {
    ar: '@rox يفكر…', de: '@rox denkt nach…', en: '@rox is thinking…', es: '@rox está pensando…',
    fr: '@rox réfléchit…', hu: '@rox gondolkodik…', ja: '@rox が考えています…', ko: '@rox이(가) 생각 중…',
    pl: '@rox myśli…', ru: '@rox думает…', 'zh-Hans': '@rox 正在思考…', 'zh-Hant': '@rox 正在思考…',
  },
  'agentPanel.askAboutSelection': {
    ar: 'اسأل عن التحديد', de: 'Zum Ausgewählten fragen', en: 'Ask about the selection', es: 'Preguntar por lo seleccionado',
    fr: 'Demander à propos de la sélection', hu: 'Kérdés a kijelölésről', ja: '選択範囲について聞く',
    ko: '선택 항목에 대해 묻기', pl: 'Zapytaj o zaznaczenie', ru: 'Спросить о выделенном',
    'zh-Hans': '询问所选内容', 'zh-Hant': '詢問所選內容',
  },
  'agentPanel.attachSelection': {
    ar: 'إرفاق التحديد', de: 'Auswahl anhängen', en: 'Attach the selection', es: 'Adjuntar lo seleccionado',
    fr: 'Joindre la sélection', hu: 'Kijelölés csatolása', ja: '選択範囲を添付', ko: '선택 항목 첨부',
    pl: 'Dołącz zaznaczenie', ru: 'Прикрепить выделенное', 'zh-Hans': '附加所选内容', 'zh-Hant': '附加所選內容',
  },
  'agentPanel.removeChip': {
    ar: 'إزالة من السياق', de: 'Aus dem Kontext entfernen', en: 'Remove from the context', es: 'Quitar del contexto',
    fr: 'Retirer du contexte', hu: 'Eltávolítás a kontextusból', ja: 'コンテキストから外す', ko: '컨텍스트에서 제거',
    pl: 'Usuń z kontekstu', ru: 'Убрать из контекста', 'zh-Hans': '从上下文移除', 'zh-Hant': '從上下文移除',
  },
  'agentPanel.offline': {
    ar: 'لا اتصال بالنموذج. ستُرسل الرسائل عند عودة الاتصال', de: 'Keine Verbindung zum Modell. Nachrichten werden gesendet, sobald die Verbindung zurück ist',
    en: 'No connection to the model. Messages will be sent when the connection returns',
    es: 'Sin conexión con el modelo. Los mensajes se enviarán cuando vuelva la conexión',
    fr: 'Pas de connexion au modèle. Les messages seront envoyés dès le retour de la connexion',
    hu: 'Nincs kapcsolat a modellel. Az üzenetek a kapcsolat visszatérésekor mennek el',
    ja: 'モデルに接続できません。接続が戻り次第、メッセージを送信します',
    ko: '모델에 연결되지 않았습니다. 연결이 복구되면 메시지가 전송됩니다',
    pl: 'Brak połączenia z modelem. Wiadomości zostaną wysłane po przywróceniu połączenia',
    ru: 'Нет соединения с моделью. Сообщения отправятся, когда связь появится',
    'zh-Hans': '无法连接模型。连接恢复后将发送消息', 'zh-Hant': '無法連接模型。連線恢復後將傳送訊息',
  },

  // ------------------------------------------------------------ chrome / rows
  'chrome.rowContext.open': {
    ar: 'فتح', de: 'Öffnen', en: 'Open', es: 'Abrir', fr: 'Ouvrir', hu: 'Megnyitás', ja: '開く', ko: '열기',
    pl: 'Otwórz', ru: 'Открыть', 'zh-Hans': '打开', 'zh-Hant': '開啟',
  },
  'chrome.rowContext.openNewTab': {
    ar: 'فتح في تبويب جديد', de: 'In neuem Tab öffnen', en: 'Open in a new tab', es: 'Abrir en una pestaña nueva',
    fr: 'Ouvrir dans un nouvel onglet', hu: 'Megnyitás új lapon', ja: '新しいタブで開く', ko: '새 탭에서 열기',
    pl: 'Otwórz w nowej karcie', ru: 'Открыть в новой вкладке', 'zh-Hans': '在新标签页中打开', 'zh-Hant': '在新分頁中開啟',
  },
  'chrome.rowContext.openSplit': {
    ar: 'فتح على اليمين', de: 'Rechts öffnen', en: 'Open on the right', es: 'Abrir a la derecha',
    fr: 'Ouvrir à droite', hu: 'Megnyitás jobb oldalon', ja: '右側で開く', ko: '오른쪽에서 열기',
    pl: 'Otwórz po prawej', ru: 'Открыть справа', 'zh-Hans': '在右侧打开', 'zh-Hant': '在右側開啟',
  },
  'chrome.rowContext.pin': {
    ar: 'تثبيت', de: 'Anheften', en: 'Pin', es: 'Fijar', fr: 'Épingler', hu: 'Rögzítés', ja: 'ピン留め',
    ko: '고정', pl: 'Przypnij', ru: 'Закрепить', 'zh-Hans': '固定', 'zh-Hant': '釘選',
  },
  'chrome.rowContext.unpin': {
    ar: 'إلغاء التثبيت', de: 'Loslösen', en: 'Unpin', es: 'Quitar fijado', fr: 'Détacher', hu: 'Rögzítés feloldása',
    ja: 'ピン留めを解除', ko: '고정 해제', pl: 'Odepnij', ru: 'Открепить', 'zh-Hans': '取消固定', 'zh-Hant': '取消釘選',
  },
  'chrome.rowContext.copyLink': {
    ar: 'نسخ الرابط', de: 'Link kopieren', en: 'Copy link', es: 'Copiar enlace', fr: 'Copier le lien',
    hu: 'Hivatkozás másolása', ja: 'リンクをコピー', ko: '링크 복사', pl: 'Kopiuj link', ru: 'Копировать ссылку',
    'zh-Hans': '复制链接', 'zh-Hant': '複製連結',
  },
  'chrome.rowContext.shareToChat': {
    ar: 'مشاركة في الدردشة…', de: 'In Chat teilen…', en: 'Share to chat…', es: 'Compartir en el chat…',
    fr: 'Partager dans le chat…', hu: 'Megosztás csevegésben…', ja: 'チャットに共有…', ko: '채팅에 공유…',
    pl: 'Udostępnij na czacie…', ru: 'Поделиться в чат…', 'zh-Hans': '分享到聊天…', 'zh-Hant': '分享到聊天…',
  },
  'chrome.rowContext.askRox': {
    ar: 'اسأل @rox', de: '@rox fragen', en: 'Ask @rox', es: 'Preguntar a @rox', fr: 'Demander à @rox',
    hu: '@rox megkérdezése', ja: '@rox に聞く', ko: '@rox에게 묻기', pl: 'Zapytaj @rox', ru: 'Спросить @rox',
    'zh-Hans': '询问 @rox', 'zh-Hant': '詢問 @rox',
  },
  'chrome.rowContext.remind': {
    ar: 'تذكير…', de: 'Erinnern…', en: 'Remind me…', es: 'Recordarme…', fr: 'Me rappeler…', hu: 'Emlékeztető…',
    ja: 'リマインド…', ko: '알림…', pl: 'Przypomnij…', ru: 'Напомнить…', 'zh-Hans': '提醒…', 'zh-Hant': '提醒…',
  },
  'chrome.rowContext.rename': {
    ar: 'إعادة تسمية', de: 'Umbenennen', en: 'Rename', es: 'Renombrar', fr: 'Renommer', hu: 'Átnevezés',
    ja: '名前を変更', ko: '이름 바꾸기', pl: 'Zmień nazwę', ru: 'Переименовать', 'zh-Hans': '重命名', 'zh-Hant': '重新命名',
  },
  'chrome.rowContext.archive': {
    ar: 'أرشفة', de: 'Archivieren', en: 'Archive', es: 'Archivar', fr: 'Archiver', hu: 'Archiválás',
    ja: 'アーカイブ', ko: '보관', pl: 'Archiwizuj', ru: 'Архивировать', 'zh-Hans': '归档', 'zh-Hant': '封存',
  },
  'chrome.rowContext.delete': {
    ar: 'حذف', de: 'Löschen', en: 'Delete', es: 'Eliminar', fr: 'Supprimer', hu: 'Törlés',
    ja: '削除', ko: '삭제', pl: 'Usuń', ru: 'Удалить', 'zh-Hans': '删除', 'zh-Hant': '刪除',
  },

  // --------------------------------------------------------- chrome / sections
  'chrome.section.pinned': {
    ar: 'المثبتة', de: 'Angeheftet', en: 'Pinned', es: 'Fijado', fr: 'Épinglé', hu: 'Rögzített',
    ja: 'ピン留め', ko: '고정됨', pl: 'Przypięte', ru: 'Закреплённое', 'zh-Hans': '已固定', 'zh-Hant': '已釘選',
  },
  'chrome.section.today': {
    ar: 'اليوم', de: 'Heute', en: 'Today', es: 'Hoy', fr: "Aujourd'hui", hu: 'Ma', ja: '今日', ko: '오늘',
    pl: 'Dzisiaj', ru: 'Сегодня', 'zh-Hans': '今天', 'zh-Hant': '今天',
  },
  'chrome.section.upcoming': {
    ar: 'القادمة', de: 'Demnächst', en: 'Upcoming', es: 'Próximos', fr: 'À venir', hu: 'Közelgő',
    ja: '今後', ko: '예정', pl: 'Nadchodzące', ru: 'Предстоящие', 'zh-Hans': '即将到来', 'zh-Hant': '即將到來',
  },
  'chrome.section.recent': {
    ar: 'الأحدث', de: 'Zuletzt verwendet', en: 'Recent', es: 'Recientes', fr: 'Récents', hu: 'Legutóbbi',
    ja: '最近', ko: '최근', pl: 'Ostatnie', ru: 'Недавние', 'zh-Hans': '最近', 'zh-Hant': '最近',
  },
  'chrome.section.history': {
    ar: 'السجل', de: 'Verlauf', en: 'History', es: 'Historial', fr: 'Historique', hu: 'Előzmények',
    ja: '履歴', ko: '기록', pl: 'Historia', ru: 'История', 'zh-Hans': '历史', 'zh-Hant': '歷史',
  },
  'chrome.section.filters': {
    ar: 'عوامل التصفية', de: 'Filter', en: 'Filters', es: 'Filtros', fr: 'Filtres', hu: 'Szűrők',
    ja: 'フィルター', ko: '필터', pl: 'Filtry', ru: 'Фильтры', 'zh-Hans': '筛选', 'zh-Hant': '篩選',
  },
  'chrome.section.lists': {
    ar: 'القوائم', de: 'Listen', en: 'Lists', es: 'Listas', fr: 'Listes', hu: 'Listák',
    ja: 'リスト', ko: '목록', pl: 'Listy', ru: 'Списки', 'zh-Hans': '列表', 'zh-Hant': '清單',
  },
  'chrome.section.views': {
    ar: 'العروض', de: 'Ansichten', en: 'Views', es: 'Vistas', fr: 'Vues', hu: 'Nézetek',
    ja: 'ビュー', ko: '보기', pl: 'Widoki', ru: 'Виды', 'zh-Hans': '视图', 'zh-Hant': '檢視',
  },
  'chrome.section.shared': {
    ar: 'المشتركة معي', de: 'Mit mir geteilt', en: 'Shared with me', es: 'Compartido conmigo',
    fr: 'Partagé avec moi', hu: 'Velem megosztva', ja: '共有されたもの', ko: '나와 공유됨', pl: 'Udostępnione mi',
    ru: 'Общие со мной', 'zh-Hans': '与我共享', 'zh-Hant': '與我共用',
  },
  'chrome.section.personal': {
    ar: 'شخصي', de: 'Persönlich', en: 'Personal', es: 'Personal', fr: 'Personnel', hu: 'Személyes',
    ja: '個人', ko: '개인', pl: 'Osobiste', ru: 'Личное', 'zh-Hans': '个人', 'zh-Hant': '個人',
  },
  'chrome.section.collections': {
    ar: 'المجموعات', de: 'Sammlungen', en: 'Collections', es: 'Colecciones', fr: 'Collections',
    hu: 'Gyűjtemények', ja: 'コレクション', ko: '컬렉션', pl: 'Kolekcje', ru: 'Коллекции',
    'zh-Hans': '合集', 'zh-Hant': '合輯',
  },
  'chrome.section.people': {
    ar: 'الأشخاص', de: 'Personen', en: 'People', es: 'Personas', fr: 'Personnes', hu: 'Személyek',
    ja: 'メンバー', ko: '사람', pl: 'Osoby', ru: 'Люди', 'zh-Hans': '成员', 'zh-Hant': '成員',
  },
  'chrome.section.sources': {
    ar: 'المصادر', de: 'Quellen', en: 'Sources', es: 'Fuentes', fr: 'Sources', hu: 'Források',
    ja: 'ソース', ko: '소스', pl: 'Źródła', ru: 'Источники', 'zh-Hans': '来源', 'zh-Hant': '來源',
  },
  'chrome.section.trash': {
    ar: 'سلة المحذوفات', de: 'Papierkorb', en: 'Trash', es: 'Papelera', fr: 'Corbeille', hu: 'Lomtár',
    ja: 'ゴミ箱', ko: '휴지통', pl: 'Kosz', ru: 'Корзина', 'zh-Hans': '回收站', 'zh-Hant': '垃圾桶',
  },
  'chrome.section.recordings': {
    ar: 'التسجيلات', de: 'Aufzeichnungen', en: 'Recordings', es: 'Grabaciones', fr: 'Enregistrements',
    hu: 'Felvételek', ja: '録画', ko: '녹음', pl: 'Nagrania', ru: 'Записи', 'zh-Hans': '录制', 'zh-Hant': '錄製',
  },
  'chrome.section.templates': {
    ar: 'القوالب', de: 'Vorlagen', en: 'Templates', es: 'Plantillas', fr: 'Modèles', hu: 'Sablonok',
    ja: 'テンプレート', ko: '템플릿', pl: 'Szablony', ru: 'Шаблоны', 'zh-Hans': '模板', 'zh-Hant': '範本',
  },

  // --------------------------------------------------------- chrome / counters
  'chrome.counter.action': {
    ar: 'يتطلب إجراءك: {{count}}', de: 'Erfordert deine Aktion: {{count}}', en: 'Needs your action: {{count}}',
    es: 'Requiere tu acción: {{count}}', fr: 'Nécessite votre action : {{count}}', hu: 'Beavatkozást igényel: {{count}}',
    ja: '対応が必要: {{count}}', ko: '조치 필요: {{count}}', pl: 'Wymaga działania: {{count}}',
    ru: 'Требуется действие: {{count}}', 'zh-Hans': '需要你处理：{{count}}', 'zh-Hant': '需要你處理：{{count}}',
  },
  'chrome.counter.volume': {
    ar: 'العدد: {{count}}', de: 'Anzahl: {{count}}', en: 'Count: {{count}}', es: 'Cantidad: {{count}}',
    fr: 'Nombre : {{count}}', hu: 'Darabszám: {{count}}', ja: '件数: {{count}}', ko: '개수: {{count}}',
    pl: 'Liczba: {{count}}', ru: 'Количество: {{count}}', 'zh-Hans': '数量：{{count}}', 'zh-Hant': '數量：{{count}}',
  },
  'chrome.counter.items_one': {
    ar: 'عنصر واحد', de: '{{count}} Element', en: '{{count}} item', es: '{{count}} elemento', fr: '{{count}} élément',
    hu: '{{count}} elem', ja: '{{count}} 件', ko: '{{count}}개 항목', pl: '{{count}} element',
    ru: '{{count}} элемент', 'zh-Hans': '{{count}} 项', 'zh-Hant': '{{count}} 項',
  },
  'chrome.counter.items_other': {
    ar: '{{count}} عناصر', de: '{{count}} Elemente', en: '{{count}} items', es: '{{count}} elementos',
    fr: '{{count}} éléments', hu: '{{count}} elem', ja: '{{count}} 件', ko: '{{count}}개 항목',
    pl: '{{count}} elementów', ru: '{{count}} элементов', 'zh-Hans': '{{count}} 项', 'zh-Hant': '{{count}} 項',
  },

  // --------------------------------------------------------- chrome / settings
  'chrome.settings.title': {
    ar: 'الألواح والأشرطة الجانبية', de: 'Panels und Seitenleisten', en: 'Panels and sidebars',
    es: 'Paneles y barras laterales', fr: 'Panneaux et barres latérales', hu: 'Panelek és oldalsávok',
    ja: 'パネルとサイドバー', ko: '패널 및 사이드바', pl: 'Panele i paski boczne',
    ru: 'Панели и боковые панели', 'zh-Hans': '面板与侧边栏', 'zh-Hant': '面板與側邊欄',
  },
  'chrome.settings.autoCollapse': {
    ar: 'طيّ الشريط الجانبي تلقائيًا عند فتح @rox', de: 'Seitenleiste automatisch einklappen, wenn @rox geöffnet wird',
    en: 'Collapse the sidebar automatically when @rox opens', es: 'Contraer la barra lateral al abrir @rox',
    fr: "Replier la barre latérale automatiquement à l'ouverture de @rox",
    hu: 'Az oldalsáv automatikus összecsukása @rox megnyitásakor', ja: '@rox を開いたらサイドバーを自動で折りたたむ',
    ko: '@rox을 열면 사이드바 자동 접기', pl: 'Zwijaj pasek boczny automatycznie przy otwarciu @rox',
    ru: 'Сворачивать автоматически при открытии @rox', 'zh-Hans': '打开 @rox 时自动折叠侧边栏',
    'zh-Hant': '開啟 @rox 時自動收合側邊欄',
  },
  'chrome.settings.showCounters': {
    ar: 'العدادات', de: 'Zähler', en: 'Counters', es: 'Contadores', fr: 'Compteurs', hu: 'Számlálók',
    ja: 'カウンター', ko: '카운터', pl: 'Liczniki', ru: 'Счётчики', 'zh-Hans': '计数', 'zh-Hant': '計數',
  },
  'chrome.settings.countersRed': {
    ar: 'ما يتطلب إجراءً فقط', de: 'Nur Aktionen', en: 'Needs action only', es: 'Solo lo que requiere acción',
    fr: 'Actions uniquement', hu: 'Csak a beavatkozást igénylők', ja: '対応が必要なもののみ', ko: '조치 필요 항목만',
    pl: 'Tylko wymagające działania', ru: 'Только требующие действия', 'zh-Hans': '仅需要处理的',
    'zh-Hant': '僅需要處理的',
  },
  'chrome.settings.countersAll': {
    ar: 'الكل', de: 'Alle', en: 'All', es: 'Todos', fr: 'Tous', hu: 'Mind', ja: 'すべて', ko: '모두',
    pl: 'Wszystkie', ru: 'Все', 'zh-Hans': '全部', 'zh-Hant': '全部',
  },
  'chrome.settings.countersNone': {
    ar: 'لا شيء', de: 'Keine', en: 'None', es: 'Ninguno', fr: 'Aucun', hu: 'Egyik sem', ja: 'なし', ko: '없음',
    pl: 'Brak', ru: 'Нет', 'zh-Hans': '无', 'zh-Hant': '無',
  },
  'chrome.settings.showPinned': {
    ar: 'إظهار «المثبتة»', de: '«Angeheftet» anzeigen', en: 'Show «Pinned»', es: 'Mostrar «Fijado»',
    fr: 'Afficher « Épinglé »', hu: '«Rögzített» megjelenítése', ja: '「ピン留め」を表示', ko: '«고정됨» 표시',
    pl: 'Pokaż «Przypięte»', ru: 'Показывать «Закреплённое»', 'zh-Hans': '显示「已固定」', 'zh-Hant': '顯示「已釘選」',
  },
  'chrome.settings.reset': {
    ar: 'إعادة ضبط التخطيط', de: 'Layout zurücksetzen', en: 'Reset layout', es: 'Restablecer diseño',
    fr: 'Réinitialiser la disposition', hu: 'Elrendezés visszaállítása', ja: 'レイアウトをリセット',
    ko: '레이아웃 초기화', pl: 'Przywróć układ', ru: 'Сбросить раскладку', 'zh-Hans': '重置布局', 'zh-Hant': '重設版面',
  },
  'chrome.settings.agentOpenAtLaunch': {
    ar: 'الفتح عند بدء التشغيل', de: 'Beim Start öffnen', en: 'Open at launch', es: 'Abrir al iniciar',
    fr: 'Ouvrir au démarrage', hu: 'Megnyitás indításkor', ja: '起動時に開く', ko: '시작 시 열기',
    pl: 'Otwieraj przy starcie', ru: 'Открывать при запуске', 'zh-Hans': '启动时打开', 'zh-Hant': '啟動時開啟',
  },
  'chrome.settings.agentAutoContext': {
    ar: 'إرفاق السياق تلقائيًا', de: 'Kontext automatisch anhängen', en: 'Attach context automatically',
    es: 'Adjuntar el contexto automáticamente', fr: 'Joindre le contexte automatiquement',
    hu: 'Kontextus automatikus csatolása', ja: 'コンテキストを自動で添付', ko: '컨텍스트 자동 첨부',
    pl: 'Dołączaj kontekst automatycznie', ru: 'Прикреплять контекст автоматически',
    'zh-Hans': '自动附加上下文', 'zh-Hant': '自動附加上下文',
  },
  'chrome.settings.agentQuickActions': {
    ar: 'إظهار الإجراءات السريعة', de: 'Schnellaktionen anzeigen', en: 'Show quick actions',
    es: 'Mostrar acciones rápidas', fr: 'Afficher les actions rapides', hu: 'Gyors műveletek megjelenítése',
    ja: 'クイック操作を表示', ko: '빠른 작업 표시', pl: 'Pokaż szybkie akcje', ru: 'Показывать быстрые действия',
    'zh-Hans': '显示快捷操作', 'zh-Hant': '顯示快速操作',
  },

  // ----------------------------------------------------------- chrome / titles
  'chrome.surface.doc': {
    ar: 'مستند', de: 'Dokument', en: 'Document', es: 'Documento', fr: 'Document', hu: 'Dokumentum',
    ja: 'ドキュメント', ko: '문서', pl: 'Dokument', ru: 'Документ', 'zh-Hans': '文档', 'zh-Hant': '文件',
  },
  'chrome.surface.goal': {
    ar: 'هدف', de: 'Ziel', en: 'Goal', es: 'Objetivo', fr: 'Objectif', hu: 'Cél', ja: '目標', ko: '목표',
    pl: 'Cel', ru: 'Цель', 'zh-Hans': '目标', 'zh-Hant': '目標',
  },
  'chrome.surface.project': {
    ar: 'مشروع', de: 'Projekt', en: 'Project', es: 'Proyecto', fr: 'Projet', hu: 'Projekt', ja: 'プロジェクト',
    ko: '프로젝트', pl: 'Projekt', ru: 'Проект', 'zh-Hans': '项目', 'zh-Hant': '專案',
  },
  'chrome.surface.space': {
    ar: 'مساحة', de: 'Bereich', en: 'Space', es: 'Espacio', fr: 'Espace', hu: 'Tér', ja: 'スペース',
    ko: '스페이스', pl: 'Przestrzeń', ru: 'Пространство', 'zh-Hans': '空间', 'zh-Hant': '空間',
  },
  'chrome.surface.wiki': {
    ar: 'ويكي', de: 'Wiki', en: 'Wiki', es: 'Wiki', fr: 'Wiki', hu: 'Wiki', ja: 'Wiki', ko: 'Wiki',
    pl: 'Wiki', ru: 'Wiki', 'zh-Hans': 'Wiki', 'zh-Hant': 'Wiki',
  },
  'chrome.surface.drive': {
    ar: 'القرص', de: 'Drive', en: 'Drive', es: 'Drive', fr: 'Drive', hu: 'Drive', ja: 'ドライブ', ko: '드라이브',
    pl: 'Dysk', ru: 'Диск', 'zh-Hans': '云盘', 'zh-Hant': '雲端硬碟',
  },
  'chrome.surface.base': {
    ar: 'قاعدة', de: 'Base', en: 'Base', es: 'Base', fr: 'Base', hu: 'Bázis', ja: 'ベース', ko: '베이스',
    pl: 'Baza', ru: 'База', 'zh-Hans': '多维表格', 'zh-Hant': '多維表格',
  },
  'chrome.surface.form': {
    ar: 'نموذج', de: 'Formular', en: 'Form', es: 'Formulario', fr: 'Formulaire', hu: 'Űrlap',
    ja: 'フォーム', ko: '양식', pl: 'Formularz', ru: 'Форма', 'zh-Hans': '表单', 'zh-Hant': '表單',
  },
  'chrome.surface.forms': {
    ar: 'النماذج', de: 'Formulare', en: 'Forms', es: 'Formularios', fr: 'Formulaires', hu: 'Űrlapok',
    ja: 'フォーム', ko: '양식', pl: 'Formularze', ru: 'Формы', 'zh-Hans': '表单', 'zh-Hant': '表單',
  },
  'chrome.surface.agentCenter': {
    ar: 'الوكلاء', de: 'Agenten', en: 'Agents', es: 'Agentes', fr: 'Agents', hu: 'Ügynökök',
    ja: 'エージェント', ko: '에이전트', pl: 'Agenci', ru: 'Агенты', 'zh-Hans': '代理', 'zh-Hant': '代理',
  },
  'chrome.surface.settings': {
    ar: 'الإعدادات', de: 'Einstellungen', en: 'Settings', es: 'Ajustes', fr: 'Paramètres', hu: 'Beállítások',
    ja: '設定', ko: '설정', pl: 'Ustawienia', ru: 'Настройки', 'zh-Hans': '设置', 'zh-Hant': '設定',
  },
  'chrome.surface.search': {
    ar: 'بحث', de: 'Suche', en: 'Search', es: 'Búsqueda', fr: 'Recherche', hu: 'Keresés', ja: '検索',
    ko: '검색', pl: 'Szukaj', ru: 'Поиск', 'zh-Hans': '搜索', 'zh-Hant': '搜尋',
  },
  'chrome.surface.mail': {
    ar: 'البريد', de: 'Mail', en: 'Mail', es: 'Correo', fr: 'Courriel', hu: 'Levél', ja: 'メール',
    ko: '메일', pl: 'Poczta', ru: 'Почта', 'zh-Hans': '邮件', 'zh-Hant': '郵件',
  },
  'chrome.surface.meetingsCall': {
    ar: 'اجتماع', de: 'Besprechung', en: 'Meeting', es: 'Reunión', fr: 'Réunion', hu: 'Megbeszélés',
    ja: '会議', ko: '회의', pl: 'Spotkanie', ru: 'Встреча', 'zh-Hans': '会议', 'zh-Hant': '會議',
  },

  // ------------------------------------------------------------------- xfn
  'xfn.x13.title': {
    ar: 'السحب والإفلات بين الصفحات', de: 'Drag & Drop über Oberflächen', en: 'Drag entities across surfaces',
    es: 'Arrastrar entidades entre vistas', fr: 'Glisser des entités entre les vues', hu: 'Entitások áthúzása felületek között',
    ja: 'サーフェス間のドラッグ＆ドロップ', ko: '화면 간 엔터티 끌어다 놓기', pl: 'Przeciąganie encji między widokami',
    ru: 'Перетаскивание сущностей между экранами', 'zh-Hans': '跨界面拖放实体', 'zh-Hant': '跨介面拖放實體',
  },
  'xfn.x14.title': {
    ar: 'كتلة زمنية لمهمة', de: 'Zeitblock für eine Aufgabe', en: 'Time block for a task', es: 'Bloque de tiempo para una tarea',
    fr: 'Bloc de temps pour une tâche', hu: 'Idősáv egy feladathoz', ja: 'タスクのタイムブロック',
    ko: '작업 시간 블록', pl: 'Blok czasu dla zadania', ru: 'Временной блок для задачи',
    'zh-Hans': '为任务创建时间块', 'zh-Hant': '為任務建立時間區塊',
  },
  'xfn.x15.title': {
    ar: 'نشر نتائج الاجتماع', de: 'Besprechungsergebnisse veröffentlichen', en: 'Publish meeting outcomes',
    es: 'Publicar resultados de la reunión', fr: 'Publier les résultats de réunion', hu: 'Megbeszélés eredményeinek közzététele',
    ja: '会議の成果を公開', ko: '회의 결과 게시', pl: 'Opublikuj wyniki spotkania',
    ru: 'Опубликовать итоги встречи', 'zh-Hans': '发布会议成果', 'zh-Hant': '發布會議成果',
  },
  'xfn.x16.title': {
    ar: 'تذكير على أي عنصر', de: 'Erinnerung an ein beliebiges Element', en: 'Reminder on any entity',
    es: 'Recordatorio en cualquier entidad', fr: "Rappel sur n'importe quel élément", hu: 'Emlékeztető bármely elemre',
    ja: '任意の項目にリマインド', ko: '모든 항목에 알림', pl: 'Przypomnienie o dowolnym elemencie',
    ru: 'Напоминание на любую сущность', 'zh-Hans': '为任意实体设置提醒', 'zh-Hant': '為任意實體設定提醒',
  },
  'xfn.x17.title': {
    ar: 'مسودة تحديث من النشاط', de: 'Check-in-Entwurf aus Aktivität', en: 'Check-in draft from activity',
    es: 'Borrador de check-in desde la actividad', fr: "Brouillon de point depuis l'activité", hu: 'Check-in vázlat az aktivitásból',
    ja: '活動からチェックイン下書き', ko: '활동에서 체크인 초안', pl: 'Szkic check-inu z aktywności',
    ru: 'Черновик чек-ина из активности', 'zh-Hans': '从动态生成检查草稿', 'zh-Hant': '從動態產生檢查草稿',
  },
  'xfn.x18.title': {
    ar: 'ربط العمل بالهدف', de: 'Arbeit mit einem Ziel verknüpfen', en: 'Link work to a goal',
    es: 'Vincular trabajo a un objetivo', fr: 'Lier le travail à un objectif', hu: 'Munka összekapcsolása céllal',
    ja: '作業を目標にリンク', ko: '작업을 목표에 연결', pl: 'Powiąż pracę z celem',
    ru: 'Связать работу с целью', 'zh-Hans': '将工作关联到目标', 'zh-Hant': '將工作關聯到目標',
  },
  'xfn.x19.title': {
    ar: 'إجراءات مجمّعة', de: 'Sammelaktionen', en: 'Bulk actions', es: 'Acciones masivas', fr: 'Actions groupées',
    hu: 'Kötegelt műveletek', ja: '一括操作', ko: '일괄 작업', pl: 'Akcje zbiorcze', ru: 'Массовые действия',
    'zh-Hans': '批量操作', 'zh-Hant': '批次操作',
  },
  'xfn.x20.title': {
    ar: 'نظرة عامة على شخص', de: 'Personenübersicht', en: 'Person overview', es: 'Resumen de la persona',
    fr: "Vue d'ensemble d'une personne", hu: 'Személy áttekintése', ja: '人物の概要', ko: '사용자 개요',
    pl: 'Przegląd osoby', ru: 'Обзор человека', 'zh-Hans': '成员概览', 'zh-Hant': '成員總覽',
  },
  'xfn.x21.title': {
    ar: 'أجندة اليوم', de: 'Agenda heute', en: "Today's agenda", es: 'Agenda de hoy', fr: "Agenda du jour",
    hu: 'Mai napirend', ja: '今日の予定', ko: '오늘의 일정', pl: 'Agenda na dziś', ru: 'Повестка дня',
    'zh-Hans': '今日日程', 'zh-Hant': '今日議程',
  },
  'xfn.x22.title': {
    ar: 'إنشاء من البريد', de: 'Aus E-Mail erstellen', en: 'Create from email', es: 'Crear desde el correo',
    fr: "Créer depuis l'e-mail", hu: 'Létrehozás e-mailből', ja: 'メールから作成', ko: '메일에서 만들기',
    pl: 'Utwórz z wiadomości', ru: 'Создать из письма', 'zh-Hans': '从邮件创建', 'zh-Hant': '從郵件建立',
  },
  'xfn.x23.title': {
    ar: 'إجراءات عند إرسال النموذج', de: 'Aktionen beim Formularabsenden', en: 'Form submit actions',
    es: 'Acciones al enviar el formulario', fr: "Actions à l'envoi du formulaire", hu: 'Műveletek űrlapbeküldéskor',
    ja: 'フォーム送信時の操作', ko: '양식 제출 시 작업', pl: 'Akcje po wysłaniu formularza',
    ru: 'Действия при отправке формы', 'zh-Hans': '表单提交动作', 'zh-Hant': '表單提交動作',
  },
  'xfn.x24.title': {
    ar: 'بدء اجتماع من أي عنصر', de: 'Besprechung aus einem Element starten', en: 'Start a meeting from any entity',
    es: 'Iniciar una reunión desde cualquier entidad', fr: "Démarrer une réunion depuis n'importe quel élément",
    hu: 'Megbeszélés indítása bármely elemből', ja: '任意の項目から会議を開始', ko: '모든 항목에서 회의 시작',
    pl: 'Rozpocznij spotkanie z dowolnego elementu', ru: 'Начать встречу из любой сущности',
    'zh-Hans': '从任意实体发起会议', 'zh-Hant': '從任意實體發起會議',
  },
  'xfn.x25.title': {
    ar: 'فتح لوحة الوكيل', de: 'Agentenbereich öffnen', en: 'Open the @rox panel', es: 'Abrir el panel de @rox',
    fr: 'Ouvrir le panneau @rox', hu: '@rox panel megnyitása', ja: '@rox パネルを開く', ko: '@rox 패널 열기',
    pl: 'Otwórz panel @rox', ru: 'Открыть панель @rox', 'zh-Hans': '打开 @rox 面板', 'zh-Hant': '開啟 @rox 面板',
  },
  'xfn.x26.title': {
    ar: 'التثبيت عبر الصفحات', de: 'Bereichsübergreifendes Anheften', en: 'Pins across surfaces',
    es: 'Fijados en todas las vistas', fr: 'Épingles sur toutes les vues', hu: 'Rögzítés minden felületen',
    ja: 'サーフェスをまたぐピン留め', ko: '화면 전반의 고정', pl: 'Przypięcia we wszystkich widokach',
    ru: 'Закреплённое на всех экранах', 'zh-Hans': '跨界面固定', 'zh-Hant': '跨介面釘選',
  },
  'xfn.reason.flagOff': {
    ar: 'الميزة معطّلة', de: 'Funktion ist deaktiviert', en: 'The feature is off', es: 'La función está desactivada',
    fr: 'La fonctionnalité est désactivée', hu: 'A funkció ki van kapcsolva', ja: '機能が無効です',
    ko: '기능이 꺼져 있습니다', pl: 'Funkcja jest wyłączona', ru: 'Возможность выключена',
    'zh-Hans': '功能已关闭', 'zh-Hant': '功能已關閉',
  },
  'xfn.reason.moduleOff': {
    ar: 'وحدة المالك معطّلة', de: 'Besitzer-Modul ist deaktiviert', en: "The owner module is off",
    es: 'El módulo propietario está desactivado', fr: 'Le module propriétaire est désactivé',
    hu: 'A tulajdonos modul ki van kapcsolva', ja: '所有モジュールが無効です', ko: '소유 모듈이 꺼져 있습니다',
    pl: 'Moduł właściciela jest wyłączony', ru: 'Модуль-владелец выключен', 'zh-Hans': '所属模块已关闭',
    'zh-Hant': '所屬模組已關閉',
  },
  'xfn.reason.notBound': {
    ar: 'غير متصل بعد', de: 'Noch nicht verbunden', en: 'Not wired up yet', es: 'Aún no está conectado',
    fr: 'Pas encore connecté', hu: 'Még nincs bekötve', ja: 'まだ接続されていません', ko: '아직 연결되지 않음',
    pl: 'Jeszcze nie podłączone', ru: 'Ещё не подключено', 'zh-Hans': '尚未接入', 'zh-Hant': '尚未接入',
  },
  'xfn.reason.unknownCommand': {
    ar: 'أمر غير معروف', de: 'Unbekannter Befehl', en: 'Unknown command', es: 'Comando desconocido',
    fr: 'Commande inconnue', hu: 'Ismeretlen parancs', ja: '不明なコマンド', ko: '알 수 없는 명령',
    pl: 'Nieznane polecenie', ru: 'Неизвестная команда', 'zh-Hans': '未知命令', 'zh-Hant': '未知命令',
  },
  'xfn.reason.unavailable': {
    ar: 'غير متاح', de: 'Nicht verfügbar', en: 'Not available', es: 'No disponible', fr: 'Indisponible',
    hu: 'Nem elérhető', ja: '利用できません', ko: '사용할 수 없음', pl: 'Niedostępne', ru: 'Недоступно',
    'zh-Hans': '不可用', 'zh-Hant': '無法使用',
  },
  'xfn.reason.unknownPair': {
    ar: 'لا يمكن الإفلات هنا', de: 'Hier nicht ablegbar', en: "Can't drop this here", es: 'No se puede soltar aquí',
    fr: 'Dépôt impossible ici', hu: 'Ide nem húzható', ja: 'ここにはドロップできません', ko: '여기에 놓을 수 없습니다',
    pl: 'Nie można tu upuścić', ru: 'Сюда нельзя перетащить', 'zh-Hans': '无法拖放到此处', 'zh-Hant': '無法拖放到此處',
  },
  'xfn.reason.mixedIntent': {
    ar: 'عناصر مختلفة، اختر إجراءً', de: 'Gemischte Elemente — Aktion wählen', en: 'Mixed items — pick an action',
    es: 'Elementos mixtos: elige una acción', fr: 'Éléments mixtes — choisissez une action',
    hu: 'Vegyes elemek — válassz műveletet', ja: '種類が混在 — 操作を選択', ko: '항목이 혼합됨 — 작업을 선택하세요',
    pl: 'Różne elementy — wybierz akcję', ru: 'Разные элементы — выберите действие',
    'zh-Hans': '混合内容 — 请选择操作', 'zh-Hant': '混合內容 — 請選擇操作',
  },
  'xfn.reason.invalidKind': {
    ar: 'نوع غير مدعوم', de: 'Nicht unterstützter Typ', en: 'Unsupported kind', es: 'Tipo no admitido',
    fr: 'Type non pris en charge', hu: 'Nem támogatott típus', ja: '対応していない種類', ko: '지원하지 않는 종류',
    pl: 'Nieobsługiwany typ', ru: 'Неподдерживаемый тип', 'zh-Hans': '不支持的类型', 'zh-Hant': '不支援的類型',
  },
  'xfn.drop.added': {
    ar: 'أُضيف إلى {{target}}', de: 'Zu {{target}} hinzugefügt', en: 'Added to {{target}}', es: 'Añadido a {{target}}',
    fr: 'Ajouté à {{target}}', hu: 'Hozzáadva: {{target}}', ja: '{{target}} に追加しました', ko: '{{target}}에 추가됨',
    pl: 'Dodano do {{target}}', ru: 'Добавлено в {{target}}', 'zh-Hans': '已添加到 {{target}}', 'zh-Hant': '已加入 {{target}}',
  },
  'xfn.drop.undo': {
    ar: 'تراجع', de: 'Rückgängig', en: 'Undo', es: 'Deshacer', fr: 'Annuler', hu: 'Visszavonás', ja: '取り消す',
    ko: '실행 취소', pl: 'Cofnij', ru: 'Отменить', 'zh-Hans': '撤销', 'zh-Hant': '復原',
  },
  'xfn.batch.partial': {
    ar: 'فشل {{failed}} من {{total}}', de: '{{failed}} von {{total}} fehlgeschlagen', en: '{{failed}} of {{total}} failed',
    es: '{{failed}} de {{total}} fallaron', fr: '{{failed}} sur {{total}} en échec', hu: '{{failed}} / {{total}} sikertelen',
    ja: '{{total}} 件中 {{failed}} 件が失敗', ko: '{{total}}개 중 {{failed}}개 실패',
    pl: 'Nie udało się {{failed}} z {{total}}', ru: '{{failed}} из {{total}} не выполнено',
    'zh-Hans': '{{total}} 项中有 {{failed}} 项失败', 'zh-Hant': '{{total}} 項中有 {{failed}} 項失敗',
  },
  'xfn.reminder.set': {
    ar: 'تذكير…', de: 'Erinnern…', en: 'Remind…', es: 'Recordar…', fr: 'Rappeler…', hu: 'Emlékeztetés…',
    ja: 'リマインド…', ko: '알림…', pl: 'Przypomnij…', ru: 'Напомнить…', 'zh-Hans': '提醒…', 'zh-Hant': '提醒…',
  },
  'xfn.reminder.due': {
    ar: 'حان الوقت: {{title}}', de: 'Es ist Zeit: {{title}}', en: "It's time: {{title}}", es: 'Es la hora: {{title}}',
    fr: "C'est l'heure : {{title}}", hu: 'Itt az idő: {{title}}', ja: '時間です: {{title}}', ko: '시간입니다: {{title}}',
    pl: 'Czas na: {{title}}', ru: 'Пора: {{title}}', 'zh-Hans': '时间到了：{{title}}', 'zh-Hant': '時間到了：{{title}}',
  },
  'xfn.pin.added': {
    ar: 'تم التثبيت', de: 'Angeheftet', en: 'Pinned', es: 'Fijado', fr: 'Épinglé', hu: 'Rögzítve',
    ja: 'ピン留めしました', ko: '고정됨', pl: 'Przypięto', ru: 'Закреплено', 'zh-Hans': '已固定', 'zh-Hant': '已釘選',
  },
  'xfn.pin.removed': {
    ar: 'أُلغي التثبيت', de: 'Losgelöst', en: 'Unpinned', es: 'Fijado quitado', fr: 'Détaché', hu: 'Rögzítés feloldva',
    ja: 'ピン留めを解除しました', ko: '고정 해제됨', pl: 'Odpięto', ru: 'Откреплено', 'zh-Hans': '已取消固定', 'zh-Hant': '已取消釘選',
  },
}

/** Russian needs _few / _many in addition to the EN _one / _other pair. */
const RU_PLURALS: Record<string, string> = {
  'chrome.counter.items_few': '{{count}} элемента',
  'chrome.counter.items_many': '{{count}} элементов',
}

const dir = join(import.meta.dir, '..', 'packages', 'shared', 'src', 'i18n', 'locales')
const REPORT: Array<{ locale: string; added: number; overallocated: string[] }> = []
for (const locale of LOCALES) {
  const file = join(dir, `${locale}.json`)
  const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  const before = Object.keys(data).length
  const overallocated: string[] = []
  for (const [key, values] of Object.entries(T)) {
    const value = values[locale]
    if (typeof value !== 'string' || value.length === 0) { overallocated.push(key); continue }
    if (key in data && data[key] !== value) overallocated.push(`${key} (kept existing)`)
    data[key] = value
  }
  if (locale === 'ru') Object.assign(data, RU_PLURALS)
  const sorted = Object.fromEntries(Object.keys(data).sort().map((key) => [key, data[key]]))
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`)
  REPORT.push({ locale, added: Object.keys(sorted).length - before, overallocated })
}
console.log(JSON.stringify({ keys: Object.keys(T).length, report: REPORT }, null, 1))