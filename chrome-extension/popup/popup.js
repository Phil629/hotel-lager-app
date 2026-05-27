// popup/popup.js

const dot     = document.getElementById('statusDot')
const label   = document.getElementById('statusLabel')
const message = document.getElementById('statusMessage')
const info    = document.getElementById('supplierInfo')
const btnTab  = document.getElementById('btnOpenTab')
const btnCancel = document.getElementById('btnCancel')

const STATUS_CONFIG = {
  idle:       { dot: 'dot-idle',   text: 'Bereit',           showMessage: false },
  starting:   { dot: 'dot-active', text: 'Startet…',         showMessage: true  },
  logging_in: { dot: 'dot-active', text: 'Loggt ein…',       showMessage: true  },
  searching:  { dot: 'dot-active', text: 'Sucht Produkte…',  showMessage: true  },
  adding:     { dot: 'dot-active', text: 'Befüllt Warenkorb…', showMessage: true },
  price_check:{ dot: 'dot-active', text: 'Prüft Preise…',    showMessage: true  },
  ready:      { dot: 'dot-ready',  text: '✅ Warenkorb bereit', showMessage: true },
  error:      { dot: 'dot-error',  text: '❌ Fehler',          showMessage: true  },
}

async function render() {
  const { activeSession } = await chrome.storage.session.get('activeSession')

  if (!activeSession) {
    applyStatus('idle')
    return
  }

  const cfg = STATUS_CONFIG[activeSession.status] ?? STATUS_CONFIG.idle
  applyStatus(activeSession.status)

  if (cfg.showMessage && activeSession.error) {
    message.textContent = activeSession.error
    message.style.display = 'block'
  } else if (cfg.showMessage) {
    message.style.display = 'none'
  }

  if (activeSession.supplierId) {
    info.textContent = `Session: \${activeSession.sessionId?.substring(0, 8)}…`
    info.style.display = 'block'
  }

  // Show "Tab öffnen" if session is ready
  if (activeSession.status === 'ready' && activeSession.tabId) {
    btnTab.style.display = 'block'
    btnTab.onclick = () => {
      chrome.tabs.update(activeSession.tabId, { active: true })
      window.close()
    }
  } else {
    btnTab.style.display = 'none'
  }

  // Show cancel button while active
  const isActive = ['starting','logging_in','searching','adding','price_check'].includes(activeSession.status)
  btnCancel.style.display = isActive ? 'block' : 'none'
}

function applyStatus(status) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle
  dot.className = `status-dot \${cfg.dot}`
  label.textContent = cfg.text
  message.style.display = cfg.showMessage ? 'block' : 'none'
}

btnCancel.addEventListener('click', async () => {
  await chrome.storage.session.remove('activeSession')
  // Note: does not close the tab or update the session in DB —
  // the web app will detect the 'expired' status via its own timeout.
  render()
})

// Initial render + poll for updates
render()
setInterval(render, 1500)
