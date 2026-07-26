const THEME_STORAGE_KEY = 'aura-theme'

export function getPreferredTheme() {
  if (typeof window === 'undefined') return 'dark'

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
  } catch {
    // Some privacy modes block storage; the system preference is still usable.
  }

  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function saveTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The active session still changes theme when persistence is unavailable.
  }
}