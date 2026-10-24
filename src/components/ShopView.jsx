import { useEffect, useRef, useState } from 'react'
import { getShopMetaItems, getShopLibraryStatus, flushShopOrders } from '../lib/db'
import { useBackLayer } from '../lib/backStack'

/* Eine Zurück-Ebene pro Schritt, den der Shop gegangen ist (Reihe geöffnet,
   Filter, Warenkorb …). Die Zurück-Geste schickt dem Shop "einen Schritt zurück". */
function ShopStep({ onBack }) {
  useBackLayer(true, onBack)
  return null
}

/* Der Shop als eigene Ebene über der App. Er läuft als eigene Seite im Rahmen
   (public/shop/), damit er mit der Bibliothek nichts teilt außer dem Gerät.
   Was Libri zu den Shop-Büchern herausgefunden hat (ISBN, Cover, Text …),
   schickt die App dem Shop, sobald er meldet, dass er bereit ist. */
export default function ShopView({ onClose }) {
  const frame = useRef(null)
  const [depth, setDepth] = useState(0)
  const back = () => frame.current?.contentWindow?.postMessage({ type: 'libri-shop-back' }, '*')

  useEffect(() => {
    const send = (msg) => frame.current?.contentWindow?.postMessage(msg, '*')
    // Status der Bibliothek an den Shop: gelesen, vorhanden, auf der Wunschliste …
    async function sendLib(wish) {
      try {
        const lib = await getShopLibraryStatus()
        send({ type: 'libri-shop-lib', lib, wish: wish || null })
      } catch { /* der Shop funktioniert auch ohne */ }
    }
    async function onMessage(e) {
      if (e.source !== frame.current?.contentWindow) return
      if (e.data?.type === 'shop-order') {
        const r = await flushShopOrders().catch(() => null)
        await sendLib(r)
        return
      }
      if (e.data?.type === 'shop-depth') {
        try { localStorage.setItem('libri:shopOpen', String(Date.now())) } catch { /* egal */ }
        setDepth(Math.max(0, Math.min(20, Number(e.data.n) || 0)))
        return
      }
      if (e.data?.type !== 'shop-ready') return
      try {
        const items = await getShopMetaItems()
        if (items.length) e.source.postMessage({ type: 'libri-shop-meta', items }, '*')
      } catch { /* der Shop funktioniert auch ohne */ }
      await flushShopOrders().catch(() => null)
      await sendLib(null)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="shop-layer" role="dialog" aria-label="Shop">
      <div className="shop-bar">
        <button className="btn btn-quiet" onClick={() => (depth > 0 ? back() : onClose())}>‹ Zurück</button>
        <b>Shop</b>
        <small style={{ marginLeft: 'auto', opacity: 0.55, fontSize: 11 }}>
          App {new Date(__BUILD_TIME__).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </small>
      </div>
      {Array.from({ length: depth }, (_, i) => <ShopStep key={i} onBack={back} />)}
      <iframe ref={frame} className="shop-frame" title="Shop" src="./shop/index.html" allow="web-share; clipboard-write" />
    </div>
  )
}
