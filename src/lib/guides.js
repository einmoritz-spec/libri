/* Lesereihenfolge-Übersichten, die bei einer Reihe angezeigt werden.
   Weitere lassen sich hier einfach ergänzen: Bilder nach public/guides/ legen
   und die Reihe (kleingeschrieben) mit den Dateinamen eintragen. */
const GUIDES = [
  {
    names: ['discworld', 'scheibenwelt'],
    title: 'Lesereihenfolge',
    sub: 'Discworld Reading Order Guide 3.0',
    thumb: 'guides/discworld-thumb.jpg',
    full: 'guides/discworld.jpg'
  }
]

const url = (path) => new URL(path, document.baseURI).href

/** Übersicht zur Reihe, falls es eine gibt. */
export function guideFor(series) {
  const key = String(series || '').trim().toLowerCase()
  const g = GUIDES.find((x) => x.names.includes(key))
  return g ? { ...g, thumb: url(g.thumb), full: url(g.full) } : null
}
