export const SPEC_SECTIONS = [
  {
    key: 'problem_goal',
    title: 'Problem / Goal',
    heading: 'Problem / Goal',
    hint: 'What user problem are we solving, and what does success look like?',
    required: true,
    placeholder: '- Users need...\n- Success means...',
  },
  {
    key: 'target_platform',
    title: 'Target Platform',
    heading: 'Target Platform',
    hint: 'Where this will run (web, desktop, mobile) and any platform constraints.',
    required: true,
    placeholder: '- Web app (desktop-first)\n- Works on Chrome + Edge',
  },
  {
    key: 'core_loop',
    title: 'Core Loop',
    heading: 'Core Loop',
    hint: 'Describe the repeatable flow users perform most often.',
    required: true,
    placeholder: '- User does X\n- System responds with Y\n- User repeats...',
  },
  {
    key: 'features',
    title: 'Features (Must / Should / Could)',
    heading: 'Features',
    hint: 'Prioritize features clearly so implementation order is obvious.',
    required: true,
    placeholder: '### Must\n- ...\n\n### Should\n- ...\n\n### Could\n- ...',
  },
  {
    key: 'non_goals',
    title: 'Non-Goals',
    heading: 'Non-Goals',
    hint: 'Explicitly list what this build will not cover.',
    required: true,
    placeholder: '- Not building...\n- Out of scope...',
  },
  {
    key: 'ux_notes',
    title: 'UX Notes',
    heading: 'UX Notes',
    hint: 'List screens, key interactions, and major UI behavior.',
    required: true,
    placeholder: '- Home: ...\n- Workspace: ...\n- Key interaction: ...',
  },
  {
    key: 'data_state_model',
    title: 'Data / State Model',
    heading: 'Data/State Model',
    hint: 'Capture core entities, state transitions, and data relationships.',
    required: true,
    placeholder: '- Entity: User\n- State: Draft -> Approved\n- Data source: ...',
  },
  {
    key: 'acceptance_criteria',
    title: 'Acceptance Criteria',
    heading: 'Acceptance Criteria',
    hint: 'Write testable outcomes that prove this build is complete.',
    required: true,
    placeholder: '- [ ] User can...\n- [ ] System verifies...\n- [ ] No regressions in...',
  },
  {
    key: 'risks_unknowns',
    title: 'Risks + Unknowns',
    heading: 'Risks + Unknowns',
    hint: 'Call out uncertainties and risk mitigation steps.',
    required: true,
    placeholder: '- Risk: ... -> Mitigation: ...\n- Unknown: ...',
  },
];

const SECTION_ALIASES = {
  problemgoal: 'problem_goal',
  problemgoals: 'problem_goal',
  targetplatform: 'target_platform',
  platform: 'target_platform',
  coreloop: 'core_loop',
  loop: 'core_loop',
  features: 'features',
  mustshouldcould: 'features',
  nongoals: 'non_goals',
  nongoalsoutofscope: 'non_goals',
  uxnotes: 'ux_notes',
  screensandinteractions: 'ux_notes',
  datastatemodel: 'data_state_model',
  datamodel: 'data_state_model',
  statemodel: 'data_state_model',
  acceptancecriteria: 'acceptance_criteria',
  criteria: 'acceptance_criteria',
  risksunknowns: 'risks_unknowns',
  risksandunknowns: 'risks_unknowns',
};

const REQUIRED_KEYS = SPEC_SECTIONS.filter((section) => section.required).map((section) => section.key);

function normalizeHeading(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

export function createEmptySections() {
  const next = {};
  SPEC_SECTIONS.forEach((section) => {
    next[section.key] = '';
  });
  return next;
}

export function parseSpecMarkdown(specMd) {
  const base = createEmptySections();
  const text = String(specMd || '');
  if (!text.trim()) {
    return base;
  }

  const lines = text.split(/\r?\n/);
  let currentKey = null;
  let sawSection = false;

  lines.forEach((line) => {
    const headingMatch = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (headingMatch) {
      const normalized = normalizeHeading(headingMatch[1]);
      const resolved = SECTION_ALIASES[normalized] || null;
      if (resolved) {
        currentKey = resolved;
        sawSection = true;
        return;
      }
      currentKey = null;
      return;
    }

    if (currentKey) {
      base[currentKey] = `${base[currentKey]}${base[currentKey] ? '\n' : ''}${line}`;
    }
  });

  if (!sawSection) {
    base.problem_goal = text.trim();
  }

  Object.keys(base).forEach((key) => {
    base[key] = String(base[key] || '').trim();
  });

  return base;
}

export function buildSpecMarkdown(sections) {
  const source = sections || {};
  const chunks = ['# Build Spec'];

  SPEC_SECTIONS.forEach((section) => {
    chunks.push(`\n## ${section.heading}`);
    const value = String(source[section.key] || '').trim();
    chunks.push(value || '- [ ] TBD');
  });

  return `${chunks.join('\n').trim()}\n`;
}

export function computeCompleteness(sections) {
  const source = sections || {};
  const missing = REQUIRED_KEYS.filter((key) => !String(source[key] || '').trim());
  const completed = REQUIRED_KEYS.length - missing.length;
  const percent = REQUIRED_KEYS.length > 0
    ? Math.round((completed / REQUIRED_KEYS.length) * 100)
    : 100;
  return {
    totalRequired: REQUIRED_KEYS.length,
    completed,
    missing,
    percent,
  };
}

export function listChangedSections(beforeSections, afterSections) {
  const before = beforeSections || createEmptySections();
  const after = afterSections || createEmptySections();
  return SPEC_SECTIONS
    .filter((section) => {
      const prev = String(before[section.key] || '').trim();
      const next = String(after[section.key] || '').trim();
      return prev !== next;
    })
    .map((section) => section.key);
}

export function summarizeTextDiff(a, b) {
  const aLines = String(a || '').split(/\r?\n/);
  const bLines = String(b || '').split(/\r?\n/);
  const aSet = new Set(aLines.map((line) => line.trim()).filter(Boolean));
  const bSet = new Set(bLines.map((line) => line.trim()).filter(Boolean));

  let removed = 0;
  let added = 0;
  aSet.forEach((line) => {
    if (!bSet.has(line)) removed += 1;
  });
  bSet.forEach((line) => {
    if (!aSet.has(line)) added += 1;
  });

  return { added, removed };
}

export function sectionByKey(key) {
  return SPEC_SECTIONS.find((section) => section.key === key) || null;
}
