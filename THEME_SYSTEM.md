# Theme System Documentation

## Overview
CodeTrackr now features a comprehensive theme system with **27 unique themes** that users can choose from. The theme selection persists across sessions using localStorage.

## Features

### Available Themes
1. **Light** - Clean and bright theme
2. **Dark** - Default dark theme
3. **Cupcake** - Soft pastel colors
4. **Bumblebee** - Vibrant yellow and orange
5. **Emerald** - Fresh green tones
6. **Corporate** - Professional blue
7. **Synthwave** - Retro neon colors
8. **Retro** - Vintage aesthetic
9. **Cyberpunk** - Futuristic pink and cyan
10. **Valentine** - Romantic pink tones
11. **Halloween** - Spooky orange and purple
12. **Garden** - Natural green and pink
13. **Forest** - Deep green theme
14. **Aqua** - Cool cyan and teal
15. **Lofi** - Minimalist grayscale
16. **Pastel** - Soft dreamy colors
17. **Fantasy** - Magical purple tones
18. **Wireframe** - Clean monochrome
19. **Dracula** - Popular dark theme
20. **CMYK** - Print-inspired colors
21. **Autumn** - Warm fall colors
22. **Business** - Professional navy
23. **Acid** - High contrast neon
24. **Lemonade** - Fresh lime and yellow
25. **Night** - Deep blue night theme
26. **Coffee** - Warm brown tones
27. **Winter** - Cool blue ice theme

## How It Works

### Theme Context (`ThemeContext.tsx`)
- Manages the current theme state
- Stores theme preference in localStorage
- Provides theme colors to all components
- Dynamically updates CSS variables

### Theme Selector Component (`ThemeSelector.tsx`)
- Beautiful modal interface with grid layout
- Color preview circles for each theme
- Smooth animations and hover effects
- Selected theme indicator
- Responsive design

### Integration
The theme system is integrated at the highest level:
1. `main.tsx` - App wrapped in `ThemeProvider`
2. `App.tsx` - Theme button in navigation bar
3. `index.css` - CSS variables for theme colors
4. `Orb.tsx` - Dynamic background hue based on theme

## Usage

### For Users
1. Click the **"Theme"** button in the navigation bar (purple palette icon)
2. Browse through the 27 available themes
3. Click on any theme to apply it instantly
4. The selection is automatically saved

### For Developers

#### Accessing Theme in Components
```tsx
import { useTheme } from '../contexts/ThemeContext';

function MyComponent() {
  const { currentTheme, theme, setTheme } = useTheme();
  
  // Access theme colors
  const primaryColor = theme.colors.primary;
  const backgroundColor = theme.colors.background;
  
  return <div>Current theme: {currentTheme}</div>;
}
```

#### Using CSS Variables
```css
.my-element {
  background-color: var(--color-background);
  color: var(--color-text);
  border-color: var(--color-border);
}
```

#### Available CSS Variables
- `--color-primary` - Primary brand color
- `--color-secondary` - Secondary accent
- `--color-accent` - Highlight color
- `--color-background` - Page background
- `--color-surface` - Card/panel backgrounds
- `--color-text` - Primary text color
- `--color-text-secondary` - Secondary text
- `--color-border` - Border colors
- `--orb-hue` - WebGL orb color hue

## Theme Structure

Each theme contains:
```typescript
{
  name: string;           // Display name
  colors: {
    primary: string;      // Main brand color
    secondary: string;    // Secondary color
    accent: string;       // Accent highlights
    background: string;   // Page background
    surface: string;      // Cards/panels
    text: string;         // Primary text
    textSecondary: string; // Secondary text
    border: string;       // Borders
    orbHue: number;       // 0-360 for background orb
  }
}
```

## Adding New Themes

To add a new theme, edit `ThemeContext.tsx`:

```typescript
export const themes: Record<string, Theme> = {
  // ... existing themes
  myNewTheme: {
    name: 'My New Theme',
    colors: {
      primary: '#ff0000',
      secondary: '#00ff00',
      accent: '#0000ff',
      background: '#000000',
      surface: '#1a1a1a',
      text: '#ffffff',
      textSecondary: '#999999',
      border: '#333333',
      orbHue: 120,
    },
  },
};
```

Then add it to the `ThemeSelector.tsx` theme list:
```typescript
{ id: 'myNewTheme', color: '#ff0000', name: 'My New Theme' },
```

## Technical Details

- **Storage**: localStorage key `'selectedTheme'`
- **Default**: Dark theme
- **Performance**: CSS variables for instant theme switching
- **Persistence**: Survives page refreshes and browser restarts
- **Animation**: Smooth transitions on theme change
- **Z-index**: Modal at 100000 to appear above all content

## Benefits

✅ **User Experience**: Personalization and customization
✅ **Accessibility**: Light/dark mode options
✅ **Visual Appeal**: 27 beautiful color schemes
✅ **Performance**: Efficient CSS variable switching
✅ **Persistence**: Saves user preference
✅ **Maintainability**: Centralized theme management
✅ **Extensibility**: Easy to add new themes

## Future Enhancements

- [ ] Custom theme creator
- [ ] Theme preview before applying
- [ ] Theme categories (dark, light, colorful)
- [ ] Import/export theme configurations
- [ ] System theme detection (auto dark/light)
- [ ] Scheduled theme switching (time-based)
