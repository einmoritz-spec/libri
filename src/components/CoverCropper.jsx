import { useEffect, useRef, useState } from 'react'

/* Zuschnitt auf Buchformat 2:3. Das Bild wird per CSS verschoben und skaliert,
   beim Bestätigen wird der sichtbare Ausschnitt auf ein Canvas gezeichnet.
   Ausgabe: 600×900 JPEG — scharf genug für die Detailansicht, klein genug,
   dass auch ein paar hundert Cover in die Sicherungsdatei passen. */

const OUT_W = 600
const OUT_H = 900
const WORK_EDGE = 1400 // Arbeitsgröße fürs Ziehen/Zoomen — Kamerafotos sind oft 10+ MP

/** Verkleinert große Fotos vor der Bearbeitung, damit Ziehen/Zoomen flüssig bleibt. */
async function prepareSource(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const longEdge = Math.max(bitmap.width, bitmap.height)
    if (longEdge <= WORK_EDGE) {
      bitmap.close?.()
      return file
    }
    const scale = WORK_EDGE / longEdge
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
    return blob || file
  } catch {
    return file // im Zweifel unverändert weiterreichen, statt abzubrechen
  }
}

export default function CoverCropper({ file, onDone, onCancel }) {
  const frameRef = useRef(null)
  const imgRef = useRef(null)
  const [src, setSrc] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  const drag = useRef(null)
  const pinch = useRef(null)

  useEffect(() => {
    let url = null
    let cancelled = false
    prepareSource(file).then((working) => {
      if (cancelled) return
      url = URL.createObjectURL(working)
      setSrc(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  function metrics() {
    const frame = frameRef.current
    const img = imgRef.current
    if (!frame || !img?.naturalWidth) return null
    const fw = frame.clientWidth
    const fh = frame.clientHeight
    // "Fit" statt "Cover": bei Zoom 1 ist das ganze Foto sichtbar, nicht schon
    // ausschnitthaft hineingezoomt. Reinzoomen und den Bildausschnitt wählen
    // ist damit eine bewusste Handlung, kein erzwungener Startzustand.
    const base = Math.min(fw / img.naturalWidth, fh / img.naturalHeight)
    const scale = base * zoom
    return {
      fw, fh, base, scale,
      dispW: img.naturalWidth * scale,
      dispH: img.naturalHeight * scale
    }
  }

  /** Verhindert, dass beim Schieben weiße Ränder in den Ausschnitt geraten. */
  function clamp(next, m) {
    const maxX = Math.max(0, (m.dispW - m.fw) / 2)
    const maxY = Math.max(0, (m.dispH - m.fh) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y))
    }
  }

  useEffect(() => {
    const m = metrics()
    if (m) setPos((p) => clamp(p, m))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, ready])

  function onPointerDown(e) {
    if (e.pointerType === 'touch' && e.isPrimary === false) return
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    if (!drag.current || pinch.current) return
    const m = metrics()
    if (!m) return
    setPos(clamp({
      x: drag.current.ox + (e.clientX - drag.current.sx),
      y: drag.current.oy + (e.clientY - drag.current.sy)
    }, m))
  }

  function onPointerUp() {
    drag.current = null
  }

  function dist(t) {
    const dx = t[0].clientX - t[1].clientX
    const dy = t[0].clientY - t[1].clientY
    return Math.hypot(dx, dy)
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      drag.current = null
      pinch.current = { d: dist(e.touches), z: zoom }
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 2 && pinch.current) {
      e.preventDefault()
      const factor = dist(e.touches) / pinch.current.d
      setZoom(Math.min(6, Math.max(1, pinch.current.z * factor)))
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) pinch.current = null
  }

  async function confirm() {
    const m = metrics()
    const img = imgRef.current
    if (!m || !img) return
    setBusy(true)
    try {
      const left = m.fw / 2 - m.dispW / 2 + pos.x
      const top = m.fh / 2 - m.dispH / 2 + pos.y
      const sx = -left / m.scale
      const sy = -top / m.scale
      const sw = m.fw / m.scale
      const sh = m.fh / m.scale

      const canvas = document.createElement('canvas')
      canvas.width = OUT_W
      canvas.height = OUT_H
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H)

      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
      if (blob) onDone(blob)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet cropper-sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onCancel}>Abbrechen</button>
        <button className="btn btn-primary" onClick={confirm} disabled={!ready || busy}>
          {busy ? 'Schneidet…' : 'Übernehmen'}
        </button>
      </div>

      <h2 style={{ marginTop: 0 }}>Cover zuschneiden</h2>

      <div
        className="crop-frame"
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {src ? (
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable="false"
            onLoad={() => setReady(true)}
            style={{
              transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${zoom})`
            }}
          />
        ) : (
          <div className="crop-loading"><span className="spinner" /></div>
        )}
      </div>

      <label className="crop-zoom">
        <span>Größe</span>
        <input
          type="range" min="1" max="6" step="0.01"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
        />
      </label>

      <p className="hint">
        Ganzes Foto sichtbar — hineinzoomen und verschieben, bis nur das Cover im Rahmen steht.
      </p>
    </div>
  )
}
