import { useEffect, useRef, useState } from 'react'
import {
  openCamera, stopCamera, startDetection, torchSupported, setTorch, hasNativeDetector
} from '../lib/scanner'
import {
  lookupIsbn, isBookBarcode, toIsbn13, fetchCoverBlob, dominantColor, searchBooksByText
} from '../lib/metadata'
import { findByIsbn, emptyBook } from '../lib/db'

export default function Scan({ onFound, onExisting, onManual, notify }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const stopRef = useRef(null)
  const busyRef = useRef(false)
  const lastRef = useRef({ code: null, at: 0 })

  const [state, setState] = useState('idle') // idle | live | found
  const [error, setError] = useState(null)
  const [torchOn, setTorchOn] = useState(false)
  const [canTorch, setCanTorch] = useState(false)
  const [manualIsbn, setManualIsbn] = useState('')
  const [engine, setEngine] = useState('')
  const [forced, setForced] = useState(null)
  const [foundIsbn, setFoundIsbn] = useState(null)
  const [manualBusy, setManualBusy] = useState(false)
  const [textQuery, setTextQuery] = useState('')
  const [textResults, setTextResults] = useState(null)
  const [textBusy, setTextBusy] = useState(false)
  const [pickBusy, setPickBusy] = useState(null)

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
      stopRef.current = await startDetection(videoRef.current, handleCode, {
        force: forced,
        onEngine: setEngine
      })
    } catch (e) {
      setState('idle')
      if (e?.name === 'NotAllowedError') {
        setError(
          'Der Kamerazugriff ist blockiert. Als installierte App liegt das meist an ' +
          'Android selbst, nicht an Chrome: Einstellungen → Apps → Libri → ' +
          'Berechtigungen → Kamera → Zulassen. In einem normalen Chrome-Tab hilft ' +
          'stattdessen das Schloss-Symbol in der Adresszeile.'
        )
      } else if (e?.name === 'NotFoundError') {
        setError('Keine Kamera gefunden.')
      } else if (e?.name === 'NotReadableError') {
        setError('Eine andere App blockiert gerade die Kamera. Sie schließen und erneut versuchen.')
      } else {
        setError(
          `Die Kamera lässt sich nicht öffnen (${e?.name || 'Fehler'}: ${e?.message || 'unbekannt'}). ` +
          'Auf dem iPhone funktioniert das nur in Safari.'
        )
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
    navigator.vibrate?.(35)
    teardown() // Barcode sitzt — die Kamera muss dafür nicht länger laufen
    setFoundIsbn(toIsbn13(raw))
    setState('found')
    await resolveIsbn(raw)
    busyRef.current = false
    setState('idle')
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
    setManualBusy(true)
    await resolveIsbn(isbn)
    setManualIsbn('')
    setManualBusy(false)
  }

  async function submitTextSearch() {
    if (!textQuery.trim()) return
    setTextBusy(true)
    setTextResults(null)
    try {
      const results = await searchBooksByText(textQuery)
      setTextResults(results)
      if (!results.length) notify('Nichts gefunden. Vielleicht anders schreiben?')
    } catch {
      notify('Die Suche hat nicht geklappt.')
      setTextResults([])
    } finally {
      setTextBusy(false)
    }
  }

  async function pickResult(r) {
    setPickBusy(r.key)
    try {
      if (r.isbn13) {
        // Über die ISBN weiterreichen: prüft Duplikate und holt die volle,
        // aus mehreren Quellen zusammengeführte Beschreibung wie beim Scannen.
        await resolveIsbn(r.isbn13)
      } else {
        // Kein ISBN in den Suchergebnissen — Treffer direkt übernehmen.
        let coverBlob = await fetchCoverBlob(r.coverUrl)
        const spineColor = await dominantColor(coverBlob)
        onFound(
          emptyBook({
            isbn13: null,
            title: r.title,
            subtitle: r.subtitle,
            authors: r.authors,
            publisher: r.publisher,
            year: r.year,
            pages: r.pages,
            language: r.language,
            coverUrl: coverBlob ? null : r.coverUrl,
            coverBlob,
            spineColor,
            source: 'Google Books (Titelsuche)'
          }),
          false
        )
      }
      setTextResults(null)
      setTextQuery('')
    } finally {
      setPickBusy(null)
    }
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
        {state === 'live' && <div className="reticle" />}
        {state === 'idle' && (
          <div className="viewport-idle">
            <p>Halte den Barcode auf der Buchrückseite vor die Kamera.</p>
            <button className="btn btn-primary" onClick={start}>Kamera starten</button>
          </div>
        )}
        {state === 'found' && (
          <div className="viewport-idle scan-found">
            <span className="spinner" />
            <p className="scan-found-isbn">{foundIsbn}</p>
            <p>Erkannt — wird nachgeschlagen…</p>
          </div>
        )}
      </div>

      {state === 'live' && (
        <>
          <p className="hint">Barcode mittig halten. Erkennung läuft automatisch.</p>
          <div className="scan-tools">
            {canTorch && (
              <button className="btn" onClick={async () => {
                const ok = await setTorch(streamRef.current, !torchOn)
                if (ok) setTorchOn(!torchOn)
              }}>{torchOn ? 'Licht aus' : 'Licht an'}</button>
            )}
            <button className="btn" onClick={async () => {
              const next = engine === 'ZXing' ? 'native' : 'zxing'
              setForced(next)
              stopRef.current?.()
              stopRef.current = await startDetection(videoRef.current, handleCode, {
                force: next, onEngine: setEngine
              })
              notify(`Erkennung auf ${next === 'zxing' ? 'ZXing' : 'nativ'} umgestellt`)
            }}>Andere Erkennung</button>
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
        <button className="btn" onClick={submitManual} disabled={!manualIsbn || manualBusy}>
          {manualBusy ? <span className="spinner" /> : 'Suchen'}
        </button>
      </div>

      <h2>Titel oder Autor suchen</h2>
      <div className="progress">
        <input
          style={{ flex: 1, width: 'auto' }}
          placeholder="z. B. Dungeon Crawler Carl"
          value={textQuery}
          onChange={(e) => setTextQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitTextSearch()}
          aria-label="Titel oder Autor eingeben"
        />
        <button className="btn" onClick={submitTextSearch} disabled={!textQuery.trim() || textBusy}>
          {textBusy ? <span className="spinner" /> : 'Suchen'}
        </button>
      </div>

      {textResults && (
        <div className="search-results">
          {textResults.map((r) => (
            <button
              key={r.key}
              className="search-result"
              disabled={pickBusy !== null}
              onClick={() => pickResult(r)}
            >
              {r.thumb ? (
                <img src={r.thumb} alt="" />
              ) : (
                <span className="search-result-blank" />
              )}
              <span className="search-result-text">
                <span className="search-result-title">{r.title}</span>
                <span className="search-result-author">
                  {[r.authors?.[0], r.year].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              {pickBusy === r.key && <span className="spinner" />}
            </button>
          ))}
        </div>
      )}

      <p className="hint" style={{ textAlign: 'left' }}>
        Kein Barcode auf dem Buch?{' '}
        <button className="btn btn-quiet" style={{ padding: '2px 6px' }} onClick={onManual}>
          Von Hand anlegen
        </button>
      </p>
    </div>
  )
}
