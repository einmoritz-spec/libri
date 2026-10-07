import { useEffect, useState } from 'react'
import { readingHistory, readingPace, estimateFinish } from '../lib/db'

/* Leseverlauf im Buch.

   Bei einem Buch, das du gerade liest, steht hier keine eigene Rechnung nur
   für dieses Buch, sondern dein Tempo des letzten Monats über alle Bücher.
   Daraus ergibt sich, wie lange du voraussichtlich noch brauchst. Liest du
   gerade deutlich schneller oder langsamer als sonst, fließt das mit ein.
   Bei allen anderen Büchern bleibt es bei dem, was dort eingetragen wurde. */

function Spark({ series }) {
  const max = Math.max(...series.map((d) => d.pages), 1)
  return (
    <div className="spark" aria-hidden="true">
      {series.map((d) => (
        <div className="spark-col" key={d.date} title={`${d.date}: ${d.pages} Seiten`}>
          <div
            className={`spark-bar${d.pages ? '' : ' spark-bar-empty'}`}
            style={{ height: d.pages ? `${(d.pages / max) * 100}%` : '2px' }}
          />
        </div>
      ))}
    </div>
  )
}

const fmtDate = (d) =>
  d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })

/** „heute“, „morgen“, „übermorgen“ oder „in N Tagen“. */
const whenWord = (days) =>
  days === 0 ? 'heute' : days === 1 ? 'morgen' : days === 2 ? 'übermorgen' : `in ${days} Tagen`

export default function ReadingHistory({ book }) {
  const [own, setOwn] = useState(undefined)
  const [pace, setPace] = useState(undefined)
  const reading = book.status === 'reading'

  useEffect(() => {
    let alive = true
    readingHistory(book, 30)
      .then((d) => alive && setOwn(d))
      .catch(() => alive && setOwn(null))
    readingPace()
      .then((p) => alive && setPace(p))
      .catch(() => alive && setPace(null))
    return () => { alive = false }
  }, [book.id, book.currentPage, book.pages, book.status])

  if (own === undefined || pace === undefined) return null

  // Lese ich gerade: Tempo des Monats über alle Bücher
  if (reading && pace) {
    const est = estimateFinish(book, pace)
    const perDay = Math.round(pace.pace)
    return (
      <>
        <h2>Lesetempo</h2>
        <Spark series={pace.series} />
        <p className="hint" style={{ textAlign: 'left', margin: '4px 0 12px' }}>
          alle Bücher, letzte 30 Tage · an {pace.activeDays} {pace.activeDays === 1 ? 'Tag' : 'Tagen'} gelesen
        </p>

        <div className="facts-list">
          <div className="fact-row">
            <span>Dein Tempo</span>
            <b>{perDay} Seiten/Tag</b>
          </div>
          {est && (
            <>
              <div className="fact-row">
                <span>Noch vor dir</span>
                <b>{est.left} Seiten</b>
              </div>
              <div className="fact-row">
                <span>Voraussichtlich fertig</span>
                <b>{fmtDate(est.date)} · {whenWord(est.days)}</b>
              </div>
            </>
          )}
        </div>

        {pace.trend && (
          <p className="hint" style={{ textAlign: 'left', margin: '10px 0 0' }}>
            {pace.trend === 'faster'
              ? `In den letzten 7 Tagen liest du mit etwa ${Math.round(pace.recentPace)} Seiten pro Tag deutlich schneller als im Monatsschnitt (${Math.round(pace.monthPace)}). Die Schätzung berücksichtigt das.`
              : `In den letzten 7 Tagen liest du mit etwa ${Math.round(pace.recentPace)} Seiten pro Tag deutlich langsamer als im Monatsschnitt (${Math.round(pace.monthPace)}). Die Schätzung berücksichtigt das.`}
          </p>
        )}
      </>
    )
  }

  // Alle anderen Bücher: wie bisher, nur der Verlauf dieses Buchs
  if (!own) return null
  const active = own.series.filter((d) => d.pages > 0).length
  if (!active) return null
  return (
    <>
      <h2>Leseverlauf</h2>
      <Spark series={own.series} />
      <p className="hint" style={{ textAlign: 'left', margin: '4px 0 12px' }}>
        letzte 30 Tage · an {active} {active === 1 ? 'Tag' : 'Tagen'} gelesen
      </p>
      <div className="facts-list">
        <div className="fact-row">
          <span>Schnitt an Lesetagen</span>
          <b>{own.perActiveDay} Seiten</b>
        </div>
      </div>
    </>
  )
}
