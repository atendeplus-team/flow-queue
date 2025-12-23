// scripts/doctor_merge_test.js
// Simula a lógica de loadWaitingTickets (doctor) - mesclagem e ordenação

function mergeDoctorPreview(items, urgentInfoMap = {}, currentId = null) {
  const prev = []; // assume no previous
  const urgentMap = urgentInfoMap; // {id: {urgent:1, urgent_date: '...'}}

  // If there's a current ticket, start after it (simulate 'itemsAfterCurrent')
  let orderedItems = items;
  if (currentId) {
    const originalIdx = items.findIndex((it) => it.id === currentId);
    if (originalIdx !== -1) orderedItems = items.slice(originalIdx + 1);
  }

  const mapped = orderedItems.map((d, idx) => ({
    id: d.id,
    ticket_id: d.ticket_id,
    display_number: d.display_number,
    patient_name: d.patient_name || null,
    priority: d.priority,
    status: d.status || 'waiting',
    created_at: d.created_at,
    counter: d.counter || null,
    doctor_name: d.doctor_name || null,
    urgent: typeof d.urgent !== 'undefined' ? d.urgent : (urgentMap[d.id]?.urgent ?? 0),
    urgent_date: typeof d.urgent_date !== 'undefined' ? d.urgent_date : (urgentMap[d.id]?.urgent_date ?? null),
    __original_index: idx,
  }));

  const urgentList = mapped.filter(m => m.urgent).sort((a,b) => new Date(a.urgent_date||0).getTime() - new Date(b.urgent_date||0).getTime());
  let nonUrgentList = mapped.filter(m => !m.urgent);

  // Mode 2-para-1: promote preferentials within a small lookahead window after each normal
  const remaining = [...nonUrgentList];
  const reordered = [];
  let normalCount = 0;
  const windowSize = 2; // reduzir para 2 para evitar promover PR-004 muito cedo

  while (remaining.length > 0) {
    // Respeitar a ordem do preview: pegar o próximo item em vez de buscar por normais
    const next = remaining.shift();
    if (!next) break;
    reordered.push(next);

    if ((next.priority || 'normal') === 'normal') {
      normalCount += 1;
      // procurar preferencial na janela imediata após a normal e promovê-la
      const lookRange = remaining.slice(0, windowSize);
      const prefInWindowIndex = lookRange.findIndex((r) => (r.priority || 'normal') !== 'normal');
      // Promove somente se a preferencial estiver imediatamente após (index 0) na janela
      if (prefInWindowIndex === 0) {
        const [promoted] = remaining.splice(prefInWindowIndex, 1);
        reordered.push(promoted);
        normalCount = 0;
      } else if (normalCount >= 2) {
        // se já passaram 2 normais sem promoção, pegar qualquer preferencial remanescente
        const prefIndex = remaining.findIndex((r) => (r.priority || 'normal') !== 'normal');
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

  const finalList = [...urgentList, ...reordered];
  return finalList;
}

function runTestCase(name, items, urgentMap, currentId = null) {
  console.log('\nTest case:', name);
  // show preview order *after* currentId if provided (simulate itemsAfterCurrent)
  let previewItems = items;
  if (currentId) {
    const originalIdx = items.findIndex((it) => it.id === currentId);
    if (originalIdx !== -1) previewItems = items.slice(originalIdx + 1);
  }
  console.log('Preview order:', previewItems.map(i => i.display_number).join(', '));
  console.log('Urgent Map:', urgentMap);
  const out = mergeDoctorPreview(items, urgentMap, currentId);
  // Print in UI-like format: index, display_number, priority label, urgent badge, time
  console.log('\nLista exibida:');
  out.forEach((it, idx) => {
    const time = it.created_at ? new Date(it.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const priorityLabel = (it.priority && it.priority !== 'normal') ? 'Preferencial' : 'Normal';
    const urgentLabel = it.urgent ? 'Urgente' : '';
    console.log(`${idx + 1}  ${it.display_number}  ${priorityLabel}  ${urgentLabel}  ${time}`);
  });
}

// User-provided preview items
const items = [
  {id: 'a0af49c2-a543-4370-b50b-07ce5bf30005', display_number:'ATD-001', priority:'normal', created_at:'2025-12-23T17:55:00Z'},
  {id: '5d55e21b-363b-4eb8-9056-3fd7e2a47352', display_number:'OC-001', priority:'normal', created_at:'2025-12-23T17:55:10Z'},
  {id: '915f1e55-17ef-4e73-9d95-316793ede6ab', display_number:'OC-002', priority:'normal', created_at:'2025-12-23T17:55:20Z'},
  {id: '360eac09-59d6-4cea-b13f-48497d65f8a4', display_number:'PR-001', priority:'priority', created_at:'2025-12-23T17:55:30Z'},
  {id: '4cbee8bb-af03-47f2-ae84-64f401b8df0f', display_number:'ATD-002', priority:'normal', created_at:'2025-12-23T17:56:00Z'},
  {id: '73ae8916-5915-4932-b470-f4ff6a8e89a2', display_number:'PR-003', priority:'priority', created_at:'2025-12-23T17:56:30Z'},
  {id: '43357666-7cf9-45fb-b22e-1423e6b37f29', display_number:'ATD-003', priority:'normal', created_at:'2025-12-23T17:56:40Z'},
  {id: '2bc13b14-1290-4baa-9429-69071ed7ee2c', display_number:'ATD-004', priority:'normal', created_at:'2025-12-23T18:17:00Z'},
  {id: 'acfd7ba9-f094-4310-be32-984548593dd4', display_number:'PR-002', priority:'priority', created_at:'2025-12-23T18:17:10Z'},
  {id: '48c908f7-db03-4908-8cfa-8fdff9e815be', display_number:'ATD-005', priority:'normal', created_at:'2025-12-23T18:17:20Z'},
  {id: '022cf86a-2025-4838-895c-4f6ee47d55ba', display_number:'ATD-006', priority:'normal', created_at:'2025-12-23T18:18:00Z'},
  {id: 'cb1c9337-0913-4667-b43a-5694aefe8f95', display_number:'PR-004', priority:'priority', created_at:'2025-12-23T18:18:10Z'},
];

// Case A: no urgents
runTestCase('no urgents', items, {});

// Case B: some urgents that match UI (OC-002 and PR-003 urgent) with DB priority (OC is normal)
  runTestCase('OC-002 & PR-003 urgent', items, {
    '915f1e55-17ef-4e73-9d95-316793ede6ab': {urgent:1, urgent_date:'2025-12-23T17:55:21Z', priority:'normal'},
    '73ae8916-5915-4932-b470-f4ff6a8e89a2': {urgent:1, urgent_date:'2025-12-23T17:56:31Z', priority:'priority'},
});

// Case C: many urgents (PRs and some ATDs)
runTestCase('multiple urgents', items, {
  '915f1e55-17ef-4e73-9d95-316793ede6ab': {urgent:1, urgent_date:'2025-12-23T17:55:21Z'},
  '73ae8916-5915-4932-b470-f4ff6a8e89a2': {urgent:1, urgent_date:'2025-12-23T17:56:31Z'},
  '4cbee8bb-af03-47f2-a8ea-64f401b8df0f': {urgent:1, urgent_date:'2025-12-23T17:56:05Z'},
});

// Case D: simulate ATD-002 already em atendimento (start after it)
// Remover PR-003 do preview para simular que já foi atendida (igual à UI atual do usuário)
const filteredAfterATD002 = items.filter(i => i.display_number !== 'PR-003');
runTestCase('after ATD-002 called', filteredAfterATD002, {}, '4cbee8bb-af03-47f2-ae84-64f401b8df0f');

// Case E: simulate user's actual preview before calling ATD-003
// User preview: ATD-003, PR-002, ATD-004, ATD-005, PR-004, ATD-006
const itemsUserPreview = [
  {id: '43357666-7cf9-45fb-b22e-1423e6b37f29', display_number:'ATD-003', priority:'normal', created_at:'2025-12-23T17:56:40Z'},
  {id: 'acfd7ba9-f094-4310-be32-984548593dd4', display_number:'PR-002', priority:'priority', created_at:'2025-12-23T18:17:10Z'},
  {id: '2bc13b14-1290-4baa-9429-69071ed7ee2c', display_number:'ATD-004', priority:'normal', created_at:'2025-12-23T18:17:00Z'},
  {id: '48c908f7-db03-4908-8cfa-8fdff9e815be', display_number:'ATD-005', priority:'normal', created_at:'2025-12-23T18:17:20Z'},
  {id: 'cb1c9337-0913-4667-b43a-5694aefe8f95', display_number:'PR-004', priority:'priority', created_at:'2025-12-23T18:18:10Z'},
  {id: '022cf86a-2025-4838-895c-4f6ee47d55ba', display_number:'ATD-006', priority:'normal', created_at:'2025-12-23T18:18:00Z'},
];
runTestCase('after ATD-003 called (user preview)', itemsUserPreview, {}, '43357666-7cf9-45fb-b22e-1423e6b37f29');

console.log('\nDone');
