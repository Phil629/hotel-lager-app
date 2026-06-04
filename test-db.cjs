const fs = require('fs');
const text = fs.readFileSync('.env', 'utf8');
const env = Object.fromEntries(text.split('\n').filter(l => l.includes('=')).map(l => { const p = l.split('='); return [p[0].trim(), p.slice(1).join('=').trim().replace(/['"]/g, '')] }));

fetch(env.VITE_SUPABASE_URL + '/rest/v1/selector_heal_log?select=*&order=created_at.desc&limit=1', {
  headers: {
    'apikey': env.VITE_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + env.VITE_SUPABASE_ANON_KEY
  }
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2))).catch(console.error);
