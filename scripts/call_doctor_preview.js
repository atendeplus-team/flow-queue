#!/usr/bin/env node
// scripts/call_doctor_preview.js
// Chama a edge function 'doctor-queue-preview' e imprime o resultado formatado

// Usar globalThis.fetch (Node 18+) ou importar dinamicamente se necessário
// (Não dependemos de require porque o projeto usa ESM - "type": "module")

// Carrega .env da raiz do repositório automaticamente (sem depender de dotenv)
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
  } catch (e) {
    // ignore
  }
}

await loadDotEnv();

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  args.forEach((arg) => {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      out[k] = v ?? true;
    }
  });
  return out;
}

(async function main() {
  try {
    const args = parseArgs();
    const doctor_id = args.doctor_id || args.doctorId || process.env.DOCTOR_ID || null;
    const doctor_name = args.doctor_name || args.doctorName || process.env.DOCTOR_NAME || null;

    if (!doctor_id && !doctor_name) {
      console.error('ERROR: Forneça --doctor_id=<id> ou --doctor_name="Nome" ou variáveis DOCTOR_ID/DOCTOR_NAME.');
      process.exit(1);
    }

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_PROJECT_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error('ERROR: Defina SUPABASE_URL/SUPABASE_ANON_KEY (ou use VITE_SUPABASE_URL & VITE_SUPABASE_PUBLISHABLE_KEY no .env).');
      process.exit(1);
    }

    const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/doctor-queue-preview`;

    const body = {};
    if (doctor_id) body.doctor_id = doctor_id;
    if (doctor_name) body.doctor_name = doctor_name;

    console.log('Calling doctor-queue-preview with:', body);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({ success: false, error: 'invalid json' }));

    console.log('\nRaw response:');
    console.log(JSON.stringify(json, null, 2));

    if (!json || !json.success || !Array.isArray(json.items)) {
      console.error('\nNo items returned or error.');
      process.exit(1);
    }

    console.log('\nLista exibida (formatada):');
    json.items.forEach((it, idx) => {
      const time = it.created_at ? new Date(it.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      const priorityLabel = (it.priority && it.priority !== 'normal') ? 'Preferencial' : 'Normal';
      const urgentLabel = it.urgent ? 'Urgente' : '';
      console.log(`${idx + 1}  ${it.display_number}  ${priorityLabel}  ${urgentLabel}  ${time}`);
    });

  } catch (e) {
    console.error('Error calling function:', e);
    process.exit(1);
  }
})();