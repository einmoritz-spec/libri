import { useEffect, useRef } from 'react'
import { getShopMetaItems } from '../lib/db'

/* Der Shop als eigene Ebene über der App. Er läuft als eigene Seite im Rahmen
   (public/shop/), damit er mit der Bibliothek nichts teilt außer dem Gerät.
   Was Libri zu den Shop-Büchern herausgefunden hat (ISBN, Cover, Text …),
   schickt die App dem Shop, sobald er meldet, dass er bereit ist. */
export default function ShopView({ onClose }) {
  const frame = useRef(null)

  useEffect(() => {
    async function onMessage(e) {
      if (e.source !== frame.current?.contentWindow || e.data?.type !== 'shop-ready') return
      try {
        const items = await getShopMetaItems()
        if (items.length) e.source.postMessage({ type: 'libri-shop-meta', items }, '*')
      } catch { /* der Shop funktioniert auch ohne */ }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="shop-layer" role="dialog" aria-label="Shop">
      <div className="shop-bar">
        <button className="btn btn-quiet" onClick={onClose}>‹ Zurück</button>
        <b>Shop</b>
      </div>
      <iframe ref={frame} className="shop-frame" title="Shop" src="./shop/index.html" allow="web-share; clipboard-write" />
    </div>
  )
}
