import React, { useState } from 'react';
import { Palette, X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const ThemeSelector: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { currentTheme, setTheme, theme } = useTheme();

  const themeList = [
    { id: 'light', color: '#3b82f6', name: 'Light' },
    { id: 'dark', color: '#3b82f6', name: 'Dark' },
    { id: 'cupcake', color: '#65c3c8', name: 'Cupcake' },
    { id: 'bumblebee', color: '#f9d72f', name: 'Bumblebee' },
    { id: 'emerald', color: '#66cc8a', name: 'Emerald' },
    { id: 'corporate', color: '#4b6bfb', name: 'Corporate' },
    { id: 'synthwave', color: '#e779c1', name: 'Synthwave' },
    { id: 'retro', color: '#ef9995', name: 'Retro' },
    { id: 'cyberpunk', color: '#ff7598', name: 'Cyberpunk' },
    { id: 'valentine', color: '#e96d7b', name: 'Valentine' },
    { id: 'halloween', color: '#f28c18', name: 'Halloween' },
    { id: 'garden', color: '#e779c1', name: 'Garden' },
    { id: 'forest', color: '#1eb854', name: 'Forest' },
    { id: 'aqua', color: '#09ecf3', name: 'Aqua' },
    { id: 'lofi', color: '#0d0d0d', name: 'Lofi' },
    { id: 'pastel', color: '#d1c1d7', name: 'Pastel' },
    { id: 'fantasy', color: '#6e0b75', name: 'Fantasy' },
    { id: 'wireframe', color: '#b8b8b8', name: 'Wireframe' },
    { id: 'dracula', color: '#ff79c6', name: 'Dracula' },
    { id: 'cmyk', color: '#179299', name: 'CMYK' },
    { id: 'autumn', color: '#8c0327', name: 'Autumn' },
    { id: 'business', color: '#1c4e80', name: 'Business' },
    { id: 'acid', color: '#ff00ff', name: 'Acid' },
    { id: 'lemonade', color: '#519903', name: 'Lemonade' },
    { id: 'night', color: '#38bdf8', name: 'Night' },
    { id: 'coffee', color: '#db924b', name: 'Coffee' },
    { id: 'winter', color: '#047aed', name: 'Winter' },
  ];

  const handleThemeSelect = (themeId: string) => {
    setTheme(themeId);
    setIsOpen(false);
  };

  return (
    <>
      {/* Theme Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="cursor-target flex items-center space-x-2 px-4 py-2 rounded-lg transition"
        style={{
          backgroundColor: `${theme.colors.primary}20`,
          color: theme.colors.primary,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = `${theme.colors.primary}30`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = `${theme.colors.primary}20`;
        }}
        title="Change Theme"
      >
        <Palette className="w-5 h-5" />
        <span className="hidden sm:inline">Theme</span>
      </button>

      {/* Theme Selector Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[100000] flex items-start justify-end p-4 pointer-events-none">
          {/* Backdrop - Lighter and allows interaction */}
          <div 
            className="absolute inset-0 bg-black/20 backdrop-blur-[2px] pointer-events-auto"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Modal Content - Compact Design, Positioned Top-Right */}
          <div 
            className="relative rounded-xl p-4 w-80 max-h-[70vh] overflow-y-auto shadow-xl border mt-16 pointer-events-auto"
            style={{
              backgroundColor: theme.colors.surface,
              borderColor: `${theme.colors.border}80`,
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold" style={{ color: theme.colors.text }}>
                Choose Theme
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="cursor-target p-1 rounded-lg transition"
                style={{ color: theme.colors.textSecondary }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = `${theme.colors.surface}80`;
                  e.currentTarget.style.color = theme.colors.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = theme.colors.textSecondary;
                }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Theme Grid - 2 Columns Layout */}
            <div className="grid grid-cols-2 gap-2">
              {themeList.map((themeItem) => (
                <button
                  key={themeItem.id}
                  onClick={() => handleThemeSelect(themeItem.id)}
                  className={`cursor-target flex items-center gap-2 p-2 rounded-lg transition-all duration-200`}
                  style={{
                    backgroundColor: currentTheme === themeItem.id ? `${theme.colors.primary}15` : 'transparent',
                    border: currentTheme === themeItem.id ? `2px solid ${theme.colors.primary}` : `1px solid ${theme.colors.border}40`,
                  }}
                  onMouseEnter={(e) => {
                    if (currentTheme !== themeItem.id) {
                      e.currentTarget.style.backgroundColor = `${theme.colors.surface}60`;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentTheme !== themeItem.id) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  {/* Color Circle - Smaller */}
                  <div
                    className="w-6 h-6 rounded-full flex-shrink-0 border"
                    style={{
                      backgroundColor: themeItem.color,
                      borderColor: currentTheme === themeItem.id ? theme.colors.border : `${theme.colors.border}20`,
                    }}
                  />

                  {/* Theme Name - Smaller Text */}
                  <span 
                    className="text-xs font-medium truncate"
                    style={{
                      color: currentTheme === themeItem.id ? theme.colors.text : theme.colors.textSecondary,
                    }}
                  >
                    {themeItem.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ThemeSelector;
