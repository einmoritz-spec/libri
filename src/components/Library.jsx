import { memo, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, STATUS, STATUS_ORDER } from '../lib/db'
import { languageName } from '../lib/metadata'
import { Cover, EmptyBookIcon } from './ui'

/* Eigene Komponente mit memo: ändert sich ein einzelnes Buch, werden die
   übrigen Karten nicht neu gezeichnet. Ohne das rendert bei jeder Änderung
   das ganze Raster neu — auch wenn es gerade hinter einer geöffneten
   Detailansicht liegt und niemand es sieht. */
const BookCard = memo(function BookCard({ book, onOpen }) {
  const pct = book.pages && book.currentPage
    ? Math.min(100, (book.currentPage / book.pages) * 100)
    : 0
  return (
    <button className="slot" onClick={() => onOpen(book)}>
      <div className="slot-art"><Cover book={book} /></div>
      <div className="slot-caption">
        <div className="slot-title">{book.title}</div>
        <div className="slot-author">{book.authors?.[0] || '—'}</div>
        {book.status === 'reading' && (
          <div className="slot-bar"><span style={{ width: `${pct}%` }} /></div>
        )}
      </div>
    </button>
  )
})

const SORTS = {
  addedAt: 'Zuletzt hinzugefügt',
  title: 'Titel',
  author: 'Autor',
  rating: 'Bewertung',
  year: 'Erscheinungsjahr',
  pages: 'Seitenzahl'
}

export default function Library({ onOpen, onScan, onManual }) {
  const books = useLiveQuery(() => db.books.toArray(), [], null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [lang, setLang] = useState('all')
  const [tag, setTag] = useState('all')
  const [sort, setSort] = useState('addedAt')

  const shown = useMemo(() => {
    if (!books) return []
    const q = query.trim().toLowerCase()
    let list = books.filter((b) => {
      if (status !== 'all' && b.status !== status) return false
      if (lang !== 'all' && b.language !== lang) return false
      if (tag !== 'all' && !(b.tags || []).includes(tag)) return false
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
      if (sort === 'rating') return (b.rating || 0) - (a.rating || 0)
      if (sort === 'year') return (b.year || 0) - (a.year || 0)
      return (b.addedAt || '').localeCompare(a.addedAt || '')
    })
    return list
  }, [books, query, status, lang, tag, sort])

  if (books === null) {
    return (
      <div className="screen">
        <p className="hint"><span className="spinner" /> Bücher werden geladen…</p>
      </div>
    )
  }

  if (!books.length) {
    return (
      <div className="screen">
        <div className="screen-head"><h1 className="wordmark">Libri</h1></div>
        <div className="empty">
          <EmptyBookIcon />
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
  const languages = [...new Set(books.map((b) => b.language).filter(Boolean))].sort()
  const tags = [...new Set(books.flatMap((b) => b.tags || []))].sort((a, b) =>
    a.localeCompare(b, 'de')
  )

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

      {(tags.length > 0 || languages.length > 1) && (
        <div className="filters">
          {languages.length > 1 &&
            languages.map((l) => (
              <button key={l} className="chip" aria-pressed={lang === l}
                onClick={() => setLang(lang === l ? 'all' : l)}>
                {languageName(l)}
              </button>
            ))}
          {tags.map((t) => (
            <button key={t} className="chip" aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? 'all' : t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty"><EmptyBookIcon /><p>Dazu passt nichts im Regal.</p></div>
      ) : (
        <div className="cover-grid">
          {shown.map((b) => (
            <BookCard key={b.id} book={b} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}
