import { useEffect, useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { sessionsFor, addSession, updateSession, deleteSession, PERIODS, periodOf } from '../lib/db'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatDay(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit'
  })
}

function Editor({ initial, onSave, onCancel }) {
  const [date, setDate] = useState(initial?.date || todayStr())
  const [pages, setPages] = useState(initial?.pages ?? '')
  const [period, setPeriod] = useState(initial ? periodOf(initial) : null)

  return (
    <div className="note-editor">
      <div className="field-pair">
        <div className="field">
          <label htmlFor="s-date">Datum</label>
          <input id="s-date" type="date" max={todayStr()} value={date}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-pages">Seiten</label>
          <input id="s-pages" type="number" inputMode="numeric" min="0"
            value={pages} onChange={(e) => setPages(e.target.value)} autoFocus />
        </div>
      </div>
      <div className="field">
        <label>Tageszeit</label>
        <div className="filters-wrap period-chips" role="group" aria-label="Tageszeit">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className="chip" aria-pressed={period === p.key}
              onClick={() => setPeriod(period === p.key ? null : p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <small className="field-hint">
          {period
            ? PERIODS.find((p) => p.key === period).hours
            : 'Optional — ohne Angabe zählt die Sitzung nicht in „Wann du liest“.'}
        </small>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" disabled={!pages || Number(pages) <= 0}
          onClick={() => onSave({ date, pages, period })}>Sichern</button>
        <button className="btn btn-quiet" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  )
}

export default function SessionLog({ book, notify }) {
  const [rows, setRows] = useState(undefined)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  useBackLayer(adding, () => setAdding(false))
  useBackLayer(Boolean(editing), () => setEditing(null))

  async function reload() {
    setRows(await sessionsFor(book.id))
  }
  useEffect(() => { reload() }, [book.id])

  if (rows === undefined) return null

  return (
    <>
      <div className="notes-head">
        <h2>Lesesitzungen</h2>
        {!adding && !editing && (
          <button className="btn btn-quiet" onClick={() => setAdding(true)}>+ Nachtragen</button>
        )}
      </div>

      {adding && (
        <Editor
          onCancel={() => setAdding(false)}
          onSave={async (data) => {
            await addSession({ bookId: book.id, ...data })
            setAdding(false)
            notify('Sitzung nachgetragen')
            reload()
          }}
        />
      )}

      {rows.length === 0 && !adding && (
        <p className="hint" style={{ textAlign: 'left' }}>Noch keine Sitzung erfasst.</p>
      )}

      {rows.map((s) => (
        editing?.id === s.id ? (
          <Editor
            key={s.id}
            initial={s}
            onCancel={() => setEditing(null)}
            onSave={async (data) => {
              await updateSession(s.id, data)
              setEditing(null)
              notify('Sitzung geändert')
              reload()
            }}
          />
        ) : (
          <div className="fact-row" key={s.id} style={{ cursor: 'pointer' }}
            onClick={() => setEditing(s)}>
            <span>
              {formatDay(s.date)}
              {periodOf(s) && <small className="session-period"> · {PERIODS.find((p) => p.key === periodOf(s)).label}</small>}
            </span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <b>{s.pages} Seiten</b>
              <button
                className="note-del"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteSession(s.id)
                  notify('Gelöscht')
                  reload()
                }}
              >Löschen</button>
            </span>
          </div>
        )
      ))}
    </>
  )
}
