import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Clock, Code, TrendingUp, Calendar, ArrowLeft } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Line, Pie } from 'react-chartjs-2';
import { useTheme } from '../contexts/ThemeContext';
import GradientText from '../components/GradientText';
import TextType from '../components/TextType';
import { API_URL } from '../config';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, ArcElement, ChartDataLabels);

export default function Dashboard({ user }: { user: any }) {
  const { theme } = useTheme();
  const [analytics, setAnalytics] = useState<any>(null);
  const [weeklyAnalytics, setWeeklyAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily');
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<{ start: number, end: number } | null>(null);
  const [timeSlotData, setTimeSlotData] = useState<any>(null);

  useEffect(() => {
    fetchAnalytics();
    fetchWeeklyAnalytics();
  }, []);

  useEffect(() => {
    // Refetch data when view mode changes
    if (viewMode === 'daily') {
      fetchAnalytics();
    } else {
      fetchWeeklyAnalytics();
    }
  }, [viewMode]);

  const fetchAnalytics = useCallback(async () => {
    try {
      console.log('Fetching analytics for user:', user);
      console.log('User ID:', user.id);
      // Get user's timezone offset in minutes (negative for IST)
      const timezoneOffset = new Date().getTimezoneOffset();
      const res = await fetch(`${API_URL}/api/analytics/${user.id}?timezone=${timezoneOffset}`, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      console.log('Response status:', res.status);
      if (res.ok) {
        const data = await res.json();
        console.log('Analytics data received:', data);
        setAnalytics(data);
      } else {
        console.error('Failed to fetch analytics, status:', res.status);
        const errorText = await res.text();
        console.error('Error response:', errorText);
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchWeeklyAnalytics = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/analytics/weekly/${user.id}`, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      if (res.ok) {
        const data = await res.json();
        setWeeklyAnalytics(data);
      }
    } catch (error) {
      console.error('Failed to fetch weekly analytics:', error);
    }
  }, [user]);

  const fetchTimeSlotData = async (startHour: number, endHour: number) => {
    try {
      const timezoneOffset = new Date().getTimezoneOffset();
      const res = await fetch(`${API_URL}/api/analytics/timeslot/${user.id}?start=${startHour}&end=${endHour}&timezone=${timezoneOffset}`, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      if (res.ok) {
        const data = await res.json();
        setTimeSlotData(data);
      }
    } catch (error) {
      console.error('Failed to fetch time slot data:', error);
    }
  };

  const handleTimeSlotClick = (startHour: number, endHour: number) => {
    setSelectedTimeSlot({ start: startHour, end: endHour });
    fetchTimeSlotData(startHour, endHour);
  };

  const handleBackToOverview = () => {
    setSelectedTimeSlot(null);
    setTimeSlotData(null);
  };

  if (loading) {
    return (
      <div 
        className="flex items-center justify-center min-h-screen transition-colors duration-300"
        style={{ backgroundColor: theme.colors.background }}
      >
        <div className="text-xl" style={{ color: theme.colors.text }}>
          Loading analytics...
        </div>
      </div>
    );
  }

  // Always show dashboard, even with no data
  if (!analytics) {
    return (
      <div 
        className="flex items-center justify-center min-h-screen transition-colors duration-300"
        style={{ backgroundColor: theme.colors.background }}
      >
        <div className="text-xl" style={{ color: theme.colors.text }}>
          Error loading analytics. Please try again.
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Total Hours', value: analytics?.totalHours?.toFixed(1) || '0', icon: <Clock className="w-6 h-6" />, color: 'from-blue-500 to-cyan-500' },
    { label: 'Projects', value: analytics?.projectCount || '0', icon: <Code className="w-6 h-6" />, color: 'from-purple-500 to-pink-500' },
    { label: 'Lines of Code', value: analytics?.totalLinesAdded || '0', icon: <BarChart3 className="w-6 h-6" />, color: 'from-green-500 to-emerald-500' },
    { label: 'Streak Days', value: analytics?.streakDays || '0', icon: <TrendingUp className="w-6 h-6" />, color: 'from-orange-500 to-red-500' },
  ];

  const currentData = viewMode === 'weekly' ? weeklyAnalytics : analytics;

  const dailyData = {
    labels: currentData?.dailyActivity?.map((d: any) => d.day) || [],
    datasets: [{
      label: 'Hours Coded',
      data: currentData?.dailyActivity?.map((d: any) => d.hours) || [],
      backgroundColor: `${theme.colors.primary}20`,
      borderColor: theme.colors.primary,
      borderWidth: 2,
      fill: true,
      tension: 0.4,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: theme.colors.primary,
    }]
  };

  const languageData = {
    labels: currentData?.languageBreakdown?.map((l: any) => l._id) || [],
    datasets: [{
      data: currentData?.languageBreakdown?.map((l: any) => l.hours) || [],
      backgroundColor: [
        `${theme.colors.primary}cc`,
        `${theme.colors.accent}cc`,
        `${theme.colors.secondary}cc`,
        `${theme.colors.primary}99`,
        `${theme.colors.accent}99`,
        `${theme.colors.secondary}99`,
        `${theme.colors.primary}66`,
      ],
      borderColor: [
        theme.colors.primary,
        theme.colors.accent,
        theme.colors.secondary,
        theme.colors.primary,
        theme.colors.accent,
        theme.colors.secondary,
        theme.colors.primary,
      ],
      borderWidth: 3,
    }]
  };

  const lineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { 
          color: theme.colors.text,
          font: { size: 14 }
        }
      },
      tooltip: {
        backgroundColor: `${theme.colors.surface}ee`,
        titleColor: theme.colors.text,
        bodyColor: theme.colors.text,
        borderColor: theme.colors.primary,
        borderWidth: 1,
        padding: 12,
        displayColors: false,
        callbacks: {
          label: function(context: any) {
            return `${context.parsed.y.toFixed(2)} hours`;
          }
        }
      },
      datalabels: {
        display: false
      }
    },
    scales: {
      x: {
        grid: {
          color: `${theme.colors.border}40`,
        },
        ticks: {
          color: theme.colors.textSecondary,
          font: { size: 12 }
        }
      },
      y: {
        grid: {
          color: `${theme.colors.border}40`,
        },
        ticks: {
          color: theme.colors.textSecondary,
          font: { size: 12 },
          callback: function(value: any) {
            return value.toFixed(1) + 'h';
          }
        }
      }
    }
  };

  const pieChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          color: theme.colors.primary, // Use primary color for better visibility
          font: { 
            size: 14, 
            weight: 'bold' as const
          },
          padding: 15,
          generateLabels: function(chart: any) {
            const data = chart.data;
            if (data.labels.length && data.datasets.length) {
              return data.labels.map((label: string, i: number) => {
                const value = data.datasets[0].data[i];
                return {
                  text: `${label}: ${value.toFixed(2)}h`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  strokeStyle: data.datasets[0].borderColor[i],
                  lineWidth: 2,
                  hidden: false,
                  index: i
                };
              });
            }
            return [];
          }
        }
      },
      tooltip: {
        backgroundColor: `${theme.colors.surface}ee`,
        titleColor: theme.colors.text,
        bodyColor: theme.colors.text,
        borderColor: theme.colors.primary,
        borderWidth: 2,
        padding: 12,
        titleFont: { 
          size: 14, 
          weight: 'bold' as const
        },
        bodyFont: { size: 13 },
        callbacks: {
          label: function(context: any) {
            const label = context.label || '';
            const value = context.parsed;
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return `${label}: ${value.toFixed(2)}h (${percentage}%)`;
          }
        }
      },
      datalabels: {
        color: theme.colors.text,
        font: {
          size: 16,
          weight: 'bold' as const
        },
        formatter: (value: number, context: any) => {
          const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
          const percentage = ((value / total) * 100);
          return percentage > 5 ? `${percentage.toFixed(1)}%` : '';
        },
        textStrokeColor: 'rgba(0, 0, 0, 0.8)',
        textStrokeWidth: 4,
        textShadowColor: 'rgba(0, 0, 0, 0.9)',
        textShadowBlur: 6
      }
    }
  };

  return (
    <div 
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-colors duration-300"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* Time Slot Detail View */}
      {selectedTimeSlot && timeSlotData ? (
        <div>
          {/* Back Button */}
          <button
            onClick={handleBackToOverview}
            className="cursor-target mb-6 flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 hover:scale-105"
            style={{
              backgroundColor: `${theme.colors.surface}80`,
              borderColor: theme.colors.primary,
              color: theme.colors.text,
              border: `2px solid ${theme.colors.primary}`,
            }}
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">Back to Overview</span>
          </button>

          {/* Time Slot Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-2">
              <GradientText animationSpeed={6}>
                {`${selectedTimeSlot.start}:00 - ${selectedTimeSlot.end}:00 Detailed Analysis`}
              </GradientText>
            </h1>
            <p style={{ color: theme.colors.textSecondary }}>
              Detailed breakdown of your coding activity during this 2-hour window
            </p>
          </div>

          {/* Time Slot Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div 
              className="backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
              style={{
                backgroundColor: `${theme.colors.surface}80`,
                borderColor: theme.colors.border,
              }}
            >
              <div 
                className="inline-flex p-3 rounded-lg mb-4"
                style={{
                  background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})`,
                }}
              >
                <Clock className="w-6 h-6" />
              </div>
              <div className="text-3xl font-bold mb-1">
                <GradientText animationSpeed={5}>
                  {timeSlotData.totalMinutes}m
                </GradientText>
              </div>
              <div className="text-sm" style={{ color: theme.colors.textSecondary }}>
                Active Time
              </div>
            </div>

            <div 
              className="backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
              style={{
                backgroundColor: `${theme.colors.surface}80`,
                borderColor: theme.colors.border,
              }}
            >
              <div 
                className="inline-flex p-3 rounded-lg mb-4"
                style={{
                  background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})`,
                }}
              >
                <Code className="w-6 h-6" />
              </div>
              <div className="text-3xl font-bold mb-1">
                <GradientText animationSpeed={5}>
                  {timeSlotData.totalLines}
                </GradientText>
              </div>
              <div className="text-sm" style={{ color: theme.colors.textSecondary }}>
                Lines Changed
              </div>
            </div>

            <div 
              className="backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
              style={{
                backgroundColor: `${theme.colors.surface}80`,
                borderColor: theme.colors.border,
              }}
            >
              <div 
                className="inline-flex p-3 rounded-lg mb-4"
                style={{
                  background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})`,
                }}
              >
                <BarChart3 className="w-6 h-6" />
              </div>
              <div className="text-3xl font-bold mb-1">
                <GradientText animationSpeed={5}>
                  {timeSlotData.fileCount}
                </GradientText>
              </div>
              <div className="text-sm" style={{ color: theme.colors.textSecondary }}>
                Files Edited
              </div>
            </div>

            <div 
              className="backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
              style={{
                backgroundColor: `${theme.colors.surface}80`,
                borderColor: theme.colors.border,
              }}
            >
              <div 
                className="inline-flex p-3 rounded-lg mb-4"
                style={{
                  background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})`,
                }}
              >
                <TrendingUp className="w-6 h-6" />
              </div>
              <div className="text-3xl font-bold mb-1">
                <GradientText animationSpeed={5}>
                  {timeSlotData.productivity}%
                </GradientText>
              </div>
              <div className="text-sm" style={{ color: theme.colors.textSecondary }}>
                Productivity
              </div>
            </div>
          </div>

          {/* Time Slot Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Minute-by-minute activity line chart */}
            <div 
              className="backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
              style={{
                backgroundColor: `${theme.colors.surface}80`,
                borderColor: theme.colors.border,
              }}
            >
              <h2 className="text-xl font-bold mb-4">
                <GradientText animationSpeed={7}>
                  Activity Timeline
                </GradientText>
              </h2>
              <div style={{ height: '300px' }}>
                <Line 
                  data={{
                    labels: timeSlotData.tenMinuteSlots?.map((t: any) => t.label) || [],
                    datasets: [{
                      label: 'Lines Changed',
                      data: timeSlotData.tenMinuteSlots?.map((t: any) => t.lines) || [],
                      backgroundColor: `${theme.colors.primary}20`,
                      borderColor: theme.colors.primary,
                      borderWidth: 2,
                      fill: true,
                      tension: 0.4,
                      pointRadius: 4,
                      pointHoverRadius: 6,
                      pointBackgroundColor: theme.colors.primary,
                    }]
                  }} 
                  options={{
                    ...lineChartOptions,
                    plugins: {
                      ...lineChartOptions.plugins,
                      tooltip: {
                        ...lineChartOptions.plugins?.tooltip,
                        callbacks: {
                          label: function(context: any) {
                            return `${context.parsed.y} lines`;
                          }
                        }
                      }
                    }
                  }} 
                />
              </div>
            </div>

            {/* Language breakdown pie chart */}
            <div 
              className="backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
              style={{
                backgroundColor: `${theme.colors.surface}80`,
                borderColor: theme.colors.border,
              }}
            >
              <h2 className="text-xl font-bold mb-4">
                <GradientText animationSpeed={7}>
                  Languages Used
                </GradientText>
              </h2>
              <div style={{ height: '300px' }}>
                <Pie 
                  data={{
                    labels: timeSlotData.languages?.map((l: any) => l._id) || [],
                    datasets: [{
                      data: timeSlotData.languages?.map((l: any) => l.minutes) || [],
                      backgroundColor: [
                        `${theme.colors.primary}cc`,
                        `${theme.colors.accent}cc`,
                        `${theme.colors.secondary}cc`,
                        `${theme.colors.primary}99`,
                        `${theme.colors.accent}99`,
                      ],
                      borderColor: [
                        theme.colors.primary,
                        theme.colors.accent,
                        theme.colors.secondary,
                        theme.colors.primary,
                        theme.colors.accent,
                      ],
                      borderWidth: 3,
                    }]
                  }} 
                  options={{
                    ...pieChartOptions,
                    plugins: {
                      ...pieChartOptions.plugins,
                      legend: {
                        ...pieChartOptions.plugins?.legend,
                        labels: {
                          ...pieChartOptions.plugins?.legend?.labels,
                          generateLabels: function(chart: any) {
                            const data = chart.data;
                            if (data.labels.length && data.datasets.length) {
                              return data.labels.map((label: string, i: number) => {
                                const value = data.datasets[0].data[i];
                                return {
                                  text: `${label}: ${value.toFixed(1)}min`,
                                  fillStyle: data.datasets[0].backgroundColor[i],
                                  strokeStyle: data.datasets[0].borderColor[i],
                                  lineWidth: 2,
                                  hidden: false,
                                  index: i
                                };
                              });
                            }
                            return [];
                          }
                        }
                      },
                      tooltip: {
                        ...pieChartOptions.plugins?.tooltip,
                        callbacks: {
                          label: function(context: any) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value.toFixed(1)}min (${percentage}%)`;
                          }
                        }
                      }
                    }
                  }} 
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Main Dashboard View */
        <div>
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">
          <TextType
            text={[`Welcome back, ${user.name}!`]}
            typingSpeed={75}
            pauseDuration={1500}
            showCursor={true}
            cursorCharacter="|"
            loop={false}
            textColors={[theme.colors.primary]}
            className="inline-block"
          />
        </h1>
        <p style={{ color: theme.colors.textSecondary }}>
          Here's your coding activity overview
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => (
          <div 
            key={index} 
            className="backdrop-blur-lg rounded-xl p-6 hover:scale-105 transition-all duration-300 border"
            style={{
              backgroundColor: `${theme.colors.surface}80`,
              borderColor: theme.colors.border,
            }}
          >
            <div 
              className={`inline-flex p-3 rounded-lg mb-4`}
              style={{
                background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})`,
              }}
            >
              {stat.icon}
            </div>
            <div className="text-3xl font-bold mb-1">
              <GradientText animationSpeed={5}>
                {stat.value}
              </GradientText>
            </div>
            <div className="text-sm" style={{ color: theme.colors.textSecondary }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Weekly Summary Stats (only show in weekly mode) */}
      {viewMode === 'weekly' && weeklyAnalytics && (
        <div 
          className="mb-8 backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
          style={{
            background: `linear-gradient(to right, ${theme.colors.primary}10, ${theme.colors.accent}10)`,
            borderColor: `${theme.colors.primary}50`,
          }}
        >
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="w-6 h-6" style={{ color: theme.colors.primary }} />
            <GradientText animationSpeed={6}>
              This Week's Summary
            </GradientText>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div 
              className="rounded-lg p-4"
              style={{ backgroundColor: `${theme.colors.surface}80` }}
            >
              <div className="text-sm mb-1" style={{ color: theme.colors.textSecondary }}>
                Total Hours This Week
              </div>
              <div className="text-2xl font-bold">
                <GradientText animationSpeed={6}>
                  {weeklyAnalytics.totalHours || 0}h
                </GradientText>
              </div>
            </div>
            <div 
              className="rounded-lg p-4"
              style={{ backgroundColor: `${theme.colors.surface}80` }}
            >
              <div className="text-sm mb-1" style={{ color: theme.colors.textSecondary }}>
                Most Used Language
              </div>
              <div className="text-2xl font-bold" style={{ color: theme.colors.accent }}>
                <GradientText animationSpeed={7}>
                  {weeklyAnalytics.languageBreakdown && weeklyAnalytics.languageBreakdown.length > 0
                    ? weeklyAnalytics.languageBreakdown[0]._id
                    : 'N/A'}
                </GradientText>
              </div>
            </div>
            <div 
              className="rounded-lg p-4"
              style={{ backgroundColor: `${theme.colors.surface}80` }}
            >
              <div className="text-sm mb-1" style={{ color: theme.colors.textSecondary }}>
                Active Days
              </div>
              <div className="text-2xl font-bold" style={{ color: theme.colors.secondary }}>
                <GradientText animationSpeed={5}>
                  {weeklyAnalytics.dailyActivity 
                    ? weeklyAnalytics.dailyActivity.filter((d: any) => d.hours > 0).length
                    : 0} / 7
                </GradientText>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Mode Toggle */}
      <div className="mb-8 flex justify-center">
        <div 
          className="inline-flex rounded-lg backdrop-blur-lg border p-1"
          style={{
            backgroundColor: `${theme.colors.surface}80`,
            borderColor: `${theme.colors.primary}33`,
          }}
        >
          <button
            onClick={() => setViewMode('daily')}
            className={`cursor-target px-6 py-2 rounded-md font-medium transition-all duration-200`}
            style={{
              backgroundColor: viewMode === 'daily' ? theme.colors.primary : 'transparent',
              color: viewMode === 'daily' ? '#ffffff' : theme.colors.textSecondary,
            }}
            onMouseEnter={(e) => {
              if (viewMode !== 'daily') {
                e.currentTarget.style.color = theme.colors.text;
              }
            }}
            onMouseLeave={(e) => {
              if (viewMode !== 'daily') {
                e.currentTarget.style.color = theme.colors.textSecondary;
              }
            }}
          >
            Daily View
          </button>
          <button
            onClick={() => setViewMode('weekly')}
            className={`cursor-target px-6 py-2 rounded-md font-medium transition-all duration-200`}
            style={{
              backgroundColor: viewMode === 'weekly' ? theme.colors.primary : 'transparent',
              color: viewMode === 'weekly' ? '#ffffff' : theme.colors.textSecondary,
            }}
            onMouseEnter={(e) => {
              if (viewMode !== 'weekly') {
                e.currentTarget.style.color = theme.colors.text;
              }
            }}
            onMouseLeave={(e) => {
              if (viewMode !== 'weekly') {
                e.currentTarget.style.color = theme.colors.textSecondary;
              }
            }}
          >
            Weekly View
          </button>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div 
          className="backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
          style={{
            backgroundColor: `${theme.colors.surface}80`,
            borderColor: theme.colors.border,
          }}
        >
          <h2 className="text-xl font-bold mb-4">
            <GradientText animationSpeed={7}>
              {viewMode === 'daily' ? 'Hourly Activity (Last 7 Days)' : 'Daily Activity (Last 7 Days)'}
            </GradientText>
          </h2>
          <div style={{ height: '300px' }}>
            <Line data={dailyData} options={lineChartOptions} />
          </div>
        </div>

        <div 
          className="backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
          style={{
            backgroundColor: `${theme.colors.surface}80`,
            borderColor: theme.colors.border,
          }}
        >
          <h2 className="text-xl font-bold mb-4">
            <GradientText animationSpeed={7}>
              {viewMode === 'daily' ? 'Tech Stack Today' : 'Tech Stack This Week'}
            </GradientText>
          </h2>
          <div style={{ height: '300px' }}>
            <Pie data={languageData} options={pieChartOptions} />
          </div>
        </div>
      </div>

      {/* Time Slot Selection (Daily View Only) */}
      {viewMode === 'daily' && (
        <div 
          className="backdrop-blur-lg rounded-xl p-6 border transition-all duration-300"
          style={{
            backgroundColor: `${theme.colors.surface}80`,
            borderColor: theme.colors.border,
          }}
        >
          <h2 className="text-xl font-bold mb-4">
            <GradientText animationSpeed={7}>
              Drill Down: Select a 2-Hour Time Slot
            </GradientText>
          </h2>
          <p className="mb-4 text-sm" style={{ color: theme.colors.textSecondary }}>
            Click on any time slot below to see detailed analysis of your activity during that period
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map((hour) => (
              <button
                key={hour}
                onClick={() => handleTimeSlotClick(hour, hour + 2)}
                className="cursor-target px-4 py-3 rounded-lg border-2 transition-all duration-200 hover:scale-105 hover:shadow-lg"
                style={{
                  backgroundColor: `${theme.colors.surface}60`,
                  borderColor: `${theme.colors.primary}60`,
                  color: theme.colors.text,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = `${theme.colors.primary}20`;
                  e.currentTarget.style.borderColor = theme.colors.primary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = `${theme.colors.surface}60`;
                  e.currentTarget.style.borderColor = `${theme.colors.primary}60`;
                }}
              >
                <div className="text-center">
                  <div className="text-xs font-medium mb-1" style={{ color: theme.colors.textSecondary }}>
                    {hour.toString().padStart(2, '0')}:00 - {(hour + 2).toString().padStart(2, '0')}:00
                  </div>
                  <div className="text-lg font-bold">
                    <GradientText animationSpeed={6}>
                      <Clock className="w-5 h-5 mx-auto" />
                    </GradientText>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  );
}
