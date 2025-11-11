import { useState, useEffect } from 'react';
import { Target, ChevronLeft, ChevronRight, X, Plus, CheckCircle, Circle, Trash2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import GradientText from '../components/GradientText';
import TextType from '../components/TextType';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

interface Goal {
  _id: string;
  title: string;
  description: string;
  targetHours: number;
  techStack: string;
  deadline: string;
  todos?: Todo[];
}

export default function Goals() {
  const { theme } = useTheme();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showTodoModal, setShowTodoModal] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [newTodoText, setNewTodoText] = useState('');
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    targetHours: '',
    techStack: '',
    deadline: ''
  });

  useEffect(() => {
    fetchGoals();
  }, []);

  const fetchGoals = async () => {
    try {
      const res = await fetch('http://localhost:5050/api/goals', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setGoals(data);
      }
    } catch (error) {
      console.error('Failed to fetch goals:', error);
    }
  };

  const createGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:5050/api/goals/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        fetchGoals();
        setShowModal(false);
        setSelectedDate(null);
        setFormData({ title: '', description: '', targetHours: '', techStack: '', deadline: '' });
      }
    } catch (error) {
      console.error('Failed to create goal:', error);
    }
  };

  // Todo management functions
  const addTodo = (goalId: string, todoText: string) => {
    if (!todoText.trim()) return;
    
    const newTodo: Todo = {
      id: Date.now().toString(),
      text: todoText,
      completed: false
    };

    setGoals(goals.map(goal => {
      if (goal._id === goalId) {
        return {
          ...goal,
          todos: [...(goal.todos || []), newTodo]
        };
      }
      return goal;
    }));
    setNewTodoText('');
  };

  const toggleTodo = (goalId: string, todoId: string) => {
    setGoals(goals.map(goal => {
      if (goal._id === goalId) {
        return {
          ...goal,
          todos: (goal.todos || []).map(todo =>
            todo.id === todoId ? { ...todo, completed: !todo.completed } : todo
          )
        };
      }
      return goal;
    }));
  };

  const deleteTodo = (goalId: string, todoId: string) => {
    setGoals(goals.map(goal => {
      if (goal._id === goalId) {
        return {
          ...goal,
          todos: (goal.todos || []).filter(todo => todo.id !== todoId)
        };
      }
      return goal;
    }));
  };

  const openTodoModal = (date: Date) => {
    setSelectedDate(date);
    setShowTodoModal(true);
  };

  // Calendar logic
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    return { daysInMonth, startingDayOfWeek };
  };

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(currentDate);
  
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleDateClick = (day: number) => {
    const clickedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    setSelectedDate(clickedDate);
    setFormData({
      ...formData,
      deadline: clickedDate.toISOString().split('T')[0]
    });
    setShowModal(true);
  };

  const getGoalsForDate = (day: number) => {
    const dateStr = new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toISOString().split('T')[0];
    return goals.filter(goal => goal.deadline.startsWith(dateStr));
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getFullYear() === today.getFullYear()
    );
  };

  const isPastDate = (day: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateToCheck = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    return dateToCheck < today;
  };

  // Get colorful emoji icon for each date based on month
  const getDateIcon = (day: number, month: number) => {
    const emojiStyle = "text-3xl opacity-25";
    
    // Month-based colorful emojis
    const monthIcons: { [key: number]: string[] } = {
      0: ['❄️', '⛄', '🌨️', '⭐', '🌙', '✨'], // January - Winter
      1: ['💝', '💖', '💗', '🎁', '💐', '🌹'], // February - Love
      2: ['🍀', '🌱', '🌷', '🌸', '☘️', '🦋'], // March - Spring
      3: ['🌧️', '☔', '🌈', '🌺', '🌻', '🌼'], // April - Showers
      4: ['🌸', '🌺', '🌻', '🌼', '🌷', '🦋'], // May - Flowers
      5: ['☀️', '🌞', '🏖️', '🍹', '⛱️', '🌊'], // June - Summer
      6: ['🔥', '☀️', '🌴', '🍉', '🏄', '🌅'], // July - Hot Summer
      7: ['🌟', '⚡', '🎆', '🏆', '🎯', '💫'], // August - Achievement
      8: ['🍂', '🍁', '🎃', '☕', '📚', '🌾'], // September - Autumn
      9: ['🍁', '🎃', '👻', '🌙', '🦇', '🕷️'], // October - Halloween
      10: ['🍂', '🦃', '🥧', '🌰', '☕', '📅'], // November - Thanksgiving
      11: ['🎄', '🎅', '🎁', '⛄', '🌟', '❄️']  // December - Christmas
    };

    const icons = monthIcons[month] || ['📅', '⭐', '✨'];
    const icon = icons[day % icons.length];
    
    return (
      <span className={emojiStyle}>
        {icon}
      </span>
    );
  };

  // Get unique color for each date
  const getDateColor = (day: number) => {
    const colors = [
      'from-blue-500/10 to-cyan-500/10',
      'from-purple-500/10 to-pink-500/10',
      'from-green-500/10 to-emerald-500/10',
      'from-orange-500/10 to-red-500/10',
      'from-indigo-500/10 to-purple-500/10',
      'from-teal-500/10 to-blue-500/10',
      'from-rose-500/10 to-pink-500/10',
      'from-amber-500/10 to-orange-500/10',
      'from-lime-500/10 to-green-500/10',
      'from-violet-500/10 to-purple-500/10',
    ];
    return colors[day % colors.length];
  };

  // Generate calendar grid
  const calendarDays = [];
  
  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(
      <div 
        key={`empty-${i}`} 
        className="h-10 rounded-lg"
        style={{ backgroundColor: `${theme.colors.background}40` }}
      ></div>
    );
  }
  
  // Add cells for each day of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const dayGoals = getGoalsForDate(day);
    const isCurrentDay = isToday(day);
    const isPast = isPastDate(day);
    const clickedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const hasGoals = dayGoals.length > 0;
    
    calendarDays.push(
      <button
        key={day}
        onClick={() => {
          if (!isPast) {
            setSelectedDate(clickedDate);
            setShowModal(true);
            setFormData({ 
              ...formData, 
              deadline: clickedDate.toISOString().split('T')[0] 
            });
          }
        }}
        className={`cursor-target h-10 rounded-lg font-semibold text-sm transition-all duration-200 relative ${
          isPast ? 'cursor-not-allowed opacity-40' : 'hover:scale-110'
        }`}
        style={{
          backgroundColor: isCurrentDay 
            ? theme.colors.primary
            : hasGoals 
              ? `${theme.colors.accent}40`
              : `${theme.colors.surface}80`,
          color: isCurrentDay 
            ? '#ffffff' 
            : isPast 
              ? theme.colors.textSecondary 
              : theme.colors.text,
          border: isCurrentDay 
            ? `2px solid ${theme.colors.primary}` 
            : hasGoals 
              ? `2px solid ${theme.colors.accent}80`
              : `1px solid ${theme.colors.border}`,
        }}
        disabled={isPast}
      >
        {day}
        {hasGoals && (
          <span 
            className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
            style={{ backgroundColor: theme.colors.accent }}
          ></span>
        )}
      </button>
    );
  }

  return (
    <div 
      className="min-h-screen py-8 px-4 transition-colors duration-300"
      style={{ backgroundColor: theme.colors.background }}
    >
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <div 
            className="p-3 rounded-xl"
            style={{ 
              background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})` 
            }}
          >
            <Target className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">
              <TextType
                text={["Goals Calendar"]}
                typingSpeed={75}
                pauseDuration={1500}
                showCursor={true}
                cursorCharacter="|"
                loop={false}
                textColors={[theme.colors.primary]}
                className="inline-block"
              />
            </h1>
            <p className="text-sm" style={{ color: theme.colors.textSecondary }}>
              Click on any date to set a goal
            </p>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left & Center: Compact Calendar Card */}
          <div 
            className="lg:col-span-2 backdrop-blur-lg rounded-3xl p-8 border shadow-2xl transition-all duration-300"
            style={{
              backgroundColor: `${theme.colors.surface}cc`,
              borderColor: `${theme.colors.primary}40`,
            }}
          >
            <div className="flex gap-6">
              {/* Left: Large Date Display */}
              <div 
                className="flex-shrink-0 w-48 rounded-2xl flex flex-col items-center justify-center py-8 transition-all duration-300"
                style={{ 
                  backgroundColor: `${theme.colors.primary}20`,
                  borderLeft: `4px solid ${theme.colors.primary}`
                }}
              >
                <div 
                  className="text-sm font-semibold uppercase tracking-wider mb-2"
                  style={{ color: theme.colors.primary }}
              >
                {dayNames[new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDate?.getDate() || new Date().getDate()).getDay()]}
              </div>
              <div className="text-7xl font-bold mb-1">
                <GradientText animationSpeed={4}>
                  {selectedDate?.getDate() || new Date().getDate()}
                </GradientText>
              </div>
            </div>              {/* Right: Small Monthly Calendar */}
              <div className="flex-1">
              {/* Month Navigation */}
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={goToPreviousMonth}
                  className="cursor-target p-2 rounded-lg transition-all duration-200"
                  style={{ 
                    backgroundColor: `${theme.colors.surface}80`,
                    color: theme.colors.text
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.primary}20`}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.surface}80`}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                
                <h2 
                  className="text-xl font-bold uppercase tracking-wide"
                  style={{ color: theme.colors.text }}
                >
                  {monthNames[currentDate.getMonth()].toUpperCase()} {currentDate.getFullYear()}
                </h2>
                
                <button
                  onClick={goToNextMonth}
                  className="cursor-target p-2 rounded-lg transition-all duration-200"
                  style={{ 
                    backgroundColor: `${theme.colors.surface}80`,
                    color: theme.colors.text
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.primary}20`}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.surface}80`}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Day Names Header */}
              <div className="grid grid-cols-7 gap-2 mb-3">
                {dayNames.map(day => (
                  <div 
                    key={day} 
                    className="text-center font-semibold text-xs py-1"
                    style={{ color: theme.colors.textSecondary }}
                  >
                    {day.charAt(0)}
                  </div>
                ))}
              </div>
              
              {/* Calendar Days Grid */}
              <div className="grid grid-cols-7 gap-2">
                {calendarDays}
              </div>
            </div>
          </div>
        </div>

          {/* Right: Goals List */}
          <div className="lg:col-span-1">
            <div 
              className="backdrop-blur-lg rounded-3xl p-6 border shadow-2xl transition-all duration-300 sticky top-8"
              style={{
                backgroundColor: `${theme.colors.surface}cc`,
                borderColor: `${theme.colors.primary}40`,
              }}
            >
            <h3 className="text-xl font-bold mb-4">
              <GradientText animationSpeed={7}>
                Your Goals
              </GradientText>
            </h3>
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
              {goals.length === 0 ? (
                <div 
                  className="text-center py-8 rounded-xl border"
                  style={{
                    backgroundColor: `${theme.colors.surface}80`,
                    borderColor: theme.colors.border,
                    color: theme.colors.textSecondary
                  }}
                >
                  <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No goals set yet. Click on a date to create your first goal!</p>
                </div>
              ) : (
                goals.map((goal) => (
                  <div
                    key={goal._id}
                    className="p-4 rounded-xl border transition-all duration-200 cursor-target"
                    style={{
                      backgroundColor: `${theme.colors.surface}80`,
                      borderColor: theme.colors.border,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = theme.colors.primary}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = theme.colors.border}
                  >
                    <h4 className="font-semibold text-base mb-1" style={{ color: theme.colors.text }}>
                      {goal.title}
                    </h4>
                    <p className="text-xs mb-2 line-clamp-2" style={{ color: theme.colors.textSecondary }}>
                      {goal.description}
                    </p>
                    <div className="flex flex-col gap-1 text-xs">
                      <span 
                        className="px-2 py-1 rounded-full inline-block w-fit"
                        style={{
                          backgroundColor: `${theme.colors.primary}20`,
                          color: theme.colors.primary
                        }}
                      >
                        {goal.techStack}
                      </span>
                      <span style={{ color: theme.colors.textSecondary }}>
                        Target: <GradientText animationSpeed={5}>{goal.targetHours}h</GradientText>
                      </span>
                      <span style={{ color: theme.colors.textSecondary }}>
                        {new Date(goal.deadline).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        {/* End of grid */}
      </div>
      {/* End of max-w container */}

      {/* Goal Creation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div 
            className="rounded-2xl p-8 max-w-lg w-full border shadow-2xl"
            style={{
              backgroundColor: theme.colors.surface,
              borderColor: `${theme.colors.primary}50`,
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold" style={{ color: theme.colors.text }}>
                  Set Goal
                </h2>
                <p className="text-sm" style={{ color: theme.colors.textSecondary }}>
                  {selectedDate?.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedDate(null);
                }}
                className="cursor-target p-2 rounded-lg transition"
                style={{ 
                  backgroundColor: `${theme.colors.surface}80`,
                  color: theme.colors.textSecondary
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.primary}20`}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.surface}80`}
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={createGoal} className="space-y-4">
              <div>
                <label className="block mb-2 font-medium" style={{ color: theme.colors.text }}>
                  Goal Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2 transition"
                  style={{
                    backgroundColor: `${theme.colors.surface}80`,
                    color: theme.colors.text,
                    borderColor: theme.colors.border,
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = theme.colors.primary;
                    e.currentTarget.style.boxShadow = `0 0 0 3px ${theme.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = theme.colors.border;
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  placeholder="e.g., Complete React project"
                  required
                />
              </div>
              
              <div>
                <label className="block mb-2 font-medium" style={{ color: theme.colors.text }}>
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2 transition"
                  style={{
                    backgroundColor: `${theme.colors.surface}80`,
                    color: theme.colors.text,
                    borderColor: theme.colors.border,
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = theme.colors.primary;
                    e.currentTarget.style.boxShadow = `0 0 0 3px ${theme.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = theme.colors.border;
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  rows={3}
                  placeholder="Describe your goal..."
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-2 font-medium" style={{ color: theme.colors.text }}>
                    Target Hours
                  </label>
                  <input
                    type="number"
                    value={formData.targetHours}
                    onChange={(e) => setFormData({ ...formData, targetHours: e.target.value })}
                    className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2 transition"
                    style={{
                      backgroundColor: `${theme.colors.surface}80`,
                      color: theme.colors.text,
                      borderColor: theme.colors.border,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = theme.colors.primary;
                      e.currentTarget.style.boxShadow = `0 0 0 3px ${theme.colors.primary}20`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = theme.colors.border;
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    placeholder="10"
                    required
                  />
                </div>
                
                <div>
                  <label className="block mb-2 font-medium" style={{ color: theme.colors.text }}>
                    Tech Stack
                  </label>
                  <input
                    type="text"
                    value={formData.techStack}
                    onChange={(e) => setFormData({ ...formData, techStack: e.target.value })}
                    className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2 transition"
                    style={{
                      backgroundColor: `${theme.colors.surface}80`,
                      color: theme.colors.text,
                      borderColor: theme.colors.border,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = theme.colors.primary;
                      e.currentTarget.style.boxShadow = `0 0 0 3px ${theme.colors.primary}20`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = theme.colors.border;
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    placeholder="React, Node.js"
                  />
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="cursor-target flex-1 px-6 py-3 rounded-lg font-semibold transition shadow-lg text-white"
                  style={{
                    background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})`,
                  }}
                >
                  Create Goal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setSelectedDate(null);
                  }}
                  className="cursor-target px-6 py-3 rounded-lg font-semibold transition"
                  style={{
                    backgroundColor: `${theme.colors.surface}80`,
                    color: theme.colors.text,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.primary}20`}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.surface}80`}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
