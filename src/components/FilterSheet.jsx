import { useState } from 'react'
import { useBackLayer } from '../lib/backStack'

/* Filter und Sortierung als Blatt von unten: oben der Titel mit
   „Zurücksetzen“, in der Mitte die Gruppen (scrollbar), unten ein fester
   Knopf mit der Trefferzahl. Lange Listen zeigen zunächst nur die ersten
   Einträge. */

const LIMIT = 10

function Group({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const selectedIdx = options.findIndex((o) => o.value === value)
  // Ein gewählter Eintrag weit hinten soll nicht versteckt sein.
  const expanded = open || selectedIdx >= LIMIT
  const visible = expanded ? options : options.slice(0, LIMIT)
  const selected = options.find((o) => o.value === value)

  return (
    <section className="fs-group">
      <h3 className="fs-label">
        {label}
        {selected && <span className="fs-picked">{selected.label}</span>}
      </h3>
      <div className="fs-chips">
        {visible.map((o) => (
          <button key={o.value} className="chip chip-s" aria-pressed={value === o.value}
            onClick={() => onChange(value === o.value ? 'all' : o.value)}>
            {o.label}
          </button>
        ))}
        {!expanded && options.length > LIMIT && (
          <button className="chip chip-s chip-more" onClick={() => setOpen(true)}>
            + {options.length - LIMIT} weitere
          </button>
        )}
      </div>
    </section>
  )
}

export default function FilterSheet({
  sortOptions, sort, onSort, groups, activeCount, resultCount, onReset, onClose
}) {
  useBackLayer(true, onClose)
  return (
    <div className="fs-backdrop" onClick={onClose}>
      <div className="fs-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Filter">
        <div className="fs-head">
          <h2>Filter</h2>
          {activeCount > 0 && (
            <button className="btn btn-quiet" onClick={onReset}>Zurücksetzen</button>
          )}
        </div>

        <div className="fs-body">
          <section className="fs-group">
            <h3 className="fs-label">Sortieren nach</h3>
            <div className="fs-chips">
              {sortOptions.map((o) => (
                <button key={o.value} className="chip chip-s" aria-pressed={sort === o.value}
                  onClick={() => onSort(o.value)}>{o.label}</button>
              ))}
            </div>
          </section>

          {groups.filter((g) => g.options.length > 0).map((g) => (
            <Group key={g.key} label={g.label} options={g.options} value={g.value} onChange={g.onChange} />
          ))}
        </div>

        <div className="fs-foot">
          <button className="btn btn-primary btn-block" onClick={onClose}>
            {resultCount} {resultCount === 1 ? 'Buch' : 'Bücher'} anzeigen
          </button>
        </div>
      </div>
    </div>
  )
}
