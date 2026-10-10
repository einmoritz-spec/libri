import { useMemo, useState } from 'react'
import { Cover, AudioMark } from './ui'
import {
  MONTHS, formatPct, pageSegments, authorSegments, donutArcs, ratingDistribution, booksByMonth, authorsRanking
} from '../lib/reviewData'

const TITLES = {
  books: 'Gelesene Bücher',
  pages: 'Seiten',
  rating: 'Bewertungen',
  thick: 'Umfang',
  authors: 'Autoren',
  months: 'Monate',
  quotes: 'Zitate'
}

const fmt = (n) => Number(n || 0).toLocaleString('de-DE')
const shortDate = (iso) =>
  new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })

function Stars({ value, max = 10 }) {
  return (
    <span className="stars" aria-label={`${value} von ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < value ? 'on' : ''}>★</i>
      ))}
    </span>
  )
}

function BookRow({ book, onOpen, sub, children }) {
  return (
    <button className="book-row" onClick={() => onOpen({ id: book.id })}>
      <div className="book-row-art"><Cover book={book} /></div>
      <div className="book-row-text">
        <div className="book-row-title">{book.title}<AudioMark book={book} /></div>
        <div className="book-row-author">{sub ?? (book.authors?.[0] || '—')}</div>
      </div>
      {children && <div className="book-row-side">{children}</div>}
    </button>
  )
}

/* ---------- Bücher ---------- */

function BooksView({ books, onOpen }) {
  const list = [...books].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  return (
    <div className="book-list">
      {list.map((b) => (
        <BookRow key={b._k ?? b.id} book={b} onOpen={onOpen}>
          <b>{shortDate(b.finishedAt)}</b>
          {b.pages && b.format !== 'audio' ? <div>{fmt(b.pages)} S.</div> : null}
        </BookRow>
      ))}
    </div>
  )
}

/* ---------- Seiten: Donut ---------- */

function Donut({ segments, total, selectedKey, onSelect, label = 'Seiten je Buch' }) {
  const R = 76
  const W = 30
  const arcs = donutArcs(segments, R)
  const sel = segments.find((s) => s.key === selectedKey)
  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" role="img" aria-label={label}>
        <g transform="rotate(-90 100 100)">
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--line)" strokeWidth={W} opacity="0.35" />
          {segments.map((s, i) => (
            <circle
              key={s.key} cx="100" cy="100" r={R} fill="none" stroke={s.color}
              strokeWidth={selectedKey === s.key ? W + 6 : W}
              strokeDasharray={arcs[i].dash} strokeDashoffset={arcs[i].offset}
              opacity={selectedKey && selectedKey !== s.key ? 0.3 : 1}
              onClick={() => onSelect(selectedKey === s.key ? null : s.key)}
            />
          ))}
        </g>
      </svg>
      <div className="donut-center">
        {sel ? (
          <>
            <b>{fmt(sel.value)}</b>
            <span className="donut-center-label">{sel.label}</span>
            <span>{formatPct(sel.share)} %</span>
          </>
        ) : (
          <>
            <b>{fmt(total)}</b>
            <span>Seiten</span>
          </>
        )}
      </div>
    </div>
  )
}

function PagesView({ books, onOpen }) {
  const [mode, setMode] = useState('authors') // authors | books
  const byBook = useMemo(() => pageSegments(books), [books])
  const byAuthor = useMemo(() => authorSegments(books), [books])
  const [selected, setSelected] = useState(null)
  const data = mode === 'authors' ? byAuthor : byBook
  const { segments, rows, total, missing } = data

  if (!segments.length) {
    return <p className="hint" style={{ textAlign: 'left' }}>Für diese Bücher ist keine Seitenzahl hinterlegt.</p>
  }
  return (
    <>
      <div className="view-toggle" style={{ marginBottom: 14 }}>
        <button aria-pressed={mode === 'authors'} onClick={() => { setMode('authors'); setSelected(null) }}>Autoren</button>
        <button aria-pressed={mode === 'books'} onClick={() => { setMode('books'); setSelected(null) }}>Bücher</button>
      </div>

      <Donut
        segments={segments} total={total} selectedKey={selected} onSelect={setSelected}
        label={mode === 'authors' ? 'Seiten je Autor' : 'Seiten je Buch'}
      />

      <div className="legend">
        {mode === 'authors' ? rows.map((r) => (
          <button
            key={r.name}
            className={`legend-row${selected === r.segKey ? ' is-selected' : ''}`}
            onClick={() => setSelected(selected === r.segKey ? null : r.segKey)}
          >
            <span className="legend-dot" style={{ background: r.color }} />
            <span className="legend-name">
              {r.name}
              <small className="legend-sub">{r.count} {r.count === 1 ? 'Buch' : 'Bücher'}</small>
            </span>
            <span className="legend-val"><b>{fmt(r.pages)}</b> · {formatPct(r.share)} %</span>
          </button>
        )) : rows.map((r) => (
          <button
            key={r.book._k ?? r.book.id}
            className={`legend-row${selected === r.segKey ? ' is-selected' : ''}`}
            onClick={() => onOpen({ id: r.book.id })}
          >
            <span className="legend-dot" style={{ background: r.color }} />
            <span className="legend-name">{r.book.title}</span>
            <span className="legend-val"><b>{fmt(r.book.pages)}</b> · {formatPct(r.share)} %</span>
          </button>
        ))}
      </div>
      {missing > 0 && (
        <p className="hint" style={{ textAlign: 'left', marginTop: 12 }}>
          {missing} {missing === 1 ? 'Buch ist' : 'Bücher sind'} ohne Seitenzahl nicht enthalten.
        </p>
      )}
    </>
  )
}

/* ---------- Bewertungen ---------- */

function RatingView({ books, onOpen }) {
  const rated = books.filter((b) => b.rating).sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title, 'de'))
  const unrated = books.filter((b) => !b.rating)
  const dist = ratingDistribution(books, 10)
  const max = Math.max(...dist, 1)
  const best = dist.indexOf(Math.max(...dist)) + 1

  if (!rated.length) {
    return <p className="hint" style={{ textAlign: 'left' }}>Noch kein Buch aus diesem Jahr ist bewertet.</p>
  }
  return (
    <>
      <p className="filter-label" style={{ marginBottom: 4 }}>Wie oft welche Note</p>
      <div className="month-chart" style={{ gridTemplateColumns: 'repeat(10, 1fr)' }}>
        {dist.map((v, i) => (
          <div className="month-col" key={i}>
            <span className="month-value">{v || ''}</span>
            <div className="month-bar-track">
              <div className={`month-bar${v ? '' : ' month-bar-empty'}`} style={{ height: `${(v / max) * 100}%` }} />
            </div>
            <span className={`month-label${i + 1 === best ? ' month-now' : ''}`}>{i + 1}</span>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 26 }}>Alle Bewertungen</h2>
      <div className="book-list">
        {rated.map((b) => (
          <BookRow key={b._k ?? b.id} book={b} onOpen={onOpen} sub={<Stars value={b.rating} />}>
            <b>{b.rating}/10</b>
          </BookRow>
        ))}
      </div>

      {unrated.length > 0 && (
        <>
          <h2 style={{ marginTop: 26 }}>Noch nicht bewertet</h2>
          <div className="book-list">
            {unrated.map((b) => <BookRow key={b._k ?? b.id} book={b} onOpen={onOpen} />)}
          </div>
        </>
      )}
    </>
  )
}

/* ---------- Umfang ---------- */

function ThickView({ books, onOpen }) {
  const list = books.filter((b) => b.pages > 0 && b.format !== 'audio').sort((a, b) => b.pages - a.pages)
  if (!list.length) {
    return <p className="hint" style={{ textAlign: 'left' }}>Für diese Bücher ist keine Seitenzahl hinterlegt.</p>
  }
  const max = list[0].pages
  const avg = Math.round(list.reduce((s, b) => s + b.pages, 0) / list.length)
  const shortest = list[list.length - 1]
  return (
    <>
      <div className="facts-list" style={{ marginBottom: 18 }}>
        <div className="fact-row"><span>Durchschnitt pro Buch</span><b>{fmt(avg)} Seiten</b></div>
        <div className="fact-row"><span>Kürzestes Buch</span><b>{shortest.title} · {fmt(shortest.pages)} S.</b></div>
      </div>
      {list.map((b) => (
        <button key={b._k ?? b.id} className="rank-row" onClick={() => onOpen({ id: b.id })}>
          <div className="rank-top">
            <span>{b.title}</span>
            <b>{fmt(b.pages)}</b>
          </div>
          <div className="rank-bar"><i style={{ width: `${(b.pages / max) * 100}%` }} /></div>
        </button>
      ))}
    </>
  )
}

/* ---------- Autoren ---------- */

function AuthorsView({ books, onOpen }) {
  const list = useMemo(() => authorsRanking(books), [books])
  const max = list[0]?.books.length || 1
  return (
    <>
      {list.map((a) => (
        <div className="author-block" key={a.name}>
          <div className="author-head">
            <span className="author-name">{a.name}</span>
            <span className="author-count">
              {a.books.length} {a.books.length === 1 ? 'Buch' : 'Bücher'}
              {a.pages ? ` · ${fmt(a.pages)} S.` : ''}
            </span>
          </div>
          <div className="rank-bar"><i style={{ width: `${(a.books.length / max) * 100}%` }} /></div>
          {a.books.map((b) => (
            <button key={b._k ?? b.id} className="author-book" onClick={() => onOpen({ id: b.id })}>
              <span>{b.title}<AudioMark book={b} /></span>
              {b.pages && b.format !== 'audio' ? <span>{fmt(b.pages)}</span> : null}
            </button>
          ))}
        </div>
      ))}
    </>
  )
}

/* ---------- Monate ---------- */

function MonthsView({ books, onOpen }) {
  const months = useMemo(() => booksByMonth(books), [books])
  const counts = months.map((m) => m.length)
  const max = Math.max(...counts, 1)
  const best = counts.indexOf(Math.max(...counts))
  return (
    <>
      <div className="month-chart">
        {counts.map((v, i) => (
          <div className="month-col" key={i}>
            <span className="month-value">{v || ''}</span>
            <div className="month-bar-track">
              <div className={`month-bar${v ? '' : ' month-bar-empty'}`} style={{ height: `${(v / max) * 100}%` }} />
            </div>
            <span className={`month-label${i === best && v ? ' month-now' : ''}`}>{MONTHS[i][0]}</span>
          </div>
        ))}
      </div>

      {months.map((list, i) => {
        if (!list.length) return null
        const pages = list.reduce((s, b) => s + (b.pages || 0), 0)
        return (
          <section key={i}>
            <div className="month-block-head">
              <h2>{MONTHS[i]}</h2>
              <span>{list.length} {list.length === 1 ? 'Buch' : 'Bücher'}{pages ? ` · ${fmt(pages)} S.` : ''}</span>
            </div>
            <div className="book-list">
              {list.map((b) => (
                <BookRow key={b._k ?? b.id} book={b} onOpen={onOpen}><b>{shortDate(b.finishedAt)}</b></BookRow>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

/* ---------- Zitate ---------- */

function QuotesView({ quotes, onOpen }) {
  const list = [...quotes].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return (
    <div className="note-list">
      {list.map((n) => (
        <article key={n.id} className="note note-quote">
          <p className="note-text">{n.text}</p>
          <footer className="note-foot">
            <button className="note-source" onClick={() => onOpen({ id: n.bookId })}>
              {n.book.title}{n.page ? ` · S. ${n.page}` : ''}
            </button>
          </footer>
        </article>
      ))}
    </div>
  )
}

export default function YearReviewDetail({ kind, year, books, quotes, onClose, onOpenBook }) {
  return (
    <div className="sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onClose}>Zurück</button>
      </div>
      <p className="review-eyebrow">{year}</p>
      <h1 className="wordmark" style={{ margin: '2px 0 20px' }}>{TITLES[kind]}</h1>

      {kind === 'books' && <BooksView books={books} onOpen={onOpenBook} />}
      {kind === 'pages' && <PagesView books={books} onOpen={onOpenBook} />}
      {kind === 'rating' && <RatingView books={books} onOpen={onOpenBook} />}
      {kind === 'thick' && <ThickView books={books} onOpen={onOpenBook} />}
      {kind === 'authors' && <AuthorsView books={books} onOpen={onOpenBook} />}
      {kind === 'months' && <MonthsView books={books} onOpen={onOpenBook} />}
      {kind === 'quotes' && <QuotesView quotes={quotes} onOpen={onOpenBook} />}
    </div>
  )
}
