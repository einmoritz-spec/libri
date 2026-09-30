import { useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import {
  STATUS, bulkSetStatus, bulkSetAuthors, bulkSetSeries, bulkTags,
  bulkSetLanguage, deleteBooks, backfillCovers
} from '../lib/db'

/* Leiste oben, solange Bücher ausgewählt sind, und das Aktionsmenü dazu.
   `books` sind die ausgewählten Bücher in der Reihenfolge, wie sie gerade
   angezeigt werden (wichtig fürs Durchnummerieren einer Reihe). */

const LANGS = [['de', 'Deutsch'], ['en', 'Englisch'], ['fr', 'Französisch'], ['es', 'Spanisch'], ['it', 'Italienisch']]

export function SelectionBar({ count, total, onClear, onAll, onActions }) {
  return (
    <div className="sel-bar">
      <button className="btn btn-quiet sel-x" onClick={onClear} aria-label="Auswahl beenden">✕</button>
      <span className="sel-count">{count} ausgewählt</span>
      <button className="btn btn-quiet" onClick={onAll} disabled={count >= total}>Alle</button>
      <button className="btn btn-primary" onClick={onActions}>Aktionen</button>
    </div>
  )
}

export function ActionSheet({ books, allTags, onClose, onDone, onEdit, notify }) {
  const [step, setStep] = useState('menu')
  const [text, setText] = useState('')
  const [numbering, setNumbering] = useState(false)
  const [startAt, setStartAt] = useState('1')
  const [tagMode, setTagMode] = useState('add')
  const [busy, setBusy] = useState(false)

  useBackLayer(true, onClose)
  useBackLayer(step !== 'menu', () => setStep('menu'))

  const ids = books.map((b) => b.id)
  const n = books.length
  const word = n === 1 ? 'Buch' : 'Bücher'

  async function run(work, message) {
    setBusy(true)
    try {
      await work()
      notify(message)
      onDone()
    } catch {
      notify('Das hat nicht geklappt.')
      setBusy(false)
    }
  }

  function go(next) {
    setText('')
    setStep(next)
  }

  const Row = ({ label, sub, onClick, danger }) => (
    <button className={`action-row${danger ? ' danger' : ''}`} onClick={onClick} disabled={busy}>
      <span>{label}</span>{sub && <small>{sub}</small>}
    </button>
  )

  let body
  if (step === 'menu') {
    body = (
      <>
        <Row label="Auf die Wunschliste" onClick={() => run(() => bulkSetStatus(ids, 'wishlist'), `${n} ${word} auf der Wunschliste`)} />
        <Row label="Status ändern …" onClick={() => go('status')} />
        <Row label="Autor eintragen …" onClick={() => go('author')} />
        <Row label="Reihe eintragen …" onClick={() => go('series')} />
        <Row label="Schlagwort …" onClick={() => go('tag')} />
        <Row label="Als Bilderbuch markieren" onClick={() => run(() => bulkTags(ids, 'Bilderbuch'), `${n} ${word} als Bilderbuch markiert`)} />
        <Row label="Sprache setzen …" onClick={() => go('lang')} />
        <Row label="Fehlende Angaben ergänzen" sub="Cover, Seiten, Verlag, Beschreibung"
          onClick={async () => {
            setBusy(true)
            notify('Ergänze Angaben …')
            const r = await backfillCovers({ ids })
            notify(`${r.filled} von ${n} ergänzt`)
            onDone()
          }} />
        {n === 1 && <Row label="Bearbeiten" onClick={() => onEdit(books[0])} />}
        <Row label="Löschen …" danger onClick={() => go('delete')} />
      </>
    )
  } else if (step === 'status') {
    body = Object.entries(STATUS).map(([key, label]) => (
      <Row key={key} label={label} onClick={() => run(() => bulkSetStatus(ids, key), `${n} ${word}: ${label}`)} />
    ))
  } else if (step === 'author') {
    body = (
      <>
        <p className="hint" style={{ textAlign: 'left' }}>
          Mehrere Autoren mit Semikolon trennen. Ersetzt den bisherigen Autor bei allen {n} {word}.
        </p>
        <input className="search" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Name" autoFocus aria-label="Autor" />
        <button className="btn btn-primary btn-block" disabled={!text.trim() || busy}
          onClick={() => run(
            () => bulkSetAuthors(ids, text.split(';').map((a) => a.trim()).filter(Boolean)),
            'Autor eingetragen'
          )}>Eintragen</button>
      </>
    )
  } else if (step === 'series') {
    body = (
      <>
        <input className="search" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Name der Reihe" autoFocus aria-label="Reihe" />
        <label className="continuous-toggle">
          <input type="checkbox" checked={numbering} onChange={(e) => setNumbering(e.target.checked)} />
          <span>Bände fortlaufend nummerieren
            <small>in der Reihenfolge, wie die Bücher gerade angezeigt werden</small></span>
        </label>
        {numbering && (
          <input className="search" type="number" inputMode="numeric" min="0" value={startAt}
            onChange={(e) => setStartAt(e.target.value)} aria-label="Erster Band" placeholder="Erster Band" />
        )}
        <button className="btn btn-primary btn-block" disabled={!text.trim() || busy}
          onClick={() => run(
            () => bulkSetSeries(ids, text.trim(), numbering ? Number(startAt) || 1 : null),
            'Reihe eingetragen'
          )}>Eintragen</button>
        <button className="btn btn-quiet btn-block" disabled={busy}
          onClick={() => run(() => bulkSetSeries(ids, ''), 'Reihe entfernt')}>Reihe entfernen</button>
      </>
    )
  } else if (step === 'tag') {
    body = (
      <>
        <div className="view-toggle" style={{ marginBottom: 12 }}>
          <button aria-pressed={tagMode === 'add'} onClick={() => setTagMode('add')}>Hinzufügen</button>
          <button aria-pressed={tagMode === 'remove'} onClick={() => setTagMode('remove')}>Entfernen</button>
        </div>
        <input className="search" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Schlagwort" list="sel-tags" autoFocus aria-label="Schlagwort" />
        <datalist id="sel-tags">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
        <button className="btn btn-primary btn-block" disabled={!text.trim() || busy}
          onClick={() => run(
            () => bulkTags(ids, text.trim(), tagMode === 'remove'),
            tagMode === 'remove' ? 'Schlagwort entfernt' : 'Schlagwort hinzugefügt'
          )}>{tagMode === 'remove' ? 'Entfernen' : 'Hinzufügen'}</button>
      </>
    )
  } else if (step === 'lang') {
    body = LANGS.map(([code, label]) => (
      <Row key={code} label={label} onClick={() => run(() => bulkSetLanguage(ids, code), `Sprache: ${label}`)} />
    ))
  } else if (step === 'delete') {
    body = (
      <>
        <p style={{ margin: '0 0 6px' }}>
          <b>{n} {word} endgültig löschen?</b>
        </p>
        <p className="hint" style={{ textAlign: 'left', margin: '0 0 16px' }}>
          Lesesitzungen, Notizen und Cover dazu gehen mit. Das lässt sich nicht rückgängig machen.
        </p>
        <button className="btn btn-danger btn-block" disabled={busy}
          onClick={() => run(() => deleteBooks(ids), `${n} ${word} gelöscht`)}>Ja, löschen</button>
        <button className="btn btn-quiet btn-block" onClick={() => setStep('menu')}>Abbrechen</button>
      </>
    )
  }

  const titles = {
    menu: `${n} ${word}`, status: 'Status ändern', author: 'Autor eintragen', series: 'Reihe eintragen',
    tag: 'Schlagwort', lang: 'Sprache setzen', delete: 'Löschen'
  }

  return (
    <div className="action-backdrop" onClick={onClose}>
      <div className="action-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titles[step]}>
        <div className="action-head">
          {step !== 'menu' && (
            <button className="btn btn-quiet" onClick={() => setStep('menu')} aria-label="Zurück">‹</button>
          )}
          <h2>{titles[step]}</h2>
        </div>
        {body}
      </div>
    </div>
  )
}
