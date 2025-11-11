import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Code2, LayoutDashboard, Trophy, Target, Users2, LogOut, UserCircle } from 'lucide-react';
import './index.css';
import Orb from './components/Orb';
import TargetCursor from './components/TargetCursor';
import NotificationPanel from './components/NotificationPanel';
import ThemeSelector from './components/ThemeSelector';
import GradientText from './components/GradientText';
import { useTheme } from './contexts/ThemeContext';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leaderboard from './pages/Leaderboard';
import Goals from './pages/Goals';
import Groups from './pages/Groups';
import Onboarding from './pages/Onboarding';
import Profile from './pages/Profile';

function App() {
  const { theme } = useTheme();
  const [user, setUser] = useState<{
    id: string;
    name: string;
    email: string;
    isFirstLogin?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('http://localhost:5050/auth/current-user', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('http://localhost:5050/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      setUser(null);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center transition-colors duration-300"
        style={{ 
          backgroundColor: theme.colors.background,
          backgroundImage: `linear-gradient(to bottom right, ${theme.colors.background}, ${theme.colors.surface})`,
        }}
      >
        <div 
          className="text-2xl animate-pulse font-semibold"
          style={{ color: theme.colors.text }}
        >
          Loading...
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div 
        className="min-h-screen relative transition-colors duration-300"
        style={{ backgroundColor: theme.colors.background }}
      >
        {/* Target Cursor */}
        <TargetCursor
          spinDuration={2}
          hideDefaultCursor={true}
          parallaxOn={true}
        />

        {/* Animated Background */}
        <div className="fixed inset-0 w-full h-full z-0">
          <Orb
            hoverIntensity={0.5}
            rotateOnHover={true}
            hue={theme.colors.orbHue}
            forceHoverState={false}
          />
        </div>

        {/* Content Wrapper */}
        <div className="relative z-10">
          {user && (
            <nav 
              className="backdrop-blur-lg border-b relative z-50 transition-colors duration-300"
              style={{
                backgroundColor: `${theme.colors.surface}80`,
                borderColor: `${theme.colors.primary}33`,
              }}
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between h-16">
                  <div className="flex items-center space-x-8">
                    <Link 
                      to="/dashboard"
                      className="cursor-target flex items-center space-x-2 transition-colors duration-200"
                      style={{ color: theme.colors.text }}
                      onMouseEnter={(e) => e.currentTarget.style.color = theme.colors.primary}
                      onMouseLeave={(e) => e.currentTarget.style.color = theme.colors.text}
                    >
                      <Code2 className="w-8 h-8" />
                      <span className="text-xl font-bold">
                        <GradientText animationSpeed={6}>
                          CodeTrackr
                        </GradientText>
                      </span>
                    </Link>                    <div className="hidden md:flex space-x-4">
                      <NavLink to="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />}>Dashboard</NavLink>
                      <NavLink to="/leaderboard" icon={<Trophy className="w-4 h-4" />}>Leaderboard</NavLink>
                      <NavLink to="/goals" icon={<Target className="w-4 h-4" />}>Goals</NavLink>
                      <NavLink to="/groups" icon={<Users2 className="w-4 h-4" />}>Groups</NavLink>
                      <NavLink to="/profile" icon={<UserCircle className="w-4 h-4" />}>Profile</NavLink>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    {/* Notification Panel */}
                    <NotificationPanel />
                    
                    {/* Theme Selector */}
                    <ThemeSelector />
                    
                    <span 
                      className="hidden sm:block font-medium"
                      style={{ color: theme.colors.text }}
                    >
                      <GradientText animationSpeed={5}>
                        Hi, {user.name}!
                      </GradientText>
                    </span>
                    <button 
                      onClick={handleLogout}
                      className="cursor-target flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200"
                      style={{
                        backgroundColor: '#ef444420',
                        color: '#ef4444',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#ef444430'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ef444420'}
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Logout</span>
                    </button>
                  </div>
                </div>
              </div>
            </nav>
          )}

          <Routes>
            <Route path="/login" element={!user ? <Login /> : <Navigate to={user.isFirstLogin ? "/onboarding" : "/dashboard"} />} />
            <Route path="/onboarding" element={user ? <Onboarding /> : <Navigate to="/login" />} />
            <Route path="/dashboard" element={user ? <Dashboard user={user} /> : <Navigate to="/login" />} />
            <Route path="/leaderboard" element={user ? <Leaderboard /> : <Navigate to="/login" />} />
            <Route path="/goals" element={user ? <Goals /> : <Navigate to="/login" />} />
            <Route path="/groups" element={user ? <Groups user={user} /> : <Navigate to="/login" />} />
            <Route path="/profile" element={user ? <Profile /> : <Navigate to="/login" />} />
            <Route path="/" element={user ? <Navigate to={user.isFirstLogin ? "/onboarding" : "/dashboard"} /> : <Navigate to="/login" />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

function NavLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  const { theme } = useTheme();
  
  return (
    <Link 
      to={to}
      className="cursor-target flex items-center space-x-2 px-3 py-2 rounded-lg transition-all duration-200"
      style={{ color: theme.colors.textSecondary }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = theme.colors.text;
        e.currentTarget.style.backgroundColor = `${theme.colors.primary}20`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = theme.colors.textSecondary;
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {icon}
      <span>
        <GradientText animationSpeed={5}>
          {children}
        </GradientText>
      </span>
    </Link>
  );
}

export default App;

