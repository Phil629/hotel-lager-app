const fs = require('fs');

async function run() {
  const env = fs.readFileSync('.env', 'utf8');
  const url = env.match(/VITE_SUPABASE_URL=(.+)/)[1].trim();
  const key = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim();
  
  const res = await fetch(`${url}/rest/v1/products?url=eq.https://www.reinigungsberater.de/`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({ url: null })
  });
  console.log(res.status, await res.text());
}
run();
