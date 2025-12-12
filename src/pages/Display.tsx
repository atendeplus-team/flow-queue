import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Volume2 } from 'lucide-react';
import { initializeAudioContext } from '@/lib/utils';

// Modelo da última/recente senha exibida no painel
interface CurrentTicket {
  id: string;
  ticket_id?: string; // ID original da tabela tickets (usado quando é doctor_ticket)
  display_number: string;
  queue_code: string;
  counter: string;
  operator_name: string;
  // Campos para senhas encaminhadas para médico
  is_doctor_ticket?: boolean;
  patient_name?: string;
  doctor_name?: string;
  specialty?: string;
  room_number?: string;
  status?: string; // 'Aguardando' ou 'in_service'
}

// Estatísticas de fila para o cabeçalho lateral
interface WaitingStats {
  total: number;
  byQueue: Record<string, number>;
}

// Branding da empresa para exibição no painel
interface CompanySettings {
  logo_url: string | null;
  company_name: string;
}

// Slides de propaganda (imagem/vídeo) com duração e transição
interface Slide {
  id: string;
  title: string;
  image_url: string;
  duration_seconds: number;
  media_type: 'image' | 'video';
  transition_type: 'fade' | 'slide' | 'zoom' | 'none';
}

const Display = () => {
  const [currentTicket, setCurrentTicket] = useState<CurrentTicket | null>(
    null
  );
  const currentTicketRef = useRef<CurrentTicket | null>(null);

  // Manter a ref atualizada sempre que currentTicket mudar
  useEffect(() => {
    currentTicketRef.current = currentTicket;
  }, [currentTicket]);

  const [recentTickets, setRecentTickets] = useState<CurrentTicket[]>([]);
  const [waitingStats, setWaitingStats] = useState<WaitingStats>({
    total: 0,
    byQueue: {},
  });
  const [blink, setBlink] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [companySettings, setCompanySettings] =
    useState<CompanySettings | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Inicialização: carrega dados, ativa áudio, configura fullscreen e polling
  useEffect(() => {
    loadCurrentTicket();
    loadWaitingStats();
    loadCompanySettings();
    loadSlides();
    setupRealtime();

    setAudioEnabled(true);
    initializeAudioContext(); // Permite áudio automático em Fully Kiosk

    let fullscreenTimer: number | undefined;
    const autoFs =
      new URLSearchParams(window.location.search).get('fs') === '1';
    if (autoFs) {
      enterFullscreen();
      const tryFs = () => enterFullscreen();
      window.addEventListener('focus', tryFs);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') enterFullscreen();
      });
      fullscreenTimer = window.setTimeout(() => enterFullscreen(), 500);
    } else {
      fullscreenTimer = window.setTimeout(() => enterFullscreen(), 2000);
    }

    const interval = setInterval(() => {
      loadWaitingStats();
    }, 5000);

    return () => {
      clearInterval(interval);
      if (fullscreenTimer) clearTimeout(fullscreenTimer);
      window.removeEventListener('focus', () => enterFullscreen());
    };
  }, []);

  // Rotação automática de slides com transição
  // Rotação automática dos slides com transição
  useEffect(() => {
    if (slides.length === 0) return;

    const currentSlide = slides[currentSlideIndex];
    const duration = (currentSlide?.duration_seconds || 10) * 1000;

    const timer = setTimeout(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
        setIsTransitioning(false);
      }, 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [slides, currentSlideIndex]);

  // Retorna início do dia atual em formato ISO
  const getTodayStart = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.toISOString();
  };

  // Busca última senha chamada e últimas atendidas (apenas do dia de hoje)
  const loadCurrentTicket = async () => {
    const todayStart = getTodayStart();

    // Primeiro, verificar se existe um doctor_ticket sendo chamado pelo médico
    // Busca tickets com status 'Aguardando' (chamado mas não confirmado) ou in_service=true (confirmado)
    const { data: doctorTicketCalled } = await (supabase as any)
      .from('doctor_tickets')
      .select(
        `
        id,
        ticket_id,
        display_number,
        patient_name,
        doctor_id,
        doctor_name,
        counter,
        queue_code,
        operator_name,
        called_at,
        status,
        in_service
      `
      )
      .is('finished_at', null)
      .not('called_at', 'is', null)
      .gte('created_at', todayStart)
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Se existir doctor_ticket chamado pelo médico, mostrar ele
    if (doctorTicketCalled && doctorTicketCalled.patient_name) {
      let doctorName = doctorTicketCalled.doctor_name || 'Médico';
      let roomNumber = doctorTicketCalled.counter || '';
      let specialty = '';

      if (doctorTicketCalled.doctor_id) {
        const { data: doctorProfile } = await (supabase as any)
          .from('profiles')
          .select(
            `
            full_name,
            company,
            specialty_id,
            medical_specialties (name)
          `
          )
          .eq('id', doctorTicketCalled.doctor_id)
          .single();

        if (doctorProfile) {
          doctorName = doctorProfile.full_name || doctorName;
          roomNumber = doctorProfile.company || roomNumber;
          specialty = doctorProfile.medical_specialties?.name || '';
        }
      }

      console.log('🩺 Doctor ticket em atendimento:', doctorTicketCalled);

      setCurrentTicket({
        id: doctorTicketCalled.id,
        ticket_id: doctorTicketCalled.ticket_id, // ID original da senha na tabela tickets
        display_number: doctorTicketCalled.display_number,
        queue_code: doctorTicketCalled.queue_code || '',
        counter: roomNumber,
        operator_name: doctorTicketCalled.operator_name || '',
        is_doctor_ticket: true,
        patient_name: doctorTicketCalled.patient_name,
        doctor_name: doctorName,
        specialty: specialty,
        room_number: roomNumber,
        status:
          doctorTicketCalled.status ||
          (doctorTicketCalled.in_service ? 'in_service' : 'Aguardando'),
      });
    } else {
      // Buscar senha normal chamada por operador
      const { data, error } = await supabase
        .from('tickets')
        .select('id, display_number, prefix, counter, operator_name')
        .eq('status', 'called')
        .gte('created_at', todayStart)
        .order('called_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        // Senha normal chamada pelo operador
        setCurrentTicket({
          id: data.id,
          display_number: data.display_number,
          queue_code: data.prefix || '',
          counter: data.counter || 'Guichê',
          operator_name: data.operator_name || '',
        });
      } else {
        setCurrentTicket(null);
      }
    }

    // Carregar as últimas 4 senhas chamadas (apenas do dia de hoje)
    const { data: recentData } = await supabase
      .from('tickets')
      .select('id, display_number, prefix, counter, operator_name')
      .eq('status', 'served')
      .gte('created_at', todayStart)
      .not('counter', 'is', null)
      .order('served_at', { ascending: false })
      .limit(4);

    console.log('🔍 DEBUG - Senhas recentes:', recentData?.length || 0);
    if (recentData && recentData.length > 0) {
      console.log('   Primeira senha recente:', recentData[0]?.display_number);
    }

    if (recentData) {
      setRecentTickets(
        recentData.map((ticket) => ({
          id: ticket.id,
          display_number: ticket.display_number,
          queue_code: ticket.prefix || '',
          counter: ticket.counter || 'Guichê',
          operator_name: ticket.operator_name || '',
        }))
      );
    }
  };

  // Agrega quantidade de senhas aguardando por fila (apenas do dia de hoje)
  const loadWaitingStats = async () => {
    const todayStart = getTodayStart();

    const { data } = await supabase
      .from('tickets')
      .select('prefix')
      .eq('status', 'waiting')
      .gte('created_at', todayStart);

    if (data) {
      const byQueue: Record<string, number> = {};
      data.forEach((ticket) => {
        const queue = ticket.prefix || 'OUTROS';
        byQueue[queue] = (byQueue[queue] || 0) + 1;
      });

      setWaitingStats({
        total: data.length,
        byQueue,
      });
    }
  };

  const loadCompanySettings = async () => {
    const { data } = await supabase
      .from('company_settings')
      .select('*')
      .limit(1)
      .single();

    if (data) {
      setCompanySettings(data);
    }
  };

  // Carrega slides ativos ordenados
  const loadSlides = async () => {
    const { data } = await supabase
      .from('propaganda_slides')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (data && data.length > 0) {
      setSlides(data as Slide[]);
    }
  };

  // Síntese de voz para anunciar senha e guichê
  const speakTicket = (ticket: CurrentTicket) => {
    // Tentar habilitar áudio se ainda não estiver
    if (!audioEnabled) {
      setAudioEnabled(true);
    }

    // Cancelar qualquer fala anterior
    window.speechSynthesis.cancel();

    setTimeout(() => {
      let text = '';

      if (ticket.is_doctor_ticket && ticket.patient_name) {
        // Voz para senha encaminhada ao médico
        const doctorName = ticket.doctor_name || 'médico';
        const specialty = ticket.specialty ? `, ${ticket.specialty}` : '';
        const room = ticket.room_number || ticket.counter || 'consultório';
        text = `${ticket.patient_name}, dirija-se à sala ${room}, com doutor ${doctorName}${specialty}`;
      } else {
        // Voz para senha normal do operador
        const ticketNumber = ticket.display_number.replace(/^[A-Z]+-/, '');
        const prefix = ticket.display_number.split('-')[0] || '';
        const queueType = prefix.includes('PR') ? 'Preferencial' : 'Normal';
        text = `Senha ${queueType}, número ${ticketNumber}, por favor, dirija-se ao guichê ${ticket.counter}`;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 0.85;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onerror = (event) => {
        // Ignorar erro "not-allowed" silenciosamente (navegador bloqueou)
        if (event.error === 'not-allowed') {
          console.log(
            '🔇 Áudio bloqueado pelo navegador. Clique no botão "Ativar Áudio".'
          );
          setAudioEnabled(false);
        } else {
          console.error('Erro na síntese de voz:', event.error);
        }
      };

      utterance.onstart = () => {
        console.log('✅ Áudio funcionando!');
      };

      window.speechSynthesis.speak(utterance);
    }, 300);
  };

  // Inscrição em atualizações de tickets (called/served/cancelled) para atualizar painel e voz
  const setupRealtime = () => {
    const channelCalled = supabase
      .channel('tickets-display-called')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
          filter: 'status=eq.called',
        },
        (payload) => {
          const newTicket = payload.new as any;
          console.log(
            '🔴 REALTIME - Nova senha chamada:',
            newTicket.display_number
          );
          const ticket: CurrentTicket = {
            id: newTicket.id,
            display_number: newTicket.display_number,
            queue_code: newTicket.prefix || '',
            counter: newTicket.counter || 'Guichê',
            operator_name: newTicket.operator_name || '',
          };

          setCurrentTicket(ticket);
          setBlink(true);
          setTimeout(() => setBlink(false), 1000);
          speakTicket(ticket);
        }
      )
      .subscribe();

    const channelServed = supabase
      .channel('tickets-display-served')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
          filter: 'status=eq.served',
        },
        (payload) => {
          const t = payload.new as any;
          console.log(
            '✅ REALTIME - Senha marcada como served:',
            t.display_number
          );

          const servedTicket: CurrentTicket = {
            id: t.id,
            display_number: t.display_number,
            queue_code: t.prefix || '',
            counter: t.counter || 'Guichê',
            operator_name: t.operator_name || '',
          };

          // Adicionar às últimas chamadas
          setRecentTickets((prev) =>
            [
              servedTicket,
              ...prev.filter((p) => p.id !== servedTicket.id),
            ].slice(0, 4)
          );

          // Se a senha que foi marcada como served for a que está sendo exibida, limpa o display
          // Verifica tanto o ID direto quanto o ticket_id (para doctor_tickets)
          const curr = currentTicketRef.current;
          if (curr && (curr.id === t.id || curr.ticket_id === t.id)) {
            console.log(
              '🧹 Limpando display - senha foi encaminhada/finalizada'
            );
            setCurrentTicket(null);
          }
        }
      )
      .subscribe();

    // Listener para senhas canceladas - limpa o display atual
    const channelCancelled = supabase
      .channel('tickets-display-cancelled')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
          filter: 'status=eq.cancelled',
        },
        (payload) => {
          const cancelledTicket = payload.new as any;
          console.log(
            '🚫 REALTIME - Senha cancelada:',
            cancelledTicket.display_number
          );

          // Se a senha cancelada for a que está sendo exibida, limpa o display
          const curr = currentTicketRef.current;
          if (
            curr &&
            (curr.id === cancelledTicket.id ||
              curr.ticket_id === cancelledTicket.id)
          ) {
            console.log('🧹 Limpando display - senha foi cancelada');
            setCurrentTicket(null);
          }
        }
      )
      .subscribe();

    // Listener para quando um doctor_ticket é criado (senha encaminhada para médico)
    // Apenas log - a senha vai para histórico (served), não precisa atualizar o display
    const channelDoctorTicketInsert = supabase
      .channel('doctor-tickets-display-insert')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'doctor_tickets',
        },
        (payload) => {
          const doctorTicket = payload.new as any;
          console.log(
            '🩺 REALTIME - Senha encaminhada para médico (aguardando chamada):',
            doctorTicket.display_number
          );
          // Não atualiza o display aqui - a senha agora vai para o histórico
          // O display será atualizado quando o médico CHAMAR a senha (UPDATE com in_service=true)
        }
      )
      .subscribe();

    // Listener para quando o MÉDICO chama a senha (UPDATE em doctor_tickets com in_service=true)
    const channelDoctorTicketCalled = supabase
      .channel('doctor-tickets-display-called')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'doctor_tickets',
        },
        async (payload) => {
          const doctorTicket = payload.new as any;
          const oldDoctorTicket = payload.old as any;

          console.log('🔵 REALTIME - UPDATE doctor_tickets recebido:', {
            id: doctorTicket.id,
            display_number: doctorTicket.display_number,
            patient_name: doctorTicket.patient_name,
            status: doctorTicket.status,
            in_service: doctorTicket.in_service,
            finished_at: doctorTicket.finished_at,
            called_at: doctorTicket.called_at,
            old_called_at: oldDoctorTicket?.called_at,
          });

          // Se o médico finalizou o atendimento (finished_at preenchido), limpar o display
          if (doctorTicket.finished_at !== null) {
            console.log(
              '✅ REALTIME - Médico finalizou atendimento:',
              doctorTicket.display_number,
              doctorTicket.patient_name
            );

            // Se a senha finalizada for a que está sendo exibida, limpa o display
            const curr = currentTicketRef.current;
            if (
              curr &&
              (curr.id === doctorTicket.id ||
                curr.ticket_id === doctorTicket.ticket_id)
            ) {
              console.log('🧹 Limpando display - médico finalizou atendimento');
              setCurrentTicket(null);
            }
            return;
          }

          // Processa se o ticket foi chamado (tem called_at) e tem paciente
          if (doctorTicket.called_at && doctorTicket.patient_name) {
            console.log(
              '🩺 REALTIME - Ticket do médico atualizado:',
              doctorTicket.display_number,
              doctorTicket.patient_name,
              'Status:',
              doctorTicket.status
            );

            // Buscar dados do médico
            let doctorName = doctorTicket.doctor_name || 'Médico';
            let roomNumber = doctorTicket.counter || '';
            let specialty = '';

            if (doctorTicket.doctor_id) {
              const { data: doctorProfile } = await (supabase as any)
                .from('profiles')
                .select(
                  `
                  full_name,
                  company,
                  specialty_id,
                  medical_specialties (name)
                `
                )
                .eq('id', doctorTicket.doctor_id)
                .single();

              if (doctorProfile) {
                doctorName = doctorProfile.full_name || doctorName;
                roomNumber = doctorProfile.company || roomNumber;
                specialty = doctorProfile.medical_specialties?.name || '';
              }
            }

            const ticket: CurrentTicket = {
              id: doctorTicket.id,
              ticket_id: doctorTicket.ticket_id, // ID original da senha
              display_number: doctorTicket.display_number,
              queue_code: doctorTicket.queue_code || '',
              counter: roomNumber,
              operator_name: doctorTicket.operator_name || '',
              is_doctor_ticket: true,
              patient_name: doctorTicket.patient_name,
              doctor_name: doctorName,
              specialty: specialty,
              room_number: roomNumber,
              status:
                doctorTicket.status ||
                (doctorTicket.in_service ? 'in_service' : 'Aguardando'),
            };

            // Verifica se é o mesmo ticket que já está sendo exibido
            const curr = currentTicketRef.current;
            const isSameTicket =
              curr &&
              (curr.id === doctorTicket.id ||
                curr.ticket_id === doctorTicket.ticket_id);

            // Verifica se é uma rechamada (called_at foi atualizado)
            const isRepeatCall = isSameTicket && 
                                oldDoctorTicket?.called_at &&
                                doctorTicket.called_at !== oldDoctorTicket.called_at;

            console.log('🔍 Verificação de rechamada:', {
              isSameTicket,
              isRepeatCall,
              old_called_at: oldDoctorTicket?.called_at,
              new_called_at: doctorTicket.called_at,
              current_id: curr?.id,
              doctor_ticket_id: doctorTicket.id
            });

            setCurrentTicket(ticket);

            // Faz blink e fala se for nova chamada OU rechamada
            if (!isSameTicket || isRepeatCall) {
              console.log('🔊 Reproduzindo voz:', isRepeatCall ? 'RECHAMADA' : 'NOVA CHAMADA');
              setBlink(true);
              setTimeout(() => setBlink(false), 1000);
              speakTicket(ticket);
            } else {
              console.log('❌ Voz NÃO reproduzida - mesmo ticket sem alteração em called_at');
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelCalled);
      supabase.removeChannel(channelServed);
      supabase.removeChannel(channelCancelled);
      supabase.removeChannel(channelDoctorTicketInsert);
      supabase.removeChannel(channelDoctorTicketCalled);
    };
  };

  const enableAudio = () => {
    setAudioEnabled(true);

    // Inicializar AudioContext
    try {
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
    } catch (error) {
      console.log('Não foi possível inicializar AudioContext');
    }

    // Testar a síntese de voz
    const utterance = new SpeechSynthesisUtterance('Sistema de áudio ativado');
    utterance.lang = 'pt-BR';
    utterance.onerror = (event) => {
      if (event.error !== 'not-allowed') {
        console.error('Erro ao testar áudio:', event.error);
      }
    };
    window.speechSynthesis.speak(utterance);
  };

  const playNotificationSound = () => {
    if (!currentTicket) return;
    speakTicket(currentTicket);
  };

  const enterFullscreen = async () => {
    try {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch (error) {
      // Erro ao entrar em fullscreen
    }
  };

  const exitFullscreen = async () => {
    try {
      if (document.exitFullscreen && document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      // Erro ao sair do fullscreen
    }
  };

  const toggleFullscreen = () => {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  };

  const getTransitionClass = (slide: Slide) => {
    if (isTransitioning) {
      switch (slide.transition_type) {
        case 'fade':
          return 'opacity-0';
        case 'slide':
          return 'translate-x-full';
        case 'zoom':
          return 'scale-0';
        default:
          return '';
      }
    }
    return 'opacity-100 translate-x-0 scale-100';
  };

  return (
    <div className='flex h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950'>
      {/* Lado Esquerdo - Últimas Chamadas e Logo */}
      <div className='w-72 bg-gradient-to-b from-slate-900/80 to-slate-800/80 backdrop-blur-xl border-r border-slate-700/50 flex flex-col shadow-2xl overflow-y-auto'>
        {/* Últimas Chamadas */}
        <div className='flex-1 px-4 pb-4 pt-4'>
          <div className='mb-4'>
            <h2 className='text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-300'>
              Últimas Chamadas
            </h2>
            <div className='h-0.5 w-16 bg-gradient-to-r from-primary via-primary/50 to-transparent rounded-full mt-1'></div>
          </div>

          <div className='space-y-2'>
            {recentTickets.length > 0 ? (
              recentTickets.map((ticket, index) => (
                <div
                  key={ticket.id}
                  className='group relative rounded-xl bg-gradient-to-br from-slate-800/60 to-slate-900/60 p-4 border border-slate-700/40 backdrop-blur-sm shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300 animate-fade-in'
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className='absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent rounded-xl opacity-0 group-hover:opacity-100 transition-opacity'></div>
                  <div className='relative flex items-center justify-between'>
                    <div className='flex flex-col gap-0.5'>
                      <span className='text-[10px] text-slate-400 font-medium uppercase tracking-wider'>
                        Senha
                      </span>
                      <div className='text-3xl font-black text-white'>
                        {ticket.display_number}
                      </div>
                    </div>
                    <div className='flex flex-col items-end gap-0.5'>
                      <span className='text-[10px] text-slate-400 font-medium uppercase tracking-wider'>
                        Guichê
                      </span>
                      <div className='px-3 py-1 bg-gradient-to-br from-primary/30 to-primary/10 rounded-lg border border-primary/40 backdrop-blur-sm'>
                        <div className='text-xl font-black text-primary'>
                          {ticket.counter}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className='text-center text-slate-400 text-sm bg-slate-800/30 rounded-xl p-6 border border-slate-700/30 backdrop-blur-sm'>
                <div className='w-12 h-12 mx-auto mb-3 bg-slate-700/30 rounded-full flex items-center justify-center'>
                  <Volume2 className='w-6 h-6 text-slate-500' />
                </div>
                <p className='text-slate-300 font-medium text-sm'>
                  Aguardando chamadas
                </p>
                <p className='text-[10px] text-slate-500 mt-1'>
                  As senhas aparecerão aqui
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Logo da Empresa */}
        <div className='px-4 pb-4'>
          <div className='rounded-xl bg-gradient-to-br from-slate-800/60 to-slate-900/60 p-6 border border-slate-700/40 backdrop-blur-sm shadow-lg'>
            <div className='flex items-center justify-center'>
              {companySettings?.logo_url ? (
                <img
                  src={companySettings.logo_url}
                  alt={companySettings.company_name || 'Logo'}
                  className='max-h-32 max-w-full object-contain filter drop-shadow-xl'
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className='text-center text-slate-400 text-sm py-4'>
                  <p className='font-semibold'>Configure a Logo</p>
                  <p className='text-xs mt-1'>em company_settings</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Área Central - Header e Main */}
      <div className='flex-1 flex flex-col min-w-0'>
        {/* Header - Última Senha Chamada */}
        <div className='bg-gradient-to-b from-slate-900/50 to-transparent backdrop-blur-sm p-4'>
          <div
            className={`relative overflow-hidden rounded-2xl shadow-2xl transition-all duration-700 ${
              blink ? 'scale-[1.01] shadow-primary/50' : ''
            }`}
            style={{
              background:
                'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary)) 60%, hsl(var(--primary)) 100%)',
            }}
          >
            {/* Efeito de brilho animado */}
            <div className='absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse'></div>

            <div className='relative p-6'>
              {currentTicket ? (
                currentTicket.is_doctor_ticket ? (
                  // Layout para senha encaminhada ao médico (igual ao operador, com diferenças)
                  <div className='flex items-center justify-between gap-8'>
                    {/* Lado Esquerdo - Ícone e Título */}
                    <div className='flex items-center gap-4 min-w-0'>
                      <div className='flex-shrink-0 p-3 bg-white/15 rounded-2xl backdrop-blur-md border-2 border-white/20 shadow-lg'>
                        <Volume2 className='h-8 w-8 text-white animate-pulse' />
                      </div>
                      <div className='flex flex-col justify-center min-w-0'>
                        <span className='text-white/80 text-lg font-bold tracking-wide uppercase'>
                          Senha Chamada
                        </span>
                        <div className='h-0.5 w-16 bg-white/30 rounded-full mt-1'></div>
                      </div>
                    </div>

                    {/* Centro - Nome do Paciente (em vez do número da senha) */}
                    <div className='flex items-center justify-center flex-1'>
                      <div className='text-center'>
                        <p
                          className={`text-lg mb-2 font-semibold uppercase tracking-wider ${
                            currentTicket.status === 'in_service'
                              ? 'text-green-400'
                              : 'text-yellow-400'
                          }`}
                        >
                          {currentTicket.status === 'in_service'
                            ? 'Em Atendimento'
                            : 'Aguardando'}
                        </p>
                        <div className='relative'>
                          <div className='absolute inset-0 bg-white/20 blur-2xl rounded-full'></div>
                          <div className='relative text-5xl font-black text-white tracking-tight leading-none drop-shadow-2xl'>
                            {currentTicket.patient_name}
                          </div>
                        </div>
                        {/* Nome do médico abaixo do nome do paciente */}
                        <p className='text-white/80 text-xl font-semibold mt-3'>
                          <span className='font-bold text-white/60 mr-1'>
                            Médico:
                          </span>{' '}
                          {currentTicket.doctor_name}
                        </p>
                      </div>
                    </div>

                    {/* Direita - Sala (em vez de Guichê) */}
                    <div className='flex items-center'>
                      <div className='text-center bg-white/15 backdrop-blur-md rounded-2xl px-6 py-4 border-2 border-white/20 shadow-xl'>
                        <p className='text-white/80 text-sm mb-2 font-semibold uppercase tracking-wider'>
                          Sala
                        </p>
                        <p className='text-5xl font-black text-white tracking-tight'>
                          {currentTicket.room_number || currentTicket.counter}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Layout para senha normal do operador
                  <div className='flex items-center justify-between gap-8'>
                    {/* Lado Esquerdo - Ícone e Título */}
                    <div className='flex items-center gap-4 min-w-0'>
                      <div className='flex-shrink-0 p-3 bg-white/15 rounded-2xl backdrop-blur-md border-2 border-white/20 shadow-lg'>
                        <Volume2 className='h-8 w-8 text-white animate-pulse' />
                      </div>
                      <div className='flex flex-col justify-center min-w-0'>
                        <span className='text-white/80 text-lg font-bold tracking-wide uppercase'>
                          Senha Chamada
                        </span>
                        <div className='h-0.5 w-16 bg-white/30 rounded-full mt-1'></div>
                      </div>
                    </div>

                    {/* Centro - Número da Senha */}
                    <div className='flex items-center justify-center flex-1'>
                      <div className='text-center'>
                        <p className='text-white/70 text-lg mb-2 font-semibold uppercase tracking-wider'>
                          Atendimento
                        </p>
                        <div className='relative'>
                          <div className='absolute inset-0 bg-white/20 blur-2xl rounded-full'></div>
                          <div className='relative text-7xl font-black text-white tracking-tight leading-none drop-shadow-2xl'>
                            {currentTicket.display_number}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Direita - Guichê */}
                    <div className='flex items-center'>
                      <div className='text-center bg-white/15 backdrop-blur-md rounded-2xl px-6 py-4 border-2 border-white/20 shadow-xl'>
                        <p className='text-white/80 text-sm mb-2 font-semibold uppercase tracking-wider'>
                          Guichê
                        </p>
                        <p className='text-5xl font-black text-white tracking-tight'>
                          {currentTicket.counter}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className='flex items-center justify-center gap-4 py-4'>
                  <div className='p-3 bg-white/15 rounded-2xl backdrop-blur-md border-2 border-white/20'>
                    <Volume2 className='h-8 w-8 text-white/70' />
                  </div>
                  <div className='text-2xl font-bold text-white/80'>
                    Aguardando próxima chamada...
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main - Área de Propagandas */}
        <div className='flex-1 p-4 flex items-center justify-center min-h-0 relative'>
          {slides.length > 0 ? (
            <div className='w-full h-full relative rounded-3xl overflow-hidden shadow-2xl'>
              {slides[currentSlideIndex]?.media_type === 'video' ? (
                <video
                  key={slides[currentSlideIndex]?.id}
                  src={slides[currentSlideIndex]?.image_url}
                  className={`w-full h-full object-contain bg-slate-900 transition-all duration-300 ${getTransitionClass(
                    slides[currentSlideIndex]
                  )}`}
                  autoPlay
                  muted
                  loop
                  playsInline
                  onError={(e) => {
                    console.error('Erro ao carregar vídeo');
                  }}
                />
              ) : (
                <img
                  key={slides[currentSlideIndex]?.id}
                  src={slides[currentSlideIndex]?.image_url}
                  alt={slides[currentSlideIndex]?.title}
                  className={`w-full h-full object-contain bg-slate-900 transition-all duration-300 ${getTransitionClass(
                    slides[currentSlideIndex]
                  )}`}
                  onError={(e) => {
                    e.currentTarget.src =
                      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="%23333"/><text x="50%" y="50%" text-anchor="middle" fill="%23999">Erro ao carregar imagem</text></svg>';
                  }}
                />
              )}

              {/* Indicador de slides */}
              {slides.length > 1 && (
                <div className='absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-2 z-10'>
                  {slides.map((_, index) => (
                    <div
                      key={index}
                      className={`h-2 rounded-full transition-all duration-300 ${
                        index === currentSlideIndex
                          ? 'w-8 bg-primary'
                          : 'w-2 bg-white/50'
                      }`}
                    />
                  ))}
                </div>
              )}

              {/* Botão de Áudio */}
              {!audioEnabled && (
                <button
                  onClick={enableAudio}
                  className='absolute top-4 left-4 z-10 p-3 bg-red-600/90 hover:bg-red-700/90 rounded-lg border border-red-500/50 backdrop-blur-sm transition-all duration-200 hover:scale-105 flex items-center gap-2 shadow-lg'
                  title='Clique para ativar o áudio'
                >
                  <Volume2 className='w-5 h-5 text-white' />
                  <span className='text-white font-semibold text-sm'>
                    Ativar Áudio
                  </span>
                </button>
              )}

              {/* Botão Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className='absolute top-4 right-4 z-10 p-2 bg-slate-900/80 hover:bg-slate-800/80 rounded-lg border border-slate-700/50 backdrop-blur-sm transition-all duration-200 hover:scale-105'
                title={
                  isFullscreen ? 'Sair do Fullscreen' : 'Entrar em Fullscreen'
                }
              >
                <svg
                  className='w-6 h-6 text-white'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                >
                  {isFullscreen ? (
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M6 18L18 6M6 6l12 12'
                    />
                  ) : (
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4'
                    />
                  )}
                </svg>
              </button>
            </div>
          ) : (
            <div className='w-full h-full bg-gradient-to-br from-slate-800/20 to-slate-900/20 rounded-3xl border-2 border-dashed border-slate-700/30 flex items-center justify-center backdrop-blur-sm shadow-inner'>
              <div className='text-center p-12'>
                <div className='relative w-28 h-28 mx-auto mb-8'>
                  <div className='absolute inset-0 bg-primary/10 blur-xl rounded-full'></div>
                  <div className='relative w-28 h-28 bg-gradient-to-br from-slate-700/40 to-slate-800/40 rounded-3xl flex items-center justify-center border border-slate-600/30 backdrop-blur-sm'>
                    <svg
                      className='w-14 h-14 text-slate-400'
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={1.5}
                        d='M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z'
                      />
                    </svg>
                  </div>
                </div>
                <p className='text-5xl text-transparent bg-clip-text bg-gradient-to-r from-slate-300 to-slate-400 mb-4 font-black'>
                  Área de Propagandas
                </p>
                <p className='text-xl text-slate-500 max-w-md mx-auto'>
                  Adicione slides em Admin → Configurações
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Display;
