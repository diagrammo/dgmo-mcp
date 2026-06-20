// Regenerate the committed guidance-studio dataset fixtures + manifest.
//
// These fixtures exist to REMOVE A VARIABLE from authoring-tuning: a prompt
// like "chart our quarterly revenue" otherwise makes the model improvise data,
// so two runs are never comparable. With a fixture, the harness injects the
// SAME literal numbers every run, and the only thing that moves between runs is
// the guidance you edited.
//
// Deterministic by construction (all data is inline-literal — no Math.random,
// no Date.now), so re-running this regenerates byte-identical files. The JSON
// files are committed and read at runtime; this generator is for regeneration
// only. `suitsTypes` is HAND-AUTHORED here (the manifest is the source of
// truth) — it lists chart-type ids for which the dataset is a natural fit, and
// drives the studio's per-type dataset suggestions (Phase 2).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Each entry: manifest metadata + the literal data payload injected into prompts. */
const DATASETS = [
  {
    id: 'sales-by-quarter-region',
    label: 'Quarterly sales by region ($K)',
    suitsTypes: ['bar', 'line'],
    data: {
      unit: 'USD thousands',
      quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
      regions: {
        'North America': [820, 910, 870, 1040],
        Europe: [610, 645, 700, 760],
        'Asia Pacific': [430, 520, 640, 810],
        'Latin America': [180, 205, 240, 300],
      },
    },
  },
  {
    id: 'survey-funnel',
    label: 'Signup funnel (visitors → paid)',
    suitsTypes: ['funnel', 'pie', 'pyramid'],
    data: {
      stages: [
        { name: 'Visited site', count: 48000 },
        { name: 'Signed up', count: 12400 },
        { name: 'Activated', count: 6100 },
        { name: 'Subscribed', count: 2300 },
        { name: 'Paid annual', count: 940 },
      ],
    },
  },
  {
    id: 'org-roster',
    label: 'Engineering org roster',
    suitsTypes: ['org'],
    data: {
      people: [
        { name: 'Dana Ruiz', title: 'VP Engineering', reportsTo: null },
        { name: 'Sam Okafor', title: 'Dir. Platform', reportsTo: 'Dana Ruiz' },
        { name: 'Priya Nair', title: 'Dir. Product Eng', reportsTo: 'Dana Ruiz' },
        { name: 'Leo Park', title: 'EM, Infra', reportsTo: 'Sam Okafor' },
        { name: 'Mara Cohen', title: 'EM, Data', reportsTo: 'Sam Okafor' },
        { name: 'Tariq Bell', title: 'EM, Web', reportsTo: 'Priya Nair' },
        { name: 'Iris Vance', title: 'EM, Mobile', reportsTo: 'Priya Nair' },
      ],
    },
  },
  {
    id: 'project-tasks',
    label: 'Launch project tasks (timeline)',
    suitsTypes: ['gantt', 'pert'],
    data: {
      start: '2026-01-05',
      tasks: [
        { name: 'Discovery', start: '2026-01-05', durationDays: 10 },
        { name: 'Design', start: '2026-01-19', durationDays: 14 },
        { name: 'Build', start: '2026-02-02', durationDays: 28 },
        { name: 'QA', start: '2026-03-02', durationDays: 12 },
        { name: 'Launch', start: '2026-03-16', durationDays: 5 },
      ],
    },
  },
  {
    id: 'flight-routes',
    label: 'Hub flight routes (airports)',
    suitsTypes: ['map'],
    data: {
      hub: 'JFK',
      routes: [
        { from: 'JFK', to: 'LAX', label: 'daily' },
        { from: 'JFK', to: 'LHR', label: 'daily' },
        { from: 'JFK', to: 'ORD', label: 'daily' },
        { from: 'JFK', to: 'MIA', label: 'daily' },
        { from: 'JFK', to: 'SFO', label: '2x daily' },
        { from: 'JFK', to: 'CDG', label: 'daily' },
      ],
    },
  },
  {
    id: 'tech-skills',
    label: 'Team skills matrix (0–5)',
    suitsTypes: ['heatmap', 'tech-radar'],
    data: {
      scale: '0 (none) – 5 (expert)',
      people: ['Dana', 'Sam', 'Priya', 'Leo'],
      skills: ['TypeScript', 'Rust', 'SQL', 'Design', 'Ops'],
      scores: [
        [5, 2, 4, 3, 2],
        [4, 5, 3, 1, 5],
        [4, 1, 3, 5, 2],
        [3, 4, 5, 2, 4],
      ],
    },
  },
  {
    id: 'service-traffic',
    label: 'Service-to-service traffic (req/s)',
    suitsTypes: ['sankey', 'chord', 'arc'],
    data: {
      unit: 'requests/sec',
      flows: [
        { from: 'Gateway', to: 'Auth', value: 1200 },
        { from: 'Gateway', to: 'Catalog', value: 900 },
        { from: 'Gateway', to: 'Cart', value: 600 },
        { from: 'Cart', to: 'Payments', value: 320 },
        { from: 'Catalog', to: 'Search', value: 540 },
        { from: 'Auth', to: 'Users', value: 1100 },
      ],
    },
  },
  {
    id: 'energy-vs-gdp-americas',
    label: 'Energy use vs GDP per capita (Americas)',
    suitsTypes: ['scatter', 'quadrant'],
    data: {
      xUnit: 'GDP per capita (USD)',
      yUnit: 'Electricity use per capita (kWh/yr)',
      // Grouped by sub-region so each cluster can read as a bracketed
      // category; Canada / Trinidad & Tobago are deliberate outliers (high
      // energy for their GDP) for "call out the outliers" tuning.
      regions: {
        'North America': [
          { country: 'United States', gdp: 76300, energy: 12700 },
          { country: 'Canada', gdp: 53400, energy: 14400 },
          { country: 'Mexico', gdp: 11500, energy: 2300 },
        ],
        'Central America': [
          { country: 'Panama', gdp: 17900, energy: 2350 },
          { country: 'Costa Rica', gdp: 13400, energy: 2050 },
          { country: 'Guatemala', gdp: 5400, energy: 650 },
          { country: 'Honduras', gdp: 3050, energy: 900 },
        ],
        Caribbean: [
          { country: 'Trinidad & Tobago', gdp: 18400, energy: 6400 },
          { country: 'Dominican Republic', gdp: 10100, energy: 1750 },
          { country: 'Jamaica', gdp: 6050, energy: 1250 },
        ],
        'South America': [
          { country: 'Uruguay', gdp: 17000, energy: 3050 },
          { country: 'Chile', gdp: 16500, energy: 3900 },
          { country: 'Argentina', gdp: 13000, energy: 3200 },
          { country: 'Brazil', gdp: 8900, energy: 2750 },
          { country: 'Peru', gdp: 7100, energy: 1450 },
          { country: 'Colombia', gdp: 6650, energy: 1350 },
          { country: 'Paraguay', gdp: 6000, energy: 1650 },
          { country: 'Bolivia', gdp: 3600, energy: 850 },
        ],
      },
    },
  },
  {
    id: 'release-milestones',
    label: 'Product release milestones',
    suitsTypes: ['timeline'],
    data: {
      milestones: [
        { date: '2026-02', label: 'Beta opens' },
        { date: '2026-04', label: 'Public launch' },
        { date: '2026-07', label: 'Mobile app' },
        { date: '2026-10', label: 'Enterprise tier' },
        { date: '2027-01', label: 'Marketplace' },
      ],
    },
  },
  {
    id: 'checkout-sequence',
    label: 'Checkout message flow',
    suitsTypes: ['sequence'],
    data: {
      participants: ['User', 'Web App', 'Payment API', 'Bank'],
      messages: [
        { from: 'User', to: 'Web App', text: 'Place order' },
        { from: 'Web App', to: 'Payment API', text: 'Charge $42.00' },
        { from: 'Payment API', to: 'Bank', text: 'Authorize' },
        { from: 'Bank', to: 'Payment API', text: 'Approved' },
        { from: 'Payment API', to: 'Web App', text: 'Payment ok' },
        { from: 'Web App', to: 'User', text: 'Order confirmed' },
      ],
    },
  },
  {
    id: 'api-infra-traffic',
    label: 'API infrastructure traffic (req/s)',
    suitsTypes: ['infra'],
    data: {
      unit: 'requests/sec',
      nodes: ['CDN', 'Gateway', 'Auth', 'Catalog', 'Orders', 'Postgres'],
      flows: [
        { from: 'CDN', to: 'Gateway', rps: 2000 },
        { from: 'Gateway', to: 'Auth', rps: 1200 },
        { from: 'Gateway', to: 'Catalog', rps: 900 },
        { from: 'Gateway', to: 'Orders', rps: 600 },
        { from: 'Orders', to: 'Postgres', rps: 450 },
        { from: 'Catalog', to: 'Postgres', rps: 700 },
      ],
    },
  },
  {
    id: 'order-lifecycle',
    label: 'Order lifecycle (states)',
    suitsTypes: ['state'],
    data: {
      initial: 'Cart',
      states: [
        'Cart',
        'Pending Payment',
        'Paid',
        'Shipped',
        'Delivered',
        'Cancelled',
      ],
      transitions: [
        { from: 'Cart', to: 'Pending Payment', on: 'checkout' },
        { from: 'Pending Payment', to: 'Paid', on: 'payment ok' },
        { from: 'Pending Payment', to: 'Cancelled', on: 'payment failed' },
        { from: 'Paid', to: 'Shipped', on: 'fulfilled' },
        { from: 'Shipped', to: 'Delivered', on: 'received' },
        { from: 'Paid', to: 'Cancelled', on: 'refunded' },
      ],
    },
  },
  {
    id: 'payments-c4',
    label: 'Payments platform (C4)',
    suitsTypes: ['c4'],
    data: {
      system: 'Payments Platform',
      actors: ['Customer', 'Merchant'],
      containers: [
        { name: 'Web Checkout', tech: 'React' },
        { name: 'Payments API', tech: 'Node' },
        { name: 'Ledger', tech: 'Postgres' },
        { name: 'Fraud Service', tech: 'Python' },
      ],
      relationships: [
        { from: 'Customer', to: 'Web Checkout', label: 'pays via' },
        { from: 'Web Checkout', to: 'Payments API', label: 'POST charge' },
        { from: 'Payments API', to: 'Ledger', label: 'records' },
        { from: 'Payments API', to: 'Fraud Service', label: 'screens' },
        { from: 'Merchant', to: 'Payments API', label: 'reconciles' },
      ],
    },
  },
  {
    id: 'blog-schema',
    label: 'Blog database schema',
    suitsTypes: ['er', 'class'],
    data: {
      entities: [
        {
          name: 'User',
          columns: [
            { name: 'id', type: 'int', key: 'pk' },
            { name: 'email', type: 'text' },
            { name: 'name', type: 'text' },
          ],
        },
        {
          name: 'Post',
          columns: [
            { name: 'id', type: 'int', key: 'pk' },
            { name: 'author_id', type: 'int', key: 'fk' },
            { name: 'title', type: 'text' },
            { name: 'body', type: 'text' },
          ],
        },
        {
          name: 'Comment',
          columns: [
            { name: 'id', type: 'int', key: 'pk' },
            { name: 'post_id', type: 'int', key: 'fk' },
            { name: 'user_id', type: 'int', key: 'fk' },
            { name: 'body', type: 'text' },
          ],
        },
        {
          name: 'Tag',
          columns: [
            { name: 'id', type: 'int', key: 'pk' },
            { name: 'name', type: 'text' },
          ],
        },
      ],
      relationships: [
        { from: 'User', to: 'Post', kind: 'one-to-many' },
        { from: 'Post', to: 'Comment', kind: 'one-to-many' },
        { from: 'User', to: 'Comment', kind: 'one-to-many' },
        { from: 'Post', to: 'Tag', kind: 'many-to-many' },
      ],
    },
  },
  {
    id: 'sprint-board',
    label: 'Sprint board (kanban)',
    suitsTypes: ['kanban'],
    data: {
      columns: ['Backlog', 'In Progress', 'Review', 'Done'],
      cards: [
        { title: 'Login API', column: 'In Progress', assignee: 'Sam' },
        { title: 'Password reset', column: 'Backlog' },
        { title: 'Dark mode', column: 'Review', assignee: 'Priya' },
        { title: 'Onboarding flow', column: 'In Progress', assignee: 'Leo' },
        { title: 'Billing page', column: 'Done', assignee: 'Mara' },
        { title: 'Search v2', column: 'Backlog' },
      ],
    },
  },
  {
    id: 'site-structure',
    label: 'Marketing site structure',
    suitsTypes: ['sitemap'],
    data: {
      root: 'Home',
      pages: [
        { name: 'Home', parent: null },
        { name: 'Products', parent: 'Home' },
        { name: 'Product Detail', parent: 'Products' },
        { name: 'Pricing', parent: 'Home' },
        { name: 'Docs', parent: 'Home' },
        { name: 'Guides', parent: 'Docs' },
        { name: 'API Reference', parent: 'Docs' },
        { name: 'Blog', parent: 'Home' },
        { name: 'Contact', parent: 'Home' },
      ],
    },
  },
  {
    id: 'system-architecture',
    label: 'Web system architecture',
    suitsTypes: ['boxes-and-lines'],
    data: {
      boxes: [
        'Browser',
        'Load Balancer',
        'Web Server',
        'App Server',
        'Cache',
        'Database',
        'Object Store',
      ],
      links: [
        { from: 'Browser', to: 'Load Balancer' },
        { from: 'Load Balancer', to: 'Web Server' },
        { from: 'Web Server', to: 'App Server' },
        { from: 'App Server', to: 'Cache' },
        { from: 'App Server', to: 'Database' },
        { from: 'App Server', to: 'Object Store' },
      ],
    },
  },
  {
    id: 'market-share-shift',
    label: 'Market share shift (2 periods)',
    suitsTypes: ['slope'],
    data: {
      unit: '% market share',
      periods: ['2024', '2026'],
      items: [
        { name: 'Product A', from: 34, to: 41 },
        { name: 'Product B', from: 28, to: 22 },
        { name: 'Product C', from: 18, to: 24 },
        { name: 'Product D', from: 12, to: 9 },
        { name: 'Other', from: 8, to: 4 },
      ],
    },
  },
  {
    id: 'tech-mentions',
    label: 'Technology mentions (weights)',
    suitsTypes: ['wordcloud'],
    data: {
      terms: [
        { text: 'TypeScript', weight: 95 },
        { text: 'AI', weight: 88 },
        { text: 'React', weight: 80 },
        { text: 'Rust', weight: 70 },
        { text: 'Postgres', weight: 60 },
        { text: 'Docker', weight: 55 },
        { text: 'Kubernetes', weight: 52 },
        { text: 'GraphQL', weight: 40 },
        { text: 'Vite', weight: 35 },
        { text: 'Edge', weight: 33 },
        { text: 'WASM', weight: 30 },
        { text: 'Tauri', weight: 28 },
      ],
    },
  },
  {
    id: 'audience-overlap',
    label: 'Audience set overlaps',
    suitsTypes: ['venn'],
    data: {
      sets: [
        { name: 'Newsletter', size: 5200 },
        { name: 'App Users', size: 8100 },
        { name: 'Paid', size: 1900 },
      ],
      intersections: [
        { sets: ['Newsletter', 'App Users'], size: 2400 },
        { sets: ['App Users', 'Paid'], size: 1200 },
        { sets: ['Newsletter', 'Paid'], size: 800 },
        { sets: ['Newsletter', 'App Users', 'Paid'], size: 500 },
      ],
    },
  },
  {
    id: 'product-ideas',
    label: 'Product idea map',
    suitsTypes: ['mindmap'],
    data: {
      central: 'Mobile App v2',
      branches: [
        { name: 'Onboarding', children: ['Guided tour', 'Sample data', 'Checklist'] },
        { name: 'Performance', children: ['Lazy load', 'Caching', 'Smaller bundle'] },
        { name: 'Collaboration', children: ['Comments', 'Sharing', 'Presence'] },
        { name: 'Monetization', children: ['Pro tier', 'Team plan', 'Usage limits'] },
      ],
    },
  },
  {
    id: 'improvement-cycle',
    label: 'Continuous improvement cycle',
    suitsTypes: ['cycle'],
    data: {
      stages: [
        { name: 'Plan', note: 'Define goal & metric' },
        { name: 'Do', note: 'Run the experiment' },
        { name: 'Check', note: 'Measure results' },
        { name: 'Act', note: 'Adopt or adjust' },
      ],
    },
  },
  {
    id: 'onboarding-journey',
    label: 'User onboarding journey',
    suitsTypes: ['journey-map'],
    data: {
      persona: 'New user',
      sentimentScale: '1 (frustrated) – 5 (delighted)',
      stages: [
        { stage: 'Discover', action: 'Finds the app', sentiment: 3 },
        { stage: 'Sign up', action: 'Creates account', sentiment: 4 },
        { stage: 'Setup', action: 'Imports data', sentiment: 2 },
        { stage: 'First value', action: 'Builds first diagram', sentiment: 5 },
        { stage: 'Habit', action: 'Returns weekly', sentiment: 4 },
      ],
    },
  },
  {
    id: 'budget-breakdown',
    label: 'Department budget breakdown',
    suitsTypes: ['ring'],
    data: {
      unit: '% of budget',
      segments: [
        { name: 'Engineering', value: 42 },
        { name: 'Sales', value: 23 },
        { name: 'Marketing', value: 15 },
        { name: 'Support', value: 11 },
        { name: 'Operations', value: 9 },
      ],
    },
  },
  {
    id: 'raci-matrix',
    label: 'Project RACI matrix',
    suitsTypes: ['raci'],
    data: {
      legend: 'R responsible, A accountable, C consulted, I informed',
      roles: ['PM', 'Eng Lead', 'Designer', 'QA'],
      tasks: [
        { task: 'Define requirements', PM: 'A', 'Eng Lead': 'C', Designer: 'C', QA: 'I' },
        { task: 'Build feature', PM: 'I', 'Eng Lead': 'R', Designer: 'C', QA: 'I' },
        { task: 'Design UI', PM: 'C', 'Eng Lead': 'I', Designer: 'R', QA: 'I' },
        { task: 'Test release', PM: 'I', 'Eng Lead': 'C', Designer: 'I', QA: 'R' },
        { task: 'Approve launch', PM: 'A', 'Eng Lead': 'C', Designer: 'I', QA: 'C' },
      ],
    },
  },
];

// Per-chart-type starter PROMPTS — a valid, type-appropriate instruction for
// every chart type the studio knows about. Where a dataset suits the type the
// prompt says "the sample data" so the injected fixture grounds the run;
// otherwise the prompt fully specifies a small, stable structure (so A/B tip
// comparisons stay comparable without a dataset). Emitted to prompts.json,
// imported by main.ts as each type's default prompt.
const PROMPTS = {
  sequence:
    'Draw a sequence diagram of the checkout flow in the sample data — show each message between the participants in order.',
  infra:
    'Create an infrastructure diagram of the services in the sample data, showing request flow and the requests/sec on each connection.',
  flowchart:
    'Make a flowchart of a user login flow: enter credentials, validate them, prompt for a 2FA code, lock the account after 3 failed attempts, otherwise grant access.',
  state:
    'Make a state diagram of the order lifecycle in the sample data, using the listed states and transitions.',
  org: 'Make an org chart of the reporting hierarchy in the sample data.',
  c4: 'Create a C4 context diagram of the payments platform in the sample data — show the actors, the system, and their relationships. (Static renders show the context level; containers appear only in the interactive drill-down.)',
  er: 'Create an ER diagram of the blog schema in the sample data: tables, columns, and the relationships between them.',
  class:
    'Create a class diagram of the domain model in the sample data, with each class’s fields and the relationships between classes.',
  kanban:
    'Make a kanban board from the sample data, placing each card in its column.',
  sitemap: 'Create a sitemap of the site structure in the sample data.',
  gantt:
    'Make a Gantt chart of the project tasks in the sample data, with their start dates and durations.',
  pert: 'Make a PERT chart of the project tasks in the sample data, showing dependencies between tasks.',
  'boxes-and-lines':
    'Draw a boxes-and-lines architecture diagram of the components in the sample data and how they connect.',
  timeline: 'Make a timeline of the product milestones in the sample data.',
  bar: 'Make a stacked bar chart of quarterly sales by region from the sample data, with one bar per quarter split by region. (Plain bar shows one series; use bar-stacked for multiple regions.)',
  scatter:
    'Make a scatter plot of energy use vs GDP per capita from the sample data; group the points by sub-region.',
  heatmap: 'Make a heatmap of the team skills matrix in the sample data.',
  function: 'Plot the functions y = sin(x) and y = x / 2 over the range -6 to 6.',
  sankey:
    'Make a Sankey diagram of the service-to-service traffic in the sample data.',
  chord:
    'Make a chord diagram of the service-to-service traffic in the sample data.',
  funnel: 'Make a funnel chart of the signup funnel in the sample data.',
  slope:
    'Make a slope chart comparing each item’s value between the two periods in the sample data.',
  wordcloud: 'Make a word cloud from the term weights in the sample data.',
  arc: 'Make an arc diagram of the connections between services in the sample data.',
  venn: 'Make a Venn diagram of the audience sets and their overlaps in the sample data.',
  quadrant:
    'Make a quadrant chart placing each country by GDP and energy use from the sample data.',
  mindmap:
    'Make a mind map of the product ideas in the sample data, branching out from the central topic.',
  wireframe:
    'Sketch a wireframe of a mobile login screen: app logo, email and password fields, a "Sign in" button, and a "Forgot password?" link.',
  'tech-radar':
    'Make a tech radar from the sample data, placing each technology in a ring by adoption level.',
  cycle:
    'Make a cycle diagram of the continuous-improvement stages in the sample data.',
  'journey-map':
    'Make a customer journey map of the onboarding stages in the sample data, including the action and sentiment at each stage.',
  pyramid:
    'Make a pyramid chart of the funnel levels in the sample data, widest at the base.',
  ring: 'Make a ring chart of the department budget breakdown in the sample data.',
  raci: 'Make a RACI matrix from the sample data, mapping each role’s responsibility for each task.',
  map: 'Make a map of the hub flight routes in the sample data, drawing a route from the hub to each destination.',
};

mkdirSync(here, { recursive: true });

const manifest = [];
for (const { id, label, suitsTypes, data } of DATASETS) {
  writeFileSync(
    path.join(here, `${id}.json`),
    JSON.stringify({ id, label, suitsTypes, data }, null, 2) + '\n'
  );
  manifest.push({ id, label, suitsTypes });
}
writeFileSync(
  path.join(here, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

// Per-type starter prompts → ../prompts.json (sibling to registry.json so
// main.ts can static-import it). Sorted for stable diffs.
const sortedPrompts = Object.fromEntries(
  Object.keys(PROMPTS)
    .sort()
    .map((k) => [k, PROMPTS[k]])
);
writeFileSync(
  path.join(here, '..', 'prompts.json'),
  JSON.stringify(sortedPrompts, null, 2) + '\n'
);

console.log(
  `[datasets] wrote ${manifest.length} datasets + manifest; ${Object.keys(PROMPTS).length} prompts → prompts.json`
);
console.log(
  `[studio] wrote ${DATASETS.length} dataset fixtures + manifest.json`
);
