// popup/popup.js

const dot           = document.getElementById('statusDot')
const label         = document.getElementById('statusLabel')
const message       = document.getElementById('statusMessage')
const info          = document.getElementById('supplierInfo')
const btnTab        = document.getElementById('btnOpenTab')
const btnReport     = document.getElementById('btnReport')
const btnCancel     = document.getElementById('btnCancel')
const feedbackModal = document.getElementById('feedbackModal')
const feedbackBody  = document.getElementById('feedbackBody')
const btnFeedbackConfirm = document.getElementById('btnFeedbackConfirm')
const btnFeedbackCancel  = document.getElementById('btnFeedbackCancel')

const STATUS_CONFIG = {
  idle:       { dot: 'dot-idle',   text: 'Bereit',              showMessage: false },
  starting:   { dot: 'dot-active', text: 'Startet…',            showMessage: true  },
  logging_in: { dot: 'dot-active', text: 'Loggt ein…',          showMessage: true  },
  searching:  { dot: 'dot-active', text: 'Sucht Produkte…',     showMessage: true  },
  adding:     { dot: 'dot-active', text: 'Befüllt Warenkorb…',  showMessage: true  },
  price_check:{ dot: 'dot-active', text: 'Prüft Preise…',       showMessage: true  },
  ready:      { dot: 'dot-ready',  text: '✅ Warenkorb bereit', showMessage: true  },
  error:      { dot: 'dot-error',  text: '❌ Fehler',           showMessage: true  },
}

async function render() {
  const { activeSession } = await chrome.storage.session.get('activeSession')

  if (!activeSession) {
    applyStatus('idle')
    btnTab.style.display    = 'none'
    btnReport.style.display = 'none'
    btnCancel.style.display = 'none'
    return
  }

  const cfg = STATUS_CONFIG[activeSession.status] ?? STATUS_CONFIG.idle
  applyStatus(activeSession.status)

  if (cfg.showMessage && activeSession.error) {
    message.textContent  = activeSession.error
    message.style.display = 'block'
  } else if (cfg.showMessage) {
    message.style.display = 'none'
  }

  if (activeSession.supplierId) {
    info.textContent    = `Session: ${activeSession.sessionId?.substring(0, 8)}…`
    info.style.display  = 'block'
  }

  // Show "Tab öffnen" and "Fehlschlag melden" only when ready
  if (activeSession.status === 'ready' && activeSession.tabId) {
    btnTab.style.display    = 'block'
    btnTab.onclick = () => {
      chrome.tabs.update(activeSession.tabId, { active: true })
      window.close()
    }
    btnReport.style.display = 'block'
  } else {
    btnTab.style.display    = 'none'
    btnReport.style.display = 'none'
  }

  // Show cancel button while active
  const isActive = ['starting','logging_in','searching','adding','price_check'].includes(activeSession.status)
  btnCancel.style.display = isActive ? 'block' : 'none'
}

function applyStatus(status) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle
  dot.className          = `status-dot ${cfg.dot}`
  label.textContent      = cfg.text
  message.style.display  = cfg.showMessage ? 'block' : 'none'
}

// ── Cancel Button ─────────────────────────────────────────────────────────────

btnCancel.addEventListener('click', async () => {
  await chrome.storage.session.remove('activeSession')
  render()
})

// ── Feedback Modal ────────────────────────────────────────────────────────────

btnReport.addEventListener('click', () => {
  // Reset to default state
  const firstRadio = feedbackBody.querySelector('input[type=radio]')
  if (firstRadio) firstRadio.checked = true
  showFeedbackModal(true)
})

btnFeedbackCancel.addEventListener('click', () => {
  showFeedbackModal(false)
})

feedbackModal.addEventListener('click', (e) => {
  if (e.target === feedbackModal) showFeedbackModal(false)
})

btnFeedbackConfirm.addEventListener('click', async () => {
  const selected = feedbackBody.querySelector('input[name=feedbackReason]:checked')
  if (!selected) return

  const reason = selected.value

  btnFeedbackConfirm.disabled    = true
  btnFeedbackConfirm.textContent = 'Wird gesendet…'

  try {
    const { sessionAuth } = await chrome.storage.session.get('sessionAuth')

    if (!sessionAuth?.supabaseUrl || !sessionAuth?.userJwt || !sessionAuth?.supplierId) {
      throw new Error('Session-Daten fehlen. Bitte starte die App neu.')
    }

    const { supabaseUrl, supabaseAnonKey, userJwt, supplierId } = sessionAuth

    const noteByReason = {
      automation_error: 'Kunde meldet: Klick ging ins Leere / Seite nicht erkannt.',
      stock_issue:      'Kunde meldet: Produkt vorübergehend nicht verfügbar.',
      support_needed:   'Kunde bittet um manuellen Support.',
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/report_checkout_failure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        supabaseAnonKey,
        'Authorization': `Bearer ${userJwt}`,
      },
      body: JSON.stringify({
        p_supplier_id: supplierId,
        p_reason:      reason,
        p_note:        noteByReason[reason] ?? null,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unbekannter Fehler')
      throw new Error(`Server: ${errText.substring(0, 120)}`)
    }

    // Show success message inside modal
    showFeedbackResult(reason)

    // Clear session after reporting automation error (triggers re-learning)
    if (reason === 'automation_error') {
      await chrome.storage.session.remove('activeSession')
      setTimeout(() => { showFeedbackModal(false); render() }, 2500)
    } else {
      setTimeout(() => showFeedbackModal(false), 2000)
    }

  } catch (err) {
    showFeedbackError(err.message)
  } finally {
    btnFeedbackConfirm.disabled    = false
    btnFeedbackConfirm.textContent = 'Senden'
  }
})

function showFeedbackModal(show) {
  feedbackModal.style.display = show ? 'flex' : 'none'
  // Restore form if reopened after an error/result message
  if (show) {
    feedbackBody.innerHTML = `
      <label class="radio-option">
        <input type="radio" name="feedbackReason" value="automation_error" checked>
        <div>
          <div class="option-label">Automation hatte einen Fehler</div>
          <div class="option-desc">Ein Klick ging ins Leere oder die Seite wurde nicht erkannt.</div>
        </div>
      </label>
      <label class="radio-option">
        <input type="radio" name="feedbackReason" value="stock_issue">
        <div>
          <div class="option-label">Produkt war vergriffen / nicht lieferbar</div>
          <div class="option-desc">Kein technisches Problem — nur vorübergehend nicht verfügbar.</div>
        </div>
      </label>
      <label class="radio-option">
        <input type="radio" name="feedbackReason" value="support_needed">
        <div>
          <div class="option-label">Sonstiges — Support benötigt</div>
          <div class="option-desc">Ein Support-Ticket wird erstellt.</div>
        </div>
      </label>
    `
    btnFeedbackConfirm.style.display = 'block'
    btnFeedbackCancel.style.display  = 'block'
  }
}

function showFeedbackResult(reason) {
  const MESSAGES = {
    automation_error: '✅ Gemeldet! Unser System wird den Shop in Kürze neu kartografieren.',
    stock_issue:      '✅ Danke für das Feedback! Kein Handlungsbedarf.',
    support_needed:   '✅ Support-Ticket erstellt! Wir melden uns bald.',
  }
  feedbackBody.innerHTML = `<div class="feedback-result">${MESSAGES[reason] ?? '✅ Feedback gesendet.'}</div>`
  btnFeedbackConfirm.style.display = 'none'
  btnFeedbackCancel.textContent    = 'Schließen'
}

function showFeedbackError(msg) {
  feedbackBody.innerHTML = `
    <div style="padding:10px; background:#fee2e2; border-radius:6px; color:#b91c1c; font-size:12px;">
      Fehler beim Senden: ${msg}
    </div>
  `
}

// ── Initial render + poll ─────────────────────────────────────────────────────

render()
setInterval(render, 1500)
