import { useState, useEffect } from 'react';
import { Users2, Lock, Search, Plus, ArrowRight, Trophy, Users, X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import GradientText from '../components/GradientText';
import TextType from '../components/TextType';

interface Group {
  _id: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  createdBy: {
    _id: string;
    name: string;
    email: string;
  };
  createdAt: string;
}

interface Member {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  userName: string;
  email: string;
  codingHours: number;
  totalLinesAdded: number;
}

interface GroupDetails {
  group: Group;
  members: Member[];
  leaderboard: LeaderboardEntry[];
}

export default function Groups({ user }: { user: any }) {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState<'my-groups' | 'discover'>('my-groups');
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [discoverGroups, setDiscoverGroups] = useState<Group[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Create group form
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [password, setPassword] = useState('');

  // Join group password
  const [joinPassword, setJoinPassword] = useState('');

  useEffect(() => {
    if (activeTab === 'my-groups') {
      fetchMyGroups();
    } else {
      fetchDiscoverGroups();
    }
  }, [activeTab]);

  const fetchMyGroups = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:5050/api/groups/my-groups', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setMyGroups(data.groups);
      } else {
        const error = await res.json();
        console.error('Error fetching my groups:', error);
        if (res.status === 401) {
          alert('Please log in again. Your session may have expired.');
        }
      }
    } catch (error) {
      console.error('Error fetching my groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDiscoverGroups = async () => {
    setLoading(true);
    try {
      const url = searchQuery
        ? `http://localhost:5050/api/groups/discover?search=${encodeURIComponent(searchQuery)}`
        : 'http://localhost:5050/api/groups/discover';
      
      const res = await fetch(url, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        console.log('Discover groups:', data);
        setDiscoverGroups(data.groups);
      } else {
        const error = await res.json();
        console.error('Error fetching discover groups:', error);
        if (res.status === 401) {
          alert('Please log in again. Your session may have expired.');
        }
      }
    } catch (error) {
      console.error('Error fetching discover groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    if (activeTab === 'discover') {
      fetchDiscoverGroups();
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:5050/api/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ groupName, groupDescription, visibility, password })
      });

      if (res.ok) {
        const data = await res.json();
        alert('Group created successfully!');
        setShowCreateModal(false);
        setGroupName('');
        setGroupDescription('');
        setVisibility('public');
        setPassword('');
        fetchMyGroups();
      } else {
        const error = await res.json();
        alert(error.message || 'Failed to create group');
      }
    } catch (error) {
      console.error('Error creating group:', error);
      alert('Failed to create group');
    }
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;

    try {
      const res = await fetch(`http://localhost:5050/api/groups/${selectedGroup._id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: joinPassword })
      });

      if (res.ok) {
        alert('Successfully joined the group!');
        setShowJoinModal(false);
        setJoinPassword('');
        setSelectedGroup(null);
        fetchDiscoverGroups();
        fetchMyGroups();
      } else {
        const error = await res.json();
        alert(error.message || 'Failed to join group');
      }
    } catch (error) {
      console.error('Error joining group:', error);
      alert('Failed to join group');
    }
  };

  const handleViewDetails = async (group: Group) => {
    try {
      const res = await fetch(`http://localhost:5050/api/groups/${group._id}/details`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setGroupDetails(data);
        setShowDetailsModal(true);
      } else {
        alert('Failed to fetch group details');
      }
    } catch (error) {
      console.error('Error fetching group details:', error);
      alert('Failed to fetch group details');
    }
  };

  const handleJoinClick = async (group: Group) => {
    setSelectedGroup(group);
    
    if (group.visibility === 'public') {
      // Join public groups directly (no password needed)
      try {
        const res = await fetch(`http://localhost:5050/api/groups/${group._id}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({})
        });
        
        if (res.ok) {
          alert('Successfully joined the group!');
          fetchDiscoverGroups();
          fetchMyGroups();
        } else {
          const error = await res.json();
          alert(error.message || 'Failed to join group');
        }
      } catch (error) {
        console.error('Error joining group:', error);
        alert('Failed to join group');
      }
    } else {
      // Show password modal for private groups
      setShowJoinModal(true);
    }
  };

  const handleLeaveGroup = async (groupId: string) => {
    if (!window.confirm('Are you sure you want to leave this group?')) {
      return;
    }

    try {
      const res = await fetch(`http://localhost:5050/api/groups/${groupId}/leave`, {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        alert('You have left the group successfully!');
        setShowDetailsModal(false);
        setGroupDetails(null);
        fetchMyGroups();
        fetchDiscoverGroups();
      } else {
        const error = await res.json();
        alert(error.message || 'Failed to leave group');
      }
    } catch (error) {
      console.error('Error leaving group:', error);
      alert('Failed to leave group');
    }
  };

  return (
    <div 
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen transition-colors duration-300"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">
            <TextType
              text={["Groups"]}
              typingSpeed={75}
              pauseDuration={1500}
              showCursor={true}
              cursorCharacter="|"
              loop={false}
              textColors={[theme.colors.primary]}
              className="inline-block"
            />
          </h1>
          <p style={{ color: theme.colors.textSecondary }}>Join coding communities and compete with peers</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="cursor-target flex items-center gap-2 px-6 py-3 rounded-lg transition font-medium text-white"
          style={{ background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})` }}
        >
          <Plus className="w-5 h-5" />
          Create Group
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setActiveTab('my-groups')}
          className={`cursor-target px-6 py-3 rounded-lg font-medium transition`}
          style={{
            backgroundColor: activeTab === 'my-groups' ? theme.colors.primary : `${theme.colors.surface}80`,
            color: activeTab === 'my-groups' ? '#ffffff' : theme.colors.textSecondary,
          }}
        >
          <Users2 className="w-5 h-5 inline mr-2" />
          My Groups
        </button>
        <button
          onClick={() => setActiveTab('discover')}
          className={`cursor-target px-6 py-3 rounded-lg font-medium transition`}
          style={{
            backgroundColor: activeTab === 'discover' ? theme.colors.primary : `${theme.colors.surface}80`,
            color: activeTab === 'discover' ? '#ffffff' : theme.colors.textSecondary,
          }}
        >
          <Search className="w-5 h-5 inline mr-2" />
          Discover
        </button>
      </div>

      {/* Search Bar (Discover Tab Only) */}
      {activeTab === 'discover' && (
        <div className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search groups by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1 px-4 py-3 rounded-lg border focus:outline-none transition"
              style={{
                backgroundColor: `${theme.colors.surface}80`,
                borderColor: theme.colors.border,
                color: theme.colors.text,
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = theme.colors.primary}
              onBlur={(e) => e.currentTarget.style.borderColor = theme.colors.border}
            />
            <button
              onClick={handleSearch}
              className="cursor-target px-6 py-3 rounded-lg transition text-white"
              style={{ background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})` }}
            >
              <Search className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Groups List */}
      {loading ? (
        <div className="text-center text-xl py-12" style={{ color: theme.colors.text }}>Loading...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {activeTab === 'my-groups'
            ? myGroups.map((group) => (
                <GroupCard
                  key={group._id}
                  group={group}
                  onAction={() => handleViewDetails(group)}
                  actionLabel="View Details"
                  theme={theme}
                />
              ))
            : discoverGroups.map((group) => (
                <GroupCard
                  key={group._id}
                  group={group}
                  onAction={() => handleJoinClick(group)}
                  actionLabel="Join Group"
                  theme={theme}
                />
              ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && activeTab === 'my-groups' && myGroups.length === 0 && (
        <div className="text-center py-12">
          <Users2 className="w-16 h-16 mx-auto mb-4" style={{ color: theme.colors.textSecondary }} />
          <h3 className="text-xl font-semibold mb-2" style={{ color: theme.colors.text }}>No Groups Yet</h3>
          <p className="mb-4" style={{ color: theme.colors.textSecondary }}>Join or create a group to get started!</p>
        </div>
      )}

      {!loading && activeTab === 'discover' && discoverGroups.length === 0 && (
        <div className="text-center py-12">
          <Search className="w-16 h-16 mx-auto mb-4" style={{ color: theme.colors.textSecondary }} />
          <h3 className="text-xl font-semibold mb-2" style={{ color: theme.colors.text }}>No Groups Found</h3>
          <p style={{ color: theme.colors.textSecondary }}>Try a different search term or create a new group!</p>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} title="Create New Group" theme={theme}>
          <form onSubmit={handleCreateGroup} className="space-y-4">
            <div>
              <label className="block mb-2" style={{ color: theme.colors.text }}>Group Name *</label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
                className="w-full px-4 py-2 border rounded-lg focus:outline-none transition"
                style={{
                  backgroundColor: `${theme.colors.surface}80`,
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = theme.colors.primary}
                onBlur={(e) => e.currentTarget.style.borderColor = theme.colors.border}
              />
            </div>
            <div>
              <label className="block mb-2" style={{ color: theme.colors.text }}>Description *</label>
              <textarea
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                required
                rows={3}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none transition"
                style={{
                  backgroundColor: `${theme.colors.surface}80`,
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = theme.colors.primary}
                onBlur={(e) => e.currentTarget.style.borderColor = theme.colors.border}
              />
            </div>
            <div>
              <label className="block mb-2" style={{ color: theme.colors.text }}>Visibility *</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none transition"
                style={{
                  backgroundColor: `${theme.colors.surface}80`,
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = theme.colors.primary}
                onBlur={(e) => e.currentTarget.style.borderColor = theme.colors.border}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
            {visibility === 'private' && (
              <div>
                <label className="block mb-2" style={{ color: theme.colors.text }}>Password *</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={visibility === 'private'}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none transition"
                  style={{
                    backgroundColor: `${theme.colors.surface}80`,
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = theme.colors.primary}
                  onBlur={(e) => e.currentTarget.style.borderColor = theme.colors.border}
                />
              </div>
            )}
            <button
              type="submit"
              className="cursor-target w-full py-3 rounded-lg font-semibold transition text-white"
              style={{ background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})` }}
            >
              Create Group
            </button>
          </form>
        </Modal>
      )}

      {/* Join Private Group Modal */}
      {showJoinModal && selectedGroup && (
        <Modal onClose={() => setShowJoinModal(false)} title={`Join ${selectedGroup.name}`} theme={theme}>
          <form onSubmit={handleJoinGroup} className="space-y-4">
            <p style={{ color: theme.colors.textSecondary }}>This is a private group. Please enter the password to join.</p>
            <div>
              <label className="block mb-2" style={{ color: theme.colors.text }}>Password</label>
              <input
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                required
                className="w-full px-4 py-2 border rounded-lg focus:outline-none transition"
                style={{
                  backgroundColor: `${theme.colors.surface}80`,
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = theme.colors.primary}
                onBlur={(e) => e.currentTarget.style.borderColor = theme.colors.border}
              />
            </div>
            <button
              type="submit"
              className="cursor-target w-full px-4 py-3 rounded-lg transition font-medium text-white"
              style={{ background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})` }}
            >
              Join Group
            </button>
          </form>
        </Modal>
      )}

      {/* Group Details Modal */}
      {showDetailsModal && groupDetails && (
        <Modal 
          onClose={() => {
            setShowDetailsModal(false);
            setGroupDetails(null);
          }} 
          title={groupDetails.group.name}
          large
          theme={theme}
        >
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <p className="flex-1" style={{ color: theme.colors.textSecondary }}>{groupDetails.group.description}</p>
              <button
                onClick={() => handleLeaveGroup(groupDetails.group._id)}
                className="cursor-target ml-4 px-4 py-2 rounded-lg transition font-medium flex items-center gap-2"
                style={{
                  backgroundColor: `${theme.colors.accent}30`,
                  color: theme.colors.accent,
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.accent}40`}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.accent}30`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Leave Group
              </button>
            </div>

            {/* Members Section */}
            <div>
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2" style={{ color: theme.colors.text }}>
                <Users className="w-5 h-5" />
                Groupmates ({groupDetails.members.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {groupDetails.members.map((member) => (
                  <div 
                    key={member.id} 
                    className="rounded-lg p-3 flex items-center gap-3"
                    style={{ backgroundColor: `${theme.colors.surface}80` }}
                  >
                    <div 
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                      style={{ backgroundColor: theme.colors.primary }}
                    >
                      {member.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate" style={{ color: theme.colors.text }}>{member.name}</div>
                      <div className="text-sm truncate" style={{ color: theme.colors.textSecondary }}>{member.email}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Leaderboard Section */}
            <div>
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2" style={{ color: theme.colors.text }}>
                <Trophy className="w-5 h-5" />
                Leaderboard
              </h3>
              <div className="rounded-lg overflow-hidden" style={{ backgroundColor: `${theme.colors.surface}80` }}>
                <table className="w-full">
                  <thead style={{ backgroundColor: `${theme.colors.surface}cc` }}>
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold" style={{ color: theme.colors.text }}>Rank</th>
                      <th className="px-4 py-3 text-left font-semibold" style={{ color: theme.colors.text }}>Name</th>
                      <th className="px-4 py-3 text-right font-semibold" style={{ color: theme.colors.text }}>Hours</th>
                      <th className="px-4 py-3 text-right font-semibold" style={{ color: theme.colors.text }}>Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupDetails.leaderboard.map((entry) => (
                      <tr key={entry.userId} style={{ borderTop: `1px solid ${theme.colors.border}` }}>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold ${
                            entry.rank === 1 ? 'bg-yellow-500 text-yellow-900' :
                            entry.rank === 2 ? 'bg-gray-400 text-gray-900' :
                            entry.rank === 3 ? 'bg-orange-600 text-orange-100' : ''
                          }`}
                          style={entry.rank > 3 ? { backgroundColor: `${theme.colors.surface}cc`, color: theme.colors.text } : {}}
                          >
                            {entry.rank}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium" style={{ color: theme.colors.text }}>{entry.userName}</div>
                          <div className="text-sm" style={{ color: theme.colors.textSecondary }}>{entry.email}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: theme.colors.text }}>
                          <GradientText animationSpeed={4}>
                            {entry.codingHours}h
                          </GradientText>
                        </td>
                        <td className="px-4 py-3 text-right" style={{ color: theme.colors.textSecondary }}>
                          <GradientText animationSpeed={4}>
                            {entry.totalLinesAdded.toLocaleString()}
                          </GradientText>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {groupDetails.leaderboard.length === 0 && (
                  <div className="text-center py-8" style={{ color: theme.colors.textSecondary }}>
                    No activity data yet. Start coding to appear on the leaderboard!
                  </div>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function GroupCard({ group, onAction, actionLabel, theme }: { 
  group: Group; 
  onAction: () => void;
  actionLabel: string;
  theme: any;
}) {
  return (
    <div 
      className="backdrop-blur-lg rounded-xl p-6 hover:scale-105 transition-all border"
      style={{
        backgroundColor: `${theme.colors.surface}cc`,
        borderColor: theme.colors.border,
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = theme.colors.primary}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = theme.colors.border}
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-xl font-bold flex items-center gap-2" style={{ color: theme.colors.text }}>
          {group.name}
          {group.visibility === 'private' && <Lock className="w-4 h-4" style={{ color: theme.colors.textSecondary }} />}
        </h3>
      </div>
      <p className="mb-4 line-clamp-2" style={{ color: theme.colors.textSecondary }}>{group.description}</p>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm" style={{ color: theme.colors.textSecondary }}>
          by {group.createdBy?.name || 'Unknown'}
        </span>
        <span 
          className="px-2 py-1 rounded text-xs font-medium"
          style={{
            backgroundColor: group.visibility === 'public' 
              ? `${theme.colors.accent}30` 
              : `${theme.colors.primary}30`,
            color: group.visibility === 'public' ? theme.colors.accent : theme.colors.primary
          }}
        >
          {group.visibility}
        </span>
      </div>
      <button
        onClick={onAction}
        className="cursor-target w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition font-medium"
        style={{
          backgroundColor: `${theme.colors.primary}30`,
          color: theme.colors.primary,
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.primary}40`}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.primary}30`}
      >
        {actionLabel}
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function Modal({ 
  children, 
  onClose, 
  title,
  large = false,
  theme
}: { 
  children: React.ReactNode; 
  onClose: () => void;
  title: string;
  large?: boolean;
  theme: any;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div 
        className={`rounded-xl border ${large ? 'max-w-4xl' : 'max-w-md'} w-full max-h-[90vh] overflow-y-auto`}
        style={{
          backgroundColor: theme.colors.surface,
          borderColor: `${theme.colors.primary}40`,
        }}
      >
        <div 
          className="sticky top-0 border-b px-6 py-4 flex items-center justify-between"
          style={{
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          }}
        >
          <h2 className="text-2xl font-bold" style={{ color: theme.colors.text }}>{title}</h2>
          <button
            onClick={onClose}
            className="cursor-target transition"
            style={{ color: theme.colors.textSecondary }}
            onMouseEnter={(e) => e.currentTarget.style.color = theme.colors.text}
            onMouseLeave={(e) => e.currentTarget.style.color = theme.colors.textSecondary}
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
