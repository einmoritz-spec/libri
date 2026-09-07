import { useEffect, useRef, useState } from 'react'
import {
  openCamera, stopCamera, startDetection, torchSupported, setTorch, hasNativeDetector
} from '../lib/scanner'
import { lookupIsbn, isBookBarcode, toIsbn13, fetchCoverBlob, dominantColor } from '../lib/metadata'
import { findByIsbn, emptyBook } from '../lib/db'

export default function Scan({ onFound, onExisting, onManual, notify }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const stopRef = useRef(null)
  const busyRef = useRef(false)
  const lastRef = useRef({ code: null, at: 0 })

  const [state, setState] = useState('idle') // idle | live | busy
  const [error, setError] = useState(null)
  const [torchOn, setTorchOn] = useState(false)
  const [canTorch, setCanTorch] = useState(false)
  const [manualIsbn, setManualIsbn] = useState('')
  const [engine, setEngine] = useState('')

  useEffect(() => {
    hasNativeDetector().then((n) => setEngine(n ? 'nativ' : 'ZXing'))
    return () => teardown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function teardown() {
    stopRef.current?.()
    stopRef.current = null
    stopCamera(streamRef.current, videoRef.current)
    streamRef.current = null
  }

  async function start() {
    setError(null)
    try {
      const stream = await openCamera(videoRef.current)
      streamRef.current = stream
      setCanTorch(torchSupported(stream))
      setState('live')
      stopRef.current = await startDetection(videoRef.current, handleCode)
    } catch (e) {
      setState('idle')
      if (e?.name === 'NotAllowedError') {
        setError('Der Kamerazugriff ist blockiert. Erlaube ihn in den Browser-Einstellungen für diese Seite.')
      } else if (e?.name === 'NotFoundError') {
        setError('Keine Kamera gefunden.')
      } else {
        setError('Die Kamera lässt sich nicht öffnen. Auf dem iPhone funktioniert das nur in Safari.')
      }
    }
  }

  async function handleCode(raw) {
    const now = Date.now()
    if (busyRef.current) return
    if (lastRef.current.code === raw && now - lastRef.current.at < 4000) return
    lastRef.current = { code: raw, at: now }

    if (!isBookBarcode(raw)) return // Preis-Barcodes und Ähnliches ignorieren

    busyRef.current = true
    setState('busy')
    navigator.vibrate?.(35)
    await resolveIsbn(raw)
    busyRef.current = false
    if (streamRef.current) setState('live')
  }

  async function resolveIsbn(raw) {
    try {
      const isbn = toIsbn13(raw)
      const existing = await findByIsbn(isbn)
      if (existing) {
        onExisting(existing)
        return
      }

      const meta = await lookupIsbn(raw)
      if (meta.notFound) {
        onFound(emptyBook({ isbn13: meta.isbn13, source: 'manual' }), true)
        return
      }

      let coverBlob = await fetchCoverBlob(meta.coverUrl)
      if (!coverBlob) coverBlob = await fetchCoverBlob(meta.fallbackCoverUrl)
      const spineColor = await dominantColor(coverBlob)

      onFound(
        emptyBook({
          isbn13: meta.isbn13,
          title: meta.title,
          subtitle: meta.subtitle,
          authors: meta.authors,
          publisher: meta.publisher,
          year: meta.year,
          pages: meta.pages,
          language: meta.language,
          coverUrl: coverBlob ? null : meta.coverUrl,
          coverBlob,
          spineColor,
          source: meta.source
        }),
        false
      )
    } catch (e) {
      notify(e.message || 'Der Abruf hat nicht geklappt.')
    }
  }

  async function submitManual() {
    const isbn = toIsbn13(manualIsbn)
    if (!isbn) {
      notify('Diese ISBN stimmt nicht. 10 oder 13 Ziffern.')
      return
    }
    setState('busy')
    await resolveIsbn(isbn)
    setManualIsbn('')
    setState(streamRef.current ? 'live' : 'idle')
  }

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="wordmark">Scannen</h1>
        {engine && <span className="count">{engine}</span>}
      </div>

      {error && <div className="notice warn"><p>{error}</p></div>}

      {/* Das <video> bleibt immer im DOM — sonst hat openCamera kein Ziel zum Anhängen. */}
      <div className="viewport">
        <video ref={videoRef} muted playsInline />
        {state === 'live' || state === 'busy' ? (
          <div className="reticle" />
        ) : (
          <div className="viewport-idle">
            <p>Halte den Barcode auf der Buchrückseite vor die Kamera.</p>
            <button className="btn btn-primary" onClick={start}>Kamera starten</button>
          </div>
        )}
      </div>

      {(state === 'live' || state === 'busy') && (
        <>
          <p className="hint">
            {state === 'busy'
              ? <><span className="spinner" /> Buchdaten werden geholt…</>
              : 'Barcode mittig halten. Erkennung läuft automatisch.'}
          </p>
          <div className="scan-tools">
            {canTorch && (
              <button className="btn" onClick={async () => {
                const ok = await setTorch(streamRef.current, !torchOn)
                if (ok) setTorchOn(!torchOn)
              }}>{torchOn ? 'Licht aus' : 'Licht an'}</button>
            )}
            <button className="btn" onClick={() => { teardown(); setState('idle') }}>
              Kamera stoppen
            </button>
          </div>
        </>
      )}

      <h2>ISBN eintippen</h2>
      <div className="progress">
        <input
          style={{ flex: 1, width: 'auto' }}
          inputMode="numeric"
          placeholder="978…"
          value={manualIsbn}
          onChange={(e) => setManualIsbn(e.target.value)}
          aria-label="ISBN eingeben"
        />
        <button className="btn" onClick={submitManual} disabled={!manualIsbn}>Suchen</button>
      </div>

      <p className="hint" style={{ textAlign: 'left' }}>
        Kein Barcode auf dem Buch?{' '}
        <button className="btn btn-quiet" style={{ padding: '2px 6px' }} onClick={onManual}>
          Von Hand anlegen
        </button>
      </p>
    </div>
  )
}
