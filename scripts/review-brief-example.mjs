// Runnable example: turn an exported Offer Forge board into a review brief.
// Run with: node scripts/review-brief-example.mjs

const board = {
  boardTitle: 'Offer forge board',
  items: [
    {
      title: 'Promise around visible wins',
      category: 'Promise',
      state: 'Refining',
      score: 9,
      effort: 3,
      metric: 8,
      textOne: 'Busy founders',
      textTwo: 'Before-and-after proof',
      date: '2026-04-25',
      note: 'Promise outcomes, not abstract service effort.',
    },
    {
      title: 'Bounded delivery scope',
      category: 'Scope',
      state: 'Ready',
      score: 8,
      effort: 2,
      metric: 8,
      textOne: 'First-time buyer',
      textTwo: 'Simple scope checklist',
      date: '2026-04-26',
      note: 'A bounded scope reduces fear and makes the next step easier.',
    },
    {
      title: 'Tiered pricing test',
      category: 'Pricing',
      state: 'Rough',
      score: 7,
      effort: 4,
      metric: 5,
      textOne: 'Warm outbound',
      textTwo: 'Anchor comparison',
      date: '2026-04-29',
      note: 'Test whether the premium anchor clarifies or confuses.',
    },
  ],
};

const stateWeights = { Rough: 2, Refining: 7, Ready: 10, Sent: 3 };
const completedStates = new Set(['Sent']);
const today = new Date('2026-04-24T00:00:00Z');

function daysFromToday(value) {
  const target = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(target.getTime())) return 999;
  return Math.round((target - today) / 86400000);
}

function priority(item) {
  const completed = completedStates.has(item.state);
  const dueBoost = completed ? 0 : Math.max(0, 4 - Math.max(daysFromToday(item.date), 0)) * 4;
  return item.score * 6 + item.metric * 5 + dueBoost + (stateWeights[item.state] ?? 0) - item.effort * 4;
}

function buildReviewBrief({ boardTitle, items }) {
  const active = items
    .filter((item) => !completedStates.has(item.state))
    .map((item) => ({ ...item, priority: priority(item), daysUntilReview: daysFromToday(item.date) }))
    .sort((a, b) => b.priority - a.priority || a.daysUntilReview - b.daysUntilReview);

  const top = active[0];
  const dueSoon = active.filter((item) => item.daysUntilReview <= 3).length;
  const mix = active.reduce((counts, item) => ({ ...counts, [item.category]: (counts[item.category] || 0) + 1 }), {});

  return [
    `# ${boardTitle} review brief`,
    `Top block: ${top.title} (${top.category}) — priority ${top.priority}`,
    `Why now: ${top.note}`,
    `Proof to prepare: ${top.textTwo} for ${top.textOne}`,
    `Due soon: ${dueSoon}/${active.length} active blocks`,
    `Active mix: ${Object.entries(mix).map(([key, count]) => `${key} ${count}`).join(', ')}`,
  ].join('\n');
}

console.log(buildReviewBrief(board));
