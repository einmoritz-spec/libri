import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db, expandReads, hasRealTime, pagesReadTotal, pagesByMonth, isUndated } from '../lib/db'
import { languageName } from '../lib/metadata'
import { EmptyBookIcon } from './ui'
import NotesSearch from './NotesSearch'
import YearReview from './YearReview'
import UndatedBooks from './UndatedBooks'
import { useBackLayer } from '../lib/backStack'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

function Bars({ rows, unit = '' }) {
  const max = Math.max(...rows.map((r) => r[1]), 1)
  return (
    <div className={`bars${unit ? ' has-unit' : ''}`}>
      {rows.map(([label, value]) => (
        <div className={`bar-row${value === max && value > 0 ? ' is-top' : ''}${value === 0 ? ' is-zero' : ''}`} key={label}>
          <span className="bar-label">{label}</span>
          <div className="bar-track">
            {value > 0 && <i style={{ width: `${(value / max) * 100}%` }} />}
          </div>
          <em>
            <b>{value.toLocaleString('de-DE')}</b>
            {unit && <small>{unit}</small>}
          </em>
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

/** Kennzahlen als Kacheln. Ein Wert steht immer in einer Zeile (zu lange
    Titel werden gekürzt); was dazugehört, steht klein darunter. */
function Facts({ items }) {
  return (
    <div className="fact-tiles">
      {items.filter(Boolean).map((it) => (
        <div key={it.label} className={`fact-tile${it.wide ? ' wide' : ''}`}>
          <span>{it.label}</span>
          <b title={String(it.value)}>{it.value}</b>
          {it.sub && <small title={it.sub}>{it.sub}</small>}
        </div>
      ))}
    </div>
  )
}

export default function Stats({ onOpenBook, notify = () => {} }) {
  const [undatedOpen, setUndatedOpen] = useState(false)
  useBackLayer(undatedOpen, () => setUndatedOpen(false))
  const [notesOpen, setNotesOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  useBackLayer(notesOpen, () => setNotesOpen(false))
  useBackLayer(reviewOpen, () => setReviewOpen(false))
  // Wie in der Bibliothek: zusätzlich direkt lesen, damit die Anzeige nicht
  // allein von der Live-Abfrage abhängt.
  const live = useLiveQuery(() => db.books.toArray(), [], undefined)
  const [direct, setDirect] = useState(undefined)
  useEffect(() => {
    let alive = true
    db.books.toArray().then((r) => alive && setDirect(r)).catch(() => alive && setDirect([]))
    return () => { alive = false }
  }, [])
  const rawBooks = live !== undefined ? live : direct
  // Erneut Gelesenes mitzählen? Aus: nur der erste Durchgang jedes Buchs zählt.
  const [rereads, setRereads] = useState(() => {
    try { return localStorage.getItem('libri:rereads') !== '0' } catch { return true }
  })
  const hasRereads = !!rawBooks && rawBooks.some((b) => b.reads?.length)
  const books = useMemo(() => rawBooks && expandReads(rawBooks, { rereads }), [rawBooks, rereads])

  // Lesesitzungen — für Tageszeit, Wochentag und Lesesträhne. Getrennt von
  // den Büchern geladen, da unabhängig verfügbar sein soll.
  const sessLive = useLiveQuery(() => db.sessions.toArray(), [], undefined)
  const [sessDirect, setSessDirect] = useState(undefined)
  useEffect(() => {
    let alive = true
    db.sessions.toArray().then((r) => alive && setSessDirect(r)).catch(() => alive && setSessDirect([]))
    return () => { alive = false }
  }, [])
  // Hörbuch-Sitzungen zählen nicht in die Seiten-Auswertungen
  const rawSessions = sessLive !== undefined ? sessLive : sessDirect
  const sessions = useMemo(() => rawSessions && rawSessions.filter((s) => s.format !== 'audio'), [rawSessions])

  const [year, setYear] = useState(new Date().getFullYear())

  const data = useMemo(() => {
    if (!books) return null

    const read = books.filter((b) => b.status === 'read')
    const reading = books.filter((b) => b.status === 'reading')
    const owned = rawBooks.filter((b) => b.status !== 'wishlist')
    const unread = owned.filter((b) => b.status === 'owned')

    // Nur bestätigte Daten zählen — ein automatisch beim Abhaken gesetztes
    // Datum ist bei einem einzelnen, in Echtzeit fertiggelesenen Buch korrekt,
    // würde beim Nachtragen vieler alter Bücher auf einmal aber alles auf
    // einen Tag zusammenstauchen. Siehe BookDetail: "Gelesen von … bis".
    const withDate = read.filter((b) => b.finishedAt && b.datesConfirmed)
    // Auch Jahre, in denen nur Seiten gelesen wurden (Sitzungen), aber noch kein Buch fertig wurde.
    const years = [...new Set([
      ...withDate.map((b) => Number(b.finishedAt.slice(0, 4))),
      ...(sessions || []).filter((x) => x.date).map((x) => Number(x.date.slice(0, 4)))
    ])].sort((a, b) => b - a)

    const inYear = withDate.filter((b) => Number(b.finishedAt.slice(0, 4)) === year)
    const booksPerMonth = Array(12).fill(0)
    const pagesPerMonth = Array(12).fill(0)
    for (const b of inYear) {
      booksPerMonth[Number(b.finishedAt.slice(5, 7)) - 1]++
    }
    // Seiten kommen aus den eingetragenen Sitzungen, damit auch ein noch
    // nicht beendetes Buch sofort mitzählt.
    pagesByMonth(books, sessions || [], year).forEach((v, i) => { pagesPerMonth[i] = v })

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

    const withPages = read.filter((b) => b.pages && b.format !== 'audio')
    const longest = withPages.length
      ? withPages.reduce((a, b) => (b.pages > a.pages ? b : a))
      : null

    const rated = read.filter((b) => b.rating)
    const avgRating = rated.length
      ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
      : null
    const best = rated.length ? rated.reduce((a, b) => (b.rating > a.rating ? b : a)) : null

    const pagesRead = pagesReadTotal(books)

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
      total: owned.length, read, reading, unread, years, inYear,
      booksPerMonth, pagesPerMonth, avgDays, longest, avgRating, best,
      pagesRead,
      shelfPages: owned.reduce((s, b) => s + (b.pages || 0), 0),
      langRows: Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 6),
      yearRows: Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6),
      undated: books.filter(isUndated).length,
      fastest: durations.length ? durations.reduce((a, b) => (b.days < a.days ? b : a)) : null
    }
  }, [books, rawBooks, sessions, year])

  const timeData = useMemo(() => {
    if (!sessions || !sessions.length) return null
    // Nur Sitzungen mit echter Uhrzeit sagen etwas über die Tageszeit; der
    // Wochentag lässt sich bei allen aus dem Datum ablesen.
    const withTime = sessions.filter(hasRealTime)

    const dayparts = [
      ['Morgens', (h) => h >= 5 && h < 11],
      ['Mittags', (h) => h >= 11 && h < 14],
      ['Nachmittags', (h) => h >= 14 && h < 18],
      ['Abends', (h) => h >= 18 && h < 22],
      ['Nachts', (h) => h >= 22 || h < 5]
    ]
    const byDaypart = dayparts.map(([label]) => [label, 0])
    for (const s of withTime) {
      const h = new Date(s.at).getHours()
      const idx = dayparts.findIndex(([, test]) => test(h))
      if (idx >= 0) byDaypart[idx][1] += s.pages || 0
    }

    const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    const byWeekday = WEEKDAYS.map((l) => [l, 0])
    for (const s of sessions) {
      const jsDay = new Date(`${s.date}T12:00:00`).getDay() // 0 = Sonntag
      const idx = jsDay === 0 ? 6 : jsDay - 1
      byWeekday[idx][1] += s.pages || 0
    }

    const topDaypart = byDaypart.reduce((a, b) => (b[1] > a[1] ? b : a))
    const topWeekday = byWeekday.reduce((a, b) => (b[1] > a[1] ? b : a))

    // Lesesträhne: aufeinanderfolgende Tage mit mindestens einer Sitzung,
    // unabhängig vom Buch.
    const days = [...new Set(sessions.map((s) => s.date))].sort()
    let longest = 0, current = 0, run = 0
    let prev = null
    for (const d of days) {
      if (prev) {
        const gap = Math.round((new Date(d) - new Date(prev)) / 86400000)
        run = gap === 1 ? run + 1 : 1
      } else {
        run = 1
      }
      longest = Math.max(longest, run)
      prev = d
    }
    const todayStr = new Date().toISOString().slice(0, 10)
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const lastDay = days[days.length - 1]
    if (lastDay === todayStr || lastDay === yesterdayStr) current = run

    return {
      byDaypart, byWeekday, longest, current,
      topDaypart: topDaypart[1] > 0 ? topDaypart[0] : null,
      topWeekday: topWeekday[1] > 0 ? topWeekday[0] : null,
      untimed: sessions.length - withTime.length
    }
  }, [sessions])

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
      <div className="screen-head">
        <h1 className="wordmark">Statistik</h1>
        <button className="btn btn-quiet" onClick={() => setNotesOpen(true)}>Zitate &amp; Notizen</button>
      </div>

      {notesOpen && <NotesSearch onClose={() => setNotesOpen(false)} onOpenBook={onOpenBook} />}

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

      {hasRereads && (
        <button className="rereads-toggle" onClick={() => {
          const next = !rereads
          setRereads(next)
          try { localStorage.setItem('libri:rereads', next ? '1' : '0') } catch { /* egal */ }
        }}>
          Erneut Gelesenes: {rereads ? 'mitgezählt' : 'ausgeblendet'} · ändern
        </button>
      )}

      {(d.years.length > 0 || d.pagesPerMonth.some((v) => v > 0)) && (
        <>
          <div className="stats-year-head">
            <h2>Lesejahr</h2>
            <div className="view-toggle">
              {d.years.slice(0, 3).map((y) => (
                <button key={y} aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
          </div>

          {d.inYear.length > 0 && (
            <button className="btn btn-block" style={{ marginBottom: 14 }} onClick={() => setReviewOpen(true)}>
              Dein Lesejahr {year} ansehen →
            </button>
          )}

          {reviewOpen && (
            <YearReview books={books} year={year} onClose={() => setReviewOpen(false)} onOpenBook={onOpenBook} notify={notify} />
          )}

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

          <p className="filter-label">Bücher pro Monat</p>
          <MonthChart values={d.booksPerMonth} unit=" Bücher" />

          {yearPages > 0 && (
            <>
              <p className="filter-label">Seiten pro Monat</p>
              <MonthChart values={d.pagesPerMonth} unit=" Seiten" />
            </>
          )}
        </>
      )}

      {(d.avgDays || d.longest || d.best) && (
        <>
          <h2>Bemerkenswertes</h2>
          <Facts items={[
            d.avgDays && { label: 'Ø pro Buch', value: `${d.avgDays} ${d.avgDays === 1 ? 'Tag' : 'Tage'}` },
            d.fastest && {
              label: 'Schnellstes Buch',
              value: `${d.fastest.days} ${d.fastest.days === 1 ? 'Tag' : 'Tage'}`,
              sub: d.fastest.book.title
            },
            d.longest && {
              label: 'Dickstes Buch', wide: true, value: d.longest.title,
              sub: `${d.longest.pages.toLocaleString('de-DE')} Seiten`
            },
            d.best && { label: 'Bestbewertet', wide: true, value: d.best.title, sub: `${d.best.rating}/10` }
          ]} />
        </>
      )}

      {d.undated > 0 && (
        <button className="notice-slim" onClick={() => setUndatedOpen(true)}>
          <span>{d.undated} {d.undated === 1 ? 'Buch' : 'Bücher'} ohne Lesedatum</span>
          <i aria-hidden="true">›</i>
        </button>
      )}
      {undatedOpen && <UndatedBooks onClose={() => setUndatedOpen(false)} notify={notify} />}

      {d.yearRows.length > 1 && (
        <>
          <h2>Gelesen pro Jahr</h2>
          <Bars rows={d.yearRows} />
        </>
      )}

      {timeData && (
        <>
          <h2>Wann du liest</h2>
          {(timeData.longest > 0) && (
            <Facts items={[
              timeData.current > 1 && { label: 'Streak aktuell', value: `${timeData.current} Tage` },
              { label: 'Längster Streak', value: `${timeData.longest} ${timeData.longest === 1 ? 'Tag' : 'Tage'}` },
              timeData.topDaypart && { label: 'Lieblingszeit', value: timeData.topDaypart },
              timeData.topWeekday && { label: 'Bester Wochentag', value: timeData.topWeekday }
            ]} />
          )}

          <p className="filter-label">Seiten nach Tageszeit</p>
          <Bars rows={timeData.byDaypart} unit=" Seiten" />

          <p className="filter-label">Seiten nach Wochentag</p>
          <Bars rows={timeData.byWeekday} unit=" Seiten" />

          {timeData.untimed > 0 && (
            <p className="hint" style={{ textAlign: 'left', marginTop: 10 }}>
              {timeData.untimed} {timeData.untimed === 1 ? 'Sitzung hat' : 'Sitzungen haben'} keine Tageszeit und{' '}
              {timeData.untimed === 1 ? 'zählt' : 'zählen'} nur beim Wochentag mit. Im Buch unter „Lesesitzungen“
              lässt sich die Tageszeit nachtragen.
            </p>
          )}
        </>
      )}

      <h2>Sprachen</h2>
      <Bars rows={d.langRows} />
    </div>
  )
}
