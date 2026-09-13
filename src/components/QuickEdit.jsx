import { lazy, Suspense, useRef, useState } from 'react'
import { updateBook } from '../lib/db'
import { dominantColor } from '../lib/metadata'
import { Cover } from './ui'

const CoverCropper = lazy(() => import('./CoverCropper'))

/* Schnellbearbeitung: nur die drei Dinge, die beim Erfassen am häufigsten
   fehlen. Für alles Weitere gibt es die volle Detailansicht. */
export default function QuickEdit({ book, onClose, notify }) {
  const [pages, setPages] = useState(book.pages ?? '')
  const [tagsText, setTagsText] = useState((book.tags || []).join(', '))
  const [coverBlob, setCoverBlob] = useState(undefined) // undefined = unverändert
  const [cropping, setCropping] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)
  const cameraRef = useRef(null)

  function pick(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) setCropping(f)
  }

  async function applyCrop(blob) {
    setCoverBlob(blob)
    setCropping(null)
  }

  async function save() {
    setSaving(true)
    const changes = {
      pages: pages === '' ? null : Number(pages),
      tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean)
    }
    if (coverBlob !== undefined) {
      changes.coverBlob = coverBlob
      const color = await dominantColor(coverBlob)
      if (color) changes.spineColor = color
    }
    onClose()
    notify('Gespeichert')
    updateBook(book.id, changes).catch(() => notify('Speichern hat nicht geklappt.'))
  }

  if (cropping) {
    return (
      <Suspense fallback={
        <div className="sheet"><p className="hint"><span className="spinner" /> Bild wird vorbereitet…</p></div>
      }>
        <CoverCropper file={cropping} onDone={applyCrop} onCancel={() => setCropping(null)} />
      </Suspense>
    )
  }

  // Vorschau: frisch gewähltes Bild hat Vorrang vor dem gespeicherten.
  const preview = coverBlob !== undefined
    ? { ...book, coverBlob, coverUrl: null, hasCover: Boolean(coverBlob) }
    : book

  return (
    <div className="quick-backdrop" onClick={onClose}>
      <div className="quick-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="quick-head">
          <div className="quick-art"><Cover book={preview} /></div>
          <div className="quick-title">
            <strong>{book.title}</strong>
            <span>{book.authors?.[0] || '—'}</span>
          </div>
        </div>

        <div className="btn-row">
          <button className="btn" onClick={() => cameraRef.current?.click()}>Foto</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Galerie</button>
          {(preview.hasCover || preview.coverBlob || preview.coverUrl) && (
            <button className="btn btn-quiet" onClick={() => setCoverBlob(null)}>Ohne Cover</button>
          )}
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="q-pages">Seitenzahl</label>
          <input id="q-pages" type="number" inputMode="numeric" min="0"
            value={pages} onChange={(e) => setPages(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="q-tags">Schlagwörter, mit Komma getrennt</label>
          <input id="q-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)}
            placeholder="Fantasy, Verliehen" />
        </div>

        <div className="btn-row">
          <button className="btn btn-primary btn-block" onClick={save} disabled={saving}>
            Speichern
          </button>
          <button className="btn btn-quiet btn-block" onClick={onClose}>Abbrechen</button>
        </div>
      </div>
    </div>
  )
}
