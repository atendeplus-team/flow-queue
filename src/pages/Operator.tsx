import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import {
  ArrowLeft,
  Phone,
  CheckCircle,
  Repeat,
  LogOut,
  Loader2,
  Send,
  XCircle,
  Home,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import type { User } from '@supabase/supabase-js';

interface Ticket {
  id: string;
  display_number: string;
  priority: string;
  status: string;
  created_at: string;
  queue_id: string;
  ticket_number?: string | number;
  urgent?: number;
  urgent_date?: string;
}

const Operator = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [currentTicket, setCurrentTicket] = useState<Ticket | null>(null);
  const [waitPage, setWaitPage] = useState(0);
  const PAGE_SIZE = 7;
  const [operatorName, setOperatorName] = useState('');
  const [counter, setCounter] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [callCount, setCallCount] = useState(0);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [restoringCurrent, setRestoringCurrent] = useState(false);
  const loadingRef = undefined;
  const lastLoadRef = undefined;
  const [authChecked, setAuthChecked] = useState(false);
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  const [patientName, setPatientName] = useState('');
  // Lista de médicos e seleção para encaminhar
  const [doctors, setDoctors] = useState<
    Array<{
      id: string;
      full_name: string;
      company: string;
      specialty_name?: string;
    }>
  >([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedDoctorName, setSelectedDoctorName] = useState<string>('');
  const [selectedDoctorConsultorio, setSelectedDoctorConsultorio] =
    useState<string>('');
  const [selectedDoctorSpecialty, setSelectedDoctorSpecialty] =
    useState<string>('');

  const [finishing, setFinishing] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    isOperator,
    isAdmin,
    isVisitor,
    isSuperAdmin,
    loading: roleLoading,
  } = useUserRole(currentUser);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  useEffect(() => {
    checkAuth();
    // Listener de mudanças de auth para evitar piscar entre rotas
    const { data: authSub } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            setCurrentUser(session.user);
            setAuthChecked(true);
          }
        } else if (event === 'SIGNED_OUT') {
          setCurrentUser(null);
          setAuthChecked(true);
          // ProtectedRoute fará o redirect
        }
      }
    );

    return () => {
      authSub?.subscription?.unsubscribe?.();
    };
  }, []);

  const checkAuth = async () => {
    // Aumenta janela de espera para evitar "piscar" durante login
    const maxAttempts = 8; // ~2s (listener cobre o restante)
    const delayMs = 250;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        setCurrentUser(session.user);
        setAuthChecked(true);
        return;
      }
      await new Promise((res) => setTimeout(res, delayMs));
    }

    // Marca verificação concluída, sem redirecionar aqui.
    // ProtectedRoute cuidará do redirect conforme estado/roles.
    setAuthChecked(true);
  };

  useEffect(() => {
    const loadProfile = async () => {
      if (!currentUser || roleLoading) return;

      if (isVisitor) {
        toast({
          title: 'Acesso negado',
          description: 'Toten não pode operar o painel de atendimento.',
          variant: 'destructive',
        });
        navigate('/dashboard');
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('full_name, company')
        .eq('id', currentUser.id)
        .single();

      setOperatorName(profile?.full_name || '');
      // Se não houver company definido, usar o nome do operador como fallback
      const counterValue =
        profile?.company || profile?.full_name || 'Atendimento';
      setCounter(counterValue);
      const savedCallCount = localStorage.getItem('callCount');
      setCallCount(savedCallCount ? parseInt(savedCallCount) : 0);
      setIsConfigured(true);
      loadWaitingTickets();
    };

    loadProfile();
  }, [currentUser, isVisitor, roleLoading]);

  useEffect(() => {
    const restoreCurrentTicket = async () => {
      setRestoringCurrent(true);
      const savedId = localStorage.getItem('currentTicketId');
      if (savedId) {
        const { data } = await supabase
          .from('tickets')
          .select('*')
          .eq('id', savedId)
          .eq('status', 'called')
          .single();
        if (data) setCurrentTicket(data as Ticket);
      }
      setRestoringCurrent(false);
    };

    if (isConfigured) {
      restoreCurrentTicket();
      loadWaitingTickets();
      const interval = setInterval(loadWaitingTickets, 5000);
      return () => clearInterval(interval);
    }
  }, [isConfigured]);

  // Carrega lista de médicos ao abrir o modal e prepara seleção
  useEffect(() => {
    if (!showFinishDialog) return;
    (async () => {
      try {
        // Busca todos os perfis
        const { data: profiles, error: profilesError } = await (supabase as any)
          .from('profiles')
          .select(
            'id, full_name, company, specialty_id, medical_specialties(name)'
          )
          .order('full_name');

        if (profilesError) throw profilesError;

        // Busca todas as roles
        const { data: userRoles, error: rolesError } = await supabase
          .from('user_roles')
          .select('user_id, role');

        if (rolesError) throw rolesError;

        // Filtra apenas usuários que têm a role 'doctor'
        const doctorProfiles =
          profiles
            ?.filter((profile) => {
              const roles = userRoles
                ?.filter((ur) => ur.user_id === profile.id)
                .map((ur) => ur.role);
              return roles?.includes('doctor');
            })
            .map((profile) => ({
              id: profile.id,
              full_name: profile.full_name,
              company: profile.company,
              specialty_name: profile.medical_specialties?.name || '',
            })) || [];

        setDoctors(doctorProfiles as any);
      } catch (error) {
        console.error('Erro ao carregar médicos:', error);
        setDoctors([]);
      }
    })();
  }, [showFinishDialog]);

  const loadWaitingTickets = async () => {
    // Adiciona timeout de 10s para evitar travamento
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      // Busca configuração de chamadas para decidir comportamento
      const { data: settings } = await supabase
        .from('company_settings')
        .select('password_setting')
        .limit(1)
        .single();

      const passwordSetting = settings?.password_setting || 1;

      // Se modo Ordem de Chegada, buscamos tickets por created_at (mais antigo primeiro)
      if (Number(passwordSetting) === 2) {
        try {
          const nowDate = new Date();
          const startOfDay = new Date(
            Date.UTC(
              nowDate.getUTCFullYear(),
              nowDate.getUTCMonth(),
              nowDate.getUTCDate(),
              0,
              0,
              0
            )
          );
          const startOfDayISO = startOfDay.toISOString();

          // Buscar tickets para ordenar por ordem de chegada (por created_at)
          const { data: rows, error } = await supabase
            .from('tickets')
            .select('id, display_number, priority, queue_id, created_at, ticket_number, urgent, urgent_date')
            .is('finished_at', null)
            .eq('in_service', false)
            .gte('created_at', startOfDayISO)
            .limit(500);

          if (error) throw error;

          const items = (rows || []) as any[];
          const mapped = items
            .map((d) => ({
              id: d.id,
              display_number: d.display_number,
              priority: d.priority,
              queue_id: d.queue_id,
              created_at: d.created_at,
              ticket_number: d.ticket_number,
              urgent: d.urgent || 0,
              urgent_date: d.urgent_date || null,
              status: 'waiting',
            }))
            // Ordena: urgentes primeiro (por urgent_date asc), depois por created_at asc
            .sort((a: any, b: any) => {
              if ((a.urgent || 0) !== (b.urgent || 0)) return (b.urgent || 0) - (a.urgent || 0);
              if (a.urgent && b.urgent) {
                return new Date(a.urgent_date || 0).getTime() - new Date(b.urgent_date || 0).getTime();
              }
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            });
          setTickets(mapped as any);
          setWaitPage(0);
          return;
        } catch (e: any) {
          toast({
            title: 'Erro ao carregar senhas',
            description: e.message || String(e),
            variant: 'destructive',
          });
          return;
        }
      }

      // Padrão: usar preview com lógica 2 para 1 (ou o que a função edge retornar)
      const { data, error } = await supabase.functions.invoke('queue-preview', {
        body: {},
        signal: controller.signal,
      });

      if (error) {
        toast({
          title: 'Erro ao carregar senhas',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }

      const items = (data as any)?.items as any[] | undefined;
      if (items && Array.isArray(items)) {
        const prev = tickets || [];
        const ids = items.map((d: any) => d.id).filter(Boolean);
        let urgentInfo: Array<{ id: string; urgent: number; urgent_date: string | null }> = [];
        try {
          // @ts-ignore
          const { data: ui } = await (supabase as any)
            .from('tickets')
            .select('id, urgent, urgent_date')
            .in('id', ids || []);
          urgentInfo = ui || [];
        } catch (e) {
          urgentInfo = [];
        }
        const urgentMap: Record<string, any> = {};
        urgentInfo.forEach((u: any) => (urgentMap[u.id] = u));

        const originalIndexMap: Record<string, number> = {};
        items.forEach((it: any, idx: number) => { if (it && it.id) originalIndexMap[it.id] = idx; });

        const mapped = items.map((d: any, idx: number) => ({
          id: d.id,
          display_number: d.display_number,
          priority: d.priority,
          queue_id: d.queue_id,
          created_at: d.created_at,
          status: 'waiting',
          urgent: typeof d.urgent !== 'undefined' ? d.urgent : (urgentMap[d.id]?.urgent ?? (prev.find((p:any)=>p.id===d.id)?.urgent || 0)),
          urgent_date: typeof d.urgent_date !== 'undefined' ? d.urgent_date : (urgentMap[d.id]?.urgent_date ?? (prev.find((p:any)=>p.id===d.id)?.urgent_date || null)),
          __original_index: idx,
        }));

        // Separar urgentes e não-urgentes
        const urgentList = mapped.filter((m: any) => m.urgent).sort((a: any, b: any) => new Date(a.urgent_date || 0).getTime() - new Date(b.urgent_date || 0).getTime());
        let nonUrgentList = mapped.filter((m: any) => !m.urgent);

        // Se o modo atual é Ordem de Chegada (2), ordenar não-urgentes por created_at
        if (Number(passwordSetting) === 2) {
          nonUrgentList = nonUrgentList.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        } else {
          // Modo 2-para-1: preservar ordem original fornecida pela edge function
          nonUrgentList = nonUrgentList.sort((a: any, b: any) => (originalIndexMap[a.id] || 0) - (originalIndexMap[b.id] || 0));
        }

        const finalList = [...urgentList, ...nonUrgentList];
        // Debug: inspeciona dados recebidos e merge realizado
        // eslint-disable-next-line no-console
        console.log('queue-preview items:', items);
        // eslint-disable-next-line no-console
        console.log('tickets urgentMap:', urgentMap);
        // eslint-disable-next-line no-console
        console.log('tickets finalList after merge:', finalList);
        setTickets(finalList as any);
        setWaitPage((prev) => {
          const maxPage = Math.max(
            0,
            Math.floor(Math.max(0, (items.length - 1) / PAGE_SIZE))
          );
          return Math.min(prev, maxPage);
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  };

  const callNextTicket = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        // PRIORIDADE: se existir alguma senha urgente aguardando, chamar ela primeiro
        try {
          // @ts-ignore
          const { data: urgentRows, error: urgentError } = await (supabase as any)
            .from('tickets')
            .select('id, display_number, priority, created_at, urgent, urgent_date')
            .eq('status', 'waiting')
            .is('in_service', false)
            .is('finished_at', null)
            .eq('urgent', 1)
            .order('urgent_date', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(1);

          if (!urgentError && urgentRows && urgentRows.length > 0) {
            const urgentTicket = urgentRows[0] as any;
            const nowUrg = new Date().toISOString();
            // @ts-ignore
            const { data: calledData, error: callError } = await (supabase as any)
              .from('tickets')
              .update({
                status: 'called',
                called_at: nowUrg,
                operator_name: operatorName,
                counter,
                in_service: true,
              })
              .eq('id', urgentTicket.id)
              .eq('status', 'waiting')
              .is('in_service', false)
              .select('*')
              .single();

            if (!callError && calledData) {
              const newCallCount = callCount + 1;
              setCallCount(newCallCount);
              localStorage.setItem('callCount', newCallCount.toString());
              setCurrentTicket(calledData as Ticket);
              localStorage.setItem('currentTicketId', calledData.id);
              toast({
                title: 'Senha urgente chamada',
                description: `Senha ${calledData.display_number} (urgente) chamada!`,
              });
              loadWaitingTickets();
              clearTimeout(timeout);
              return;
            }
          }
        } catch (e) {
          console.warn('Erro ao priorizar urgentes:', e);
        }

      // Buscar configuração (1 = padrão, 2 = ordem de chegada)
      let passwordSetting = 1;
      try {
        const { data: settings } = await supabase
          .from('company_settings')
          .select('password_setting')
          .limit(1)
          .single();
        passwordSetting = settings?.password_setting || 1;
      } catch (e) {
        console.warn('Falha ao ler company_settings, usando padrão', e);
      }

      // Se modo padrão (1) -> usar edge function existente
      if (Number(passwordSetting) === 1) {
        const { data, error } = await supabase.functions.invoke('call-next', {
          body: { operator_name: operatorName, counter },
          signal: controller.signal,
        });

        if (error) {
          toast({
            title: 'Erro ao chamar senha',
            description: error.message,
            variant: 'destructive',
          });
          return;
        }

        const nextTicket = (data as any)?.next as Ticket | null;
        if (!nextTicket) {
          toast({
            title: 'Nenhuma senha disponível',
            description: 'Não há senhas aguardando no momento.',
          });
          return;
        }

        const newCallCount = callCount + 1;
        setCallCount(newCallCount);
        localStorage.setItem('callCount', newCallCount.toString());

        setCurrentTicket(nextTicket);
        localStorage.setItem('currentTicketId', nextTicket.id);
        toast({
          title: 'Senha chamada',
          description: `Senha ${nextTicket.display_number} foi chamada!`,
        });
        loadWaitingTickets();
        return;
      }

      // Se modo = 2 (ordem de chegada): chamar próxima senha criada após a atual
      // Determinar created_at atual (timestamp)
      const currentTs = currentTicket ? new Date(currentTicket.created_at).getTime() : null;

      // Buscar tickets aguardando e filtrar/ordenar por created_at
      // @ts-ignore
      const { data: rows, error: rowsError } = await (supabase as any)
        .from('tickets')
        .select('id, display_number, priority, queue_id, created_at, ticket_number')
        .eq('status', 'waiting')
        .is('in_service', false)
        .is('finished_at', null)
        .limit(500);

      if (rowsError) {
        toast({
          title: 'Erro ao buscar senhas',
          description: rowsError.message || String(rowsError),
          variant: 'destructive',
        });
        return;
      }

      const items = (rows || []) as any[];
      const mapped = items
        .map((d) => ({
          id: d.id,
          display_number: d.display_number,
          priority: d.priority,
          queue_id: d.queue_id,
          created_at: d.created_at,
          created_ts: new Date(d.created_at).getTime(),
          ticket_number: d.ticket_number,
        }))
        .sort((a, b) => a.created_ts - b.created_ts);

      // Seleciona candidatos:
      const candidates = currentTs
        ? mapped.filter((it) => it.created_ts > currentTs)
        : mapped;

      if (!candidates || candidates.length === 0) {
        toast({
          title: 'Nenhuma senha disponível',
          description: 'Não há senhas disponíveis após a atual.',
        });
        return;
      }

      const toCall = candidates[0];
      const now = new Date().toISOString();
      // @ts-ignore
      const { data: calledData, error: callError } = await (supabase as any)
        .from('tickets')
        .update({
          status: 'called',
          called_at: now,
          operator_name: operatorName,
          counter,
          in_service: true,
        })
        .eq('id', toCall.id)
        .eq('status', 'waiting')
        .is('in_service', false)
        .select('*')
        .single();

      if (callError) {
        toast({
          title: 'Erro ao chamar senha',
          description: callError.message || String(callError),
          variant: 'destructive',
        });
        return;
      }

      const nextTicket = calledData as Ticket;
      const newCallCount = callCount + 1;
      setCallCount(newCallCount);
      localStorage.setItem('callCount', newCallCount.toString());

      setCurrentTicket(nextTicket);
      localStorage.setItem('currentTicketId', nextTicket.id);
      toast({
        title: 'Senha chamada',
        description: `Senha ${nextTicket.display_number} foi chamada!`,
      });
      loadWaitingTickets();
    } finally {
      clearTimeout(timeout);
    }
  };

  const repeatCall = async () => {
    if (!currentTicket) return false;

    // Atualizar o called_at para disparar o realtime no Display
    const { error } = await supabase
      .from('tickets')
      .update({
        called_at: new Date().toISOString(),
      })
      .eq('id', currentTicket.id);

    if (error) {
      toast({
        title: 'Erro ao repetir chamada',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Chamada repetida',
      description: `Senha ${currentTicket.display_number} chamada novamente!`,
    });
  };

  const cancelTicket = async () => {
    if (!currentTicket) return;

    // Validar se o motivo foi informado
    if (!cancellationReason.trim()) {
      toast({
        title: 'Motivo obrigatório',
        description: 'É necessário informar o motivo do cancelamento.',
        variant: 'destructive',
      });
      return;
    }

    if (cancellationReason.length > 200) {
      toast({
        title: 'Motivo muito longo',
        description: 'O motivo deve ter no máximo 200 caracteres.',
        variant: 'destructive',
      });
      return;
    }

    const now = new Date().toISOString();

    const { error } = await supabase
      .from('tickets')
      .update({
        status: 'cancelled',
        cancelled_at: now,
        finished_at: now,
        in_service: false,
        cancellation_reason: cancellationReason.trim(),
      })
      .eq('id', currentTicket.id);

    if (error) {
      toast({
        title: 'Erro ao cancelar senha',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Senha cancelada',
      description: `Senha ${currentTicket.display_number} foi cancelada.`,
      variant: 'destructive',
    });

    setCurrentTicket(null);
    setCancellationReason('');
    setShowCancelDialog(false);
    localStorage.removeItem('currentTicketId');
    loadWaitingTickets();
  };

  const finishService = async (): Promise<boolean> => {
    if (!currentTicket) return false;

    const now = new Date().toISOString();
    const { data: ticketData } = await supabase
      .from('tickets')
      .select('called_at, queue_id')
      .eq('id', currentTicket.id)
      .single();

    // NÃO marcar como served aqui - primeiro inserir no doctor_tickets
    // Depois de inserir com sucesso, marcar a senha original como served

    const { data: queueData } = await supabase
      .from('queues')
      .select('code')
      .eq('id', ticketData?.queue_id)
      .single();

    // Logs não são mais necessários para a fila; mantemos somente doctor_tickets

    // Tenta inserir na tabela `doctor_tickets` usando os dados do médico selecionado
    // Se falhar, tenta um fallback mais simples (sem doctor_name/consultório)
    let dtError: any = null;
    let dtFallbackError: any = null;

    try {
      if (selectedDoctorId) {
        const res = await (supabase as any).from('doctor_tickets').insert({
          ticket_id: currentTicket.id,
          display_number: currentTicket.display_number,
          patient_name: patientName,
          priority: currentTicket.priority,
          status: 'waiting',
          operator_name: operatorName,
          doctor_name: selectedDoctorName,
          doctor_id: selectedDoctorId,
          counter: selectedDoctorConsultorio || counter,
          urgent: (currentTicket as any).urgent || 0,
          urgent_date: (currentTicket as any).urgent_date || null,
          in_service: false,
          finished_at: null,
          called_at: null,
          queue_code: queueData?.code || '',
        });
        dtError = res.error;
      } else {
        const res = await (supabase as any).from('doctor_tickets').insert({
          ticket_id: currentTicket.id,
          display_number: currentTicket.display_number,
          patient_name: patientName,
          priority: currentTicket.priority,
          status: 'waiting',
          operator_name: operatorName,
          urgent: (currentTicket as any).urgent || 0,
          urgent_date: (currentTicket as any).urgent_date || null,
          counter: counter,
          in_service: false,
          finished_at: null,
          called_at: null,
          queue_code: queueData?.code || '',
        });
        dtError = res.error;
      }
    } catch (err) {
      dtError = err;
    }

    if (dtError) {
      try {
        const res2 = await (supabase as any).from('doctor_tickets').insert({
          ticket_id: currentTicket.id,
          display_number: currentTicket.display_number,
          priority: currentTicket.priority,
          status: 'waiting',
          operator_name: operatorName,
          urgent: (currentTicket as any).urgent || 0,
          urgent_date: (currentTicket as any).urgent_date || null,
          counter: counter,
          in_service: false,
          finished_at: null,
          called_at: null,
          queue_code: queueData?.code || '',
        });
        dtFallbackError = res2.error;
      } catch (err) {
        dtFallbackError = err;
      }

      if (dtFallbackError) {
        toast({
          title: 'Erro ao encaminhar ao médico',
          description:
            dtFallbackError?.message || 'Verifique a tabela doctor_tickets.',
          variant: 'destructive',
        });
        return false;
      }
    }

    // Marcar a senha original como "served" após encaminhar com sucesso
    await supabase
      .from('tickets')
      .update({
        status: 'served',
        served_at: now,
        finished_at: now,
        in_service: false,
      })
      .eq('id', currentTicket.id);

    const doctorInfo = selectedDoctorName
      ? `Dr(a). ${selectedDoctorName}${
          selectedDoctorSpecialty ? ` - ${selectedDoctorSpecialty}` : ''
        }${selectedDoctorConsultorio ? ` - ${selectedDoctorConsultorio}` : ''}`
      : 'médico';

    toast({
      title: 'Senha encaminhada',
      description: `Senha ${currentTicket.display_number} de ${patientName} foi encaminhada para ${doctorInfo}`,
    });
    setCurrentTicket(null);
    localStorage.removeItem('currentTicketId');
    return true;
  };

  // Enquanto auth não foi checado ou não há usuário, evita render que acione efeitos.
  if (!authChecked) {
    return (
      <div className='h-screen flex items-center justify-center'>
        <Loader2 className='h-8 w-8 animate-spin text-primary' />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className='h-screen flex items-center justify-center'>
        <div className='text-center'>
          <p className='mb-4 text-muted-foreground'>
            Faça login para continuar
          </p>
          <Button onClick={() => navigate('/auth', { replace: true })}>
            Ir para Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className='h-screen overflow-hidden bg-gradient-to-br from-background to-muted p-4 md:p-6'>
        <div className='mx-auto max-w-6xl'>
          <div className='mb-4 flex items-center justify-between'>
            {(isAdmin || isSuperAdmin) && (
              <Button variant='outline' onClick={() => navigate('/dashboard')}>
                <Home className='mr-2 h-4 w-4' />
                Dashboard
              </Button>
            )}

            <div
              className={`flex items-center gap-4 ${
                !isAdmin && !isSuperAdmin ? 'ml-auto' : ''
              }`}
            >
              <div className='text-right'>
                <p className='font-semibold text-foreground'>{operatorName}</p>
                <p className='text-sm text-muted-foreground'>
                  Guichê: {counter}
                </p>
              </div>
              <Button variant='ghost' onClick={handleLogout}>
                <LogOut className='mr-2 h-4 w-4' />
                Sair
              </Button>
            </div>
          </div>

          <div className='grid gap-4 lg:grid-cols-3'>
            {/* Current Ticket */}
            <Card className='lg:col-span-2 p-6 shadow-medium'>
              <h2 className='mb-6 text-2xl font-bold text-foreground'>
                Senha Atual
              </h2>

              {currentTicket ? (
                <div className='space-y-6'>
                  <div className='rounded-lg bg-gradient-primary p-6 text-center text-white shadow-large'>
                    <p className='mb-2 text-xl font-semibold'>Atendendo</p>
                    <p className='text-7xl font-bold'>
                      {currentTicket.display_number}
                    </p>
                  </div>

                  <div className='space-y-4'>
                    <div className='grid gap-4 sm:grid-cols-2'>
                      <Button
                        size='lg'
                        variant='outline'
                        onClick={repeatCall}
                        className='w-full'
                      >
                        <Repeat className='mr-2 h-5 w-5' />
                        Repetir Chamada
                      </Button>

                      <Button
                        size='lg'
                        onClick={() => setShowFinishDialog(true)}
                        className='w-full bg-gradient-success'
                      >
                        <Send className='mr-2 h-5 w-5' />
                        Encaminhar Senha
                      </Button>
                    </div>

                    <Button
                      size='lg'
                      variant='destructive'
                      onClick={() => setShowCancelDialog(true)}
                      className='w-full'
                    >
                      <XCircle className='mr-2 h-5 w-5' />
                      Cancelar Senha
                    </Button>
                  </div>
                </div>
              ) : restoringCurrent ? (
                <div className='py-8 text-center'>
                  <Loader2 className='h-8 w-8 animate-spin mx-auto text-primary' />
                  <p className='mt-4 text-muted-foreground'>Carregando...</p>
                </div>
              ) : (
                <div className='py-8 text-center'>
                  <p className='mb-6 text-xl text-muted-foreground'>
                    Nenhuma senha em atendimento
                  </p>
                  <Button
                    size='lg'
                    onClick={callNextTicket}
                    className='bg-gradient-primary'
                    disabled={tickets.length === 0}
                  >
                    <Phone className='mr-2 h-5 w-5' />
                    Chamar Próxima Senha
                  </Button>
                </div>
              )}
            </Card>

            {/* Waiting Queue */}
            <Card className='p-5 shadow-medium'>
              <h2 className='mb-4 text-xl font-bold text-foreground'>
                Fila de Espera
              </h2>

              <div className='mb-3 text-center'>
                <p className='text-4xl font-bold text-primary'>
                  {tickets.length}
                </p>
                <p className='text-sm text-muted-foreground'>
                  senhas aguardando
                </p>
              </div>

              <div className='space-y-2'>
                {tickets
                  .slice(waitPage * PAGE_SIZE, (waitPage + 1) * PAGE_SIZE)
                  .map((ticket, index) => (
                    <div
                      key={ticket.id}
                        className={`flex items-center justify-between rounded-lg p-3 ${ticket.urgent ? 'bg-red-50' : 'bg-muted'}`}
                    >
                      <div className='flex items-center gap-3'>
                        <span className='flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground'>
                          {index + 1 + waitPage * PAGE_SIZE}
                        </span>
                          <span className={`font-semibold ${ticket.urgent ? 'text-red-600' : 'text-foreground'}`}>
                            {ticket.display_number}
                          </span>
                      </div>
                        <div className='flex items-center gap-2'>
                          {ticket.priority !== 'normal' && (
                            <Badge variant='secondary'>Preferencial</Badge>
                          )}
                          <Button
                            size='sm'
                            variant={ticket.urgent ? 'destructive' : 'outline'}
                            className={`${ticket.urgent ? 'bg-red-600 text-white hover:bg-red-700' : 'hover:bg-red-600 hover:text-white hover:border-red-600'} ${ticket.urgent ? 'text-xs px-2 py-1 h-8' : 'px-3 py-1'}`}
                            onClick={async () => {
                              try {
                                const newUrgent = ticket.urgent ? 0 : 1;
                                const urgentDate = newUrgent ? new Date().toISOString() : null;
                                // Atualiza ticket
                                const { error: updateError } = await (supabase as any)
                                  .from('tickets')
                                  .update({ urgent: newUrgent, urgent_date: urgentDate })
                                  .eq('id', ticket.id);
                                if (updateError) throw updateError;

                                // Insere no histórico
                                const { error: histErr } = await (supabase as any)
                                  .from('ticket_history')
                                  .insert({
                                    ticket_id: ticket.id,
                                    display_number: ticket.display_number,
                                    event_type: newUrgent ? 'marcado_urgente' : 'retirado_urgente',
                                    event_description: newUrgent ? 'Senha marcada como urgente' : 'Urgência retirada da senha',
                                    urgent: newUrgent,
                                    urgent_date: urgentDate,
                                    created_at: new Date().toISOString(),
                                  });
                                if (histErr) throw histErr;

                                // Atualiza estado local (refetch simples)
                                loadWaitingTickets();
                                toast({
                                  title: newUrgent ? 'Senha marcada como urgente' : 'Urgência removida',
                                  description: `Senha ${ticket.display_number}`,
                                });
                              } catch (err: any) {
                                console.error('Erro ao alternar urgente:', err);
                                toast({ title: 'Erro', description: err.message || String(err), variant: 'destructive' });
                              }
                            }}
                          >
                            {ticket.urgent ? <span className='text-xs'>Retirar Urgente</span> : 'Urgente'}
                          </Button>
                        </div>
                    </div>
                  ))}
              </div>
              <div className='mt-3 flex justify-between'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setWaitPage((p) => Math.max(0, p - 1))}
                  disabled={waitPage === 0}
                >
                  Anterior
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    setWaitPage((p) => {
                      const maxPage = Math.max(
                        0,
                        Math.floor(Math.max(0, tickets.length - 1) / PAGE_SIZE)
                      );
                      return Math.min(maxPage, p + 1);
                    })
                  }
                  disabled={(waitPage + 1) * PAGE_SIZE >= tickets.length}
                >
                  Próximas
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
      <Dialog
        open={showFinishDialog}
        onOpenChange={(open) => {
          setShowFinishDialog(open);
          if (!open) {
            setPatientName('');
            setSelectedDoctorId('');
            setSelectedDoctorName('');
            setSelectedDoctorConsultorio('');
            setSelectedDoctorSpecialty('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encaminhar Senha</DialogTitle>
            <DialogDescription>
              Informe o nome do paciente e o médico para qual será encaminhado
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-2'>
              <Label>Nome do Paciente</Label>
              <Input
                type='text'
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder='Ex.: João Alexandre'
                autoComplete='name'
              />
            </div>
            <div className='space-y-2'>
              <Label>Médico</Label>
              <Select
                value={selectedDoctorId}
                onValueChange={(value) => {
                  setSelectedDoctorId(value);
                  const doctor = doctors.find((d) => d.id === value);
                  if (doctor) {
                    setSelectedDoctorName(doctor.full_name);
                    setSelectedDoctorConsultorio(doctor.company || '');
                    setSelectedDoctorSpecialty(doctor.specialty_name || '');
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Selecione o médico' />
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.full_name}
                      {doctor.specialty_name && ` - ${doctor.specialty_name}`}
                      {doctor.company && ` - Consultório: ${doctor.company}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setShowFinishDialog(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!patientName.trim()) {
                  toast({
                    title: 'Informe o nome do paciente',
                    variant: 'destructive',
                  });
                  return;
                }
                if (!selectedDoctorId) {
                  toast({
                    title: 'Selecione o médico',
                    variant: 'destructive',
                  });
                  return;
                }
                setFinishing(true);
                const ok = await finishService();
                setFinishing(false);
                if (ok) {
                  setShowFinishDialog(false);
                  setPatientName('');
                  setSelectedDoctorId('');
                  setSelectedDoctorName('');
                  setSelectedDoctorConsultorio('');
                }
              }}
              disabled={finishing}
            >
              Salvar e Finalizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog para cancelar senha com motivo */}
      <Dialog
        open={showCancelDialog}
        onOpenChange={(open) => {
          setShowCancelDialog(open);
          if (!open) {
            setCancellationReason('');
          }
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Cancelar Senha</DialogTitle>
            <DialogDescription>
              Informe o motivo do cancelamento da senha{' '}
              <strong>{currentTicket?.display_number}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='cancellationReason'>
                Motivo do Cancelamento <span className='text-red-500'>*</span>
              </Label>
              <textarea
                id='cancellationReason'
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                maxLength={200}
                placeholder='Informe o motivo do cancelamento...'
                className='w-full min-h-[100px] px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              />
              <p className='text-xs text-muted-foreground text-right'>
                {cancellationReason.length}/200 caracteres
              </p>
            </div>
          </div>

          <DialogFooter className='gap-2'>
            <Button
              variant='outline'
              onClick={() => {
                setShowCancelDialog(false);
                setCancellationReason('');
              }}
            >
              Voltar
            </Button>
            <Button
              variant='destructive'
              onClick={cancelTicket}
              disabled={!cancellationReason.trim()}
            >
              <XCircle className='mr-2 h-4 w-4' />
              Confirmar Cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Operator;
