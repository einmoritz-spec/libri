import { memo, useContext } from 'react'
import { SelectionContext } from '../lib/selection'
import { useTapHold } from '../lib/useTapHold'
import { Cover } from './ui'

/** layout: 'grid' (Raster/Regal-Reihe, gleiche Auszeichnung) oder 'row' (kompakte Liste). */
export const BookCard = memo(function BookCard({ book, onOpen, onLongPress, layout = 'grid', badge }) {
  const gestures = useTapHold(() => onOpen(book), () => onLongPress(book))
  const selected = useContext(SelectionContext).has(book.id)

  if (layout === 'row') {
    return (
      <button className={`book-row${selected ? ' is-selected' : ''}`} aria-pressed={selected} {...gestures}>
        {selected && <span className="sel-check" aria-hidden="true">✓</span>}
        <div className="book-row-art"><Cover book={book} /></div>
        <div className="book-row-text">
          <div className="book-row-title">{book.title}</div>
          <div className="book-row-author">{book.authors?.[0] || '—'}</div>
        </div>
      </button>
    )
  }

  const pct = book.pages && book.currentPage
    ? Math.min(100, (book.currentPage / book.pages) * 100)
    : 0

  return (
    <button className={`slot${selected ? ' is-selected' : ''}`} aria-pressed={selected} {...gestures}>
      <div className="slot-art">
        <Cover book={book} />
        {selected && <span className="sel-check" aria-hidden="true">✓</span>}
        {badge && <span className="slot-badge">{badge}</span>}
      </div>
      <div className="slot-caption">
        <div className="slot-title">{book.title}</div>
        <div className="slot-author">{book.authors?.[0] || '—'}</div>
        {book.status === 'reading' && (
          <div className="slot-bar"><span style={{ width: `${pct}%` }} /></div>
        )}
      </div>
    </button>
  )
})
