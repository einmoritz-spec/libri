import { useLayoutEffect, useRef, useState } from 'react'

/* Kurzer Anreißer neben dem Cover: drei Zeilen, gedämpft, ohne Überschrift.
   "mehr" erscheint nur, wenn der Text wirklich abgeschnitten ist, und öffnet
   den vollen Text — neben dem Cover ist schlicht nicht mehr Platz. */
export default function BookBlurb({ title, text }) {
  const ref = useRef(null)
  const [truncated, setTruncated] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setTruncated(el.scrollHeight > el.clientHeight + 1)
    measure()
    // Die Webschrift lädt oft erst nach dem ersten Layout und verschiebt die
    // Zeilenumbrüche — deshalb nach dem Laden noch einmal messen.
    document.fonts?.ready?.then(measure)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [text])

  if (!text) return null

  return (
    <div className="blurb">
      <p ref={ref} className="blurb-text">{text}</p>
      {truncated && (
        <button className="blurb-more" onClick={() => setOpen(true)}>mehr</button>
      )}

      {open && (
        <div className="quick-backdrop" onClick={() => setOpen(false)}>
          <div className="blurb-sheet" onClick={(e) => e.stopPropagation()}>
            <h2 className="blurb-sheet-title">{title}</h2>
            <p className="blurb-sheet-text">{text}</p>
            <button className="btn btn-quiet btn-block" onClick={() => setOpen(false)}>
              Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
