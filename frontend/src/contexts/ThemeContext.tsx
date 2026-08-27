import React, { createContext, useContext, useState, useEffect } from 'react';

export interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    orbHue: number;
  };
}

export const themes: Record<string, Theme> = {
  light: {
    name: 'Light',
    colors: {
      primary: '#3b82f6',
      secondary: '#60a5fa',
      accent: '#2563eb',
      background: '#ffffff',
      surface: '#f3f4f6',
      text: '#1f2937',
      textSecondary: '#6b7280',
      border: '#e5e7eb',
      orbHue: 220,
    },
  },
  dark: {
    name: 'Dark',
    colors: {
      primary: '#60a5fa',
      secondary: '#3b82f6',
      accent: '#93c5fd',
      background: '#0f172a',
      surface: '#1e293b',
      text: '#f1f5f9',
      textSecondary: '#cbd5e1',
      border: '#334155',
      orbHue: 220,
    },
  },
  cupcake: {
    name: 'Cupcake',
    colors: {
      primary: '#65c3c8',
      secondary: '#ef9fbc',
      accent: '#eeaf3a',
      background: '#faf7f5',
      surface: '#e0f2fe',
      text: '#291334',
      textSecondary: '#6b7280',
      border: '#bae6fd',
      orbHue: 180,
    },
  },
  bumblebee: {
    name: 'Bumblebee',
    colors: {
      primary: '#f9d72f',
      secondary: '#df7e07',
      accent: '#181830',
      background: '#ffffff',
      surface: '#fef3c7',
      text: '#181830',
      textSecondary: '#78716c',
      border: '#fde68a',
      orbHue: 48,
    },
  },
  emerald: {
    name: 'Emerald',
    colors: {
      primary: '#66cc8a',
      secondary: '#377cfb',
      accent: '#ea5234',
      background: '#ffffff',
      surface: '#ecfdf5',
      text: '#1f2937',
      textSecondary: '#6b7280',
      border: '#a7f3d0',
      orbHue: 150,
    },
  },
  corporate: {
    name: 'Corporate',
    colors: {
      primary: '#4b6bfb',
      secondary: '#7b92b2',
      accent: '#67cba0',
      background: '#ffffff',
      surface: '#eff3f4',
      text: '#181a2a',
      textSecondary: '#6b7280',
      border: '#cbd5e1',
      orbHue: 220,
    },
  },
  synthwave: {
    name: 'Synthwave',
    colors: {
      primary: '#e779c1',
      secondary: '#58c7f3',
      accent: '#f9c630',
      background: '#1a103d',
      surface: '#251a3e',
      text: '#f9fafb',
      textSecondary: '#b4a5d8',
      border: '#493c7d',
      orbHue: 320,
    },
  },
  retro: {
    name: 'Retro',
    colors: {
      primary: '#ef9995',
      secondary: '#a4cbb4',
      accent: '#ebdc99',
      background: '#e4d8b4',
      surface: '#f3f0e0',
      text: '#282425',
      textSecondary: '#6b5c58',
      border: '#d2b48c',
      orbHue: 8,
    },
  },
  cyberpunk: {
    name: 'Cyberpunk',
    colors: {
      primary: '#ff7598',
      secondary: '#75d1f0',
      accent: '#ffff00',
      background: '#0e0f0f',
      surface: '#1a1a1e',
      text: '#f9fafb',
      textSecondary: '#9ca3af',
      border: '#ff7598',
      orbHue: 340,
    },
  },
  valentine: {
    name: 'Valentine',
    colors: {
      primary: '#e96d7b',
      secondary: '#a991f7',
      accent: '#88dbdd',
      background: '#fffbf5',
      surface: '#fce7f3',
      text: '#632c3b',
      textSecondary: '#9f1239',
      border: '#f9a8d4',
      orbHue: 350,
    },
  },
  halloween: {
    name: 'Halloween',
    colors: {
      primary: '#f28c18',
      secondary: '#6d3a9c',
      accent: '#51a800',
      background: '#1f1f1f',
      surface: '#2a2a2a',
      text: '#f9fafb',
      textSecondary: '#9ca3af',
      border: '#f28c18',
      orbHue: 30,
    },
  },
  garden: {
    name: 'Garden',
    colors: {
      primary: '#e779c1',
      secondary: '#5c7f67',
      accent: '#c084fc',
      background: '#eff1f3',
      surface: '#f0f8f0',
      text: '#1f2937',
      textSecondary: '#6b7280',
      border: '#9ca3af',
      orbHue: 320,
    },
  },
  forest: {
    name: 'Forest',
    colors: {
      primary: '#1eb854',
      secondary: '#1db88e',
      accent: '#1db8ab',
      background: '#171212',
      surface: '#1f2020',
      text: '#f9fafb',
      textSecondary: '#9ca3af',
      border: '#1eb854',
      orbHue: 150,
    },
  },
  aqua: {
    name: 'Aqua',
    colors: {
      primary: '#09ecf3',
      secondary: '#966fb3',
      accent: '#ffe999',
      background: '#2e3842',
      surface: '#3d4e5c',
      text: '#f9fafb',
      textSecondary: '#9ca3af',
      border: '#09ecf3',
      orbHue: 183,
    },
  },
  lofi: {
    name: 'Lofi',
    colors: {
      primary: '#0d0d0d',
      secondary: '#1a1919',
      accent: '#262626',
      background: '#f0f0f0',
      surface: '#e5e5e5',
      text: '#0d0d0d',
      textSecondary: '#4d4d4d',
      border: '#b3b3b3',
      orbHue: 0,
    },
  },
  pastel: {
    name: 'Pastel',
    colors: {
      primary: '#d1c1d7',
      secondary: '#f9dcc4',
      accent: '#fbe7c6',
      background: '#ffffff',
      surface: '#fef4f7',
      text: '#291334',
      textSecondary: '#6b7280',
      border: '#e9d5ff',
      orbHue: 280,
    },
  },
  fantasy: {
    name: 'Fantasy',
    colors: {
      primary: '#6e0b75',
      secondary: '#007ebd',
      accent: '#f471b5',
      background: '#1a103d',
      surface: '#2d1b4e',
      text: '#f9fafb',
      textSecondary: '#c4b5fd',
      border: '#6e0b75',
      orbHue: 300,
    },
  },
  wireframe: {
    name: 'Wireframe',
    colors: {
      primary: '#b8b8b8',
      secondary: '#d4d4d4',
      accent: '#1e1e1e',
      background: '#ffffff',
      surface: '#f5f5f5',
      text: '#1e1e1e',
      textSecondary: '#737373',
      border: '#d4d4d4',
      orbHue: 0,
    },
  },
  dracula: {
    name: 'Dracula',
    colors: {
      primary: '#ff79c6',
      secondary: '#bd93f9',
      accent: '#ffb86c',
      background: '#282a36',
      surface: '#343746',
      text: '#f8f8f2',
      textSecondary: '#6272a4',
      border: '#44475a',
      orbHue: 330,
    },
  },
  cmyk: {
    name: 'CMYK',
    colors: {
      primary: '#179299',
      secondary: '#e779c1',
      accent: '#f9c630',
      background: '#ffffff',
      surface: '#f9fafb',
      text: '#1f2937',
      textSecondary: '#6b7280',
      border: '#d1d5db',
      orbHue: 184,
    },
  },
  autumn: {
    name: 'Autumn',
    colors: {
      primary: '#8c0327',
      secondary: '#d85251',
      accent: '#f9c630',
      background: '#f9fafb',
      surface: '#fef3c7',
      text: '#1f2937',
      textSecondary: '#78716c',
      border: '#d1d5db',
      orbHue: 348,
    },
  },
  business: {
    name: 'Business',
    colors: {
      primary: '#1c4e80',
      secondary: '#7c909a',
      accent: '#ea6947',
      background: '#ffffff',
      surface: '#f3f4f6',
      text: '#1f2937',
      textSecondary: '#6b7280',
      border: '#e5e7eb',
      orbHue: 210,
    },
  },
  acid: {
    name: 'Acid',
    colors: {
      primary: '#ff00ff',
      secondary: '#ff7700',
      accent: '#ffff00',
      background: '#000000',
      surface: '#1a1a1a',
      text: '#f9fafb',
      textSecondary: '#9ca3af',
      border: '#ff00ff',
      orbHue: 300,
    },
  },
  lemonade: {
    name: 'Lemonade',
    colors: {
      primary: '#519903',
      secondary: '#c4d82e',
      accent: '#e9e92e',
      background: '#ffffff',
      surface: '#f9fafb',
      text: '#1f2937',
      textSecondary: '#6b7280',
      border: '#d1d5db',
      orbHue: 75,
    },
  },
  night: {
    name: 'Night',
    colors: {
      primary: '#38bdf8',
      secondary: '#818cf8',
      accent: '#f471b5',
      background: '#0f172a',
      surface: '#1e293b',
      text: '#f1f5f9',
      textSecondary: '#94a3b8',
      border: '#334155',
      orbHue: 200,
    },
  },
  coffee: {
    name: 'Coffee',
    colors: {
      primary: '#db924b',
      secondary: '#6f4a3c',
      accent: '#efe0ce',
      background: '#1b1410',
      surface: '#2a2420',
      text: '#f9fafb',
      textSecondary: '#a8a29e',
      border: '#44403c',
      orbHue: 30,
    },
  },
  winter: {
    name: 'Winter',
    colors: {
      primary: '#047aed',
      secondary: '#2563eb',
      accent: '#60a5fa',
      background: '#ffffff',
      surface: '#f0f9ff',
      text: '#1e293b',
      textSecondary: '#64748b',
      border: '#cbd5e1',
      orbHue: 210,
    },
  },
};

interface ThemeContextType {
  currentTheme: string;
  theme: Theme;
  setTheme: (themeName: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState(() => {
    return localStorage.getItem('selectedTheme') || 'dark';
  });

  const theme = themes[currentTheme] || themes.dark;

  useEffect(() => {
    // Apply theme colors to CSS variables
    const root = document.documentElement;
    root.style.setProperty('--color-primary', theme.colors.primary);
    root.style.setProperty('--color-secondary', theme.colors.secondary);
    root.style.setProperty('--color-accent', theme.colors.accent);
    root.style.setProperty('--color-background', theme.colors.background);
    root.style.setProperty('--color-surface', theme.colors.surface);
    root.style.setProperty('--color-text', theme.colors.text);
    root.style.setProperty('--color-text-secondary', theme.colors.textSecondary);
    root.style.setProperty('--color-border', theme.colors.border);
    root.style.setProperty('--orb-hue', theme.colors.orbHue.toString());
  }, [theme]);

  const setTheme = (themeName: string) => {
    setCurrentTheme(themeName);
    localStorage.setItem('selectedTheme', themeName);
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};
