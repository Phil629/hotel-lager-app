import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value.length) env[key.trim()] = value.join('=').trim().replace(/['"]/g, '');
});

const url = env.TEST_SUPABASE_URL;
const key = env.TEST_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing TEST_SUPABASE_URL or TEST_SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase
    .from('shop_playbooks')
    .select('domain, automation_status, learning_error, learning_logs')
    .eq('domain', 'reinigungsberater.de')
    .single();

  if (error) {
    console.error("Error fetching playbook:", error.message);
    return;
  }

  console.log("Status:", data.automation_status);
  console.log("Error:", data.learning_error);
  console.log("Logs count:", data.learning_logs?.length);
  console.log("Logs:", JSON.stringify(data.learning_logs, null, 2));
}

run();
