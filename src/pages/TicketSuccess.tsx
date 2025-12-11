import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import {
  CheckCircle,
  Home,
  QrCode,
  Printer,
  Calendar,
  Tag,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { silentPrintTicket } from '@/lib/printing';

interface Ticket {
  id: string;
  display_number: string;
  queue_id: string;
  status: string;
  priority: string;
  created_at: string;
}

interface Queue {
  name: string;
}

// Confirmação da emissão: exibe dados da senha, QR para acompanhamento e opções de impressão
const TicketSuccess = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);

  useEffect(() => {
    if (id) {
      loadTicketInfo(id);
    }
  }, [id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/kiosk');
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  // Impressão automática silenciosa quando o ticket for carregado
  useEffect(() => {
    if (ticket && queue) {
      (async () => {
        await new Promise((r) => setTimeout(r, 300));
        await silentPrintTicket(ticket, queue);
      })();
    }
  }, [ticket, queue]);

  // Carrega dados da senha, dados da fila e conta quantas pessoas estão na frente
  const loadTicketInfo = async (ticketId: string) => {
    const { data: ticketData } = await supabase
      .from('tickets')
      .select('id, display_number, queue_id, status, priority, created_at')
      .eq('id', ticketId)
      .single();

    if (ticketData) {
      setTicket(ticketData);

      // Load queue info
      const { data: queueData } = await supabase
        .from('queues')
        .select('name')
        .eq('id', ticketData.queue_id)
        .single();

      if (queueData) {
        setQueue(queueData);
      }
    }
  };

  const handlePrint = async () => {
    if (ticket && queue) {
      await silentPrintTicket(ticket, queue);
    }
  };

  if (!ticket || !queue) {
    return null;
  }

  // Mapeia rótulos de prioridade para exibição
  const getPriorityLabel = (priority: string) => {
    const labels: Record<string, string> = {
      normal: 'Normal',
      elderly: 'Idoso',
      pregnant: 'Gestante',
      obese: 'Obeso',
      disabled: 'PCD',
      priority: 'Prioridade',
    };
    return labels[priority] || priority;
  };

  return (
    <>
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 0; }
          body * { visibility: hidden; }
          .print-content, .print-content * { visibility: visible; }
          .print-content { position: absolute; left: 0; top: 0; width: 80mm; margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .print-content .bg-gradient-primary { background: #fff !important; }
          .print-content .text-white { color: #000 !important; }
          .print-content .shadow-large { box-shadow: none !important; }
          .ticket-header { display: none !important; }
          .ticket-number { font-size: 48pt; margin: 0 !important; }
          .ticket-queue { font-size: 16pt; font-weight: 600; }
          .ticket-badges { border-top: 1px solid #ddd !important; margin-bottom: -20px !important; }
          .ticket-card { margin-top: 8px !important; padding: 12px !important; }
          .print-content p.mb-8.text-muted-foreground { display: none !important; }
          .qr { display: none !important; }
          .success-icon { display: none !important; }
        }
      `}</style>
      <div className='flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4'>
        <Card className='w-full max-w-2xl p-8 shadow-large md:p-12 print-content'>
          <div className='text-center'>
            <div className='success-icon mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-success/10'>
              <CheckCircle className='h-12 w-12 text-success' />
            </div>

            <p className='mb-8 text-lg text-muted-foreground'>
              Aguarde ser chamado para o atendimento
            </p>

            <div className='ticket-card mb-8 rounded-lg bg-gradient-primary p-8 text-white shadow-large'>
              <p className='ticket-number text-8xl font-bold'>
                {ticket.display_number}
              </p>
              <p className='ticket-queue text-xl font-semibold tracking-wide opacity-95'>
                {queue.name}
              </p>
              <div className='ticket-badges mt-4 pt-4 border-t border-white/20 grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <div className='flex items-center justify-center gap-2 rounded-full bg-white/10 px-3 py-1'>
                  <Calendar className='h-4 w-4 opacity-90' />
                  <span className='text-sm opacity-90'>Data:</span>
                  <span className='text-sm font-semibold opacity-95'>
                    {new Date(ticket.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <div className='flex items-center justify-center gap-2 rounded-full bg-white/10 px-3 py-1'>
                  <Tag className='h-4 w-4 opacity-90' />
                  <span className='text-sm opacity-90'>Tipo:</span>
                  <span className='text-sm font-semibold opacity-95'>
                    {getPriorityLabel(ticket.priority)}
                  </span>
                </div>
              </div>
            </div>

            {/* QR Code para acompanhar a posição na fila em tempo real */}
            <div className='qr mb-8 flex flex-col items-center gap-4 rounded-lg bg-muted p-6'>
              <div className='rounded-lg bg-white p-4'>
                <QRCodeSVG
                  value={`${window.location.origin}/track?id=${ticket.id}`}
                  size={180}
                  level='H'
                />
              </div>
              <div className='text-center'>
                <div className='flex items-center justify-center gap-2 text-foreground'>
                  <QrCode className='h-5 w-5' />
                  <p className='font-semibold'>Escaneie para acompanhar</p>
                </div>
                <p className='mt-1 text-sm text-muted-foreground'>
                  Veja sua posição na fila em tempo real
                </p>
              </div>
            </div>

            {/* Ações: imprimir com corte (via QZ) e voltar ao início */}
            <div className='no-print grid gap-3 sm:grid-cols-2'>
              <Button
                size='lg'
                onClick={handlePrint}
                className='w-full bg-gradient-primary'
              >
                <Printer className='mr-2 h-5 w-5' />
                Imprimir Senha
              </Button>

              <Button
                size='lg'
                variant='outline'
                onClick={() => navigate('/kiosk')}
                className='w-full'
              >
                <Home className='mr-2 h-5 w-5' />
                Voltar ao Início
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
};

export default TicketSuccess;
