import { useEffect } from 'react'

type SeoProps = {
  title: string
  description?: string
  canonicalPath?: string
  noindex?: boolean
  structuredData?: Record<string, unknown> | null
  image?: string | null
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attr, key)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

/** Manages document head for SPA routes (in addition to the server-rendered sitemap). */
export default function Seo({ title, description, canonicalPath, noindex, structuredData, image }: SeoProps) {
  useEffect(() => {
    const fullTitle = title.includes('Ankit Stationery Mart') ? title : `${title} · Ankit Stationery Mart`
    document.title = fullTitle
    if (description) {
      setMeta('name', 'description', description)
      setMeta('property', 'og:description', description)
    }
    setMeta('property', 'og:title', fullTitle)
    setMeta('name', 'twitter:title', fullTitle)
    if (image) {
      setMeta('property', 'og:image', image)
      setMeta('name', 'twitter:image', image)
    }
    setMeta('name', 'robots', noindex ? 'noindex,nofollow' : 'index,follow')

    if (canonicalPath) {
      let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'canonical'
        document.head.appendChild(link)
      }
      link.href = `${window.location.origin}${canonicalPath}`
      setMeta('property', 'og:url', link.href)
    }

    let script: HTMLScriptElement | null = null
    if (structuredData) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      script.text = JSON.stringify(structuredData)
      document.head.appendChild(script)
    }
    return () => {
      if (script) script.remove()
    }
  }, [title, description, canonicalPath, noindex, structuredData, image])

  return null
}
