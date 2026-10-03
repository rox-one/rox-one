import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from '../../utils/sqlite-runtime.ts'
import { readNativeBrowserData, parseSafariBookmarks } from '../profile-native-data.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-native-profile-fixture-'))
  directories.push(root)
  const path = join(root, 'profile'), snapshots = join(root, 'snapshots')
  mkdirSync(path); mkdirSync(snapshots)
  return { root, path, snapshots }
}

describe('native browser history and bookmarks', () => {
  it('imports a live Chromium WAL snapshot without modifying the browser database', () => {
    const { path, snapshots } = fixture()
    const database = new DatabaseSync(join(path, 'History'))
    try {
      database.exec(`PRAGMA journal_mode=WAL; CREATE TABLE urls(url TEXT,title TEXT,visit_count INTEGER,last_visit_time INTEGER);
        INSERT INTO urls VALUES ('https://native.example','Native history',3,123), ('file:///private','Excluded',1,124), ('https://unused.example','Never visited',0,125);`)
      expect(existsSync(join(path, 'History-wal'))).toBe(true)
      writeFileSync(join(path, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', url: 'https://bookmarked.example', name: 'Native bookmark' }] } } }))
      const imported = readNativeBrowserData({ family: 'chromium', path }, { history: true, bookmarks: true }, { temporaryRoot: snapshots })
      expect(imported.history).toEqual([{ kind: 'history', url: 'https://native.example', title: 'Native history' }])
      expect(imported.bookmarks).toEqual([{ kind: 'bookmark', url: 'https://bookmarked.example', title: 'Native bookmark' }])
      expect(database.prepare('SELECT COUNT(*) AS count FROM urls').get()?.count).toBe(3)
      expect(readdirSync(snapshots)).toEqual([])
    } finally { database.close() }
  })

  it('joins native Firefox bookmarks while importing visited places', () => {
    const { path, snapshots } = fixture()
    const database = new DatabaseSync(join(path, 'places.sqlite'))
    database.exec(`CREATE TABLE moz_places(id INTEGER PRIMARY KEY,url TEXT,title TEXT,visit_count INTEGER,last_visit_date INTEGER);
      CREATE TABLE moz_bookmarks(fk INTEGER,type INTEGER,title TEXT,dateAdded INTEGER);
      INSERT INTO moz_places VALUES (1,'https://visited.example','Visited',2,42),(2,'https://bookmarked.example','Place title',0,0);
      INSERT INTO moz_bookmarks VALUES (2,1,'Bookmark title',43),(NULL,2,'Folder',41);`)
    database.close()
    const imported = readNativeBrowserData({ family: 'firefox', path }, { history: true, bookmarks: true }, { temporaryRoot: snapshots })
    expect(imported.history).toEqual([{ kind: 'history', url: 'https://visited.example', title: 'Visited' }])
    expect(imported.bookmarks).toEqual([{ kind: 'bookmark', url: 'https://bookmarked.example', title: 'Bookmark title' }])
    expect(readdirSync(snapshots)).toEqual([])
  })

  it('queries only chosen categories, even when the declined category has no usable native schema', () => {
    const { path, snapshots } = fixture()
    const database = new DatabaseSync(join(path, 'places.sqlite'))
    database.exec(`CREATE TABLE moz_places(id INTEGER PRIMARY KEY,url TEXT,title TEXT);
      CREATE TABLE moz_bookmarks(fk INTEGER,type INTEGER,title TEXT,dateAdded INTEGER);
      INSERT INTO moz_places VALUES (1,'https://bookmarked.example','Place'); INSERT INTO moz_bookmarks VALUES(1,1,'Bookmark',1);`)
    database.close()
    const imported = readNativeBrowserData({ family: 'firefox', path }, { history: false, bookmarks: true }, { temporaryRoot: snapshots })
    expect(imported.history).toBeUndefined()
    expect(imported.bookmarks).toHaveLength(1)
    expect(readNativeBrowserData({ family: 'firefox', path: '/does-not-exist' }, { history: false, bookmarks: false })).toEqual({})
  })

  it('cleans snapshots after malformed databases and preserves separate Chromium opt-outs', () => {
    const { path, snapshots } = fixture()
    writeFileSync(join(path, 'History'), 'malformed database fixture')
    writeFileSync(join(path, 'Bookmarks'), JSON.stringify({ roots: {} }))
    expect(() => readNativeBrowserData({ family: 'chromium', path }, { history: true, bookmarks: false }, { temporaryRoot: snapshots })).toThrow('browser-data-read-failed')
    expect(readdirSync(snapshots)).toEqual([])
    expect(readNativeBrowserData({ family: 'chromium', path }, { history: false, bookmarks: true })).toEqual({ bookmarks: [] })
  })

  it('reads Safari history and XML bookmark folders without resolving external XML resources', () => {
    const { path, snapshots } = fixture()
    const database = new DatabaseSync(join(path, 'History.db'))
    database.exec(`CREATE TABLE history_items(id INTEGER,url TEXT); CREATE TABLE history_visits(history_item INTEGER,title TEXT,visit_time REAL);
      INSERT INTO history_items VALUES(1,'https://safari.example'); INSERT INTO history_visits VALUES(1,'Safari',12);`)
    database.close()
    const xml = '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "fixture" "https://never-fetch.example"><plist version="1.0"><dict><key>Children</key><array><dict><key>Children</key><array><dict><key>URLString</key><string>https://bookmark.example?a=1&amp;b=2</string><key>URIDictionary</key><dict><key>title</key><string>A &amp; B</string></dict></dict></array></dict></array></dict></plist>'
    writeFileSync(join(path, 'Bookmarks.plist'), xml)
    const imported = readNativeBrowserData({ family: 'safari', path }, { history: true, bookmarks: true }, { temporaryRoot: snapshots })
    expect(imported.history).toEqual([{ kind: 'history', url: 'https://safari.example', title: 'Safari' }])
    expect(imported.bookmarks).toEqual([{ kind: 'bookmark', url: 'https://bookmark.example?a=1&b=2', title: 'A & B' }])
    expect(parseSafariBookmarks(JSON.stringify({ Children: [{ URLString: 'https://json.example', URIDictionary: { title: 'Binary plist converted by plutil' } }] }))).toHaveLength(1)
  })

  it('preserves nested Safari folders, scalar metadata, empty elements and XML text', () => {
    const xml = `<?xml version="1.0"?>
      <!DOCTYPE plist PUBLIC "fixture" "https://never-fetch.example">
      <plist version="1.0">
        <dict>
          <key>WebBookmarkFileVersion</key><integer>1</integer>
          <key>Metadata</key><dict>
            <key>real</key><real>1.5</real><key>date</key><date>2026-01-01T00:00:00Z</date>
            <key>data</key><data>AA==</data><key>enabled</key><true/><key>disabled</key><false />
            <key>empty</key><dict/><key>children</key><array />
          </dict>
          <key>Ch&#105;ldren</key><array>
            <!-- Folder metadata and empty children are not bookmarks. -->
            <dict><key>Children</key><array>
              <dict>
                <key>UR&#76;String</key><string>https://nested.example/?a=1&amp;b=2</string>
                <key>URIDictionary</key><dict><key>title</key>
                  <string>A &lt;B&gt; &quot;C&quot; &apos;D&apos; &#65;&#x1F98A;<!-- ignored --><![CDATA[<raw>&amp;]]></string>
                </dict>
              </dict>
              <dict><key>URLString</key><string>https://empty-title.example</string>
                <key>URIDictionary</key><dict><key>title</key><string /></dict>
              </dict>
            </array></dict>
          </array>
        </dict>
      </plist>`
    expect(parseSafariBookmarks(xml)).toEqual([
      { kind: 'bookmark', url: 'https://nested.example/?a=1&b=2', title: `A <B> "C" 'D' A🦊<raw>&amp;` },
      { kind: 'bookmark', url: 'https://empty-title.example', title: '' },
    ])
  })

  it('rejects an unterminated key followed by many scalar openers', () => {
    // The former global regex rescanned the remaining suffix at every <data> opener.
    // A large input exercises that failure path without a machine-dependent timing assertion.
    const xml = `<plist><dict><key>${'<data>'.repeat(100_000)}</dict></plist>`
    expect(() => parseSafariBookmarks(xml)).toThrow('browser-bookmarks-format-unsupported')
  })

  it('rejects mismatched, missing, unknown and trailing plist tokens', () => {
    const malformed = [
      '<plist><dict><key>URLString</key><string>https://invalid.example</data></dict></plist>',
      '<plist><dict><key>URLString</key></dict></plist>',
      '<plist><dict><key>Children</key><array></dict></array></plist>',
      '<plist><dict><key>Children</key><unknown/></dict></plist>',
      '<plist><dict/><dict/></plist>',
      '<plist><dict/></plist><array/>',
      '<plist><dict/>',
      '<plist version="1.0><dict/></plist>',
      '<!DOCTYPE plist [<plist><dict/></plist>',
      `<plist>${'<array>'.repeat(130)}<dict/>${'</array>'.repeat(130)}</plist>`,
    ]
    for (const xml of malformed) {
      expect(() => parseSafariBookmarks(xml)).toThrow('browser-bookmarks-format-unsupported')
    }
  })
})
