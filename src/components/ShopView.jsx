/* Der Shop als eigene Ebene über der App. Er läuft als eigene Seite im Rahmen
   (public/shop/), damit er mit der Bibliothek nichts teilt außer dem Gerät. */
export default function ShopView({ onClose }) {
  return (
    <div className="shop-layer" role="dialog" aria-label="Shop">
      <div className="shop-bar">
        <button className="btn btn-quiet" onClick={onClose}>‹ Zurück</button>
        <b>Shop</b>
      </div>
      <iframe className="shop-frame" title="Shop" src="./shop/index.html" allow="web-share; clipboard-write" />
    </div>
  )
}
