import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, STATUS, STATUS_ORDER } from '../lib/db'
import { languageName, dominantColor, prepareCoverFile } from '../lib/metadata'
import { Cover } from './ui'
// Der Zuschneider wird nur gebraucht, wenn wirklich ein Bild gewählt wurde.

const LANGS = ['de', 'en', 'fr', 'es', 'it', 'nl', 'sv', 'pl', 'ru', 'la']

export default function BookForm({ draft, title, submitLabel, onSave, onCancel, pending }) {
  // Schon vergebene Unterreihen als Vorschläge
  const knownSubseries = useLiveQuery(
    async () => [...new Set((await db.books.toArray()).map((b) => b.subseries).filter(Boolean))].sort(),
    []
  )
  const [form, setForm] = useState({
    ...draft,
    authorsText: (draft.authors || []).join(', '),
    tagsText: (draft.tags || []).join(', ')
  })
  const [saving, setSaving] = useState(false)
  const [enriching, setEnriching] = useState(Boolean(pending))
  const touched = useRef(new Set())
  const fileRef = useRef(null)
  const cameraRef = useRef(null)

  // Nachgereichte Daten einarbeiten — aber nur in Felder, die noch leer sind
  // und die nicht von Hand geändert wurden. Getippte Korrekturen bleiben.
  useEffect(() => {
    if (!pending) return
    let alive = true
    pending.then((extra) => {
      if (!alive || !extra) {
        if (alive) setEnriching(false)
        return
      }
      setForm((f) => {
        const next = { ...f }
        const fill = (key, value) => {
          if (value === null || value === undefined || value === '') return
          if (touched.current.has(key)) return
          const cur = next[key]
          if (cur === null || cur === undefined || cur === '' || cur === 0) next[key] = value
        }
        fill('title', extra.title)
        fill('subtitle', extra.subtitle)
        fill('description', extra.description)
        fill('publisher', extra.publisher)
        fill('year', extra.year)
        fill('pages', extra.pages)
        fill('language', extra.language)
        fill('series', extra.series)
        fill('seriesIndex', extra.seriesIndex)
        fill('spineColor', extra.spineColor)
        fill('source', extra.source)
        if (!touched.current.has('authorsText') && !next.authorsText && extra.authors?.length) {
          next.authorsText = extra.authors.join(', ')
        }
        if (!touched.current.has('tagsText') && !next.tagsText && extra.tags?.length) {
          next.tagsText = extra.tags.join(', ')
        }
        // Cover nur übernehmen, wenn nicht schon eins ausgewählt wurde
        if (!touched.current.has('cover')) {
          if (extra.coverBlob) {
            next.coverBlob = extra.coverBlob
            next.coverUrl = null
          } else if (extra.coverUrl && !next.coverBlob) {
            next.coverUrl = extra.coverUrl
          }
        }
        return next
      })
      setEnriching(false)
    })
    return () => { alive = false }
  }, [pending])

  const set = (k) => (e) => {
    touched.current.add(k)
    setForm((f) => ({ ...f, [k]: e.target.value }))
  }

  async function pickCover(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const blob = await prepareCoverFile(file)
    const color = await dominantColor(blob)
    touched.current.add('cover')
    setForm((f) => ({ ...f, coverBlob: blob, coverUrl: null, spineColor: color || f.spineColor }))
  }

  function removeCover() {
    touched.current.add('cover')
    setForm((f) => ({ ...f, coverBlob: null, coverUrl: null }))
  }

  async function submit() {
    if (!form.title.trim()) return
    setSaving(true)
    const { authorsText, tagsText, ...rest } = form
    await onSave({
      ...rest,
      title: form.title.trim(),
      authors: authorsText.split(',').map((s) => s.trim()).filter(Boolean),
      tags: tagsText.split(',').map((s) => s.trim()).filter(Boolean),
      pages: form.pages ? Number(form.pages) : null,
      series: (form.series || '').trim(),
      subseries: (form.subseries || '').trim(),
      subseriesIndex: (form.subseries || '').trim() && form.subseriesIndex !== '' && form.subseriesIndex != null
        ? Number(form.subseriesIndex)
        : null,
      seriesIndex: form.seriesIndex !== '' && form.seriesIndex !== null && form.seriesIndex !== undefined
        ? Number(form.seriesIndex)
        : null,
      year: form.year ? Number(form.year) : null,
      currentPage: form.currentPage ? Number(form.currentPage) : 0
    })
    // Kein setSaving(false) — das Formular ist danach ohnehin geschlossen,
    // und ein Zustandswechsel auf einer verschwindenden Ansicht bringt nichts.
  }

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <button className="btn btn-quiet" onClick={onCancel}>Abbrechen</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving || !form.title.trim()}>
          {saving ? 'Speichert…' : submitLabel}
        </button>
      </div>

      <h2 style={{ marginTop: 0 }}>{title}</h2>

      {enriching && (
        <p className="hint" style={{ textAlign: 'left', marginTop: -4 }}>
          <span className="spinner" /> Weitere Angaben und Cover werden noch geladen —
          du kannst schon tippen, Getipptes bleibt erhalten.
        </p>
      )}

      <div className="field">
        <label>Cover</label>
        <div className="form-cover">
          <Cover book={form} />
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => cameraRef.current?.click()}>
            Foto aufnehmen
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {form.coverBlob || form.coverUrl ? 'Anderes Bild wählen' : 'Aus Galerie wählen'}
          </button>
          {(form.coverBlob || form.coverUrl) && (
            <button type="button" className="btn btn-quiet" onClick={removeCover}>Entfernen</button>
          )}
        </div>
        {/* Zwei getrennte Felder statt eines: ein bloßes accept="image/*" lässt
            manche Handys selbst entscheiden, ob "Kamera" überhaupt als Option
            auftaucht. Mit capture ist es erzwungen, ohne bleibt Galerie/Dateien
            im Vordergrund — beides als eigener Knopf statt Ratespiel. */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment"
          hidden onChange={pickCover} />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickCover} />
      </div>

      <div className="field">
        <label htmlFor="f-title">Titel</label>
        <input id="f-title" value={form.title} onChange={set('title')} />
      </div>

      <div className="field">
        <label htmlFor="f-sub">Untertitel</label>
        <input id="f-sub" value={form.subtitle || ''} onChange={set('subtitle')} />
      </div>

      <div className="field">
        <label htmlFor="f-desc">Beschreibung</label>
        <textarea id="f-desc" value={form.description || ''} onChange={set('description')} />
      </div>

      <div className="field">
        <label htmlFor="f-authors">Autoren, mit Komma getrennt</label>
        <input id="f-authors" value={form.authorsText} onChange={set('authorsText')} />
      </div>

      <div className="field-pair">
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="f-series">Reihe</label>
          <input id="f-series" value={form.series || ''} onChange={set('series')}
            placeholder="z. B. Sturmlicht-Chroniken" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="f-series-idx">Band</label>
          <input id="f-series-idx" type="number" inputMode="numeric" min="0" step="0.5"
            value={form.seriesIndex ?? ''} onChange={set('seriesIndex')} />
        </div>
      </div>

      <div className="field-pair">
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="f-subseries">Unterreihe (optional)</label>
          <input id="f-subseries" value={form.subseries || ''} onChange={set('subseries')}
            list="f-subseries-list" placeholder="z. B. Witches, City Watch" />
          <datalist id="f-subseries-list">
            {(knownSubseries || []).map((n) => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="f-subseries-idx">Band</label>
          <input id="f-subseries-idx" type="number" inputMode="numeric" min="0" step="0.5"
            value={form.subseriesIndex ?? ''} onChange={set('subseriesIndex')} />
        </div>
      </div>

      <div className="field-pair">
        <div className="field">
          <label htmlFor="f-pages">Seiten</label>
          <input id="f-pages" type="number" inputMode="numeric" min="0"
            value={form.pages ?? ''} onChange={set('pages')} />
        </div>
        <div className="field">
          <label htmlFor="f-year">Jahr</label>
          <input id="f-year" type="number" inputMode="numeric"
            value={form.year ?? ''} onChange={set('year')} />
        </div>
      </div>

      <div className="field-pair">
        <div className="field">
          <label htmlFor="f-lang">Sprache</label>
          <select id="f-lang" value={form.language || ''} onChange={set('language')}>
            <option value="">unbekannt</option>
            {LANGS.map((l) => (
              <option key={l} value={l}>{languageName(l)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" value={form.status} onChange={set('status')}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="f-format">Gelesen als</label>
        <select id="f-format" value={form.format || ''} onChange={set('format')}>
          <option value="">offen</option>
          <option value="print">Buch</option>
          <option value="ebook">eBook</option>
          <option value="audio">Hörbuch</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="f-pub">Verlag</label>
        <input id="f-pub" value={form.publisher || ''} onChange={set('publisher')} />
      </div>

      <div className="field">
        <label htmlFor="f-tags">Schlagwörter, mit Komma getrennt</label>
        <input id="f-tags" value={form.tagsText} onChange={set('tagsText')}
          placeholder="Krimi, Verliehen, Signiert" />
      </div>

      {form.isbn13 && (
        <p className="hint" style={{ textAlign: 'left' }}>ISBN {form.isbn13}</p>
      )}
    </div>
  )
}
