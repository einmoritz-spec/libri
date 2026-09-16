import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { Cover } from './ui'

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
]

export default function YearReview({ books, year, onClose, onOpenBook }) {
  const [quote, setQuote] = useState(undefined)

  useEffect(() => {
    let alive = true
    db.notes
      .where('createdAt')
      .between(`${year}-01-01`, `${year + 1}-01-01`)
      .toArray()
      .then(async (notes) => {
        if (!alive) return
        const quotes = notes.filter((n) => n.type === 'quote')
        if (!quotes.length) return setQuote(null)
        // Das längste Zitat des Jahres — kein perfektes Maß für
        // "bedeutsam", aber ein stabileres als eine zufällige Auswahl.
        const longest = quotes.reduce((a, b) => (b.text.length > a.text.length ? b : a))
        const book = await db.books.get(longest.bookId)
        if (alive) setQuote(book ? { ...longest, book } : null)
      })
      .catch(() => alive && setQuote(null))
    return () => { alive = false }
  }, [year])

  const stats = useMemo(() => {
    const inYear = books.filter(
      (b) => b.status === 'read' && b.finishedAt && b.datesConfirmed &&
        Number(b.finishedAt.slice(0, 4)) === year
    )
    if (!inYear.length) return null

    const pages = inYear.reduce((s, b) => s + (b.pages || 0), 0)
    const withPages = inYear.filter((b) => b.pages)
    const thickest = withPages.length
      ? withPages.reduce((a, b) => (b.pages > a.pages ? b : a))
      : null

    const rated = inYear.filter((b) => b.rating)
    const best = rated.length ? rated.reduce((a, b) => (b.rating > a.rating ? b : a)) : null
    const avgRating = rated.length
      ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
      : null

    const authorCount = {}
    for (const b of inYear) for (const a of b.authors || []) authorCount[a] = (authorCount[a] || 0) + 1
    const topAuthorEntry = Object.entries(authorCount).sort((a, b) => b[1] - a[1])[0]

    const perMonth = Array(12).fill(0)
    for (const b of inYear) perMonth[Number(b.finishedAt.slice(5, 7)) - 1]++
    const topMonthIdx = perMonth.reduce((best, v, i, arr) => (v > arr[best] ? i : best), 0)

    return {
      count: inYear.length, pages, thickest, best, avgRating,
      topAuthor: topAuthorEntry ? { name: topAuthorEntry[0], count: topAuthorEntry[1] } : null,
      topMonth: perMonth[topMonthIdx] > 1 ? MONTHS[topMonthIdx] : null
    }
  }, [books, year])

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onClose}>Zurück</button>
      </div>

      {!stats ? (
        <div className="empty">
          <p>
            Für {year} sind noch keine bestätigten Lesedaten da. Unter „Gelesen
            von … bis" bei einem Buch nachtragen, dann taucht hier was auf.
          </p>
        </div>
      ) : (
        <div className="review">
          <p className="review-eyebrow">Dein Lesejahr</p>
          <h1 className="review-year">{year}</h1>

          <div className="review-card review-hero">
            <b>{stats.count}</b>
            <span>{stats.count === 1 ? 'Buch gelesen' : 'Bücher gelesen'}</span>
          </div>

          <div className="review-row">
            <div className="review-card">
              <b>{stats.pages.toLocaleString('de-DE')}</b>
              <span>Seiten</span>
            </div>
            {stats.avgRating && (
              <div className="review-card">
                <b>{stats.avgRating}</b>
                <span>Ø Bewertung</span>
              </div>
            )}
          </div>

          {stats.thickest && (
            <button className="review-book" onClick={() => onOpenBook({ id: stats.thickest.id })}>
              <Cover book={stats.thickest} />
              <div>
                <span className="review-book-label">Dickstes Buch des Jahres</span>
                <strong>{stats.thickest.title}</strong>
                <span>{stats.thickest.pages} Seiten</span>
              </div>
            </button>
          )}

          {stats.best && (
            <button className="review-book" onClick={() => onOpenBook({ id: stats.best.id })}>
              <Cover book={stats.best} />
              <div>
                <span className="review-book-label">Bestbewertet</span>
                <strong>{stats.best.title}</strong>
                <span>{'★'.repeat(stats.best.rating)}</span>
              </div>
            </button>
          )}

          {(stats.topAuthor || stats.topMonth) && (
            <div className="review-row">
              {stats.topAuthor && stats.topAuthor.count > 1 && (
                <div className="review-card">
                  <b style={{ fontSize: 18 }}>{stats.topAuthor.name}</b>
                  <span>{stats.topAuthor.count} Bücher gelesen</span>
                </div>
              )}
              {stats.topMonth && (
                <div className="review-card">
                  <b style={{ fontSize: 18 }}>{stats.topMonth}</b>
                  <span>bester Monat</span>
                </div>
              )}
            </div>
          )}

          {quote && (
            <>
              <p className="review-eyebrow" style={{ marginTop: 28 }}>Zitat des Jahres</p>
              <article className="note note-quote" style={{ marginTop: 8 }}>
                <p className="note-text">{quote.text}</p>
                <footer className="note-foot">
                  <button className="note-source" onClick={() => onOpenBook({ id: quote.book.id })}>
                    {quote.book.title}
                  </button>
                </footer>
              </article>
            </>
          )}
        </div>
      )}
    </div>
  )
}
