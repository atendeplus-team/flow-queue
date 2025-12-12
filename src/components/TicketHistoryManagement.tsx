import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import {
  Search,
  Download,
  History,
  Loader2,
  Filter,
  X,
  Calendar,
  FileSpreadsheet,
} from 'lucide-react';
import TicketHistoryModal from './TicketHistoryModal';
import * as XLSX from 'xlsx';

interface TicketWithHistory {
  id: string;
  display_number: string;
  patient_name: string | null;
  status: string;
  doctor_name: string | null;
  operator_name: string | null;
  created_at: string;
  specialty: string | null;
}

interface MedicalSpecialty {
  id: string;
  name: string;
}

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

interface TicketHistoryManagementProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TicketHistoryManagement = ({
  open,
  onOpenChange,
}: TicketHistoryManagementProps) => {
  const [tickets, setTickets] = useState<TicketWithHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
  const [specialties, setSpecialties] = useState<MedicalSpecialty[]>([]);

  // Filtros
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [ticketCode, setTicketCode] = useState('');
  const [patientName, setPatientName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('');

  // Modal de histórico individual
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [selectedDisplayNumber, setSelectedDisplayNumber] = useState('');

  useEffect(() => {
    if (open) {
      loadSpecialties();
      // Definir data inicial como hoje
      const today = new Date().toISOString().split('T')[0];
      setDateStart(today);
      setDateEnd(today);
    }
  }, [open]);

  const loadSpecialties = async () => {
    const { data } = await supabase
      .from('medical_specialties')
      .select('id, name')
      .eq('active', true)
      .order('name');

    if (data) {
      setSpecialties(data);
    }
  };

  const searchTickets = async () => {
    setLoading(true);
    setSelectedTickets(new Set());

    try {
      // Buscar tickets com dados do doctor_tickets
      let query = supabase
        .from('tickets')
        .select(`
          id,
          display_number,
          status,
          operator_name,
          created_at
        `)
        .order('created_at', { ascending: false });

      // Filtro de data
      if (dateStart) {
        query = query.gte('created_at', `${dateStart}T00:00:00`);
      }
      if (dateEnd) {
        query = query.lte('created_at', `${dateEnd}T23:59:59`);
      }

      // Filtro de código da senha
      if (ticketCode.trim()) {
        query = query.ilike('display_number', `%${ticketCode.trim()}%`);
      }

      // Filtro de operador
      if (operatorName.trim()) {
        query = query.ilike('operator_name', `%${operatorName.trim()}%`);
      }

      const { data: ticketsData, error } = await query.limit(100);

      if (error) {
        console.error('Erro ao buscar tickets:', error);
        return;
      }

      if (!ticketsData || ticketsData.length === 0) {
        setTickets([]);
        return;
      }

      // Buscar dados complementares dos doctor_tickets
      const ticketIds = ticketsData.map((t) => t.id);
      const doctorTicketsResult = await (supabase as any)
        .from('doctor_tickets')
        .select('ticket_id, patient_name, doctor_name, doctor_id')
        .in('ticket_id', ticketIds);
      
      const doctorTicketsData = doctorTicketsResult.data as any[] || [];

      // Buscar especialidades dos médicos
      const doctorIds = doctorTicketsData
        .filter((dt) => dt.doctor_id)
        .map((dt) => dt.doctor_id);
      
      let profilesData: any[] = [];
      if (doctorIds.length > 0) {
        const profilesResult = await (supabase as any)
          .from('profiles')
          .select('id, specialty_id, medical_specialties(name)')
          .in('id', doctorIds);
        profilesData = profilesResult.data || [];
      }

      // Mapear especialidades por doctor_id
      const specialtiesMap = new Map<string, string>();
      profilesData.forEach((profile: any) => {
        if (profile.medical_specialties?.name) {
          specialtiesMap.set(profile.id, profile.medical_specialties.name);
        }
      });

      // Mapear doctor_tickets por ticket_id
      const doctorTicketsMap = new Map<string, { patient_name: string | null; doctor_name: string | null; specialty: string | null }>();
      doctorTicketsData.forEach((dt: any) => {
        if (dt.ticket_id) {
          doctorTicketsMap.set(dt.ticket_id, {
            patient_name: dt.patient_name,
            doctor_name: dt.doctor_name,
            specialty: dt.doctor_id ? specialtiesMap.get(dt.doctor_id) || null : null,
          });
        }
      });

      // Combinar dados
      let combinedTickets: TicketWithHistory[] = ticketsData.map((ticket) => {
        const doctorInfo = doctorTicketsMap.get(ticket.id);
        return {
          id: ticket.id,
          display_number: ticket.display_number,
          patient_name: doctorInfo?.patient_name || null,
          status: ticket.status,
          doctor_name: doctorInfo?.doctor_name || null,
          operator_name: ticket.operator_name,
          created_at: ticket.created_at,
          specialty: doctorInfo?.specialty || null,
        };
      });

      // Filtros adicionais no frontend (porque são de tabelas relacionadas)
      if (patientName.trim()) {
        const search = patientName.trim().toLowerCase();
        combinedTickets = combinedTickets.filter(
          (t) => t.patient_name?.toLowerCase().includes(search)
        );
      }

      if (doctorName.trim()) {
        const search = doctorName.trim().toLowerCase();
        combinedTickets = combinedTickets.filter(
          (t) => t.doctor_name?.toLowerCase().includes(search)
        );
      }

      if (selectedSpecialty && selectedSpecialty !== 'all') {
        combinedTickets = combinedTickets.filter(
          (t) => t.specialty?.toLowerCase() === selectedSpecialty.toLowerCase()
        );
      }

      setTickets(combinedTickets);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    const today = new Date().toISOString().split('T')[0];
    setDateStart(today);
    setDateEnd(today);
    setTicketCode('');
    setPatientName('');
    setDoctorName('');
    setOperatorName('');
    setSelectedSpecialty('');
    setTickets([]);
    setSelectedTickets(new Set());
  };

  const toggleSelectTicket = (ticketId: string) => {
    const newSelected = new Set(selectedTickets);
    if (newSelected.has(ticketId)) {
      newSelected.delete(ticketId);
    } else {
      newSelected.add(ticketId);
    }
    setSelectedTickets(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedTickets.size === tickets.length) {
      setSelectedTickets(new Set());
    } else {
      setSelectedTickets(new Set(tickets.map((t) => t.id)));
    }
  };

  const openHistoryModal = (ticketId: string, displayNumber: string) => {
    setSelectedTicketId(ticketId);
    setSelectedDisplayNumber(displayNumber);
    setHistoryModalOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      waiting: { label: 'Aguardando', variant: 'secondary' },
      called: { label: 'Chamada', variant: 'default' },
      in_service: { label: 'Em Atendimento', variant: 'default' },
      served: { label: 'Atendida', variant: 'outline' },
      cancelled: { label: 'Cancelada', variant: 'destructive' },
    };

    const config = statusConfig[status] || { label: status, variant: 'secondary' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
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

  const exportSelectedToExcel = async () => {
    if (selectedTickets.size === 0) return;

    setExporting(true);

    try {
      // Buscar histórico de todas as senhas selecionadas
      const ticketIds = Array.from(selectedTickets);
      const { data: historyData, error } = await (supabase as any)
        .from('ticket_history')
        .select('*')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Erro ao buscar histórico:', error);
        return;
      }

      if (!historyData || historyData.length === 0) {
        alert('Nenhum histórico encontrado para as senhas selecionadas.');
        return;
      }

      // Preparar dados para o Excel
      const excelData = (historyData as TicketHistoryEvent[]).map((event) => {
        const { date, time } = formatDateTime(event.created_at);
        return {
          'Data': date,
          'Hora': time,
          'Senha': event.display_number,
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
      const fileName = `historico_senhas_${selectedTickets.size}_senhas_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Gerenciamento de Histórico de Senhas
            </DialogTitle>
            <DialogDescription>
              Pesquise e exporte o histórico completo das senhas do sistema.
            </DialogDescription>
          </DialogHeader>

          {/* Filtros */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Filtros</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Data Início */}
              <div className="space-y-2">
                <Label htmlFor="dateStart" className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Data Início
                </Label>
                <Input
                  id="dateStart"
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                />
              </div>

              {/* Data Fim */}
              <div className="space-y-2">
                <Label htmlFor="dateEnd" className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Data Fim
                </Label>
                <Input
                  id="dateEnd"
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                />
              </div>

              {/* Código da Senha */}
              <div className="space-y-2">
                <Label htmlFor="ticketCode">Código da Senha</Label>
                <Input
                  id="ticketCode"
                  placeholder="Ex: N001"
                  value={ticketCode}
                  onChange={(e) => setTicketCode(e.target.value)}
                />
              </div>

              {/* Nome do Paciente */}
              <div className="space-y-2">
                <Label htmlFor="patientName">Nome do Paciente</Label>
                <Input
                  id="patientName"
                  placeholder="Buscar por paciente..."
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                />
              </div>

              {/* Nome do Médico */}
              <div className="space-y-2">
                <Label htmlFor="doctorName">Nome do Médico</Label>
                <Input
                  id="doctorName"
                  placeholder="Buscar por médico..."
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                />
              </div>

              {/* Nome do Operador */}
              <div className="space-y-2">
                <Label htmlFor="operatorName">Nome do Operador</Label>
                <Input
                  id="operatorName"
                  placeholder="Buscar por operador..."
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                />
              </div>

              {/* Especialidade */}
              <div className="space-y-2">
                <Label htmlFor="specialty">Especialidade</Label>
                <Select value={selectedSpecialty} onValueChange={setSelectedSpecialty}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {specialties.map((specialty) => (
                      <SelectItem key={specialty.id} value={specialty.name}>
                        {specialty.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Botões */}
              <div className="flex items-end gap-2">
                <Button onClick={searchTickets} disabled={loading} className="flex-1">
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  Pesquisar
                </Button>
                <Button variant="outline" onClick={clearFilters}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Ações em massa */}
          <div className="flex items-center justify-between py-2 border-b">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {tickets.length > 0 && (
                  <>
                    {selectedTickets.size} de {tickets.length} senhas selecionadas
                  </>
                )}
              </span>
            </div>
            <Button
              onClick={exportSelectedToExcel}
              disabled={selectedTickets.size === 0 || exporting}
              variant="outline"
              className="gap-2"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Baixar Excel ({selectedTickets.size})
            </Button>
          </div>

          {/* Tabela de resultados */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : tickets.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Use os filtros acima para pesquisar senhas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedTickets.size === tickets.length && tickets.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Médico</TableHead>
                    <TableHead>Operador</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="w-24 text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((ticket) => {
                    const { date, time } = formatDateTime(ticket.created_at);
                    return (
                      <TableRow key={ticket.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedTickets.has(ticket.id)}
                            onCheckedChange={() => toggleSelectTicket(ticket.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono">
                            {ticket.display_number}
                          </Badge>
                        </TableCell>
                        <TableCell>{ticket.patient_name || '-'}</TableCell>
                        <TableCell>{getStatusBadge(ticket.status)}</TableCell>
                        <TableCell>
                          {ticket.doctor_name ? (
                            <div>
                              <span>{ticket.doctor_name}</span>
                              {ticket.specialty && (
                                <span className="text-xs text-muted-foreground block">
                                  {ticket.specialty}
                                </span>
                              )}
                            </div>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>{ticket.operator_name || '-'}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <span>{date}</span>
                            <span className="text-muted-foreground ml-1">{time}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openHistoryModal(ticket.id, ticket.display_number)}
                            title="Ver histórico"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de histórico individual */}
      <TicketHistoryModal
        open={historyModalOpen}
        onOpenChange={setHistoryModalOpen}
        ticketId={selectedTicketId}
        displayNumber={selectedDisplayNumber}
      />
    </>
  );
};

export default TicketHistoryManagement;
