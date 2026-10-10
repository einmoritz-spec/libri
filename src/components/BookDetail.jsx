import { useEffect, useRef, useState } from 'react'
import { STATUS, setProgress, markFinished, updateBook, deleteBook, expandReads, db } from '../lib/db'
import { languageName } from '../lib/metadata'
import { Cover, useCoverSrc } from './ui'
import BookForm from './BookForm'
import { useBackLayer } from '../lib/backStack'
import BookNotes from './BookNotes'
import ReadingHistory from './ReadingHistory'
import SessionLog from './SessionLog'
import FinishCelebration from './FinishCelebration'
import BookBlurb from './BookBlurb'
import { audioTotal, fmtHM, parseHM, fetchRuntime } from '../lib/audio'

export const FORMATS = { print: 'Buch', ebook: 'eBook', audio: 'Hörbuch' }

function RereadSheet({ initialFormat, initialLang, onStart, onClose }) {
  useBackLayer(true, onClose)
  const [fmt, setFmt] = useState(initialFormat)
  const [lang, setLang] = useState(initialLang)
  return (
    <div className="action-backdrop" onClick={onClose}>
      <div className="action-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="action-head"><h2>Nochmal lesen oder hören</h2></div>
        <p className="hint" style={{ textAlign: 'left', margin: '0 0 6px' }}>Wie?</p>
        <div className="filters-wrap" role="group" aria-label="Format">
          {Object.entries(FORMATS).map(([k, label]) => (
            <button key={k} className="chip" aria-pressed={fmt === k} onClick={() => setFmt(k)}>{label}</button>
          ))}
        </div>
        <p className="hint" style={{ textAlign: 'left', margin: '14px 0 6px' }}>Sprache</p>
        <div className="filters-wrap" role="group" aria-label="Sprache">
          {[['de', 'Deutsch'], ['en', 'Englisch']].map(([k, label]) => (
            <button key={k} className="chip" aria-pressed={lang === k} onClick={() => setLang(k)}>{label}</button>
          ))}
        </div>
        <button className="btn btn-primary btn-block" style={{ marginTop: 18 }}
          onClick={() => onStart({ format: fmt, lang })}>Starten</button>
      </div>
    </div>
  )
}

function FormatSheet({ current, onPick, onClose }) {
  useBackLayer(true, onClose)
  return (
    <div className="action-backdrop" onClick={onClose}>
      <div className="action-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="action-head"><h2>Wie gelesen?</h2></div>
        {Object.entries(FORMATS).map(([k, label]) => (
          <button key={k} className="action-row" onClick={() => onPick(k)}>
            <span>{label}{k === current ? ' ·  zuletzt' : ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* Zwischen ISO-Zeitstempel und dem, was ein Datumsfeld erwartet (JJJJ-MM-TT),
   umrechnen. Uhrzeit spielt für Lesedaten keine Rolle. */
function toDateInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fromDateInput(value) {
  if (!value) return null
  // Mittags ansetzen, damit Zeitzonen das Datum nicht um einen Tag verschieben.
  return new Date(`${value}T12:00:00`).toISOString()
}

function formatDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('de-DE', {
    day: 'numeric', month: 'long', year: 'numeric'
  })
}

export default function BookDetail({ book, onClose, notify, onAuthor }) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  /* Örtlicher Stand der Dinge. Alles, was angetippt wird, ändert zuerst diese
     Anzeige und wird erst danach im Hintergrund geschrieben. Vorher wartete
     die Oberfläche auf die Datenbank und anschließend darauf, dass die
     Bibliotheksabfrage neu durchläuft — bis dahin passierte sichtbar nichts,
     was sich wie Laden anfühlte. */
  const [local, setLocal] = useState({
    currentPage: book.currentPage || 0,
    status: book.status,
    rating: book.rating,
    startedAt: book.startedAt,
    finishedAt: book.finishedAt,
    datesConfirmed: book.datesConfirmed,
    readBefore: book.readBefore,
    format: book.format || null,
    ebookPages: book.ebookPages || null,
    reads: book.reads || [],
    readLanguage: book.readLanguage || null
  })

  // Änderungen von außen übernehmen, ohne gerade Getipptes zu überschreiben.
  const lastBook = useRef(book)
  useEffect(() => {
    if (lastBook.current === book) return
    lastBook.current = book
    setLocal((l) => ({
      currentPage: book.currentPage ?? l.currentPage,
      status: book.status,
      rating: book.rating,
      startedAt: book.startedAt,
      finishedAt: book.finishedAt,
      datesConfirmed: book.datesConfirmed,
      format: book.format || null,
      ebookPages: book.ebookPages || null,
      reads: book.reads || [],
      readLanguage: book.readLanguage || null
    }))
  }, [book])

  // Regler-Wert für die Anzeige während des Ziehens; geschrieben wird erst
  // per "Speichern" (Plus/Minus und Schnellwahl ändern nur den Entwurf).

  // Müssen vor jedem früheren return stehen — sonst ruft die Komponente je
  // nach Zustand (Bearbeiten an/aus) unterschiedlich viele Hooks auf, und
  // React bricht mit Fehler #300 ab.
  const [finishing, setFinishing] = useState(false)
  const [celebration, setCelebration] = useState(null)
  // Seiteneingabe: erst anpassen (Plus/Minus, Schnellwahl, tippen), dann einmal
  // sichern — dadurch entsteht genau eine Lesesitzung statt einer pro Antippen.
  const [draftPage, setDraftPage] = useState(String(book.currentPage || 0))
  const [coverZoomed, setCoverZoomed] = useState(false)
  const [pickFormat, setPickFormat] = useState(false)
  const [rereading, setRereading] = useState(false)
  const [setupTotal, setSetupTotal] = useState('')
  // Einheit der Eingabe am eReader: Prozent oder Seitenzahl des Geräts
  const [unit, setUnit] = useState(() => {
    try { return localStorage.getItem('libri:ebookUnit') === 'S' ? 'S' : '%' } catch { return '%' }
  })
  // Einheit der Eingabe beim Hörbuch: Zeit (h:mm) oder Prozent
  const [aunit, setAunit] = useState(() => {
    try { return localStorage.getItem('libri:audioUnit') === '%' ? '%' : 'T' } catch { return 'T' }
  })
  useBackLayer(editing, () => setEditing(false))
  useBackLayer(coverZoomed, () => setCoverZoomed(false))
  useBackLayer(pickFormat, () => setPickFormat(false))
  const coverSrc = useCoverSrc(book)
  // Nach dem Sichern (oder wenn sich der Stand von außen ändert) das Feld nachziehen.

  const clampPage = (n) => Math.max(0, Math.min(Math.round(n), book.pages || Math.round(n)))
  /* eBook-Modus: Die Seitenzahlen eines eReaders weichen vom gedruckten Buch
     ab. Eingegeben wird, was das Gerät zeigt (Prozent oder Geräte-Seite);
     gespeichert wird immer die Seite des gedruckten Buchs, damit Statistik
     und Tempo einheitlich bleiben. */
  const ebook = local.format === 'ebook' && !!book.pages
  // Hörbuch: nur Prozent, keine Seiten (intern trotzdem umgerechnet)
  const audio = local.format === 'audio' && !!book.pages
  const conv = ebook || audio
  const aTotal = audio ? audioTotal(book) : null
  const u = audio ? (aTotal ? aunit : '%') : unit
  const total = local.ebookPages
  const needTotal = ebook && u === 'S' && !total
  const scale = conv ? (u === 'S' ? total : u === 'T' ? aTotal.min : 100) : null
  const toPrint = (v) => (conv && scale ? clampPage((v / scale) * book.pages) : clampPage(v))
  const fromPrint = (p) => (conv && scale ? Math.round((p / book.pages) * scale) : p)
  const shown = fromPrint(local.currentPage || 0)
  const fmtUnit = (v) => (u === 'T' ? fmtHM(v) : String(v))
  const parseUnit = (str) => (u === 'T' ? parseHM(str) : (str === '' ? NaN : Number(str)))
  const shownStr = fmtUnit(shown)
  useEffect(() => { setDraftPage(shownStr) }, [shownStr, conv, u, total]) // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    return (
      <BookForm
        draft={book}
        title="Buch bearbeiten"
        submitLabel="Speichern"
        onCancel={() => setEditing(false)}
        onSave={async (data) => {
          const { id, ...changes } = data
          setEditing(false)
          notify('Gespeichert')
          updateBook(book.id, changes).catch(() =>
            notify('Speichern hat nicht geklappt.')
          )
        }}
      />
    )
  }

  const readingDays = local.startedAt && local.finishedAt
    ? Math.max(0, Math.round(
        (new Date(local.finishedAt) - new Date(local.startedAt)) / 86400000))
    : null

  const page = local.currentPage
  const pct = book.pages ? Math.min(100, Math.round((page / book.pages) * 100)) : 0

  /** Tatsächlich schreiben — erzeugt genau eine Lesesitzung. Wird nur beim
      Loslassen des Reglers, per Zahleneingabe-Knopf oder bei den
      Sprung-Knöpfen aufgerufen, nie bei jeder Zwischenposition. */
  function commitPage(value) {
    const clamped = Math.max(0, Math.min(value, book.pages || value))
    setLocal((l) => ({ ...l, currentPage: clamped }))
    setProgress({ ...book, format: local.format || book.format || null }, clamped).catch(() => notify('Speichern hat nicht geklappt.'))
  }

  // Entwurf der Seitenzahl: geklemmt auf 0 … Seitenzahl des Buchs
  const draftNum = draftPage === '' ? NaN : parseUnit(draftPage)
  const draftValid = !Number.isNaN(draftNum) && !needTotal
  const target = draftValid ? toPrint(draftNum) : page
  const pageDelta = target - page
  // Anzeige-Zuwachs in der Einheit der Eingabe (Prozent beim eReader/Hörbuch)
  const unitDelta = conv ? Math.round(draftNum - shown) : pageDelta
  const dirty = draftValid && draftPage !== shownStr && target !== page

  function savePage() {
    if (!dirty) return
    commitPage(target)
    if (audio) notify(unitDelta > 0 ? `+${u === 'T' ? `${fmtHM(unitDelta)} h` : `${unitDelta} %`} gemerkt` : 'Fortschritt gemerkt')
    else notify(pageDelta > 0 ? `+${pageDelta} ${pageDelta === 1 ? 'Seite' : 'Seiten'} gemerkt` : 'Seite gemerkt')
  }

  /** Neuen Durchgang beginnen: der bisherige wandert in `reads`, das Buch
      steht wieder auf „Lese ich“ mit Seite 0. */
  function startReread({ format, lang }) {
    const previous = {
      startedAt: local.startedAt || null,
      finishedAt: local.finishedAt || null,
      rating: local.rating || null,
      format: local.format || null,
      language: local.readLanguage || book.language || null,
      datesConfirmed: !!local.datesConfirmed,
      readBefore: !!local.readBefore
    }
    setRereading(false)
    apply({
      reads: [...(local.reads || []), previous],
      status: 'reading',
      currentPage: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      rating: null,
      datesConfirmed: false,
      readBefore: false,
      format,
      readLanguage: lang === (book.language || 'de') ? null : lang
    }, 'Neuer Durchgang gestartet')
  }

  function apply(changes, message) {
    setLocal((l) => ({ ...l, ...changes }))
    if (message) notify(message)
    updateBook(book.id, changes).catch(() => notify('Speichern hat nicht geklappt.'))
  }

  async function finishBook(format) {
    const celebrateOn = localStorage.getItem('libri:celebrate') !== '0'
    if (!celebrateOn) {
      notify('Als gelesen abgelegt')
      onClose()
      markFinished(book, format).catch(() => notify('Speichern hat nicht geklappt.'))
      return
    }

    setFinishing(true)
    try {
      await markFinished(book, format)
      const year = new Date().getFullYear()
      const readThisYear = await db.books.toArray()
        .then((all) => expandReads(all).filter((b) => b.status === 'read' && b.finishedAt?.slice(0, 4) === String(year)).length)
      setLocal((l) => ({ ...l, status: 'read', format, finishedAt: new Date().toISOString() }))
      setCelebration({ nth: readThisYear })
    } catch {
      notify('Speichern hat nicht geklappt.')
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="sheet">
      {rereading && (
        <RereadSheet
          initialFormat={local.format || 'print'}
          initialLang={['de', 'en'].includes(local.readLanguage || book.language) ? (local.readLanguage || book.language) : 'de'}
          onStart={startReread} onClose={() => setRereading(false)} />
      )}
      {pickFormat && (
        <FormatSheet current={local.format || book.format}
          onClose={() => setPickFormat(false)}
          onPick={(f) => { setPickFormat(false); finishBook(f) }} />
      )}
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onClose}>Zurück</button>
        <button className="btn btn-quiet" onClick={() => setEditing(true)}>Bearbeiten</button>
      </div>

      <div className="detail-head">
        {coverSrc ? (
          <button className="detail-cover-btn" onClick={() => setCoverZoomed(true)}
            aria-label="Cover vergrößern">
            <Cover book={book} />
          </button>
        ) : (
          <Cover book={book} />
        )}
        <div className="detail-info">
          <div>
            <h1 className="detail-title">{book.title}</h1>
            {book.subtitle && <p className="detail-author">{book.subtitle}</p>}
            <p className="detail-author">
              {book.authors?.length ? book.authors.map((a, i) => (
                <span key={a}>
                  {i > 0 && ', '}
                  {onAuthor ? (
                    <button className="author-link" onClick={() => onAuthor(a)}>{a}</button>
                  ) : a}
                </span>
              )) : 'Autor unbekannt'}
            </p>
            {book.series && (
              <p className="detail-author">
                {book.series}{book.seriesIndex ? ` · Band ${book.seriesIndex}` : ''}
              </p>
            )}
            {book.subseries && (
              <p className="detail-author">
                {book.subseries}{book.subseriesIndex ? ` · Band ${book.subseriesIndex}` : ''}
              </p>
            )}
            <span className={`badge ${local.status}`}>{STATUS[local.status]}{local.reads?.length ? (local.status === 'read' ? ` · ${local.reads.length + 1}×` : ` · ${local.reads.length + 1}. Mal`) : ''}</span>
          </div>
          <BookBlurb title={book.title} text={book.description} />
        </div>
      </div>

      <div className="facts">
        {local.format === 'audio' && audioTotal(book)
          ? <span><b>{audioTotal(book).est ? 'ca. ' : ''}{fmtHM(audioTotal(book).min)}</b> h</span>
          : book.pages && <span><b>{book.pages}</b> Seiten</span>}
        {local.status !== 'wishlist' && (
          <button className="fmt-chip" aria-label="Format wechseln"
            onClick={() => {
              const order = ['print', 'ebook', 'audio']
              const next = order[(order.indexOf(local.format || 'print') + 1) % 3]
              apply({ format: next }, FORMATS[next])
              // Beim Wechsel auf Hörbuch die echte Laufzeit still im Hintergrund holen
              if (next === 'audio' && !(book.audioMinutes > 0) && !book.audioTried) {
                fetchRuntime(book, local.readLanguage || book.language)
                  .then((r) => (r.minutes
                    ? updateBook(book.id, { audioMinutes: r.minutes })
                    : r.notFound ? updateBook(book.id, { audioTried: true }) : null))
                  .catch(() => {})
              }
            }}>{FORMATS[local.format || 'print']}</button>
        )}
        {book.language && <span>{languageName(local.readLanguage || book.language)}</span>}
        {book.year && <span>{book.year}</span>}
        {book.publisher && <span>{book.publisher}</span>}
      </div>

      {local.status === 'wishlist' && (
        <>
          <h2>Auf der Wunschliste</h2>
          <p className="hint" style={{ textAlign: 'left', margin: '0 0 14px' }}>
            Noch nicht im Regal. Sobald du es hast, einfach umbuchen.
          </p>
          <button className="btn btn-primary" onClick={() => apply(
            { status: 'owned' },
            'Ab ins Regal'
          )}>Jetzt besorgt</button>
        </>
      )}

      {local.status !== 'read' && local.status !== 'wishlist' && (
        <>
          <div className="pg">
            <div className="pg-top">
              {audio && aTotal && u === 'T' ? (
                <span><b>{fmtHM((pct / 100) * aTotal.min)}</b> von {aTotal.est ? 'ca. ' : ''}{fmtHM(aTotal.min)} h gehört</span>
              ) : audio ? <span><b>{pct} %</b> gehört</span> : (
                <span>Seite <b>{page}</b>{book.pages ? ` von ${book.pages}` : ''}</span>
              )}
              {book.pages && (!audio || u === 'T') ? <span>{pct} %</span> : null}
            </div>
            {book.pages ? (
              <div className="pg-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
            ) : null}

            {needTotal && (
              <div className="pg-entry" style={{ marginTop: 12 }}>
                <input className="pg-input" type="number" inputMode="numeric" min="1"
                  placeholder="Seiten im eReader" value={setupTotal}
                  onChange={(e) => setSetupTotal(e.target.value)} aria-label="Seiten im eReader" />
                <button className="btn btn-primary" disabled={!(Number(setupTotal) > 0)}
                  onClick={() => { apply({ ebookPages: Math.round(Number(setupTotal)) }); setSetupTotal('') }}>
                  Merken
                </button>
              </div>
            )}
            {!needTotal && (
              <div className="pg-entry">
                <div className="pg-field">
                  <input
                    className="pg-input"
                    type={u === 'T' ? 'text' : 'number'} inputMode={u === 'T' ? 'decimal' : 'numeric'} min="0"
                    max={conv && u !== 'T' ? scale : u === 'T' ? undefined : book.pages || undefined}
                    placeholder={u === 'T' ? 'h:mm' : undefined}
                    value={draftPage}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setDraftPage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { savePage(); e.target.blur() } }}
                    aria-label={conv ? (u === 'S' ? 'Seite im eReader' : u === 'T' ? 'Gehörte Zeit' : 'Fortschritt in Prozent') : 'Aktuelle Seite'}
                  />
                  {audio && (
                    aTotal ? (
                      <button className="pg-unit" aria-label="Einheit wechseln"
                        onClick={() => {
                          const next = aunit === 'T' ? '%' : 'T'
                          setAunit(next)
                          try { localStorage.setItem('libri:audioUnit', next) } catch { /* egal */ }
                        }}>{aunit === 'T' ? 'h' : '%'}</button>
                    ) : <span className="pg-unit">%</span>
                  )}
                  {ebook && (
                    <button className="pg-unit" aria-label="Einheit wechseln"
                      onClick={() => {
                        const next = unit === 'S' ? '%' : 'S'
                        setUnit(next)
                        try { localStorage.setItem('libri:ebookUnit', next) } catch { /* egal */ }
                      }}>{unit === 'S' ? 'S.' : '%'}</button>
                  )}
                </div>
                <button className="btn btn-primary" onClick={savePage} disabled={!dirty}>
                  {dirty && unitDelta > 0 ? `Speichern · +${u === 'T' ? fmtHM(unitDelta) : unitDelta}${u === 'T' ? '' : (audio || (u === '%' && ebook)) ? ' %' : ''}` : 'Speichern'}
                </button>
              </div>
            )}
          </div>

          <button className="btn btn-block" style={{ marginTop: 10 }} onClick={() => (local.format ? finishBook(local.format) : setPickFormat(true))} disabled={finishing}>
            {finishing ? <span className="spinner" /> : (audio || local.format === 'audio' ? 'Fertig gehört' : 'Fertig gelesen')}
          </button>
          {local.status !== 'reading' && (
            <button className="btn btn-quiet" style={{ marginTop: 6, padding: '6px 4px' }}
              onClick={() => apply(
                { status: 'reading', startedAt: book.startedAt || new Date().toISOString() },
                'Steht jetzt auf „Lese ich“'
              )}>Jetzt lesen</button>
          )}
        </>
      )}

      {local.status === 'read' && (
        <>
          <h2>Bewertung</h2>
          <div className="rating-row" role="group" aria-label="Bewertung von 1 bis 10">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button key={n} className="rating-btn" aria-pressed={n === local.rating}
                onClick={() => apply({ rating: n === local.rating ? null : n })}>
                {n}
              </button>
            ))}
          </div>
          <h2>Gelesen von … bis</h2>
          <div className="field-pair">
            <div className="field">
              <label htmlFor="d-start">Angefangen</label>
              <input id="d-start" type="date" max={toDateInput(local.finishedAt) || undefined}
                value={toDateInput(local.startedAt)}
                onChange={(e) => apply({
                  startedAt: fromDateInput(e.target.value), datesConfirmed: true, readBefore: false
                })} />
            </div>
            <div className="field">
              <label htmlFor="d-end">Beendet</label>
              <input id="d-end" type="date"
                value={toDateInput(local.finishedAt)}
                onChange={(e) => apply({
                  finishedAt: fromDateInput(e.target.value), datesConfirmed: true, readBefore: false
                })} />
            </div>
          </div>
          {readingDays !== null && (
            <p className="hint" style={{ textAlign: 'left', marginTop: -4 }}>
              {readingDays === 0 ? 'An einem Tag gelesen' : `${readingDays} Tage gelesen`}
              {book.pages && readingDays > 0
                ? ` · ${Math.round(book.pages / (readingDays + 1))} Seiten am Tag`
                : ''}
            </p>
          )}

          {local.finishedAt && !local.datesConfirmed && (
            <div className="notice" style={{ marginTop: 10 }}>
              <p>
                Dieses Datum wurde automatisch beim Abhaken gesetzt und zählt
                deshalb noch nicht in der Statistik — sonst würden mehrere an
                einem Tag nachgetragene Bücher die Zahlen verfälschen.
              </p>
              <button className="btn btn-primary" onClick={() => apply(
                { datesConfirmed: true },
                'Zählt jetzt in der Statistik'
              )}>Datum stimmt — für Statistik übernehmen</button>
            </div>
          )}

          {!(local.finishedAt && local.datesConfirmed) && (
            <button className="btn btn-quiet" style={{ marginTop: 8 }}
              onClick={() => apply({ readBefore: !local.readBefore })}>
              {local.readBefore ? '✓ Vor dem Tracking gelesen' : 'Vor dem Tracking gelesen'}
            </button>
          )}

          <button className="btn" style={{ marginTop: 8 }} onClick={() => setRereading(true)}>
            Nochmal lesen oder hören
          </button>

          <button className="btn btn-quiet" style={{ marginTop: 8 }} onClick={() => apply(
            { status: 'owned', finishedAt: null },
            'Zurück ins Regal'
          )}>Doch nicht fertig</button>
        </>
      )}

      {local.reads?.length > 0 && (
        <>
          <h2>Frühere Durchgänge</h2>
          <div className="facts-list">
            {local.reads.map((r, i) => (
              <div className="fact-row" key={i}>
                <span>{r.finishedAt
                  ? new Date(r.finishedAt).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
                  : 'Früher'}</span>
                <b>{FORMATS[r.format || 'print']}{r.language ? ` · ${languageName(r.language)}` : ''}</b>
              </div>
            ))}
          </div>
        </>
      )}

      {local.format !== 'audio' && <ReadingHistory book={book} />}

      <SessionLog book={book} notify={notify} />

      <BookNotes book={book} notify={notify} />

      {confirmDelete ? (
        <div className="notice warn" style={{ marginTop: 28 }}>
          <p>„{book.title}“ wird endgültig aus der Bibliothek gelöscht.</p>
          <div className="btn-row">
            <button className="btn btn-danger" onClick={() => {
              notify('Gelöscht')
              onClose()
              deleteBook(book.id).catch(() => notify('Löschen hat nicht geklappt.'))
            }}>Endgültig löschen</button>
            <button className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
              Behalten
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-danger" style={{ marginTop: 28 }} onClick={() => setConfirmDelete(true)}>
          Aus der Bibliothek löschen
        </button>
      )}

      {celebration && (
        <FinishCelebration
          book={{ ...book, ...local }}
          nth={celebration.nth}
          notify={notify}
          onRate={(n) => apply({ rating: n })}
          onDone={() => { setCelebration(null); onClose() }}
        />
      )}

      {coverZoomed && coverSrc && (
        <div className="cover-zoom" onClick={() => setCoverZoomed(false)}>
          <img src={coverSrc} alt={`Cover von ${book.title}`} />
        </div>
      )}
    </div>
  )
}
