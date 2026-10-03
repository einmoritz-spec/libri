import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { BookCard } from './BookCard'
import { Shelf } from './Home'

/* Alles von einem Autor: oben die Reihen, jede als eigene Zeile zum
   Wischen, darunter die einzelnen Bücher als Kacheln nebeneinander. */
export default function AuthorView({ name, onClose, onOpen }) {
  const all = useLiveQuery(() => db.books.toArray(), [], undefined)

  const { series, singles, count } = useMemo(() => {
    const mine = (all || []).filter(
      (b) => (b.authors || []).includes(name) && b.status !== 'wishlist'
    )
    const map = new Map()
    for (const b of mine) {
      if (!b.series) continue
      if (!map.has(b.series)) map.set(b.series, [])
      map.get(b.series).push(b)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.seriesIndex || 0) - (b.seriesIndex || 0))
    }
    return {
      series: [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de')),
      singles: mine.filter((b) => !b.series).sort((a, b) => a.title.localeCompare(b.title, 'de')),
      count: mine.length
    }
  }, [all, name])

  const noop = () => {}

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onClose}>Zurück</button>
      </div>

      <div className="screen-head" style={{ marginBottom: 4 }}>
        <h1 className="wordmark author-title">{name}</h1>
      </div>
      <p className="hint" style={{ textAlign: 'left', margin: '0 0 8px' }}>
        {count} {count === 1 ? 'Buch' : 'Bücher'}
        {series.length > 0 ? ` · ${series.length} ${series.length === 1 ? 'Reihe' : 'Reihen'}` : ''}
      </p>

      {all === undefined ? (
        <p className="hint"><span className="spinner" /></p>
      ) : (
        <div className="home">
          {series.map(([title, list]) => {
            const read = list.filter((b) => b.status === 'read').length
            return (
              <Shelf
                key={title} title={title} sub={`${read}/${list.length} gelesen`}
                books={list} onOpen={onOpen} onLongPress={noop}
                badge={(b) => (b.seriesIndex ? `Band ${b.seriesIndex}` : null)}
              />
            )
          })}

          {singles.length > 0 && (
            <section className="shelf-section">
              <div className="shelf-section-head">
                <h2>{series.length ? 'Einzelne Bücher' : 'Bücher'}</h2>
                <span className="shelf-section-sub">{singles.length}</span>
              </div>
              <div className="cover-grid">
                {singles.map((b) => (
                  <BookCard key={b.id} book={b} onOpen={onOpen} onLongPress={noop} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
