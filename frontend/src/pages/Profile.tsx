import { useState, useEffect } from 'react';
import { Key, Copy, CheckCircle, RefreshCw, Mail, Calendar, AlertCircle } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import GradientText from '../components/GradientText';
import TextType from '../components/TextType';
import { API_URL } from '../config';
import DeviceList from '../components/DeviceList';

const Profile = () => {
    const { theme } = useTheme();
    const [user, setUser] = useState<{
        name: string;
        email: string;
        profilePictureUrl: string;
        // The key itself is only ever shown right after it is created: the
        // server stores a hash, so the profile returns a hint (ct_<id>_…last4).
        hasApiKey: boolean;
        apiKeyHint: string | null;
        legacyApiKey: boolean;
        createdAt: string;
    } | null>(null);
    const [newKey, setNewKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    useEffect(() => {
        fetchUserProfile();
    }, []);

    const fetchUserProfile = async () => {
        try {
            const response = await fetch(`${API_URL}/api/user/profile`, {
                credentials: 'include'
            });
            const data = await response.json();
            
            if (data.success) {
                setUser(data.user);
            }
        } catch (error) {
            console.error('Failed to fetch profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const copyApiKey = () => {
        if (newKey) {
            navigator.clipboard.writeText(newKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const regenerateApiKey = async () => {
        setRegenerating(true);
        try {
            const response = await fetch(`${API_URL}/api/user/regenerate-api-key`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await response.json();
            
            if (data.success && user) {
                setNewKey(data.apiKey);
                setUser({ ...user, hasApiKey: true, apiKeyHint: data.apiKeyHint, legacyApiKey: false });
                setShowConfirm(false);
            }
        } catch (error) {
            console.error('Failed to regenerate API key:', error);
        } finally {
            setRegenerating(false);
        }
    };

    if (loading) {
        return (
            <div 
                className="min-h-screen flex items-center justify-center transition-colors duration-300"
                style={{ backgroundColor: theme.colors.background }}
            >
                <div className="text-xl" style={{ color: theme.colors.text }}>Loading...</div>
            </div>
        );
    }

    return (
        <div 
            className="min-h-screen py-12 px-4 transition-colors duration-300"
            style={{ backgroundColor: theme.colors.background }}
        >
            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-bold mb-8">
                    <TextType
                        text={["Profile Settings"]}
                        typingSpeed={75}
                        pauseDuration={1500}
                        showCursor={true}
                        cursorCharacter="|"
                        loop={false}
                        textColors={[theme.colors.primary]}
                        className="inline-block"
                    />
                </h1>

                {/* User Info Card */}
                <div 
                    className="backdrop-blur-lg rounded-2xl p-8 mb-6 border transition-all duration-300"
                    style={{
                        backgroundColor: `${theme.colors.surface}cc`,
                        borderColor: `${theme.colors.primary}40`,
                    }}
                >
                    <div className="flex items-start gap-6">
                        <img
                            src={user?.profilePictureUrl}
                            alt={user?.name}
                            className="w-24 h-24 rounded-full border-4"
                            style={{ borderColor: `${theme.colors.primary}50` }}
                        />
                        <div className="flex-1">
                            <h2 className="text-2xl font-bold mb-4">
                                <GradientText animationSpeed={5}>
                                    {user?.name}
                                </GradientText>
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="flex items-center gap-3" style={{ color: theme.colors.textSecondary }}>
                                    <Mail className="w-5 h-5" style={{ color: theme.colors.primary }} />
                                    <span>{user?.email}</span>
                                </div>
                                <div className="flex items-center gap-3" style={{ color: theme.colors.textSecondary }}>
                                    <Calendar className="w-5 h-5" style={{ color: theme.colors.accent }} />
                                    <span>Joined {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* API Key Card */}
                <div 
                    className="backdrop-blur-lg rounded-2xl p-8 border transition-all duration-300"
                    style={{
                        backgroundColor: `${theme.colors.surface}cc`,
                        borderColor: `${theme.colors.primary}40`,
                    }}
                >
                    <div className="flex items-center gap-3 mb-6">
                        <Key className="w-6 h-6" style={{ color: theme.colors.primary }} />
                        <h2 className="text-2xl font-bold">
                            <GradientText animationSpeed={7}>
                                API Key
                            </GradientText>
                        </h2>
                    </div>

                    <p className="mb-6" style={{ color: theme.colors.textSecondary }}>
                        Your API key is used to authenticate your VS Code extension with CodeTrackr.
                        Keep it secure and never share it publicly.
                    </p>

                    {/* API Key Display */}
                    <div 
                        className="rounded-lg p-6 border mb-6"
                        style={{
                            backgroundColor: `${theme.colors.background}80`,
                            borderColor: theme.colors.border,
                        }}
                    >
                        <div className="flex items-center gap-4">
                            <div 
                                className="flex-1 font-mono px-4 py-3 rounded-lg overflow-x-auto"
                                style={{
                                    color: theme.colors.text,
                                    backgroundColor: `${theme.colors.surface}60`,
                                }}
                            >
                                {newKey
                                    || user?.apiKeyHint
                                    || (user?.legacyApiKey
                                        ? 'Old-format key (still works). Generate a new one to upgrade.'
                                        : 'No API key yet. Generate one below.')}
                            </div>
                            {/* Only a freshly created key can be copied: the server keeps a hash,
                                so afterwards there is nothing to copy, just a hint (ct_<id>_…last4). */}
                            {newKey && (
                            <button
                                onClick={copyApiKey}
                                className="flex-shrink-0 px-6 py-3 text-white rounded-lg transition-all flex items-center gap-2"
                                style={{
                                    background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})`,
                                }}
                            >
                                {copied ? (
                                    <>
                                        <CheckCircle className="w-5 h-5" />
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-5 h-5" />
                                        Copy
                                    </>
                                )}
                            </button>
                            )}
                        </div>
                    </div>

                    {!newKey && user?.apiKeyHint && (
                        <p className="mb-6 text-sm" style={{ color: theme.colors.textSecondary }}>
                            This is a hint of your active key (its ID and last 4 characters), not the key itself.
                            Keys are stored hashed, so the full key is only shown once, when it is created.
                            To connect VS Code, run <strong>CodeTrackr: Sign In</strong> there, or regenerate below
                            to get a new key to paste.
                        </p>
                    )}

                    {newKey && (
                        <p role="status" className="mb-6 text-sm" style={{ color: theme.colors.accent }}>
                            Copy this key now and paste it into VS Code (CodeTrackr: Setup API Key).
                            It is stored hashed, so it will not be shown again.
                        </p>
                    )}

                    {/* Regenerate Section */}
                    {!showConfirm ? (
                        <div 
                            className="flex items-start gap-4 border rounded-lg p-4"
                            style={{
                                backgroundColor: `${theme.colors.accent}20`,
                                borderColor: `${theme.colors.accent}50`,
                            }}
                        >
                            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: theme.colors.accent }} />
                            <div className="flex-1">
                                <h3 className="font-semibold mb-2" style={{ color: theme.colors.accent }}>Regenerate API Key</h3>
                                <p className="text-sm mb-4" style={{ color: theme.colors.textSecondary }}>
                                    If you suspect your API key has been compromised, you can generate a new one.
                                    Your old key will be immediately invalidated.
                                </p>
                                <button
                                    onClick={() => setShowConfirm(true)}
                                    className="px-6 py-2 rounded-lg transition-all flex items-center gap-2 text-white"
                                    style={{
                                        backgroundColor: theme.colors.accent,
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                                    onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Regenerate Key
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div 
                            className="border rounded-lg p-6"
                            style={{
                                backgroundColor: `${theme.colors.accent}20`,
                                borderColor: `${theme.colors.accent}50`,
                            }}
                        >
                            <h3 className="font-semibold mb-2 flex items-center gap-2" style={{ color: theme.colors.accent }}>
                                <AlertCircle className="w-5 h-5" />
                                Confirm Regeneration
                            </h3>
                            <p className="mb-4" style={{ color: theme.colors.textSecondary }}>
                                Are you sure? This will invalidate your current API key and you'll need to
                                update it in your VS Code extension.
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={regenerateApiKey}
                                    disabled={regenerating}
                                    className="px-6 py-2 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-2"
                                    style={{
                                        backgroundColor: theme.colors.accent,
                                    }}
                                    onMouseEnter={(e) => !regenerating && (e.currentTarget.style.opacity = '0.9')}
                                    onMouseLeave={(e) => !regenerating && (e.currentTarget.style.opacity = '1')}
                                >
                                    {regenerating ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            Regenerating...
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle className="w-4 h-4" />
                                            Yes, Regenerate
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => setShowConfirm(false)}
                                    disabled={regenerating}
                                    className="px-6 py-2 disabled:opacity-50 rounded-lg transition-all"
                                    style={{
                                        backgroundColor: `${theme.colors.surface}80`,
                                        color: theme.colors.text,
                                    }}
                                    onMouseEnter={(e) => !regenerating && (e.currentTarget.style.backgroundColor = `${theme.colors.surface}cc`)}
                                    onMouseLeave={(e) => !regenerating && (e.currentTarget.style.backgroundColor = `${theme.colors.surface}80`)}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <DeviceList />
            </div>
        </div>
    );
};

export default Profile;
