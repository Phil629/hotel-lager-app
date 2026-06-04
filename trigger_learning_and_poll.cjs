const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://tfsqkzjvonuzmspgqaby.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USER_EMAIL    = 'phdehos@gmail.com';
const USER_PASSWORD = 'WASSER73658hdr/)('

// ── Helper: JWT holen ──────────────────────────────────────────────────────────
async function getJwt() {
  const { data, error } = await supabase.auth.signInWithPassword({ email: USER_EMAIL, password: USER_PASSWORD });
  if (error) throw new Error('JWT-Fehler: ' + error.message);
  return data.session.access_token;
}

// ── Helper: Edge Function aufrufen ─────────────────────────────────────────────
async function callFunction(jwt, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/start-learning`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
      'apikey': SUPABASE_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

// ── Helper: kurz warten ────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Haupt-Funktion ─────────────────────────────────────────────────────────────
async function triggerAndPoll(domain, testProduct = 'Reinigungsmittel') {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 STARTING: ${domain}`);
  console.log(`${'='.repeat(60)}`);

  const jwt = await getJwt();

  // Phase 1+2: learn (Login + Warenkorb)
  console.log(`[${domain}] Phase 1+2: Starte learn...`);
  const learnRes = await callFunction(jwt, { domain, test_product: testProduct, phase: 'learn' });
  if (learnRes.status !== 200) {
    console.error(`[${domain}] Trigger fehlgeschlagen: ${learnRes.status} ${learnRes.text}`);
    return false;
  }
  console.log(`[${domain}] Trigger OK — polling...`);

  const seenMessages = new Set();
  const IN_PROGRESS = new Set(['learning_auth', 'learning_cart', 'verifying', 'none']);
  let lastStatus = 'none';
  let learnDone = false;
  let dryRunTriggered = false;
  let checkCount = 0;

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      checkCount++;
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/shop_playbooks?domain=eq.${domain}&select=*`, {
          headers: { 'apikey': SUPABASE_KEY }
        });
        const [row] = await res.json();
        if (!row) return;

        // Logs ausgeben
        for (const log of (row.learning_logs || []).filter(Boolean)) {
          const key = `${log.timestamp}-${log.message}`;
          if (!seenMessages.has(key)) {
            seenMessages.add(key);
            console.log(`[${domain}][${log.level.toUpperCase()}] ${log.message}`);
          }
        }

        lastStatus = row.automation_status;
        const hasPlaybook = (row.playbook?.item_steps?.length ?? 0) > 0;

        // ── Dry-Run: Poller übernimmt den Trigger ──
        // Wenn learn fertig ist (status learning_cart + vollständiges Playbook)
        // aber kein Dry-Run läuft → Poller triggert direkt
        if (lastStatus === 'learning_cart' && hasPlaybook && !dryRunTriggered) {
          dryRunTriggered = true;
          learnDone = true;
          console.log(`[${domain}] ✅ Playbook gelernt! Poller triggert Dry-Run direkt...`);
          // Kleines Delay damit die Edge Function ihre waitUntil-Arbeit beenden kann
          await sleep(5000);
          const freshJwt = await getJwt();
          const dryRes = await callFunction(freshJwt, { domain, test_product: testProduct, phase: 'dry_run' });
          console.log(`[${domain}] Dry-Run Trigger: ${dryRes.status} ${dryRes.text.substring(0, 80)}`);
        }

        // ── Abschluss: verified oder failed ──
        if (!IN_PROGRESS.has(lastStatus)) {
          clearInterval(interval);
          console.log(`\n[${domain}] --- FERTIG ---`);
          console.log(`[${domain}] Status: ${lastStatus}`);
          if (row.learning_error) console.log(`[${domain}] Fehler: ${row.learning_error.split('\n')[0]}`);
          if (lastStatus === 'verified') {
            console.log(`[${domain}] ✅ VERIFIED!`);
            resolve(true);
          } else {
            console.log(`[${domain}] ❌ FAILED`);
            resolve(false);
          }
          return;
        }

        // Status-Log alle 60s
        if (checkCount % 15 === 0) {
          const step = `[${Math.round(checkCount * 4)}s] status=${lastStatus} playbook=${hasPlaybook} dryRun=${dryRunTriggered}`;
          console.log(`[${domain}] ⏳ ${step}`);
        }

      } catch (err) {
        console.error(`[${domain}] Poll-Fehler: ${err.message}`);
      }

      // Timeout: 15 Minuten
      if (checkCount > 225) {
        console.log(`[${domain}] ⏰ Timeout nach 15 min`);
        clearInterval(interval);
        resolve(false);
      }
    }, 4000);
  });
}

// ── Export / CLI ───────────────────────────────────────────────────────────────
module.exports = { triggerAndPoll };

if (require.main === module) {
  const domain = process.argv[2];
  if (!domain) { console.error('Usage: node trigger_learning_and_poll.cjs <domain>'); process.exit(1); }
  triggerAndPoll(domain).then(ok => process.exit(ok ? 0 : 1));
}
