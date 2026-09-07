import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, addBook, emptyBook } from './lib/db'
import Library from './components/Library'
import Scan from './components/Scan'
import Stats from './components/Stats'
import Settings from './components/Settings'
import BookDetail from './components/BookDetail'
import BookForm from './components/BookForm'
import { Icon, Toast } from './components/ui'

const TABS = [
  { id: 'library', label: 'Bibliothek', icon: 'shelf' },
  { id: 'scan', label: 'Scannen', icon: 'scan' },
  { id: 'stats', label: 'Statistik', icon: 'stats' },
  { id: 'settings', label: 'Mehr', icon: 'gear' }
]

export default function App() {
  const [tab, setTab] = useState('library')
  const [openId, setOpenId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [draftUnknown, setDraftUnknown] = useState(false)
  const [toast, setToast] = useState(null)

  const openBook = useLiveQuery(
    () => (openId ? db.books.get(openId) : undefined),
    [openId],
    undefined
  )

  const notify = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast((t) => (t === message ? null : t)), 2600)
  }, [])

  // Zurück-Taste schließt erst die Detailansicht, nicht die App.
  useEffect(() => {
    if (!openId && !draft) return
    history.pushState({ sheet: true }, '')
    let poppedByUser = false
    const onPop = () => {
      poppedByUser = true
      setOpenId(null)
      setDraft(null)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Per Knopf geschlossen: den eigenen History-Eintrag wieder abräumen.
      if (!poppedByUser && history.state?.sheet) history.back()
    }
  }, [openId, draft])

  function closeSheets() {
    setOpenId(null)
    setDraft(null)
  }

  return (
    <div className="app">
      {tab === 'library' && (
        <Library
          onOpen={(b) => setOpenId(b.id)}
          onScan={() => setTab('scan')}
          onManual={() => {
            setDraftUnknown(false)
            setDraft(emptyBook())
          }}
        />
      )}

      {tab === 'scan' && (
        <Scan
          notify={notify}
          onFound={(book, unknown) => {
            setDraftUnknown(unknown)
            setDraft(book)
          }}
          onExisting={(book) => {
            notify(`„${book.title}“ steht schon im Regal`)
            setOpenId(book.id)
          }}
          onManual={() => {
            setDraftUnknown(false)
            setDraft(emptyBook())
          }}
        />
      )}

      {tab === 'stats' && <Stats />}
      {tab === 'settings' && <Settings notify={notify} />}

      {draft && (
        <BookForm
          draft={draft}
          title={draftUnknown ? 'Nichts gefunden — bitte selbst ausfüllen' : 'Stimmt das so?'}
          submitLabel="Ins Regal"
          onCancel={() => setDraft(null)}
          onSave={async (data) => {
            await addBook(data)
            setDraft(null)
            notify(`„${data.title}“ steht im Regal`)
          }}
        />
      )}

      {openBook && (
        <BookDetail book={openBook} onClose={closeSheets} notify={notify} />
      )}

      <Toast message={toast} />

      <nav className="nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id}
            onClick={() => {
              closeSheets()
              setTab(t.id)
            }}
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
