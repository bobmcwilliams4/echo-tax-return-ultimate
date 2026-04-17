'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface ThemeContextType {
  isDark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextType>({ isDark: true, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('ept-theme');
    if (saved) {
      setIsDark(saved === 'dark');
    } else {
      const hour = new Date().getHours();
      setIsDark(hour >= 18 || hour < 6);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('ept-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ isDark, toggle: () => setIsDark(!isDark) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
