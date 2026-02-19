export const THEME_MODE_KEY = 'ai-office:themeMode';
export const THEME_SCHEME_KEY = 'ai-office:colorScheme';
export const LEGACY_THEME_MODE_KEY = 'ai-office-theme-mode';
export const LEGACY_THEME_SCHEME_KEY = 'ai-office:themeScheme';
export const LEGACY_THEME_KEY = 'ai-office-theme';

export const THEME_SCHEMES = [
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Deep navy with cool blue accent.',
    accent: '#5f8dff',
    accent2: '#84a9ff',
  },
  {
    id: 'slate',
    label: 'Slate',
    description: 'Neutral slate with teal accent.',
    accent: '#38b8b2',
    accent2: '#5cc8c2',
  },
  {
    id: 'nord',
    label: 'Nord',
    description: 'Icy blue-gray with frosty highlights.',
    accent: '#82b4ff',
    accent2: '#9fc5ff',
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Charcoal base with warm orange accent.',
    accent: '#ff8c4c',
    accent2: '#ffab73',
  },
  {
    id: 'forest',
    label: 'Forest',
    description: 'Dark green atmosphere with mint accent.',
    accent: '#3fbf88',
    accent2: '#68d7a3',
  },
  {
    id: 'violet',
    label: 'Violet',
    description: 'Near-black tone with purple accent.',
    accent: '#9f7cff',
    accent2: '#bc9fff',
  },
  {
    id: 'rose',
    label: 'Rose',
    description: 'Dark surface with rose-magenta accent.',
    accent: '#ef6da8',
    accent2: '#f58abc',
  },
  {
    id: 'sand',
    label: 'Sand',
    description: 'Warm neutral with amber accent.',
    accent: '#c8872f',
    accent2: '#dca14d',
  },
];

export const DEFAULT_THEME_SCHEME = 'midnight';

const THEME_SCHEME_IDS = new Set(THEME_SCHEMES.map((scheme) => scheme.id));

export function normalizeThemeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'light' || mode === 'dark' || mode === 'system') return mode;
  return 'system';
}

export function normalizeThemeScheme(value) {
  const scheme = String(value || '').trim().toLowerCase();
  if (THEME_SCHEME_IDS.has(scheme)) return scheme;
  return DEFAULT_THEME_SCHEME;
}

export function resolveTheme(mode, prefersLight) {
  const normalized = normalizeThemeMode(mode);
  if (normalized === 'system') {
    return prefersLight ? 'light' : 'dark';
  }
  return normalized;
}

export function nextThemeScheme(currentId) {
  const normalized = normalizeThemeScheme(currentId);
  const index = THEME_SCHEMES.findIndex((item) => item.id === normalized);
  const safeIndex = index >= 0 ? index : 0;
  const nextIndex = (safeIndex + 1) % THEME_SCHEMES.length;
  return THEME_SCHEMES[nextIndex].id;
}

export function getThemeSchemeMeta(id) {
  const normalized = normalizeThemeScheme(id);
  return THEME_SCHEMES.find((item) => item.id === normalized) || THEME_SCHEMES[0];
}
