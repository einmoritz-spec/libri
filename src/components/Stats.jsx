import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { languageName } from '../lib/metadata'
import { EmptyBookIcon } from './ui'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

function Bars({ rows, unit = '' }) {
  const max = Math.max(...rows.map((r) => r[1]), 1)
  return (
    <div className="bars">
      {rows.map(([label, value]) => (
        <div className="bar-row" key={label}>
          <span>{label}</span>
          <i style={{ width: `${(value / max) * 100}%` }} />
          <em>{value}{unit}</em>
        </div>
      ))}
    </div>
  )
}

/** Senkrechte Säulen für den Jahresverlauf — zwölf Monate passen waagerecht
    nicht sinnvoll auf ein Handy, senkrecht schon. */
function MonthChart({ values, unit }) {
  const max = Math.max(...values, 1)
  const thisMonth = new Date().getMonth()
  const year = new Date().getFullYear()
  return (
    <div className="month-chart">
      {values.map((v, i) => (
        <div className="month-col" key={i}>
          <span className="month-value">{v || ''}</span>
          <div className="month-bar-track">
            <div
              className={`month-bar${v ? '' : ' month-bar-empty'}`}
              style={{ height: `${(v / max) * 100}%` }}
              title={`${MONTHS[i]}: ${v}${unit}`}
            />
          </div>
          <span className={`month-label${i === thisMonth ? ' month-now' : ''}`}>
            {MONTHS[i][0]}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function Stats() {
  // Wie in der Bibliothek: zusätzlich direkt lesen, damit die Anzeige nicht
  // allein von der Live-Abfrage abhängt.
  const live = useLiveQuery(() => db.books.toArray(), [], undefined)
  const [direct, setDirect] = useState(undefined)
  useEffect(() => {
    let alive = true
    db.books.toArray().then((r) => alive && setDirect(r)).catch(() => alive && setDirect([]))
    return () => { alive = false }
  }, [])
  const books = live !== undefined ? live : direct

  const [year, setYear] = useState(new Date().getFullYear())

  const data = useMemo(() => {
    if (!books) return null

    const read = books.filter((b) => b.status === 'read')
    const reading = books.filter((b) => b.status === 'reading')
    const owned = books.filter((b) => b.status !== 'wishlist')
    const unread = owned.filter((b) => b.status === 'owned')

    // Nur bestätigte Daten zählen — ein automatisch beim Abhaken gesetztes
    // Datum ist bei einem einzelnen, in Echtzeit fertiggelesenen Buch korrekt,
    // würde beim Nachtragen vieler alter Bücher auf einmal aber alles auf
    // einen Tag zusammenstauchen. Siehe BookDetail: "Gelesen von … bis".
    const withDate = read.filter((b) => b.finishedAt && b.datesConfirmed)
    const years = [...new Set(withDate.map((b) => Number(b.finishedAt.slice(0, 4))))]
      .sort((a, b) => b - a)

    const inYear = withDate.filter((b) => Number(b.finishedAt.slice(0, 4)) === year)
    const booksPerMonth = Array(12).fill(0)
    const pagesPerMonth = Array(12).fill(0)
    for (const b of inYear) {
      const m = Number(b.finishedAt.slice(5, 7)) - 1
      booksPerMonth[m]++
      pagesPerMonth[m] += b.pages || 0
    }

    // Lesedauer nur für Bücher, bei denen beide Daten gepflegt sind.
    const durations = read
      .filter((b) => b.startedAt && b.finishedAt && b.datesConfirmed)
      .map((b) => ({
        book: b,
        days: Math.max(1, Math.round(
          (new Date(b.finishedAt) - new Date(b.startedAt)) / 86400000) || 1)
      }))
    const avgDays = durations.length
      ? Math.round(durations.reduce((s, d) => s + d.days, 0) / durations.length)
      : null

    const withPages = read.filter((b) => b.pages)
    const longest = withPages.length
      ? withPages.reduce((a, b) => (b.pages > a.pages ? b : a))
      : null

    const rated = read.filter((b) => b.rating)
    const avgRating = rated.length
      ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
      : null
    const best = rated.length ? rated.reduce((a, b) => (b.rating > a.rating ? b : a)) : null

    const pagesRead =
      read.reduce((s, b) => s + (b.pages || 0), 0) +
      reading.reduce((s, b) => s + (b.currentPage || 0), 0)

    const byLang = {}
    for (const b of books) {
      const l = b.language ? languageName(b.language) : 'unbekannt'
      byLang[l] = (byLang[l] || 0) + 1
    }

    const byYear = {}
    for (const b of withDate) {
      const y = b.finishedAt.slice(0, 4)
      byYear[y] = (byYear[y] || 0) + 1
    }

    return {
      total: books.length, read, reading, unread, years, inYear,
      booksPerMonth, pagesPerMonth, avgDays, longest, avgRating, best,
      pagesRead,
      shelfPages: owned.reduce((s, b) => s + (b.pages || 0), 0),
      langRows: Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 6),
      yearRows: Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6),
      undated: read.length - withDate.length
    }
  }, [books, year])

  if (!books) {
    return (
      <div className="screen">
        <p className="hint"><span className="spinner" /> Zahlen werden geladen…</p>
      </div>
    )
  }

  if (!books.length) {
    return (
      <div className="screen">
        <div className="screen-head"><h1 className="wordmark">Statistik</h1></div>
        <div className="empty">
          <EmptyBookIcon />
          <p>Sobald Bücher im Regal stehen, steht hier etwas.</p>
        </div>
      </div>
    )
  }

  const d = data
  const yearPages = d.pagesPerMonth.reduce((a, b) => a + b, 0)

  return (
    <div className="screen">
      <div className="screen-head"><h1 className="wordmark">Statistik</h1></div>

      <div className="stat-row">
        <div className="stat"><b>{d.total}</b><span>Bücher</span></div>
        <div className="stat"><b>{d.read.length}</b><span>gelesen</span></div>
        <div className="stat"><b>{d.unread.length}</b><span>ungelesen</span></div>
        {d.avgRating && <div className="stat"><b>{d.avgRating}</b><span>Ø Bewertung</span></div>}
      </div>

      <div className="stat-row">
        <div className="stat">
          <b>{d.pagesRead.toLocaleString('de-DE')}</b><span>gelesene Seiten</span>
        </div>
        <div className="stat">
          <b>{d.shelfPages.toLocaleString('de-DE')}</b><span>Seiten im Regal</span>
        </div>
      </div>

      {d.years.length > 0 && (
        <>
          <div className="stats-year-head">
            <h2>Lesejahr</h2>
            <div className="view-toggle">
              {d.years.slice(0, 3).map((y) => (
                <button key={y} aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
          </div>

          <div className="stat-row" style={{ marginBottom: 14 }}>
            <div className="stat"><b>{d.inYear.length}</b><span>Bücher {year}</span></div>
            <div className="stat">
              <b>{yearPages.toLocaleString('de-DE')}</b><span>Seiten {year}</span>
            </div>
            {d.inYear.length > 0 && (
              <div className="stat">
                <b>{(d.inYear.length / 12).toFixed(1)}</b><span>pro Monat</span>
              </div>
            )}
          </div>

          <p className="filter-label" style={{ marginBottom: 4 }}>Bücher pro Monat</p>
          <MonthChart values={d.booksPerMonth} unit=" Bücher" />

          {yearPages > 0 && (
            <>
              <p className="filter-label" style={{ margin: '18px 0 4px' }}>Seiten pro Monat</p>
              <MonthChart values={d.pagesPerMonth} unit=" Seiten" />
            </>
          )}
        </>
      )}

      {(d.avgDays || d.longest || d.best) && (
        <>
          <h2>Bemerkenswertes</h2>
          <div className="facts-list">
            {d.avgDays && (
              <div className="fact-row">
                <span>Durchschnittlich pro Buch</span>
                <b>{d.avgDays} {d.avgDays === 1 ? 'Tag' : 'Tage'}</b>
              </div>
            )}
            {d.longest && (
              <div className="fact-row">
                <span>Dickstes gelesenes Buch</span>
                <b>{d.longest.title} · {d.longest.pages} S.</b>
              </div>
            )}
            {d.best && (
              <div className="fact-row">
                <span>Bestbewertet</span>
                <b>{d.best.title} · {d.best.rating}/5</b>
              </div>
            )}
          </div>
        </>
      )}

      {d.undated > 0 && (
        <div className="notice" style={{ marginTop: 18 }}>
          <p>
            Bei {d.undated} gelesenen {d.undated === 1 ? 'Buch' : 'Büchern'} ist das Datum
            noch nicht bestätigt — die tauchen im Jahresverlauf nicht auf. Im Buch unter
            „Gelesen von … bis" einmal bestätigen oder ändern, dann zählt es mit.
          </p>
        </div>
      )}

      {d.yearRows.length > 1 && (
        <>
          <h2>Gelesen pro Jahr</h2>
          <Bars rows={d.yearRows} />
        </>
      )}

      <h2>Sprachen</h2>
      <Bars rows={d.langRows} />
    </div>
  )
}
