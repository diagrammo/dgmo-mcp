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
    suitsTypes: ['funnel', 'pie'],
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
    suitsTypes: ['gantt'],
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
    suitsTypes: ['sankey', 'chord'],
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
];

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
console.log(
  `[studio] wrote ${DATASETS.length} dataset fixtures + manifest.json`
);
