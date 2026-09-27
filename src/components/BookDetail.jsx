import { useEffect, useRef, useState } from 'react'
import { STATUS, setProgress, markFinished, updateBook, deleteBook, db } from '../lib/db'
import { languageName } from '../lib/metadata'
import { Cover, useCoverSrc } from './ui'
import BookForm from './BookForm'
import BookNotes from './BookNotes'
import ReadingHistory from './ReadingHistory'
import SessionLog from './SessionLog'
import FinishCelebration from './FinishCelebration'

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

export default function BookDetail({ book, onClose, notify }) {
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
    datesConfirmed: book.datesConfirmed
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
      datesConfirmed: book.datesConfirmed
    }))
  }, [book])

  // Regler-Wert für die Anzeige während des Ziehens; geschrieben wird erst
  // beim Loslassen (siehe sliderRef-Effekt unten) oder per "Seite merken".

  // Müssen vor jedem früheren return stehen — sonst ruft die Komponente je
  // nach Zustand (Bearbeiten an/aus) unterschiedlich viele Hooks auf, und
  // React bricht mit Fehler #300 ab.
  const [finishing, setFinishing] = useState(false)
  const [celebration, setCelebration] = useState(null)
  const sliderRef = useRef(null)
  // Feld für die Seitenzahl: beim Antippen leer zum Tippen, geschrieben wird
  // erst bei ausdrücklicher Bestätigung (Knopf oder Enter) — nie beim bloßen
  // Verlassen des Felds. Müssen ebenfalls vor jedem früheren return stehen.
  const [pageInputActive, setPageInputActive] = useState(false)
  const [pageInput, setPageInput] = useState('')
  const [coverZoomed, setCoverZoomed] = useState(false)
  const coverSrc = useCoverSrc(book)
  /* Reglers Commit läuft über das native "change"-Ereignis, nicht über
     Reacts onChange: Bei <input type="range"> verhält sich Reacts onChange
     wie das native "input"-Ereignis und feuert bei jeder Zwischenposition
     während des Ziehens — genau das erzeugte bisher pro Bewegung eine
     eigene Lesesitzung. Das native "change" feuert dagegen nur einmal, beim
     Loslassen oder nach einer Tastatur-Anpassung. commitPage ist unten als
     function-Deklaration definiert und dadurch schon hier nutzbar (Hoisting). */
  useEffect(() => {
    const el = sliderRef.current
    if (!el) return
    const onRelease = () => commitPage(Number(el.value))
    el.addEventListener('change', onRelease)
    return () => el.removeEventListener('change', onRelease)
  })

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

  /** Nur die Anzeige aktualisieren, ohne zu schreiben — für jede
      Zwischenposition beim Ziehen und für die Zifferneingabe. */
  function previewPage(value) {
    setLocal((l) => ({ ...l, currentPage: Math.max(0, Math.min(value, book.pages || value)) }))
  }

  /** Tatsächlich schreiben — erzeugt genau eine Lesesitzung. Wird nur beim
      Loslassen des Reglers, per Zahleneingabe-Knopf oder bei den
      Sprung-Knöpfen aufgerufen, nie bei jeder Zwischenposition. */
  function commitPage(value) {
    const clamped = Math.max(0, Math.min(value, book.pages || value))
    setLocal((l) => ({ ...l, currentPage: clamped }))
    setProgress(book, clamped).catch(() => notify('Speichern hat nicht geklappt.'))
  }

  /** Wertet das Eingabefeld aus und schreibt nur, wenn wirklich eine Zahl
      eingetippt wurde — leeres Feld oder bloßes Antippen ohne Eingabe lösen
      nichts aus. */
  function confirmPageInput() {
    if (pageInput.trim() === '') return
    const n = Number(pageInput)
    if (Number.isNaN(n)) return
    commitPage(n)
    notify('Seite gemerkt')
  }

  function apply(changes, message) {
    setLocal((l) => ({ ...l, ...changes }))
    if (message) notify(message)
    updateBook(book.id, changes).catch(() => notify('Speichern hat nicht geklappt.'))
  }

  async function finishBook() {
    const celebrateOn = localStorage.getItem('libri:celebrate') !== '0'
    if (!celebrateOn) {
      notify('Als gelesen abgelegt')
      onClose()
      markFinished(book).catch(() => notify('Speichern hat nicht geklappt.'))
      return
    }

    setFinishing(true)
    try {
      await markFinished(book)
      const year = new Date().getFullYear()
      const readThisYear = await db.books
        .where('status').equals('read').toArray()
        .then((list) => list.filter((b) => b.finishedAt?.slice(0, 4) === String(year)).length)
      setLocal((l) => ({ ...l, status: 'read', finishedAt: new Date().toISOString() }))
      setCelebration({ nth: readThisYear })
    } catch {
      notify('Speichern hat nicht geklappt.')
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="sheet">
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
        <div>
          <h1 className="detail-title">{book.title}</h1>
          {book.subtitle && <p className="detail-author">{book.subtitle}</p>}
          <p className="detail-author">{book.authors?.join(', ') || 'Autor unbekannt'}</p>
          {book.series && (
            <p className="detail-author">
              {book.series}{book.seriesIndex ? ` · Band ${book.seriesIndex}` : ''}
            </p>
          )}
          <span className={`badge ${local.status}`}>{STATUS[local.status]}</span>
        </div>
      </div>

      <div className="facts">
        {book.pages && <span><b>{book.pages}</b> Seiten</span>}
        {book.language && <span>{languageName(book.language)}</span>}
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
          <h2>Fortschritt</h2>
          {book.pages ? (
            <>
              <div className="track"><span style={{ width: `${pct}%` }} /></div>
              <p className="hint" style={{ textAlign: 'left', margin: '0 0 12px' }}>
                Seite {page} von {book.pages} — {pct}%
              </p>
              <input
                ref={sliderRef}
                className="page-slider"
                type="range" min="0" max={book.pages} value={page}
                onChange={(e) => previewPage(Number(e.target.value))}
                aria-label="Aktuelle Seite"
              />
              <p className="hint" style={{ textAlign: 'left', margin: '6px 0 0' }}>
                Schwer genau zu treffen? Seitenzahl unten eintippen und bestätigen.
              </p>
            </>
          ) : (
            <p className="hint" style={{ textAlign: 'left' }}>
              Ohne Seitenzahl gibt es keinen Fortschrittsbalken. Trag sie unter Bearbeiten nach.
            </p>
          )}

          <div className="progress" style={{ marginTop: 14 }}>
            <input
              type="number" inputMode="numeric" min="0" max={book.pages || undefined}
              value={pageInputActive ? pageInput : page}
              placeholder="Seite"
              onFocus={() => { setPageInputActive(true); setPageInput('') }}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => setPageInputActive(false)}
              onKeyDown={(e) => { if (e.key === 'Enter') { confirmPageInput(); e.target.blur() } }}
              aria-label="Seite eingeben"
            />
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={confirmPageInput}>
              Seite merken
            </button>
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={finishBook} disabled={finishing}>
              {finishing ? <span className="spinner" /> : 'Fertig gelesen'}
            </button>
            {local.status !== 'reading' && (
              <button className="btn" onClick={() => apply(
                { status: 'reading', startedAt: book.startedAt || new Date().toISOString() },
                'Steht jetzt auf „Lese ich“'
              )}>Jetzt lesen</button>
            )}
          </div>
        </>
      )}

      {local.status === 'read' && (
        <>
          <h2>Bewertung</h2>
          <div className="btn-row">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button key={n} className="btn btn-rating"
                style={n === local.rating
                  ? { borderColor: 'var(--lamp)', color: 'var(--lamp)' }
                  : undefined}
                onClick={() => apply({ rating: n === local.rating ? null : n })}>
                {n}
              </button>
            ))}
          </div>
          <h2>Gelesen von … bis</h2>
          <p className="hint" style={{ textAlign: 'left', margin: '0 0 10px' }}>
            Nachträglich anpassbar — wichtig für die Statistik, wenn du ein Buch
            schon vor längerem gelesen hast.
          </p>
          <div className="field-pair">
            <div className="field">
              <label htmlFor="d-start">Angefangen</label>
              <input id="d-start" type="date" max={toDateInput(local.finishedAt) || undefined}
                value={toDateInput(local.startedAt)}
                onChange={(e) => apply({
                  startedAt: fromDateInput(e.target.value), datesConfirmed: true
                })} />
            </div>
            <div className="field">
              <label htmlFor="d-end">Beendet</label>
              <input id="d-end" type="date"
                value={toDateInput(local.finishedAt)}
                onChange={(e) => apply({
                  finishedAt: fromDateInput(e.target.value), datesConfirmed: true
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

          <button className="btn" style={{ marginTop: 8 }} onClick={() => apply(
            { status: 'owned', finishedAt: null },
            'Zurück ins Regal'
          )}>Doch nicht fertig</button>
        </>
      )}

      <ReadingHistory book={book} />

      <SessionLog book={book} notify={notify} />

      <BookNotes book={book} notify={notify} />

      <h2>Entfernen</h2>
      {confirmDelete ? (
        <div className="notice warn">
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
        <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
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
