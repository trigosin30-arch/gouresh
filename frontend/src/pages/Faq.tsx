import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { EmptyState, ErrorState, SectionHeader, Spinner } from '../components/ui'

type Faq = { id: string; question: string; answer: string; category: string }

export default function Faq() {
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ faqs: Faq[] }>('/api/store/faqs')
      .then((data) => setFaqs(data.faqs))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const grouped = faqs.reduce<Record<string, Faq[]>>((acc, faq) => {
    acc[faq.category] = acc[faq.category] || []
    acc[faq.category].push(faq)
    return acc
  }, {})

  return (
    <>
      <Seo
        title="Frequently asked questions"
        description="Answers about ordering, delivery, store pickup, second-hand book submissions and returns at Ankit Stationery Mart."
        canonicalPath="/faq"
      />
      <div className="shell py-8">
        <SectionHeader
          title="Frequently asked questions"
          subtitle="Maintained by the store in the admin panel — if an answer is missing, the store has not published it yet."
          action={<Link to="/contact" className="btn-secondary btn-sm">Ask us directly</Link>}
        />
        {loading && <Spinner label="Loading FAQs" />}
        {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
        {!loading && !error && faqs.length === 0 && (
          <EmptyState
            title="No FAQs published"
            message="The store has not added FAQs yet. You can still contact the store or read the policy pages."
            action={<Link to="/contact" className="btn-primary">Contact the store</Link>}
            icon="❓"
          />
        )}
        {!loading && !error && faqs.length > 0 && (
          <div className="space-y-6">
            {Object.entries(grouped).map(([category, items]) => (
              <section key={category}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{category}</h2>
                <div className="space-y-2">
                  {items.map((faq) => (
                    <details key={faq.id} className="card p-4">
                      <summary className="cursor-pointer text-sm font-medium text-navy-900">{faq.question}</summary>
                      <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{faq.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
