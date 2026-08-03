import { useEffect } from 'react';

import { useThemeStore } from './stores/theme-store';

export function ThemeSynchronizer() {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mediaQuery.matches);
      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);
    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [theme]);

  return null;
}
