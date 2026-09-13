import { useState } from 'react'
import { searchBooksByText, fetchCoverBlob, dominantColor, toIsbn13 } from '../lib/metadata'
import { addBook, emptyBook, findByIsbn, STATUS, STATUS_ORDER } from '../lib/db'

/* Mehrere Bücher auf einmal aufnehmen: nach Autor oder Reihe suchen,
   ankreuzen, fertig. Die Daten kommen dabei aus derselben Quelle wie beim
   Scannen — echte Titel, echte Seitenzahlen, echte Cover. */

const LANGS = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'Englisch' },
  { id: null, label: 'Alle' }
]

export default function BulkAdd({ onClose, notify }) {
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState('de')
  const [status, setStatus] = useState('owned')
  const [results, setResults] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)

  async function search() {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    setResults(null)
    setPicked(new Set())
    try {
      const r = await searchBooksByText(query, { lang, max: 40 })
      setResults(r)
    } catch (e) {
      setError(e?.message || 'Die Suche hat nicht geklappt.')
    } finally {
      setBusy(false)
    }
  }

  function toggle(key) {
    setPicked((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleAll() {
    if (!results) return
    setPicked(picked.size === results.length ? new Set() : new Set(results.map((r) => r.key)))
  }

  async function addSelected() {
    const chosen = (results || []).filter((r) => picked.has(r.key))
    if (!chosen.length) return
    setBusy(true)

    let added = 0
    let skipped = 0
    for (let i = 0; i < chosen.length; i++) {
      const r = chosen[i]
      setProgress({ done: i, total: chosen.length, title: r.title })
      try {
        const isbn = r.isbn13 ? toIsbn13(r.isbn13) : null
        if (isbn && (await findByIsbn(isbn))) {
          skipped++
          continue
        }
        // Cover gleich mitnehmen, damit es auch offline da ist.
        const coverBlob = await fetchCoverBlob(r.coverUrl)
        const spineColor = await dominantColor(coverBlob)
        await addBook(
          emptyBook({
            isbn13: isbn,
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
            tags: r.categories || [],
            status,
            source: 'Google Books (Mehrfach-Import)'
          })
        )
        added++
      } catch {
        skipped++
      }
    }

    setProgress(null)
    setBusy(false)
    notify(`${added} hinzugefügt${skipped ? `, ${skipped} übersprungen` : ''}`)
    setResults(null)
    setPicked(new Set())
  }

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onClose} disabled={busy}>Fertig</button>
        {picked.size > 0 && (
          <button className="btn btn-primary" onClick={addSelected} disabled={busy}>
            {busy ? 'Läuft…' : `${picked.size} hinzufügen`}
          </button>
        )}
      </div>

      <h2 style={{ marginTop: 0 }}>Mehrere auf einmal</h2>
      <p className="hint" style={{ textAlign: 'left', margin: '0 0 14px' }}>
        Nach Autor oder Reihe suchen, die eigenen Bücher ankreuzen. Cover und
        Angaben werden mitgeladen.
      </p>

      <div className="progress">
        <input
          className="search"
          style={{ flex: 1, width: 'auto', marginBottom: 0 }}
          placeholder="Brandon Sanderson, Dungeon Crawler Carl …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          aria-label="Autor oder Reihe"
        />
        <button className="btn btn-primary" onClick={search} disabled={!query.trim() || busy}>
          {busy && !progress ? <span className="spinner" /> : 'Suchen'}
        </button>
      </div>

      <div className="filters-wrap" style={{ marginTop: 12 }}>
        {LANGS.map((l) => (
          <button key={String(l.id)} className="chip" aria-pressed={lang === l.id}
            onClick={() => setLang(l.id)}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="filter-row" style={{ marginBottom: 14 }}>
        <span>Ablegen als</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{STATUS[s]}</option>
          ))}
        </select>
      </div>

      {progress && (
        <div className="notice">
          <p><span className="spinner" /> {progress.done + 1} von {progress.total}: {progress.title}</p>
        </div>
      )}

      {error && (
        <div className="notice warn">
          <p>{error}</p>
          <button className="btn btn-primary" onClick={search}>Nochmal versuchen</button>
        </div>
      )}

      {results?.length === 0 && (
        <p className="hint" style={{ textAlign: 'left' }}>
          Keine Treffer. Andere Schreibweise oder Sprache „Alle" probieren.
        </p>
      )}

      {results?.length > 0 && (
        <>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button className="btn btn-quiet" onClick={toggleAll}>
              {picked.size === results.length ? 'Auswahl aufheben' : `Alle ${results.length} auswählen`}
            </button>
          </div>

          <div className="search-results">
            {results.map((r) => (
              <button
                key={r.key}
                className="search-result"
                aria-pressed={picked.has(r.key)}
                onClick={() => toggle(r.key)}
                disabled={busy}
              >
                <span className={`pick-box${picked.has(r.key) ? ' pick-on' : ''}`} aria-hidden="true" />
                {r.thumb ? <img src={r.thumb} alt="" /> : <span className="search-result-blank" />}
                <span className="search-result-text">
                  <span className="search-result-title">{r.title}</span>
                  <span className="search-result-author">
                    {[r.authors?.[0], r.year, r.pages && `${r.pages} S.`]
                      .filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
