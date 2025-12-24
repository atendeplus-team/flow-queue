// c:\Users\Pericles\code\flow-queue-master-main\src\pages\DoctorOperator.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import {
  ArrowLeft,
  Phone,
  CheckCircle,
  Repeat,
  LogOut,
  Loader2,
  Home,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import type { User } from '@supabase/supabase-js';

// Modelo da senha utilizada no fluxo do médico
interface DocTicket {
  id: string;
  ticket_id: string;
  display_number: string;
  patient_name?: string | null;
  priority: string;
  status: string;
  created_at: string;
  urgent?: number;
  urgent_date?: string | null;
  counter?: string | null;
  doctor_name?: string | null;
  doctor_tickets?: string | null;
}

const DoctorOperator = () => {
  // Estado principal: fila de espera, senha atual, paginação e dados do médico
  const [tickets, setTickets] = useState<DocTicket[]>([]);
  const [currentTicket, setCurrentTicket] = useState<DocTicket | null>(null);
  const [waitPage, setWaitPage] = useState(0);
  const PAGE_SIZE = 12;
  const [doctorName, setDoctorName] = useState('');
  const [consultorio, setConsultorio] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [callCount, setCallCount] = useState(0);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [restoringCurrent, setRestoringCurrent] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    isDoctor,
    isAdmin,
    isSuperAdmin,
    loading: roleLoading,
  } = useUserRole(currentUser);
  const [doctorId, setDoctorId] = useState<string>('');
  const [passwordSetting, setPasswordSetting] = useState<number>(1);

  // Verifica sessão e redireciona para a tela de login unificada
  useEffect(() => {
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
    checkAuth();
  }, [navigate]);

  // Carrega dados de perfil (nome do médico e consultório) e estado inicial
  useEffect(() => {
    const loadProfile = async () => {
      if (!currentUser || roleLoading) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, company')
        .eq('id', currentUser.id)
        .single();
      setDoctorName(profile?.full_name || '');
      setConsultorio(profile?.company || '');
      setDoctorId(currentUser.id);
      const savedCallCount = localStorage.getItem('doctorCallCount');
      setCallCount(savedCallCount ? parseInt(savedCallCount) : 0);
      setIsConfigured(true);
      loadWaitingTickets();
    };
    loadProfile();
  }, [currentUser, isDoctor, isAdmin, roleLoading]);

  // Restaura a última senha chamada e inicia atualização periódica da fila
  useEffect(() => {
    const restoreCurrentTicket = async () => {
      if (!doctorName) return; // Aguarda carregar o nome do médico

      setRestoringCurrent(true);

      // Buscar qualquer ticket para este médico que ainda não foi finalizado
      // Pode estar com status "Aguardando" (chamado, aguardando chegada) ou "in_service" (em atendimento)
      const { data, error } = await (supabase as any)
        .from('doctor_tickets')
        .select(
          'id, ticket_id, display_number, patient_name, priority, status, created_at, counter, doctor_name, in_service, finished_at, called_at'
        )
        .eq('doctor_id', doctorId)
        .is('finished_at', null)
        .not('called_at', 'is', null)
        .maybeSingle();

      if (data) {
        setCurrentTicket(data as DocTicket);
        localStorage.setItem('currentDoctorTicketId', data.id);
      } else {
        setCurrentTicket(null);
        localStorage.removeItem('currentDoctorTicketId');
      }
      setRestoringCurrent(false);
    };
    if (isConfigured) {
      restoreCurrentTicket();
      loadWaitingTickets();

      // Listener em tempo real para mudanças na tabela doctor_tickets
      const subscription = supabase
        .channel('doctor_tickets_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'doctor_tickets',
          },
          () => {
            loadWaitingTickets();
          }
        )
        .subscribe();

      // Poll a cada 5s como fallback
      const interval = setInterval(loadWaitingTickets, 5000);

      return () => {
        clearInterval(interval);
        supabase.removeChannel(subscription);
      };
    }
  }, [isConfigured, doctorName]);

  // Carrega a fila de senhas aguardando para o médico usando edge function
  const loadWaitingTickets = async () => {
    if (!doctorId) return; // Aguarda carregar id do médico

    // Adiciona timeout de 10s para evitar travamento
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      // Busca configuração de chamadas para exibir modo (2 para 1 / Ordem de Chegada)
      let ps = 1;
      try {
        const { data: settings } = await supabase
          .from('company_settings')
          .select('password_setting')
          .limit(1)
          .single();
        ps = settings?.password_setting || 1;
        setPasswordSetting(ps);
      } catch (e) {
        ps = 1;
        setPasswordSetting(1);
      }

      // Se modo Ordem de Chegada, buscar doctor_tickets por created_at (ordem de chegada)
      if (Number(ps) === 2) {
        try {
          const { data: rows, error: rowsError } = await (supabase as any)
            .from('doctor_tickets')
            .select('id, ticket_id, display_number, patient_name, priority, status, created_at, counter, doctor_name, in_service, urgent, urgent_date')
            .eq('doctor_id', doctorId)
            .is('finished_at', null)
            .limit(500);

          if (rowsError) throw rowsError;

          const items = (rows || []) as any[];
          const mapped = items.map((d) => ({
            id: d.id,
            ticket_id: d.ticket_id,
            display_number: d.display_number,
            patient_name: d.patient_name || null,
            priority: d.priority,
            status: d.status,
            created_at: d.created_at,
            counter: d.counter || null,
            doctor_name: d.doctor_name || null,
            urgent: d.urgent || 0,
            urgent_date: d.urgent_date || null,
          }));

          // Ordena: urgentes primeiro (por urgent_date asc), depois por created_at asc
          mapped.sort((a: any, b: any) => {
            if ((a.urgent || 0) !== (b.urgent || 0)) return (b.urgent || 0) - (a.urgent || 0);
            if (a.urgent && b.urgent) {
              return new Date(a.urgent_date || 0).getTime() - new Date(b.urgent_date || 0).getTime();
            }
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          });

          setTickets(mapped as DocTicket[]);
          setWaitPage(0);
          return;
        } catch (e: any) {
          console.error('Erro ao carregar senhas (ordem de chegada):', e);
          toast({
            title: 'Erro ao carregar senhas',
            description: e.message || String(e),
            variant: 'destructive',
          });
          return;
        }
      }

      // Padrão: usar edge function (mantém lógica N,N,P)
      const { data, error } = await supabase.functions.invoke(
        'doctor-queue-preview',
        {
          body: { doctor_id: doctorId, doctor_name: doctorName },
          signal: controller.signal,
        }
      );

      if (error) {
        console.error('doctor-queue-preview error:', error);
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

        // Buscar flags de urgente e prioridade na tabela doctor_tickets para garantir informação
        let urgentInfo: Array<{ id: string; urgent: number; urgent_date: string | null; priority?: string }> = [];
        try {
          // @ts-ignore
          const { data: ui } = await (supabase as any)
            .from('doctor_tickets')
            .select('id, urgent, urgent_date, priority')
            .in('id', ids || []);
          urgentInfo = ui || [];
        } catch (e) {
          urgentInfo = [];
        }
        const urgentMap: Record<string, any> = {};
        urgentInfo.forEach((u: any) => (urgentMap[u.id] = u));

        const originalIndexMap: Record<string, number> = {};
        items.forEach((it: any, idx: number) => { if (it && it.id) originalIndexMap[it.id] = idx; });

        const mapped = items.map((d: any, idx: number) => {
          const existing = prev.find((p) => p.id === d.id) as any | undefined;
          const fromDb = urgentMap[d.id];
          return {
            id: d.id,
            ticket_id: d.ticket_id,
            display_number: d.display_number,
            patient_name: d.patient_name || null,
            // Use priority from DB if available, else from preview or existing
            priority: fromDb?.priority ?? d.priority ?? existing?.priority ?? 'normal',
            status: d.status,
            created_at: d.created_at,
            counter: d.counter || null,
            doctor_name: d.doctor_name || null,
            urgent: typeof d.urgent !== 'undefined' ? d.urgent : (fromDb?.urgent ?? existing?.urgent ?? 0),
            urgent_date: typeof d.urgent_date !== 'undefined' ? d.urgent_date : (fromDb?.urgent_date ?? existing?.urgent_date ?? null),
            __original_index: idx,
          } as any;
        });

        // Separar urgentes e não-urgentes
        const urgentList = mapped.filter((m: any) => m.urgent).sort((a: any, b: any) => new Date(a.urgent_date || 0).getTime() - new Date(b.urgent_date || 0).getTime());
        let nonUrgentList = mapped.filter((m: any) => !m.urgent);

        // Se o modo atual é Ordem de Chegada (ps === 2), ordenar não-urgentes por created_at
        if (Number(ps) === 2) {
          nonUrgentList = nonUrgentList.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        } else {
          // Modo 2-para-1: reordenar não-urgentes promovendo preferenciais próximas (janela de promoção)
          const remaining = [...nonUrgentList];
          const reordered: any[] = [];
          let normalCount = 0;
          const windowSize = 2; // lookahead para promover preferenciais próximas (ajustado de 3 -> 2)

          while (remaining.length > 0) {
            // Respeitar a ordem do preview: pegar o próximo item em vez de buscar por normais
            const next = remaining.shift();
            if (!next) break;
            reordered.push(next);

            if ((next.priority || 'normal') === 'normal') {
              normalCount += 1;
              const lookRange = remaining.slice(0, windowSize);
              const prefInWindowIndex = lookRange.findIndex((r: any) => (r.priority || 'normal') !== 'normal');
              // Promove somente se a preferencial estiver imediatamente após (index 0) na janela
              if (prefInWindowIndex === 0) {
                const [promoted] = remaining.splice(prefInWindowIndex, 1);
                reordered.push(promoted);
                normalCount = 0;
              } else if (normalCount >= 2) {
                // se já passaram 2 normais sem promoção, pegar qualquer preferencial remanescente
                const prefIndex = remaining.findIndex((r: any) => (r.priority || 'normal') !== 'normal');
                if (prefIndex !== -1) {
                  const [pref] = remaining.splice(prefIndex, 1);
                  reordered.push(pref);
                  normalCount = 0;
                }
              }
            } else {
              // foi uma preferencial
              normalCount = 0;
            }
          }

          nonUrgentList = reordered;
        }

        const finalList = [...urgentList, ...nonUrgentList];
        // Debug: inspeciona dados recebidos e merge realizado
        // eslint-disable-next-line no-console
        console.log('doctor-queue-preview items:', items);
        // eslint-disable-next-line no-console
        console.log('doctor_tickets urgentMap:', urgentMap);
        // eslint-disable-next-line no-console
        console.log('doctor finalList after merge:', finalList);
        setTickets(finalList as DocTicket[]);
        setWaitPage((prev) => {
          const maxPage = Math.max(
            0,
            Math.floor(Math.max(0, (items.length - 1) / PAGE_SIZE))
          );
          return Math.min(prev, maxPage);
        });
      } else {
        setTickets([]);
      }
    } finally {
      clearTimeout(timeout);
    }
  };

  // Chama próxima senha usando edge function com lógica N,N,P
  const callNextTicket = async () => {
    // Adiciona timeout de 10s para evitar travamento
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      // PRIORIDADE GLOBAL: se existir alguma senha urgente aguardando para este médico, chamar ela primeiro
      try {
        // @ts-ignore
        const { data: urgentRows, error: urgentError } = await (supabase as any)
          .from('doctor_tickets')
          .select('id, ticket_id, display_number, patient_name, priority, created_at, urgent, urgent_date')
          .eq('doctor_id', doctorId)
          .eq('status', 'waiting')
          .is('in_service', false)
          .eq('urgent', 1)
          .order('urgent_date', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1);

        if (!urgentError && urgentRows && urgentRows.length > 0) {
          const urgentTicket = urgentRows[0] as any;
          const nowUrg = new Date().toISOString();
          // @ts-ignore
          const { data: calledData, error: callError } = await (supabase as any)
            .from('doctor_tickets')
            // marcar como chamada (Aguardando) — só confirmar em atendimento quando o médico clicar em Confirmar
            .update({ called_at: nowUrg, status: 'called' })
            .eq('id', urgentTicket.id)
            .select('*')
            .single();

          if (!callError && calledData) {
            const newCallCount = callCount + 1;
            setCallCount(newCallCount);
            localStorage.setItem('doctorCallCount', newCallCount.toString());
            setCurrentTicket(calledData as DocTicket);
            localStorage.setItem('currentDoctorTicketId', calledData.id);
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
        console.warn('Erro ao priorizar urgentes (doctor):', e);
      }
      // Se modo Ordem de Chegada (2), buscar e chamar localmente o ticket mais antigo
      if (Number(passwordSetting) === 2) {
        try {
          // 1) Verificar se há alguma senha urgente para este médico
          const { data: urgentRows, error: urgentError } = await (supabase as any)
            .from('doctor_tickets')
            .select('id, ticket_id, display_number, patient_name, priority, created_at, urgent, urgent_date')
            .eq('doctor_id', doctorId)
            .eq('status', 'waiting')
            .is('in_service', false)
            .eq('urgent', 1)
            .order('urgent_date', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(1);

          if (urgentError) throw urgentError;

          const urgentTicket = (urgentRows && urgentRows[0]) as any | undefined;

          if (urgentTicket && urgentTicket.id) {
            const now = new Date().toISOString();
            const { data: calledData, error: callError } = await (supabase as any)
              .from('doctor_tickets')
              .update({ called_at: now, status: 'called' })
              .eq('id', urgentTicket.id)
              .select('*')
              .single();
            // Não marcamos como in_service aqui — aguardamos confirmação do médico (confirmArrival) para setar 'in_service'.

            if (callError) throw callError;

            const newCallCount = callCount + 1;
            setCallCount(newCallCount);
            localStorage.setItem('doctorCallCount', newCallCount.toString());

            setCurrentTicket(calledData as DocTicket);
            localStorage.setItem('currentDoctorTicketId', calledData.id);

            toast({
              title: 'Senha urgente chamada',
              description: `Senha ${calledData.display_number} (urgente) chamada!`,
            });
            loadWaitingTickets();
            return;
          }

// 2) Caso não haja urgente, selecionar pela Ordem de Chegada NUMÉRICA (modo 2)
            // Regra: usar ticket_number quando disponível -> tentar exact next (last+1),
            // depois menor ticket_number > last, senão fallback por created_at.
            try {
              // Busca candidatos (limit maior, pois aplicaremos lógica local)
              const { data: rows, error: rowsError } = await (supabase as any)
                .from('doctor_tickets')
                .select('id, ticket_id, display_number, patient_name, priority, created_at, ticket_number, urgent, urgent_date')
                .eq('doctor_id', doctorId)
                .eq('status', 'waiting')
                .is('in_service', false)
                .limit(500);

              if (rowsError) throw rowsError;

              const items = (rows || []) as any[];
              console.log('[doctor-ui] mode2 candidates count:', items.length, 'doctorId:', doctorId);
              console.log('[doctor-ui] mode2 candidates sample:', items.slice(0,10));

              // 1) Obter último NORMAL chamado/finalizado hoje para este médico
              const startOfDay = new Date();
              const sod = new Date(Date.UTC(startOfDay.getUTCFullYear(), startOfDay.getUTCMonth(), startOfDay.getUTCDate(), 0, 0, 0)).toISOString();

              const [{ data: lastByCalled }, { data: lastByFinished }] = await Promise.all([
                (supabase as any)
                  .from('doctor_tickets')
                  .select('display_number, ticket_number, called_at')
                  .not('called_at', 'is', null)
                  .eq('priority', 'normal')
                  .eq('urgent', 0)
                  .eq('doctor_id', doctorId)
                  .gte('called_at', sod)
                  .order('called_at', { ascending: false })
                  .limit(1),
                (supabase as any)
                  .from('doctor_tickets')
                  .select('display_number, ticket_number, finished_at')
                  .not('finished_at', 'is', null)
                  .eq('priority', 'normal')
                  .eq('urgent', 0)
                  .eq('doctor_id', doctorId)
                  .gte('finished_at', sod)
                  .order('finished_at', { ascending: false })
                  .limit(1),
              ]);

              console.log('[doctor-ui] lastByCalled:', lastByCalled, 'lastByFinished:', lastByFinished);
              const parseNum = (s: string | undefined) => {
                if (!s) return null;
                const m = s.match(/(\d+)/);
                return m ? parseInt(m[1], 10) : null;
              };

              const calledRow = (lastByCalled && (lastByCalled as any)[0]) || null;
              const finishedRow = (lastByFinished && (lastByFinished as any)[0]) || null;

              let lastNormalNum = 0;
              if (calledRow || finishedRow) {
                const calledAt = calledRow ? new Date(calledRow.called_at).getTime() : 0;
                const finishedAt = finishedRow ? new Date(finishedRow.finished_at).getTime() : 0;
                const recent = calledAt >= finishedAt ? calledRow : finishedRow;
                lastNormalNum = (recent && (recent.ticket_number || parseNum(recent.display_number))) || 0;
              }

              // 2) Seleção: exact next, else smallest > lastNormalNum, else earliest created_at
              const waiting = items;
              const mapped = waiting.map((t) => ({ ...t, __num: (t.ticket_number || parseNum(t.display_number)) || 0 }));

              let toCall = null as any;
              const nextNum = lastNormalNum + 1;

              console.log('[doctor-ui] lastNormalNum, nextNum:', lastNormalNum, nextNum);

              if (nextNum && nextNum > 0) {
                const exact = mapped.find((m) => m.__num === nextNum);
                console.log('[doctor-ui] exact candidate for nextNum:', exact);
                if (exact) toCall = exact;
              }

              if (!toCall && lastNormalNum && lastNormalNum > 0) {
                const greater = mapped.filter((m) => m.__num > lastNormalNum).sort((a, b) => a.__num - b.__num || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                console.log('[doctor-ui] greater candidates:', greater.slice(0,5));
                if (greater && greater.length) toCall = greater[0];
              }

              if (!toCall) {
                const earliest = mapped.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
                console.log('[doctor-ui] fallback earliest:', earliest);
                toCall = earliest || null;
              }

              console.log('[doctor-ui] selected toCall:', toCall && { id: toCall.id, display_number: toCall.display_number, __num: toCall.__num });
              if (!toCall || !toCall.id) {
                toast({
                  title: 'Nenhuma senha disponível',
                  description: 'Não há senhas aguardando no momento.',
                });
                return;
            }

            if (!toCall || !toCall.id) {
              toast({
                title: 'Nenhuma senha disponível',
                description: 'Não há senhas aguardando no momento.',
              });
              return;
            }

            const now2 = new Date().toISOString();
            const { data: calledData2, error: callError2 } = await (supabase as any)
              .from('doctor_tickets')
              // marcar como chamada (Aguardando) — confirmação do médico converte para in_service
              .update({ called_at: now2, status: 'called' })
              .eq('id', toCall.id)
              .select('*')
              .single();

            if (callError2) throw callError2;

            const newCallCount2 = callCount + 1;
            setCallCount(newCallCount2);
            localStorage.setItem('doctorCallCount', newCallCount2.toString());

            setCurrentTicket(calledData2 as DocTicket);
            localStorage.setItem('currentDoctorTicketId', calledData2.id);

            toast({
              title: 'Senha chamada',
              description: `Senha ${calledData2.display_number} foi chamada pelo médico!`,
            });
            loadWaitingTickets();
            return;
          } catch (e: any) {
            console.error('Erro ao chamar por Ordem de Chegada:', e);
            toast({
              title: 'Erro ao chamar senha',
              description: e?.message || String(e),
              variant: 'destructive',
            });
            return;
          }
        } catch (e: any) {
          console.error('Erro ao chamar por Ordem de Chegada:', e);
          toast({
            title: 'Erro ao chamar senha',
            description: e?.message || String(e),
            variant: 'destructive',
          });
          return;
        }
      }

      // Padrão: usar edge function existente (mantém comportamento atual)
      const { data, error } = await supabase.functions.invoke(
        'doctor-call-next',
        {
          body: {
            doctor_id: doctorId,
            doctor_name: doctorName,
            counter: consultorio,
          },
          signal: controller.signal,
        }
      );

      if (error) {
        toast({
          title: 'Erro ao chamar senha',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }

      const nextTicket = (data as any)?.next as DocTicket | null;
      if (!nextTicket) {
        toast({
          title: 'Nenhuma senha disponível',
          description: 'Não há senhas aguardando no momento.',
        });
        return;
      }

      const newCallCount = callCount + 1;
      setCallCount(newCallCount);
      localStorage.setItem('doctorCallCount', newCallCount.toString());

      setCurrentTicket(nextTicket);
      localStorage.setItem('currentDoctorTicketId', nextTicket.id);

      // Se a edge function retornou um ticket já marcado como in_service, reverter para 'called'
      try {
        if (nextTicket?.status === 'in_service') {
          await (supabase as any)
            .from('doctor_tickets')
            .update({ status: 'called', in_service: false })
            .eq('id', nextTicket.id);
          // Atualiza estado local
          setCurrentTicket({ ...nextTicket, status: 'called' } as DocTicket);
        }
      } catch (e) {
        console.warn('Falha ao ajustar status retornado pelo edge function:', e);
      }

      toast({
        title: 'Senha chamada',
        description: `Senha ${nextTicket.display_number} foi chamada pelo médico!`,
      });
      loadWaitingTickets();
    } finally {
      clearTimeout(timeout);
    }
  };

  const repeatCall = async () => {
    if (!currentTicket) return;

    // Atualizar o called_at para disparar o realtime no Display
    const { error } = await supabase
      .from('doctor_tickets')
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

  // Confirma a chegada do paciente e muda status para "Em atendimento"
  const confirmArrival = async () => {
    if (!currentTicket) return;

    const { error } = await supabase
      .from('doctor_tickets')
      .update({
        status: 'in_service',
        in_service: true,
      })
      .eq('id', currentTicket.id);

    if (error) {
      toast({
        title: 'Erro ao confirmar chegada',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    // Atualiza o ticket local
    setCurrentTicket({
      ...currentTicket,
      status: 'in_service',
    });

    toast({
      title: 'Chegada confirmada',
      description: `Paciente ${
        currentTicket.patient_name || currentTicket.display_number
      } em atendimento!`,
    });
  };

  // Abre o modal de cancelamento
  const openCancelModal = () => {
    if (!currentTicket) return;
    setShowCancelModal(true);
  };

  // Finaliza atendimento da senha atual e limpa estado/localStorage
  const finishService = async () => {
    if (!currentTicket) return;
    await confirmFinishService();
  };

  // Confirma o cancelamento com motivo obrigatório
  const handleCancellation = async () => {
    if (!currentTicket) return;

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

    // Usa edge function para bypassar RLS
    const { data, error } = await supabase.functions.invoke(
      'doctor-cancel-ticket',
      {
        body: {
          doctor_ticket_id: currentTicket.id,
          cancellation_reason: cancellationReason.trim(),
        },
      }
    );

    if (error) {
      console.error('Erro ao cancelar:', error);
      toast({
        title: 'Erro ao cancelar',
        description: error.message || 'Não foi possível cancelar a senha.',
        variant: 'destructive',
      });
      return;
    }

    if (data && !data.success) {
      toast({
        title: 'Erro ao cancelar',
        description: data.error || 'Não foi possível cancelar a senha.',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Senha cancelada',
      description: `Senha ${currentTicket.display_number} foi cancelada.`,
      variant: 'destructive',
    });

    setShowCancelModal(false);
    setCancellationReason('');
    setCurrentTicket(null);
    localStorage.removeItem('currentDoctorTicketId');
    loadWaitingTickets();
  };

  // Finaliza atendimento normalmente (quando já está em atendimento)
  const confirmFinishService = async () => {
    if (!currentTicket) return;

    const now = new Date().toISOString();

    const { error } = await supabase
      .from('doctor_tickets')
      .update({
        status: 'served',
        served_at: now,
        finished_at: now,
        in_service: false,
      })
      .eq('id', currentTicket.id);

    if (error) {
      toast({
        title: 'Erro ao finalizar',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Consulta finalizada',
      description: `Senha ${currentTicket.display_number} foi atendida.`,
    });
    setCurrentTicket(null);
    localStorage.removeItem('currentDoctorTicketId');
    loadWaitingTickets();
  };

  // Faz logout e retorna para a tela de autenticação unificada
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <div className='h-screen overflow-hidden bg-gradient-to-br from-background to-muted p-4'>
      <div className='mx-auto max-w-7xl h-full flex flex-col'>
        <div className='mb-3 flex items-center justify-between flex-shrink-0'>
          {(isAdmin || isSuperAdmin) && (
            <Button
              variant='outline'
              size='sm'
              onClick={() => navigate('/dashboard')}
            >
              <Home className='mr-2 h-4 w-4' />
              Dashboard
            </Button>
          )}
          <div
            className={`flex items-center gap-3 ${
              !isAdmin && !isSuperAdmin ? 'ml-auto' : ''
            }`}
          >
            <button
              onClick={handleLogout}
              className='flex items-center gap-2 px-3 py-1.5 rounded-full border-2 border-blue-400 bg-blue-400/10 hover:bg-blue-400/20 transition-all duration-300 group'
            >
              <span className='text-xs font-medium text-foreground'>
                {doctorName}
              </span>
              <div className='w-7 h-7 rounded-full border-2 border-blue-400 flex items-center justify-center transition-all flex-shrink-0 hover:border-red-400 hover:bg-red-400/20'>
                <LogOut className='h-4 w-4 text-blue-400 hover:text-red-400' />
              </div>
            </button>
          </div>
        </div>

        <div className='grid gap-4 lg:grid-cols-4 flex-1 min-h-0'>
          {/* Bloco Senha Atual - Compacto e Estilizado */}
          <Card className='lg:col-span-1 p-4 shadow-lg border-2 flex flex-col'>
            <div className='flex items-center justify-between mb-3 flex-shrink-0'>
              <Badge
                variant='secondary'
                className='bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-4 py-2 text-base font-semibold border-0 shadow-md hover:bg-blue-100 cursor-default select-none'
              >
                Senha Atual
              </Badge>
              {currentTicket && (
                <Badge
                  variant='default'
                  className={`animate-pulse-subtle ${
                    currentTicket.status === 'in_service'
                      ? 'bg-green-500 hover:bg-green-500 cursor-default select-none'
                      : 'bg-yellow-500 hover:bg-yellow-500 cursor-default select-none font-semibold text-white'
                  }`}
                >
                  {currentTicket.status === 'in_service'
                    ? 'Em Atendimento'
                    : 'Aguardando'}
                </Badge>
              )}
            </div>
            {currentTicket ? (
              <div className='space-y-3 flex-1 flex flex-col'>
                <div className='rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 p-4 text-center text-white shadow-xl flex-shrink-0'>
                  <p className='text-xs font-medium opacity-90 mb-1'>
                    Paciente
                  </p>
                  <p className='text-2xl font-bold tracking-tight'>
                    {currentTicket.patient_name || currentTicket.display_number}
                  </p>
                  <p className='text-xs opacity-75 mt-2'>
                    Senha: {currentTicket.display_number}
                  </p>
                </div>
                <div className='space-y-2 flex-shrink-0'>
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      onClick={confirmArrival}
                      className='flex-1 bg-green-600 hover:bg-green-700 text-white text-xs'
                      disabled={currentTicket.status === 'in_service'}
                    >
                      <CheckCircle className='mr-1 h-3 w-3' /> Confirmar
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={repeatCall}
                      className='flex-1 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-950/30 dark:hover:border-blue-700 text-xs'
                    >
                      <Repeat className='mr-1 h-3 w-3' /> Repetir
                    </Button>
                  </div>
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      variant='destructive'
                      onClick={openCancelModal}
                      className='flex-1'
                      disabled={currentTicket.status === 'in_service'}
                    >
                      <XCircle className='mr-1 h-3 w-3' /> Cancelar
                    </Button>
                    <Button
                      size='sm'
                      onClick={finishService}
                      className='flex-1 bg-blue-600 hover:bg-blue-700 text-white'
                      disabled={currentTicket.status !== 'in_service'}
                    >
                      <CheckCircle className='mr-1 h-3 w-3' /> Finalizar
                    </Button>
                  </div>
                </div>
              </div>
            ) : restoringCurrent ? (
              <div className='py-6 text-center flex-1 flex flex-col items-center justify-center'>
                <Loader2 className='h-6 w-6 animate-spin mx-auto text-primary' />
                <p className='mt-3 text-sm text-muted-foreground'>
                  Carregando...
                </p>
              </div>
            ) : (
              <div className='py-6 text-center flex-1 flex flex-col items-center justify-center'>
                <p className='mb-4 text-sm text-muted-foreground'>
                  Nenhuma senha em atendimento
                </p>
                <Button
                  size='sm'
                  onClick={callNextTicket}
                  className='bg-blue-600 hover:bg-blue-700 text-white w-full'
                  disabled={tickets.length === 0}
                >
                  <Phone className='mr-2 h-4 w-4' /> Chamar Próxima
                </Button>
              </div>
            )}
          </Card>

          {/* Bloco Fila de Espera - Layout em Colunas com Nome do Paciente */}
          <Card className='lg:col-span-3 p-4 shadow-lg border-2 flex flex-col min-h-0'>
            <div className='flex items-center justify-between mb-4 flex-shrink-0'>
              <Badge
                variant='secondary'
                className='bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-4 py-2 text-base font-semibold border-0 shadow-md hover:bg-green-100 cursor-default select-none'
              >
                Fila de Espera
              </Badge>
              <div className='backdrop-blur-lg bg-white/30 dark:bg-gray-900/40 px-4 py-2 rounded-full border border-white/50 shadow-2xl '>
                <div className='flex items-center gap-2'>
                  <span className='text-lg font-bold text-blue-600 drop-shadow-lg cursor-default select-none'>
                    {tickets.length}
                  </span>
                  <div className='flex items-center gap-2'>
                    <span className='text-sm font-semibold text-blue-600 cursor-default select-none'>
                      Aguardando
                    </span>
                    <span className='text-xs text-muted-foreground ml-2 select-none'>
                      Modo: {passwordSetting === 1 ? '2 para 1' : 'Ordem de Chegada'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {tickets.length === 0 ? (
              <div className='py-12 text-center flex-1 flex items-center justify-center'>
                <p className='text-muted-foreground'>Nenhum paciente na fila</p>
              </div>
            ) : (
              <>
                {/* Cabeçalho da Tabela */}
                <div className='grid grid-cols-12 gap-2 px-3 py-2 bg-muted/50 rounded-lg mb-2 font-semibold text-xs text-muted-foreground flex-shrink-0'>
                  <div className='col-span-1'>#</div>
                  <div className='col-span-5'>Paciente</div>
                  <div className='col-span-3'>Prioridade</div>
                  <div className='col-span-3'>Horário</div>
                </div>

                {/* Linhas da Tabela - com scroll interno se necessário */}
                <div className='space-y-1.5 flex-1 overflow-y-auto min-h-0'>
                  {tickets
                    .slice(waitPage * PAGE_SIZE, (waitPage + 1) * PAGE_SIZE)
                    .map((ticket, index) => (
                      <div
                        key={ticket.id}
                        className='grid grid-cols-12 gap-2 px-3 py-2.5 bg-card hover:bg-muted/30 rounded-lg border transition-colors items-center'
                      >
                        <div className='col-span-1'>
                          <span className='flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white'>
                            {index + 1 + waitPage * PAGE_SIZE}
                          </span>
                        </div>
                        <div className='col-span-5'>
                          <p className='font-bold text-foreground text-sm'>
                            {ticket.patient_name || 'Sem nome'}
                          </p>
                        </div>
                        <div className='col-span-3'>
                          {ticket.urgent ? (
                            <Badge
                              variant='destructive'
                              className='bg-red-100 text-red-700 text-xs cursor-default select-none'
                            >
                              Urgente
                            </Badge>
                          ) : ticket.priority !== 'normal' ? (
                            <Badge
                              variant='secondary'
                              className='bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 text-xs hover:bg-orange-100 cursor-default select-none'
                            >
                              Preferencial
                            </Badge>
                          ) : (
                            <Badge variant='outline' className='text-xs'>
                              Normal
                            </Badge>
                          )}
                        </div>
                        <div className='col-span-3'>
                          <p className='text-xs text-muted-foreground'>
                            {new Date(ticket.created_at).toLocaleTimeString(
                              'pt-BR',
                              {
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>

                {/* Paginação */}
                <div className='mt-3 flex justify-between items-center flex-shrink-0'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setWaitPage((p) => Math.max(0, p - 1))}
                    disabled={waitPage === 0}
                  >
                    Anterior
                  </Button>
                  <span className='text-xs text-muted-foreground'>
                    Página {waitPage + 1} de{' '}
                    {Math.max(1, Math.ceil(tickets.length / PAGE_SIZE))}
                  </span>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() =>
                      setWaitPage((p) => {
                        const maxPage = Math.max(
                          0,
                          Math.floor(
                            Math.max(0, tickets.length - 1) / PAGE_SIZE
                          )
                        );
                        return Math.min(maxPage, p + 1);
                      })
                    }
                    disabled={(waitPage + 1) * PAGE_SIZE >= tickets.length}
                  >
                    Próximas
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* Modal de Cancelamento com Motivo Obrigatório */}
      <Dialog
        open={showCancelModal}
        onOpenChange={(open) => {
          setShowCancelModal(open);
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
                setShowCancelModal(false);
                setCancellationReason('');
              }}
            >
              Voltar
            </Button>
            <Button
              variant='destructive'
              onClick={handleCancellation}
              disabled={!cancellationReason.trim()}
            >
              <XCircle className='mr-2 h-4 w-4' />
              Confirmar Cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default DoctorOperator;
