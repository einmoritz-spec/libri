import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { SelectionContext } from '../lib/selection'
import { SelectionBar, ActionSheet } from './SelectionBar'
import SeriesGuide from './SeriesGuide'
import FilterSheet from './FilterSheet'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, STATUS, STATUS_ORDER, updateBook } from '../lib/db'
import { languageName } from '../lib/metadata'
import { EmptyBookIcon } from './ui'
import { BookCard } from './BookCard'
import Home, { WishShelves } from './Home'

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

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" />
    </svg>
  )
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </svg>
  )
}
function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </svg>
  )
}


export default function Library({ onOpen, onLongPress, onScan, onManual, onAddWish, notify }) {
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

  // Bilderbücher gehören ausschließlich in ihren eigenen Reiter — für Start
  // und Alle wird so getan, als gäbe es sie nicht.
  const nonKidsBooks = useMemo(
    () => (books ? books.filter((b) => !isKidsBook(b)) : books),
    [books]
  )

  // Die Wunschliste hat einen eigenen Reiter und zählt nicht zum Regal.
  const ownedBooks = useMemo(
    () => (nonKidsBooks ? nonKidsBooks.filter((b) => b.status !== 'wishlist') : nonKidsBooks),
    [nonKidsBooks]
  )
  const wishBooks = useMemo(
    () => (nonKidsBooks ? nonKidsBooks.filter((b) => b.status === 'wishlist')
      .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '')) : []),
    [nonKidsBooks]
  )

  // Notizen für die Suche: pro Buch ein kleingeschriebener Gesamttext.
  const allNotes = useLiveQuery(() => db.notes.toArray(), [], [])
  const notesText = useMemo(() => {
    const m = new Map()
    for (const n of allNotes || []) {
      m.set(n.bookId, `${m.get(n.bookId) || ''} ${(n.text || '').toLowerCase()}`)
    }
    return m
  }, [allNotes])

  // ---------- Mehrfachauswahl ----------
  const [selected, setSelected] = useState(() => new Set())
  const [actionsOpen, setActionsOpen] = useState(false)
  const selRef = useRef(selected)
  selRef.current = selected
  const selecting = selected.size > 0
  const clearSelection = useCallback(() => { setSelected(new Set()); setActionsOpen(false) }, [])
  // Zurück-Geste beendet zuerst die Auswahl
  useBackLayer(selecting, clearSelection)

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // Antippen: bei laufender Auswahl markieren, sonst öffnen. Halten: markieren.
  const open = useCallback(
    (book) => (selRef.current.size ? toggleSelect(book.id) : onOpen(book)),
    [onOpen, toggleSelect]
  )
  const hold = useCallback((book) => toggleSelect(book.id), [toggleSelect])

  const [view, setView] = useState(() => localStorage.getItem('libri:libview') || 'home')
  const kidsTabEnabled = localStorage.getItem('libri:kidsTab') === '1'
  useEffect(() => {
    if (!kidsTabEnabled && view === 'kids') setView('home')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kidsTabEnabled])
  // Ohne Wunschlisten-Bücher gibt es den Reiter nicht — ist er gerade offen, zurück zum Start.
  useEffect(() => {
    if (nonKidsBooks && view === 'wish' && wishBooks.length === 0) setView('home')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonKidsBooks, wishBooks.length])
  // Zurück-Geste von „Alle“ oder „Bilderbücher“ führt auf „Start“.
  useBackLayer(view !== 'home', () => setView('home'))
  const [density, setDensity] = useState(() => localStorage.getItem('libri:density') || 'grid')
  useEffect(() => localStorage.setItem('libri:libview', view), [view])
  useEffect(() => localStorage.setItem('libri:density', density), [density])

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [lang, setLang] = useState('all')
  const [tag, setTag] = useState('all')
  const [series, setSeriesRaw] = useState('all')
  const [sub, setSub] = useState('all')
  // Wechselt die Reihe, gilt eine gewählte Unterreihe nicht mehr.
  const setSeries = useCallback((v) => { setSeriesRaw(v); setSub('all') }, [])
  const [sort, setSort] = useState('addedAt')
  const [showFilters, setShowFilters] = useState(false)

  // Wechselt die Ansicht oder die Reihe, beginnt die Seite oben — sonst bleibt
  // man bei der Scrollposition der vorigen Ansicht stehen.
  useEffect(() => { window.scrollTo(0, 0) }, [view, series])

  const jumpToSeries = useCallback((name) => {
    setSeries(name)
    setSort('series')
    setView('all')
  }, [])

  const shown = useMemo(() => {
    if (!ownedBooks) return []
    const q = query.trim().toLowerCase()
    let list = ownedBooks.filter((b) => {
      if (status !== 'all' && b.status !== status) return false
      if (lang !== 'all' && b.language !== lang) return false
      if (tag !== 'all' && !(b.tags || []).includes(tag)) return false
      if (series !== 'all' && b.series !== series) return false
      if (sub !== 'all' && b.subseries !== sub) return false
      if (!q) return true
      return (
        b.title.toLowerCase().includes(q) ||
        (b.authors || []).join(' ').toLowerCase().includes(q) ||
        (b.tags || []).join(' ').toLowerCase().includes(q) ||
        (b.series || '').toLowerCase().includes(q) ||
        (b.subseries || '').toLowerCase().includes(q) ||
        (b.isbn13 || '').includes(q) ||
        (b.description || '').toLowerCase().includes(q) ||
        (notesText.get(b.id) || '').includes(q)
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
  }, [ownedBooks, notesText, query, status, lang, tag, series, sub, sort])

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

  const counts = ownedBooks.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1
    return acc
  }, {})
  const seriesNames = [...new Set(ownedBooks.map((b) => b.series).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'de')
  )
  // Unterreihen — innerhalb der gewählten Reihe, sonst alle
  const subNames = [...new Set(
    ownedBooks.filter((b) => series === 'all' || b.series === series).map((b) => b.subseries).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'de'))
  const allSubNames = [...new Set(ownedBooks.map((b) => b.subseries).filter(Boolean))].sort()
  const languages = [...new Set(ownedBooks.map((b) => b.language).filter(Boolean))].sort()
  const tags = [...new Set(ownedBooks.flatMap((b) => b.tags || []))].sort((a, b) =>
    a.localeCompare(b, 'de')
  )

  const hasMoreFilters = seriesNames.length > 0 || subNames.length > 0 || tags.length > 0 || languages.length > 1
  const activeCount =
    (series !== 'all' ? 1 : 0) + (sub !== 'all' ? 1 : 0) + (lang !== 'all' ? 1 : 0) + (tag !== 'all' ? 1 : 0)

  // Ist genau eine Reihe gewählt, die Unterreihen hat, und keine davon:
  // dann in Gruppen je Unterreihe zeigen (Gruppen nach dem ersten Band geordnet).
  const groupBySub = series !== 'all' && sub === 'all' && sort === 'series' && subNames.length > 0
  const groupedList = (() => {
    if (!groupBySub) return null
    const groups = new Map()
    for (const b of shown) {
      const key = b.subseries || ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(b)
    }
    const first = (list) => Math.min(...list.map((b) => b.seriesIndex || 9999))
    const ordered = [...groups.entries()].sort((a, b) => {
      if (!a[0]) return 1 // ohne Unterreihe ans Ende
      if (!b[0]) return -1
      return first(a[1]) - first(b[1])
    })
    const out = []
    for (const [name, list] of ordered) {
      list.sort((a, b) => (a.seriesIndex || 0) - (b.seriesIndex || 0))
      out.push({ group: name || 'Weitere', count: list.length })
      for (const b of list) out.push({ book: b })
    }
    return out
  })()
  const letterList = groupedList || withLetters(shown, sort)
  // Bandnummer in der Unterreihe als Schild, sobald eine Reihe gewählt ist
  const inSubView = series !== 'all' && subNames.length > 0

  // Was die Auswahl-Leiste unter „Alle“ bedeutet, hängt von der Ansicht ab.
  const visibleBooks =
    view === 'all' ? shown
      : view === 'wish' ? wishBooks
        : view === 'kids' ? books.filter(isKidsBook).sort((a, b) => a.title.localeCompare(b.title, 'de'))
          : ownedBooks
  const selectedBooks = [
    ...visibleBooks.filter((b) => selected.has(b.id)),
    ...books.filter((b) => selected.has(b.id) && !visibleBooks.includes(b))
  ]

  return (
    <SelectionContext.Provider value={selected}>
    <div className="screen">
      {selecting && (
        <SelectionBar
          count={selected.size}
          total={visibleBooks.length}
          onClear={clearSelection}
          onAll={() => setSelected(new Set(visibleBooks.map((b) => b.id)))}
          onActions={() => setActionsOpen(true)}
        />
      )}
      {actionsOpen && selecting && (
        <ActionSheet
          books={selectedBooks}
          allTags={tags}
          allSubseries={allSubNames}
          notify={notify || (() => {})}
          onClose={() => setActionsOpen(false)}
          onDone={clearSelection}
          onEdit={(b) => { clearSelection(); onLongPress(b) }}
        />
      )}
      <div className="screen-head">
        <h1 className="wordmark">Libri</h1>
        <span className="count">
          {view === 'all' && shown.length !== ownedBooks.length
            ? `${shown.length} von ${ownedBooks.length}`
            : `${ownedBooks.length} Bücher`}
        </span>
      </div>

      <div className={`view-bar${kidsTabEnabled ? ' has-kids' : ''}`}>
        <div className="view-toggle">
          <button aria-pressed={view === 'home'} onClick={() => setView('home')}>Start</button>
          <button aria-pressed={view === 'all'} onClick={() => setView('all')}>Alle</button>
          {wishBooks.length > 0 && (
            <button aria-pressed={view === 'wish'} onClick={() => setView('wish')}>
              Wunschliste {wishBooks.length}
            </button>
          )}
          {kidsTabEnabled && (
            <button aria-pressed={view === 'kids'} onClick={() => setView('kids')}>Bilderbücher</button>
          )}
        </div>
        {view === 'all' && (
          <div className="view-toggle view-toggle-icons" role="group" aria-label="Darstellung">
            <button aria-pressed={density === 'grid'} aria-label="Raster" title="Raster"
              onClick={() => setDensity('grid')}><GridIcon /></button>
            <button aria-pressed={density === 'list'} aria-label="Liste" title="Liste"
              onClick={() => setDensity('list')}><ListIcon /></button>
          </div>
        )}
      </div>

      {view === 'wish' ? (
        <>
          <div className="wish-head">
            <span className="count">
              {wishBooks.length ? `${wishBooks.length} ${wishBooks.length === 1 ? 'Buch' : 'Bücher'}` : ''}
            </span>
            <button className="btn btn-primary" onClick={onAddWish}>+ Hinzufügen</button>
          </div>
          {wishBooks.length === 0 ? (
            <div className="empty">
              <EmptyBookIcon />
              <p>Noch nichts auf der Wunschliste. Scanne den Barcode eines Buchs, das du dir noch kaufen willst.</p>
            </div>
          ) : (
            <WishShelves books={wishBooks} onOpen={open} onLongPress={hold} />
          )}
        </>
      ) : view === 'kids' && kidsTabEnabled ? (
        <KidsShelf books={books} onOpen={open} onLongPress={hold} />
      ) : view === 'home' ? (
        <Home books={ownedBooks} onOpen={open} onLongPress={hold} onJumpToSeries={jumpToSeries} />
      ) : (
        <>
          <div className="search-wrap">
            <SearchIcon />
            <input
              className="search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Bibliothek durchsuchen"
            />
          </div>

          <div className="filters-wrap chips-row">
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

          {series !== 'all' && subNames.length > 0 && (
            <div className="filters-wrap chips-row sub-chips">
              <button className="chip" aria-pressed="true" onClick={() => setSeries('all')}
                title="Reihe abwählen">
                {series} ✕
              </button>
              {subNames.map((n) => (
                <button key={n} className="chip" aria-pressed={sub === n}
                  onClick={() => setSub(sub === n ? 'all' : n)}>{n}</button>
              ))}
            </div>
          )}

          {series !== 'all' && <SeriesGuide series={series} />}

          {showFilters && (
            <FilterSheet
              sortOptions={Object.entries(SORTS).map(([value, label]) => ({ value, label }))}
              sort={sort}
              onSort={setSort}
              groups={[
                {
                  key: 'series', label: 'Reihe', value: series,
                  options: seriesNames.map((n) => ({ value: n, label: n })),
                  onChange: (v) => { setSeries(v); if (v !== 'all') setSort('series') }
                },
                {
                  key: 'sub', label: 'Unterreihe', value: sub,
                  options: subNames.map((n) => ({ value: n, label: n })),
                  onChange: setSub
                },
                {
                  key: 'lang', label: 'Sprache', value: lang,
                  options: languages.length > 1 ? languages.map((l) => ({ value: l, label: languageName(l) })) : [],
                  onChange: setLang
                },
                {
                  key: 'tag', label: 'Schlagwörter', value: tag,
                  options: tags.map((t) => ({ value: t, label: t })),
                  onChange: setTag
                }
              ]}
              activeCount={activeCount}
              resultCount={shown.length}
              onReset={() => { setSeries('all'); setSub('all'); setLang('all'); setTag('all') }}
              onClose={() => setShowFilters(false)}
            />
          )}

          {shown.length === 0 ? (
            <div className="empty"><EmptyBookIcon /><p>Dazu passt nichts im Regal.</p></div>
          ) : density === 'list' ? (
            <div className="book-list">
              {letterList.map((item) =>
                item.group ? (
                  <div key={`G${item.group}`} className="letter-header group-header">
                    {item.group} <small>{item.count}</small>
                  </div>
                ) : item.letter ? (
                  <div key={`L${item.letter}`} id={`letter-${item.letter}`} className="letter-header">
                    {item.letter}
                  </div>
                ) : (
                  <BookCard key={item.book.id} book={item.book} layout="row"
                    onOpen={open} onLongPress={hold} />
                )
              )}
            </div>
          ) : (
            <div className="cover-grid">
              {letterList.map((item) =>
                item.group ? (
                  <div key={`G${item.group}`} className="letter-header letter-header-grid group-header">
                    {item.group} <small>{item.count}</small>
                  </div>
                ) : item.letter ? (
                  <div key={`L${item.letter}`} id={`letter-${item.letter}`}
                    className="letter-header letter-header-grid">
                    {item.letter}
                  </div>
                ) : (
                  <BookCard key={item.book.id} book={item.book} onOpen={open} onLongPress={hold}
                    badge={inSubView && item.book.subseriesIndex ? `Band ${item.book.subseriesIndex}` : null} />
                )
              )}
            </div>
          )}

          <LetterJump list={letterList} sort={sort} />
        </>
      )}
    </div>
    </SelectionContext.Provider>
  )
}
