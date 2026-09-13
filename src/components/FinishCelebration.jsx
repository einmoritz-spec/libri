import { useState } from 'react'
import { addNote } from '../lib/db'
import { Cover } from './ui'

/** Wie viele Tage zwischen zwei Zeitstempeln liegen, nie negativ. */
function daysBetween(a, b) {
  if (!a || !b) return null
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000))
}

export default function FinishCelebration({ book, nth, onRate, onDone, notify }) {
  const [quote, setQuote] = useState('')
  const [saved, setSaved] = useState(false)
  const days = daysBetween(book.startedAt, book.finishedAt)

  async function saveQuote() {
    if (!quote.trim()) return
    await addNote({ bookId: book.id, type: 'quote', text: quote })
    setSaved(true)
    notify('Zitat gesichert')
  }

  return (
    <div className="quick-backdrop" onClick={onDone}>
      <div className="celebrate-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-cover"><Cover book={book} /></div>

        <p className="celebrate-eyebrow">Fertig gelesen</p>
        <h2 className="celebrate-title">{book.title}</h2>
        <p className="celebrate-author">{book.authors?.[0] || ''}</p>

        <div className="celebrate-facts">
          {days !== null && (
            <div className="celebrate-fact">
              <b>{days === 0 ? '<1' : days}</b><span>{days === 1 ? 'Tag' : 'Tage'}</span>
            </div>
          )}
          {book.pages && (
            <div className="celebrate-fact">
              <b>{book.pages}</b><span>Seiten</span>
            </div>
          )}
          {nth && (
            <div className="celebrate-fact">
              <b>{nth}.</b><span>{new Date().getFullYear()}</span>
            </div>
          )}
        </div>

        <p className="celebrate-label">Wie war's?</p>
        <div className="btn-row" style={{ justifyContent: 'center', marginBottom: 18 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="btn"
              style={n <= (book.rating || 0)
                ? { borderColor: 'var(--lamp)', color: 'var(--lamp)' }
                : undefined}
              onClick={() => onRate(n === book.rating ? null : n)}>
              {n}
            </button>
          ))}
        </div>

        {!saved && (
          <>
            <p className="celebrate-label">Ein Satz, der bleibt? (optional)</p>
            <div className="field">
              <textarea
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder="Die letzte Zeile, ein Gedanke, ein Zitat…"
                style={{ minHeight: 72 }}
              />
            </div>
            {quote.trim() && (
              <button className="btn btn-block" style={{ marginBottom: 12 }} onClick={saveQuote}>
                Zitat sichern
              </button>
            )}
          </>
        )}

        <button className="btn btn-primary btn-block" onClick={onDone}>Fertig</button>
      </div>
    </div>
  )
}
