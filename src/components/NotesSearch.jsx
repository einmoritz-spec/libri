import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'

/** Alle Zitate und Notizen aus der ganzen Bibliothek an einem Ort — je mehr
    zusammenkommen, desto eher will man eins wiederfinden, ohne noch zu
    wissen, in welchem Buch es stand. */
export default function NotesSearch({ onClose, onOpenBook }) {
  const [rows, setRows] = useState(undefined)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')

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

  const shown = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    return rows.filter((n) => {
      if (type !== 'all' && n.type !== type) return false
      if (!q) return true
      return (
        n.text.toLowerCase().includes(q) ||
        n.book.title.toLowerCase().includes(q) ||
        (n.book.authors || []).join(' ').toLowerCase().includes(q)
      )
    })
  }, [rows, query, type])

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onClose}>Zurück</button>
      </div>

      <div className="screen-head" style={{ marginBottom: 14 }}>
        <h1 className="wordmark">Zitate &amp; Notizen</h1>
      </div>

      <input
        className="search"
        type="search"
        placeholder="Text, Buch oder Autor"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Zitate und Notizen durchsuchen"
        autoFocus
      />

      <div className="view-toggle" style={{ marginBottom: 16 }}>
        <button aria-pressed={type === 'all'} onClick={() => setType('all')}>Alle</button>
        <button aria-pressed={type === 'quote'} onClick={() => setType('quote')}>Zitate</button>
        <button aria-pressed={type === 'note'} onClick={() => setType('note')}>Notizen</button>
      </div>

      {rows === undefined ? (
        <p className="hint"><span className="spinner" /></p>
      ) : rows.length === 0 ? (
        <p className="hint" style={{ textAlign: 'left' }}>
          Noch nichts festgehalten. Zitate und Notizen legst du in einem Buch weiter unten an.
        </p>
      ) : shown.length === 0 ? (
        <p className="hint" style={{ textAlign: 'left' }}>Dazu findet sich nichts.</p>
      ) : (
        <div className="note-list">
          {shown.map((n) => (
            <article key={n.id} className={n.type === 'quote' ? 'note note-quote' : 'note'}>
              <p className="note-text">{n.text}</p>
              <footer className="note-foot">
                <button className="note-source" onClick={() => onOpenBook({ id: n.bookId })}>
                  {n.book.title}{n.page ? ` · S. ${n.page}` : ''}
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
