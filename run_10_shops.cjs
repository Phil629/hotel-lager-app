const { createClient } = require('@supabase/supabase-js');
const { triggerAndPoll } = require('./trigger_learning_and_poll.cjs');

const url = 'https://tfsqkzjvonuzmspgqaby.supabase.co';
const key = process.env.SUPABASE_KEY || '';
const supabase = createClient(url, key);

const shops = [
  'gaerner.de',
  'kaiserkraft.de',
  'printus.de',
  'memo.de',             // ersetzt lusini.com (dauerhafter Cloudflare-Block)
  'jungheinrich-profishop.de',
  'seton.de',
  'staples.de',
  'ratioform.de',
  'rajapack.de',
  'kroschke.de'
];

async function ensureShopExists(shop) {
  const { data: existing } = await supabase
    .from('shop_playbooks')
    .select('domain')
    .eq('domain', shop);

  if (!existing || existing.length === 0) {
    console.log(`[SETUP] Inserting ${shop} into DB...`);
    const { error } = await supabase
      .from('shop_playbooks')
      .insert([{ domain: shop, automation_status: 'none' }]);
    if (error) throw new Error(`DB insert failed for ${shop}: ${error.message}`);
  }
}

async function runShop(shop) {
  try {
    await ensureShopExists(shop);
    console.log(`[START] Launching parallel learning for: ${shop}`);
    const success = await triggerAndPoll(shop);
    console.log(`[DONE] ${shop} -> ${success ? '✅ verified' : '❌ failed'}`);
    return { shop, success };
  } catch (e) {
    console.error(`[ERROR] ${shop}: ${e.message}`);
    return { shop, success: false };
  }
}

async function main() {
  console.log(`\n🚀 Starting ${shops.length} shops with CONCURRENCY LIMIT of 2...\n`);
  
  const results = [];
  let i = 0;
  const CONCURRENCY = 2;
  const workers = Array(CONCURRENCY).fill(null).map(async (_, workerId) => {
    while (i < shops.length) {
      const index = i++;
      const shop = shops[index];
      console.log(`\n[WORKER ${workerId}] Starting ${shop} (${index + 1}/${shops.length})`);
      const result = await runShop(shop);
      results.push(result);
    }
  });
  
  await Promise.all(workers);

  console.log('\n==================== FINAL RESULTS ====================');
  const verified = results.filter(r => r.success);
  const failed   = results.filter(r => !r.success);
  
  console.log(`✅ Verified (${verified.length}): ${verified.map(r => r.shop).join(', ') || 'none'}`);
  console.log(`❌ Failed   (${failed.length}): ${failed.map(r => r.shop).join(', ') || 'none'}`);
  console.log('=======================================================');
  
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
