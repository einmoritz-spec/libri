import { useEffect, useState } from 'react'
import { readingHistory } from '../lib/db'

/* Zeigt, was die App beim Eintragen des Fortschritts längst mitschreibt:
   Seiten je Tag. Daraus ergibt sich nebenbei eine Schätzung, wann das Buch
   durch ist — ohne dass dafür etwas Zusätzliches erfasst werden müsste. */
export default function ReadingHistory({ book }) {
  const [data, setData] = useState(undefined)

  useEffect(() => {
    let alive = true
    readingHistory(book, 30)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
    return () => { alive = false }
  }, [book.id, book.currentPage, book.pages])

  if (data === undefined || data === null) return null

  const max = Math.max(...data.series.map((d) => d.pages), 1)
  const active = data.series.filter((d) => d.pages > 0).length
  if (!active) return null

  return (
    <>
      <h2>Leseverlauf</h2>

      <div className="spark" aria-hidden="true">
        {data.series.map((d) => (
          <div className="spark-col" key={d.date} title={`${d.date}: ${d.pages} Seiten`}>
            <div
              className={`spark-bar${d.pages ? '' : ' spark-bar-empty'}`}
              style={{ height: d.pages ? `${(d.pages / max) * 100}%` : '2px' }}
            />
          </div>
        ))}
      </div>
      <p className="hint" style={{ textAlign: 'left', margin: '4px 0 12px' }}>
        letzte 30 Tage · an {active} {active === 1 ? 'Tag' : 'Tagen'} gelesen
      </p>

      <div className="facts-list">
        <div className="fact-row">
          <span>Schnitt an Lesetagen</span>
          <b>{data.perActiveDay} Seiten</b>
        </div>
        {data.left !== null && (
          <div className="fact-row">
            <span>Noch vor dir</span>
            <b>{data.left} Seiten</b>
          </div>
        )}
        {data.daysLeft !== null && data.left > 0 && (
          <div className="fact-row">
            <span>In deinem Tempo</span>
            <b>noch {data.daysLeft} {data.daysLeft === 1 ? 'Lesetag' : 'Lesetage'}</b>
          </div>
        )}
      </div>
    </>
  )
}
