import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import {
  Ticket,
  Phone,
  Repeat,
  UserCheck,
  XCircle,
  Stethoscope,
  CheckCircle,
  Clock,
  ArrowRight,
  Loader2,
  Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface TicketHistoryEvent {
  id: string;
  ticket_id: string;
  doctor_ticket_id: string | null;
  display_number: string;
  event_type: string;
  event_description: string;
  operator_id: string | null;
  operator_name: string | null;
  counter: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  consultorio: string | null;
  patient_name: string | null;
  operator_call_count: number;
  doctor_call_count: number;
  cancellation_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface TicketHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  displayNumber: string;
}

const eventConfig: Record<string, { icon: React.ReactNode; color: string; bgColor: string }> = {
  emitido: {
    icon: <Ticket className="h-4 w-4" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
  },
  chamado_operador: {
    icon: <Phone className="h-4 w-4" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
  },
  repetido_operador: {
    icon: <Repeat className="h-4 w-4" />,
    color: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
  },
  encaminhado: {
    icon: <ArrowRight className="h-4 w-4" />,
    color: 'text-green-600',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
  },
  atendido_operador: {
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-green-600',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
  },
  cancelado_operador: {
    icon: <XCircle className="h-4 w-4" />,
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
  },
  chamado_medico: {
    icon: <Stethoscope className="h-4 w-4" />,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
  },
  repetido_medico: {
    icon: <Repeat className="h-4 w-4" />,
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/20',
  },
  confirmado_chegada: {
    icon: <UserCheck className="h-4 w-4" />,
    color: 'text-teal-600',
    bgColor: 'bg-teal-100 dark:bg-teal-900/30',
  },
  finalizado_medico: {
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
  },
  cancelado_medico: {
    icon: <XCircle className="h-4 w-4" />,
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
  },
};

const TicketHistoryModal = ({
  open,
  onOpenChange,
  ticketId,
  displayNumber,
}: TicketHistoryModalProps) => {
  const [events, setEvents] = useState<TicketHistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && ticketId) {
      loadHistory();
    }
  }, [open, ticketId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      // Usando any porque a tabela ainda não está nos tipos gerados do Supabase
      const { data, error } = await (supabase as any)
        .from('ticket_history')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Erro ao carregar histórico:', error);
        return;
      }

      setEvents((data as TicketHistoryEvent[]) || []);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      time: date.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };
  };

  const getEventConfig = (eventType: string) => {
    return eventConfig[eventType] || {
      icon: <Clock className="h-4 w-4" />,
      color: 'text-gray-600',
      bgColor: 'bg-gray-100 dark:bg-gray-800',
    };
  };

  // Calcular estatísticas
  const operatorCalls = events.filter(
    (e) => e.event_type === 'chamado_operador' || e.event_type === 'repetido_operador'
  ).length;
  const doctorCalls = events.filter(
    (e) => e.event_type === 'chamado_medico' || e.event_type === 'repetido_medico'
  ).length;
  const patientName = events.find((e) => e.patient_name)?.patient_name;
  const operatorName = events.find((e) => e.operator_name)?.operator_name;
  const doctorName = events.find((e) => e.doctor_name)?.doctor_name;

  const downloadExcel = () => {
    // Preparar dados para o Excel
    const excelData = events.map((event) => {
      const { date, time } = formatDateTime(event.created_at);
      return {
        'Data': date,
        'Hora': time,
        'Senha': displayNumber,
        'Evento': event.event_description,
        'Tipo': event.event_type,
        'Paciente': event.patient_name || '-',
        'Operador': event.operator_name || '-',
        'Guichê': event.counter || '-',
        'Médico': event.doctor_name || '-',
        'Consultório': event.consultorio || '-',
        'Chamadas Operador': event.operator_call_count || 0,
        'Chamadas Médico': event.doctor_call_count || 0,
        'Motivo Cancelamento': event.cancellation_reason || '-',
      };
    });

    // Criar workbook e worksheet
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Histórico');

    // Ajustar largura das colunas
    const colWidths = [
      { wch: 12 }, // Data
      { wch: 10 }, // Hora
      { wch: 10 }, // Senha
      { wch: 50 }, // Evento
      { wch: 20 }, // Tipo
      { wch: 25 }, // Paciente
      { wch: 20 }, // Operador
      { wch: 10 }, // Guichê
      { wch: 25 }, // Médico
      { wch: 15 }, // Consultório
      { wch: 16 }, // Chamadas Operador
      { wch: 16 }, // Chamadas Médico
      { wch: 40 }, // Motivo Cancelamento
    ];
    ws['!cols'] = colWidths;

    // Download do arquivo
    const fileName = `historico_senha_${displayNumber}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Histórico da Senha
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>
              Linha do tempo completa da senha{' '}
              <Badge variant="secondary" className="ml-1">
                {displayNumber}
              </Badge>
            </span>
            <Button
              onClick={downloadExcel}
              size="sm"
              variant="outline"
              disabled={events.length === 0 || loading}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Baixar Excel
            </Button>
          </DialogDescription>
        </DialogHeader>

        {/* Estatísticas Resumidas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-3 border-b">
          {patientName && (
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Paciente</p>
              <p className="text-sm font-semibold truncate" title={patientName}>
                {patientName}
              </p>
            </div>
          )}
          {operatorName && (
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Operador</p>
              <p className="text-sm font-semibold truncate" title={operatorName}>
                {operatorName}
              </p>
            </div>
          )}
          {doctorName && (
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Médico</p>
              <p className="text-sm font-semibold truncate" title={doctorName}>
                {doctorName}
              </p>
            </div>
          )}
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground">Chamadas</p>
            <p className="text-sm font-semibold">
              <span className="text-purple-600">{operatorCalls} op.</span>
              {doctorCalls > 0 && (
                <span className="text-indigo-600 ml-1">/ {doctorCalls} méd.</span>
              )}
            </p>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhum evento registrado</p>
            </div>
          ) : (
            <div className="relative">
              {/* Linha vertical da timeline */}
              <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />

              <div className="space-y-4">
                {events.map((event, index) => {
                  const config = getEventConfig(event.event_type);
                  const { date, time } = formatDateTime(event.created_at);
                  const isLast = index === events.length - 1;

                  return (
                    <div key={event.id} className="relative flex gap-4 ml-2">
                      {/* Ícone do evento */}
                      <div
                        className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ${config.bgColor} ${config.color} ring-4 ring-background`}
                      >
                        {config.icon}
                      </div>

                      {/* Conteúdo do evento */}
                      <div
                        className={`flex-1 rounded-lg border p-3 ${
                          isLast ? 'border-primary/50 bg-primary/5' : 'bg-card'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className={`font-semibold ${config.color}`}>
                              {event.event_description}
                            </p>

                            {/* Detalhes adicionais */}
                            <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                              {event.operator_name && (
                                <p>
                                  Operador: <span className="font-medium">{event.operator_name}</span>
                                  {event.counter && (
                                    <span className="ml-2 text-xs">
                                      (Guichê {event.counter})
                                    </span>
                                  )}
                                </p>
                              )}
                              {event.doctor_name && (
                                <p>
                                  Médico: <span className="font-medium">{event.doctor_name}</span>
                                  {event.consultorio && (
                                    <span className="ml-2 text-xs">
                                      ({event.consultorio})
                                    </span>
                                  )}
                                </p>
                              )}
                              {event.patient_name && event.event_type === 'encaminhado' && (
                                <p>
                                  Paciente: <span className="font-medium">{event.patient_name}</span>
                                </p>
                              )}
                              {event.cancellation_reason && (
                                <p className="text-red-600">
                                  Motivo: <span className="font-medium">{event.cancellation_reason}</span>
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Data e hora */}
                          <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                            <p className="font-medium">{time}</p>
                            <p>{date}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TicketHistoryModal;
