import { useEffect, useRef, useState } from 'react'
import { STATUS, setProgress, markFinished, updateBook, deleteBook, db } from '../lib/db'
import { languageName } from '../lib/metadata'
import { Cover, useCoverSrc } from './ui'
import BookForm from './BookForm'
import { useBackLayer } from '../lib/backStack'
import BookNotes from './BookNotes'
import ReadingHistory from './ReadingHistory'
import SessionLog from './SessionLog'
import FinishCelebration from './FinishCelebration'
import BookBlurb from './BookBlurb'

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
    readBefore: book.readBefore
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
  useBackLayer(editing, () => setEditing(false))
  useBackLayer(coverZoomed, () => setCoverZoomed(false))
  const coverSrc = useCoverSrc(book)
  // Nach dem Sichern (oder wenn sich der Stand von außen ändert) das Feld nachziehen.
  useEffect(() => { setDraftPage(String(local.currentPage)) }, [local.currentPage])

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
    setProgress(book, clamped).catch(() => notify('Speichern hat nicht geklappt.'))
  }

  // Entwurf der Seitenzahl: geklemmt auf 0 … Seitenzahl des Buchs
  const clampPage = (n) => Math.max(0, Math.min(Math.round(n), book.pages || Math.round(n)))
  const draftNum = draftPage === '' ? NaN : Number(draftPage)
  const draftValid = !Number.isNaN(draftNum)
  const target = draftValid ? clampPage(draftNum) : page
  const pageDelta = target - page
  const dirty = draftValid && target !== page

  function savePage() {
    if (!dirty) return
    commitPage(target)
    notify(pageDelta > 0 ? `+${pageDelta} ${pageDelta === 1 ? 'Seite' : 'Seiten'} gemerkt` : 'Seite gemerkt')
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
            <span className={`badge ${local.status}`}>{STATUS[local.status]}</span>
          </div>
          <BookBlurb title={book.title} text={book.description} />
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
          <div className="pg">
            <div className="pg-top">
              <span>Seite <b>{page}</b>{book.pages ? ` von ${book.pages}` : ''}</span>
              {book.pages ? <span>{pct} %</span> : null}
            </div>
            {book.pages ? (
              <div className="pg-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
            ) : null}

            <div className="pg-entry">
              <input
                className="pg-input"
                type="number" inputMode="numeric" min="0" max={book.pages || undefined}
                value={draftPage}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDraftPage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { savePage(); e.target.blur() } }}
                aria-label="Aktuelle Seite"
              />
              <button className="btn btn-primary" onClick={savePage} disabled={!dirty}>
                {dirty && pageDelta > 0 ? `Speichern · +${pageDelta}` : 'Speichern'}
              </button>
            </div>
          </div>

          <button className="btn btn-block" style={{ marginTop: 10 }} onClick={finishBook} disabled={finishing}>
            {finishing ? <span className="spinner" /> : 'Fertig gelesen'}
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

          <button className="btn" style={{ marginTop: 8 }} onClick={() => apply(
            { status: 'owned', finishedAt: null },
            'Zurück ins Regal'
          )}>Doch nicht fertig</button>
        </>
      )}

      <ReadingHistory book={book} />

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
