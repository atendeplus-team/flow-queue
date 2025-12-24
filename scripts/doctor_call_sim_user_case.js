// Simulação com dados fornecidos pelo usuário para reproduzir o problema e validar nova lógica
const items = [
  { display_number: 'ATD-002', priority: 'normal', status: 'served', ticket_number: 2, called_at: '2025-12-24T02:48:22.634Z', finished_at: '2025-12-24T02:48:25.61Z' },
  { display_number: 'ATD-001', priority: 'normal', status: 'served', ticket_number: 1, called_at: '2025-12-24T02:48:35.498Z', finished_at: '2025-12-24T02:48:37.658Z' },
  { display_number: 'PR-004', priority: 'priority', status: 'served', ticket_number: 4, called_at: '2025-12-24T02:48:28.061Z', finished_at: '2025-12-24T02:48:33.25Z' },
  { display_number: 'OC-003', priority: 'normal', status: 'served', ticket_number: 3, called_at: '2025-12-24T02:48:39.651Z', finished_at: '2025-12-24T02:48:41.274Z' },
  { display_number: 'PR-005', priority: 'priority', status: 'served', ticket_number: 5, called_at: '2025-12-24T02:48:44.614Z', finished_at: '2025-12-24T02:48:46.402Z' },
  { display_number: 'OC-006', priority: 'normal', status: 'served', ticket_number: 6, called_at: '2025-12-24T02:48:48.159Z', finished_at: '2025-12-24T02:48:49.786Z' },
  { display_number: 'ATD-007', priority: 'normal', status: 'served', ticket_number: 7, called_at: '2025-12-24T02:50:25.577Z', finished_at: '2025-12-24T02:50:27.25Z' },
  { display_number: 'ATD-013', priority: 'normal', status: 'served', ticket_number: 13, called_at: '2025-12-24T02:50:15.215Z', finished_at: '2025-12-24T02:50:17.082Z' },
  { display_number: 'PR-008', priority: 'priority', status: 'waiting', ticket_number: 8, created_at: '2025-12-24T02:49:46.387743Z' },
  { display_number: 'PR-014', priority: 'priority', status: 'served', ticket_number: 14, called_at: '2025-12-24T02:50:18.315Z', finished_at: '2025-12-24T02:50:19.858Z' },
  { display_number: 'OC-010', priority: 'normal', status: 'served', ticket_number: 10, called_at: '2025-12-24T02:50:22.047Z', finished_at: '2025-12-24T02:50:23.802Z' },
  { display_number: 'ATD-009', priority: 'normal', status: 'called', ticket_number: 9, called_at: '2025-12-24T02:50:29.529Z', created_at: '2025-12-24T02:50:08.690791Z' },
];

const parseNum = (s) => { const m = String(s).match(/(\d+)/); return m ? parseInt(m[1], 10) : null; };

const startOfDayISO = '2025-12-24T00:00:00.000Z';

// 1) urgentes? none in this dataset
const urgentWaiting = items.filter(t => t.urgent === 1 && t.status === 'waiting');
if (urgentWaiting.length) {
  console.log('Urgent selected:', urgentWaiting[0].display_number);
} else {
  // 2) find last non-urgent called or finished today (priority normal, not urgent)
  const nonUrg = items.filter(t => t.priority === 'normal' && (t.called_at || t.finished_at));
  // pick most recent by max(called_at, finished_at)
  const mostRecent = nonUrg.map(t => ({
    row: t,
    time: Math.max(new Date(t.called_at || 0).getTime(), new Date(t.finished_at || 0).getTime())
  })).sort((a,b)=>b.time - a.time)[0];

  const recentRow = mostRecent ? mostRecent.row : null;
  const lastNormalNum = recentRow ? (recentRow.ticket_number || parseNum(recentRow.display_number)) : 0;
  console.log('most recent non-urgent:', recentRow ? recentRow.display_number : null, 'lastNormalNum=', lastNormalNum);

  const nextNum = lastNormalNum + 1;

  // 3) try exact match nextNum among waiting
  const waiting = items.filter(t => t.status === 'waiting');
  const exact = waiting.find(w => (w.ticket_number || parseNum(w.display_number)) === nextNum);
  if (exact) {
    console.log('Selected by exact next number:', exact.display_number);
  } else {
    // 4) find smallest ticket_number > lastNormalNum
    const waitingWithNum = waiting.map(w => ({...w, __num: (w.ticket_number || parseNum(w.display_number)) || 0})).filter(w => w.__num > lastNormalNum).sort((a,b)=>a.__num-b.__num||new Date(a.created_at||0)-new Date(b.created_at||0));
    if (waitingWithNum.length) {
      console.log('Selected by smallest > last:', waitingWithNum[0].display_number);
    } else {
      // 5) fallback earliest waiting by created_at
      if (waiting.length) {
        const earliest = waiting.sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0))[0];
        console.log('Fallback earliest waiting:', earliest.display_number);
      } else {
        console.log('No waiting tickets');
      }
    }
  }
}
