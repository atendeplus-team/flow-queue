import { supabase } from '@/integrations/supabase/client';

export interface PrinterSettings {
  print_server_url?: string | null;
  printer_ip?: string | null;
  printer_port?: number | null;
}

export interface MinimalTicket {
  id: string;
  display_number: string;
  priority: string;
  created_at: string;
}

export interface MinimalQueue {
  name: string;
}

const buildEscPos = (t: MinimalTicket, q: MinimalQueue): Uint8Array => {
  const bytes: number[] = [];
  const enc = new TextEncoder();
  const push = (...arr: number[]) => bytes.push(...arr);

  // init
  push(0x1b, 0x40);
  // align center
  push(0x1b, 0x61, 0x01);

  // title
  push(0x1b, 0x45, 0x01);
  bytes.push(...enc.encode(`${q.name}\n`));
  push(0x1b, 0x45, 0x00);

  // big number (double size)
  push(0x1d, 0x21, 0x11);
  bytes.push(...enc.encode(`${t.display_number}\n`));
  push(0x1d, 0x21, 0x00);

  const pt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(t.created_at));
  bytes.push(...enc.encode(`${pt}\n`));
  bytes.push(...enc.encode(`${(t.priority || '').toString().toUpperCase()}\n\n`));

  // feed and cut
  push(0x0a, 0x0a, 0x0a);
  push(0x1d, 0x56, 0x00);

  return new Uint8Array(bytes);
};

export const getPrinterSettings = async (): Promise<PrinterSettings | null> => {
  try {
    const { data } = await supabase
      .from('company_settings')
      .select('print_server_url, printer_ip, printer_port')
      .limit(1)
      .single();
    return (data as any) || null;
  } catch {
    return null;
  }
};

export const silentPrintTicket = async (
  ticket: MinimalTicket,
  queue: MinimalQueue
): Promise<boolean> => {
  try {
    const settings = await getPrinterSettings();
    
    // Se houver servidor remoto configurado, envia para lá
    if (settings?.print_server_url) {
      if (!settings.printer_ip) {
        console.error('printer_ip não configurado nas company_settings');
        return false;
      }

      const printerPort = settings.printer_port || 9100;
      const escpos = buildEscPos(ticket, queue);
      const data = Array.from(escpos);
      const payload = { data, printer_ip: settings.printer_ip, printer_port: printerPort };

      // Se estiver em HTTPS e o print_server_url for HTTP, faz fallback para Edge Function (HTTPS)
      if (
        typeof window !== 'undefined' &&
        window.location?.protocol === 'https:' &&
        settings.print_server_url.startsWith('http:')
      ) {
        try {
          const { data: fnData, error } = await (supabase as any).functions.invoke('print-ticket', {
            body: payload,
          });
          if (error || !fnData?.success) {
            console.error('Falha na função print-ticket:', error || fnData);
            return false;
          }
          console.log('Ticket impresso via Edge Function (HTTPS)');
          return true;
        } catch (err) {
          console.error('Erro ao chamar função print-ticket:', err);
          return false;
        }
      }

      // Caso normal: chama o servidor de impressão diretamente
      try {
        const response = await fetch(`${settings.print_server_url}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Erro ao imprimir no servidor remoto:', response.status, errorText);
          return false;
        }

        console.log('Ticket impresso com sucesso no servidor remoto');
        return true;
      } catch (err) {
        console.error('Erro de rede ao chamar servidor de impressão:', err);
        return false;
      }
    }

    // Fallback: Impressão local no Windows (quando sem servidor remoto)
    const pt = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(ticket.created_at));

    const getPriorityLabel = (priority: string) => {
      const labels: Record<string, string> = {
        normal: 'Normal',
        elderly: 'Idoso',
        pregnant: 'Gestante',
        disabled: 'PcD',
      };
      return labels[priority] || priority;
    };

    // Cria uma janela oculta para impressão
    const printWindow = window.open('', '_blank', 'width=300,height=400');
    if (!printWindow) {
      console.error('Não foi possível abrir janela de impressão');
      return false;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Impressão Senha</title>
        <style>
          @page {
            size: 80mm auto;
            margin: 0;
          }
          body {
            font-family: 'Courier New', monospace;
            text-align: center;
            padding: 10px;
            margin: 0;
          }
          .queue-name {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .ticket-number {
            font-size: 48px;
            font-weight: bold;
            margin: 20px 0;
          }
          .info {
            font-size: 12px;
            margin: 5px 0;
          }
        </style>
      </head>
      <body>
        <div class="queue-name">${queue.name}</div>
        <div class="ticket-number">${ticket.display_number}</div>
        <div class="info">${pt}</div>
        <div class="info">${getPriorityLabel(ticket.priority)}</div>
      </body>
      </html>
    `);

    printWindow.document.close();
    
    // Aguarda o carregamento e imprime
    setTimeout(() => {
      printWindow.print();
      setTimeout(() => {
        printWindow.close();
      }, 500);
    }, 250);

    return true;
  } catch (e) {
    console.error('silentPrintTicket error:', e);
    return false;
  }
};
