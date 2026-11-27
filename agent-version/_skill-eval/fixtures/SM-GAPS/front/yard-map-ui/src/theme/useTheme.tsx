import React, { createContext, useContext, useState } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'yard-theme';
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children, forced }: { children: React.ReactNode; forced?: Theme }) {
  const [theme, setTheme] = useState<Theme>(forced ?? ((localStorage.getItem(KEY) as Theme) || 'light'));
  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem(KEY, next);
    setTheme(next);
  };
  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
