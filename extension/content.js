(() => {
  const host = location.hostname
  const SITE = host.includes('linkedin') ? 'linkedin' : host.includes('indeed') ? 'indeed' : host.includes('cv-library') ? 'cvlibrary' : null
  if (!SITE) return

  const txt = el => (el?.innerText || el?.textContent || '').replace(/\s+\n/g, '\n').trim()
  const q = sels => { for (const s of sels) { const el = document.querySelector(s); if (el && txt(el)) return el } return null }
  const htmlToText = html => new DOMParser().parseFromString(html || '', 'text/html').body.innerText?.trim() || ''

  // 1) Structured data (schema.org JobPosting) when the page provides it
  function fromJsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent)
        const items = Array.isArray(data) ? data : data['@graph'] || [data]
        const jp = items.find(x => x && [].concat(x['@type']).includes('JobPosting'))
        if (!jp) continue
        const addr = [].concat(jp.jobLocation || [])[0]?.address || {}
        return {
          title: jp.title,
          company: jp.hiringOrganization?.name,
          location: [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', '),
          description: htmlToText(jp.description),
          postedAt: jp.datePosted,
        }
      } catch { /* ignore bad JSON */ }
    }
    return {}
  }

  // 2) Page elements (best effort; sites change their markup)
  const SEL = {
    linkedin: {
      title: ['.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.top-card-layout__title', 'h1'],
      company: ['.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link'],
      location: ['.job-details-jobs-unified-top-card__primary-description-container .tvm__text', '.job-details-jobs-unified-top-card__bullet', '.topcard__flavor--bullet'],
      description: ['#job-details', '.jobs-description__content', '.show-more-less-html__markup', '.description__text'],
    },
    indeed: {
      title: ['[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title'],
      company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]'],
      location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'],
      description: ['#jobDescriptionText'],
    },
    cvlibrary: {
      title: ['h1.job__title', '.job__title', 'h1'],
      company: ['.job__header-posted-by a', '.job__company', '[itemprop="hiringOrganization"]'],
      location: ['.job__header-location', '[itemprop="jobLocation"]'],
      description: ['.job__description', '#job-description', '[itemprop="description"]'],
    },
  }[SITE]

  function fromDom() {
    return {
      title: txt(q(SEL.title)),
      company: txt(q(SEL.company)),
      location: txt(q(SEL.location)),
      description: txt(q(SEL.description)),
    }
  }

  // Canonical job URL (drops tracking params)
  function jobUrl() {
    const u = new URL(location.href)
    if (SITE === 'linkedin') {
      const id = u.searchParams.get('currentJobId') || (u.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1]
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`
    }
    if (SITE === 'indeed') {
      const jk = u.searchParams.get('jk') || u.searchParams.get('vjk')
      if (jk) return `https://${u.hostname}/viewjob?jk=${jk}`
    }
    return u.origin + u.pathname
  }

  function extract() {
    const ld = SITE === 'linkedin' ? {} : fromJsonLd() // LinkedIn's JSON-LD can describe a different job in split view
    const dom = fromDom()
    const pick = k => (ld[k] || dom[k] || '').toString().trim()
    return {
      source: SITE,
      url: jobUrl(),
      title: pick('title'),
      company: pick('company'),
      location: pick('location'),
      description: pick('description').slice(0, 20000),
      postedAt: ld.postedAt || undefined,
    }
  }

  function toast(msg) {
    const t = document.createElement('div')
    t.className = 'ja-toast'
    t.textContent = msg
    document.body.appendChild(t)
    setTimeout(() => t.remove(), 3500)
  }

  const btn = document.createElement('button')
  btn.className = 'ja-save-btn'
  btn.textContent = 'Save to RoleScout'
  btn.addEventListener('click', () => {
    const job = extract()
    console.log('[Job Agent] extracted', job)
    if (!job.title || !job.company) { toast('Open a job first (title/company not found)'); return }
    toast(`Saving: ${job.title} — ${job.company}`)
    chrome.runtime.sendMessage({ type: 'save-job', job })
  })
  document.body.appendChild(btn)
})()
