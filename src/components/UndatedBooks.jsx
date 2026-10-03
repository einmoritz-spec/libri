import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, isUndated, markReadBefore, setFinishedOn } from '../lib/db'
import { Cover } from './ui'

/* Gelesene Bücher ohne Lesedatum. Pro Buch lässt sich ein Datum eintragen,
   oder mehrere werden angehakt und als „vor dem Tracking gelesen“ vermerkt.
   Erledigte Bücher verschwinden aus der Liste und aus der Meldung. */
export default function UndatedBooks({ onClose, notify }) {
  const books = useLiveQuery(() => db.books.toArray(), [], undefined)
  const [picked, setPicked] = useState(() => new Set())

  const list = useMemo(
    () => (books || []).filter(isUndated).sort((a, b) => a.title.localeCompare(b.title, 'de')),
    [books]
  )
  const chosen = list.filter((b) => picked.has(b.id))
  const today = new Date().toISOString().slice(0, 10)

  function toggle(id) {
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onClose}>Zurück</button>
      </div>

      <div className="screen-head" style={{ marginBottom: 6 }}>
        <h1 className="wordmark">Lesedatum fehlt</h1>
      </div>
      <p className="hint" style={{ textAlign: 'left', margin: '0 0 14px' }}>
        Datum eintragen oder mehrere ankreuzen und als „vor dem Tracking gelesen“ vermerken.
      </p>

      {books === undefined ? (
        <p className="hint"><span className="spinner" /></p>
      ) : list.length === 0 ? (
        <div className="empty"><p>Alles erledigt. ✓</p></div>
      ) : (
        <>
          <div className="undated-actions">
            <button className="btn btn-quiet"
              onClick={() => setPicked(chosen.length === list.length ? new Set() : new Set(list.map((b) => b.id)))}>
              {chosen.length === list.length ? 'Keine' : 'Alle'} auswählen
            </button>
            <button className="btn btn-primary" disabled={!chosen.length}
              onClick={async () => {
                await markReadBefore(chosen.map((b) => b.id))
                notify(`${chosen.length} als „vor dem Tracking gelesen“ vermerkt`)
                setPicked(new Set())
              }}>
              Vor dem Tracking gelesen{chosen.length ? ` (${chosen.length})` : ''}
            </button>
          </div>

          <div className="undated-list">
            {list.map((b) => (
              <div className={`undated-row${picked.has(b.id) ? ' is-picked' : ''}`} key={b.id}>
                <button className="undated-main" onClick={() => toggle(b.id)} aria-pressed={picked.has(b.id)}>
                  <span className="undated-check" aria-hidden="true">{picked.has(b.id) ? '✓' : ''}</span>
                  <span className="undated-cover"><Cover book={b} /></span>
                  <span className="undated-text">
                    <b>{b.title}</b>
                    <small>{(b.authors || []).join(', ')}</small>
                  </span>
                </button>
                <input
                  className="undated-date" type="date" max={today}
                  aria-label={`Beendet am — ${b.title}`}
                  value=""
                  onChange={async (e) => {
                    if (!e.target.value) return
                    await setFinishedOn(b.id, e.target.value)
                    notify('Datum eingetragen')
                  }}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
