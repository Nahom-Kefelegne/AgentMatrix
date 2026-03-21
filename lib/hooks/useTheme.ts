'use client';

import { useState, useEffect, useCallback } from 'react';

export type Theme = 'light' | 'dark';

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const stored = localStorage.getItem('agent-matrix-theme') as Theme | null;
    const initial = stored || 'dark';
    setThemeState(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem('agent-matrix-theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
