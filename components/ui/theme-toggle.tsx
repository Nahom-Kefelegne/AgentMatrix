'use client';

import { useThemeContext } from '@/app/components/ThemeProvider';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useThemeContext();
  return (
    <button className={`glass-btn glass-btn--icon ${className || ''}`}
      onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      {theme === 'dark' ? '☀' : '☽'}
    </button>
  );
}
