(() => {
// content-scripts/automation-worker.js
// Injected by the service worker into the supplier shop tab.
// Executes individual DOM commands and replies via sendResponse.

// Prevent double-injection if the tab navigates and the script is re-injected.
if (window.__checkoutWorkerActive) {
  console.log('[worker] Already active - skipping re-init.')
} else {
  window.__checkoutWorkerActive = true
  console.log('[worker] Automation worker initialised.')

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'DOM_ACTION') return false

    handleDomAction(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }))

    return true // keep channel open for async sendResponse
  })
}

// ── DOM action dispatcher ─────────────────────────────────────────────────────

async function handleDomAction({ command, selector, value, timeout = 8000 }) {
  switch (command) {
    case 'FILL':       return fill(selector, value, timeout)
    case 'CLICK':      return click(selector, timeout)
    case 'GET_TEXT':   return getText(selector, timeout)
    case 'GET_HTML':   return { success: true, html: document.documentElement.outerHTML }
    case 'KEY_PRESS':  return keyPress(value)
    case 'WAIT_READY': return waitForReady(timeout)
    case 'CHECK_EXISTS': return checkExists(selector, timeout)
    default:
      return { success: false, error: `Unknown command: ${command}` }
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

function isInteractable(el) {
  if (el.type === 'hidden') return false
  if (el.disabled) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none') return false
  if (style.visibility === 'hidden') return false
  if (parseFloat(style.opacity) === 0) return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  return true
}

async function fill(selector, value, timeout) {
  const el = await waitForElement(selector, timeout, true)
  if (!el) {
    throw new Error(`Element not found or not interactable: ${selector}`)
  }

  // Use native value setter so React/Vue synthetic events fire correctly
  const proto = Object.getPrototypeOf(el)
  const descriptor =
    Object.getOwnPropertyDescriptor(proto, 'value') ||
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')

  if (descriptor?.set) {
    descriptor.set.call(el, value)
  } else {
    el.value = value
  }

  el.dispatchEvent(new Event('input',  { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))

  return { success: true }
}

async function click(selector, timeout) {
  const el = await waitForElement(selector, timeout, true)
  if (!el) {
    throw new Error(`Element not found or not interactable: ${selector}`)
  }
  el.scrollIntoView({ block: 'center', behavior: 'instant' })
  el.click()
  return { success: true }
}

async function getText(selector, timeout) {
  const el = await waitForElement(selector, timeout, false)
  return { success: true, text: el ? (el.textContent?.trim() ?? '') : '' }
}

async function keyPress(key) {
  const active = document.activeElement
  if (key === 'Enter' && active && active.tagName === 'INPUT') {
    const form = active.closest('form')
    if (form) {
      const btn = form.querySelector('button[type="submit"], input[type="submit"]')
      if (btn) btn.click()
      else form.submit()
      return { success: true }
    }
  }
  active?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  active?.dispatchEvent(new KeyboardEvent('keyup',   { key, bubbles: true }))
  return { success: true }
}

async function waitForReady(timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (document.readyState === 'complete') return { success: true }
    await sleep(200)
  }
  // Non-fatal: page may still be functional even if not fully "complete"
  return { success: true, warning: 'readyState timeout — page may still be loading' }
}

async function checkExists(selector, timeout) {
  try {
    await waitForElement(selector, timeout)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function waitForElement(selector, timeout, requireInteractable = false) {
  return new Promise((resolve, reject) => {
    
    function findMatch() {
      const elements = document.querySelectorAll(selector)
      for (const el of elements) {
        if (!requireInteractable || isInteractable(el)) return el
      }
      return null
    }

    const initial = findMatch()
    if (initial) return resolve(initial)

    let settled = false
    function done(result, err) {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(result)
    }

    const observer = new MutationObserver(() => {
      const found = findMatch()
      if (found) {
        done(found, null)
      }
    })
    
    observer.observe(document.body, { childList: true, subtree: true })
    const timer = setTimeout(
      () => done(null, new Error(`Timeout: ${selector} (requireInteractable: ${requireInteractable})`)),
      timeout
    )
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
})();