import './GradientText.css';
import { useTheme } from '../contexts/ThemeContext';

interface GradientTextProps {
  children: React.ReactNode;
  className?: string;
  colors?: string[];
  animationSpeed?: number;
  showBorder?: boolean;
  useThemeColors?: boolean;
}

export default function GradientText({
  children,
  className = '',
  colors,
  animationSpeed = 8,
  showBorder = false,
  useThemeColors = true
}: GradientTextProps) {
  const { theme } = useTheme();
  
  // Use theme colors if useThemeColors is true and no custom colors provided
  const gradientColors = useThemeColors && !colors 
    ? [
        theme.colors.primary,
        theme.colors.accent,
        theme.colors.secondary,
        theme.colors.accent,
        theme.colors.primary
      ]
    : colors || ['#40ffaa', '#4079ff', '#40ffaa', '#4079ff', '#40ffaa'];

  const gradientStyle = {
    backgroundImage: `linear-gradient(to right, ${gradientColors.join(', ')})`,
    animationDuration: `${animationSpeed}s`
  };

  return (
    <div className={`animated-gradient-text ${className}`}>
      {showBorder && <div className="gradient-overlay" style={gradientStyle}></div>}
      <div className="text-content" style={gradientStyle}>
        {children}
      </div>
    </div>
  );
}
