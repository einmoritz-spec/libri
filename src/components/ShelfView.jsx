import { useMemo, useRef, useState } from 'react'
import { groupByShelf, moveBook, spineWidth, spineHeight, colorFromText } from '../lib/shelf'
import { useCoverSrc, EmptyBookIcon } from './ui'

function Spine({ book, ...handlers }) {
  const src = useCoverSrc(book)
  const w = spineWidth(book)
  const h = spineHeight(book)
  const color = book.spineColor || colorFromText(book.title)

  return (
    <div className="spine" data-book-id={book.id} style={{ width: w, height: h }} {...handlers}>
      {src ? (
        <img className="spine-cover" src={src} alt="" draggable="false" />
      ) : (
        <div className="spine-color" style={{ background: color }} />
      )}
      <div className="spine-scrim" style={{ background: `linear-gradient(180deg, transparent 40%, ${color} 150%)` }} />
      <span className="spine-label">{book.title}</span>
    </div>
  )
}

export default function ShelfView({ books, onOpen, locked }) {
  const rows = useMemo(() => groupByShelf(books), [books])
  const rowRefs = useRef(new Map())
  const dragRef = useRef(null)

  const [dragging, setDragging] = useState(null) // { book }
  const [ghost, setGhost] = useState(null) // { x, y }
  const [dropTarget, setDropTarget] = useState(null) // { row, index }

  function findDropTarget(clientX, clientY) {
    let best = null
    let bestDist = Infinity
    for (const [row, el] of rowRefs.current) {
      if (!el) continue
      const rect = el.getBoundingClientRect()
      const top = rect.top - 26
      const bottom = rect.bottom + 26
      const dist = clientY < top ? top - clientY : clientY > bottom ? clientY - bottom : 0
      if (dist < bestDist) {
        bestDist = dist
        const kids = [...el.children].filter((c) => c.dataset.bookId)
        let index = kids.length
        for (let i = 0; i < kids.length; i++) {
          const r = kids[i].getBoundingClientRect()
          if (clientX < r.left + r.width / 2) {
            index = i
            break
          }
        }
        best = { row, index }
      }
    }
    return best
  }

  function onSpineDown(e, book, row) {
    if (locked) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { book, fromRow: row, startX: e.clientX, startY: e.clientY, moved: false }
  }

  function onSpineMove(e) {
    const d = dragRef.current
    if (!d) return
    const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
    if (!d.moved && dist > 6) {
      d.moved = true
      setDragging({ book: d.book })
      navigator.vibrate?.(15)
    }
    if (d.moved) {
      setGhost({ x: e.clientX, y: e.clientY })
      setDropTarget(findDropTarget(e.clientX, e.clientY))
    }
  }

  async function onSpineUp(e) {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (!d.moved) {
      onOpen(d.book)
    } else if (dropTarget) {
      await moveBook(d.book.id, dropTarget.row, dropTarget.index, rows)
    }
    setDragging(null)
    setGhost(null)
    setDropTarget(null)
  }

  if (!rows.some((r) => r.books.length)) {
    return <div className="empty"><EmptyBookIcon /><p>Noch nichts im Regal.</p></div>
  }

  return (
    <div className="shelf-view">
      {locked && (
        <p className="hint" style={{ textAlign: 'left', margin: '0 0 14px' }}>
          Bei aktivem Filter lässt sich nicht umsortieren — erst zurücksetzen.
        </p>
      )}

      {rows.map(({ row, books: list }) => {
        const showGap = dragging && dropTarget?.row === row
        const items = dragging ? list.filter((b) => b.id !== dragging.book.id) : list
        const rendered = []
        items.forEach((b, i) => {
          if (showGap && dropTarget.index === i) rendered.push({ gap: true, key: `gap-${row}` })
          rendered.push(b)
        })
        if (showGap && dropTarget.index >= items.length) rendered.push({ gap: true, key: `gap-${row}-end` })

        return (
          <div className="shelf-row" key={row}>
            <div className="shelf-board" ref={(el) => rowRefs.current.set(row, el)}>
              {rendered.length === 0 && <span className="shelf-row-hint">Brett {row + 1}</span>}
              {rendered.map((item) =>
                item.gap ? (
                  <div className="drop-gap" key={item.key} />
                ) : (
                  <Spine
                    key={item.id}
                    book={item}
                    onPointerDown={(e) => onSpineDown(e, item, row)}
                    onPointerMove={onSpineMove}
                    onPointerUp={onSpineUp}
                    onPointerCancel={onSpineUp}
                  />
                )
              )}
            </div>
            <div className="shelf-plank" />
          </div>
        )
      })}

      {dragging && ghost && (
        <div
          className="shelf-ghost"
          style={{ left: ghost.x, top: ghost.y, width: spineWidth(dragging.book), height: spineHeight(dragging.book) }}
        >
          <Spine book={dragging.book} />
        </div>
      )}
    </div>
  )
}
