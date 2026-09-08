import { useEffect, useState } from 'react'
import { dbStatus, onDbStatus } from '../lib/db'

/** Beobachtet den Öffnungszustand der Datenbank. */
export function useDbStatus() {
  const [state, setState] = useState(dbStatus.state)
  useEffect(() => onDbStatus(() => setState(dbStatus.state)), [])
  return state
}

/** Wird angezeigt, wenn die Datenbank nicht bereitsteht — statt eines
    Ladekreises, der sich sonst endlos weiterdrehen würde. */
export default function DbGate({ state }) {
  if (state === 'blocked') {
    return (
      <div className="screen">
        <div className="screen-head"><h1 className="wordmark">Libri</h1></div>
        <div className="notice warn">
          <p><b>Die Bibliothek lässt sich gerade nicht öffnen.</b></p>
          <p>
            Meistens liegt das daran, dass Libri noch in einem anderen Tab oder
            Fenster offen ist. Schließe die anderen und lade neu.
          </p>
        </div>
        <button className="btn btn-primary btn-block" onClick={() => location.reload()}>
          Neu laden
        </button>
        <p className="hint" style={{ textAlign: 'left' }}>
          Deine Bücher sind nicht verloren — sie liegen unverändert auf dem Gerät.
        </p>
      </div>
    )
  }

  if (state === 'failed') {
    return (
      <div className="screen">
        <div className="screen-head"><h1 className="wordmark">Libri</h1></div>
        <div className="notice warn">
          <p><b>Die Bibliothek konnte nicht geladen werden.</b></p>
          <p>{dbStatus.error?.message || 'Unbekannter Fehler beim Öffnen der Datenbank.'}</p>
        </div>
        <button className="btn btn-primary btn-block" onClick={() => location.reload()}>
          Nochmal versuchen
        </button>
      </div>
    )
  }

  return (
    <div className="screen">
      <p className="hint"><span className="spinner" /> Bibliothek wird geöffnet…</p>
    </div>
  )
}
