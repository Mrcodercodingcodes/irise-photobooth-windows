/**
 * Modular Theme & Skin Manager
 * Handles hot-swapping CSS skins dynamically via stylesheet links and tokens.
 */

export const THEME_REGISTRY = [
  { id: 'fox-flame', name: 'Fox & Flame (Optical Lab Amber + Ivory)', file: '/css/themes/fox-flame.css' },
  { id: 'fire-orange', name: 'Fire Orange (Energy)', file: '/css/themes/fire-orange.css' },
  { id: 'classroom', name: 'Classroom (Retro School)', file: '/css/themes/classroom.css' },
  { id: 'liquid-glass', name: 'Liquid Glass (Luxury Dark)', file: '/css/themes/liquid-glass.css' },
  { id: 'modern-minimal', name: 'Modern Minimal (Studio)', file: '/css/themes/modern-minimal.css' }
];

const STORAGE_KEY = 'irise_active_theme';
const LINK_ID = 'theme-skin-link';

class ThemeManager {
  constructor() {
    this.activeTheme = localStorage.getItem(STORAGE_KEY) || 'fox-flame';
    this.listeners = new Set();
    this.init();
  }

  init() {
    this.applyTheme(this.activeTheme, false);
  }

  getThemes() {
    return [...THEME_REGISTRY];
  }

  getCurrentTheme() {
    return this.activeTheme;
  }

  applyTheme(themeId, persist = true) {
    const theme = THEME_REGISTRY.find(t => t.id === themeId) || THEME_REGISTRY[0];
    let link = document.getElementById(LINK_ID);

    if (!link) {
      link = document.createElement('link');
      link.id = LINK_ID;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }

    link.href = theme.file;
    document.documentElement.setAttribute('data-theme', theme.id);
    this.activeTheme = theme.id;

    if (persist) {
      localStorage.setItem(STORAGE_KEY, theme.id);
    }

    this.notify();
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    for (const cb of this.listeners) {
      try {
        cb(this.activeTheme);
      } catch (e) {
        console.error('Error in theme listener:', e);
      }
    }
  }
}

export const themeManager = new ThemeManager();
