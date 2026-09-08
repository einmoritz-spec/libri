import { useEffect, useRef, useState } from 'react'
import { STATUS, setProgress, markFinished, updateBook, deleteBook } from '../lib/db'
import { languageName } from '../lib/metadata'
import { Cover } from './ui'
import BookForm from './BookForm'

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
    finishedAt: book.finishedAt
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
      finishedAt: book.finishedAt
    }))
  }, [book])

  const saveTimer = useRef(null)
  useEffect(() => () => clearTimeout(saveTimer.current), [])

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

  const page = local.currentPage
  const pct = book.pages ? Math.min(100, Math.round((page / book.pages) * 100)) : 0

  /** Sofort anzeigen, verzögert schreiben — beim Ziehen am Regler entsteht so
      nicht für jede Zwischenposition ein Datenbankzugriff. */
  function setPageValue(value, immediate = false) {
    setLocal((l) => ({ ...l, currentPage: value }))
    clearTimeout(saveTimer.current)
    const write = () =>
      setProgress(book, value).catch(() => notify('Speichern hat nicht geklappt.'))
    if (immediate) write()
    else saveTimer.current = setTimeout(write, 400)
  }

  function apply(changes, message) {
    setLocal((l) => ({ ...l, ...changes }))
    if (message) notify(message)
    updateBook(book.id, changes).catch(() => notify('Speichern hat nicht geklappt.'))
  }

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onClose}>Zurück</button>
        <button className="btn btn-quiet" onClick={() => setEditing(true)}>Bearbeiten</button>
      </div>

      <div className="detail-head">
        <Cover book={book} />
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

      {local.status !== 'read' && (
        <>
          <h2>Fortschritt</h2>
          {book.pages ? (
            <>
              <div className="track"><span style={{ width: `${pct}%` }} /></div>
              <p className="hint" style={{ textAlign: 'left', margin: '0 0 12px' }}>
                Seite {page} von {book.pages} — {pct}%
              </p>
              <input
                type="range" min="0" max={book.pages} value={page}
                onChange={(e) => setPageValue(Number(e.target.value))}
                style={{ width: '100%' }}
                aria-label="Aktuelle Seite"
              />
            </>
          ) : (
            <p className="hint" style={{ textAlign: 'left' }}>
              Ohne Seitenzahl gibt es keinen Fortschrittsbalken. Trag sie unter Bearbeiten nach.
            </p>
          )}

          <div className="progress" style={{ marginTop: 14 }}>
            <input
              type="number" inputMode="numeric" min="0" max={book.pages || undefined}
              value={page}
              onChange={(e) => setLocal((l) => ({ ...l, currentPage: Number(e.target.value) }))}
              aria-label="Seite eingeben"
            />
            <button className="btn" onClick={() => {
              setPageValue(page, true)
              notify('Seite gemerkt')
            }}>Seite merken</button>
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => {
              notify('Als gelesen abgelegt')
              onClose()
              markFinished(book).catch(() => notify('Speichern hat nicht geklappt.'))
            }}>Fertig gelesen</button>
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
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="btn"
                style={n === local.rating
                  ? { borderColor: 'var(--lamp)', color: 'var(--lamp)' }
                  : undefined}
                onClick={() => apply({ rating: n === local.rating ? null : n })}>
                {n}
              </button>
            ))}
          </div>
          {local.finishedAt && (
            <p className="hint" style={{ textAlign: 'left' }}>
              Gelesen am {formatDate(local.finishedAt)}
            </p>
          )}
          <button className="btn" style={{ marginTop: 8 }} onClick={() => apply(
            { status: 'owned', finishedAt: null },
            'Zurück ins Regal'
          )}>Doch nicht fertig</button>
        </>
      )}

      {book.notes && (
        <>
          <h2>Notizen</h2>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{book.notes}</p>
        </>
      )}

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
    </div>
  )
}
