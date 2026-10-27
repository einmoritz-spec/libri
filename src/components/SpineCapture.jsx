import { useEffect, useMemo, useRef, useState } from 'react'
import { db, saveSpinePhoto, updateBook } from '../lib/db'
import { orderBooks, spineWidth, spineHeight, photoHeight } from '../lib/shelf'

/* Buchrücken fotografieren: Vollbild-Kamera mit hochkantem, frei
   anpassbarem Rahmen. Die Bücher werden nacheinander abgearbeitet; bei jedem
   gilt: Rahmen einstellen → Auslöser → prüfen → Haken. */

const MIN_W = 26
const MIN_H = 80
const lastFrame = new Map() // Reihe/Buch → zuletzt benutzte Rahmengröße (nur diese Sitzung)

const KIDS_TAGS = ['Bilderbuch', 'Kinderbuch', 'Kindersachbuch']

/** Ob ein Buch real im Regal steht, weiß die App nicht (eBooks und Papier sind
    gleich eingetragen) — deshalb kommen alle Bücher dran, außer Wunschliste,
    Bilderbücher und was von Hand als „nicht als Buch vorhanden“ markiert wurde. */
export function needsSpinePhoto(b) {
  if (b.status === 'wishlist' || b.noSpine) return false
  return !(b.tags || []).some((t) => KIDS_TAGS.includes(t))
}

function suggest(book, box, aspect) {
  const a = aspect || spineWidth(book) / spineHeight(book)
  const key = book.series || null
  const prev = key && lastFrame.get(key)
  let h = prev ? prev.h : box.h * 0.56
  let w = prev ? prev.w : h * a
  h = Math.min(h, box.h * 0.8)
  w = Math.max(MIN_W, Math.min(w, box.w * 0.8))
  return { x: (box.w - w) / 2, y: Math.max(130, (box.h - h) / 2 - 30), w, h }
}

export default function SpineCapture({ onClose }) {
  const boxRef = useRef(null)
  const videoRef = useRef(null)
  const imgRef = useRef(null)
  const streamRef = useRef(null)
  const dragRef = useRef(null)
  const [queue, setQueue] = useState(null)
  const [done, setDone] = useState(0) // schon erledigt vor dem Start (für die Anzeige)
  const [pos, setPos] = useState(0)
  const [camErr, setCamErr] = useState('')
  const [camReady, setCamReady] = useState(false)
  const [torch, setTorch] = useState(null) // null = nicht verfügbar
  const [gallery, setGallery] = useState(null)
  const [frame, setFrame] = useState(null)
  const [shot, setShot] = useState(null) // { blob, url, aspect }
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  // Warteschlange: Papierbücher ohne Foto in Regalreihenfolge
  useEffect(() => {
    let alive = true
    ;(async () => {
      const books = (await db.books.toArray()).filter(needsSpinePhoto)
      const have = new Set(await db.spines.toCollection().primaryKeys())
      const ordered = orderBooks(books)
      if (!alive) return
      setDone(ordered.filter((b) => have.has(b.id)).length)
      setQueue(ordered.filter((b) => !have.has(b.id)))
    })()
    return () => { alive = false }
  }, [])

  // Kamera
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        })
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        if (v) { v.srcObject = stream; await v.play().catch(() => {}) }
        const caps = stream.getVideoTracks()[0]?.getCapabilities?.() || {}
        setTorch(caps.torch ? false : null)
        setCamReady(true)
      } catch (e) {
        setCamErr(e?.name === 'NotAllowedError'
          ? 'Der Kamerazugriff ist blockiert. Erlaube ihn in den Browser-Einstellungen oder wähle Fotos aus der Galerie.'
          : 'Die Kamera lässt sich nicht starten. Du kannst stattdessen Fotos aus der Galerie wählen.')
      }
    })()
    return () => {
      dead = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const book = queue && queue[pos]

  // Rahmen für das aktuelle Buch vorschlagen
  useEffect(() => {
    if (!book || !boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    setFrame(suggest(book, { w: r.width, h: r.height }))
  }, [book?.id])

  useEffect(() => () => { if (shot?.url) URL.revokeObjectURL(shot.url) }, [shot])
  useEffect(() => () => { if (gallery) URL.revokeObjectURL(gallery) }, [gallery])

  const toggleTorch = async () => {
    const t = streamRef.current?.getVideoTracks()[0]
    if (!t) return
    try {
      await t.applyConstraints({ advanced: [{ torch: !torch }] })
      setTorch(!torch)
    } catch { /* Blitz nicht schaltbar */ }
  }

  /* ── Rahmen ziehen ── */
  const startDrag = (kind) => (e) => {
    if (!frame || shot) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { kind, sx: e.clientX, sy: e.clientY, f: { ...frame } }
  }
  const moveDrag = (e) => {
    const d = dragRef.current
    if (!d || !boxRef.current) return
    const box = boxRef.current.getBoundingClientRect()
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    let { x, y, w, h } = d.f
    const k = d.kind
    if (k === 'move') { x += dx; y += dy }
    else {
      if (k.includes('w')) { const nx = Math.min(x + dx, x + w - MIN_W); w = w + (x - nx); x = nx }
      if (k.includes('e')) w = Math.max(MIN_W, w + dx)
      if (k.includes('n')) { const ny = Math.min(y + dy, y + h - MIN_H); h = h + (y - ny); y = ny }
      if (k.includes('s')) h = Math.max(MIN_H, h + dy)
    }
    x = Math.max(0, Math.min(x, box.width - w))
    y = Math.max(0, Math.min(y, box.height - h))
    w = Math.min(w, box.width - x)
    h = Math.min(h, box.height - y)
    setFrame({ x, y, w, h })
  }
  const endDrag = () => { dragRef.current = null }

  const resetFrame = () => {
    if (!book || !boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    if (book.series) lastFrame.delete(book.series)
    setFrame(suggest(book, { w: r.width, h: r.height }))
  }

  /* ── Aufnahme ── */
  const capture = () => {
    if (!frame || !boxRef.current) return
    const box = boxRef.current.getBoundingClientRect()
    const el = gallery ? imgRef.current : videoRef.current
    const vw = gallery ? el?.naturalWidth : el?.videoWidth
    const vh = gallery ? el?.naturalHeight : el?.videoHeight
    if (!el || !vw || !vh) return
    const scale = Math.max(box.width / vw, box.height / vh)
    const ox = (vw * scale - box.width) / 2
    const oy = (vh * scale - box.height) / 2
    const sx = (frame.x + ox) / scale
    const sy = (frame.y + oy) / scale
    const sw = frame.w / scale
    const sh = frame.h / scale
    const outH = Math.round(Math.min(560, sh))
    const outW = Math.max(8, Math.round(outH * (frame.w / frame.h)))
    const c = document.createElement('canvas')
    c.width = outW
    c.height = outH
    c.getContext('2d').drawImage(el, sx, sy, sw, sh, 0, 0, outW, outH)
    c.toBlob((blob) => {
      if (!blob) return
      setShot({ blob, url: URL.createObjectURL(blob), aspect: frame.w / frame.h })
    }, 'image/jpeg', 0.86)
  }

  const noPaper = async () => {
    if (!book) return
    await updateBook(book.id, { noSpine: true })
    next()
  }
  const next = () => {
    setShot(null)
    setPos((p) => p + 1)
  }
  const confirm = async () => {
    if (!shot || !book || saving) return
    setSaving(true)
    try {
      await saveSpinePhoto(book.id, shot.blob, shot.aspect)
      if (book.series && frame) lastFrame.set(book.series, { w: frame.w, h: frame.h })
      next()
    } finally { setSaving(false) }
  }

  const pickGallery = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) setGallery(URL.createObjectURL(f))
  }

  const total = queue ? queue.length + done : 0
  const finished = queue && pos >= queue.length
  const live = !camErr || gallery

  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

  return (
    <div className="sc" role="dialog" aria-label="Buchrücken fotografieren">
      <div className="sc-box" ref={boxRef}>
        {!gallery && <video ref={videoRef} className="sc-feed" playsInline muted autoPlay />}
        {gallery && <img ref={imgRef} className="sc-feed" src={gallery} alt="" />}

        {queue && !finished && live && frame && !shot && (
          <div
            className="sc-frame"
            style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
            onPointerDown={startDrag('move')}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {handles.map((k) => (
              <span
                key={k}
                className={`sc-h sc-h-${k}`}
                onPointerDown={startDrag(k)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              ><i /></span>
            ))}
          </div>
        )}

        <div className="sc-head">
          <button className="sc-round" onClick={onClose} aria-label="Schließen">✕</button>
          <span>{queue && !finished ? `${done + pos + 1} / ${total}` : ''}</span>
          {torch !== null && !gallery
            ? <button className="sc-round" onClick={toggleTorch} aria-pressed={torch} aria-label="Blitz">{torch ? '⚡' : '⚡︎'}</button>
            : <span style={{ width: 34 }} />}
        </div>

        {!queue && <div className="sc-msg">Lade Bücher …</div>}

        {queue && finished && (
          <div className="sc-msg">
            <b>{queue.length ? 'Fertig für heute' : 'Alles fotografiert'}</b>
            <span>{queue.length ? `${queue.length} Rücken neu aufgenommen.` : 'Alle Papierbücher haben schon einen Rücken.'}</span>
            <button className="btn btn-primary" onClick={onClose}>Schließen</button>
          </div>
        )}

        {queue && !finished && book && (
          <div className="sc-title">
            <b>{book.title}</b>
            <span>
              {[(book.authors || [])[0], book.seriesIndex ? `Band ${book.seriesIndex}` : null, book.pages ? `${book.pages} S.` : null].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}

        {camErr && !gallery && queue && !finished && (
          <div className="sc-msg sc-err">
            <span>{camErr}</span>
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>Foto aus Galerie wählen</button>
          </div>
        )}

        {queue && !finished && live && !shot && (
          <>
            <div className="sc-help">
              Rücken in den Rahmen legen · Kanten ziehen zum Anpassen
              <span>
                <button className="sc-link" onClick={resetFrame}>Rahmen zurücksetzen</button>
                <button className="sc-link" onClick={noPaper}>Nicht als Buch vorhanden</button>
              </span>
            </div>
            <div className="sc-bar">
              <button className="sc-side" onClick={() => setPos((p) => Math.max(0, p - 1))} disabled={pos === 0}>
                <u>‹</u>Zurück
              </button>
              <button className="sc-shut" onClick={capture} aria-label="Foto aufnehmen" disabled={!camReady && !gallery}><i /></button>
              <button className="sc-side" onClick={next}>
                <u>›</u>Überspringen
              </button>
            </div>
          </>
        )}

        {shot && book && (
          <div className="sc-review">
            <div className="sc-review-main">
              <img src={shot.url} alt="" style={{ aspectRatio: shot.aspect }} />
            </div>
            <div className="sc-review-shelf">
              <div className="sc-mini" style={{ width: 16, height: 96, background: '#5b3a2c' }} />
              <div className="sc-mini" style={{ width: spineWidth(book), height: photoHeight(book, shot.aspect) }}>
                <img src={shot.url} alt="" />
              </div>
              <div className="sc-mini" style={{ width: 22, height: 96, background: '#2f4a3f' }} />
              <div className="sc-board" />
            </div>
            <div className="sc-bar">
              <button className="sc-side" onClick={() => setShot(null)}><u>↺</u>Neu</button>
              <button className="sc-shut sc-ok" onClick={confirm} aria-label="Übernehmen" disabled={saving}>
                <i>✓</i>
              </button>
              <span className="sc-side" />
            </div>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickGallery} />
    </div>
  )
}
