import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, STATUS, STATUS_ORDER } from '../lib/db'
import { Cover } from './ui'

const SORTS = {
  addedAt: 'Zuletzt hinzugefügt',
  title: 'Titel',
  author: 'Autor',
  pages: 'Seitenzahl'
}

export default function Library({ onOpen, onScan, onManual }) {
  const books = useLiveQuery(() => db.books.toArray(), [], null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('addedAt')

  const shown = useMemo(() => {
    if (!books) return []
    const q = query.trim().toLowerCase()
    let list = books.filter((b) => {
      if (status !== 'all' && b.status !== status) return false
      if (!q) return true
      return (
        b.title.toLowerCase().includes(q) ||
        (b.authors || []).join(' ').toLowerCase().includes(q) ||
        (b.tags || []).join(' ').toLowerCase().includes(q) ||
        (b.isbn13 || '').includes(q)
      )
    })
    const byName = (b) => (b.authors?.[0] || 'zzz').split(' ').pop().toLowerCase()
    list.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'de')
      if (sort === 'author') return byName(a).localeCompare(byName(b), 'de')
      if (sort === 'pages') return (b.pages || 0) - (a.pages || 0)
      return (b.addedAt || '').localeCompare(a.addedAt || '')
    })
    return list
  }, [books, query, status, sort])

  if (books === null) {
    return <div className="screen"><p className="hint"><span className="spinner" /></p></div>
  }

  if (!books.length) {
    return (
      <div className="screen">
        <div className="screen-head"><h1 className="wordmark">Libri</h1></div>
        <div className="empty">
          <p>Dein Regal ist noch leer.</p>
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={onScan}>Erstes Buch scannen</button>
            <button className="btn" onClick={onManual}>Von Hand anlegen</button>
          </div>
        </div>
      </div>
    )
  }

  const counts = books.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1
    return acc
  }, {})

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="wordmark">Libri</h1>
        <span className="count">
          {shown.length === books.length
            ? `${books.length} Bücher`
            : `${shown.length} von ${books.length}`}
        </span>
      </div>

      <input
        className="search"
        type="search"
        placeholder="Titel, Autor, Schlagwort"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Bibliothek durchsuchen"
      />

      <div className="filters">
        <button className="chip" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
          Alle
        </button>
        {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
          <button key={s} className="chip" aria-pressed={status === s}
            onClick={() => setStatus(status === s ? 'all' : s)}>
            {STATUS[s]} {counts[s]}
          </button>
        ))}
        <select className="chip" value={sort} onChange={(e) => setSort(e.target.value)}
          aria-label="Sortierung">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="empty"><p>Dazu passt nichts im Regal.</p></div>
      ) : (
        <div className="shelf">
          {shown.map((b) => {
            const pct = b.pages && b.currentPage
              ? Math.min(100, (b.currentPage / b.pages) * 100)
              : 0
            return (
              <button className="slot" key={b.id} onClick={() => onOpen(b)}>
                <div className="slot-art"><Cover book={b} /></div>
                <div className="slot-caption">
                  <div className="slot-title">{b.title}</div>
                  <div className="slot-author">{b.authors?.[0] || '—'}</div>
                  {b.status === 'reading' && (
                    <div className="slot-bar"><span style={{ width: `${pct}%` }} /></div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
