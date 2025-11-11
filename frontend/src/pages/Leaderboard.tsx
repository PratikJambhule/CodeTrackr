import { useState, useEffect } from 'react';
import { Trophy, Users } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import GradientText from '../components/GradientText';
import TextType from '../components/TextType';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  totalHours: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  codeChanges: number;
  netCodeChanges: number;
  projectCount: number;
  commits: number;
  commitScore: number;
  speed: number;
  quality: number;
  engagement: number;
  impact: number;
  overall: number;
}

export default function Leaderboard() {
  const { theme } = useTheme();
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch('http://localhost:5050/api/leaderboard');
      if (res.ok) {
        const data = await res.json();
        console.log('Leaderboard data:', data);
        setLeaders(data);
      }
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600">
          <span className="text-yellow-900 font-bold text-lg">1</span>
        </div>
      );
    } else if (rank === 2) {
      return (
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-gray-300 to-gray-500">
          <span className="text-gray-800 font-bold text-lg">2</span>
        </div>
      );
    } else if (rank === 3) {
      return (
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-orange-600">
          <span className="text-orange-900 font-bold text-lg">3</span>
        </div>
      );
    } else {
      return (
        <span className="text-gray-400 font-semibold text-lg">{rank}</span>
      );
    }
  };

  // Calculate team averages
  const teamAverage = leaders.length > 0 ? {
    totalHours: (leaders.reduce((sum, l) => sum + l.totalHours, 0) / leaders.length).toFixed(1),
    codeAdded: Math.round(leaders.reduce((sum, l) => sum + l.totalLinesAdded, 0) / leaders.length),
    codeRemoved: Math.round(leaders.reduce((sum, l) => sum + l.totalLinesRemoved, 0) / leaders.length),
    speed: (leaders.reduce((sum, l) => sum + parseFloat(l.speed.toString()), 0) / leaders.length).toFixed(1),
  } : null;

  if (loading) {
    return (
      <div 
        className="flex items-center justify-center min-h-screen transition-colors duration-300"
        style={{ backgroundColor: theme.colors.background }}
      >
        <div 
          className="text-2xl animate-pulse font-semibold"
          style={{ color: theme.colors.text }}
        >
          Loading leaderboard...
        </div>
      </div>
    );
  }

  return (
    <div 
      className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-colors duration-300"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
          <Trophy className="w-10 h-10" style={{ color: theme.colors.accent }} />
          <TextType
            text={["Global Leaderboard"]}
            typingSpeed={75}
            pauseDuration={1500}
            showCursor={true}
            cursorCharacter="|"
            loop={false}
            textColors={[theme.colors.primary]}
            className="inline-block"
          />
        </h1>
        <p style={{ color: theme.colors.textSecondary }}>Team performance metrics and rankings</p>
      </div>

      {/* Leaderboard Table */}
      <div 
        className="backdrop-blur-lg rounded-xl border overflow-hidden transition-all duration-300"
        style={{
          backgroundColor: `${theme.colors.surface}80`,
          borderColor: `${theme.colors.primary}40`,
        }}
      >
        {leaders.length === 0 ? (
          <div className="text-center py-12">
            <Trophy className="w-16 h-16 mx-auto mb-4" style={{ color: theme.colors.textSecondary }} />
            <h3 className="text-xl font-semibold mb-2" style={{ color: theme.colors.text }}>No Data Yet</h3>
            <p style={{ color: theme.colors.textSecondary }}>Start coding to appear on the leaderboard!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead 
                style={{ 
                  backgroundColor: `${theme.colors.background}80`,
                }}
              >
                <tr 
                  className="border-b"
                  style={{ borderColor: theme.colors.border }}
                >
                  <th className="px-4 py-3 text-left text-xs font-semibold" style={{ color: theme.colors.text }}>#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold" style={{ color: theme.colors.text }}>Name</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold" style={{ color: theme.colors.text }}>Line Changes</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold" style={{ color: theme.colors.text }}>Speed</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold" style={{ color: theme.colors.text }}>Overall Coding Time</th>
                </tr>
              </thead>
              <tbody>
                {/* Team Average Row */}
                {teamAverage && (
                  <tr 
                    className="border-b transition-colors duration-300"
                    style={{
                      borderColor: `${theme.colors.border}80`,
                      backgroundColor: `${theme.colors.primary}10`,
                    }}
                  >
                    <td className="px-4 py-3">
                      <Users className="w-6 h-6" style={{ color: theme.colors.primary }} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold" style={{ color: theme.colors.text }}>Team average</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span style={{ color: theme.colors.accent }}>
                        <GradientText animationSpeed={4}>+{teamAverage.codeAdded}</GradientText>
                      </span>
                      {' '}
                      <span style={{ color: theme.colors.secondary }}>
                        <GradientText animationSpeed={4}>-{teamAverage.codeRemoved}</GradientText>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center" style={{ color: theme.colors.textSecondary }}>
                      <GradientText animationSpeed={4}>{teamAverage.speed}</GradientText>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-semibold" style={{ color: theme.colors.text }}>
                          <GradientText animationSpeed={5}>{teamAverage.totalHours}h</GradientText>
                        </span>
                        <Trophy className="w-4 h-4" style={{ color: theme.colors.primary }} />
                      </div>
                    </td>
                  </tr>
                )}

                {/* Individual Rows */}
                {leaders.map((leader) => (
                  <tr 
                    key={leader.userId} 
                    className={`border-b transition-all duration-200`}
                    style={{
                      borderColor: `${theme.colors.border}80`,
                      backgroundColor: leader.rank <= 3 ? `${theme.colors.accent}05` : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = `${theme.colors.surface}60`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = leader.rank <= 3 ? `${theme.colors.accent}05` : 'transparent';
                    }}
                  >
                    <td className="px-4 py-3">
                      {getRankBadge(leader.rank)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                          style={{
                            background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})`,
                          }}
                        >
                          {leader.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium" style={{ color: theme.colors.text }}>{leader.name}</p>
                          <p className="text-xs" style={{ color: theme.colors.textSecondary }}>{leader.email.split('@')[0]}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span style={{ color: theme.colors.accent }}>
                        <GradientText animationSpeed={4}>+{leader.totalLinesAdded}</GradientText>
                      </span>
                      {' '}
                      <span style={{ color: theme.colors.secondary }}>
                        <GradientText animationSpeed={4}>-{leader.totalLinesRemoved}</GradientText>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center" style={{ color: theme.colors.textSecondary }}>
                      <GradientText animationSpeed={4}>{leader.speed}</GradientText>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-semibold" style={{ color: theme.colors.text }}>
                          <GradientText animationSpeed={5}>{leader.totalHours.toFixed(1)}h</GradientText>
                        </span>
                        <Trophy className="w-4 h-4" style={{ color: theme.colors.accent }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
