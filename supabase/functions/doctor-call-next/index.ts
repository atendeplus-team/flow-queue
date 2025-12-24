// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// Cache leve para reduzir consultas repetidas em alta frequência
let countCache = { ts: 0, normalsAfterLastPref: 0 };

type DocTicket = {
  id: string;
  display_number: string;
  priority: string;
  patient_name?: string;
  created_at: string;
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  try {
    const { doctor_id, doctor_name, counter } = await req
      .json()
      .catch(() => ({}));

    if (!doctor_id && !doctor_name) {
      throw new Error('doctor_id or doctor_name is required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Início do dia atual
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

    const baseFilter = (q: any) =>
      doctor_id
        ? q.eq('doctor_id', doctor_id)
        : q.eq('doctor_name', doctor_name);

    // 1) Existe ticket em atendimento? Retorna-o sem avançar (apenas criadas hoje)
    const { data: current } = await baseFilter(
      supabase
        .from('doctor_tickets')
        .select('id, display_number, priority, patient_name, called_at, counter')
        .eq('in_service', true)
        .is('finished_at', null)
        .gte('created_at', startOfDayISO)
        .order('called_at', { ascending: false })
        .limit(1)
    ).maybeSingle();

    // Se já existe um ticket em atendimento, não avançar a fila
    if (current) {
      return new Response(
        JSON.stringify({
          success: true,
          next: current,
          message:
            'Já existe ticket em atendimento. Finalize antes de chamar o próximo.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    let next: DocTicket | undefined;

    // Ler configuração de chamada de senhas
    const { data: settings } = await supabase
      .from('company_settings')
      .select('password_setting')
      .limit(1)
      .single();

    const passwordSetting = settings?.password_setting || 1;

    // PRIORIDADE GLOBAL: se existir alguma senha urgente aguardando para este médico, chamar ela primeiro (independente do modo)
    const { data: urgentWaiting, error: urgentErr } = await baseFilter(
      supabase
        .from('doctor_tickets')
        .select('id, display_number, priority, patient_name, created_at, urgent, urgent_date')
        .is('finished_at', null)
        .eq('in_service', false)
        .eq('status', 'waiting')
        .eq('urgent', 1)
        .gte('created_at', startOfDayISO)
        .order('urgent_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
    );

    if (urgentErr) {
      console.error('[doctor-call-next] Urgent fetch error:', urgentErr);
    }

    // LOG TEMP: urgent candidates
    console.log('[doctor-call-next] urgentWaiting count:', (urgentWaiting || []).length, 'doctor:', doctor_id || doctor_name);
    console.log('[doctor-call-next] urgentWaiting rows:', urgentWaiting);

    if (urgentWaiting && urgentWaiting.length > 0) {
      const urg = urgentWaiting[0] as DocTicket & { urgent?: number; urgent_date?: string };
      // Chamar este urgente: marcar como chamado (igual ao operador)
      const now = new Date().toISOString();
      const updatePayloadUrg: Record<string, any> = {
        status: 'called',
        called_at: now,
        in_service: true,
        counter,
      };
      if (doctor_name) updatePayloadUrg.doctor_name = doctor_name;
      if (doctor_id) updatePayloadUrg.doctor_id = doctor_id;

      console.log('[doctor-call-next] calling urgent:', urg.id, urg.display_number, { updatePayloadUrg });

      const { error: upUrgErr } = await supabase
        .from('doctor_tickets')
        .update(updatePayloadUrg)
        .eq('id', urg.id);

      if (upUrgErr) {
        console.error('[doctor-call-next] Update urgent error:', upUrgErr);
        throw upUrgErr;
      }

      const updatedTicket = { ...urg, ...updatePayloadUrg };
      return new Response(JSON.stringify({ success: true, next: updatedTicket }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // MODO 2: Ordem de Chegada - busca o próximo ticket independente do tipo
    if (Number(passwordSetting) === 2) {
      // 1) tentar usar ticket_number: localizar último NÃO-URGENTE chamado/finalizado hoje e extrair seu número
      const [{ data: lastByCalled }, { data: lastByFinished }] = await Promise.all([
        baseFilter(
          supabase
            .from('doctor_tickets')
            .select('display_number, ticket_number, called_at')
            .not('called_at', 'is', null)
            .eq('priority', 'normal')
            .eq('urgent', 0)
            .gte('called_at', startOfDayISO)
            .order('called_at', { ascending: false })
            .limit(1)
        ),
        baseFilter(
          supabase
            .from('doctor_tickets')
            .select('display_number, ticket_number, finished_at')
            .not('finished_at', 'is', null)
            .eq('priority', 'normal')
            .eq('urgent', 0)
            .gte('finished_at', startOfDayISO)
            .order('finished_at', { ascending: false })
            .limit(1)
        ),
      ]);

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

      // LOG TEMP: last number info
      console.log('[doctor-call-next] lastNormal check:', {
        doctor: doctor_id || doctor_name,
        calledRow,
        finishedRow,
        lastNormalNum,
      });

      // 2) Tentar achar por número exato (nextNum = lastNormalNum + 1), depois procurar o menor ticket_number > lastNormalNum
      let candidate;

      const nextNum = lastNormalNum + 1;

      if (nextNum && nextNum > 0) {
        const { data: exact } = await baseFilter(
          supabase
            .from('doctor_tickets')
            .select('id, display_number, priority, patient_name, created_at, ticket_number')
            .is('finished_at', null)
            .eq('in_service', false)
            .eq('status', 'waiting')
            .eq('ticket_number', nextNum)
            .limit(1)
        );
        console.log('[doctor-call-next] exact nextNum query result:', exact);
        if (exact && exact.length) candidate = exact[0];
      }

      if (!candidate && lastNormalNum && lastNormalNum > 0) {
        const { data: byNumber } = await baseFilter(
          supabase
            .from('doctor_tickets')
            .select('id, display_number, priority, patient_name, created_at, ticket_number')
            .is('finished_at', null)
            .eq('in_service', false)
            .eq('status', 'waiting')
            .gt('ticket_number', lastNormalNum)
            .order('ticket_number', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(1)
        );
        console.log('[doctor-call-next] gt lastNormalNum query result:', byNumber);

        candidate = (byNumber || [])[0];
      }

      // 3) fallback: pegar o mais antigo por created_at com status waiting
      if (!candidate) {
        const { data: allTickets } = await baseFilter(
          supabase
            .from('doctor_tickets')
            .select('id, display_number, priority, patient_name, created_at')
            .is('finished_at', null)
            .eq('in_service', false)
            .eq('status', 'waiting')
            .gte('created_at', startOfDayISO)
            .order('created_at', { ascending: true })
            .limit(1)
        );
        console.log('[doctor-call-next] fallback created_at query result:', allTickets);
        candidate = (allTickets || [])[0];
      }

      console.log('[doctor-call-next] selected candidate:', candidate);

      next = candidate as DocTicket | undefined;
      if (!candidate && lastNormalNum && lastNormalNum > 0) {
        const { data: byNumber } = await baseFilter(
          supabase
            .from('doctor_tickets')
            .select('id, display_number, priority, patient_name, created_at, ticket_number')
            .is('finished_at', null)
            .eq('in_service', false)
            .eq('status', 'waiting')
            .gt('ticket_number', lastNormalNum)
            .order('ticket_number', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(1)
        );

        candidate = (byNumber || [])[0];
      }

      // 3) fallback: pegar o mais antigo por created_at com status waiting
      if (!candidate) {
        const { data: allTickets } = await baseFilter(
          supabase
            .from('doctor_tickets')
            .select('id, display_number, priority, patient_name, created_at')
            .is('finished_at', null)
            .eq('in_service', false)
            .eq('status', 'waiting')
            .gte('created_at', startOfDayISO)
            .order('created_at', { ascending: true })
            .limit(1)
        );
        candidate = (allTickets || [])[0];
      }

      next = candidate as DocTicket | undefined;
    } else {
      // MODO 1: 2 para 1 - intercala normal/preferencial (aplicado por doutor)
      // Cache TTL 1000ms para contagem de normais consecutivos
      // Reaproveitamos lógica do operador, mas filtrando por doutor
      let normalsSinceLastPrefFinished: number;
      if (Date.now() - countCache.ts < 1000) {
        normalsSinceLastPrefFinished = countCache.normalsAfterLastPref;
      } else {
        // Último preferencial finalizado hoje (para este doutor)
        const { data: lastPref } = await baseFilter(
          supabase
            .from('doctor_tickets')
            .select('finished_at')
            .not('finished_at', 'is', null)
            .gte('finished_at', startOfDayISO)
            .neq('priority', 'normal')
            .order('finished_at', { ascending: false })
            .limit(1)
        );

        const baseTime = lastPref && lastPref.length ? lastPref[0].finished_at : startOfDayISO;

        // Conta normais finalizados após último preferencial
        const { count: normalsCount } = await baseFilter(
          supabase
            .from('doctor_tickets')
            .select('id', { count: 'exact', head: true })
            .not('finished_at', 'is', null)
            .gt('finished_at', baseTime)
            .eq('priority', 'normal')
        );

        normalsSinceLastPrefFinished = normalsCount || 0;
        countCache = {
          ts: Date.now(),
          normalsAfterLastPref: normalsSinceLastPrefFinished,
        };
      }

      const futureNormals = normalsSinceLastPrefFinished;
      const nextType: 'normal' | 'preferencial' = futureNormals >= 2 ? 'preferencial' : 'normal';

      // Buscar próximas senhas aguardando por tipo (apenas criadas hoje)
      const [{ data: normals }, { data: prefs }] = (await Promise.all([
        baseFilter(
          supabase
            .from('doctor_tickets')
            .select('id, display_number, priority, patient_name, created_at')
            .is('finished_at', null)
            .eq('in_service', false)
            .eq('status', 'waiting')
            .eq('priority', 'normal')
            .gte('created_at', startOfDayISO)
            .order('created_at', { ascending: true })
            .limit(10)
        ),
        baseFilter(
          supabase
            .from('doctor_tickets')
            .select('id, display_number, priority, patient_name, created_at')
            .is('finished_at', null)
            .eq('in_service', false)
            .eq('status', 'waiting')
            .neq('priority', 'normal')
            .gte('created_at', startOfDayISO)
            .order('created_at', { ascending: true })
            .limit(10)
        ),
      ])) as any;

      const pick = (nextType === 'normal' ? (normals || [])[0] : (prefs || [])[0]) as DocTicket | undefined;

      // fallback quando não há do tipo esperado
      next = pick;
      if (!next) {
        const alt = nextType === 'normal' ? (prefs || [])[0] : (normals || [])[0];
        next = alt as DocTicket | undefined;
      }
    }

    if (!next) {
      return new Response(
        JSON.stringify({
          success: true,
          next: null,
          message: 'No waiting tickets',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const now = new Date().toISOString();

    // 4) Marcar ticket como chamado e logar
    // Se counter estiver vazio, usar o nome do doutor ou "Atendimento"
    const counterValue = counter || doctor_name || 'Atendimento';

    console.log('[doctor-call-next] Atualizando ticket com:', {
      counter: counterValue,
      doctor_name,
      ticket_id: next.id,
    });

    const { error: upErr } = await supabase
      .from('doctor_tickets')
      .update({
        status: 'called',
        called_at: now,
        in_service: true,
        doctor_name,
        doctor_id,
        counter: counterValue,
      })
      .eq('id', next.id);

    if (upErr) throw upErr;

    // Retornamos o ticket selecionado
    return new Response(JSON.stringify({ success: true, next }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[doctor-call-next] Error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
