// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Cache leve para prévia (TTL 3000ms)
let previewCache = { ts: 0, payload: null as any };

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
    const { doctor_id, doctor_name } = await req.json().catch(() => ({}));

    if (!doctor_id && !doctor_name) {
      throw new Error('doctor_id or doctor_name is required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
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

    // 1) Estado atual - filtrado por médico (apenas criadas hoje)

    const { data: current, error: currentError } = await supabase
      .from('doctor_tickets')
      .select('id, priority')
      .eq(doctor_id ? 'doctor_id' : 'doctor_name', doctor_id ?? doctor_name)
      .eq('in_service', true)
      .is('finished_at', null)
      .gte('created_at', startOfDayISO)
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentError) {
      console.error(
        '[doctor-queue-preview] Error fetching current:',
        currentError
      );
      throw currentError;
    }

    // Último preferencial finalizado (served) - filtrado por médico

    const { data: lastPref, error: lastPrefError } = await supabase
      .from('doctor_tickets')
      .select('finished_at')
      .eq(doctor_id ? 'doctor_id' : 'doctor_name', doctor_id ?? doctor_name)
      .not('finished_at', 'is', null)
      .in('priority', ['preferential', 'priority'])
      .order('finished_at', { ascending: false })
      .limit(1);

    if (lastPrefError) {
      console.error(
        '[doctor-queue-preview] Error fetching lastPref:',
        lastPrefError
      );
      throw lastPrefError;
    }

    const baseTime =
      lastPref && lastPref.length
        ? lastPref[0].finished_at
        : '1970-01-01T00:00:00Z';

    // Conta normais finalizados após último preferencial - filtrado por médico

    const { count: normalsCount, error: normalsCountError } = await supabase
      .from('doctor_tickets')
      .select('id', { count: 'exact', head: true })
      .eq(doctor_id ? 'doctor_id' : 'doctor_name', doctor_id ?? doctor_name)
      .not('finished_at', 'is', null)
      .gt('finished_at', baseTime)
      .eq('priority', 'normal');

    if (normalsCountError) {
      console.error(
        '[doctor-queue-preview] Error counting normals:',
        normalsCountError
      );
      throw normalsCountError;
    }

    const currentIsNormal = current ? current.priority === 'normal' : false;
    let normalsSinceLastPrefFinished = normalsCount || 0;
    let futureNormals =
      normalsSinceLastPrefFinished + (currentIsNormal ? 1 : 0);

    if (current && current.priority !== 'normal') {
      futureNormals = 0; // reset imediato do ciclo enquanto preferencial está em atendimento
    }

    // offset: 0 => N,N,P ; 1 => N,P,N ; 2 => P,N,N
    const offset = futureNormals >= 2 ? 2 : futureNormals === 1 ? 1 : 0;
    const previewLimit = 50;

    // Primeiro: verificar se há tickets marcados como urgente para este médico
    const { data: urgentWaiting, error: urgentErr } = await supabase
      .from('doctor_tickets')
      .select('id, display_number, priority, patient_name, created_at, urgent, urgent_date')
      .eq(doctor_id ? 'doctor_id' : 'doctor_name', doctor_id ?? doctor_name)
      .is('finished_at', null)
      .eq('in_service', false)
      .eq('urgent', 1)
      .gte('created_at', startOfDayISO)
      .order('urgent_date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(previewLimit);

    if (urgentErr) console.error('[doctor-queue-preview] urgent fetch error:', urgentErr);

    if (urgentWaiting && urgentWaiting.length > 0) {
      const result: (DocTicket & { pos: number })[] = (urgentWaiting || []).map((t, idx) => ({ ...(t as DocTicket), pos: idx + 1 }));
      return new Response(JSON.stringify({ success: true, items: result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // Se não houver urgente, ler configuração de senha (2 para 1 ou ordem de chegada)
    const { data: settingRows } = await supabase
      .from('company_settings')
      .select('password_setting')
      .limit(1)
      .single();

    const passwordSetting = settingRows?.password_setting || 1;

    // Buscar lista de aguardando (ordenada por created_at)
    const { data: waiting, error: waitingError } = await supabase
      .from('doctor_tickets')
      .select('id, display_number, priority, patient_name, created_at, in_service, finished_at')
      .eq(doctor_id ? 'doctor_id' : 'doctor_name', doctor_id ?? doctor_name)
      .is('finished_at', null)
      .eq('in_service', false)
      .gte('created_at', startOfDayISO)
      .order('created_at', { ascending: true })
      .limit(previewLimit);

    if (waitingError) throw waitingError;

    let resultItems: (DocTicket & { pos: number })[] = [];

    if (passwordSetting && Number(passwordSetting) === 2) {
      // Aplicar lógica local N,N,P (2 normais, 1 preferencial)
      const normals: any[] = [];
      const prefs: any[] = [];
      (waiting || []).forEach((t: any) => {
        if (t.priority === 'normal') normals.push(t);
        else prefs.push(t);
      });

      const reordered: any[] = [];
      let nCount = 0;
      while (normals.length || prefs.length) {
        if (nCount < 2 && normals.length) {
          reordered.push(normals.shift());
          nCount++;
        } else if (prefs.length) {
          reordered.push(prefs.shift());
          nCount = 0;
        } else if (normals.length) {
          reordered.push(normals.shift());
          nCount++;
        } else break;
      }

      resultItems = reordered.map((t: any, idx: number) => ({ ...(t as DocTicket), pos: idx + 1 }));
    } else {
      resultItems = (waiting || []).map((t: any, idx: number) => ({ ...(t as DocTicket), pos: idx + 1 }));
    }

    const responsePayload = { success: true, items: resultItems };
    // REMOVIDO: Cache para garantir dados sempre atualizados
    // previewCache = { ts: Date.now(), payload: responsePayload };

    return new Response(JSON.stringify(responsePayload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[doctor-queue-preview] Error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
