// Theme-aware utility classes and helpers
export const getThemeClasses = (isDark: boolean = true) => {
  return {
    // Backgrounds
    bgPrimary: 'bg-[var(--color-background)]',
    bgSurface: 'bg-[var(--color-surface)]',
    bgSurfaceHover: 'hover:bg-[var(--color-surface)]',
    
    // Text
    textPrimary: 'text-[var(--color-text)]',
    textSecondary: 'text-[var(--color-text-secondary)]',
    
    // Borders
    borderPrimary: 'border-[var(--color-border)]',
    
    // Theme-aware gradients
    bgGradient: isDark 
      ? 'bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900'
      : 'bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50',
    
    // Cards
    card: 'bg-[var(--color-surface)]/50 backdrop-blur-lg border border-[var(--color-border)]',
    cardHover: 'hover:border-[var(--color-primary)]/50',
    
    // Buttons
    btnPrimary: 'bg-[var(--color-primary)]/20 hover:bg-[var(--color-primary)]/30 text-[var(--color-primary)]',
    btnSecondary: 'bg-[var(--color-secondary)]/20 hover:bg-[var(--color-secondary)]/30 text-[var(--color-secondary)]',
  };
};

export const getThemeStyles = (theme: any) => ({
  background: theme?.colors?.background || '#000000',
  color: theme?.colors?.text || '#ffffff',
  borderColor: theme?.colors?.border || '#374151',
});

export const getCardStyle = (theme: any) => ({
  backgroundColor: `${theme?.colors?.surface || '#1f2937'}80`,
  borderColor: theme?.colors?.border || '#374151',
  color: theme?.colors?.text || '#ffffff',
});

export const getButtonStyle = (theme: any, variant: 'primary' | 'secondary' | 'accent' = 'primary') => {
  const colorMap = {
    primary: theme?.colors?.primary || '#3b82f6',
    secondary: theme?.colors?.secondary || '#1e40af',
    accent: theme?.colors?.accent || '#60a5fa',
  };
  
  const color = colorMap[variant];
  
  return {
    backgroundColor: `${color}20`,
    color: color,
    borderColor: `${color}40`,
  };
};
