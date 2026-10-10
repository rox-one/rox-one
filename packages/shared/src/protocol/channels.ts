/**
 * RPC channel names — organized by domain namespace.
 * Wire-format strings (values) are the stable API contract.
 * Key paths are internal and may be reorganized freely.
 */
export const RPC_CHANNELS = {
  workspaceWork: {
    READ: 'workspaceWork:read',
    WRITE: 'workspaceWork:write',
    DELETE: 'workspaceWork:delete',
    SNAPSHOT_PROFILE: 'workspaceWork:snapshotProfile',
    CHANGED: 'workspaceWork:changed',
  },
  runtimeTrace: {
    GET_SNAPSHOT: 'runtimeTrace:getSnapshot',
    READ_EVENTS: 'runtimeTrace:readEvents',
    READ_PAYLOAD: 'runtimeTrace:readPayload',
  },
  cloudRuns: {
    GET_CONFIG: 'cloudRuns:getConfig',
    SET_CONFIG: 'cloudRuns:setConfig',
    SUBMIT: 'cloudRuns:submit',
    RESUME: 'cloudRuns:resume',
    SESSION_TOPIC: 'cloudRuns:sessionTopic',
    LIST_SCHEDULES: 'cloudRuns:listSchedules',
    SAVE_SCHEDULE: 'cloudRuns:saveSchedule',
    DELETE_SCHEDULE: 'cloudRuns:deleteSchedule',
    READ_ARTIFACT: 'cloudRuns:readArtifact',
    GET_EVENTS: 'cloudRuns:getEvents',
    SHARE: 'cloudRuns:share',
    REVOKE_SHARE: 'cloudRuns:revokeShare',
    LIST: 'cloudRuns:list',
    GET_STATUS: 'cloudRuns:getStatus',
    CANCEL: 'cloudRuns:cancel',
    KILL: 'cloudRuns:kill',
    LIST_ARTIFACTS: 'cloudRuns:listArtifacts',
    IMPORT: 'cloudRuns:import',
    AGGREGATE: 'cloudRuns:aggregate',
  },
  remote: {
    TEST_CONNECTION: 'remote:testConnection',
  },
  server: {
    GET_WORKSPACES: 'server:getWorkspaces',
    CREATE_WORKSPACE: 'server:createWorkspace',
    GET_STATUS: 'server:getStatus',
    GET_HEALTH: 'server:getHealth',
    GET_ACTIVE_SESSIONS: 'server:getActiveSessions',
    SHUTTING_DOWN: 'server:shuttingDown',
    STATUS_CHANGED: 'server:statusChanged',
    HOME_DIR: 'server:homeDir',
  },
  sessions: {
    GET: 'sessions:get',
    GET_UNREAD_SUMMARY: 'sessions:getUnreadSummary',
    MARK_ALL_READ: 'sessions:markAllRead',
    UNREAD_SUMMARY_CHANGED: 'sessions:unreadSummaryChanged',
    CREATE: 'sessions:create',
    DELETE: 'sessions:delete',
    GET_MESSAGES: 'sessions:getMessages',
    SEND_MESSAGE: 'sessions:sendMessage',
    CANCEL: 'sessions:cancel',
    KILL_SHELL: 'sessions:killShell',
    RESPOND_TO_PERMISSION: 'sessions:respondToPermission',
    RESPOND_TO_CREDENTIAL: 'sessions:respondToCredential',
    COMMAND: 'sessions:command',
    BULK_UPDATE: 'sessions:bulkUpdate',
    BULK_CHANGED: 'sessions:bulkChanged',
    GET_PENDING_PLAN_EXECUTION: 'sessions:getPendingPlanExecution',
    GET_PERMISSION_MODE_STATE: 'sessions:getPermissionModeState',
    GET_BUDGET: 'sessions:getBudget',
    SET_BUDGET: 'sessions:setBudget',
    SET_MEMORY_MODE: 'sessions:setMemoryMode',
    GET_PROVENANCE: 'sessions:getProvenance',
    EVENT: 'session:event',
    GET_MODEL: 'session:getModel',
    GET_MODEL_CATALOG: 'session:getModelCatalog',
    SET_MODEL: 'session:setModel',
    GET_FILES: 'sessions:getFiles',
    GET_NOTES: 'sessions:getNotes',
    SET_NOTES: 'sessions:setNotes',
    WATCH_FILES: 'sessions:watchFiles',
    UNWATCH_FILES: 'sessions:unwatchFiles',
    FILES_CHANGED: 'sessions:filesChanged',
    SEARCH_CONTENT: 'sessions:searchContent',
    EXPORT: 'sessions:export',
    IMPORT: 'sessions:import',
    EXPORT_REMOTE_TRANSFER: 'sessions:exportRemoteTransfer',
    IMPORT_REMOTE_TRANSFER: 'sessions:importRemoteTransfer',
    FOREIGN_DISCOVER: 'sessions:foreignDiscover',
    FOREIGN_PERSIST: 'sessions:foreignPersist',
    FOREIGN_AUTO_STATUS: 'sessions:foreignAutoStatus',
    FOREIGN_AUTO_RUN: 'sessions:foreignAutoRun',
    FOREIGN_AUTO_SET: 'sessions:foreignAutoSet',
    ASSIGN_OWNER: 'sessions:assignOwner',
    SUGGEST_ADD: 'sessions:suggestAdd',
    SUGGEST_LIST: 'sessions:suggestList',
    SUGGEST_RESOLVE: 'sessions:suggestResolve',
  },
  transfer: {
    START: 'transfer:start',
    CHUNK: 'transfer:chunk',
    COMMIT: 'transfer:commit',
    ABORT: 'transfer:abort',
  },
  tasks: {
    // Legacy: background-task output (disabled-feature remnant). Kept for back-compat; retire later.
    GET_OUTPUT: 'tasks:getOutput',
    // Conductor — the Tasks DAG runner.
    VALIDATE: 'tasks:validate',
    CREATE: 'tasks:create',
    GENERATE: 'tasks:generate',
    // Push: the authored spec (or an error) for an async tasks:generate, keyed by orchestratorSessionId.
    GENERATED: 'tasks:generated',
    RUN: 'tasks:run',
    PAUSE: 'tasks:pause',
    RESUME: 'tasks:resume',
    STOP: 'tasks:stop',
    GET: 'tasks:get',
    LIST: 'tasks:list',
    // Storage-backed read of a run's outcome (verdict + per-node output). Survives restart.
    GET_RESULTS: 'tasks:getResults',
  },
  workspaces: {
    GET: 'workspaces:get',
    CREATE: 'workspaces:create',
    CHECK_SLUG: 'workspaces:checkSlug',
    UPDATE_REMOTE: 'workspaces:updateRemote',
  },
  workgraph: {
    LIST_CONNECTION_LEASES: 'workgraph:listConnectionLeases',
    INSPECT_CONNECTION: 'workgraph:inspectConnection',
    MOVE_CONNECTION: 'workgraph:moveConnection',
    START_GITHUB_DEVICE_LOGIN: 'workgraph:startGithubDeviceLogin',
    POLL_GITHUB_DEVICE_LOGIN: 'workgraph:pollGithubDeviceLogin',
    CANCEL_GITHUB_DEVICE_LOGIN: 'workgraph:cancelGithubDeviceLogin',
    RECONNECT_CONNECTION: 'workgraph:reconnectConnection',
    GET_HEALTH: 'workgraph:getHealth',
    GET_VERSION: 'workgraph:getVersion',
    LIST_CONNECTIONS: 'workgraph:listConnections',
    LIST_CONNECTION_AUDIT: 'workgraph:listConnectionAudit',
    LIST_CONNECTION_BINDINGS: 'workgraph:listConnectionBindings',
    CONVERT_CONNECTION: 'workgraph:convertConnection',
    REVOKE_CONNECTION_BINDING: 'workgraph:revokeConnectionBinding',
    GET_CONNECTION: 'workgraph:getConnection',
    CREATE_CONNECTION: 'workgraph:createConnection',
    GRANT_CONNECTION: 'workgraph:grantConnection',
    PREVIEW_GITHUB_ENV: 'workgraph:previewGithubEnv',
    IMPORT_GITHUB_ENV: 'workgraph:importGithubEnv',
    PREVIEW_GIT_HELPER: 'workgraph:previewGitHelper',
    IMPORT_GIT_HELPER: 'workgraph:importGitHelper',
    REVOKE_CONNECTION: 'workgraph:revokeConnection',
    REPAIR_CONNECTION: 'workgraph:repairConnection',
    ROTATE_CONNECTION: 'workgraph:rotateConnection',
    TEST_CONNECTION: 'workgraph:testConnection',
    PREVIEW_DOCKER_HELPER: 'workgraph:previewDockerHelper',
    IMPORT_DOCKER_HELPER: 'workgraph:importDockerHelper',
    PREVIEW_AWS_PROFILES: 'workgraph:previewAwsProfiles',
    IMPORT_AWS_PROFILE: 'workgraph:importAwsProfile',
    PREVIEW_KEYCHAIN: 'workgraph:previewKeychain',
    IMPORT_KEYCHAIN: 'workgraph:importKeychain',
    PREVIEW_ADC: 'workgraph:previewAdc',
    IMPORT_ADC: 'workgraph:importAdc',
    PREVIEW_SSH_AGENT: 'workgraph:previewSshAgent',
    IMPORT_SSH_AGENT: 'workgraph:importSshAgent',
  },
  window: {
    GET_WORKSPACE: 'window:getWorkspace',
    GET_MODE: 'window:getMode',
    OPEN_WORKSPACE: 'window:openWorkspace',
    OPEN_SESSION_IN_NEW_WINDOW: 'window:openSessionInNewWindow',
    SWITCH_WORKSPACE: 'window:switchWorkspace',
    CLOSE: 'window:close',
    CLOSE_REQUESTED: 'window:closeRequested',
    CONFIRM_CLOSE: 'window:confirmClose',
    CANCEL_CLOSE: 'window:cancelClose',
    SET_TRAFFIC_LIGHTS: 'window:setTrafficLights',
    FOCUS_STATE: 'window:focusState',
    GET_FOCUS_STATE: 'window:getFocusState',
  },
  file: {
    READ: 'file:read',
    READ_DATA_URL: 'file:readDataUrl',
    READ_PREVIEW_DATA_URL: 'file:readPreviewDataUrl',
    READ_BINARY: 'file:readBinary',
    OPEN_DIALOG: 'file:openDialog',
    READ_ATTACHMENT: 'file:readAttachment',
    READ_USER_ATTACHMENT: 'file:readUserAttachment',
    STORE_ATTACHMENT: 'file:storeAttachment',
    GENERATE_THUMBNAIL: 'file:generateThumbnail',
  },
  fs: {
    SEARCH: 'fs:search',
    LIST_DIRECTORY: 'fs:listDirectory',
  },
  content: {
    RESOLVE: 'content:resolve',
    DESCRIBE: 'content:describe',
    ADOPT_DESCRIPTOR: 'content:adoptDescriptor',
    COMMIT_MARKDOWN: 'content:commitMarkdown',
    GET_COMMIT_RECEIPT: 'content:getCommitReceipt',
    GET_BLOCK_TREE: 'content:getBlockTree',
    PREVIEW_MARKER_MAPPING: 'content:previewMarkerMapping',
    APPLY_MARKER_MAPPING: 'content:applyMarkerMapping',
  },
  codeIntelligence: {
    PREVIEW: 'codeIntelligence:preview',
    BIND: 'codeIntelligence:bind',
    CAPTURE: 'codeIntelligence:capture',
    LIST: 'codeIntelligence:list',
    READ_SPAN: 'codeIntelligence:readSpan',
    FRESHNESS: 'codeIntelligence:freshness',
    CANCEL: 'codeIntelligence:cancel',
  },
  devSpace: {
    LIST_REPOSITORIES: 'devSpace:listRepositories',
    ADD_REPOSITORY: 'devSpace:addRepository',
    START_CLONE: 'devSpace:startClone',
    REMOVE_REPOSITORY: 'devSpace:removeRepository',
    REFRESH_REPOSITORY: 'devSpace:refreshRepository',
    CANCEL: 'devSpace:cancel',
    CAPABILITIES: 'devSpace:capabilities',
    LIST_RUNS: 'devSpace:listRuns',
    START_RUN: 'devSpace:startRun',
    LIST_ARTIFACTS: 'devSpace:listArtifacts',
    READ_ARTIFACT: 'devSpace:readArtifact',
    GENERATE_QUESTIONS: 'devSpace:generateQuestions',
    CLONE_PROGRESS: 'devSpace:cloneProgress',
    CHANGED: 'devSpace:changed',
    RUN_PROGRESS: 'devSpace:runProgress',
    SOFT_SIGNAL: 'devSpace:softSignal',
  },
  notes: {
    LIST: 'notes:list',
    READ: 'notes:read',
    SAVE: 'notes:save',
    CREATE: 'notes:create',
    LIST_COMMENTS: 'notes:listComments',
    CREATE_COMMENT: 'notes:createComment',
    UPDATE_COMMENT: 'notes:updateComment',
    DELETE_COMMENT: 'notes:deleteComment',
    PREPARE_CREATE: 'notes:prepareCreate',
    RENAME: 'notes:rename',
    MOVE: 'notes:move',
    DELETE: 'notes:delete',
    RENAME_FOLDER: 'notes:renameFolder',
    DELETE_FOLDER: 'notes:deleteFolder',
    SEARCH: 'notes:search',
    GET_BACKLINKS: 'notes:getBacklinks',
    GET_INSIGHTS: 'notes:getInsights',
    GET_INDEX_HEALTH: 'notes:getIndexHealth',
    GET_RENAME_IMPACT: 'notes:getRenameImpact',
    GET_DAILY_NOTE: 'notes:getDailyNote',
    IMPORT_ASSET: 'notes:importAsset',
    LIST_ASSETS: 'notes:listAssets',
    DELETE_ASSET: 'notes:deleteAsset',
    RENAME_ASSET: 'notes:renameAsset',
    UPDATE_PROPERTIES: 'notes:updateProperties',
    REBUILD_INDEX: 'notes:rebuildIndex',
    WATCH: 'notes:watch',
    UNWATCH: 'notes:unwatch',
    CHANGED: 'notes:changed',
  },
  nativeData: {
    GET_CONTEXT: 'nativeData:getContext',
    READ_ENTITY: 'nativeData:readEntity',
    MUTATE: 'nativeData:mutate',
    PULL_CHANGES: 'nativeData:pullChanges',
  },
  notesImport: {
    PREVIEW: 'notesImport:preview',
    EXECUTE: 'notesImport:execute',
  },
  // clipboard — Rox History (first-party clipboard history). Owned by the
  // Electron main process (store + monitor); CHANGED is a broadcast push.
  clipboard: {
    LIST: 'clipboard:list',
    GET: 'clipboard:get',
    STAR: 'clipboard:star',
    TAGS: 'clipboard:tags',
    DELETE: 'clipboard:delete',
    CLEAR: 'clipboard:clear',
    COPY: 'clipboard:copy',
    /** First-party secret copy: writes text + the concealed pasteboard marker. */
    WRITE_CONCEALED: 'clipboard:writeConcealed',
    SETTINGS_GET: 'clipboard:settingsGet',
    SETTINGS_SET: 'clipboard:settingsSet',
    TAG_COUNTS: 'clipboard:tagCounts',
    STATS: 'clipboard:stats',
    CHANGED: 'clipboard:changed',
  },
  // knowledge — P1 read-only knowledge provider (spec 03) plus P3 write-back
  // mutation-proposal channels (spec 05) plus P4 Session→Knowledge publication
  // pipeline (spec 06). ENGINE_START is local bootstrap (detect/open/spawn);
  // full managed lifecycle (stop/pin) remains out of scope.
  knowledge: {
    LIST_CONNECTIONS: 'knowledge:listConnections',
    CAPABILITIES: 'knowledge:capabilities',
    SEARCH: 'knowledge:search',
    GET: 'knowledge:get',
    GET_CONTEXT: 'knowledge:getContext',
    GET_BACKLINKS: 'knowledge:getBacklinks',
    /** Notebook listing for the navigator tree (read; kernel lsNotebooks). */
    LIST_NOTEBOOKS: 'knowledge:listNotebooks',
    /** Recursive notebook file tree (read; kernel listDocsByPath + av merge). REMOTE_ELIGIBLE. */
    LIST_TREE: 'knowledge:listTree',
    /** Navigator-only create (notebook/folder/document). Agents must use proposeMutation. */
    USER_CREATE: 'knowledge:userCreate',
    /** Settings → Knowledge: edit connection baseUrl (+ token) for an existing record. */
    UPDATE_CONNECTION: 'knowledge:updateConnection',
    /** P4.3 Craft chrome copy/export payload (read-only; REMOTE_ELIGIBLE). */
    GET_EXPORT_PAYLOAD: 'knowledge:getExportPayload',
    SNAPSHOT_CREATE: 'knowledge:snapshotCreate',
    SNAPSHOT_GET: 'knowledge:snapshotGet',
    ENGINE_STATUS: 'knowledge:engineStatus',
    /** LOCAL_ONLY: detect user-installed SiYuan + default port (never downloads). */
    DETECT_ENGINE: 'knowledge:detectEngine',
    /** G1 metrics snapshot (REMOTE_ELIGIBLE workspace data). */
    METRICS_GET: 'knowledge:metricsGet',
    /** LOCAL_ONLY: ensure default connection + start local SiYuan if installed. */
    ENGINE_START: 'knowledge:engineStart',
    /** P4.4 user-initiated Craft notes vault → SiYuan notebook. */
    MIGRATE_NOTES: 'knowledge:migrateNotes',
    CHANGED: 'knowledge:changed',
    // P3 write-back, spec 05 — safe mutation-proposal lifecycle. All seven are
    // REMOTE_ELIGIBLE (workspace data lives on the workspace-owning server);
    // proposals broadcast via CHANGED (ref of target + change:'updated').
    PROPOSE_MUTATION: 'knowledge:proposeMutation',
    APPROVE_PROPOSAL: 'knowledge:approveProposal',
    REJECT_PROPOSAL: 'knowledge:rejectProposal',
    APPLY_PROPOSAL: 'knowledge:applyProposal',
    ROLLBACK_PROPOSAL: 'knowledge:rollbackProposal',
    GET_PROPOSAL: 'knowledge:getProposal',
    LIST_PROPOSALS: 'knowledge:listProposals',
    // P4 publication pipeline, spec 06 — Session→Knowledge distill/prepare/
    // apply/finalize. All eight are REMOTE_ELIGIBLE (drafts/publications/links
    // live under {workspaceRoot}/knowledge/).
    PUBLISH_DISTILL: 'knowledge:publishDistill',
    PUBLISH_GET_DRAFT: 'knowledge:publishGetDraft',
    PUBLISH_UPDATE_DRAFT: 'knowledge:publishUpdateDraft',
    PUBLISH_PREPARE: 'knowledge:publishPrepare',
    PUBLISH_APPLY: 'knowledge:publishApply',
    PUBLISH_FINALIZE: 'knowledge:publishFinalize',
    PUBLISH_LIST: 'knowledge:publishList',
    LIST_LINKS: 'knowledge:listLinks',
    // P5 saved knowledge views + work envelopes (spec K-09 §3.5 / S-08).
    // All six are REMOTE_ELIGIBLE (views.json + work-envelopes.jsonl live under
    // the workspace root on the workspace-owning server).
    ENVELOPE_GET: 'knowledge:envelopeGet',
    ENVELOPE_UPSERT: 'knowledge:envelopeUpsert',
    ENVELOPE_LIST: 'knowledge:envelopeList',
    VIEWS_LIST: 'knowledge:viewsList',
    VIEW_RUN: 'knowledge:viewRun',
    VIEW_SET_ATTRIBUTE: 'knowledge:viewSetAttribute',
    // P6 knowledge change watcher (poll) — start/stop per connection; emits into AutomationSystem.
    WATCH: 'knowledge:watch',
    UNWATCH: 'knowledge:unwatch',
  },
  // knowledgeMap — the user's auto-generated knowledge graph, built by
  // server-core (fs scan) and rendered in profile/context settings. CHANGED is
  // emitted after a rebuild when a watcher-triggered refresh occurs.
  knowledgeMap: {
    GET: 'knowledgeMap:get',
    CHANGED: 'knowledgeMap:changed',
  },
  // siyuan — P2 native knowledge surface (spec 03/P2): embedded SiYuan desktop
  // hosted in a browser pane, keyed by durable document keys (`siyuan:{kind}:{id}`)
  // for dedup + restore. Surface lifecycle manages local BrowserView compositing —
  // all channels are LOCAL_ONLY (browserPane precedent), never proxied.
  siyuan: {
    CREATE_EMBEDDED: 'siyuan:createEmbedded',
    DESTROY: 'siyuan:destroy',
    LIST: 'siyuan:list',
    SYNC_BOUNDS: 'siyuan:syncBounds',
    FOCUS: 'siyuan:focus',
    /** Run JS in an embedded SiYuan surface (LOCAL_ONLY; dock open / mode switch). */
    EVALUATE: 'siyuan:evaluate',
    STATE_CHANGED: 'siyuan:stateChanged',
    REMOVED: 'siyuan:removed',
  },
  debug: {
    LOG: 'debug:log',
  },
  theme: {
    GET_SYSTEM_PREFERENCE: 'theme:getSystemPreference',
    SYSTEM_CHANGED: 'theme:systemChanged',
    APP_CHANGED: 'theme:appChanged',
    GET_APP: 'theme:getApp',
    GET_PRESETS: 'theme:getPresets',
    LOAD_PRESET: 'theme:loadPreset',
    GET_COLOR_THEME: 'theme:getColorTheme',
    SET_COLOR_THEME: 'theme:setColorTheme',
    /** Persist the app theme's material (glass) field to theme.json (LOCAL_ONLY). */
    SET_APP_MATERIAL: 'theme:setAppMaterial',
    BROADCAST_PREFERENCES: 'theme:broadcastPreferences',
    PREFERENCES_CHANGED: 'theme:preferencesChanged',
    GET_WORKSPACE_COLOR_THEME: 'theme:getWorkspaceColorTheme',
    SET_WORKSPACE_COLOR_THEME: 'theme:setWorkspaceColorTheme',
    GET_ALL_WORKSPACE_THEMES: 'theme:getAllWorkspaceThemes',
    BROADCAST_WORKSPACE_THEME: 'theme:broadcastWorkspaceTheme',
    WORKSPACE_THEME_CHANGED: 'theme:workspaceThemeChanged',
  },
  system: {
    VERSIONS: 'system:versions',
    HOME_DIR: 'system:homeDir',
    CONFIG_DIR: 'system:configDir',
    IS_DEBUG_MODE: 'system:isDebugMode',
  },
  update: {
    CHECK: 'update:check',
    GET_INFO: 'update:getInfo',
    INSTALL: 'update:install',
    DISMISS: 'update:dismiss',
    GET_DISMISSED: 'update:getDismissed',
    AVAILABLE: 'update:available',
    DOWNLOAD_PROGRESS: 'update:downloadProgress',
  },
  shell: {
    OPEN_URL: 'shell:openUrl',
    OPEN_FILE: 'shell:openFile',
    SHOW_IN_FOLDER: 'shell:showInFolder',
    EXEC: 'shell:exec',
    /**
     * Main → renderer push: a native shell affordance (dock menu, tray, app
     * menu, notification click) dispatches one structured action to the
     * focused (or first) window. Payload: `ShellActionPayload`.
     */
    ACTION: 'shell:action',
  },
  menu: {
    NEW_CHAT: 'menu:newChat',
    OPEN_DASHBOARD: 'menu:openDashboard',
    OPEN_NATIVE_CONSOLE: 'menu:openNativeConsole',
    SHOW_SERVICE_STATUS: 'menu:showServiceStatus',
    RUN_DOCTOR: 'menu:runDoctor',
    TRAY_STATUS_CHANGED: 'menu:trayStatusChanged',
    NEW_WINDOW: 'menu:newWindow',
    OPEN_SETTINGS: 'menu:openSettings',
    KEYBOARD_SHORTCUTS: 'menu:keyboardShortcuts',
    TOGGLE_FOCUS_MODE: 'menu:toggleFocusMode',
    TOGGLE_SIDEBAR: 'menu:toggleSidebar',
    TOGGLE_INSPECTOR: 'menu:toggleInspector',
    TOGGLE_CHAT_PICTURE_IN_PICTURE: 'menu:toggleChatPictureInPicture',
    QUIT: 'menu:quit',
    MINIMIZE: 'menu:minimize',
    MAXIMIZE: 'menu:maximize',
    ZOOM_IN: 'menu:zoomIn',
    ZOOM_OUT: 'menu:zoomOut',
    ZOOM_RESET: 'menu:zoomReset',
    TOGGLE_DEV_TOOLS: 'menu:toggleDevTools',
    UNDO: 'menu:undo',
    REDO: 'menu:redo',
    CUT: 'menu:cut',
    COPY: 'menu:copy',
    PASTE: 'menu:paste',
    SELECT_ALL: 'menu:selectAll',
  },
  deeplink: {
    NAVIGATE: 'deeplink:navigate',
  },
  auth: {
    LOGOUT: 'auth:logout',
    SHOW_LOGOUT_CONFIRMATION: 'auth:showLogoutConfirmation',
    SHOW_DELETE_SESSION_CONFIRMATION: 'auth:showDeleteSessionConfirmation',
    SHOW_DELETE_WORKSPACE_CONFIRMATION: 'auth:showDeleteWorkspaceConfirmation',
  },
  credentials: {
    HEALTH_CHECK: 'credentials:healthCheck',
    PREVIEW_MIGRATION: 'credentials:previewMigration',
    APPLY_MIGRATION: 'credentials:applyMigration',
    GET_MIGRATION_STATUS: 'credentials:getMigrationStatus',
    ROLLBACK_MIGRATION: 'credentials:rollbackMigration',
  },
  // ROX Keeper — personal secret vault. Local-only: secrets live in the main
  // process and never reach a remote server.
  keeper: {
    LIST: 'keeper:list',
    GET: 'keeper:get',
    CREATE: 'keeper:create',
    UPDATE: 'keeper:update',
    DELETE: 'keeper:delete',
    REVEAL: 'keeper:reveal',
    UNLOCK_STATUS: 'keeper:unlockStatus',
    IMPORT_BROWSER: 'keeper:importBrowser',
  },
  identity: {
    GET_STATE: 'identity:getState',
    UPDATE_PROFILE: 'identity:updateProfile',
    CONNECT: 'identity:connect',
    DISCONNECT: 'identity:disconnect',
    REFRESH_STATUS: 'identity:refreshStatus',
    CHANGED: 'identity:changed',
  },
  fabric: {
    LIST_CONNECTIONS: 'fabric:listConnections',
    CREATE_CONNECTION: 'fabric:createConnection',
    LIST_CREDENTIALS: 'fabric:listCredentials',
    LIST_AUDIT: 'fabric:listAudit',
    DISCOVER: 'fabric:discover',
    PREVIEW: 'fabric:preview',
    COMMIT_IMPORT: 'fabric:commitImport',
    LIST_GRANTS: 'fabric:listGrants',
    PUT_GRANT: 'fabric:putGrant',
    ACQUIRE_LEASE: 'fabric:acquireLease',
    REVOKE_CONNECTION: 'fabric:revokeConnection',
    GITHUB_STATUS: 'fabric:githubStatus',
    /** Onboarding «Привязать GitHub» — existing device flow, link mode. */
    GITHUB_LINK_START: 'fabric:githubLinkStart',
    GITHUB_LINK_POLL: 'fabric:githubLinkPoll',
    GITHUB_LINK_GET: 'fabric:githubLinkGet',
    INFISICAL_HEALTH: 'fabric:infisicalHealth',
    INFISICAL_PREVIEW_ACCOUNT: 'fabric:infisicalPreviewAccount',
    INFISICAL_COMMIT_IMPORT: 'fabric:infisicalCommitImport',
    INFISICAL_LIST_PATHS: 'fabric:infisicalListPaths',
    INFISICAL_LIST_ITEMS: 'fabric:infisicalListItems',
    INFISICAL_UPSERT_ITEM: 'fabric:infisicalUpsertItem',
    INFISICAL_DELETE_ITEM: 'fabric:infisicalDeleteItem',
  },
  extensions: {
    LIST_CATALOG: 'extensions:listCatalog',
    LIST_INSTALLED: 'extensions:listInstalled',
    SET_ENABLED: 'extensions:setEnabled',
    GET_STATE: 'extensions:getState',
    CHANGED: 'extensions:changed',
  },

  // pluginBridge — SiYuan plugin bridge projections (W6). LOCAL_ONLY.
  // Kernel plugin list is residual; handlers fail-soft / fixture-backed.
  // install/uninstall delegate to kernel bazaar APIs (G2: no Craft-side zip).
  pluginBridge: {
    LIST_PLUGINS: 'pluginBridge:listPlugins',
    GET_PROJECTIONS: 'pluginBridge:getProjections',
    SET_ENABLED: 'pluginBridge:setEnabled',
    OPEN_COMPAT: 'pluginBridge:openCompat', // returns route descriptor only
    INSTALL_BAZAAR: 'pluginBridge:installBazaar',
    UNINSTALL_BAZAAR: 'pluginBridge:uninstallBazaar',
  },

  // extensionHost — Craft Extension Host lifecycle (S-05 §3.5).
  // craft-sandbox utilityProcess only. Does NOT execute SiYuan plugins.
  // Capability broker: mint/revoke/proxyFetch stay LOCAL_ONLY in main.
  extensionHost: {
    STATUS: 'extensionHost:status',
    STATUS_ALL: 'extensionHost:statusAll',
    START: 'extensionHost:start',
    STOP: 'extensionHost:stop',
    RESTART: 'extensionHost:restart',
    LOAD: 'extensionHost:load',
    CALL: 'extensionHost:call',
    LIST_COMMANDS: 'extensionHost:listCommands',
    LIST_CAPABILITIES: 'extensionHost:listCapabilities',
    MINT_CAPABILITY: 'extensionHost:mintCapability',
    REVOKE_CAPABILITY: 'extensionHost:revokeCapability',
    PROXY_FETCH: 'extensionHost:proxyFetch',
    GET_URL_ALLOWLIST: 'extensionHost:getUrlAllowlist',
    SET_URL_ALLOWLIST: 'extensionHost:setUrlAllowlist',
    // S-05 §3.5 wave 3 — descriptor discovery + activation lifecycle. LOCAL_ONLY
    // (the craft-sandbox utilityProcess lives in the local Electron host only).
    LIST_DESCRIPTORS: 'extensionHost:listDescriptors',
    ACTIVATE: 'extensionHost:activate',
    RELOAD: 'extensionHost:reload',
  },

  // extensionSurface — sandboxed embedded BrowserView for extension UI
  // (partition persist:ext-${extensionId}). LOCAL_ONLY.
  extensionSurface: {
    CREATE_EMBEDDED: 'extensionSurface:createEmbedded',
    DESTROY: 'extensionSurface:destroy',
    LIST: 'extensionSurface:list',
    SYNC_BOUNDS: 'extensionSurface:syncBounds',
    FOCUS: 'extensionSurface:focus',
    STATE_CHANGED: 'extensionSurface:stateChanged',
    REMOVED: 'extensionSurface:removed',
  },

  onboarding: {
    ENSURE_FIRST_SESSION: 'onboarding:ensureFirstSession',
    GET_AUTH_STATE: 'onboarding:getAuthState',
    VALIDATE_MCP: 'onboarding:validateMcp',
    START_MCP_OAUTH: 'onboarding:startMcpOAuth',
    START_CLAUDE_OAUTH: 'onboarding:startClaudeOAuth',
    EXCHANGE_CLAUDE_CODE: 'onboarding:exchangeClaudeCode',
    HAS_CLAUDE_OAUTH_STATE: 'onboarding:hasClaudeOAuthState',
    CLEAR_CLAUDE_OAUTH_STATE: 'onboarding:clearClaudeOAuthState',
    DEFER_SETUP: 'onboarding:deferSetup',
    START_ROX_CONNECT: 'onboarding:startRoxConnect',
    GET_ROX_CLOUD_STATE: 'onboarding:getRoxCloudState',
    CLEAR_ROX_CLOUD: 'onboarding:clearRoxCloud',
    GET_ROX_BALANCE: 'onboarding:getRoxBalance',
    CHECK_HANDLE: 'onboarding:checkHandle',
    SAVE_OMP_CREDENTIAL: 'onboarding:saveOmpCredential',
    SUGGEST_PREFERENCES: 'onboarding:suggestPreferences',
    PERMISSIONS_STATUS: 'onboarding:permissionsStatus',
    OPEN_PERMISSION_SETTINGS: 'onboarding:openPermissionSettings',
  },
  llmConnections: {
    LIST: 'LLM_Connection:list',
    LIST_WITH_STATUS: 'LLM_Connection:listWithStatus',
    GET_STARTUP_SUMMARY: 'LLM_Connection:getStartupSummary',
    GET: 'LLM_Connection:get',
    GET_API_KEY: 'LLM_Connection:getApiKey',
    SAVE: 'LLM_Connection:save',
    DELETE: 'LLM_Connection:delete',
    TEST: 'LLM_Connection:test',
    SET_DEFAULT: 'LLM_Connection:setDefault',
    SET_WORKSPACE_DEFAULT: 'LLM_Connection:setWorkspaceDefault',
    REFRESH_MODELS: 'LLM_Connection:refreshModels',
    CHANGED: 'LLM_Connection:changed',
  },
  chatgpt: {
    START_OAUTH: 'chatgpt:startOAuth',
    COMPLETE_OAUTH: 'chatgpt:completeOAuth',
    CANCEL_OAUTH: 'chatgpt:cancelOAuth',
    GET_AUTH_STATUS: 'chatgpt:getAuthStatus',
    LOGOUT: 'chatgpt:logout',
  },
  copilot: {
    START_OAUTH: 'copilot:startOAuth',
    CANCEL_OAUTH: 'copilot:cancelOAuth',
    GET_AUTH_STATUS: 'copilot:getAuthStatus',
    LOGOUT: 'copilot:logout',
    DEVICE_CODE: 'copilot:deviceCode',
  },
  settings: {
    SETUP_LLM_CONNECTION: 'settings:setupLlmConnection',
    TEST_LLM_CONNECTION_SETUP: 'settings:testLlmConnectionSetup',
    GET_DEFAULT_THINKING_LEVEL: 'settings:getDefaultThinkingLevel',
    SET_DEFAULT_THINKING_LEVEL: 'settings:setDefaultThinkingLevel',
    GET_NETWORK_PROXY: 'settings:getNetworkProxy',
    SET_NETWORK_PROXY: 'settings:setNetworkProxy',
    GET_SERVER_CONFIG: 'settings:getServerConfig',
    SET_SERVER_CONFIG: 'settings:setServerConfig',
    GET_SERVER_STATUS: 'settings:getServerStatus',
    GET_ENV_OVERRIDES: 'settings:getEnvOverrides',
    SET_ENV_OVERRIDES: 'settings:setEnvOverrides',
    GET_SECRET_REFS: 'settings:getSecretRefs',
    SET_SECRET_REFS: 'settings:setSecretRefs',
  },
  pi: {
    GET_API_KEY_PROVIDERS: 'pi:getApiKeyProviders',
    GET_PROVIDER_BASE_URL: 'pi:getProviderBaseUrl',
    GET_PROVIDER_MODELS: 'pi:getProviderModels',
  },
  dialog: {
    OPEN_FOLDER: 'dialog:openFolder',
  },
  preferences: {
    READ: 'preferences:read',
    WRITE: 'preferences:write',
  },
  gamification: {
    GET: 'gamification:get',
    AWARD: 'gamification:award',
    QUEST: 'gamification:quest',
    RATE: 'gamification:rate',
    SET_CONSENT: 'gamification:setConsent',
    CHANGED: 'gamification:changed',
  },
  privacy: {
    GET: 'privacy:get',
    SET_PURPOSE: 'privacy:setPurpose',
    REQUEST_EXPORT: 'privacy:requestExport',
    REQUEST_DELETION: 'privacy:requestDeletion',
    COMPLETE_DELETION: 'privacy:completeDeletion',
    CHANGED: 'privacy:changed',
  },
  voice: {
    GET: 'voice:get',
    SAVE: 'voice:save',
    HEALTH: 'voice:health',
    TRANSCRIBE: 'voice:transcribe',
    SPEAK: 'voice:speak',
    CHANGED: 'voice:changed',
    BOOTSTRAP: 'voice:bootstrap',
    CAPABILITIES: 'voice:capabilities',
    START: 'voice:start',
    STOP: 'voice:stop',
    CANCEL: 'voice:cancel',
    GRANT: 'voice:grantPermission',
    CHUNK: 'voice:chunk',
    LEVEL: 'voice:level',
    HISTORY_LIST: 'voice:historyList',
    HISTORY_GET: 'voice:historyGet',
    HISTORY_FAVORITE: 'voice:historyFavorite',
    HISTORY_DELETE: 'voice:historyDelete',
    HISTORY_EXPORT: 'voice:historyExport',
    HISTORY_EDIT: 'voice:historyEdit',
    HISTORY_SELECT: 'voice:historySelect',
    HISTORY_AUDIO: 'voice:historyAudio',
    COPY_TEXT: 'voice:copyText',
    RETRANSCRIBE: 'voice:retranscribe',
    REPROCESS: 'voice:reprocess',
    PROCESS: 'voice:process',
    MODELS_LIST: 'voice:modelsList',
    JOB: 'voice:job',
    OVERLAY: 'voice:overlay',
    HOTKEY: 'voice:hotkey',
    TALK_START: 'voice:talkStart',
    TALK_STOP: 'voice:talkStop',
    TALK_AUDIO: 'voice:talkAudio',
    TALK_EVENT: 'voice:talkEvent',
    TALK_CLIENT_SECRET: 'voice:talkClientSecret',
    TTS_STREAM_START: 'voice:ttsStreamStart',
    TTS_STREAM_CHUNK: 'voice:ttsStreamChunk',
    TTS_STREAM_STOP: 'voice:ttsStreamStop',
    STT_START: 'voice:sttStart',
    STT_AUDIO: 'voice:sttAudio',
    STT_STOP: 'voice:sttStop',
    STT_EVENT: 'voice:sttEvent',
    PROVIDERS: 'voice:providers',
    WAKE_GET: 'voice:wakeGet',
    WAKE_SET: 'voice:wakeSet',
    WAKE_CHANGED: 'voice:wakeChanged',
    TRIGGER: 'voice:trigger',
  },
  podcast: {
    /** Podcast generation run; `voice:job` stays for dictation/ASR (§5.1, D13). */
    JOB: 'podcast:job',
    /** Start a local generation run (scenario → segment TTS → ffmpeg mixdown). */
    START: 'podcast:start',
    /** Cancel the active local generation run; a partial mixdown is never published. */
    CANCEL: 'podcast:cancel',
    /** List generated episodes of a project from the audio index + manifest. */
    EPISODES: 'podcast:episodes',
    /** Frame-aligned read of an episode's mp3 (player + export). */
    AUDIO: 'podcast:audio',
    /** A `data:` URL for the player when the episode fits a single message. */
    AUDIO_URL: 'podcast:audioUrl',
  },
  playbooks: {
    /** Start a local codebook notebook run (cells → script/agent/artifact steps). */
    RUN_CODEBOOK: 'playbooks:runCodebook',
    /** Cancel the active codebook run; no partial run journal is published. */
    CANCEL_CODEBOOK: 'playbooks:cancelCodebook',
    /** List the durable codebook run journal of a project. */
    CODEBOOK_RUNS: 'playbooks:codebookRuns',
    /** Codebook run progress; monotonic `seq`, one stream per job (§9, D12). */
    CODEBOOK_JOB: 'playbooks:codebookJob',
  },
  environment: {
    GET: 'environment:get',
    SAVE: 'environment:save',
    CHANGED: 'environment:changed',
  },
  drafts: {
    GET: 'drafts:get',
    SET: 'drafts:set',
    DELETE: 'drafts:delete',
    GET_ALL: 'drafts:getAll',
  },
  sources: {
    GET: 'sources:get',
    CREATE: 'sources:create',
    UPDATE: 'sources:update',
    DELETE: 'sources:delete',
    START_OAUTH: 'sources:startOAuth',
    SAVE_CREDENTIALS: 'sources:saveCredentials',
    CHANGED: 'sources:changed',
    GET_PERMISSIONS: 'sources:getPermissions',
    GET_MCP_TOOLS: 'sources:getMcpTools',
    REINDEX: 'sources:reindex',
    SEARCH: 'sources:search',
    STATUS: 'sources:status',
    INDEX_CHANGED: 'sources:indexChanged',
  },
  oauth: {
    START: 'oauth:start',
    COMPLETE: 'oauth:complete',
    CANCEL: 'oauth:cancel',
    REVOKE: 'oauth:revoke',
  },
  /** Google Calendar connector (wave 1). Tokens live in the credential manager. */
  calendar: {
    GOOGLE_STATUS: 'calendar:googleStatus',
    GOOGLE_CONNECT: 'calendar:googleConnect',
    GOOGLE_DISCONNECT: 'calendar:googleDisconnect',
    GOOGLE_SYNC: 'calendar:googleSync',
  },
  /**
   * Google Meet artifacts (wave 5, row d2.6) — read-only Developer-Preview
   * surface over a meeting space's conference records (participants,
   * recordings, transcripts, smart notes). The local app server holds the
   * OAuth broker + credential manager, so the whole namespace is LOCAL_ONLY;
   * every channel refuses with `PREVIEW_NOT_ACKNOWLEDGED` until the host
   * acknowledges Developer-Preview enrollment.
   */
  meet: {
    /** `spaces.get` — resolve a space (meeting URL / code → space + Meet URI). */
    SPACE: 'meet:space',
    /** `conferenceRecords.list` — a space's conference records. */
    CONFERENCE_RECORDS: 'meet:conferenceRecords',
    /** `conferenceRecords.participants.list`. */
    PARTICIPANTS: 'meet:participants',
    /** `conferenceRecords.recordings.list`. */
    RECORDINGS: 'meet:recordings',
    /** `conferenceRecords.transcripts.list`. */
    TRANSCRIPTS: 'meet:transcripts',
    /** `conferenceRecords.smartNotes.list`. */
    SMART_NOTES: 'meet:smartNotes',
  },
  workspace: {
    GET_PERMISSIONS: 'workspace:getPermissions',
    OPEN_IN_EDITOR: 'workspace:openInEditor',
    READ_IMAGE: 'workspace:readImage',
    WRITE_IMAGE: 'workspace:writeImage',
    SETTINGS_GET: 'workspaceSettings:get',
    SETTINGS_UPDATE: 'workspaceSettings:update',
  },
  permissions: {
    GET_DEFAULTS: 'permissions:getDefaults',
    DEFAULTS_CHANGED: 'permissions:defaultsChanged',
  },
  skills: {
    GET: 'skills:get',
    GET_DETAILS: 'skills:getDetails',
    GET_FILES: 'skills:getFiles',
    UPDATE: 'skills:update',
    DELETE: 'skills:delete',
    OPEN_EDITOR: 'skills:openEditor',
    OPEN_FINDER: 'skills:openFinder',
    IMPORT_OMP: 'skills:importOmp',
    // S4: usage metrics from {workspace}/skills/.usage.jsonl + prune (archive, never delete)
    GET_USAGE: 'skills:getUsage',
    PRUNE_UNUSED: 'skills:pruneUnused',
    // T1: copy a workspace skill into {projectRoot}/.agents/skills/<slug>
    EXPORT_TO_PROJECT: 'skills:exportToProject',
    GET_ELIGIBILITY: 'skills:getEligibility',
    CHANGED: 'skills:changed',
  },
  skillsPending: {
    LIST: 'skillsPending:list',
    APPROVE: 'skillsPending:approve',
    DISMISS: 'skillsPending:dismiss',
    DIFF: 'skillsPending:diff',
    CHANGED: 'skillsPending:changed',
  },
  memory: {
    LIST_LESSONS: 'memory:listLessons',
    LIST_ARCHIVE: 'memory:listArchive',
    RESTORE_ARCHIVE: 'memory:restoreArchive',
    ADD_LESSON: 'memory:addLesson',
    UPDATE_LESSON: 'memory:updateLesson',
    DELETE_LESSON: 'memory:deleteLesson',
    GET_CONTEXT: 'memory:getContext',
    GET_PROJECT_MEMORY: 'memory:getProjectMemory',
    UPDATE_CONTEXT: 'memory:updateContext',
    LIST_HISTORY: 'memory:listHistory',
    PROMOTION_CANDIDATES: 'memory:promotionCandidates',
    PROMOTE_LESSON: 'memory:promoteLesson',
    EXPORT: 'memory:export',
    IMPORT: 'memory:import',
    // Y1: 7-day dashboard counters aggregated from both audit.jsonl files,
    // plus the Y4 onboarding marker state.
    INSIGHTS: 'memory:insights',
    MARK_ONBOARDED: 'memory:markOnboarded',
    LIST_PROPOSALS: 'memory:listProposals',
    EXTRACT_PROPOSALS: 'memory:extractProposals',
    APPROVE_PROPOSAL: 'memory:approveProposal',
    REJECT_PROPOSAL: 'memory:rejectProposal',
    EDIT_PROPOSAL: 'memory:editProposal',
    DELETE_PROPOSAL: 'memory:deleteProposal',
    SEARCH: 'memory:search',
    GET: 'memory:get',
    INDEX_STATUS: 'memory:indexStatus',
    REBUILD_INDEX: 'memory:rebuildIndex',
    CHANGED: 'memory:changed',
    // Repo projection (spec 2026-10-09 §7): read-only markdown view of a bank.
    REPO_LIST_BANKS: 'memory:repoListBanks',
    REPO_STATUS: 'memory:repoStatus',
    REPO_TREE: 'memory:repoTree',
    REPO_READ_FILE: 'memory:repoReadFile',
    REPO_COMMITS: 'memory:repoCommits',
    REPO_COMMIT_DIFF: 'memory:repoCommitDiff',
    REPO_GRAPH: 'memory:repoGraph',
    REPO_EXPORT: 'memory:repoExport',
    // Dream (memory build) status/manual run/journal.
    DREAM_STATUS: 'memory:dreamStatus',
    DREAM_RUN: 'memory:dreamRun',
    DREAM_LOG: 'memory:dreamLog',
    // Import of human edits back through the proposals pipeline (Phase 5).
    REPO_PREVIEW_IMPORT: 'memory:repoPreviewImport',
    REPO_APPLY_IMPORT: 'memory:repoApplyImport',
    REPO_REVERT_IMPORT: 'memory:repoRevertImport',
    // Pushes.
    REPO_CHANGED: 'memory:repoChanged',
    DREAM_EVENT: 'memory:dreamEvent',
    DREAM_DONE: 'memory:dreamDone',
    REPO_IMPORT_READY: 'memory:repoImportReady',
    // Wave 3 — workspace memory wiki (claims/evidence + lint). REMOTE_ELIGIBLE
    // like the rest of the memory namespace (workspace data on the owning server).
    WIKI_LIST: 'memory:wikiList',
    WIKI_GET: 'memory:wikiGet',
    WIKI_APPLY: 'memory:wikiApply',
    WIKI_LINT: 'memory:wikiLint',
  },
  /** Continual learning (PRD §15): candidates/evidence/outcomes/policies.
   *  OBSERVE/RECORD_OUTCOME/RECORD_CORRECTION are agent/native actions — they
   *  are deliberately absent from the renderer channel map. */
  learning: {
    // Read
    LIST_CANDIDATES: 'learning:listCandidates',
    GET_CANDIDATE: 'learning:getCandidate',
    LIST_EVIDENCE: 'learning:listEvidence',
    GET_OUTCOME: 'learning:getOutcome',
    GET_EXPERIMENT: 'learning:getExperiment',
    GET_STATS: 'learning:getStats',
    GET_SKILL_EFFECTIVENESS: 'learning:getSkillEffectiveness',
    GET_POLICY: 'learning:getPolicy',
    GET_TIMELINE: 'learning:getTimeline',
    // Actions
    APPROVE: 'learning:approve',
    REJECT: 'learning:reject',
    ROLLBACK: 'learning:rollback',
    REVALIDATE: 'learning:revalidate',
    FORCE_REFLECT: 'learning:forceReflect',
    CONSOLIDATE: 'learning:consolidate',
    CURATE_SKILLS: 'learning:curateSkills',
    RUN_POLICY_LEARNING: 'learning:runPolicyLearning',
    // Agent / native actions
    OBSERVE: 'learning:observe',
    RECORD_OUTCOME: 'learning:recordOutcome',
    RECORD_CORRECTION: 'learning:recordCorrection',
  },
  statuses: {
    LIST: 'statuses:list',
    REORDER: 'statuses:reorder',
    CHANGED: 'statuses:changed',
  },
  toolchain: {
    STATUS: 'toolchain:status',
    STATUS_CHANGED: 'toolchain:statusChanged',
    UPDATE: 'toolchain:update',
    GET_DISABLED: 'toolchain:getDisabled',
    SET_DISABLED: 'toolchain:setDisabled',
  },
  openclawRuntime: {
    GET_STATUS: 'openclawRuntime:getStatus',
    INSTALL: 'openclawRuntime:install',
    PROVISION: 'openclawRuntime:provision',
    START: 'openclawRuntime:start',
    STOP: 'openclawRuntime:stop',
  },
  // serviceLifecycle — OS-level service control (launchd/systemd/Windows service).
  // Managed by the local Electron main process; never proxied.
  serviceLifecycle: {
    GET_STATUS: 'serviceLifecycle:getStatus',
    INSTALL: 'serviceLifecycle:install',
    START: 'serviceLifecycle:start',
    STOP: 'serviceLifecycle:stop',
    RESTART: 'serviceLifecycle:restart',
    UNINSTALL: 'serviceLifecycle:uninstall',
    STATUS_CHANGED: 'serviceLifecycle:statusChanged',
  },
  // diagnostics — local host doctor checks (service/port/runtime/config/logs).
  diagnostics: {
    RUN: 'diagnostics:run',
    GET_LAST: 'diagnostics:getLast',
  },
  securityAudit: {
    RUN: 'securityAudit:run',
    GET_LATEST: 'securityAudit:getLatest',
    ACCEPT_RISK: 'securityAudit:acceptRisk',
    REVOKE_RISK_ACCEPTANCE: 'securityAudit:revokeRiskAcceptance',
  },
  commandGateway: {
    LIST: 'command:list',
    APPROVE: 'command:approve',
    DENY: 'command:deny',
  },
  labels: {
    LIST: 'labels:list',
    CREATE: 'labels:create',
    UPDATE: 'labels:update',
    DELETE: 'labels:delete',
    CHANGED: 'labels:changed',
  },
  orgs: {
    LIST: 'orgs:list',
    CREATE: 'orgs:create',
    INVITE: 'orgs:invite',
    ACCEPT: 'orgs:accept',
    LIST_MEMBERS: 'orgs:listMembers',
    GET_IDENTITY: 'orgs:getIdentity',
    UPDATE_IDENTITY: 'orgs:updateIdentity',
    SET_WORKSPACE_ORG: 'orgs:setWorkspaceOrg',
    UPDATE_MEMBER_ROLE: 'orgs:updateMemberRole',
    REMOVE_MEMBER: 'orgs:removeMember',
    REVOKE_INVITE: 'orgs:revokeInvite',
  },
  views: {
    LIST: 'views:list',
    SAVE: 'views:save',
  },
  toolIcons: {
    GET_MAPPINGS: 'toolIcons:getMappings',
  },
  logo: {
    GET_URL: 'logo:getUrl',
  },
  notification: {
    SHOW: 'notification:show',
    NAVIGATE: 'notification:navigate',
    GET_ENABLED: 'notification:getEnabled',
    SET_ENABLED: 'notification:setEnabled',
  },
  input: {
    GET_AUTO_CAPITALISATION: 'input:getAutoCapitalisation',
    SET_AUTO_CAPITALISATION: 'input:setAutoCapitalisation',
    GET_SEND_MESSAGE_KEY: 'input:getSendMessageKey',
    SET_SEND_MESSAGE_KEY: 'input:setSendMessageKey',
    GET_SPELL_CHECK: 'input:getSpellCheck',
    SET_SPELL_CHECK: 'input:setSpellCheck',
  },
  power: {
    GET_KEEP_AWAKE: 'power:getKeepAwake',
    SET_KEEP_AWAKE: 'power:setKeepAwake',
  },
  appearance: {
    GET_RICH_TOOL_DESCRIPTIONS: 'appearance:getRichToolDescriptions',
    SET_RICH_TOOL_DESCRIPTIONS: 'appearance:setRichToolDescriptions',
    GET_DEFAULT_ZOOM_LEVEL: 'appearance:getDefaultZoomLevel',
    SET_DEFAULT_ZOOM_LEVEL: 'appearance:setDefaultZoomLevel',
    GET_SHELL_SNAPSHOT: 'appearance:getShellSnapshot',
    SET_ZEN_SHELL: 'appearance:setZenShell',
    SHELL_CHANGED: 'appearance:shellChanged',
    /** DISPATCH A6/B10 — persisted UI preferences (status bar + accent source). */
    GET_UI_PREFERENCES: 'appearance:getUiPreferences',
    SET_UI_PREFERENCES: 'appearance:setUiPreferences',
    /** DISPATCH B10 — macOS system accent colour push (LOCAL_ONLY). */
    ACCENT_CHANGED: 'appearance:accentChanged',
  },
  /** DISPATCH C1 — import themes from an installed Zed (LOCAL_ONLY, filesystem). */
  zedThemes: {
    LIST: 'zedThemes:list',
    IMPORT: 'zedThemes:import',
  },
  tools: {
    GET_BROWSER_TOOL_ENABLED: 'tools:getBrowserToolEnabled',
    SET_BROWSER_TOOL_ENABLED: 'tools:setBrowserToolEnabled',
  },
  caching: {
    GET_EXTENDED_PROMPT_CACHE: 'caching:getExtendedPromptCache',
    SET_EXTENDED_PROMPT_CACHE: 'caching:setExtendedPromptCache',
    GET_ENABLE_1M_CONTEXT: 'caching:getEnable1MContext',
    SET_ENABLE_1M_CONTEXT: 'caching:setEnable1MContext',
  },
  rtk: {
    GET_ENABLED: 'rtk:getEnabled',
    SET_ENABLED: 'rtk:setEnabled',
    GET_STATUS: 'rtk:getStatus',
    GET_GAIN: 'rtk:getGain',
  },
  badge: {
    REFRESH: 'badge:refresh',
    SET_ICON: 'badge:setIcon',
    DRAW: 'badge:draw',
    DRAW_WINDOWS: 'badge:draw-windows',
  },
  releaseNotes: {
    GET: 'releaseNotes:get',
    GET_LATEST_VERSION: 'releaseNotes:getLatestVersion',
  },
  git: {
    GET_BRANCH: 'git:getBranch',
    GET_STATUS: 'git:getStatus',
    GET_WORKSPACE_SNAPSHOT: 'git:getWorkspaceSnapshot',
  },
  gitbash: {
    CHECK: 'gitbash:check',
    BROWSE: 'gitbash:browse',
    SET_PATH: 'gitbash:setPath',
  },
  browserPane: {
    CREATE: 'browser-pane:create',
    CREATE_EMBEDDED: 'browser-pane:create-embedded',
    SYNC_BOUNDS: 'browser-pane:sync-bounds',
    DESTROY: 'browser-pane:destroy',
    LIST: 'browser-pane:list',
    NAVIGATE: 'browser-pane:navigate',
    GO_BACK: 'browser-pane:go-back',
    GO_FORWARD: 'browser-pane:go-forward',
    RELOAD: 'browser-pane:reload',
    STOP: 'browser-pane:stop',
    FOCUS: 'browser-pane:focus',
    RESIZE: 'browser-pane:resize',
    SNAPSHOT: 'browser-pane:snapshot',
    CLICK: 'browser-pane:click',
    CLICK_AT: 'browser-pane:click-at',
    FILL: 'browser-pane:fill',
    TYPE: 'browser-pane:type',
    KEY: 'browser-pane:key',
    SELECT: 'browser-pane:select',
    SCREENSHOT: 'browser-pane:screenshot',
    EVALUATE: 'browser-pane:evaluate',
    SCROLL: 'browser-pane:scroll',
    LAUNCH: 'browser-empty-state:launch',
    STATE_CHANGED: 'browser-pane:state-changed',
    REMOVED: 'browser-pane:removed',
    INTERACTED: 'browser-pane:interacted',
  },
  browserProfile: {
    CREDENTIAL_CAPABILITIES: 'browserProfile:credentialCapabilities',
    DISCOVER: 'browserProfile:discover',
    IMPORT: 'browserProfile:import',
    ROLLBACK: 'browserProfile:rollback',
    DELETE: 'browserProfile:delete',
    DATA_AUTO_IMPORT: 'browserProfile:dataAutoImport',
    COOKIE_AUTO_STATUS: 'browserProfile:cookieAutoStatus',
    COOKIE_AUTO_SET: 'browserProfile:cookieAutoSet',
    COOKIE_AUTO_RUN: 'browserProfile:cookieAutoRun',
  },
  // browserCredentials — host-only export of the sealed browser password vault
  // for Keeper import. LOCAL_ONLY: the vault key never leaves the host process.
  browserCredentials: {
    EXPORT_FOR_KEEPER: 'browserCredentials:exportForKeeper',
  },
  // browserIntel — Browser Intelligence Pipeline surface. Reads the local
  // browser profile stores and stages them on this machine only; all channels
  // are LOCAL_ONLY (never proxied to a remote server).
  browserIntel: {
    GET_STATE: 'browserIntel:getState',
    SET_CONSENT: 'browserIntel:setConsent',
    GET_STATS: 'browserIntel:getStats',
    GET_SLOTS: 'browserIntel:getSlots',
    START_RUN: 'browserIntel:startRun',
    CANCEL_RUN: 'browserIntel:cancelRun',
    PROGRESS: 'browserIntel:progress',
    STATE_CHANGED: 'browserIntel:stateChanged',
  },
  automations: {
    GET: 'automations:get',
    GET_GRAPH: 'automations:getGraph',
    SAVE_GRAPH: 'automations:saveGraph',
    TEST: 'automations:test',
    SET_ENABLED: 'automations:setEnabled',
    DUPLICATE: 'automations:duplicate',
    UPDATE: 'automations:update',
    CREATE: 'automations:create',
    DELETE: 'automations:delete',
    GET_HISTORY: 'automations:getHistory',
    GET_LAST_EXECUTED: 'automations:getLastExecuted',
    REPLAY: 'automations:replay',
    CHANGED: 'automations:changed',
  },
  resources: {
    EXPORT: 'resources:export',
    IMPORT: 'resources:import',
  },
  projects: {
    GET: 'projects:get',
    GET_ONE: 'projects:getOne',
    CREATE: 'projects:create',
    UPDATE: 'projects:update',
    DELETE: 'projects:delete',
    LIST_ASSETS: 'projects:listAssets',
    UPLOAD_ASSET: 'projects:uploadAsset',
    DELETE_ASSET: 'projects:deleteAsset',
    GET_ROADMAP: 'projects:getRoadmap',
    SAVE_ROADMAP: 'projects:saveRoadmap',
    AI_STATUS: 'projects:aiStatus',
    AI_ROADMAP: 'projects:aiRoadmap',
    CHANGED: 'projects:changed',
    GET_OKR: 'projects:getOkr',
    SAVE_OKR: 'projects:saveOkr',
  },
  pages: {
    GET: 'pages:get',
    GET_ONE: 'pages:getOne',
    CREATE: 'pages:create',
    UPDATE: 'pages:update',
    DELETE: 'pages:delete',
    GET_CONTENT: 'pages:getContent',
    SET_CONTENT: 'pages:setContent',
    GET_DATA: 'pages:getData',
    LIST_GRANTS: 'pages:listGrants',
    ISSUE_GRANT: 'pages:issueGrant',
    REVOKE_GRANT: 'pages:revokeGrant',
    CREATE_LEASE: 'pages:createLease',
    RELEASE_LEASE: 'pages:releaseLease',
    EXECUTE_ACTION: 'pages:executeAction',
    CANCEL_ACTION: 'pages:cancelAction',
    GET_SHARE_CAPABILITIES: 'pages:getShareCapabilities',
    GET_SHARE_DATA_SCAN: 'pages:getShareDataScan',
    PUBLISH: 'pages:publish',
    SET_PUBLICATION_PASSWORD: 'pages:setPublicationPassword',
    UNPUBLISH: 'pages:unpublish',
    GET_THUMBNAIL: 'pages:getThumbnail',
    REGENERATE_THUMBNAIL: 'pages:regenerateThumbnail',
    CHANGED: 'pages:changed',
  },
  /** Things-style personal tasks persisted under the config dir (personal-persist.ts). */
  personalTasks: {
    LIST: 'personalTasks:list',
    PUT: 'personalTasks:put',
    DELETE: 'personalTasks:delete',
    MIGRATE: 'personalTasks:migrate',
    CHANGED: 'personalTasks:changed',
  },
  /** Лента aggregator: agents/team/news/subscriptions (server-core/src/feed). */
  feed: {
    LIST: 'feed:list',
    CHANGED: 'feed:changed',
    SOURCES_ADD: 'feed:sources:add',
    SOURCES_REMOVE: 'feed:sources:remove',
    SOURCES_UPDATE: 'feed:sources:update',
    REFRESH: 'feed:refresh',
    X_SET_TOKEN: 'feed:x:setToken',
    X_CLEAR: 'feed:x:clear',
    SOURCES_PREVIEW: 'feed:sources:preview',
    ITEMS_ANNOTATE: 'feed:items:annotate',
  },
  kanban: {
    GET_CONFIG: 'kanban:getConfig',
    SET_CONFIG: 'kanban:setConfig',
    CHANGED: 'kanban:changed',
  },
  // workboard — wave-3 workspace task board (WorkBoard state, revision-guarded).
  // Classified like kanban:* (REMOTE_ELIGIBLE workspace board config).
  workboard: {
    READ: 'workboard:read',
    MOVE: 'workboard:move',
    CHANGED: 'workboard:changed',
  },
  // board — wave-3 workspace board widgets (authored widget code mounted in a
  // ticket-scoped sandbox). Classified like pages:* (REMOTE_ELIGIBLE workspace content).
  board: {
    WIDGET_PUT: 'board:widgetPut',
    WIDGET_GET: 'board:widgetGet',
    WIDGET_MOUNT: 'board:widgetMount',
    WIDGET_RELEASE: 'board:widgetRelease',
    /** Validate a frame ticket over the wire; refusal is one uniform typed error. */
    WIDGET_VALIDATE: 'board:widgetValidate',
    CHANGED: 'board:changed',
  },
  collection: {
    GET_DISPLAY: 'collection:getDisplay',
    SET_DISPLAY: 'collection:setDisplay',
    CHANGED: 'collection:changed',
    GET_FILTERS: 'collection:getFilters',
    SET_FILTERS: 'collection:setFilters',
    FILTERS_CHANGED: 'collection:filtersChanged',
  },

  mindmap: {
    /** One-shot LLM outline improve → enriched MindMapGraph (LOCAL_ONLY). */
    ENRICH: 'mindmap:enrich',
    PIN_LOAD: 'mindmap:pinLoad',
    PIN_SAVE: 'mindmap:pinSave',
    PIN_CLEAR: 'mindmap:pinClear',
  },

  messaging: {
    // WhatsApp subprocess → Gateway (subprocess invokes on server)
    WA_REGISTER: 'messaging:wa:register',
    WA_INCOMING: 'messaging:wa:incoming',
    WA_BUTTON_PRESS: 'messaging:wa:buttonPress',
    WA_STATUS: 'messaging:wa:status',
    WA_QR: 'messaging:wa:qr',
    // Gateway → WhatsApp subprocess (server invokes on client)
    WA_SEND: 'messaging:wa:send',
    WA_SEND_BUTTONS: 'messaging:wa:sendButtons',
    WA_SEND_TYPING: 'messaging:wa:sendTyping',
    WA_SEND_FILE: 'messaging:wa:sendFile',
    WA_CONNECT: 'messaging:wa:connect',
    WA_DISCONNECT: 'messaging:wa:disconnect',
    // Gateway → UI clients (broadcast)
    BINDING_CHANGED: 'messaging:bindingChanged',
    PLATFORM_STATUS: 'messaging:platformStatus',
    /** Broadcast when the workspace's pending-senders list mutates. */
    PENDING_CHANGED: 'messaging:pendingChanged',
    // UI ↔ Server (config/binding CRUD)
    GET_CONFIG: 'messaging:getConfig',
    UPDATE_CONFIG: 'messaging:updateConfig',
    TEST_TELEGRAM: 'messaging:testTelegram',
    SAVE_TELEGRAM: 'messaging:saveTelegram',
    TEST_LARK: 'messaging:testLark',
    SAVE_LARK: 'messaging:saveLark',
    TEST_DISCORD: 'messaging:testDiscord',
    SAVE_DISCORD: 'messaging:saveDiscord',
    // UI ↔ Server — WeChat (微信) iLink QR login flow
    WECHAT_START_CONNECT: 'messaging:wechat:startConnect',
    WECHAT_SUBMIT_CODE: 'messaging:wechat:submitCode',
    WECHAT_UI_EVENT: 'messaging:wechat:uiEvent',
    DISCONNECT: 'messaging:disconnect',
    FORGET: 'messaging:forget',
    GET_BINDINGS: 'messaging:getBindings',
    GENERATE_CODE: 'messaging:generateCode',
    UNBIND: 'messaging:unbind',
    UNBIND_BINDING: 'messaging:unbindBinding',
    /** Workspace-supergroup pairing (Telegram forum support). UI ↔ Server. */
    GENERATE_SUPERGROUP_CODE: 'messaging:generateSupergroupCode',
    GET_SUPERGROUP: 'messaging:getSupergroup',
    UNBIND_SUPERGROUP: 'messaging:unbindSupergroup',
    // UI ↔ Server — WhatsApp pairing/connection flow (Baileys subprocess adapter)
    WA_START_CONNECT: 'messaging:wa:startConnect',
    WA_SUBMIT_PHONE: 'messaging:wa:submitPhone',
    /** Broadcast to UI clients: QR string, pairing code, status, unavailable, error. */
    WA_UI_EVENT: 'messaging:wa:uiEvent',
    // UI ↔ Server — Access control (per-platform owners + per-binding allow-list)
    GET_PLATFORM_OWNERS: 'messaging:access:getOwners',
    SET_PLATFORM_OWNERS: 'messaging:access:setOwners',
    GET_PLATFORM_ACCESS_MODE: 'messaging:access:getMode',
    SET_PLATFORM_ACCESS_MODE: 'messaging:access:setMode',
    GET_PENDING_SENDERS: 'messaging:access:getPending',
    DISMISS_PENDING_SENDER: 'messaging:access:dismissPending',
    ALLOW_PENDING_SENDER: 'messaging:access:allowPending',
    SET_BINDING_ACCESS: 'messaging:access:setBindingAccess',
    SET_DISCORD_GUILD_TRIGGER: 'messaging:setDiscordGuildTrigger',
    // UI ↔ Server — WeChat QR-login flow (in-process, iLink long-poll)
    WC_START_CONNECT: 'messaging:wc:startConnect',
    WC_CANCEL_CONNECT: 'messaging:wc:cancelConnect',
    /** Broadcast to UI clients: QR image url, scaned, confirmed, expired, error. */
    WC_UI_EVENT: 'messaging:wc:uiEvent',
  },
  contextDocs: {
    LIST: 'contextDocs:list',
    READ: 'contextDocs:read',
    WRITE: 'contextDocs:write',
    DELETE: 'contextDocs:delete',
    READ_TEMPLATE: 'contextDocs:readTemplate',
    ACCEPT_TEMPLATE: 'contextDocs:acceptTemplate',
    KEEP_MINE_TEMPLATE: 'contextDocs:keepMineTemplate',
    CHANGED: 'contextDocs:CHANGED',
  },
  bundledSkills: {
    LIST: 'bundledSkills:list',
    GET_DISABLED: 'bundledSkills:getDisabled',
    SET_DISABLED: 'bundledSkills:setDisabled',
    CHANGED: 'bundledSkills:CHANGED',
  },
  marketplace: {
    CATALOG: 'marketplace:catalog',
    STATS: 'marketplace:stats',
    INSTALL: 'marketplace:install',
    REMOVE: 'marketplace:remove',
    UPDATE: 'marketplace:update',
    REFRESH: 'marketplace:refresh',
    /** Progress push during install/update (clone/verify/install/fetch). */
    PROGRESS: 'marketplace:progress',
    CHANGED: 'marketplace:CHANGED',
  },
  meetings: {
    PLAN_ACTIONS: 'meetings:planActions',
    LIST: 'meetings:list',
    GET: 'meetings:get',
    SEARCH: 'meetings:search',
    DELETE: 'meetings:delete',
    CREATE: 'meetings:create',
    CREATE_PROPOSAL: 'meetings:createProposal',
    APPROVE_PROPOSAL: 'meetings:approveProposal',
    REJECT_PROPOSAL: 'meetings:rejectProposal',
    OPEN_TARGET: 'meetings:openTarget',
    MAIL_PREPARE: 'meetings:mailPrepare',
    MAIL_SEND: 'meetings:mailSend',
    CRM_PROPOSE: 'meetings:crmPropose',
    CALENDAR_BIND: 'meetings:calendarBind',
    ROOM_JOIN: 'meetings:roomJoin',
    MAIL_THREADS: 'meetings:mailThreads',
    START_CAPTURE: 'meetings:startCapture',
    PAUSE_CAPTURE: 'meetings:pauseCapture',
    STOP_CAPTURE: 'meetings:stopCapture',
    IMPORT_MEDIA: 'meetings:importMedia',
    FINALIZE: 'meetings:finalize',
    ADD_MANUAL_NOTE: 'meetings:addManualNote',
    CORRECT_SEGMENT: 'meetings:correctSegment',
    OBSERVE_START: 'meetings:observeStart',
    OBSERVE_STOP: 'meetings:observeStop',
    OBSERVE_STATE: 'meetings:observeState',
    SESSION_SUMMARY: 'meetings:sessionSummary',
    TRANSCRIPT_LINES: 'meetings:transcriptLines',
  },
  entities: {
    /** Query/command dispatcher for the local entity-link store. */
    LINKS: 'entities:links',
    /** Batch entity preview resolution (local + workspace). */
    RESOLVE: 'entities:resolve',
    /** Push: local link store changed for a workspace. */
    LINKS_CHANGED: 'entities:linksChanged',
  },
  // W1-03 (#1500)
  commands: {
    /** Execute a CommandEnvelope through the command bus; returns a CommandReceipt. */
    EXECUTE: 'commands:execute',
    /** Capability discovery: registered commands with {available, reason}. */
    LIST: 'commands:list',
    /** Push: realtime event frame or command-bus status for a workspace. */
    EVENT: 'commands:event',
  },
  // W1-04 (#1501)
  directory: {
    /** MIG-06: one-shot export of the renderer Dossier payload into local contact cards. */
    EXPORT_DOSSIER: 'directory:exportDossier',
  },
  // f.9 — node/device registry. Declared caps/commands are CLAIMS; the server
  // enforces its own allowlist before dispatching any node.invoke.
  nodes: {
    /** Register or reconnect a node with its declared caps/commands (claims only). */
    REGISTER: 'nodes:register',
    /** Snapshot of registered nodes with live presence. */
    LIST: 'nodes:list',
    /** Node heartbeat; refreshes presence and returns the current status. */
    PRESENCE: 'nodes:presence',
    /** Dispatch an allowlisted command to a node; resolves with the terminal result. */
    INVOKE: 'nodes:invoke',
    /** Node reports the terminal outcome of a pending invoke. */
    INVOKE_RESULT: 'nodes:invokeResult',
    /** Cancel a pending invoke; settles exactly once. */
    INVOKE_CANCEL: 'nodes:invokeCancel',
    /** Push: registry or presence changed. */
    CHANGED: 'nodes:changed',
  },
  /**
   * ROX Drive (wave 1) — device-local storage engine. Bytes, the JSON index and
   * the ledger live under the host config dir, so every channel is LOCAL_ONLY.
   * `SCAN_SOURCE` walks a backup source root on the host for the consent step.
   */
  drive: {
    QUOTA: 'drive:quota',
    LIST: 'drive:list',
    CREATE_FOLDER: 'drive:createFolder',
    OPEN_UPLOAD: 'drive:openUpload',
    UPLOAD_PART: 'drive:uploadPart',
    COMPLETE_UPLOAD: 'drive:completeUpload',
    ABORT_UPLOAD: 'drive:abortUpload',
    DELETE: 'drive:delete',
    SCAN_SOURCE: 'drive:scanSource',
    /** Wave 4: resolve a cloud provider's tree into an idle import job. */
    IMPORT_PLAN: 'drive:importPlan',
    /** Wave 4: start an idle import job. */
    IMPORT_START: 'drive:importStart',
    /** Wave 4: stop scheduling new files once in-flight work settles. */
    IMPORT_PAUSE: 'drive:importPause',
    /** Wave 4: abandon an import job — in-flight files settle, no further files start. */
    IMPORT_CANCEL: 'drive:importCancel',
    /** Wave 4: resume a paused/errored import job. */
    IMPORT_RESUME: 'drive:importResume',
    /** Wave 4: one job by id, or every known job when the id is omitted. */
    IMPORT_STATUS: 'drive:importStatus',
    /**
     * Wave 4: begin cloud-import authorization. The host owns the OAuth clients
     * and runs providers whose token flow must not live in the renderer; returns
     * either a stored-token fast path, a device-code challenge, or a URL the
     * caller opens (Google PKCE broker / Yandex code flow).
     */
    IMPORT_AUTH_START: 'drive:importAuthStart',
    /**
     * Wave 4: finish cloud-import authorization — exchange the pasted/returned
     * code or poll the device token — and persist tokens through the same store
     * the providers read.
     */
    IMPORT_AUTH_COMPLETE: 'drive:importAuthComplete',
  },
  /**
   * Telegram account linking (owner spec R4) — the desktop dialog talks to the
   * local rox-tg-linkd daemon through these LOCAL_ONLY channels; the Rox user id
   * is resolved server-side and never proxied to a remote server.
   */
  tgLink: {
    START: 'tg-link:start',
    VERIFY: 'tg-link:verify',
    STATUS: 'tg-link:status',
  },
  /**
   * Native integration — floating quick composer. All LOCAL_ONLY: the window,
   * the global shortcut and the persisted accelerator live in the main process.
   */
  quickComposer: {
    OPEN: 'quickComposer:open',
    CLOSE: 'quickComposer:close',
    GET_SHORTCUT: 'quickComposer:getShortcut',
    SET_SHORTCUT: 'quickComposer:setShortcut',
  },
  /**
   * Native app integration — OS-level app settings (login item / launch at
   * startup). LOCAL_ONLY: written by the host OS, never proxied to a server.
   */
  appIntegration: {
    GET_LOGIN_ITEM: 'appIntegration:getLoginItem',
    SET_LOGIN_ITEM: 'appIntegration:setLoginItem',
  },
  /**
   * Finder / filesystem affordances for a user-visible path. LOCAL_ONLY: they
   * act on the host machine (reveal, open, clipboard, Quick Look, drag-out).
   */
  files: {
    REVEAL_IN_FINDER: 'files:revealInFinder',
    OPEN_PATH: 'files:openPath',
    COPY_PATH: 'files:copyPath',
    QUICK_LOOK: 'files:quickLook',
    QUICK_LOOK_CLOSE: 'files:quickLookClose',
    START_DRAG: 'files:startDrag',
  },
} as const

// IPC_CHANNELS compat alias removed — all consumers now use RPC_CHANNELS

/**
 * Flatten all channel string values from the nested RPC_CHANNELS object.
 * Used by the exhaustive routing test to ensure every channel is classified.
 */
export function getAllChannelValues(): string[] {
  const values: string[] = []
  for (const namespace of Object.values(RPC_CHANNELS)) {
    for (const channel of Object.values(namespace)) {
      values.push(channel)
    }
  }
  return values
}
