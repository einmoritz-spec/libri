import { useEffect, useMemo, useRef, useState } from 'react'
import {
  orderBooks, packRows, saveOrder, resetOrder, spineWidth, spineHeight,
  gradientFromImage, gradientCss, fallbackGradient, queueSpineGrad
} from '../lib/shelf'
import { useCoverSrc, EmptyBookIcon } from './ui'

const memGrad = new Map() // Verläufe dieser Sitzung: id → Hex-Liste

function CheckIcon() {
  return (
    <svg className="sv-ck" viewBox="0 0 12 12" aria-label="Gelesen">
      <path d="M2 6.3l2.8 2.8L10 3.2" fill="none" stroke="#000" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function EbookIcon() {
  return (
    <svg className="sv-eb" viewBox="0 0 12 12" aria-label="eBook">
      <rect x="3" y="1.5" width="6" height="9" rx="1" fill="none" stroke="#000" strokeWidth="1.1" />
      <path d="M5.2 8.6h1.6" stroke="#000" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function Spine({ book, mode, lifted, dragged, ...handlers }) {
  const src = useCoverSrc(book)
  const [grad, setGrad] = useState(() => book.spineGrad || memGrad.get(book.id) || null)

  useEffect(() => {
    if (mode !== 'gradient') return
    if (book.spineGrad) { setGrad(book.spineGrad); return }
    if (memGrad.has(book.id)) { setGrad(memGrad.get(book.id)); return }
    if (!src) return
    let alive = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const g = gradientFromImage(img)
      if (!g) return
      memGrad.set(book.id, g)
      queueSpineGrad(book.id, g)
      if (alive) setGrad(g)
    }
    img.src = src
    return () => { alive = false }
  }, [mode, src, book.id, book.spineGrad])

  let background = fallbackGradient(book)
  if (mode === 'cover' && src) background = `url("${src}") left top / auto 100% no-repeat, ${background}`
  else if (mode === 'gradient' && grad) background = gradientCss(grad)

  // Im Cover-Modus bleibt der Rücken sauber: nur das Bild, Beschriftung und Symbole nur ohne Cover.
  const bare = mode === 'cover' && Boolean(src)
  const w = spineWidth(book)
  const h = spineHeight(book)
  return (
    <div
      className={`sp${lifted ? ' lifted' : ''}${dragged ? ' dragged' : ''}`}
      data-id={book.id}
      style={{ width: w, height: h, background }}
      {...handlers}
    >
      {!bare && book.seriesIndex ? <span className="sv-no">{book.seriesIndex}</span> : null}
      {!bare && <span className="sv-t">{book.title}</span>}
      {!bare && book.files?.length > 0 && <EbookIcon />}
      {!bare && book.status === 'read' && <CheckIcon />}
    </div>
  )
}

function Peek({ book, onOpen, onClose }) {
  const src = useCoverSrc(book)
  return (
    <div className="sv-peek">
      {src ? <img src={src} alt="" /> : <div className="sv-peek-blank" />}
      <div className="sv-peek-text">
        <b>{book.title}</b>
        <span>{(book.authors || []).join(', ')}{book.pages ? ` · ${book.pages} S.` : ''}</span>
      </div>
      <button className="btn btn-primary" onClick={() => onOpen(book)}>Öffnen</button>
      <button className="btn btn-quiet" onClick={onClose} aria-label="Schließen">✕</button>
    </div>
  )
}

export default function ShelfView({ all, visible, mode, onOpen, locked }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(340)
  const [drag, setDrag] = useState(null) // { book }
  const [ghost, setGhost] = useState(null)
  const [dropIndex, setDropIndex] = useState(0)
  const [peek, setPeek] = useState(null)
  const st = useRef({})

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth - 8)))
    ro.observe(el)
    setWidth(Math.max(200, el.clientWidth - 8))
    return () => ro.disconnect()
  }, [])

  const order = useMemo(() => orderBooks(all), [all])
  const visibleIds = useMemo(() => new Set(visible.map((b) => b.id)), [visible])
  const shownOrder = useMemo(() => order.filter((b) => visibleIds.has(b.id)), [order, visibleIds])

  const items = useMemo(() => {
    if (!drag) return shownOrder
    const rest = shownOrder.filter((b) => b.id !== drag.book.id)
    const out = [...rest]
    out.splice(Math.min(dropIndex, out.length), 0, { gap: true, w: spineWidth(drag.book), id: 'gap' })
    return out
  }, [shownOrder, drag, dropIndex])

  const rows = useMemo(() => packRows(items, width), [items, width])

  const hasCustom = all.some((b) => Number.isFinite(b.shelfPos))

  function indexAt(x, y) {
    const els = [...wrapRef.current.querySelectorAll('.sp[data-id]')].filter((e) => !e.classList.contains('dragged'))
    let best = 0
    let bestD = Infinity
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const d = Math.abs(cx - x) + Math.abs(cy - y) * 3
      if (d < bestD) {
        bestD = d
        best = x > cx ? i + 1 : i
      }
    })
    return els.length ? best : 0
  }

  function startDrag(book, x, y) {
    st.current.dragging = true
    navigator.vibrate?.(15)
    setPeek(null)
    setDrag({ book })
    setGhost({ x, y })
    setDropIndex(shownOrder.findIndex((b) => b.id === book.id))
    const block = (e) => e.preventDefault()
    st.current.block = block
    window.addEventListener('touchmove', block, { passive: false })
    // Das gezogene Buch verschwindet aus der Liste — seine Zeigerereignisse
    // kommen dann nicht mehr an. Deshalb ab jetzt am Fenster mithören.
    const move = (ev) => {
      st.current.y = ev.clientY
      setGhost({ x: ev.clientX, y: ev.clientY })
      setDropIndex(indexAt(ev.clientX, ev.clientY))
    }
    const up = () => endDrag(true)
    const cancel = () => endDrag(false)
    st.current.win = { move, up, cancel }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    st.current.scroller = setInterval(() => {
      const y2 = st.current.y
      if (y2 == null) return
      if (y2 < 110) window.scrollBy(0, -12)
      else if (y2 > window.innerHeight - 130) window.scrollBy(0, 12)
    }, 16)
  }

  function endDrag(commit) {
    clearTimeout(st.current.timer)
    window.removeEventListener('touchmove', st.current.block)
    const w = st.current.win
    if (w) {
      window.removeEventListener('pointermove', w.move)
      window.removeEventListener('pointerup', w.up)
      window.removeEventListener('pointercancel', w.cancel)
    }
    clearInterval(st.current.scroller)
    const wasDragging = st.current.dragging
    const book = st.current.book
    st.current = {}
    if (wasDragging && commit) {
      const rest = shownOrder.filter((b) => b.id !== book.id)
      rest.splice(Math.min(st.dropRef ?? 0, rest.length), 0, book)
      saveOrder(rest)
    }
    setDrag(null)
    setGhost(null)
    return wasDragging
  }

  // dropIndex für den Abschluss im Ref halten (State wäre im Handler veraltet)
  useEffect(() => { st.dropRef = dropIndex }, [dropIndex])

  function onDown(e, book) {
    if (locked) { st.current = { book, tapOnly: true, x0: e.clientX, y0: e.clientY }; return }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    st.current = { book, x0: e.clientX, y0: e.clientY, type: e.pointerType }
    if (e.pointerType !== 'mouse') {
      st.current.timer = setTimeout(() => startDrag(book, e.clientX, e.clientY), 380)
    }
  }
  function onMove(e) {
    const s = st.current
    if (!s.book) return
    s.y = e.clientY
    const dist = Math.hypot(e.clientX - s.x0, e.clientY - s.y0)
    if (!s.dragging) {
      if (s.tapOnly) return
      if (s.type === 'mouse' && dist > 6) startDrag(s.book, e.clientX, e.clientY)
      else if (s.type !== 'mouse' && dist > 9) { clearTimeout(s.timer); s.moved = true }
      return
    }
  }
  function onUp(e, book) {
    const s = st.current
    if (!s.book) return
    if (s.dragging) { endDrag(true); return }
    const tap = !s.moved && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < 9
    clearTimeout(s.timer)
    st.current = {}
    if (tap) {
      if (peek?.id === book.id) onOpen(book)
      else setPeek(book)
    }
  }
  function onCancel() { endDrag(false) }

  if (!all.length) {
    return <div className="empty"><EmptyBookIcon /><p>Noch nichts im Regal.</p></div>
  }

  return (
    <div className="sv" ref={wrapRef}>
      <div className="sv-head">
        <span>
          {locked
            ? 'Bei aktivem Filter lässt sich nicht umsortieren.'
            : 'Halten & ziehen zum Umsortieren · Tippen für Infos'}
        </span>
        {hasCustom && !locked && (
          <button className="btn btn-quiet sv-reset" onClick={() => resetOrder(all)}>Zurücksetzen</button>
        )}
      </div>

      {rows.map((row, ri) => (
        <div className="sv-shelf" key={ri}>
          <div className="sv-row">
            {row.map((it) =>
              it.gap ? (
                <div key="gap" className="sv-gap" style={{ width: it.w }} />
              ) : (
                <Spine
                  key={it.id}
                  book={it}
                  mode={mode}
                  lifted={peek?.id === it.id}
                  onPointerDown={(e) => onDown(e, it)}
                  onPointerMove={onMove}
                  onPointerUp={(e) => onUp(e, it)}
                  onPointerCancel={onCancel}
                />
              )
            )}
          </div>
          <div className="sv-board" />
        </div>
      ))}

      {drag && ghost && (
        <div className="sv-ghost" style={{ left: ghost.x, top: ghost.y }}>
          <Spine book={drag.book} mode={mode} />
        </div>
      )}

      {peek && !drag && <Peek book={peek} onOpen={onOpen} onClose={() => setPeek(null)} />}
    </div>
  )
}
