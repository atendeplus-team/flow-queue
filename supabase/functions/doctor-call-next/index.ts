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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: {
            Authorization: req.headers.get('Authorization') || '',
          },
        },
      }
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
    const { data: current, error: curErr } = await baseFilter(
      supabase
        .from('doctor_tickets')
        .select(
          'id, display_number, priority, patient_name, called_at, counter'
        )
        .eq('in_service', true)
        .is('finished_at', null)
        .gte('created_at', startOfDayISO)
        .order('called_at', { ascending: false })
        .limit(1)
    ).maybeSingle();

    if (curErr) {
      console.error('[doctor-call-next] Current fetch error:', curErr);
    }

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

    // 2) Ler modo de senha (2 = Ordem de Chegada) para decidir política de priorização
    const { data: settingRows } = await supabase
      .from('company_settings')
      .select('password_setting')
      .limit(1)
      .single();

    const passwordSetting = settingRows?.password_setting || 1;

    // Se não estivermos em Ordem de Chegada (modo 2), priorizar urgentes globalmente como antes
    if (!passwordSetting || Number(passwordSetting) !== 2) {
      const { data: urgentWaiting, error: urgentErr } = await baseFilter(
        supabase
          .from('doctor_tickets')
          .select('id, display_number, priority, patient_name, created_at, urgent, urgent_date')
          .is('finished_at', null)
          .eq('in_service', false)
          .eq('urgent', 1)
          .gte('created_at', startOfDayISO)
          .order('urgent_date', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
      );

      if (urgentErr) {
        console.error('[doctor-call-next] Urgent fetch error:', urgentErr);
      }

      if (urgentWaiting && urgentWaiting.length > 0) {
        const urg = urgentWaiting[0] as DocTicket & { urgent?: number; urgent_date?: string };
        // Chamar este urgente
        const now = new Date().toISOString();
        const updatePayloadUrg: Record<string, any> = {
          status: 'Aguardando',
          called_at: now,
          in_service: false,
          counter,
        };
        if (doctor_name) updatePayloadUrg.doctor_name = doctor_name;
        if (doctor_id) updatePayloadUrg.doctor_id = doctor_id;

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
    }

    // 3) Se não houver urgente (ou estamos em Ordem de Chegada), buscar lista de aguardando e aplicar regra de password_setting
    const { data: settingRows } = await supabase
      .from('company_settings')
      .select('password_setting')
      .limit(1)
      .single();

    const passwordSetting = settingRows?.password_setting || 1;

    const { data: waiting, error: waitErr } = await baseFilter(
      supabase
        .from('doctor_tickets')
        .select('id, display_number, priority, patient_name, created_at')
        .is('finished_at', null)
        .eq('in_service', false)
        .gte('created_at', startOfDayISO)
        .order('created_at', { ascending: true })
        .limit(200)
    );

    if (waitErr) {
      console.error('[doctor-call-next] Waiting fetch error:', waitErr);
      throw waitErr;
    }

    let next = (waiting && waiting[0]) as DocTicket | undefined;

    if (passwordSetting && Number(passwordSetting) === 2 && waiting && waiting.length) {
      // Ordem de Chegada (modo 2): implementar regra numérica solicitada pelo usuário
      // 1) buscar último normal finalizado por esse médico hoje (para saber o último número não-urgente chamado)
      // Buscar o último normal chamado ou finalizado (usamos o evento mais recente entre called_at e finished_at)
      const [{ data: lastByCalled }, { data: lastByFinished }] = await Promise.all([
        baseFilter(
          supabase
            .from('doctor_tickets')
            .select('display_number, called_at')
            .not('called_at', 'is', null)
            .eq('priority', 'normal')
            .gte('called_at', startOfDayISO)
            .order('called_at', { ascending: false })
            .limit(1)
        ),
        baseFilter(
          supabase
            .from('doctor_tickets')
            .select('display_number, finished_at')
            .not('finished_at', 'is', null)
            .eq('priority', 'normal')
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
        lastNormalNum = parseNum(recent?.display_number) || 0;
      }

      const nextNum = lastNormalNum + 1;

      // mapear waiting com número extraído
      const mapped = (waiting as any[]).map((t) => ({ ...(t as any), __num: parseNum((t as any).display_number) || 0 }));

      // 2) se existir um urgente com número == nextNum, chamar ele
      const urgentImmediate = mapped.find((m) => (m.urgent || 0) === 1 && m.__num === nextNum);
      if (urgentImmediate) {
        next = urgentImmediate as DocTicket;
      } else {
        // 3) caso contrário, escolher o próximo normal com número > lastNormalNum (menor número maior que lastNormalNum)
        const normalsGreater = mapped
          .filter((m) => (m.priority || 'normal') === 'normal' && m.__num > lastNormalNum)
          .sort((a, b) => a.__num - b.__num);
        if (normalsGreater && normalsGreater.length) {
          next = normalsGreater[0] as DocTicket;
        } else {
          // fallback: primeira da lista (ordem por created_at)
          next = (waiting && waiting[0]) as DocTicket | undefined;
        }
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

    // 3) Marcar ticket como chamado (status: 'Aguardando' - aguardando chegada)
    const updatePayload: Record<string, any> = {
      status: 'Aguardando',
      called_at: now,
      in_service: false,
      counter,
    };
    if (doctor_name) updatePayload.doctor_name = doctor_name;
    if (doctor_id) updatePayload.doctor_id = doctor_id;

    const { error: upErr } = await supabase
      .from('doctor_tickets')
      .update(updatePayload)
      .eq('id', next.id);

    if (upErr) {
      console.error('[doctor-call-next] Update error:', upErr);
      throw upErr;
    }

    // Retorna o ticket com os campos atualizados
    const updatedTicket = {
      ...next,
      ...updatePayload,
    };

    return new Response(JSON.stringify({ success: true, next: updatedTicket }), {
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
