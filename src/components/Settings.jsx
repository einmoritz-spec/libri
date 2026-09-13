import { useRef, useState } from 'react'
import { exportLibrary, importLibrary, markBackupDone, daysSinceBackup, db, backfillCovers } from '../lib/db'
import { diagnoseSources } from '../lib/metadata'

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

export default function Settings({ notify }) {
  const fileRef = useRef(null)
  const [replace, setReplace] = useState(false)
  const [theme, setThemeState] = useState(
    () => localStorage.getItem('libri:theme') || 'dark'
  )
  const [celebrate, setCelebrateState] = useState(
    () => localStorage.getItem('libri:celebrate') !== '0'
  )
  const [kidsTab, setKidsTabState] = useState(
    () => localStorage.getItem('libri:kidsTab') !== '0'
  )

  function setKidsTab(on) {
    setKidsTabState(on)
    localStorage.setItem('libri:kidsTab', on ? '1' : '0')
  }

  function setCelebrate(on) {
    setCelebrateState(on)
    localStorage.setItem('libri:celebrate', on ? '1' : '0')
  }
  const days = daysSinceBackup()
  const [diag, setDiag] = useState(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagIsbn, setDiagIsbn] = useState('')
  const [cover, setCover] = useState(null)
  const stopRef = useRef(false)

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

  async function runDiagnose() {
    setDiagBusy(true)
    setDiag(null)
    try {
      setDiag(await diagnoseSources(diagIsbn))
    } finally {
      setDiagBusy(false)
    }
  }

  function setTheme(next) {
    setThemeState(next)
    localStorage.setItem('libri:theme', next)
    document.documentElement.setAttribute('data-theme', next)
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

  async function doImport(file) {
    try {
      const payload = JSON.parse(await file.text())
      const { added, skipped } = await importLibrary(payload, { replace })
      notify(`${added} übernommen${skipped ? `, ${skipped} schon vorhanden` : ''}`)
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

      <h2 style={{ marginTop: 0 }}>Erscheinungsbild</h2>
      <div className="view-toggle">
        <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
          Dunkel, Lampenlicht
        </button>
        <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
          Hell, Tageslicht
        </button>
      </div>

      <h2>Fertiggelesen-Moment</h2>
      <p className="hint" style={{ textAlign: 'left', margin: '0 0 12px' }}>
        Beim Abschließen eines Buchs kurz innehalten: Lesedauer, Buch des
        Jahres, Bewertung und Platz für ein letztes Zitat.
      </p>
      <div className="view-toggle">
        <button aria-pressed={celebrate} onClick={() => setCelebrate(true)}>An</button>
        <button aria-pressed={!celebrate} onClick={() => setCelebrate(false)}>Aus</button>
      </div>

      <h2>Bilderbücher-Reiter</h2>
      <p className="hint" style={{ textAlign: 'left', margin: '0 0 12px' }}>
        Der dritte Schalter oben in der Bibliothek, neben Start und Alle.
      </p>
      <div className="view-toggle">
        <button aria-pressed={kidsTab} onClick={() => setKidsTab(true)}>An</button>
        <button aria-pressed={!kidsTab} onClick={() => setKidsTab(false)}>Aus</button>
      </div>

      {isIOS && !isInstalled && (
        <div className="notice warn">
          <p><b>Wichtig auf dem iPhone.</b> Safari räumt die Daten einer Website nach
            sieben Tagen ohne Besuch weg. Bücher wären dann weg.</p>
          <p>Lege Libri über Teilen → „Zum Home-Bildschirm“ ab. Installiert bleiben die
            Daten erhalten.</p>
        </div>
      )}

      {days !== null && days >= 14 && (
        <div className="notice">
          <p>Die letzte Sicherung ist {days} Tage her.</p>
        </div>
      )}

      <h2>Sicherung</h2>
      <p className="hint" style={{ textAlign: 'left', margin: '0 0 12px' }}>
        Alle Bücher liegen nur auf diesem Gerät. Die Sicherungsdatei enthält auch die Cover
        und lässt sich auf einem anderen Gerät wieder einlesen.
      </p>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={doExport}>Sicherung herunterladen</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Sicherung einlesen</button>
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
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 14 }}>
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        Vorhandene Bibliothek vorher leeren
      </label>

      <h2>Fehlende Angaben ergänzen</h2>
      <p className="hint" style={{ textAlign: 'left', margin: '0 0 12px' }}>
        Ergänzt fehlende Cover, Seitenzahlen, Verlage und Jahre — für jedes
        Buch über dessen eigene ISBN, damit die Werte zur richtigen Ausgabe
        passen. Läuft bewusst gemächlich, damit die Datenquellen nicht
        drosseln; bei vielen Büchern dauert das ein paar Minuten. Die App darf
        dabei offen bleiben.
      </p>
      {cover?.running ? (
        <>
          <div className="notice">
            <p>
              <span className="spinner" /> {cover.done} von {cover.total}
              {cover.title ? ` — ${cover.title}` : ''}
            </p>
            <p>{cover.filled} Bücher bisher ergänzt.</p>
          </div>
          <button className="btn" onClick={() => { stopRef.current = true }}>Abbrechen</button>
        </>
      ) : (
        <>
          <button className="btn btn-primary" onClick={runBackfill}>Angaben ergänzen</button>
          {cover && !cover.running && (
            <p className="hint" style={{ textAlign: 'left' }}>
              {cover.filled} von {cover.total} ergänzt
              {cover.failed ? `, ${cover.failed} ohne neue Angaben` : ''}.
            </p>
          )}
        </>
      )}

      <h2>Datenquellen prüfen</h2>
      <p className="hint" style={{ textAlign: 'left', margin: '0 0 12px' }}>
        Testet jede Quelle einzeln. Zeigt, ob eine Quelle blockiert, gedrosselt
        oder erreichbar ist — und ob sie das Buch überhaupt kennt.
      </p>
      <div className="progress">
        <input
          className="search"
          style={{ flex: 1, width: 'auto', marginBottom: 0 }}
          inputMode="numeric"
          placeholder="ISBN (oder leer für Testbuch)"
          value={diagIsbn}
          onChange={(e) => setDiagIsbn(e.target.value)}
          aria-label="ISBN zum Prüfen"
        />
        <button className="btn btn-primary" onClick={runDiagnose} disabled={diagBusy}>
          {diagBusy ? <span className="spinner" /> : 'Prüfen'}
        </button>
      </div>

      {diag && (
        <div className="diag">
          <p className="hint" style={{ textAlign: 'left', margin: '0 0 8px' }}>
            Geprüft: {diag.isbn}{diag.isbn10 ? ` / ${diag.isbn10}` : ''}
          </p>
          {diag.results.map((r) => (
            <div className="diag-row" key={r.name}>
              <span className={r.ok ? 'diag-ok' : 'diag-bad'}>{r.ok ? '\u2713' : '\u2717'}</span>
              <span className="diag-name">{r.name}</span>
              <span className="diag-detail">{r.detail}</span>
              <span className="diag-ms">{r.ms} ms</span>
            </div>
          ))}
        </div>
      )}

      <h2>Woher die Buchdaten kommen</h2>
      <p className="hint" style={{ textAlign: 'left', margin: 0 }}>
        Nach dem Scan werden Google Books und Open Library gefragt und die Angaben
        zusammengeführt. Fehlt etwas, kannst du jedes Feld selbst nachtragen.
      </p>

      <h2>Alles löschen</h2>
      <button className="btn btn-danger" onClick={wipe}>Bibliothek leeren</button>

      <p className="hint" style={{ textAlign: 'left', marginTop: 28 }}>
        Version vom {new Date(__BUILD_TIME__).toLocaleString('de-DE')}
      </p>
    </div>
  )
}
