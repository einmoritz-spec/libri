import { useRef, useState } from 'react'
import { STATUS, STATUS_ORDER } from '../lib/db'
import { languageName, dominantColor } from '../lib/metadata'
import { Cover } from './ui'
import CoverCropper from './CoverCropper'

const LANGS = ['de', 'en', 'fr', 'es', 'it', 'nl', 'sv', 'pl', 'ru', 'la']

export default function BookForm({ draft, title, submitLabel, onSave, onCancel }) {
  const [form, setForm] = useState({
    ...draft,
    authorsText: (draft.authors || []).join(', '),
    tagsText: (draft.tags || []).join(', ')
  })
  const [saving, setSaving] = useState(false)
  const [cropping, setCropping] = useState(null)
  const fileRef = useRef(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function pickCover(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) setCropping(file)
  }

  async function applyCrop(blob) {
    const color = await dominantColor(blob)
    setForm((f) => ({ ...f, coverBlob: blob, coverUrl: null, spineColor: color || f.spineColor }))
    setCropping(null)
  }

  function removeCover() {
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
      year: form.year ? Number(form.year) : null,
      currentPage: form.currentPage ? Number(form.currentPage) : 0
    })
    setSaving(false)
  }

  if (cropping) {
    return (
      <CoverCropper
        file={cropping}
        onDone={applyCrop}
        onCancel={() => setCropping(null)}
      />
    )
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

      <div className="field">
        <label>Cover</label>
        <div className="form-cover">
          <Cover book={form} />
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {form.coverBlob || form.coverUrl ? 'Anderes Bild wählen' : 'Cover hochladen'}
          </button>
          {(form.coverBlob || form.coverUrl) && (
            <button type="button" className="btn btn-quiet" onClick={removeCover}>Entfernen</button>
          )}
        </div>
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
        <label htmlFor="f-authors">Autoren, mit Komma getrennt</label>
        <input id="f-authors" value={form.authorsText} onChange={set('authorsText')} />
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
        <label htmlFor="f-pub">Verlag</label>
        <input id="f-pub" value={form.publisher || ''} onChange={set('publisher')} />
      </div>

      <div className="field">
        <label htmlFor="f-tags">Schlagwörter, mit Komma getrennt</label>
        <input id="f-tags" value={form.tagsText} onChange={set('tagsText')}
          placeholder="Krimi, Verliehen, Signiert" />
      </div>

      <div className="field">
        <label htmlFor="f-notes">Notizen</label>
        <textarea id="f-notes" value={form.notes || ''} onChange={set('notes')} />
      </div>

      {form.isbn13 && (
        <p className="hint" style={{ textAlign: 'left' }}>ISBN {form.isbn13}</p>
      )}
    </div>
  )
}
