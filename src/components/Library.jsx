import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, STATUS, STATUS_ORDER } from '../lib/db'
import { languageName } from '../lib/metadata'
import { EmptyBookIcon } from './ui'
import { BookCard } from './BookCard'
import Home from './Home'

/* Zeigt nach ein paar Sekunden einen Ausweg an, falls der Ladezustand hängt.
   Ein Ladekreis ohne Ende ist immer ein Fehler — spätestens hier bekommt man
   etwas zum Anfassen statt nur zuzusehen. */
function SlowLoadHint({ onRetry }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(t)
  }, [])
  if (!slow) return null
  return (
    <div className="notice warn" style={{ marginTop: 18 }}>
      <p>Das dauert ungewöhnlich lange. Deine Bücher liegen auf dem Gerät und
        sind nicht verloren.</p>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onRetry}>Nochmal laden</button>
        <button className="btn" onClick={() => location.reload()}>App neu starten</button>
      </div>
    </div>
  )
}

const SORTS = {
  addedAt: 'Zuletzt hinzugefügt',
  title: 'Titel',
  author: 'Autor',
  series: 'Reihe',
  rating: 'Bewertung',
  year: 'Erscheinungsjahr',
  pages: 'Seitenzahl'
}

/* Nur bei diesen beiden Sortierungen ergibt ein alphabetischer Sprung Sinn —
   nach Erscheinungsjahr etwa gäbe es kein sinnvolles "M". */
const LETTER_SORTS = new Set(['title', 'author'])

/* Diese Schlagwörter zählen als Kinder- und Bilderbuch. Bewusst dieselben
   Begriffe, die die automatische Genre-Übersetzung beim Scannen schon
   vergibt (siehe CATEGORY_DE in metadata.js) — ein gescanntes Bilderbuch
   landet dadurch ohne Zutun in diesem Regal. Von Hand vergeben geht genauso,
   einfach als Schlagwort "Bilderbuch" oder "Kinderbuch" eintragen.
   Bewusst nicht "Jugendbuch" dabei — andere Altersgruppe. */
const KIDS_TAGS = ['Bilderbuch', 'Kinderbuch', 'Kindersachbuch']

function isKidsBook(book) {
  return (book.tags || []).some((t) => KIDS_TAGS.includes(t))
}

function KidsShelf({ books, onOpen, onLongPress }) {
  const kids = books.filter(isKidsBook).sort((a, b) => a.title.localeCompare(b.title, 'de'))

  if (!kids.length) {
    return (
      <div className="empty">
        <EmptyBookIcon />
        <p>Noch keine Bilderbücher eingeordnet.</p>
        <p className="hint">
          Ein Buch bekommt beim Scannen automatisch das Schlagwort „Bilderbuch"
          oder „Kinderbuch", wenn die Quelle es so führt. Von Hand geht's über
          „Bearbeiten" → Schlagwörter genauso.
        </p>
      </div>
    )
  }

  return (
    <div className="cover-grid">
      {kids.map((b) => (
        <BookCard key={b.id} book={b} onOpen={onOpen} onLongPress={onLongPress} />
      ))}
    </div>
  )
}

function letterKey(book, sort) {
  const text = sort === 'author'
    ? (book.authors?.[0] || '').split(' ').pop().trim()
    : book.title
  return (text[0] || '#').toUpperCase()
}

/** Fügt zwischen die sortierte Liste Buchstaben-Trenner ein, wo sich der
    Anfangsbuchstabe ändert — Grundlage für den Schnellsprung. */
function withLetters(list, sort) {
  if (!LETTER_SORTS.has(sort)) return list.map((b) => ({ book: b }))
  const out = []
  let last = null
  for (const b of list) {
    const letter = letterKey(b, sort)
    if (letter !== last) {
      out.push({ letter })
      last = letter
    }
    out.push({ book: b })
  }
  return out
}

function LetterJump({ list, sort }) {
  if (!LETTER_SORTS.has(sort)) return null
  const letters = []
  for (const item of list) {
    if (item.letter && !letters.includes(item.letter)) letters.push(item.letter)
  }
  if (letters.length < 5) return null // bei wenigen Büchern bringt das nichts
  return (
    <div className="letter-jump">
      {letters.map((l) => (
        <button key={l} onClick={() =>
          document.getElementById(`letter-${l}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }>{l}</button>
      ))}
    </div>
  )
}

export default function Library({ onOpen, onLongPress, onScan, onManual }) {
  /* Zwei Wege an dieselben Daten. Die Live-Abfrage hält die Anzeige aktuell,
     der direkte Lesevorgang liefert die Bücher garantiert einmal — auch wenn
     die Live-Abfrage aus irgendeinem Grund nie etwas meldet. */
  const live = useLiveQuery(() => db.books.toArray(), [], undefined)
  const [direct, setDirect] = useState(undefined)
  const [loadError, setLoadError] = useState(null)

  const readDirect = useCallback(() => {
    setLoadError(null)
    db.books.toArray().then(setDirect).catch((e) => setLoadError(e?.message || 'Unbekannter Fehler'))
  }, [])

  useEffect(() => {
    readDirect()
    const onVisible = () => { if (document.visibilityState === 'visible') readDirect() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [readDirect])

  const books = live !== undefined ? live : direct

  const [view, setView] = useState(() => localStorage.getItem('libri:libview') || 'home')
  const [density, setDensity] = useState(() => localStorage.getItem('libri:density') || 'grid')
  useEffect(() => localStorage.setItem('libri:libview', view), [view])
  useEffect(() => localStorage.setItem('libri:density', density), [density])

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [lang, setLang] = useState('all')
  const [tag, setTag] = useState('all')
  const [series, setSeries] = useState('all')
  const [sort, setSort] = useState('addedAt')
  const [showFilters, setShowFilters] = useState(false)

  const jumpToSeries = useCallback((name) => {
    setSeries(name)
    setSort('series')
    setView('all')
  }, [])

  const shown = useMemo(() => {
    if (!books) return []
    const q = query.trim().toLowerCase()
    let list = books.filter((b) => {
      if (status !== 'all' && b.status !== status) return false
      if (lang !== 'all' && b.language !== lang) return false
      if (tag !== 'all' && !(b.tags || []).includes(tag)) return false
      if (series !== 'all' && b.series !== series) return false
      if (!q) return true
      return (
        b.title.toLowerCase().includes(q) ||
        (b.authors || []).join(' ').toLowerCase().includes(q) ||
        (b.tags || []).join(' ').toLowerCase().includes(q) ||
        (b.series || '').toLowerCase().includes(q) ||
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
      if (sort === 'series') {
        const as = a.series || '\uffff'
        const bs = b.series || '\uffff'
        const c = as.localeCompare(bs, 'de')
        return c !== 0 ? c : (a.seriesIndex || 0) - (b.seriesIndex || 0)
      }
      return (b.addedAt || '').localeCompare(a.addedAt || '')
    })
    return list
  }, [books, query, status, lang, tag, series, sort])

  if (loadError) {
    return (
      <div className="screen">
        <div className="screen-head"><h1 className="wordmark">Libri</h1></div>
        <div className="notice warn">
          <p><b>Die Bücher ließen sich nicht laden.</b></p>
          <p>{loadError}</p>
          <p>Deine Bücher sind nicht verloren — sie liegen unverändert auf dem Gerät.</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={readDirect}>Nochmal laden</button>
          <button className="btn" onClick={() => location.reload()}>App neu starten</button>
        </div>
      </div>
    )
  }

  if (books === undefined) {
    return (
      <div className="screen">
        <p className="hint"><span className="spinner" /> Bücher werden geladen…</p>
        <SlowLoadHint onRetry={readDirect} />
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
  const seriesNames = [...new Set(books.map((b) => b.series).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'de')
  )
  const languages = [...new Set(books.map((b) => b.language).filter(Boolean))].sort()
  const tags = [...new Set(books.flatMap((b) => b.tags || []))].sort((a, b) =>
    a.localeCompare(b, 'de')
  )

  const hasMoreFilters = seriesNames.length > 0 || tags.length > 0 || languages.length > 1
  const activeCount =
    (series !== 'all' ? 1 : 0) + (lang !== 'all' ? 1 : 0) + (tag !== 'all' ? 1 : 0)

  const letterList = withLetters(shown, sort)

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="wordmark">Libri</h1>
        <span className="count">{books.length} Bücher</span>
      </div>

      <div className="view-toggle" style={{ marginBottom: 16 }}>
        <button aria-pressed={view === 'home'} onClick={() => setView('home')}>Start</button>
        <button aria-pressed={view === 'all'} onClick={() => setView('all')}>Alle</button>
        <button aria-pressed={view === 'kids'} onClick={() => setView('kids')}>Bilderbücher</button>
      </div>

      {view === 'kids' ? (
        <KidsShelf books={books} onOpen={onOpen} onLongPress={onLongPress} />
      ) : view === 'home' ? (
        <Home books={books} onOpen={onOpen} onLongPress={onLongPress} onJumpToSeries={jumpToSeries} />
      ) : (
        <>
          <input
            className="search"
            type="search"
            placeholder="Titel, Autor, Reihe, Schlagwort"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Bibliothek durchsuchen"
          />

          <div className="filters-wrap">
            <button className="chip" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
              Alle
            </button>
            {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
              <button key={s} className="chip" aria-pressed={status === s}
                onClick={() => setStatus(status === s ? 'all' : s)}>
                {STATUS[s]} {counts[s]}
              </button>
            ))}
            {hasMoreFilters && (
              <button className="chip chip-more" aria-pressed={showFilters}
                onClick={() => setShowFilters((v) => !v)}>
                Filter{activeCount > 0 ? ` (${activeCount})` : ''}
              </button>
            )}
          </div>

          {showFilters && (
            <div className="filter-panel">
              <label className="filter-row">
                <span>Sortieren</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  {Object.entries(SORTS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>

              {seriesNames.length > 0 && (
                <div className="filter-group">
                  <span className="filter-label">Reihe</span>
                  <div className="filters-wrap">
                    {seriesNames.map((s) => (
                      <button key={s} className="chip" aria-pressed={series === s}
                        onClick={() => {
                          if (series === s) { setSeries('all') } else { setSeries(s); setSort('series') }
                        }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {languages.length > 1 && (
                <div className="filter-group">
                  <span className="filter-label">Sprache</span>
                  <div className="filters-wrap">
                    {languages.map((l) => (
                      <button key={l} className="chip" aria-pressed={lang === l}
                        onClick={() => setLang(lang === l ? 'all' : l)}>
                        {languageName(l)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {tags.length > 0 && (
                <div className="filter-group">
                  <span className="filter-label">Schlagwörter</span>
                  <div className="filters-wrap">
                    {tags.map((t) => (
                      <button key={t} className="chip" aria-pressed={tag === t}
                        onClick={() => setTag(tag === t ? 'all' : t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeCount > 0 && (
                <button className="btn btn-quiet" onClick={() => {
                  setSeries('all'); setLang('all'); setTag('all')
                }}>Filter zurücksetzen</button>
              )}
            </div>
          )}

          <div className="density-row">
            <span className="count">
              {shown.length === books.length ? `${books.length} Bücher` : `${shown.length} von ${books.length}`}
            </span>
            <div className="view-toggle">
              <button aria-pressed={density === 'grid'} onClick={() => setDensity('grid')}>Raster</button>
              <button aria-pressed={density === 'list'} onClick={() => setDensity('list')}>Liste</button>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="empty"><EmptyBookIcon /><p>Dazu passt nichts im Regal.</p></div>
          ) : density === 'list' ? (
            <div className="book-list">
              {letterList.map((item) =>
                item.letter ? (
                  <div key={`L${item.letter}`} id={`letter-${item.letter}`} className="letter-header">
                    {item.letter}
                  </div>
                ) : (
                  <BookCard key={item.book.id} book={item.book} layout="row"
                    onOpen={onOpen} onLongPress={onLongPress} />
                )
              )}
            </div>
          ) : (
            <div className="cover-grid">
              {letterList.map((item) =>
                item.letter ? (
                  <div key={`L${item.letter}`} id={`letter-${item.letter}`}
                    className="letter-header letter-header-grid">
                    {item.letter}
                  </div>
                ) : (
                  <BookCard key={item.book.id} book={item.book} onOpen={onOpen} onLongPress={onLongPress} />
                )
              )}
            </div>
          )}

          <LetterJump list={letterList} sort={sort} />
        </>
      )}
    </div>
  )
}
