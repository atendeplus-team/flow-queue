// scripts/order_test.js
// Simula a lógica 2-para-1 usada no Operator/DoctorOperator para testes locais

function simulateTwoForOne(initialCandidates, iterations = 10) {
  // candidates: array of { id, display_number, priority, created_at }
  const candidates = initialCandidates.map((c, i) => ({ ...c, __idx: i }));
  const sequence = [];
  let counter = 0; // patternCounter

  for (let i = 0; i < iterations; i++) {
    if (candidates.length === 0) break;

    // recompute lists based on remaining candidates (ordered by created_at asc)
    candidates.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const normals = candidates.filter((c) => (c.priority || 'normal') === 'normal');
    const preferentials = candidates.filter((c) => (c.priority || 'normal') !== 'normal');

    let toCall = null;
    if (preferentials.length > 0) {
      if (counter < 2 && normals.length > 0) {
        toCall = normals[0];
        counter = counter + 1;
      } else {
        toCall = preferentials[0];
        counter = 0;
      }
    } else {
      toCall = candidates[0];
    }

    if (!toCall) break;

    sequence.push({ called: toCall.display_number, priority: toCall.priority, counter });

    // remove called from candidates
    const idx = candidates.findIndex((c) => c.id === toCall.id);
    if (idx !== -1) candidates.splice(idx, 1);
  }

  return sequence;
}

function runScenario(name, items, iterations=10) {
  console.log('\nScenario:', name);
  console.log('Initial order: ', items.map(i => `${i.display_number}(${i.priority})`).join(', '));
  const seq = simulateTwoForOne(items, iterations);
  console.log('Call sequence:');
  seq.forEach((s, i) => console.log(`${i+1}. ${s.called} [${s.priority}] (counter=${s.counter})`));
}

// Scenario 1: 1 preferencial at front, then many normals
const now = Date.now();
const items1 = [
  { id: 'p1', display_number: 'PR-001', priority: 'priority', created_at: new Date(now - 60000).toISOString() },
  { id: 'n1', display_number: 'ATD-001', priority: 'normal', created_at: new Date(now - 50000).toISOString() },
  { id: 'n2', display_number: 'ATD-002', priority: 'normal', created_at: new Date(now - 40000).toISOString() },
  { id: 'n3', display_number: 'ATD-003', priority: 'normal', created_at: new Date(now - 30000).toISOString() },
  { id: 'n4', display_number: 'ATD-004', priority: 'normal', created_at: new Date(now - 20000).toISOString() },
];
runScenario('1 preferred at front, normals after', items1, 8);

// Scenario 2: preferencial later in queue
const items2 = [
  { id: 'n1', display_number: 'ATD-001', priority: 'normal', created_at: new Date(now - 60000).toISOString() },
  { id: 'n2', display_number: 'ATD-002', priority: 'normal', created_at: new Date(now - 50000).toISOString() },
  { id: 'p1', display_number: 'PR-001', priority: 'priority', created_at: new Date(now - 40000).toISOString() },
  { id: 'n3', display_number: 'ATD-003', priority: 'normal', created_at: new Date(now - 30000).toISOString() },
  { id: 'n4', display_number: 'ATD-004', priority: 'normal', created_at: new Date(now - 20000).toISOString() },
];
runScenario('1 preferred in middle', items2, 10);

// Scenario 3: multiple preferentials mixed
const items3 = [
  { id: 'n1', display_number: 'ATD-001', priority: 'normal', created_at: new Date(now - 70000).toISOString() },
  { id: 'p1', display_number: 'PR-001', priority: 'priority', created_at: new Date(now - 60000).toISOString() },
  { id: 'n2', display_number: 'ATD-002', priority: 'normal', created_at: new Date(now - 50000).toISOString() },
  { id: 'p2', display_number: 'PR-002', priority: 'priority', created_at: new Date(now - 40000).toISOString() },
  { id: 'n3', display_number: 'ATD-003', priority: 'normal', created_at: new Date(now - 30000).toISOString() },
  { id: 'n4', display_number: 'ATD-004', priority: 'normal', created_at: new Date(now - 20000).toISOString() },
];
runScenario('mixed priorities', items3, 12);

console.log('\nTests done.');
