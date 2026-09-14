import { useEffect, useRef, useState } from 'react'
import {
  openCamera, stopCamera, startDetection, torchSupported, setTorch, hasNativeDetector
} from '../lib/scanner'
import {
  lookupIsbn, isBookBarcode, toIsbn13, fetchCoverBlob, dominantColor
} from '../lib/metadata'
import { findByIsbn, emptyBook } from '../lib/db'

export default function Scan({ onFound, onExisting, onManual, onWishlist, notify, sheetOpen, onBulk }) {
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
  const [retryIsbn, setRetryIsbn] = useState(null)
  const [continuous, setContinuous] = useState(
    () => localStorage.getItem('libri:continuousScan') === '1'
  )

  useEffect(() => {
    hasNativeDetector().then((n) => setEngine(n ? 'nativ' : 'ZXing'))
    return () => teardown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fortlaufendes Scannen: Sobald das Formular oder die Detailansicht über
  // diesem Bildschirm wieder zugeht, hier die Kamera von selbst neu starten,
  // statt jedes Mal erneut "Kamera starten" antippen zu müssen.
  const prevSheetOpen = useRef(sheetOpen)
  useEffect(() => {
    const wasOpen = prevSheetOpen.current
    prevSheetOpen.current = sheetOpen
    if (wasOpen && !sheetOpen && continuous && state === 'idle') {
      start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen, continuous])

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

    // Absicherung: Sollte der Abruf wider Erwarten hängen bleiben, darf der
    // Bildschirm nicht dauerhaft im Suchzustand feststecken.
    const guard = setTimeout(() => {
      if (busyRef.current) {
        busyRef.current = false
        setState('idle')
        notify('Das hat zu lange gedauert. Nochmal versuchen?')
      }
    }, 20000)

    await resolveIsbn(raw)
    clearTimeout(guard)
    busyRef.current = false
    setState('idle')
  }

  async function resolveIsbn(raw) {
    setRetryIsbn(null)
    try {
      const isbn = toIsbn13(raw)
      const existing = await findByIsbn(isbn)
      if (existing) {
        onExisting(existing)
        return
      }

      let opened = false

      // Wird erfüllt, sobald alle Quellen durch sind und das Cover geladen ist.
      // Bewusst vorab angelegt, damit das Formular es schon mitbekommen kann,
      // bevor überhaupt eine Quelle geantwortet hat.
      let settle
      const completion = new Promise((res) => { settle = res })

      const enrichment = lookupIsbn(raw, {
        onPartial: (partial) => {
          if (opened) return
          opened = true
          onFound(
            emptyBook({
              isbn13: partial.isbn13,
              title: partial.title,
              subtitle: partial.subtitle,
              authors: partial.authors,
              publisher: partial.publisher,
              year: partial.year,
              pages: partial.pages,
              language: partial.language,
              coverUrl: partial.coverUrl,
              tags: partial.categories || [],
              series: partial.series || '',
              seriesIndex: partial.seriesIndex ?? null,
              source: 'wird ergänzt…'
            }),
            false,
            completion
          )
        }
      })

      enrichment
        .then(async (meta) => {
          if (meta.notFound) return null
          let coverBlob = await fetchCoverBlob(meta.coverUrl)
          if (!coverBlob) coverBlob = await fetchCoverBlob(meta.fallbackCoverUrl)
          const spineColor = await dominantColor(coverBlob)
          return {
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
            tags: meta.categories || [],
          series: meta.series || '',
          seriesIndex: meta.seriesIndex ?? null,
            source: meta.source
          }
        })
        .catch(() => null)
        .then(settle) // scheitert die Ergänzung, wartet das Formular nicht endlos

      const meta = await enrichment

      // Keine Quelle hatte einen Titel: leeres Formular mit vorausgefüllter ISBN.
      if (!opened) {
        if (meta.notFound) {
          if (meta.unreliable) {
            // Anfragen sind fehlgeschlagen — das Buch ist womöglich sehr wohl
            // bekannt. Nicht behaupten, es gäbe es nicht.
            busyRef.current = false
            setState('idle') // erst den Suchzustand beenden, dann die Meldung
            setRetryIsbn(meta.isbn13)
            return
          }
          onFound(emptyBook({ isbn13: meta.isbn13, source: 'manual' }), true)
        } else {
          const done = await completion
          onFound(emptyBook({ isbn13: meta.isbn13, ...(done || {}) }), false)
        }
      }
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

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="wordmark">Scannen</h1>
        {engine && <span className="count">{engine}</span>}
      </div>

      {error && <div className="notice warn"><p>{error}</p></div>}

      <label className="continuous-toggle">
        <input
          type="checkbox"
          checked={continuous}
          onChange={(e) => {
            setContinuous(e.target.checked)
            localStorage.setItem('libri:continuousScan', e.target.checked ? '1' : '0')
          }}
        />
        <span>
          Fortlaufend scannen
          <small>Kamera startet nach jedem Buch von selbst neu</small>
        </span>
      </label>

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

      {retryIsbn && (
        <div className="notice warn">
          <p>
            Die Abfrage für <b>{retryIsbn}</b> ist fehlgeschlagen — das heißt
            nicht, dass das Buch unbekannt ist. Meist ist es nur eine kurzzeitige
            Drosselung der Datenquelle.
          </p>
          <button className="btn btn-primary" onClick={() => resolveIsbn(retryIsbn)}>
            Nochmal versuchen
          </button>
        </div>
      )}

      <h2>ISBN eintippen</h2>
      <div className="progress">
        <input
          className="search"
          style={{ flex: 1, width: 'auto', marginBottom: 0 }}
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

      <h2>Mehrere auf einmal</h2>
      <p className="hint" style={{ textAlign: 'left', margin: '0 0 10px' }}>
        Ganze Reihe oder alles von einem Autor auf einmal aufnehmen, ohne jedes
        Buch einzeln zu scannen.
      </p>
      <button className="btn btn-block" onClick={onBulk}>Mehrfach-Import öffnen</button>

      <p className="hint" style={{ textAlign: 'left', marginTop: 20 }}>
        Kein Barcode auf dem Buch?{' '}
        <button className="btn btn-quiet" style={{ padding: '2px 6px' }} onClick={onManual}>
          Von Hand anlegen
        </button>
      </p>
      <p className="hint" style={{ textAlign: 'left', marginTop: 4 }}>
        Noch nicht im Besitz?{' '}
        <button className="btn btn-quiet" style={{ padding: '2px 6px' }} onClick={onWishlist}>
          Auf die Wunschliste
        </button>
      </p>
    </div>
  )
}
