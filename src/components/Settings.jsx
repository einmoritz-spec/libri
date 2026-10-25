import { useEffect, useRef, useState } from 'react'
import { loadRuntimes } from '../lib/audio'
import { exportLibrary, importLibrary, importLinks, autoBackupBeforeImport, getDiag, markBackupDone, daysSinceBackup, db, backfillCovers, enrichShopItems, resetEnrichTried, resetShopTried, removeDuplicateEntries, trimAllCovers } from '../lib/db'
import { parseBackupText } from '../lib/backupText'

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

/** Aufklappbarer Abschnitt. Beim Öffnen der Einstellungen sind alle zu:
    die Seite wird jedes Mal neu aufgebaut und `open` wird nie gesetzt. */
function Section({ title, danger, children }) {
  return (
    <details className={danger ? 'settings-section settings-section-danger' : 'settings-section'}>
      <summary>{title}</summary>
      <div className="settings-section-body">{children}</div>
    </details>
  )
}

/** Eine Zeile: links die Bezeichnung, rechts die Einstellung. */
function Row({ label, children }) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      {children}
    </div>
  )
}

function OnOff({ on, set }) {
  return (
    <div className="view-toggle">
      <button aria-pressed={on} onClick={() => set(true)}>An</button>
      <button aria-pressed={!on} onClick={() => set(false)}>Aus</button>
    </div>
  )
}

export default function Settings({ notify, onOpenShop }) {
  const fileRef = useRef(null)
  const [replace, setReplace] = useState(false)
  const [theme, setThemeState] = useState(
    () => localStorage.getItem('libri:theme') || 'light'
  )
  const [celebrate, setCelebrateState] = useState(
    () => localStorage.getItem('libri:celebrate') !== '0'
  )
  const [fdiag, setFdiag] = useState(null)
  const [showDiag, setShowDiag] = useState(false)
  useEffect(() => { getDiag().then(setFdiag).catch(() => {}) }, [])
  const [readLib, setReadLibState] = useState(() => localStorage.getItem('libri:readBtnLib') === '1')
  const [readShop, setReadShopState] = useState(() => localStorage.getItem('libri:readBtnShop') === '1')
  const [kidsTab, setKidsTabState] = useState(
    () => localStorage.getItem('libri:kidsTab') === '1'
  )

  const [shelfMode, setShelfModeState] = useState(() => localStorage.getItem('libri:shelfMode') || 'off')
  function setShelfMode(m) {
    setShelfModeState(m)
    localStorage.setItem('libri:shelfMode', m)
  }

  const [upNext, setUpNextState] = useState(
    () => localStorage.getItem('libri:upNext') === '1'
  )

  function setUpNext(on) {
    setUpNextState(on)
    localStorage.setItem('libri:upNext', on ? '1' : '0')
  }

  function setReadLib(on) {
    setReadLibState(on)
    localStorage.setItem('libri:readBtnLib', on ? '1' : '0')
  }

  function setReadShop(on) {
    setReadShopState(on)
    localStorage.setItem('libri:readBtnShop', on ? '1' : '0')
  }

  function setKidsTab(on) {
    setKidsTabState(on)
    localStorage.setItem('libri:kidsTab', on ? '1' : '0')
  }

  function setCelebrate(on) {
    setCelebrateState(on)
    localStorage.setItem('libri:celebrate', on ? '1' : '0')
  }
  const days = daysSinceBackup()
  const [cover, setCover] = useState(null)
  const [audioRun, setAudioRun] = useState(null)

  async function runAudio() {
    stopRef.current = false
    setAudioRun({ running: true, done: 0, total: 0, filled: 0 })
    try {
      const r = await loadRuntimes({
        onProgress: (p) => setAudioRun({ running: true, ...p }),
        shouldStop: () => stopRef.current
      })
      setAudioRun({ running: false, ...r })
    } catch {
      setAudioRun({ running: false, failed: true })
    }
  }
  const stopRef = useRef(false)
  const [shopRun, setShopRun] = useState(null)
  async function runShopData() {
    stopRef.current = false
    setShopRun({ running: true, done: 0, total: 0, filled: 0 })
    try {
      const r = await enrichShopItems({
        online: true,
        onProgress: (p) => setShopRun({ running: true, ...p }),
        shouldStop: () => stopRef.current
      })
      setShopRun({ running: false, filled: r.filled, total: r.total })
    } catch {
      setShopRun({ running: false, failed: true })
    }
  }

  async function runBackfill() {
    stopRef.current = false
    setCover({ running: true, done: 0, total: 0, filled: 0 })
    const res = await backfillCovers({
      onProgress: (p) => setCover({ running: true, ...p }),
      shouldStop: () => stopRef.current
    })
    setCover({ running: false, ...res })
    notify(`${res.filled} Bücher ergänzt`)
  }

  async function retryAll() {
    const n = await resetEnrichTried()
    await resetShopTried()
    setCover(null)
    notify(n ? `${n} Bücher werden beim nächsten Durchlauf wieder versucht` : 'Nichts zurückzusetzen')
  }

  function setTheme(next) {
    setThemeState(next)
    localStorage.setItem('libri:theme', next)
    document.documentElement.setAttribute('data-theme', next)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#faf3e7' : '#171b21')
  }

  async function doExport() {
    const data = await exportLibrary()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `libri-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    markBackupDone()
    notify('Sicherung gespeichert')
  }

  const [trimming, setTrimming] = useState(null)

  async function trimCovers() {
    setTrimming({ done: 0, total: 0 })
    const { changed, total } = await trimAllCovers((done, t) => setTrimming({ done, total: t }))
    setTrimming(null)
    notify(changed ? `Bei ${changed} von ${total} Covern wurden schwarze Ränder entfernt` : 'Keine schwarzen Ränder gefunden')
  }

  async function cleanDuplicates() {
    const { sessions, notes } = await removeDuplicateEntries()
    notify(
      sessions || notes
        ? `${sessions} doppelte Lesesitzungen und ${notes} doppelte Notizen entfernt`
        : 'Keine Doppelten gefunden'
    )
  }

  async function doImport(file) {
    try {
      const { data: payload, repaired } = parseBackupText(await file.text())
      // Erst die aktuelle Bibliothek als Datei sichern — dann erst einlesen.
      let saved = false
      try { saved = await autoBackupBeforeImport() } catch {
        notify('Die Sicherung vor dem Einlesen ist fehlgeschlagen – es wurde nichts eingelesen.')
        return
      }
      if (payload?.format === 'libri-links') {
        const { linked, missing, shopLinked } = await importLinks(payload)
        notify(`${shopLinked} Shop-Verknüpfungen, ${linked} Bücher verknüpft${missing ? `, ${missing} nicht in deiner Bibliothek` : ''}${saved ? ' · vorher gesichert' : ''}`)
        return
      }
      const { added, updated, skipped } = await importLibrary(payload, { replace })
      notify(
        `${added} neu` +
        `${updated ? `, ${updated} aktualisiert` : ''}` +
        `${skipped ? `, ${skipped} unverändert` : ''}` +
        (saved ? ' · vorher gesichert' : '') +
        (repaired ? ' — beschädigte Zeichen in der Datei wurden übergangen' : '')
      )
    } catch (e) {
      notify(e.message || 'Die Datei ließ sich nicht lesen.')
    }
  }

  async function wipe() {
    if (!confirm('Wirklich die gesamte Bibliothek löschen? Das lässt sich nicht rückgängig machen.')) return
    await db.books.clear()
    await db.sessions.clear()
    notify('Bibliothek geleert')
  }

  return (
    <div className="screen">
      <div className="screen-head"><h1 className="wordmark">Einstellungen</h1></div>

      {isIOS && !isInstalled && (
        <div className="notice warn">
          <p>Auf dem iPhone: Über Teilen → „Zum Home-Bildschirm“ ablegen, sonst löscht Safari die
            Daten nach sieben Tagen.</p>
        </div>
      )}

      {days !== null && days >= 14 && (
        <p className="settings-flag">Letzte Sicherung vor {days} Tagen</p>
      )}

      <button className="btn btn-primary settings-shop" onClick={onOpenShop}>Shop öffnen</button>

      <Section title="Darstellung">
        <Row label="Design">
          <div className="view-toggle">
            <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Hell</button>
            <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Dunkel</button>
          </div>
        </Row>
        <Row label="Abschluss-Moment">
          <OnOff on={celebrate} set={setCelebrate} />
        </Row>
        <Row label="„Als Nächstes dran“ auf Start">
          <OnOff on={upNext} set={setUpNext} />
        </Row>
        <div className="setting-block">
          <div className="setting-block-head">
            <span>Regal-Ansicht</span>
            <small>
              {shelfMode === 'gradient' ? 'Rückenfarben als weicher Verlauf aus dem Cover.'
                : shelfMode === 'cover' ? 'Linker Cover-Rand als Rücken, in Originalpixeln.'
                  : 'Bücher als Rücken im Regal, frei umsortierbar.'}
            </small>
          </div>
          <div className="seg3" role="group" aria-label="Regal-Ansicht">
            {[['off', 'Aus'], ['gradient', 'Verlauf'], ['cover', 'Cover']].map(([k, l]) => (
              <button key={k} aria-pressed={shelfMode === k} onClick={() => setShelfMode(k)}>{l}</button>
            ))}
          </div>
        </div>
        <Row label="Bilderbücher-Reiter">
          <OnOff on={kidsTab} set={setKidsTab} />
        </Row>
        <Row label="„Lesen“-Knopf in der Bibliothek">
          <OnOff on={readLib} set={setReadLib} />
        </Row>
        <Row label="„Lesen“-Knopf im Shop">
          <OnOff on={readShop} set={setReadShop} />
        </Row>
      </Section>

      <Section title="Sicherung">
        <div className="btn-row">
          <button className="btn btn-primary" onClick={doExport}>Herunterladen</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Einlesen</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) doImport(f)
            e.target.value = ''
          }}
        />
        <label className="setting-check">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Bibliothek vorher leeren
        </label>
        <button className="btn btn-quiet" onClick={cleanDuplicates}>Doppelte Einträge entfernen</button>
      </Section>

      <Section title="Daten pflegen">
        {cover?.running ? (
          <div className="setting-progress">
            <span><span className="spinner" /> {cover.done} von {cover.total} · {cover.filled} ergänzt</span>
            <button className="btn btn-quiet" onClick={() => { stopRef.current = true }}>Abbrechen</button>
          </div>
        ) : (
          <div className="setting-stack">
            <button className="btn btn-primary" onClick={runBackfill}>Angaben ergänzen</button>
            {cover && !cover.running && (
              <p className="setting-result">
                {cover.filled} von {cover.total} ergänzt
                {cover.skipped ? ` · ${cover.skipped} übersprungen` : ''}
              </p>
            )}
            <button className="btn" onClick={retryAll}>Erfolglose erneut versuchen</button>
            <button className="btn" onClick={trimCovers} disabled={Boolean(trimming)}>
              {trimming ? `Cover prüfen … ${trimming.done} von ${trimming.total}` : 'Schwarze Cover-Ränder entfernen'}
            </button>
          </div>
        )}
      </Section>

      <Section title="Löschen" danger>
        <button className="btn btn-danger" onClick={wipe}>Bibliothek leeren</button>
      </Section>

      <p className="settings-version" onClick={() => setShowDiag((v) => !v)}>
        Version vom {new Date(__BUILD_TIME__).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
      </p>
      {showDiag && fdiag && (
        <p className="settings-version">
          {fdiag.books} Bücher · {fdiag.bookFiles} mit Drive-Datei · Shop: {fdiag.metaFiles} Verknüpfungen ·
          Maas-Bücher: {fdiag.maasOwned} in der Bibliothek ({fdiag.maas} gesamt) · versteckter Shop: {fdiag.flag}
        </p>
      )}
    </div>
  )
}
