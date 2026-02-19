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
    id: 'ocean',
    label: 'Ocean',
    description: 'Blue-teal accents with calm contrast.',
    accent: '#2fa7d9',
    accent2: '#5cc3ed',
  },
  {
    id: 'citrus',
    label: 'Citrus',
    description: 'Warm amber accent with energetic highlights.',
    accent: '#d38a24',
    accent2: '#ebb348',
  },
  {
    id: 'rose',
    label: 'Rose',
    description: 'Dark surface with rose-magenta accent.',
    accent: '#ef6da8',
    accent2: '#f58abc',
  },
  {
    id: 'mono',
    label: 'Mono',
    description: 'Minimal neutral palette with subtle steel accents.',
    accent: '#7d93b3',
    accent2: '#98abca',
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
];

export const DEFAULT_THEME_SCHEME = 'midnight';

const THEME_SCHEME_IDS = new Set(THEME_SCHEMES.map((scheme) => scheme.id));

export function normalizeThemeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'light' || mode === 'dark' || mode === 'system') return mode;
  return 'system';
}

export function normalizeThemeScheme(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    slate: 'mono',
    nord: 'ocean',
    ember: 'citrus',
    sand: 'citrus',
  };
  const scheme = aliases[raw] || raw;
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
