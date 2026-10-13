// Opens the Job Agent app with the job in the URL fragment (never sent to a server)
const DEFAULT_APP = 'https://pojithakarunathilake99.github.io/job-agent/'

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'save-job') return
  chrome.storage.sync.get({ appUrl: DEFAULT_APP }).then(({ appUrl }) => {
    const payload = encodeURIComponent(JSON.stringify(msg.job))
    chrome.tabs.create({ url: `${appUrl}#/import/${payload}` })
    reply({ ok: true })
  })
  return true
})
