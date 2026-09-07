import { useState } from 'react'
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
  const [page, setPage] = useState(book.currentPage || 0)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (editing) {
    return (
      <BookForm
        draft={book}
        title="Buch bearbeiten"
        submitLabel="Speichern"
        onCancel={() => setEditing(false)}
        onSave={async (data) => {
          const { id, ...changes } = data
          await updateBook(book.id, changes)
          setEditing(false)
          notify('Gespeichert')
        }}
      />
    )
  }

  const pct = book.pages ? Math.min(100, Math.round((page / book.pages) * 100)) : 0

  async function saveProgress(value) {
    setPage(value)
    await setProgress(book, value)
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
          <span className={`badge ${book.status}`}>{STATUS[book.status]}</span>
        </div>
      </div>

      <div className="facts">
        {book.pages && <span><b>{book.pages}</b> Seiten</span>}
        {book.language && <span>{languageName(book.language)}</span>}
        {book.year && <span>{book.year}</span>}
        {book.publisher && <span>{book.publisher}</span>}
      </div>

      {book.status !== 'read' && (
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
                onChange={(e) => setPage(Number(e.target.value))}
                onMouseUp={(e) => saveProgress(Number(e.target.value))}
                onTouchEnd={(e) => saveProgress(Number(e.target.value))}
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
              value={page} onChange={(e) => setPage(Number(e.target.value))}
              aria-label="Seite eingeben"
            />
            <button className="btn" onClick={() => saveProgress(page)}>Seite merken</button>
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={async () => {
              await markFinished(book)
              notify('Als gelesen abgelegt')
              onClose()
            }}>Fertig gelesen</button>
            {book.status !== 'reading' && (
              <button className="btn" onClick={async () => {
                await updateBook(book.id, {
                  status: 'reading',
                  startedAt: book.startedAt || new Date().toISOString()
                })
                notify('Steht jetzt auf „Lese ich“')
              }}>Jetzt lesen</button>
            )}
          </div>
        </>
      )}

      {book.status === 'read' && (
        <>
          <h2>Bewertung</h2>
          <div className="btn-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="btn"
                style={n === book.rating
                  ? { borderColor: 'var(--lamp)', color: 'var(--lamp)' }
                  : undefined}
                onClick={() => updateBook(book.id, { rating: n === book.rating ? null : n })}>
                {n}
              </button>
            ))}
          </div>
          {book.finishedAt && (
            <p className="hint" style={{ textAlign: 'left' }}>
              Gelesen am {formatDate(book.finishedAt)}
            </p>
          )}
          <button className="btn" style={{ marginTop: 8 }} onClick={async () => {
            await updateBook(book.id, { status: 'owned', finishedAt: null })
            notify('Zurück ins Regal')
          }}>Doch nicht fertig</button>
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
            <button className="btn btn-danger" onClick={async () => {
              await deleteBook(book.id)
              notify('Gelöscht')
              onClose()
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
