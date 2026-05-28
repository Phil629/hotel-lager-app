// content-scripts/webapp-bridge.js
// Runs on the hotel-inventory web app page.
// Bridges window.postMessage ↔ chrome.runtime.sendMessage.

const EXPECTED_MESSAGE_TYPE = 'HOTEL_CHECKOUT_START'

window.addEventListener('message', (event) => {
  // Only accept messages from the same origin as the web app
  if (event.origin !== window.location.origin) return

  // NEW: respond to detection pings from the React hook
  if (event.data?.type === 'HOTEL_CHECKOUT_PING') {
    window.postMessage({ type: 'HOTEL_CHECKOUT_EXTENSION_READY' }, window.location.origin)
    return
  }

  if (event.data?.type !== EXPECTED_MESSAGE_TYPE)  return

  const payload = event.data.payload
  if (!payload?.sessionId || !payload?.extensionToken) {
    console.warn('[bridge] Received HOTEL_CHECKOUT_START but payload is missing required fields.')
    return
  }

  console.log('[bridge] Relaying checkout start to service worker. session=', payload.sessionId)

  if (!chrome?.runtime?.sendMessage) {
    console.error('[bridge] chrome.runtime.sendMessage is undefined. Extension was likely reloaded.')
    window.postMessage(
      { type: 'HOTEL_CHECKOUT_ERROR', error: 'Extension-Verbindung abgebrochen. Bitte lade diese Seite neu (F5).' },
      window.location.origin
    )
    return
  }

  chrome.runtime.sendMessage(
    { type: 'CHECKOUT_START', payload },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('[bridge] Service worker unreachable:', chrome.runtime.lastError.message)
        // Notify the web app so it can show an error to the user
        window.postMessage(
          { type: 'HOTEL_CHECKOUT_ERROR', error: 'Extension service worker nicht erreichbar.' },
          window.location.origin
        )
        return
      }
      // Acknowledge back to the web app
      window.postMessage(
        { type: 'HOTEL_CHECKOUT_ACK', sessionId: payload.sessionId },
        window.location.origin
      )
    }
  )
})

// Let the web app know the extension is installed and ready
window.postMessage({ type: 'HOTEL_CHECKOUT_EXTENSION_READY' }, window.location.origin)
