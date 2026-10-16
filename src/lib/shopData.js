/* Katalog aus dem Shop (public/shop/index.html). Der Shop trägt seine Daten
   als JSON im eigenen HTML — hier werden sie von dort gelesen, damit es nur
   eine Kopie gibt. Daraus ergänzt „Angaben ergänzen“ Cover, Text, Seitenzahl,
   Verlag und Jahr, bevor irgendein Online-Katalog gefragt wird. */

let cache = null

export async function loadShop() {
  if (cache) return cache
  const res = await fetch('./shop/index.html')
  if (!res.ok) throw new Error('Shop nicht erreichbar')
  const html = await res.text()
  const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error('Shop-Daten fehlen')
  const list = JSON.parse(m[1].replace(/<\\\//g, '</'))
  const norm = (s) =>
    String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss').replace(/\(.*?\)/g, ' ')
  const titleKey = (s) => norm(s).split(/\s[-–:]\s|:/)[0].replace(/[^a-z0-9]+/g, '')
  const surname = (a) => {
    const w = norm(a).replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)
    return w[w.length - 1] || ''
  }
  const byTitle = new Map()
  for (const p of list) {
    if (p.c) continue
    const k = titleKey(p.t)
    if (!k) continue
    if (!byTitle.has(k)) byTitle.set(k, [])
    byTitle.get(k).push(p)
  }
  cache = { list, byTitle, titleKey, surname }
  return cache
}

const LANG = { de: 'de', en: 'en' }

/** Passendes Shop-Buch zu einem Libri-Buch — Titel gleich und Autor passend. */
export function matchBook(shop, book) {
  const cands = shop.byTitle.get(shop.titleKey(book.title))
  if (!cands) return null
  const au = shop.surname(book.authors?.[0])
  const lang = String(book.language || '').slice(0, 2).toLowerCase()
  const ok = cands.filter((p) => !au || !p.a || shop.surname(p.a) === au)
  if (!ok.length) return null
  // Beste Wahl: gleiche Sprache, mit Cover, mit Text.
  const score = (p) => (LANG[lang] && p.l === lang ? 4 : 0) + (p.img ? 2 : 0) + (p.ds ? 1 : 0)
  return ok.slice().sort((a, b) => score(b) - score(a))[0]
}
