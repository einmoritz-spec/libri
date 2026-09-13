import { memo } from 'react'
import { useTapHold } from '../lib/useTapHold'
import { Cover } from './ui'

/** layout: 'grid' (Raster/Regal-Reihe, gleiche Auszeichnung) oder 'row' (kompakte Liste). */
export const BookCard = memo(function BookCard({ book, onOpen, onLongPress, layout = 'grid', badge }) {
  const gestures = useTapHold(() => onOpen(book), () => onLongPress(book))

  if (layout === 'row') {
    return (
      <button className="book-row" {...gestures}>
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
    <button className="slot" {...gestures}>
      <div className="slot-art">
        <Cover book={book} />
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
