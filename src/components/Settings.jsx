import { useRef, useState } from 'react'
import { exportLibrary, importLibrary, markBackupDone, daysSinceBackup, db } from '../lib/db'

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
  const days = daysSinceBackup()

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
