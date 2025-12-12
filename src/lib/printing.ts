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
    
    if (!settings?.print_server_url) {
      console.warn('Servidor de impressão não configurado.');
      return false;
    }

    const escposData = buildEscPos(ticket, queue);
    
    // Envia apenas os dados ESC/POS - backend busca IP/porta do Supabase
    const response = await fetch(`${settings.print_server_url}/print`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: Array.from(escposData),
      }),
    });

    const data = await response.json();
    
    if (!response.ok || !data.success) {
      console.error('Erro ao enviar impressão:', data.error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('silentPrintTicket error:', e);
    return false;
  }
};
