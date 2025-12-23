// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Cache leve para prévia (TTL 3000ms)
let previewCache = { ts: 0, payload: null as any, passwordSetting: 0 };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

type Ticket = {
  id: string;
  display_number: string;
  priority: string;
  queue_id: string | null;
  created_at: string;
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Buscar configuração de chamada de senhas
    const { data: settings } = await supabase
      .from('company_settings')
      .select('password_setting')
      .limit(1)
      .single();
    
    // 1 = Modo 2 para 1 (intercala normal/preferencial)
    // 2 = Modo Ordem de Chegada (sequencial por created_at)
    const passwordSetting = settings?.password_setting || 1;

    // 1) Estado atual e últimos atendidos (apenas tickets)
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

    const { data: current } = await supabase
      .from('tickets')
      .select('id, priority, queue_id')
      .eq('in_service', true)
      .is('finished_at', null)
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Cache: se dentro do TTL e mesma config, retornar direto
    if (Date.now() - previewCache.ts < 3000 && previewCache.payload && previewCache.passwordSetting === passwordSetting) {
      return new Response(JSON.stringify(previewCache.payload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const previewLimit = 30;
    let result: (Ticket & { pos: number })[] = [];

    // MODO 2: Ordem de Chegada - lista tickets por ordem de criação
    if (passwordSetting === 2) {
      const { data: allTickets, error } = await supabase
        .from('tickets')
        .select('id, display_number, priority, queue_id, created_at')
        .is('finished_at', null)
        .eq('in_service', false)
        .gte('created_at', startOfDayISO)
        .order('created_at', { ascending: true })
        .limit(previewLimit);

      if (error) throw error;

      result = (allTickets || []).map((ticket: Ticket, index: number) => ({
        ...ticket,
        pos: index + 1,
      }));
    }
    // MODO 1: 2 para 1 - intercala normal/preferencial
    else {
      // Último preferencial finalizado hoje
      const { data: lastPref } = await supabase
        .from('tickets')
        .select('finished_at')
        .not('finished_at', 'is', null)
        .gte('finished_at', startOfDayISO)
        .neq('priority', 'normal')
        .order('finished_at', { ascending: false })
        .limit(1);
      const baseTime =
        lastPref && lastPref.length ? lastPref[0].finished_at : startOfDayISO;
      // Conta normais finalizados após último preferencial
      const { count: normalsCount } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .not('finished_at', 'is', null)
        .gt('finished_at', baseTime)
        .eq('priority', 'normal');

      // Contagem global (sem filtrar por queue_id) de normais consecutivos desde o último preferencial finalizado.
      const currentIsNormal = current ? current.priority === 'normal' : false;
      let normalsSinceLastPrefFinished = normalsCount || 0;
      // Se o ticket atual é preferencial (em atendimento), o próximo após ele deve iniciar novo ciclo começando por normal.
      let futureNormals =
        normalsSinceLastPrefFinished + (currentIsNormal ? 1 : 0);
      if (current && current.priority !== 'normal') {
        futureNormals = 0; // reset imediato do ciclo enquanto preferencial está em atendimento
      }
      // offset: 0 => N,N,P ; 1 => N,P,N ; 2 => P,N,N
      const offset = futureNormals >= 2 ? 2 : futureNormals === 1 ? 1 : 0;
      const cycle: ('normal' | 'preferencial')[] = [
        'normal',
        'normal',
        'preferencial',
      ];

      // 3) Buscar filas de espera (apenas tickets não finalizados e não em atendimento, criados hoje)
      const [{ data: normals, error: en }, { data: prefs, error: ep }] =
        (await Promise.all([
          supabase
            .from('tickets')
            .select('id, display_number, priority, queue_id, created_at')
            .is('finished_at', null)
            .eq('in_service', false)
            .eq('priority', 'normal')
            .gte('created_at', startOfDayISO)
            .order('created_at', { ascending: true })
            .limit(previewLimit),
          supabase
            .from('tickets')
            .select('id, display_number, priority, queue_id, created_at')
            .is('finished_at', null)
            .eq('in_service', false)
            .neq('priority', 'normal')
            .gte('created_at', startOfDayISO)
            .order('created_at', { ascending: true })
            .limit(previewLimit),
        ])) as any;
      if (en) throw en;
      if (ep) throw ep;

      // 4) Montar preview baseado em plan
      let iN = 0,
        iP = 0;
      // Geração incremental até limite ou esgotar listas
      for (let i = 0; i < previewLimit; i++) {
        const want = cycle[(offset + i) % 3];
        let chosen: any = null;
        if (want === 'normal') {
          chosen = (normals || [])[iN] || null;
          if (!chosen) chosen = (prefs || [])[iP] || null; // fallback
          if (chosen && chosen.priority === 'normal') iN++;
          else if (chosen) iP++;
        } else {
          chosen = (prefs || [])[iP] || null;
          if (!chosen) chosen = (normals || [])[iN] || null; // fallback
          if (chosen && chosen.priority !== 'normal') iP++;
          else if (chosen) iN++;
        }
        if (!chosen) break;
        result.push({ ...(chosen as Ticket), pos: i + 1 });
      }
    }

    const responsePayload = { success: true, items: result };
    previewCache = { ts: Date.now(), payload: responsePayload, passwordSetting };
    return new Response(JSON.stringify(responsePayload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
