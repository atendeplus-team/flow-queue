import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import type { User } from '@supabase/supabase-js';
import {
  TrendingUp,
  Clock,
  Users,
  CheckCircle,
  Plus,
  Edit,
  Trash2,
  Activity,
  Download,
  Upload,
  X,
  LogOut,
  BarChart3,
  Home,
  Eye,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createQueueSchema, logoUrlSchema } from '@/lib/validations';
import * as XLSX from 'xlsx';

interface Stats {
  totalToday: number;
  totalServed: number;
  totalWaiting: number;
  avgWaitTime: number;
  avgServiceTime: number;
  peakHour: number;
  byPriority: {
    normal: number;
    preferential: number;
  };
  byQueue: Record<string, number>;
  byOperator: Record<
    string,
    { count: number; avgTime: number; counter: string }
  >;
}

interface DoctorStats {
  doctor_id: string;
  doctor_name: string;
  specialty_name: string | null;
  counter: string;
  total_tickets: number;
}

interface RealtimeTicket {
  id: string;
  display_number: string;
  status: 'waiting' | 'called' | 'served' | 'cancelled';
  created_at: string;
  called_at: string | null;
  served_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  wait_time: number; // em minutos
}

interface Queue {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  preferential: string;
}

// Painel administrativo: estatísticas e gestão de filas/configurações
const Admin = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const {
    isAdmin,
    isVisitor,
    isSuperAdmin,
    loading: roleLoading,
  } = useUserRole(currentUser);
  const [stats, setStats] = useState<Stats>({
    totalToday: 0,
    totalServed: 0,
    totalWaiting: 0,
    avgWaitTime: 0,
    avgServiceTime: 0,
    peakHour: 0,
    byPriority: { normal: 0, preferential: 0 },
    byQueue: {},
    byOperator: {},
  });
  const [doctorStats, setDoctorStats] = useState<DoctorStats[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQueue, setEditingQueue] = useState<Queue | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    preferential: false,
  });
  const [currentLogo, setCurrentLogo] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  // Printer settings
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printerId, setPrinterId] = useState<string | null>(null);
  const [printServerUrl, setPrintServerUrl] = useState('');
  const [printerIp, setPrinterIp] = useState('');
  const [printerPort, setPrinterPort] = useState<number>(9100);

  // Real-time tickets
  const [realtimeTickets, setRealtimeTickets] = useState<RealtimeTicket[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('created_at_desc');
  const [loadingRealtime, setLoadingRealtime] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Modal de motivo de cancelamento
  const [showCancellationReasonModal, setShowCancellationReasonModal] =
    useState(false);
  const [selectedCancellationReason, setSelectedCancellationReason] = useState<{
    display_number: string;
    reason: string;
  } | null>(null);

  // Verifica sessão inicial
  useEffect(() => {
    checkAuth();
  }, []);

  // Armazena usuário autenticado; rotas já protegem admin, mas reforçamos aqui
  const checkAuth = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      navigate('/auth');
      return;
    }

    setCurrentUser(session.user);
  };

  // Controle de acesso: toten são redirecionados; carrega stats e filas
  useEffect(() => {
    if (currentUser && !roleLoading) {
      if (isVisitor) {
        toast({
          title: 'Acesso negado',
          description: 'Toten não pode acessar estatísticas.',
          variant: 'destructive',
        });
        navigate('/dashboard');
        return;
      }
      loadStats();
      loadDoctorStats();
      loadQueues();
      loadCurrentLogo();
      loadPrinterSettings();
      loadRealtimeTickets(true); // Mostra loading apenas na primeira carga
      const interval = setInterval(() => {
        loadStats();
        loadRealtimeTickets(); // Não mostra loading nas atualizações automáticas
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [currentUser, isVisitor, roleLoading]);

  // Reseta a página quando mudar filtro ou ordenação
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, sortBy]);

  // Lista de filas; operações de criação/edição/exclusão são RLS-restritas a admin
  const loadQueues = async () => {
    const { data, error } = await supabase
      .from('queues')
      .select('id, name, code, description, is_active, preferential')
      .order('name');

    if (error) {
      toast({
        title: 'Erro ao carregar atendimentos',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setQueues(
      (data || []).map((q: any) => ({
        id: q.id,
        name: q.name,
        code: q.code,
        description: q.description,
        is_active: q.is_active,
        preferential:
          q.preferential === '1' ||
          q.preferential === "B'1'" ||
          q.preferential === 1 ||
          q.preferential === true ||
          q.preferential === '\\x01'
            ? '1'
            : '0',
      }))
    );
  };

  // Carrega a logo atual da empresa
  const loadCurrentLogo = async () => {
    try {
      const { data, error } = await supabase
        .from('company_settings')
        .select('logo_url')
        .limit(1)
        .single();

      if (error) throw error;
      if (data?.logo_url) {
        setCurrentLogo(data.logo_url);
      }
    } catch (error) {
      console.error('Erro ao carregar logo:', error);
    }
  };

  // Upload da logo para o bucket company-logos
  const uploadLogoFile = async (file: File) => {
    // Validar tipo de arquivo
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Arquivo inválido',
        description: 'Por favor, selecione uma imagem',
        variant: 'destructive',
      });
      return;
    }

    // Validar tamanho (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'Arquivo muito grande',
        description: 'A imagem deve ter no máximo 5MB',
        variant: 'destructive',
      });
      return;
    }

    setUploadingLogo(true);

    try {
      // Se já existe uma logo, remove a antiga
      if (currentLogo) {
        const oldFileName = currentLogo.split('/').pop();
        if (oldFileName) {
          await supabase.storage.from('company-logos').remove([oldFileName]);
        }
      }

      // Nome do arquivo: company-logo.extensão
      const fileExt = file.name.split('.').pop();
      const fileName = `company-logo.${fileExt}`;

      // Upload do novo arquivo
      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(fileName, file, {
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      // Gera a URL pública com timestamp para evitar cache
      const {
        data: { publicUrl },
      } = supabase.storage.from('company-logos').getPublicUrl(fileName);

      // Adiciona timestamp para forçar atualização (evita cache do navegador)
      const logoUrlWithTimestamp = `${publicUrl}?t=${Date.now()}`;

      // Atualiza no banco de dados
      const { error: updateError } = await supabase
        .from('company_settings')
        .update({ logo_url: logoUrlWithTimestamp })
        .eq(
          'id',
          (
            await supabase
              .from('company_settings')
              .select('id')
              .limit(1)
              .single()
          ).data?.id
        );

      if (updateError) throw updateError;

      setCurrentLogo(logoUrlWithTimestamp);

      toast({
        title: 'Logo atualizada',
        description: 'A logo foi atualizada com sucesso',
      });
    } catch (error: any) {
      console.error('Erro ao fazer upload:', error);
      toast({
        title: 'Erro ao fazer upload',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleLogoUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadLogoFile(file);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    await uploadLogoFile(file);
  };

  // Remove a logo atual
  const handleRemoveLogo = async () => {
    if (!currentLogo) return;

    try {
      const fileName = currentLogo.split('/').pop();
      if (fileName) {
        await supabase.storage.from('company-logos').remove([fileName]);
      }

      await supabase
        .from('company_settings')
        .update({ logo_url: null })
        .eq(
          'id',
          (
            await supabase
              .from('company_settings')
              .select('id')
              .limit(1)
              .single()
          ).data?.id
        );

      setCurrentLogo(null);

      toast({
        title: 'Logo removida',
        description: 'A logo foi removida com sucesso',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao remover logo',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({
      title: 'Logout realizado',
      description: 'Até logo!',
    });
    navigate('/auth');
  };

  // Carrega configuração de impressora
  const loadPrinterSettings = async () => {
    try {
      setPrinterLoading(true);
      const { data, error } = await (supabase as any)
        .from('company_settings')
        .select('id, print_server_url, printer_ip, printer_port')
        .limit(1)
        .single();
      if (error) throw error;
      if (data) {
        setPrinterId(data.id);
        if (data.print_server_url) setPrintServerUrl(data.print_server_url);
        if (data.printer_ip) setPrinterIp(data.printer_ip);
        if (data.printer_port) setPrinterPort(Number(data.printer_port));
      }
    } catch (e) {
      console.error('Erro ao carregar impressora:', e);
    } finally {
      setPrinterLoading(false);
    }
  };

  const savePrinterSettings = async () => {
    try {
      if (!isAdmin) {
        toast({
          title: 'Acesso negado',
          description: 'Apenas administradores podem salvar.',
          variant: 'destructive',
        });
        return;
      }
      const payload: any = {
        print_server_url: printServerUrl || null,
        printer_ip: printerIp || null,
        printer_port: printerPort || 9100,
      };
      let err;
      if (printerId) {
        const { error } = await supabase
          .from('company_settings')
          .update(payload)
          .eq('id', printerId);
        err = error;
      } else {
        const { data, error } = await supabase
          .from('company_settings')
          .insert(payload)
          .select('id')
          .single();
        err = error;
        if (!error && data?.id) setPrinterId(data.id);
      }
      if (err) throw err;
      toast({
        title: 'Configurações salvas',
        description: 'Impressora atualizada com sucesso.',
      });
    } catch (e: any) {
      toast({
        title: 'Erro ao salvar',
        description: e.message,
        variant: 'destructive',
      });
    }
  };

  const testPrinter = async () => {
    try {
      if (!printServerUrl || !printerIp) {
        toast({
          title: 'Configuração incompleta',
          description:
            'Configure URL do servidor e IP da impressora antes de testar.',
          variant: 'destructive',
        });
        return;
      }

      const cut = [0x1d, 0x56, 0x00];
      const response = await fetch(`${printServerUrl}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printer_ip: printerIp,
          printer_port: printerPort || 9100,
          data: cut,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Falha ao enviar teste');
      }

      toast({
        title: 'Teste enviado',
        description: 'Comando de corte enviado à impressora.',
      });
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Falha no teste',
        description: e.message || 'Verifique servidor de impressão e rede.',
        variant: 'destructive',
      });
    }
  };

  const openDialog = (queue?: Queue) => {
    if (queue) {
      setEditingQueue(queue);
      setFormData({
        name: queue.name,
        code: queue.code,
        description: queue.description || '',
        preferential: queue.preferential === '1',
      });
    } else {
      setEditingQueue(null);
      setFormData({
        name: '',
        code: '',
        description: '',
        preferential: false,
      });
    }
    setIsDialogOpen(true);
  };

  // Cria/edita filas com validação; RLS: admin pode inserir/editar, operador apenas editar status (política)
  const handleSaveQueue = async () => {
    if (!isAdmin) {
      toast({
        title: 'Acesso negado',
        description: 'Apenas administradores podem criar/editar filas.',
        variant: 'destructive',
      });
      return;
    }

    // Validar dados com Zod
    const validation = createQueueSchema.safeParse({
      name: formData.name,
      code: formData.code,
      description: formData.description,
    });

    if (!validation.success) {
      const firstError = validation.error.issues[0];
      toast({
        title: 'Erro de validação',
        description: firstError.message,
        variant: 'destructive',
      });
      return;
    }

    const { data: validData } = validation;

    try {
      if (editingQueue) {
        const { error } = await supabase
          .from('queues')
          .update({
            name: validData.name,
            code: validData.code,
            description: validData.description || null,
            preferential: formData.preferential ? '1' : '0',
          })
          .eq('id', editingQueue.id);

        if (error) throw error;

        toast({
          title: 'Atendimento atualizado',
          description: 'O atendimento foi atualizado com sucesso',
        });
      } else {
        const { error } = await supabase.from('queues').insert({
          name: formData.name,
          code: formData.code,
          description: formData.description || null,
          is_active: true,
          preferential: formData.preferential ? '1' : '0',
        });

        if (error) throw error;

        toast({
          title: 'Atendimento criado',
          description: 'O atendimento foi criado com sucesso',
        });
      }

      setIsDialogOpen(false);
      loadQueues();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Exclui fila; RLS: somente admin
  const handleDeleteQueue = async (id: string) => {
    if (!isAdmin) {
      toast({
        title: 'Acesso negado',
        description: 'Apenas administradores podem excluir filas.',
        variant: 'destructive',
      });
      return;
    }

    if (!confirm('Tem certeza que deseja excluir este atendimento?')) {
      return;
    }

    try {
      const { error } = await supabase.from('queues').delete().eq('id', id);

      if (error) throw error;

      toast({
        title: 'Atendimento excluído',
        description: 'O atendimento foi excluído com sucesso',
      });

      loadQueues();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Ativa/desativa fila; RLS permite admin e (conforme política) operadores atualizarem
  const toggleQueueStatus = async (queue: Queue) => {
    try {
      const { error } = await supabase
        .from('queues')
        .update({ is_active: !queue.is_active })
        .eq('id', queue.id);

      if (error) throw error;

      toast({
        title: queue.is_active
          ? 'Atendimento desativado'
          : 'Atendimento ativado',
        description: `O atendimento foi ${
          queue.is_active ? 'desativado' : 'ativado'
        } com sucesso`,
      });

      loadQueues();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Calcula estatísticas do dia a partir de tickets e logs
  const loadStats = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Total today - todos os tickets criados hoje
    const { data: todayTickets } = await supabase
      .from('tickets')
      .select('*')
      .gte('created_at', today.toISOString());

    // Served tickets - tickets atendidos hoje
    const servedTickets =
      todayTickets?.filter((t) => t.status === 'served') || [];

    // Waiting tickets - tickets aguardando que foram criados hoje
    const waitingTickets =
      todayTickets?.filter((t) => t.status === 'waiting') || [];

    // Calculate average wait time (tempo médio que os tickets AGUARDANDO estão esperando)
    let totalWaitTime = 0;
    let totalServiceTime = 0;
    const hourCounts: Record<number, number> = {};

    const now = new Date();

    // Tempo de espera: apenas para tickets que estão aguardando AGORA
    waitingTickets.forEach((ticket) => {
      const wait = now.getTime() - new Date(ticket.created_at).getTime();
      totalWaitTime += wait;
    });

    // Tempo de atendimento: para tickets já servidos
    let ticketsComTempo = 0;
    servedTickets.forEach((ticket) => {
      if (ticket.served_at && ticket.called_at) {
        const service =
          new Date(ticket.served_at).getTime() -
          new Date(ticket.called_at).getTime();
        totalServiceTime += service;
        ticketsComTempo++;
      }
      if (ticket.called_at) {
        const hour = new Date(ticket.called_at).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
    });

    const avgWaitTime =
      waitingTickets.length > 0
        ? Math.round(totalWaitTime / waitingTickets.length / 60000)
        : 0;

    // Tempo médio de atendimento em segundos (arredondado)
    const avgServiceTime =
      ticketsComTempo > 0
        ? Math.round(totalServiceTime / ticketsComTempo / 1000)
        : 0;

    // Find peak hour
    let peakHour = 0;
    let maxCount = 0;
    Object.entries(hourCounts).forEach(([hour, count]) => {
      if (count > maxCount) {
        maxCount = count;
        peakHour = parseInt(hour);
      }
    });

    // By priority
    const normalCount =
      todayTickets?.filter((t) => t.priority === 'normal').length || 0;
    const preferentialCount =
      todayTickets?.filter((t) => t.priority !== 'normal').length || 0;

    // By queue
    const { data: queues } = await supabase.from('queues').select('*');
    const byQueue: Record<string, number> = {};

    queues?.forEach((queue) => {
      const count =
        todayTickets?.filter((t) => t.queue_id === queue.id).length || 0;
      if (count > 0) {
        byQueue[queue.name] = count;
      }
    });

    // By operator (diretamente dos tickets servidos)
    const byOperator: Record<
      string,
      { count: number; avgTime: number; counter: string }
    > = {};

    servedTickets.forEach((ticket) => {
      if (ticket.operator_name && ticket.called_at && ticket.served_at) {
        if (!byOperator[ticket.operator_name]) {
          byOperator[ticket.operator_name] = {
            count: 0,
            avgTime: 0,
            counter: ticket.counter || 'N/A',
          };
        }
        byOperator[ticket.operator_name].count += 1;

        const serviceTime =
          new Date(ticket.served_at).getTime() -
          new Date(ticket.called_at).getTime();
        byOperator[ticket.operator_name].avgTime += serviceTime;
      }
    });

    // Calculate average times em segundos
    Object.keys(byOperator).forEach((op) => {
      if (byOperator[op].count > 0) {
        byOperator[op].avgTime = Math.round(
          byOperator[op].avgTime / byOperator[op].count / 1000
        );
      }
    });

    setStats({
      totalToday: todayTickets?.length || 0,
      totalServed: servedTickets.length,
      totalWaiting: waitingTickets.length,
      avgWaitTime,
      avgServiceTime,
      peakHour,
      byPriority: {
        normal: normalCount,
        preferential: preferentialCount,
      },
      byQueue,
      byOperator,
    });
  };

  // Carrega estatísticas dos médicos
  const loadDoctorStats = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      // Buscar doctor_tickets de hoje
      const { data: doctorTickets, error: ticketsError } = await supabase
        .from('doctor_tickets')
        .select('*')
        .gte('created_at', today.toISOString());

      if (ticketsError) {
        console.error('Erro ao carregar doctor_tickets:', ticketsError);
        return;
      }

      if (!doctorTickets || doctorTickets.length === 0) {
        setDoctorStats([]);
        return;
      }

      // Buscar informações dos médicos (profiles com specialty)
      const doctorIds = [
        ...new Set(doctorTickets.map((t: any) => t.doctor_id)),
      ].filter(Boolean);

      if (doctorIds.length === 0) {
        setDoctorStats([]);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, specialty_id')
        .in('id', doctorIds);

      if (profilesError) {
        console.error('Erro ao carregar profiles:', profilesError);
      }

      // Buscar especialidades
      const specialtyIds = [
        ...new Set(profiles?.map((p: any) => p.specialty_id)),
      ].filter(Boolean);
      let specialtiesMap = new Map();

      if (specialtyIds.length > 0) {
        const { data: specialties } = await (supabase as any)
          .from('medical_specialties')
          .select('id, name')
          .in('id', specialtyIds);

        specialties?.forEach((s: any) => {
          specialtiesMap.set(s.id, s.name);
        });
      }

      // Criar mapa de profiles para lookup rápido
      const profilesMap = new Map();
      profiles?.forEach((profile: any) => {
        profilesMap.set(profile.id, {
          full_name: profile.full_name,
          specialty_name:
            specialtiesMap.get(profile.specialty_id) || 'Sem especialidade',
        });
      });

      // Agrupar por médico
      const doctorMap = new Map<string, DoctorStats>();

      doctorTickets.forEach((ticket: any) => {
        const doctorId = ticket.doctor_id;

        if (doctorId) {
          if (!doctorMap.has(doctorId)) {
            const profileData = profilesMap.get(doctorId);
            doctorMap.set(doctorId, {
              doctor_id: doctorId,
              doctor_name:
                profileData?.full_name ||
                ticket.doctor_name ||
                'Médico sem nome',
              specialty_name:
                profileData?.specialty_name || 'Sem especialidade',
              counter: ticket.counter || 'N/A',
              total_tickets: 0,
            });
          }

          const stats = doctorMap.get(doctorId)!;
          stats.total_tickets += 1;
        }
      });

      // Converter para array e ordenar por quantidade
      const doctorStatsArray = Array.from(doctorMap.values()).sort(
        (a, b) => b.total_tickets - a.total_tickets
      );

      setDoctorStats(doctorStatsArray);
    } catch (error) {
      console.error('Erro ao carregar estatísticas dos médicos:', error);
    }
  };

  // Carrega tickets em tempo real
  const loadRealtimeTickets = async (showLoading: boolean = false) => {
    if (showLoading) {
      setLoadingRealtime(true);
    }

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Buscar tickets de hoje
      const { data: tickets, error } = await supabase
        .from('tickets')
        .select(
          'id, display_number, status, created_at, called_at, served_at, cancelled_at, cancellation_reason'
        )
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Erro ao carregar tickets em tempo real:', error);
        if (showLoading) {
          setLoadingRealtime(false);
        }
        return;
      }

      if (!tickets) {
        setRealtimeTickets([]);
        if (showLoading) {
          setLoadingRealtime(false);
        }
        return;
      }

      // Calcular tempo de espera para cada ticket
      const now = new Date();
      const ticketsWithWaitTime: RealtimeTicket[] = tickets.map(
        (ticket: any) => {
          let waitTime = 0;

          if (ticket.status === 'waiting') {
            // Se ainda está aguardando, tempo de espera é desde a criação até agora
            waitTime = Math.round(
              (now.getTime() - new Date(ticket.created_at).getTime()) / 60000
            );
          } else if (ticket.called_at) {
            // Se foi chamado/atendido/cancelado, tempo de espera foi até o momento da chamada
            waitTime = Math.round(
              (new Date(ticket.called_at).getTime() -
                new Date(ticket.created_at).getTime()) /
                60000
            );
          }

          return {
            id: ticket.id,
            display_number: ticket.display_number,
            status: ticket.status,
            created_at: ticket.created_at,
            called_at: ticket.called_at,
            served_at: ticket.served_at,
            cancelled_at: ticket.cancelled_at,
            cancellation_reason: ticket.cancellation_reason,
            wait_time: waitTime,
          };
        }
      );

      setRealtimeTickets(ticketsWithWaitTime);
    } catch (error) {
      console.error('Erro ao carregar tickets em tempo real:', error);
    } finally {
      if (showLoading) {
        setLoadingRealtime(false);
      }
    }
  };

  // Exporta desempenho dos médicos em Excel
  const exportDoctorsToExcel = () => {
    const today = new Date().toISOString().split('T')[0];

    if (doctorStats.length === 0) {
      toast({
        title: 'Sem dados',
        description: 'Nenhum atendimento médico para exportar.',
        variant: 'destructive',
      });
      return;
    }

    // Preparar dados para o Excel
    const doctorData = doctorStats.map((doctor) => ({
      Médico: doctor.doctor_name,
      Especialidade: doctor.specialty_name || 'Sem especialidade',
      'Total de Atendimentos': doctor.total_tickets,
    }));

    // Criar workbook e worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(doctorData);

    // Ajustar largura das colunas
    const wscols = [
      { wch: 35 }, // Médico
      { wch: 30 }, // Especialidade
      { wch: 25 }, // Total de Atendimentos
    ];
    ws['!cols'] = wscols;

    // Adicionar worksheet ao workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Desempenho Médicos');

    // Exportar arquivo
    XLSX.writeFile(wb, `desempenho-medicos-${today}.xlsx`);

    toast({
      title: 'Excel exportado',
      description: `Arquivo desempenho-medicos-${today}.xlsx baixado com sucesso!`,
    });
  };

  // Exporta desempenho dos atendentes em Excel
  const exportOperatorsToExcel = () => {
    const today = new Date().toISOString().split('T')[0];

    // Preparar dados para o Excel
    const operatorData = Object.entries(stats.byOperator).map(
      ([operator, data]) => ({
        Atendente: operator,
        'Total de Atendimentos': data.count,
        'Tempo Médio (segundos)': Math.round(data.avgTime),
        'Tempo Médio (minutos)': (data.avgTime / 60).toFixed(2),
        'Tempo Médio (formatado)':
          data.avgTime >= 60
            ? `${Math.round(data.avgTime / 60)}min`
            : `${data.avgTime}s`,
      })
    );

    if (operatorData.length === 0) {
      toast({
        title: 'Sem dados',
        description: 'Nenhum atendimento finalizado para exportar.',
        variant: 'destructive',
      });
      return;
    }

    // Criar workbook e worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(operatorData);

    // Ajustar largura das colunas
    const wscols = [
      { wch: 30 }, // Atendente
      { wch: 20 }, // Total de Atendimentos
      { wch: 25 }, // Tempo Médio (segundos)
      { wch: 25 }, // Tempo Médio (minutos)
      { wch: 25 }, // Tempo Médio (formatado)
    ];
    ws['!cols'] = wscols;

    // Adicionar worksheet ao workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Desempenho Atendentes');

    // Exportar arquivo
    XLSX.writeFile(wb, `desempenho-atendentes-${today}.xlsx`);

    toast({
      title: 'Excel exportado',
      description: `Arquivo desempenho-atendentes-${today}.xlsx baixado com sucesso!`,
    });
  };

  // Exporta tickets em tempo real em Excel
  const exportRealtimeToExcel = () => {
    const today = new Date().toISOString().split('T')[0];

    if (realtimeTickets.length === 0) {
      toast({
        title: 'Sem dados',
        description: 'Nenhum ticket para exportar.',
        variant: 'destructive',
      });
      return;
    }

    // Preparar dados para o Excel
    const ticketData = realtimeTickets.map((ticket) => ({
      Código: ticket.display_number,
      Status:
        ticket.status === 'waiting'
          ? 'Aguardando'
          : ticket.status === 'called'
          ? 'Chamado'
          : ticket.status === 'served'
          ? 'Atendido'
          : 'Cancelado',
      Emissão: new Date(ticket.created_at).toLocaleString('pt-BR'),
      Chamada: ticket.called_at
        ? new Date(ticket.called_at).toLocaleString('pt-BR')
        : '-',
      Atendimento: ticket.served_at
        ? new Date(ticket.served_at).toLocaleString('pt-BR')
        : '-',
      Cancelamento: ticket.cancelled_at
        ? new Date(ticket.cancelled_at).toLocaleString('pt-BR')
        : '-',
      'Tempo de Espera (min)': ticket.wait_time,
    }));

    // Criar workbook e worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(ticketData);

    // Ajustar largura das colunas
    const wscols = [
      { wch: 15 }, // Código
      { wch: 15 }, // Status
      { wch: 20 }, // Emissão
      { wch: 20 }, // Chamada
      { wch: 20 }, // Atendimento
      { wch: 20 }, // Cancelamento
      { wch: 20 }, // Tempo de Espera
    ];
    ws['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, ws, 'Tempo Real');
    XLSX.writeFile(wb, `tickets-tempo-real-${today}.xlsx`);

    toast({
      title: 'Excel exportado',
      description: `Arquivo tickets-tempo-real-${today}.xlsx baixado com sucesso!`,
    });
  };

  // Exporta resumo das estatísticas em Excel (XLSX)
  const exportToExcel = () => {
    const today = new Date().toISOString().split('T')[0];

    // Planilha 1: Resumo Geral
    const resumoData = [
      ['Relatório de Atendimento - Flow Queue'],
      ['Data do Relatório:', today],
      [],
      ['Métricas Gerais'],
      ['Total de Senhas Hoje', stats.totalToday],
      ['Senhas Atendidas', stats.totalServed],
      ['Senhas Aguardando', stats.totalWaiting],
      ['Tempo Médio de Espera (min)', stats.avgWaitTime],
      ['Tempo Médio de Atendimento (min)', stats.avgServiceTime],
      ['Horário de Pico', `${stats.peakHour}:00`],
      [],
      ['Por Prioridade'],
      ['Normal', stats.byPriority.normal],
      ['Preferencial', stats.byPriority.preferential],
      [],
      ['Por Fila'],
      ['Fila', 'Quantidade'],
      ...Object.entries(stats.byQueue).map(([queue, count]) => [queue, count]),
      [],
      ['Desempenho por Atendente'],
      ['Atendente', 'Guichê', 'Quantidade', 'Tempo Médio (seg)'],
      ...Object.entries(stats.byOperator).map(([op, data]) => [
        op,
        data.counter,
        data.count,
        data.avgTime,
      ]),
      [],
      ['Desempenho por Médico'],
      ['Nome', 'Consultório', 'Especialidade', 'Total de Atendimentos'],
      ...doctorStats.map((doctor) => [
        doctor.doctor_name,
        doctor.counter,
        doctor.specialty_name || 'Sem especialidade',
        doctor.total_tickets,
      ]),
      [],
      ['Senhas em Tempo Real'],
      [
        'Código',
        'Status',
        'Emissão',
        'Chamada',
        'Atendimento',
        'Cancelamento',
        'Tempo de Espera (min)',
      ],
      ...realtimeTickets.map((ticket) => [
        ticket.display_number,
        ticket.status === 'waiting'
          ? 'Aguardando'
          : ticket.status === 'called'
          ? 'Chamado'
          : ticket.status === 'served'
          ? 'Atendido'
          : 'Cancelado',
        new Date(ticket.created_at).toLocaleString('pt-BR'),
        ticket.called_at
          ? new Date(ticket.called_at).toLocaleString('pt-BR')
          : '-',
        ticket.served_at
          ? new Date(ticket.served_at).toLocaleString('pt-BR')
          : '-',
        ticket.cancelled_at
          ? new Date(ticket.cancelled_at).toLocaleString('pt-BR')
          : '-',
        ticket.wait_time,
      ]),
    ];

    // Planilha 2: Por Fila
    const filaData = [
      ['Atendimentos por Fila'],
      ['Fila', 'Quantidade'],
      ...Object.entries(stats.byQueue).map(([queue, count]) => [queue, count]),
    ];

    // Planilha 3: Desempenho por Atendente
    const atendenteData = [
      ['Desempenho por Atendente'],
      ['Atendente', 'Guichê', 'Quantidade', 'Tempo Médio (seg)'],
      ...Object.entries(stats.byOperator).map(([op, data]) => [
        op,
        data.counter,
        data.count,
        data.avgTime,
      ]),
    ];

    // Planilha 4: Desempenho por Médico
    const medicoData = [
      ['Desempenho por Médico'],
      ['Nome', 'Consultório', 'Especialidade', 'Total de Atendimentos'],
      ...doctorStats.map((doctor) => [
        doctor.doctor_name,
        doctor.counter,
        doctor.specialty_name || 'Sem especialidade',
        doctor.total_tickets,
      ]),
    ];

    // Planilha 5: Desempenho em Tempo Real
    const tempoRealData = [
      ['Desempenho em Tempo Real'],
      [
        'Código',
        'Status',
        'Emissão',
        'Chamada',
        'Atendimento',
        'Cancelamento',
        'Tempo de Espera (min)',
      ],
      ...realtimeTickets.map((ticket) => [
        ticket.display_number,
        ticket.status === 'waiting'
          ? 'Aguardando'
          : ticket.status === 'called'
          ? 'Chamado'
          : ticket.status === 'served'
          ? 'Atendido'
          : 'Cancelado',
        new Date(ticket.created_at).toLocaleString('pt-BR'),
        ticket.called_at
          ? new Date(ticket.called_at).toLocaleString('pt-BR')
          : '-',
        ticket.served_at
          ? new Date(ticket.served_at).toLocaleString('pt-BR')
          : '-',
        ticket.cancelled_at
          ? new Date(ticket.cancelled_at).toLocaleString('pt-BR')
          : '-',
        ticket.wait_time,
      ]),
    ];

    // Criar workbook
    const wb = XLSX.utils.book_new();

    // Adicionar planilhas
    const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
    const wsFila = XLSX.utils.aoa_to_sheet(filaData);
    const wsAtendente = XLSX.utils.aoa_to_sheet(atendenteData);
    const wsMedico = XLSX.utils.aoa_to_sheet(medicoData);
    const wsTempoReal = XLSX.utils.aoa_to_sheet(tempoRealData);

    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Geral');
    XLSX.utils.book_append_sheet(wb, wsFila, 'Por Fila');
    XLSX.utils.book_append_sheet(wb, wsAtendente, 'Por Atendente');
    XLSX.utils.book_append_sheet(wb, wsMedico, 'Por Médico');
    XLSX.utils.book_append_sheet(wb, wsTempoReal, 'Tempo Real');

    // Exportar
    XLSX.writeFile(wb, `relatorio-completo-${today}.xlsx`);
  };

  return (
    <div className='min-h-screen bg-gradient-to-br from-background to-muted p-4 md:p-8'>
      <div className='mx-auto max-w-7xl'>
        <div className='mb-6 flex justify-end gap-2'>
          {isSuperAdmin && (
            <Button onClick={() => navigate('/dashboard')} variant='outline'>
              <Home className='mr-2 h-4 w-4' />
              Dashboard
            </Button>
          )}
          <Button onClick={exportToExcel} variant='outline'>
            <Download className='mr-2 h-4 w-4' />
            Exportar Excel
          </Button>
          <Button onClick={handleLogout} variant='ghost'>
            <LogOut className='mr-2 h-4 w-4' />
            Sair
          </Button>
        </div>

        <div className='mb-8 text-center'>
          <h1 className='text-4xl font-bold text-foreground'>
            Painel Administrativo
          </h1>
          <p className='mt-2 text-muted-foreground'>
            Estatísticas e Gerenciamento
          </p>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          defaultValue='overview'
          className='space-y-8'
        >
          <TabsList className='grid w-full grid-cols-4'>
            <TabsTrigger value='overview'>Visão Geral</TabsTrigger>
            <TabsTrigger value='reports'>Relatórios</TabsTrigger>
            <TabsTrigger value='management'>Gerenciamento</TabsTrigger>
            <TabsTrigger value='settings'>Configurações</TabsTrigger>
          </TabsList>

          <TabsContent value='overview' className='space-y-8'>
            <div className='grid gap-6 md:grid-cols-2 lg:grid-cols-4'>
              <Card className='p-6 shadow-medium'>
                <div className='flex items-center gap-4'>
                  <div className='rounded-full bg-primary/10 p-3'>
                    <Users className='h-8 w-8 text-primary' />
                  </div>
                  <div>
                    <p className='text-sm text-muted-foreground'>Total Hoje</p>
                    <p className='text-3xl font-bold text-foreground'>
                      {stats.totalToday}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className='p-6 shadow-medium'>
                <div className='flex items-center gap-4'>
                  <div className='rounded-full bg-green-500/10 p-3'>
                    <CheckCircle className='h-8 w-8 text-green-500' />
                  </div>
                  <div>
                    <p className='text-sm text-muted-foreground'>Atendidos</p>
                    <p className='text-3xl font-bold text-foreground'>
                      {stats.totalServed}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className='p-6 shadow-medium'>
                <div className='flex items-center gap-4'>
                  <div className='rounded-full bg-blue-500/10 p-3'>
                    <TrendingUp className='h-8 w-8 text-blue-500' />
                  </div>
                  <div>
                    <p className='text-sm text-muted-foreground'>Aguardando</p>
                    <p className='text-3xl font-bold text-foreground'>
                      {stats.totalWaiting}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className='p-6 shadow-medium'>
                <div className='flex items-center gap-4'>
                  <div className='rounded-full bg-orange-500/10 p-3'>
                    <Clock className='h-8 w-8 text-orange-500' />
                  </div>
                  <div>
                    <p className='text-sm text-muted-foreground'>
                      Tempo Espera
                    </p>
                    <p className='text-3xl font-bold text-foreground'>
                      {stats.avgWaitTime}min
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            <div className='grid gap-6 md:grid-cols-2'>
              <Card className='p-6 shadow-medium'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-foreground'>
                    Tempo Médio Atendimento
                  </h2>
                  <Activity className='h-6 w-6 text-primary' />
                </div>
                <p className='text-5xl font-bold text-primary'>
                  {stats.avgServiceTime >= 60
                    ? `${Math.round(stats.avgServiceTime / 60)}min`
                    : `${stats.avgServiceTime}s`}
                </p>
                <p className='mt-2 text-sm text-muted-foreground'>
                  Por atendimento finalizado hoje
                </p>
              </Card>

              <Card className='p-6 shadow-medium'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-foreground'>
                    Horário de Pico
                  </h2>
                  <Clock className='h-6 w-6 text-warning' />
                </div>
                <p className='text-5xl font-bold text-warning'>
                  {stats.peakHour}:00
                </p>
                <p className='mt-2 text-sm text-muted-foreground'>
                  Maior volume de atendimentos
                </p>
              </Card>
            </div>

            <Card className='p-6 shadow-medium'>
              <h2 className='mb-4 text-xl font-bold text-foreground'>
                Por Prioridade
              </h2>
              <div className='space-y-4'>
                <div className='flex items-center justify-between rounded-lg bg-muted p-4'>
                  <span className='font-semibold text-foreground'>Normal</span>
                  <span className='text-2xl font-bold text-primary'>
                    {stats.byPriority.normal}
                  </span>
                </div>
                <div className='flex items-center justify-between rounded-lg bg-muted p-4'>
                  <span className='font-semibold text-foreground'>
                    Preferencial
                  </span>
                  <span className='text-2xl font-bold text-primary'>
                    {stats.byPriority.preferential}
                  </span>
                </div>
              </div>
            </Card>

            <Card className='p-6 shadow-medium'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-foreground'>
                  Desempenho por Atendente
                </h2>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={exportOperatorsToExcel}
                  title='Exportar para Excel'
                >
                  <Download className='h-4 w-4 mr-2' />
                  Exportar Excel
                </Button>
              </div>

              {Object.keys(stats.byOperator).length > 0 ? (
                <div className='overflow-x-auto'>
                  <table className='w-full'>
                    <thead>
                      <tr className='border-b border-border'>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Nome
                        </th>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Guichê
                        </th>
                        <th className='text-right py-3 px-4 font-semibold text-foreground'>
                          Qtd Atendimento
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(stats.byOperator).map(
                        ([operator, data]) => (
                          <tr
                            key={operator}
                            className='border-b border-border hover:bg-muted/50'
                          >
                            <td className='py-3 px-4 font-medium text-foreground'>
                              {operator}
                            </td>
                            <td className='py-3 px-4 text-muted-foreground'>
                              {data.counter}
                            </td>
                            <td className='py-3 px-4 text-right'>
                              <span className='font-bold text-primary text-lg'>
                                {data.count}
                              </span>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className='text-center text-muted-foreground py-8'>
                  Nenhum atendimento finalizado hoje
                </p>
              )}
            </Card>

            <Card className='p-6 shadow-medium'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-foreground'>
                  Desempenho por Médico
                </h2>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={exportDoctorsToExcel}
                  title='Exportar para Excel'
                >
                  <Download className='h-4 w-4 mr-2' />
                  Exportar Excel
                </Button>
              </div>

              {doctorStats.length > 0 ? (
                <div className='overflow-x-auto'>
                  <table className='w-full'>
                    <thead>
                      <tr className='border-b border-border'>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Nome
                        </th>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Consultório
                        </th>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Especialidade
                        </th>
                        <th className='text-right py-3 px-4 font-semibold text-foreground'>
                          Qtd Atendimento
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {doctorStats.map((doctor) => (
                        <tr
                          key={doctor.doctor_id}
                          className='border-b border-border hover:bg-muted/50'
                        >
                          <td className='py-3 px-4 font-medium text-foreground'>
                            {doctor.doctor_name}
                          </td>
                          <td className='py-3 px-4 text-muted-foreground'>
                            {doctor.counter}
                          </td>
                          <td className='py-3 px-4 text-muted-foreground'>
                            {doctor.specialty_name}
                          </td>
                          <td className='py-3 px-4 text-right'>
                            <span className='font-bold text-primary text-lg'>
                              {doctor.total_tickets}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className='text-center text-muted-foreground py-8'>
                  Nenhum atendimento médico hoje
                </p>
              )}
            </Card>

            <Card className='p-6 shadow-medium'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-foreground'>
                  Desempenho em Tempo Real
                </h2>
                <div className='flex items-center gap-2'>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className='w-[200px]'>
                      <SelectValue placeholder='Ordenar por' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='created_at_desc'>
                        Emissão (Mais recente)
                      </SelectItem>
                      <SelectItem value='created_at_asc'>
                        Emissão (Mais antiga)
                      </SelectItem>
                      <SelectItem value='display_number_asc'>
                        Código (A-Z)
                      </SelectItem>
                      <SelectItem value='display_number_desc'>
                        Código (Z-A)
                      </SelectItem>
                      <SelectItem value='status_asc'>Status (A-Z)</SelectItem>
                      <SelectItem value='status_desc'>Status (Z-A)</SelectItem>
                      <SelectItem value='called_at_desc'>
                        Finalização (Mais recente)
                      </SelectItem>
                      <SelectItem value='called_at_asc'>
                        Finalização (Mais antiga)
                      </SelectItem>
                      <SelectItem value='served_at_desc'>
                        Atendimento (Mais recente)
                      </SelectItem>
                      <SelectItem value='served_at_asc'>
                        Atendimento (Mais antiga)
                      </SelectItem>
                      <SelectItem value='cancelled_at_desc'>
                        Cancelamento (Mais recente)
                      </SelectItem>
                      <SelectItem value='cancelled_at_asc'>
                        Cancelamento (Mais antiga)
                      </SelectItem>
                      <SelectItem value='wait_time_desc'>
                        Tempo Espera (Maior)
                      </SelectItem>
                      <SelectItem value='wait_time_asc'>
                        Tempo Espera (Menor)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className='w-[180px]'>
                      <SelectValue placeholder='Filtrar por status' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Todos</SelectItem>
                      <SelectItem value='waiting'>Aguardando</SelectItem>
                      <SelectItem value='called'>Chamado</SelectItem>
                      <SelectItem value='served'>Atendido</SelectItem>
                      <SelectItem value='cancelled'>Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={exportRealtimeToExcel}
                    title='Exportar para Excel'
                  >
                    <Download className='h-4 w-4 mr-2' />
                    Exportar Excel
                  </Button>
                </div>
              </div>

              {loadingRealtime ? (
                <p className='text-center text-muted-foreground py-8'>
                  Carregando...
                </p>
              ) : (
                <div className='overflow-x-auto'>
                  <table className='w-full'>
                    <thead>
                      <tr className='border-b border-border'>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Código
                        </th>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Status
                        </th>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Emissão
                        </th>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Finalização
                        </th>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Atendimento
                        </th>
                        <th className='text-left py-3 px-4 font-semibold text-foreground'>
                          Cancelamento
                        </th>
                        <th className='text-center py-3 px-4 font-semibold text-foreground'>
                          Motivo
                        </th>
                        <th className='text-right py-3 px-4 font-semibold text-foreground'>
                          Tempo de Espera
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {realtimeTickets
                        .filter(
                          (ticket) =>
                            statusFilter === 'all' ||
                            ticket.status === statusFilter
                        )
                        .sort((a, b) => {
                          const [field, order] = sortBy.split('_');
                          const direction = order === 'asc' ? 1 : -1;

                          if (field === 'display') {
                            return (
                              direction *
                              a.display_number.localeCompare(b.display_number)
                            );
                          } else if (field === 'status') {
                            return direction * a.status.localeCompare(b.status);
                          } else if (field === 'wait') {
                            return direction * (a.wait_time - b.wait_time);
                          } else if (field === 'created') {
                            const aTime = new Date(a.created_at).getTime();
                            const bTime = new Date(b.created_at).getTime();
                            return direction * (aTime - bTime);
                          } else if (field === 'called') {
                            const aTime = a.called_at
                              ? new Date(a.called_at).getTime()
                              : 0;
                            const bTime = b.called_at
                              ? new Date(b.called_at).getTime()
                              : 0;
                            return direction * (aTime - bTime);
                          } else if (field === 'served') {
                            const aTime = a.served_at
                              ? new Date(a.served_at).getTime()
                              : 0;
                            const bTime = b.served_at
                              ? new Date(b.served_at).getTime()
                              : 0;
                            return direction * (aTime - bTime);
                          } else if (field === 'cancelled') {
                            const aTime = a.cancelled_at
                              ? new Date(a.cancelled_at).getTime()
                              : 0;
                            const bTime = b.cancelled_at
                              ? new Date(b.cancelled_at).getTime()
                              : 0;
                            return direction * (aTime - bTime);
                          }
                          return 0;
                        })
                        .slice(
                          (currentPage - 1) * itemsPerPage,
                          currentPage * itemsPerPage
                        )
                        .map((ticket) => {
                          const statusColors = {
                            waiting: 'bg-yellow-500/10 text-yellow-600',
                            called: 'bg-blue-500/10 text-blue-600',
                            served: 'bg-green-500/10 text-green-600',
                            cancelled: 'bg-red-500/10 text-red-600',
                          };

                          const statusLabels = {
                            waiting: 'Aguardando',
                            called: 'Chamado',
                            served: 'Atendido',
                            cancelled: 'Cancelado',
                          };

                          return (
                            <tr
                              key={ticket.id}
                              className='border-b border-border hover:bg-muted/50'
                            >
                              <td className='py-3 px-4 font-bold text-foreground text-lg'>
                                {ticket.display_number}
                              </td>
                              <td className='py-3 px-4'>
                                <span
                                  className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                    statusColors[ticket.status]
                                  }`}
                                >
                                  {statusLabels[ticket.status]}
                                </span>
                              </td>
                              <td className='py-3 px-4 text-muted-foreground'>
                                {new Date(ticket.created_at).toLocaleTimeString(
                                  'pt-BR',
                                  {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  }
                                )}
                              </td>
                              <td className='py-3 px-4 text-muted-foreground'>
                                {ticket.called_at
                                  ? new Date(
                                      ticket.called_at
                                    ).toLocaleTimeString('pt-BR', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '-'}
                              </td>
                              <td className='py-3 px-4 text-muted-foreground'>
                                {ticket.served_at
                                  ? new Date(
                                      ticket.served_at
                                    ).toLocaleTimeString('pt-BR', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '-'}
                              </td>
                              <td className='py-3 px-4 text-muted-foreground'>
                                {ticket.cancelled_at
                                  ? new Date(
                                      ticket.cancelled_at
                                    ).toLocaleTimeString('pt-BR', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '-'}
                              </td>
                              <td className='py-3 px-4 text-center'>
                                {ticket.status === 'cancelled' &&
                                ticket.cancellation_reason ? (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-8 w-8 p-0'
                                    title='Ver motivo do cancelamento'
                                    onClick={() => {
                                      setSelectedCancellationReason({
                                        display_number: ticket.display_number,
                                        reason:
                                          ticket.cancellation_reason || '',
                                      });
                                      setShowCancellationReasonModal(true);
                                    }}
                                  >
                                    <Eye className='h-4 w-4 text-red-500' />
                                  </Button>
                                ) : (
                                  <span className='text-muted-foreground'>
                                    -
                                  </span>
                                )}
                              </td>
                              <td className='py-3 px-4 text-right'>
                                <span className='font-bold text-primary text-lg'>
                                  {ticket.wait_time} min
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {(() => {
                    const filteredTickets = realtimeTickets.filter(
                      (ticket) =>
                        statusFilter === 'all' || ticket.status === statusFilter
                    );

                    if (filteredTickets.length === 0) {
                      return (
                        <p className='text-center text-muted-foreground py-8'>
                          Nenhum ticket encontrado
                        </p>
                      );
                    }

                    const totalPages = Math.ceil(
                      filteredTickets.length / itemsPerPage
                    );

                    return (
                      <div className='mt-4 flex items-center justify-between border-t pt-4'>
                        <p className='text-sm text-muted-foreground'>
                          Mostrando {(currentPage - 1) * itemsPerPage + 1} a{' '}
                          {Math.min(
                            currentPage * itemsPerPage,
                            filteredTickets.length
                          )}{' '}
                          de {filteredTickets.length} senhas
                        </p>
                        <div className='flex items-center gap-2'>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() =>
                              setCurrentPage((prev) => Math.max(1, prev - 1))
                            }
                            disabled={currentPage === 1}
                          >
                            Anterior
                          </Button>
                          <span className='text-sm text-muted-foreground'>
                            Página {currentPage} de {totalPages}
                          </span>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() =>
                              setCurrentPage((prev) =>
                                Math.min(totalPages, prev + 1)
                              )
                            }
                            disabled={currentPage === totalPages}
                          >
                            Próxima
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value='management' className='space-y-8'>
            <Card className='p-6 shadow-medium'>
              <div className='mb-6 flex items-center justify-between'>
                <h2 className='text-2xl font-bold text-foreground'>
                  Gerenciar Atendimentos
                </h2>
                <Button onClick={() => openDialog()}>
                  <Plus className='mr-2 h-4 w-4' />
                  Novo Atendimento
                </Button>
              </div>

              <div className='space-y-4'>
                {queues.map((queue) => (
                  <div
                    key={queue.id}
                    className='flex items-center justify-between rounded-lg bg-muted p-4'
                  >
                    <div className='flex-1'>
                      <div className='flex items-center gap-3'>
                        <h3 className='text-lg font-semibold text-foreground'>
                          {queue.name}
                        </h3>
                        <span className='rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary'>
                          {queue.code}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-sm font-semibold ${
                            queue.is_active
                              ? 'bg-green-500/10 text-green-500'
                              : 'bg-red-500/10 text-red-500'
                          }`}
                        >
                          {queue.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      {queue.description && (
                        <p className='mt-1 text-sm text-muted-foreground'>
                          {queue.description}
                        </p>
                      )}
                    </div>
                    <div className='flex gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => toggleQueueStatus(queue)}
                      >
                        {queue.is_active ? 'Desativar' : 'Ativar'}
                      </Button>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => openDialog(queue)}
                      >
                        <Edit className='h-4 w-4' />
                      </Button>
                      <Button
                        size='sm'
                        onClick={() => handleDeleteQueue(queue.id)}
                        className='bg-red-500 text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700'
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </div>
                  </div>
                ))}
                {queues.length === 0 && (
                  <p className='text-center text-muted-foreground'>
                    Nenhum atendimento cadastrado. Clique em "Novo Atendimento"
                    para começar.
                  </p>
                )}
              </div>
            </Card>

            <Card className='p-6 shadow-medium'>
              <h2 className='mb-6 text-2xl font-bold text-foreground'>
                Especialidades Médicas
              </h2>
              <p className='text-sm text-muted-foreground mb-4'>
                Gerenciar especialidades médicas disponíveis no sistema.
              </p>
              <Button onClick={() => navigate('/admin/specialties')}>
                <Users className='mr-2 h-4 w-4' />
                Gerenciar Especialidades
              </Button>
            </Card>

            <Card className='p-6 shadow-medium'>
              <h2 className='mb-6 text-2xl font-bold text-foreground'>
                Slides de Propaganda
              </h2>
              <p className='text-sm text-muted-foreground mb-4'>
                Gerenciar imagens que deseja exibir na área de propagandas do
                display.
              </p>
              <Button onClick={() => navigate('/admin/slides')}>
                Gerenciar Slides
              </Button>
            </Card>

            <Card className='p-6 shadow-medium'>
              <h2 className='mb-6 text-2xl font-bold text-foreground'>
                Gerenciamento de Usuários
              </h2>
              <p className='text-sm text-muted-foreground mb-4'>
                Gerenciar usuários, perfis de acesso e permissões do sistema.
              </p>
              <Button onClick={() => navigate('/users')}>
                <Users className='mr-2 h-4 w-4' />
                Gerenciar Usuários
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value='reports' className='space-y-8'>
            <Card className='p-6 shadow-medium'>
              <div className='mb-6'>
                <h2 className='text-2xl font-bold text-foreground mb-2'>
                  Relatórios e Analytics
                </h2>
                <p className='text-sm text-muted-foreground'>
                  Visualize relatórios detalhados, gráficos de desempenho e
                  exporte dados em PDF ou Excel.
                </p>
              </div>
              <Button onClick={() => navigate('/admin/reports')}>
                <BarChart3 className='mr-2 h-4 w-4' />
                Acessar Relatórios Completos
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value='settings' className='space-y-8'>
            <Card className='p-6 shadow-medium'>
              <h2 className='mb-6 text-2xl font-bold text-foreground'>
                Configurações da Empresa
              </h2>
              <div className='space-y-6'>
                <div>
                  <Label htmlFor='logo'>Logo da Empresa</Label>
                  <p className='text-sm text-muted-foreground mb-3'>
                    Faça upload da logo da sua empresa. Ela será exibida no
                    kiosk e no painel de display. Formatos aceitos: JPG, PNG,
                    GIF. Tamanho máximo: 5MB.
                  </p>

                  {currentLogo && (
                    <div className='mb-4 p-4 border rounded-lg bg-muted/50 flex flex-col items-center max-w-xs mx-auto'>
                      <div className='flex items-center justify-between w-full mb-3'>
                        <p className='text-sm font-medium'>Logo atual:</p>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={handleRemoveLogo}
                        >
                          <X className='h-4 w-4 mr-1' />
                          Remover
                        </Button>
                      </div>
                      <img
                        src={currentLogo}
                        alt='Logo da empresa'
                        className='max-h-24 max-w-full object-contain'
                      />
                    </div>
                  )}

                  <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                      isDragging
                        ? 'border-primary bg-primary/5'
                        : 'border-muted-foreground/25 hover:border-primary/50'
                    } ${
                      uploadingLogo
                        ? 'opacity-50 cursor-not-allowed'
                        : 'cursor-pointer'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() =>
                      !uploadingLogo && document.getElementById('logo')?.click()
                    }
                  >
                    <Upload className='h-12 w-12 mx-auto mb-4 text-muted-foreground' />
                    <p className='text-lg font-medium mb-2'>
                      {isDragging
                        ? 'Solte a imagem aqui'
                        : 'Arraste e solte a imagem ou clique para selecionar'}
                    </p>
                    <p className='text-sm text-muted-foreground'>
                      Formatos aceitos: JPG, PNG, GIF • Máx: 5MB
                    </p>
                    {uploadingLogo && (
                      <p className='text-sm text-primary mt-2 font-medium'>
                        Enviando...
                      </p>
                    )}
                  </div>

                  <Input
                    id='logo'
                    type='file'
                    accept='image/*'
                    onChange={handleLogoUpload}
                    disabled={uploadingLogo}
                    className='hidden'
                  />
                </div>
              </div>
            </Card>

            {isSuperAdmin && (
              <Card className='p-6 shadow-medium'>
                <h2 className='mb-6 text-2xl font-bold text-foreground'>
                  Impressão Térmica ESC/POS (Rede)
                </h2>
                <p className='text-sm text-muted-foreground mb-4'>
                  Configure o servidor de impressão local e a impressora térmica
                  de rede. O servidor deve estar rodando na mesma rede da
                  impressora.
                </p>
                <div className='space-y-4'>
                  <div>
                    <Label>URL do Servidor de Impressão Local</Label>
                    <Input
                      placeholder='Ex.: http://localhost:3030 ou http://192.168.0.10:3030'
                      value={printServerUrl}
                      onChange={(e) => setPrintServerUrl(e.target.value)}
                    />
                    <p className='text-xs text-muted-foreground mt-1'>
                      Servidor Node.js que roda localmente na pasta print-server
                    </p>
                  </div>

                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <div>
                      <Label>IP da Impressora (na rede local)</Label>
                      <Input
                        placeholder='Ex.: 192.168.0.50'
                        value={printerIp}
                        onChange={(e) => setPrinterIp(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Porta TCP</Label>
                      <Input
                        type='number'
                        placeholder='9100'
                        value={printerPort}
                        onChange={(e) =>
                          setPrinterPort(Number(e.target.value || 9100))
                        }
                      />
                    </div>
                  </div>

                  <div className='flex gap-2'>
                    <Button
                      onClick={savePrinterSettings}
                      disabled={printerLoading}
                    >
                      Salvar Configurações
                    </Button>
                    <Button
                      variant='outline'
                      onClick={testPrinter}
                      disabled={printerLoading}
                    >
                      Testar Impressora
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Dialog para criar/editar atendimento */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingQueue ? 'Editar Atendimento' : 'Novo Atendimento'}
              </DialogTitle>
              <DialogDescription>
                Preencha os dados do atendimento abaixo
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-4'>
              <div>
                <Label htmlFor='name'>Nome do Atendimento *</Label>
                <Input
                  id='name'
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder='Ex: Atendimento Geral'
                />
              </div>
              <div>
                <Label htmlFor='code'>Código *</Label>
                <Input
                  id='code'
                  value={formData.code}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder='Ex: AG'
                  maxLength={3}
                />
              </div>
              <div className='flex items-center gap-2'>
                <input
                  id='preferential'
                  type='checkbox'
                  checked={formData.preferential}
                  onChange={(e) =>
                    setFormData({ ...formData, preferential: e.target.checked })
                  }
                />
                <Label htmlFor='preferential'>Preferencial</Label>
              </div>
              <div>
                <Label htmlFor='description'>Descrição</Label>
                <Textarea
                  id='description'
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder='Descrição do atendimento (opcional)'
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setIsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveQueue}>
                {editingQueue ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal para exibir motivo do cancelamento */}
        <Dialog
          open={showCancellationReasonModal}
          onOpenChange={setShowCancellationReasonModal}
        >
          <DialogContent className='sm:max-w-lg max-w-[90vw]'>
            <DialogHeader>
              <DialogTitle className='flex items-center gap-2'>
                <Eye className='h-5 w-5 text-red-500' />
                Motivo do Cancelamento
              </DialogTitle>
              <DialogDescription className='break-words'>
                Senha:{' '}
                <strong>{selectedCancellationReason?.display_number}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className='py-4 max-h-[60vh] overflow-y-auto'>
              <div className='rounded-lg bg-red-50 dark:bg-red-950/20 p-4 border border-red-200 dark:border-red-800'>
                <p className='text-foreground break-words overflow-wrap-anywhere whitespace-pre-wrap'>
                  {selectedCancellationReason?.reason || 'Motivo não informado'}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => {
                  setShowCancellationReasonModal(false);
                  setSelectedCancellationReason(null);
                }}
              >
                Fechar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Admin;
