import { useMemo } from 'react'
import { BookCard } from './BookCard'
import { EmptyBookIcon } from './ui'

/* Alles hier läuft waagerecht statt in die Länge — bei einer Bibliothek, die
   größtenteils aus Reihen besteht, ist das der eigentliche Hebel gegen die
   endlose Liste: aus vierzig Büchern werden acht Zeilen. */

function buildSections(books) {
  const reading = books.filter((b) => b.status === 'reading')
  const wishlist = books.filter((b) => b.status === 'wishlist')

  const seriesMap = new Map()
  for (const b of books) {
    if (!b.series) continue
    if (!seriesMap.has(b.series)) seriesMap.set(b.series, [])
    seriesMap.get(b.series).push(b)
  }
  for (const list of seriesMap.values()) {
    list.sort((a, b) => (a.seriesIndex || 0) - (b.seriesIndex || 0))
  }
  const seriesList = [...seriesMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'))

  // Der jeweils nächste noch nicht begonnene Band — weder gelesen noch
  // gerade in Arbeit, sonst würde "als Nächstes" auf den Band zeigen, der
  // schon oben unter "Lese ich gerade" steht. Auch kein Wunschlisten-Eintrag:
  // ein Buch, das du noch gar nicht besitzt, ist nicht als Nächstes dran,
  // dafür gibt es den eigenen Wunschlisten-Abschnitt.
  const upNext = []
  for (const [, list] of seriesList) {
    const next = list.find(
      (b) => b.status !== 'read' && b.status !== 'reading' && b.status !== 'wishlist'
    )
    if (next) upNext.push(next)
  }

  // Wer schon oben unter "Lese ich gerade" oder "Wunschliste" steht, muss
  // hier nicht noch einmal auftauchen.
  const standalone = books.filter(
    (b) => !b.series && b.status !== 'reading' && b.status !== 'wishlist'
  )

  return { reading, wishlist, upNext, seriesList, standalone }
}

function Shelf({ title, sub, books, onOpen, onLongPress, badge }) {
  if (!books.length) return null
  return (
    <section className="shelf-section">
      <div className="shelf-section-head">
        <h2>{title}</h2>
        {sub && <span className="shelf-section-sub">{sub}</span>}
      </div>
      <div className="shelf-row-scroll">
        {books.map((b) => (
          <BookCard key={b.id} book={b} onOpen={onOpen} onLongPress={onLongPress}
            badge={badge ? badge(b) : null} />
        ))}
      </div>
    </section>
  )
}

export default function Home({ books, onOpen, onLongPress, onJumpToSeries }) {
  const { reading, wishlist, upNext, seriesList, standalone } = useMemo(
    () => buildSections(books),
    [books]
  )

  if (!books.length) {
    return (
      <div className="empty">
        <EmptyBookIcon />
        <p>Dein Regal ist noch leer.</p>
      </div>
    )
  }

  return (
    <div className="home">
      <Shelf title="Lese ich gerade" books={reading} onOpen={onOpen} onLongPress={onLongPress} />

      <Shelf
        title="Als Nächstes dran" books={upNext} onOpen={onOpen} onLongPress={onLongPress}
        badge={(b) => b.seriesIndex ? `Band ${b.seriesIndex}` : null}
      />

      <Shelf
        title="Wunschliste" sub={wishlist.length ? `${wishlist.length}` : null}
        books={wishlist} onOpen={onOpen} onLongPress={onLongPress}
      />

      {seriesList.map(([name, list]) => {
        const read = list.filter((b) => b.status === 'read').length
        return (
          <section className="shelf-section" key={name}>
            <button className="shelf-section-head shelf-section-link" onClick={() => onJumpToSeries(name)}>
              <h2>{name}</h2>
              <span className="shelf-section-sub">{read}/{list.length} gelesen ›</span>
            </button>
            <div className="shelf-row-scroll">
              {list.map((b) => (
                <BookCard key={b.id} book={b} onOpen={onOpen} onLongPress={onLongPress}
                  badge={b.seriesIndex ? `Band ${b.seriesIndex}` : null} />
              ))}
            </div>
          </section>
        )
      })}

      <Shelf title="Einzelne Bücher" books={standalone} onOpen={onOpen} onLongPress={onLongPress} />
    </div>
  )
}
