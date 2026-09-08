import { useEffect, useState } from 'react'
import { getCoverUrl } from '../lib/db'

export function EmptyBookIcon() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="empty-icon" aria-hidden="true">
      <path d="M20 12c-3.6-2.7-7.4-3.8-11.5-3.6v18.4c4.1-.2 7.9.9 11.5 3.6" />
      <path d="M20 12c3.6-2.7 7.4-3.8 11.5-3.6v18.4c-4.1-.2-7.9.9-11.5 3.6" />
      <path d="M20 12v18.4" />
    </svg>
  )
}

export function Icon({ name }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.7',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  }

  if (name === 'gear') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    )
  }

  const paths = {
    scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8',
    shelf: 'M4 4v16M9 4v16M14 5l4 15M3 20h18',
    stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2'
  }
  return (
    <svg {...common}>
      <path d={paths[name]} />
    </svg>
  )
}

/** Liefert die anzeigbare Adresse eines Covers.
    Drei Fälle: ein noch nicht gespeicherter Entwurf trägt das Bild direkt bei
    sich, ein gespeichertes Buch holt es aus der Cover-Tabelle, und sonst
    bleibt eine entfernte Adresse. */
export function useCoverSrc(book) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    let alive = true

    // Entwurf mit Bild im Arbeitsspeicher
    if (book.coverBlob instanceof Blob) {
      const url = URL.createObjectURL(book.coverBlob)
      setSrc(url)
      return () => {
        alive = false
        URL.revokeObjectURL(url)
      }
    }

    if (book.id && book.hasCover) {
      getCoverUrl(book.id).then((url) => {
        if (alive) setSrc(url || book.coverUrl || null)
      })
      return () => { alive = false }
    }

    setSrc(book.coverUrl || null)
    return () => { alive = false }
  }, [book.id, book.hasCover, book.coverBlob, book.coverUrl])

  return src
}

/** Cover aus Blob (offline) oder URL. Fällt auf einen gezeichneten Rücken zurück. */
export function Cover({ book, className }) {
  const src = useCoverSrc(book)
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])

  if (!src || broken) {
    return (
      <div
        className="slot-blank"
        style={book.spineColor ? { borderLeftColor: book.spineColor } : undefined}
      >
        {book.title}
      </div>
    )
  }
  return (
    <img
      className={className}
      src={src}
      alt={`Cover von ${book.title}`}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  )
}

export function Toast({ message }) {
  if (!message) return null
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}
