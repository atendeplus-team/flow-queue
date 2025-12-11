import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Volume2 } from 'lucide-react';
import { initializeAudioContext } from '@/lib/utils';

// Modelo da última/recente senha exibida no painel de médicos
interface CurrentDoctorTicket {
  id: string;
  display_number: string;
  patient_name: string | null;
  counter: string;
  doctor_name: string;
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

const DoctorDisplay = () => {
  const [currentTicket, setCurrentTicket] =
    useState<CurrentDoctorTicket | null>(null);
  const [recentTickets, setRecentTickets] = useState<CurrentDoctorTicket[]>([]);
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
    loadCompanySettings();
    loadSlides();
    setupRealtime();
    // Fallback: polling para garantir atualização em tempo real em ambientes sem Realtime
    const poll = setInterval(() => {
      loadCurrentTicket();
    }, 3000);

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

    return () => {
      if (fullscreenTimer) clearTimeout(fullscreenTimer);
      window.removeEventListener('focus', () => enterFullscreen());
      clearInterval(poll);
    };
  }, []);

  // Rotação automática de slides com transição
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

  // Busca última senha chamada pelos médicos e últimas atendidas (apenas do dia de hoje)
  const loadCurrentTicket = async () => {
    const todayStart = getTodayStart();

    const { data } = await supabase
      .from('doctor_tickets')
      .select('id, display_number, patient_name, counter, doctor_name')
      .eq('status', 'called')
      .gte('created_at', todayStart)
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setCurrentTicket({
        id: data.id,
        display_number: data.display_number,
        patient_name: data.patient_name,
        counter: data.counter || 'Consultório',
        doctor_name: data.doctor_name || '',
      });
    }

    // Carregar as últimas 5 senhas atendidas pelos médicos (apenas do dia de hoje)
    const { data: recentData } = await supabase
      .from('doctor_tickets')
      .select('id, display_number, patient_name, counter, doctor_name')
      .eq('status', 'served')
      .gte('created_at', todayStart)
      .not('counter', 'is', null)
      .order('served_at', { ascending: false })
      .limit(5);

    if (recentData) {
      setRecentTickets(
        recentData.map((ticket) => ({
          id: ticket.id,
          display_number: ticket.display_number,
          patient_name: ticket.patient_name,
          counter: ticket.counter || 'Consultório',
          doctor_name: ticket.doctor_name || '',
        }))
      );
    }
  };

  const loadCompanySettings = async () => {
    const { data, error } = await supabase
      .from('company_settings')
      .select('*')
      .limit(1)
      .single();

    if (error) {
      console.error('Erro ao carregar company_settings:', error);
    }

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

  // Síntese de voz para anunciar paciente e consultório
  const speakTicket = (ticket: CurrentDoctorTicket) => {
    // Cancelar qualquer fala anterior
    window.speechSynthesis.cancel();

    setTimeout(() => {
      const patientName =
        ticket.patient_name || `Senha ${ticket.display_number}`;
      const text = `${patientName}, por favor, dirija-se ao ${ticket.counter} do Doutor ${ticket.doctor_name}`;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 0.85;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onerror = (event) => {
        console.error('Erro na síntese de voz:', event);
      };

      window.speechSynthesis.speak(utterance);
    }, 300);
  };

  // Inscrição em atualizações de doctor_tickets (called/served) para atualizar painel e voz
  const setupRealtime = () => {
    const channelCalled = supabase
      .channel('doctor-tickets-display-called')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'doctor_tickets',
        },
        (payload) => {
          const newTicket = payload.new as any;
          if (!newTicket) return;
          if (newTicket.status !== 'called') return;

          const ticket: CurrentDoctorTicket = {
            id: newTicket.id,
            display_number: newTicket.display_number,
            patient_name: newTicket.patient_name,
            counter: newTicket.counter || 'Consultório',
            doctor_name: newTicket.doctor_name || '',
          };

          setCurrentTicket(ticket);
          setBlink(true);
          setTimeout(() => setBlink(false), 1000);
          speakTicket(ticket);
        }
      )
      .subscribe();

    const channelServed = supabase
      .channel('doctor-tickets-display-served')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'doctor_tickets',
        },
        (payload) => {
          const t = payload.new as any;
          if (!t || t.status !== 'served') return;
          const servedTicket: CurrentDoctorTicket = {
            id: t.id,
            display_number: t.display_number,
            patient_name: t.patient_name,
            counter: t.counter || 'Consultório',
            doctor_name: t.doctor_name || '',
          };
          setRecentTickets((prev) =>
            [
              servedTicket,
              ...prev.filter((p) => p.id !== servedTicket.id),
            ].slice(0, 5)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelCalled);
      supabase.removeChannel(channelServed);
    };
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
      <div className='w-72 bg-gradient-to-b from-slate-900/80 to-slate-800/80 backdrop-blur-xl border-r border-slate-700/50 flex flex-col shadow-2xl'>
        {/* Últimas Chamadas */}
        <div className='flex-1 px-4 pb-4 pt-4'>
          <div className='mb-4'>
            <h2 className='text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-300'>
              Últimas Chamadas
            </h2>
            <div className='h-0.5 w-16 bg-gradient-to-r from-primary via-primary/50 to-transparent rounded-full mt-1'></div>
          </div>
          <div className='space-y-2'>
            {Array.from({ length: 5 }).map((_, idx) => {
              const ticket = recentTickets[idx];
              return (
                <div
                  key={ticket ? ticket.id : `placeholder-${idx}`}
                  className='group relative rounded-xl bg-gradient-to-br from-slate-800/60 to-slate-900/60 p-4 border border-slate-700/40 backdrop-blur-sm shadow-lg min-h-[64px]'
                >
                  {ticket ? (
                    <div className='relative flex items-center justify-between'>
                      <div className='flex flex-col gap-0.5'>
                        <span className='text-[10px] text-slate-400 font-medium uppercase tracking-wider'>
                          Paciente
                        </span>
                        <div className='text-xl font-extrabold text-white whitespace-nowrap overflow-hidden text-ellipsis max-w-[9rem]'>
                          {ticket.patient_name || ticket.display_number}
                        </div>
                      </div>
                      <div className='flex flex-col items-end gap-0.5'>
                        <span className='text-[10px] text-slate-400 font-medium uppercase tracking-wider'>
                          Consultório
                        </span>
                        <div className='px-3 py-1 bg-gradient-to-br from-primary/30 to-primary/10 rounded-lg border border-primary/40 backdrop-blur-sm'>
                          <div className='text-sm font-black text-primary'>
                            {ticket.counter}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className='relative flex items-center justify-between opacity-40'>
                      <div className='flex flex-col gap-0.5'>
                        <span className='text-[10px] text-slate-500 font-medium uppercase tracking-wider'>
                          Paciente
                        </span>
                        <div className='h-6 w-32 bg-slate-700/40 rounded'></div>
                      </div>
                      <div className='flex flex-col items-end gap-0.5'>
                        <span className='text-[10px] text-slate-500 font-medium uppercase tracking-wider'>
                          Consultório
                        </span>
                        <div className='px-3 py-1 bg-slate-700/30 rounded-lg border border-slate-700/50 backdrop-blur-sm'>
                          <div className='h-4 w-10 bg-slate-700/50 rounded'></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
                <div className='flex items-center justify-between gap-8'>
                  {/* Lado Esquerdo - Ícone e Título */}
                  <div className='flex items-center gap-4 min-w-0'>
                    <div className='flex-shrink-0 p-3 bg-white/15 rounded-2xl backdrop-blur-md border-2 border-white/20 shadow-lg'>
                      <Volume2 className='h-8 w-8 text-white animate-pulse' />
                    </div>
                    <div className='flex flex-col justify-center min-w-0'>
                      <span className='text-white/80 text-lg font-bold tracking-wide uppercase'>
                        Paciente Chamado
                      </span>
                      <div className='h-0.5 w-16 bg-white/30 rounded-full mt-1'></div>
                    </div>
                  </div>

                  {/* Centro - Nome do Paciente */}
                  <div className='flex items-center justify-center flex-1'>
                    <div className='text-center'>
                      <p className='text-white/70 text-lg mb-2 font-semibold uppercase tracking-wider'>
                        Consulta
                      </p>
                      <div className='relative'>
                        <div className='absolute inset-0 bg-white/20 blur-2xl rounded-full'></div>
                        <div className='relative text-5xl font-black text-white tracking-tight leading-none drop-shadow-2xl'>
                          {currentTicket.patient_name ||
                            currentTicket.display_number}
                        </div>
                      </div>
                      {currentTicket.doctor_name && (
                        <p className='text-white/70 text-sm mt-2 font-medium'>
                          Dr(a). {currentTicket.doctor_name}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Direita - Consultório */}
                  <div className='flex items-center'>
                    <div className='text-center bg-white/15 backdrop-blur-md rounded-2xl px-6 py-4 border-2 border-white/20 shadow-xl'>
                      <p className='text-white/80 text-sm mb-2 font-semibold uppercase tracking-wider'>
                        Consultório
                      </p>
                      <p className='text-4xl font-black text-white tracking-tight'>
                        {currentTicket.counter}
                      </p>
                    </div>
                  </div>
                </div>
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

export default DoctorDisplay;
