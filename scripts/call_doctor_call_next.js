#!/usr/bin/env node
// scripts/call_doctor_call_next.js
// Chama a edge function 'doctor-call-next' e imprime o resultado

async function loadDotEnv() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const envPath = path.resolve(__dirname, '..', '.env');
    const exists = await fs.promises.access(envPath).then(() => true).catch(() => false);
    if (!exists) return;
    const content = await fs.promises.readFile(envPath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    });
  } catch (e) {}
}

await loadDotEnv();

const doctor_name = process.argv.slice(2).find(a => a.startsWith('--doctor_name='))?.split('=')[1] || process.env.DOCTOR_NAME || 'SuperAdmin';
const doctor_id = process.argv.slice(2).find(a => a.startsWith('--doctor_id='))?.split('=')[1] || process.env.DOCTOR_ID;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE env vars in .env');
  process.exit(1);
}

const fetch = globalThis.fetch || (await import('node-fetch')).default;
const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/doctor-call-next`;
console.log('Calling doctor-call-next with', { doctor_id, doctor_name });

const body = {};
if (doctor_id) body.doctor_id = doctor_id;
if (doctor_name) body.doctor_name = doctor_name;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_KEY}`,
    apikey: SUPABASE_KEY,
  },
  body: JSON.stringify(body),
});
const json = await res.json().catch(() => ({}));
console.log('Response:', JSON.stringify(json, null, 2));

if (json && json.next) {
  console.log('Next ticket status:', json.next.status, 'in_service:', json.next.in_service);
} else {
  console.log('No ticket returned');
}
