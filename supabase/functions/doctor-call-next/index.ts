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

    // 2) FIFO: pegar o primeiro aguardando (apenas criadas hoje)
    const { data: waiting, error: waitErr } = await baseFilter(
      supabase
        .from('doctor_tickets')
        .select('id, display_number, priority, patient_name, created_at')
        .is('finished_at', null)
        .eq('in_service', false)
        .gte('created_at', startOfDayISO)
        .order('created_at', { ascending: true })
        .limit(1)
    );

    if (waitErr) {
      console.error('[doctor-call-next] Waiting fetch error:', waitErr);
      throw waitErr;
    }

    const next = (waiting && waiting[0]) as DocTicket | undefined;

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
