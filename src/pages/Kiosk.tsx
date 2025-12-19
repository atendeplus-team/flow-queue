import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, ArrowLeft, LogOut } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import type { User } from '@supabase/supabase-js';

// Modelo de fila exibida no totem para emissão de senhas
interface Queue {
  id: string;
  name: string;
  code: string;
  description: string;
  preferential: string;
}

// Configurações de branding (logo/nome) usadas no kiosk
interface CompanySettings {
  logo_url: string | null;
  company_name: string;
}

const Kiosk = () => {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [companySettings, setCompanySettings] =
    useState<CompanySettings | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin, isSuperAdmin } = useUserRole(currentUser);

  const enterFullscreen = () => {
    try {
      const el: any = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (el.msRequestFullscreen) el.msRequestFullscreen();
    } catch {}
  };

  // Inicializa: verifica sessão, carrega filas ativas e branding
  useEffect(() => {
    checkAuth();
    loadQueues();
    loadCompanySettings();
  }, []);

  // Armazena usuário atual e, se autenticado, tenta fullscreen para melhor UX
  const checkAuth = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setCurrentUser(session?.user ?? null);
    if (session) {
      enterFullscreen();
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  // Busca filas ativas para emissão; RLS permite SELECT público apenas para is_active=true
  const loadQueues = async () => {
    try {
      const { data, error } = await supabase
        .from('queues')
        .select('id, name, code, description, is_active, preferential')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      
      const mappedQueues = (data || []).map((q: any) => ({
        id: q.id,
        name: q.name,
        code: q.code,
        description: q.description,
        preferential:
          q.preferential === '1' ||
          q.preferential === "B'1'" ||
          q.preferential === 1 ||
          q.preferential === true ||
          q.preferential === '\\x01'
            ? '1'
            : '0',
      }));

      // Ordena: primeiro o primeiro normal, depois o primeiro preferencial, depois o resto
      const normalQueues = mappedQueues.filter((q) => q.preferential === '0');
      const preferentialQueues = mappedQueues.filter((q) => q.preferential === '1');
      
      const orderedQueues = [];
      if (normalQueues.length > 0) orderedQueues.push(normalQueues[0]); // Primeiro normal
      if (preferentialQueues.length > 0) orderedQueues.push(preferentialQueues[0]); // Primeiro preferencial
      
      // Adiciona o resto dos normais
      for (let i = 1; i < normalQueues.length; i++) {
        orderedQueues.push(normalQueues[i]);
      }
      
      // Adiciona o resto dos preferenciais
      for (let i = 1; i < preferentialQueues.length; i++) {
        orderedQueues.push(preferentialQueues[i]);
      }
      
      setQueues(orderedQueues);
    } catch (error) {
      toast({
        title: 'Erro ao carregar filas',
        description: 'Não foi possível carregar as filas disponíveis.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Carrega logo e nome da empresa para exibição
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

  // Heurística para identificar fila preferencial em diferentes representações do boolean
  const isPreferentialQueue = (q: any) =>
    q.preferential === '1' ||
    q.preferential === "B'1'" ||
    q.preferential === 1 ||
    q.preferential === true ||
    q.preferential === '\\x01';

  // Verifica se uma data é do dia atual
  const isToday = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  // Gera a senha para a fila selecionada pelo ID
  const generateTicket = async (queueId: string) => {
    if (queues.length === 0) return;

    const queue = queues.find((q) => q.id === queueId);
    if (!queue) return;

    setGenerating(true);
    try {
      // Busca a última senha gerada para esta fila
      const { data: lastTicket } = await supabase
        .from('tickets')
        .select('ticket_number, created_at')
        .eq('queue_id', queue.id)
        .order('created_at', { ascending: false })
        .limit(1);

      let nextNumber = 1;

      // Se existe uma senha anterior e ela foi gerada hoje, continua a sequência
      // Caso contrário, reseta para 1
      if (lastTicket && lastTicket.length > 0) {
        const lastTicketDate = lastTicket[0].created_at;

        if (isToday(lastTicketDate)) {
          // Última senha é de hoje, continua a sequência
          nextNumber = lastTicket[0].ticket_number + 1;
        } else {
          // Última senha não é de hoje, reseta para 1
          nextNumber = 1;
        }
      }

      const displayNumber = `${queue.code}-${String(nextNumber).padStart(
        3,
        '0'
      )}`;

      const { data, error } = await supabase
        .from('tickets')
        .insert({
          queue_id: queue.id,
          ticket_number: nextNumber,
          prefix: queue.code,
          display_number: displayNumber,
          priority: queue.preferential === '1' ? 'priority' : 'normal',
          status: 'waiting',
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Senha gerada com sucesso!',
        description: `Sua senha é: ${displayNumber}`,
      });

      // Navigate to ticket success page for printing
      navigate(`/ticket/${data.id}`);
    } catch (error) {
      toast({
        title: 'Erro ao gerar senha',
        description: 'Não foi possível gerar sua senha. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted'>
        <Loader2 className='h-12 w-12 animate-spin text-primary' />
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-gradient-to-br from-background to-muted p-4 md:p-8'>
      <div className='mx-auto max-w-4xl'>
        <div className='mb-6 flex items-center justify-between'>
          {isAdmin && (
            <Button variant='ghost' onClick={() => navigate('/dashboard')}>
              <ArrowLeft className='mr-2 h-4 w-4' />
              Voltar ao Menu
            </Button>
          )}

          {(isAdmin || isSuperAdmin) && (
            <Button
              variant='ghost'
              onClick={handleLogout}
              className={!isAdmin ? 'ml-auto' : ''}
            >
              <LogOut className='mr-2 h-4 w-4' />
              Sair
            </Button>
          )}
        </div>

        {/* Logo da Empresa */}
        {companySettings?.logo_url && (
          <div className='mb-8 flex items-center justify-center'>
            <img
              src={companySettings.logo_url}
              alt={companySettings.company_name}
              className='max-h-32 object-contain'
            />
          </div>
        )}

        <div className='mb-6 text-center'>
          <h1 className='mb-2 text-3xl font-bold text-foreground md:text-4xl'>
            Retirar Senha
          </h1>
          <p className='text-base text-muted-foreground'>
            Selecione o tipo de atendimento
          </p>
        </div>

        {queues.length === 0 ? (
          <Card className='p-12 text-center shadow-medium'>
            <p className='text-muted-foreground'>
              Nenhum serviço disponível no momento.
            </p>
          </Card>
        ) : (
          <div className='grid gap-6 md:grid-cols-2'>
            {queues.map((queue, index) => (
              <Card
                key={queue.id}
                className={`group relative overflow-hidden p-6 shadow-medium transition-all hover:shadow-large ${
                  queues.length % 2 !== 0 && index === queues.length - 1
                    ? 'md:col-span-2 md:mx-auto md:w-1/2'
                    : ''
                }`}
              >
                <div
                  className={`absolute inset-0 ${
                    queue.preferential === '1'
                      ? 'bg-secondary'
                      : 'bg-gradient-primary'
                  } opacity-0 transition-opacity group-hover:opacity-5`}
                />

                <div className='relative'>
                  <h2 className='mb-4 text-center text-2xl font-bold text-foreground'>
                    {queue.name}
                  </h2>
                  <Button
                    size='lg'
                    onClick={() => generateTicket(queue.id)}
                    disabled={generating}
                    variant={
                      queue.preferential === '1' ? 'secondary' : 'default'
                    }
                    className={`w-full h-24 text-xl font-semibold ${
                      queue.preferential !== '1' ? 'bg-gradient-primary' : ''
                    }`}
                  >
                    {generating ? (
                      <Loader2 className='h-8 w-8 animate-spin' />
                    ) : (
                      `Retirar Senha ${queue.code}`
                    )}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Kiosk;
