import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { Cover } from './ui'

/* Alle Zitate und Notizen aus der ganzen Bibliothek an einem Ort. Standard
   ist die Ansicht nach Büchern (neuestes zuerst), dazu eine Zeitleiste nach
   Monaten. Die Suche öffnet sich nicht von selbst — erst wenn man hineintippt. */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Hebt Treffer der Suche im Text hervor. */
function Highlight({ text, query }) {
  const q = query.trim()
  if (!q) return text
  const parts = text.split(new RegExp(`(${escapeRe(q)})`, 'ig'))
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p
  )
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

/** Ein einzelnes Zitat oder eine Notiz. */
function Item({ n, query, showBook, onOpenBook }) {
  const [open, setOpen] = useState(false)
  const long = n.text.length > 320
  const isQuote = n.type === 'quote'
  return (
    <article className={`nv-item${isQuote ? ' is-quote' : ''}`}>
      {!isQuote && <span className="nv-tag">Notiz</span>}
      <p className={`nv-text${long && !open ? ' is-clamped' : ''}`}>
        <Highlight text={n.text} query={query} />
      </p>
      {long && (
        <button className="nv-more" onClick={() => setOpen((v) => !v)}>
          {open ? 'weniger' : 'mehr'}
        </button>
      )}
      <footer className="nv-foot">
        {showBook ? (
          <button className="nv-source" onClick={() => onOpenBook({ id: n.bookId })}>{n.book.title}</button>
        ) : <span />}
        <span>
          {n.page ? `S. ${n.page}` : ''}{n.page && n.createdAt ? ' · ' : ''}{fmtDate(n.createdAt)}
        </span>
      </footer>
    </article>
  )
}

export default function NotesSearch({ onClose, onOpenBook }) {
  const [rows, setRows] = useState(undefined)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [group, setGroup] = useState('book') // book | date

  useEffect(() => {
    let alive = true
    Promise.all([db.notes.toArray(), db.books.toArray()]).then(([notes, books]) => {
      if (!alive) return
      const byId = new Map(books.map((b) => [b.id, b]))
      const joined = notes
        .map((n) => ({ ...n, book: byId.get(n.bookId) }))
        .filter((n) => n.book) // verwaiste Notizen (Buch gelöscht) ausblenden
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      setRows(joined)
    }).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [])

  // Suche zuerst, dann die Zähler an den Filtern, dann der Typfilter.
  const found = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((n) =>
      n.text.toLowerCase().includes(q) ||
      n.book.title.toLowerCase().includes(q) ||
      (n.book.authors || []).join(' ').toLowerCase().includes(q)
    )
  }, [rows, query])

  const quotes = found.filter((n) => n.type === 'quote').length
  const notes = found.length - quotes
  const shown = type === 'all' ? found : found.filter((n) => n.type === type)

  const sections = useMemo(() => {
    if (group === 'book') {
      const map = new Map()
      for (const n of shown) {
        if (!map.has(n.bookId)) map.set(n.bookId, { key: n.bookId, book: n.book, items: [] })
        map.get(n.bookId).items.push(n)
      }
      // shown ist neueste zuerst — die Gruppen erben das: das Buch mit der
      // jüngsten Eintragung steht oben.
      return [...map.values()]
    }
    const map = new Map()
    for (const n of shown) {
      const key = (n.createdAt || '').slice(0, 7) || 'ohne'
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: key === 'ohne' ? 'Ohne Datum'
            : new Date(`${key}-01T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
          items: []
        })
      }
      map.get(key).items.push(n)
    }
    return [...map.values()]
  }, [shown, group])

  const bookCount = new Set(found.map((n) => n.bookId)).size

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onClose}>Zurück</button>
      </div>

      <div className="screen-head" style={{ marginBottom: 2 }}>
        <h1 className="wordmark">Zitate &amp; Notizen</h1>
      </div>

      {rows === undefined ? (
        <p className="hint"><span className="spinner" /></p>
      ) : rows.length === 0 ? (
        <p className="hint" style={{ textAlign: 'left' }}>
          Noch nichts festgehalten. Zitate und Notizen legst du in einem Buch weiter unten an.
        </p>
      ) : (
        <>
          <p className="nv-summary">
            {quotes} {quotes === 1 ? 'Zitat' : 'Zitate'} · {notes} {notes === 1 ? 'Notiz' : 'Notizen'} · {bookCount} {bookCount === 1 ? 'Buch' : 'Bücher'}
          </p>

          <div className="search-wrap" style={{ marginBottom: 12 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" />
            </svg>
            <input
              className="search" type="search" value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Zitate und Notizen durchsuchen"
              placeholder="Suchen"
            />
          </div>

          <div className="nv-controls">
            <div className="view-toggle">
              <button aria-pressed={type === 'all'} onClick={() => setType('all')}>Alle {found.length}</button>
              <button aria-pressed={type === 'quote'} onClick={() => setType('quote')}>Zitate {quotes}</button>
              <button aria-pressed={type === 'note'} onClick={() => setType('note')}>Notizen {notes}</button>
            </div>
            <div className="view-toggle">
              <button aria-pressed={group === 'book'} onClick={() => setGroup('book')}>Bücher</button>
              <button aria-pressed={group === 'date'} onClick={() => setGroup('date')}>Zeit</button>
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="hint" style={{ textAlign: 'left' }}>Dazu findet sich nichts.</p>
          ) : (
            <div className="nv-sections">
              {sections.map((s) => (
                <section className="nv-section" key={s.key}>
                  {group === 'book' ? (
                    <button className="nv-book" onClick={() => onOpenBook({ id: s.book.id })}>
                      <span className="nv-cover"><Cover book={s.book} /></span>
                      <span className="nv-book-text">
                        <b>{s.book.title}</b>
                        <small>{(s.book.authors || []).join(', ')}</small>
                      </span>
                      <span className="nv-count">{s.items.length}</span>
                    </button>
                  ) : (
                    <h2 className="nv-month">{s.label}</h2>
                  )}
                  <div className="nv-items">
                    {s.items.map((n) => (
                      <Item key={n.id} n={n} query={query} showBook={group === 'date'} onOpenBook={onOpenBook} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
