import { useLayoutEffect, useRef, useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { guideFor } from '../lib/guides'

/* Kleine Vorschau der Lesereihenfolge oben in der Reihen-Ansicht. Antippen
   öffnet das Bild groß: mit zwei Fingern zoomen, mit einem verschieben,
   doppelt tippen vergrößert, und es gibt Knöpfe für Plus und Minus. */

const MAX = 5

function Viewer({ guide, onClose }) {
  const [scale, setScale] = useState(1)
  const boxRef = useRef(null)
  const imgRef = useRef(null)
  const anchor = useRef(null) // Bildstelle (0…1), die beim Zoomen unter dem Finger bleiben soll
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  useBackLayer(true, onClose)

  // Nach jeder Größenänderung die Ansicht so verschieben, dass der Ankerpunkt bleibt.
  useLayoutEffect(() => {
    const box = boxRef.current
    const img = imgRef.current
    const a = anchor.current
    if (!box || !img || !a) return
    box.scrollLeft = a.fx * img.offsetWidth - a.cx
    box.scrollTop = a.fy * img.offsetHeight - a.cy
  }, [scale])

  function zoomTo(next, cx, cy) {
    const box = boxRef.current
    const img = imgRef.current
    const clamped = Math.min(MAX, Math.max(1, next))
    if (!box || !img || clamped === scale) return
    const rect = box.getBoundingClientRect()
    const px = cx ?? rect.width / 2
    const py = cy ?? rect.height / 2
    anchor.current = {
      fx: (box.scrollLeft + px) / img.offsetWidth,
      fy: (box.scrollTop + py) / img.offsetHeight,
      cx: px,
      cy: py
    }
    setScale(clamped)
  }

  const dist = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const mid = () => {
    const [a, b] = [...pointers.current.values()]
    const r = boxRef.current.getBoundingClientRect()
    return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }
  }

  function onPointerDown(e) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) pinch.current = { d: dist(), scale }
  }
  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) {
      const m = mid()
      zoomTo(pinch.current.scale * (dist() / pinch.current.d), m.x, m.y)
    }
  }
  function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }
  function onDoubleClick(e) {
    const r = boxRef.current.getBoundingClientRect()
    zoomTo(scale > 1.2 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top)
  }

  return (
    <div className="guide-viewer" role="dialog" aria-label={guide.sub}>
      <div className="guide-bar">
        <button className="btn btn-quiet" onClick={onClose} aria-label="Schließen">✕</button>
        <span className="guide-bar-title">{guide.title}</span>
        <button className="btn btn-quiet" onClick={() => zoomTo(scale / 1.5)} aria-label="Verkleinern" disabled={scale <= 1}>−</button>
        <button className="btn btn-quiet" onClick={() => zoomTo(scale * 1.5)} aria-label="Vergrößern" disabled={scale >= MAX}>+</button>
      </div>
      <div
        className="guide-scroll" ref={boxRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <img ref={imgRef} src={guide.full} alt={guide.sub} draggable="false"
          style={{ width: `${scale * 100}%` }} />
      </div>
    </div>
  )
}

export default function SeriesGuide({ series }) {
  const guide = guideFor(series)
  const [open, setOpen] = useState(false)
  if (!guide) return null
  return (
    <>
      <button className="guide-card" onClick={() => setOpen(true)}>
        <img src={guide.thumb} alt="" />
        <span>
          <b>{guide.title}</b>
          <small>{guide.sub}</small>
          <small className="guide-hint">Antippen zum Vergrößern</small>
        </span>
      </button>
      {open && <Viewer guide={guide} onClose={() => setOpen(false)} />}
    </>
  )
}
