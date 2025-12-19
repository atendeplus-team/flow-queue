const express = require('express');
const cors = require('cors');
const net = require('net');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = 3030;

// Diretório para armazenar certificados
const certDir = path.join(__dirname, '.certificates');
const certFile = path.join(certDir, 'server.crt');
const keyFile = path.join(certDir, 'server.key');

// Função para gerar certificado auto-assinado
function generateSelfSignedCert() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
      console.log('[HTTPS] Certificado auto-assinado já existe, usando existente');
      resolve();
      return;
    }

    console.log('[HTTPS] Gerando certificado auto-assinado...');
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }

    const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" -days 365 -nodes -subj "/C=BR/ST=State/L=City/O=Organization/CN=localhost"`;
    
    exec(cmd, (error) => {
      if (error) {
        reject(new Error(`Erro ao gerar certificado: ${error.message}`));
      } else {
        console.log('[HTTPS] Certificado auto-assinado gerado com sucesso');
        resolve();
      }
    });
  });
}

// URL do Supabase (configure via .env ou hardcode temporário)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'your-anon-key';

app.use(cors());
app.use(express.json());

// Função para buscar configurações da impressora do Supabase
async function getPrinterSettings() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?select=printer_ip,printer_port&limit=1`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Erro ao buscar configurações: ${response.status}`);
    }

    const data = await response.json();
    if (!data || data.length === 0) {
      throw new Error('Nenhuma configuração encontrada');
    }

    return {
      printer_ip: data[0].printer_ip,
      printer_port: data[0].printer_port || 9100,
    };
  } catch (error) {
    console.error('Erro ao buscar configurações do Supabase:', error.message);
    return null;
  }
}

app.post('/print', async (req, res) => {
  try {
    const { data } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ success: false, error: 'data array is required' });
    }

    // Busca configurações do Supabase
    const settings = await getPrinterSettings();
    
    if (!settings || !settings.printer_ip) {
      return res.status(400).json({ 
        success: false, 
        error: 'Configurações da impressora não encontradas no Supabase' 
      });
    }

    const { printer_ip, printer_port } = settings;
    const bytes = Buffer.from(data);

    console.log(`[${new Date().toISOString()}] Configurações carregadas: ${printer_ip}:${printer_port}`);
    console.log(`[${new Date().toISOString()}] Conectando a ${printer_ip}:${printer_port}`);
    console.log(`[${new Date().toISOString()}] Enviando ${bytes.length} bytes`);

    const client = new net.Socket();
    
    await new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        client.destroy();
        reject(new Error('Timeout ao conectar na impressora'));
      }, 5000);

      client.connect(printer_port, printer_ip, () => {
        clearTimeout(timeout);
        console.log(`[${new Date().toISOString()}] Conectado à impressora`);
        
        client.write(bytes, (err) => {
          if (err) {
            reject(err);
          } else {
            console.log(`[${new Date().toISOString()}] Dados enviados com sucesso`);
            setTimeout(() => {
              client.end();
              resolve();
            }, 300);
          }
        });
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      client.on('close', () => {
        console.log(`[${new Date().toISOString()}] Conexão fechada`);
      });
    });

    res.json({ success: true, message: 'Impressão enviada com sucesso' });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Função para obter IP local
function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Pula endereços internos e não-IPv4
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Inicializa servidor HTTPS com certificado auto-assinado
async function startServer() {
  try {
    await generateSelfSignedCert();

    const httpsOptions = {
      key: fs.readFileSync(keyFile),
      cert: fs.readFileSync(certFile),
    };

    https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
      const localIP = getLocalIP();
      console.log(`\n========================================`);
      console.log(`Servidor de Impressão ESC/POS rodando (HTTPS)!`);
      console.log(`Porta: ${PORT}`);
      console.log(`\n📱 Configure no sistema:`);
      console.log(`   URL Servidor: https://${localIP}:${PORT}`);
      console.log(`\n🔗 URLs de acesso:`);
      console.log(`   Local: https://localhost:${PORT}/health`);
      console.log(`   Rede:  https://${localIP}:${PORT}/health`);
      console.log(`⚠️  Nota: Certificado auto-assinado (aviso esperado no navegador)`);
      console.log(`========================================\n`);
    });
  } catch (error) {
    console.error('[ERRO] Falha ao iniciar servidor:', error.message);
    process.exit(1);
  }
}

startServer();
