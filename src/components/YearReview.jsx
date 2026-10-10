import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, pagesByMonth } from '../lib/db'
import { Cover, Icon } from './ui'
import { makeYearImage, shareImage } from '../lib/shareImage'
import YearReviewDetail from './YearReviewDetail'
import { useBackLayer } from '../lib/backStack'
import { MONTHS } from '../lib/reviewData'

export default function YearReview({ books, year, onClose, onOpenBook, notify }) {
  const [sharing, setSharing] = useState(false)
  const [quotes, setQuotes] = useState([])
  const [detail, setDetail] = useState(null)
  const sessions = useLiveQuery(() => db.sessions.toArray(), [], [])
  useBackLayer(Boolean(detail), () => setDetail(null))

  // Alle Zitate, die in diesem Jahr angelegt wurden, samt zugehörigem Buch.
  useEffect(() => {
    let alive = true
    db.notes
      .where('createdAt')
      .between(`${year}-01-01`, `${year + 1}-01-01`)
      .toArray()
      .then(async (notes) => {
        const list = notes.filter((n) => n.type === 'quote')
        const found = await db.books.bulkGet([...new Set(list.map((n) => n.bookId))])
        const byId = new Map(found.filter(Boolean).map((b) => [b.id, b]))
        const joined = list.filter((n) => byId.has(n.bookId)).map((n) => ({ ...n, book: byId.get(n.bookId) }))
        if (alive) setQuotes(joined)
      })
      .catch(() => alive && setQuotes([]))
    return () => { alive = false }
  }, [year])

  // Das längste Zitat des Jahres — kein perfektes Maß für "bedeutsam", aber
  // ein stabileres als eine zufällige Auswahl.
  const quote = useMemo(
    () => (quotes.length ? quotes.reduce((a, b) => (b.text.length > a.text.length ? b : a)) : null),
    [quotes]
  )

  const stats = useMemo(() => {
    const inYear = books
      .filter(
        (b) => b.status === 'read' && b.finishedAt && b.datesConfirmed &&
          Number(b.finishedAt.slice(0, 4)) === year
      )
      .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
    if (!inYear.length) return null

    // Gelesene Seiten des Jahres — auch aus Büchern, die noch nicht fertig sind.
    const pages = pagesByMonth(books, sessions || [], year).reduce((a, b) => a + b, 0)
    const withPages = inYear.filter((b) => b.pages && b.format !== 'audio')
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
      inYear, count: inYear.length, pages, thickest, best, avgRating,
      topAuthor: topAuthorEntry ? { name: topAuthorEntry[0], count: topAuthorEntry[1] } : null,
      topMonth: perMonth[topMonthIdx] > 1 ? MONTHS[topMonthIdx] : null
    }
  }, [books, sessions, year])

  return (
    <>
      <div className="sheet">
        <div className="sheet-bar">
          <button className="btn btn-quiet" onClick={onClose}>Zurück</button>
          {stats && (
            <button className="icon-quiet" aria-label="Als Bild teilen" disabled={sharing}
              onClick={async () => {
                setSharing(true)
                try {
                  const blob = await makeYearImage(year, stats)
                  const r = await shareImage(blob, `lesejahr-${year}.png`)
                  if (r === 'saved') notify?.('Bild gespeichert')
                } catch {
                  notify?.('Das Bild ließ sich nicht erstellen.')
                } finally {
                  setSharing(false)
                }
              }}>
              <Icon name="share" />
            </button>
          )}
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

            <button className="review-card review-hero review-tap" onClick={() => setDetail('books')}>
              <b>{stats.count}</b>
              <span>{stats.count === 1 ? 'Buch gelesen' : 'Bücher gelesen'}</span>
            </button>

            <div className="review-row">
              <button className="review-card review-tap" onClick={() => setDetail('pages')}>
                <b>{stats.pages.toLocaleString('de-DE')}</b>
                <span>Seiten gelesen</span>
              </button>
              {stats.avgRating && (
                <button className="review-card review-tap" onClick={() => setDetail('rating')}>
                  <b>{stats.avgRating}</b>
                  <span>Ø Bewertung</span>
                </button>
              )}
            </div>

            {stats.thickest && (
              <button className="review-book" onClick={() => setDetail('thick')}>
                <Cover book={stats.thickest} />
                <div>
                  <span className="review-book-label">Dickstes Buch des Jahres</span>
                  <strong>{stats.thickest.title}</strong>
                  <span>{stats.thickest.pages} Seiten</span>
                </div>
              </button>
            )}

            {stats.best && (
              <button className="review-book" onClick={() => setDetail('rating')}>
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
                  <button className="review-card review-tap" onClick={() => setDetail('authors')}>
                    <b style={{ fontSize: 18 }}>{stats.topAuthor.name}</b>
                    <span>{stats.topAuthor.count} Bücher gelesen</span>
                  </button>
                )}
                {stats.topMonth && (
                  <button className="review-card review-tap" onClick={() => setDetail('months')}>
                    <b style={{ fontSize: 18 }}>{stats.topMonth}</b>
                    <span>bester Monat</span>
                  </button>
                )}
              </div>
            )}

            {quote && (
              <>
                <div className="review-eyebrow-row">
                  <p className="review-eyebrow">Zitat des Jahres</p>
                  {quotes.length > 1 && (
                    <button className="btn btn-quiet" onClick={() => setDetail('quotes')}>
                      Alle {quotes.length} ›
                    </button>
                  )}
                </div>
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

      {detail && stats && (
        <YearReviewDetail
          kind={detail}
          year={year}
          books={stats.inYear}
          quotes={quotes}
          onClose={() => setDetail(null)}
          onOpenBook={onOpenBook}
        />
      )}
    </>
  )
}
