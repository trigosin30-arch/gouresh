import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { Breadcrumbs, EmptyState, ErrorState, SectionHeader, Spinner } from '../components/ui'

type BookItem = {
  book_type: string | null
  publisher: string | null
  academic_year: string | null
  product_count: number
  in_stock: number
}
type SubjectNode = { subject: string; items: BookItem[]; total: number; in_stock: number }
type ClassNode = { class_level: string; subjects: SubjectNode[]; total: number; in_stock: number }
type BoardNode = { board: string; classes: ClassNode[]; total: number; in_stock: number }
type Payload = { boards: BoardNode[]; book_types: { value: string; label: string }[]; has_data: boolean }

const BOOK_TYPE_LABEL: Record<string, string> = {
  textbook: 'Textbook',
  reference: 'Reference book',
  guide: 'Guide',
  workbook: 'Workbook',
  question_bank: 'Question bank',
  other: 'Other',
}

export default function BookLists() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [board, setBoard] = useState<string>('')
  const [klass, setKlass] = useState<string>('')

  useEffect(() => {
    setLoading(true)
    api<Payload>('/api/book-lists')
      .then((payload) => {
        setData(payload)
        if (payload.boards.length) {
          setBoard(payload.boards[0].board)
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const activeBoard = data?.boards.find((node) => node.board === board)
  const classes = activeBoard?.classes ?? []
  const activeClass = classes.find((node) => node.class_level === klass)

  useEffect(() => {
    if (classes.length && !classes.some((node) => node.class_level === klass)) {
      setKlass('')
    }
  }, [board, classes, klass])

  return (
    <>
      <Seo
        title="Board-wise and class-wise book finder"
        description="Find CBSE, ICSE/ISC, PSEB and state board textbooks, guides, workbooks and question banks by class, subject and publisher with live store availability."
        canonicalPath="/book-lists"
      />
      <div className="shell py-8">
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Book finder' }]} />
        <SectionHeader
          title="Board &amp; class book finder"
          subtitle="Built from the store's live catalogue. Out-of-stock titles stay visible so you know what is missing rather than guessing."
          action={<Link to="/products?availability=in_stock" className="btn-secondary btn-sm">In-stock titles only</Link>}
        />

        {loading && <Spinner label="Loading book lists" />}
        {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}

        {!loading && !error && data && !data.has_data && (
          <EmptyState
            title="No board-wise book lists yet"
            message="The store has not tagged textbooks with board, class and subject metadata. Once products are tagged in the admin panel they appear here automatically."
            action={<Link to="/products" className="btn-primary">Browse all products</Link>}
            icon="📚"
          />
        )}

        {!loading && !error && data && data.has_data && (
          <div className="grid gap-6 lg:grid-cols-[220px,1fr]">
            <aside className="card h-fit p-4" aria-label="Choose education board">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Education board</h2>
              <div className="flex flex-wrap gap-2 lg:flex-col">
                {data.boards.map((node) => (
                  <button
                    key={node.board}
                    type="button"
                    onClick={() => {
                      setBoard(node.board)
                      setKlass('')
                    }}
                    aria-pressed={node.board === board}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      node.board === board
                        ? 'border-navy-700 bg-navy-50 font-semibold text-navy-900'
                        : 'border-slate-200 text-slate-700 hover:border-navy-300'
                    }`}
                  >
                    <span className="block">{node.board}</span>
                    <span className="block text-xs text-slate-500">
                      {node.total} {node.total === 1 ? 'title' : 'titles'} · {node.in_stock} in stock
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-xs text-slate-500">
                Not seeing your syllabus? The store updates lists when editions change — <Link to="/contact" className="link">ask us</Link>.
              </p>
            </aside>

            <div>
              {activeBoard && (
                <>
                  <div className="mb-4">
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Choose class</h2>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setKlass('')}
                        aria-pressed={klass === ''}
                        className={`rounded-full border px-3 py-1.5 text-sm ${
                          klass === '' ? 'border-navy-700 bg-navy-800 text-white' : 'border-slate-300 bg-white text-slate-700'
                        }`}
                      >
                        All classes
                      </button>
                      {activeBoard.classes.map((node) => (
                        <button
                          key={node.class_level}
                          type="button"
                          onClick={() => setKlass(node.class_level)}
                          aria-pressed={klass === node.class_level}
                          className={`rounded-full border px-3 py-1.5 text-sm ${
                            klass === node.class_level ? 'border-navy-700 bg-navy-800 text-white' : 'border-slate-300 bg-white text-slate-700'
                          }`}
                        >
                          Class {node.class_level}
                          <span className={klass === node.class_level ? 'ml-1 text-navy-200' : 'ml-1 text-slate-400'}>({node.in_stock}/{node.total})</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {(activeClass ? [activeClass] : activeBoard.classes).map((classNode) => (
                    <section key={classNode.class_level} className="card mb-4 overflow-hidden">
                      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
                        <div>
                          <h3 className="text-sm font-semibold text-navy-900">
                            {activeBoard.board} · Class {classNode.class_level}
                          </h3>
                          <p className="text-xs text-slate-500">
                            {classNode.total} title{classNode.total === 1 ? '' : 's'} · {classNode.in_stock} in stock now
                          </p>
                        </div>
                        <Link
                          to={`/products?board=${encodeURIComponent(activeBoard.board)}&class_level=${encodeURIComponent(classNode.class_level)}`}
                          className="btn-secondary btn-sm"
                        >
                          View all in catalogue
                        </Link>
                      </header>
                      <div className="divide-y divide-slate-100">
                        {classNode.subjects.map((subjectNode) => (
                          <div key={subjectNode.subject} className="px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-sm font-medium text-navy-900">{subjectNode.subject}</h4>
                              <Link
                                to={`/products?board=${encodeURIComponent(activeBoard.board)}&class_level=${encodeURIComponent(classNode.class_level)}&subject=${encodeURIComponent(subjectNode.subject)}`}
                                className="text-xs font-semibold text-navy-700 hover:underline"
                              >
                                Filter catalogue →
                              </Link>
                            </div>
                            <ul className="mt-2 space-y-1.5">
                              {subjectNode.items.map((item, index) => (
                                <li
                                  key={`${subjectNode.subject}-${index}`}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm"
                                >
                                  <span className="text-slate-700">
                                    {item.book_type ? BOOK_TYPE_LABEL[item.book_type] || item.book_type : 'Book'}
                                    {item.publisher ? ` · ${item.publisher}` : ''}
                                    {item.academic_year ? ` · ${item.academic_year}` : ''}
                                  </span>
                                  <span className="flex items-center gap-2 text-xs">
                                    <span className="text-slate-500">{item.product_count} listed</span>
                                    {item.in_stock > 0 ? (
                                      <span className="badge-ok">{item.in_stock} in stock</span>
                                    ) : (
                                      <span className="badge-muted">Not in stock / enquiry</span>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}

                  <div className="card p-4 text-sm text-slate-600">
                    <h3 className="text-sm font-semibold text-navy-900">Need a full class set?</h3>
                    <p className="mt-1">
                      Schools, teachers and coaching centres can request a consolidated quotation with quantities instead of ordering title by title.
                    </p>
                    <Link to="/bulk-orders" className="btn-primary btn-sm mt-3">Request a bulk quotation</Link>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
