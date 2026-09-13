import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, notesFor, addNote, updateNote, deleteNote } from '../lib/db'

/* Zitate werden bewusst anders gesetzt als Notizen: eingerückt, in der
   Serifenschrift des Buchtitels, mit Seitenangabe. Eine Notiz ist ein
   Gedanke von dir, ein Zitat ist der Text des Buchs — das darf man sehen. */

function Editor({ initial, onSave, onCancel }) {
  const [type, setType] = useState(initial?.type || 'quote')
  const [text, setText] = useState(initial?.text || '')
  const [page, setPage] = useState(initial?.page ?? '')

  return (
    <div className="note-editor">
      <div className="view-toggle" style={{ marginBottom: 10 }}>
        <button aria-pressed={type === 'quote'} onClick={() => setType('quote')}>Zitat</button>
        <button aria-pressed={type === 'note'} onClick={() => setType('note')}>Notiz</button>
      </div>

      <div className="field">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={type === 'quote' ? 'Die Stelle aus dem Buch…' : 'Dein Gedanke dazu…'}
          autoFocus
        />
      </div>

      <div className="progress">
        <input
          className="search"
          style={{ flex: 1, width: 'auto', marginBottom: 0 }}
          type="number" inputMode="numeric" min="0"
          value={page}
          onChange={(e) => setPage(e.target.value)}
          placeholder="Seite (optional)"
          aria-label="Seitenzahl"
        />
        <button className="btn btn-primary" disabled={!text.trim()}
          onClick={() => onSave({ type, text, page })}>
          Sichern
        </button>
      </div>
      <button className="btn btn-quiet btn-block" onClick={onCancel}>Abbrechen</button>
    </div>
  )
}

export default function BookNotes({ book, notify }) {
  const live = useLiveQuery(() => notesFor(book.id), [book.id], undefined)
  const [direct, setDirect] = useState(undefined)
  useEffect(() => {
    let alive = true
    notesFor(book.id).then((r) => alive && setDirect(r)).catch(() => alive && setDirect([]))
    return () => { alive = false }
  }, [book.id])
  const notes = live !== undefined ? live : direct

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

  const sorted = [...(notes || [])].sort((a, b) => {
    // Nach Seite geordnet, damit man dem Buch folgen kann; Seitenlose ans Ende.
    const ap = a.page ?? Infinity
    const bp = b.page ?? Infinity
    if (ap !== bp) return ap - bp
    return (a.createdAt || '').localeCompare(b.createdAt || '')
  })

  const quotes = sorted.filter((n) => n.type === 'quote').length

  return (
    <>
      <div className="notes-head">
        <h2>Notizen und Zitate</h2>
        {!adding && !editing && (
          <button className="btn btn-quiet" onClick={() => setAdding(true)}>+ Neu</button>
        )}
      </div>

      {adding && (
        <Editor
          onCancel={() => setAdding(false)}
          onSave={async (data) => {
            await addNote({ bookId: book.id, ...data })
            setAdding(false)
            notify(data.type === 'quote' ? 'Zitat gesichert' : 'Notiz gesichert')
          }}
        />
      )}

      {editing && (
        <Editor
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={async (data) => {
            await updateNote(editing.id, data)
            setEditing(null)
            notify('Gespeichert')
          }}
        />
      )}

      {notes === undefined ? (
        <p className="hint" style={{ textAlign: 'left' }}><span className="spinner" /></p>
      ) : sorted.length === 0 && !adding ? (
        <p className="hint" style={{ textAlign: 'left', margin: 0 }}>
          Noch nichts festgehalten. Zitate und Gedanken zum Buch landen hier.
        </p>
      ) : (
        <div className="note-list">
          {sorted.map((n) => (
            <article
              key={n.id}
              className={n.type === 'quote' ? 'note note-quote' : 'note'}
              onClick={() => setEditing(n)}
            >
              <p className="note-text">{n.text}</p>
              <footer className="note-foot">
                <span>{n.page ? `Seite ${n.page}` : 'ohne Seitenangabe'}</span>
                <button
                  className="note-del"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteNote(n.id)
                    notify('Gelöscht')
                  }}
                  aria-label="Löschen"
                >Löschen</button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {quotes > 1 && (
        <p className="hint" style={{ textAlign: 'left' }}>
          {quotes} Zitate, nach Seite geordnet.
        </p>
      )}
    </>
  )
}
