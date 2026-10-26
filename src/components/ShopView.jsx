import { useEffect, useRef, useState } from 'react'
import { getShopMetaItems, getShopLibraryStatus, flushShopOrders, hasMaasBook } from '../lib/db'
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
  const [ready, setReady] = useState(false)
  const unlockRef = useRef(false)
  const back = () => frame.current?.contentWindow?.postMessage({ type: 'libri-shop-back' }, '*')

  useEffect(() => {
    const send = (msg) => frame.current?.contentWindow?.postMessage(msg, '*')
    // Status der Bibliothek an den Shop: gelesen, vorhanden, auf der Wunschliste …
    async function sendLib(wish) {
      try {
        const lib = await getShopLibraryStatus()
        const unlock = await hasMaasBook()
        send({ type: 'libri-shop-lib', lib, wish: wish || null, unlock })
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
    // Versteckte Shop-Einträge: Schalter setzen, bevor der Shop geladen wird.
    hasMaasBook().then((u) => {
      unlockRef.current = u
      try { localStorage.setItem('libri:shopUnlock', u ? '1' : '0') } catch { /* egal */ }
    }).catch(() => {}).finally(() => setReady(true))
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="shop-layer" role="dialog" aria-label="Shop">
      <div className="shop-bar">
        <button className="btn btn-quiet" onClick={() => (depth > 0 ? back() : onClose())}>‹ Zurück</button>
        <b>Shop</b>
      </div>
      {Array.from({ length: depth }, (_, i) => <ShopStep key={i} onBack={back} />)}
      {ready && <iframe ref={frame} className="shop-frame" title="Shop" src="./shop/index.html" allow="web-share; clipboard-write" />}
    </div>
  )
}
