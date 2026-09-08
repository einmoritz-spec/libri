import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { languageName } from '../lib/metadata'
import { EmptyBookIcon } from './ui'

function Bars({ rows, unit }) {
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

export default function Stats() {
  const books = useLiveQuery(() => db.books.toArray(), [], null)
  if (!books) {
    return (
      <div className="screen">
        <p className="hint"><span className="spinner" /> Zahlen werden geladen…</p>
      </div>
    )
  }

  const read = books.filter((b) => b.status === 'read')
  const reading = books.filter((b) => b.status === 'reading')
  const owned = books.filter((b) => b.status !== 'wishlist')

  const pagesRead =
    read.reduce((s, b) => s + (b.pages || 0), 0) +
    reading.reduce((s, b) => s + (b.currentPage || 0), 0)

  const shelfPages = owned.reduce((s, b) => s + (b.pages || 0), 0)
  const unread = owned.filter((b) => b.status === 'owned')

  const byYear = {}
  for (const b of read) {
    if (!b.finishedAt) continue
    const y = b.finishedAt.slice(0, 4)
    byYear[y] = (byYear[y] || 0) + 1
  }
  const yearRows = Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6)

  const byLang = {}
  for (const b of books) {
    const l = b.language ? languageName(b.language) : 'unbekannt'
    byLang[l] = (byLang[l] || 0) + 1
  }
  const langRows = Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 6)

  const rated = read.filter((b) => b.rating)
  const avg = rated.length
    ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
    : null

  if (!books.length) {
    return (
      <div className="screen">
        <div className="screen-head"><h1 className="wordmark">Statistik</h1></div>
        <div className="empty"><EmptyBookIcon /><p>Sobald Bücher im Regal stehen, steht hier etwas.</p></div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="screen-head"><h1 className="wordmark">Statistik</h1></div>

      <div className="stat-row">
        <div className="stat"><b>{books.length}</b><span>Bücher</span></div>
        <div className="stat"><b>{read.length}</b><span>gelesen</span></div>
        <div className="stat"><b>{unread.length}</b><span>ungelesen</span></div>
        {avg && <div className="stat"><b>{avg}</b><span>Ø Bewertung</span></div>}
      </div>

      <div className="stat-row">
        <div className="stat">
          <b>{pagesRead.toLocaleString('de-DE')}</b><span>gelesene Seiten</span>
        </div>
        <div className="stat">
          <b>{shelfPages.toLocaleString('de-DE')}</b><span>Seiten im Regal</span>
        </div>
      </div>

      {yearRows.length > 0 && (
        <>
          <h2>Gelesen pro Jahr</h2>
          <Bars rows={yearRows} unit="" />
        </>
      )}

      <h2>Sprachen</h2>
      <Bars rows={langRows} unit="" />
    </div>
  )
}
