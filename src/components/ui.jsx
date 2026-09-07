import { useEffect, useState } from 'react'

export function Icon({ name }) {
  const paths = {
    scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8',
    shelf: 'M4 4v16M9 4v16M14 5l4 15M3 20h18',
    stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

/** Cover aus Blob (offline) oder URL. Fällt auf einen gezeichneten Rücken zurück. */
export function Cover({ book, className }) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    if (book.coverBlob instanceof Blob) {
      const url = URL.createObjectURL(book.coverBlob)
      setSrc(url)
      return () => URL.revokeObjectURL(url)
    }
    setSrc(book.coverUrl || null)
  }, [book.coverBlob, book.coverUrl])

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
