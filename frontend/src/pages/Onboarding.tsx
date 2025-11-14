import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Copy, ExternalLink, Download, Key, ArrowRight } from 'lucide-react';
import { API_URL } from '../config';

const Onboarding = () => {
    const [apiKey, setApiKey] = useState('');
    const [userName, setUserName] = useState('');
    const [copied, setCopied] = useState(false);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

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
                setApiKey(data.user.apiKey);
                setUserName(data.user.name);
            }
        } catch (error) {
            console.error('Failed to fetch profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const copyApiKey = () => {
        navigator.clipboard.writeText(apiKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const completeOnboarding = async () => {
        try {
            await fetch(`${API_URL}/api/user/complete-onboarding`, {
                method: 'POST',
                credentials: 'include'
            });
            navigate('/dashboard');
        } catch (error) {
            console.error('Failed to complete onboarding:', error);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#1a1a2e] to-[#16213e] flex items-center justify-center">
                <div className="text-white text-xl">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#1a1a2e] to-[#16213e] py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Welcome Header */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 mb-6">
                        <Key className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-4xl font-bold text-white mb-4">
                        Welcome to CodeTrackr, {userName}! 🎉
                    </h1>
                    <p className="text-gray-300 text-lg">
                        Let's get your VS Code extension connected
                    </p>
                </div>

                {/* API Key Section */}
                <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-8 mb-8 border border-white/10">
                    <div className="flex items-start gap-4 mb-6">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <span className="text-blue-400 font-bold">1</span>
                        </div>
                        <div className="flex-1">
                            <h2 className="text-2xl font-bold text-white mb-2">Your API Key</h2>
                            <p className="text-gray-400">
                                This unique key connects your VS Code extension to your CodeTrackr account.
                                Keep it secure and never share it publicly.
                            </p>
                        </div>
                    </div>

                    <div className="bg-black/30 rounded-lg p-6 border border-white/10">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 font-mono text-white bg-black/40 px-4 py-3 rounded-lg overflow-x-auto">
                                {apiKey}
                            </div>
                            <button
                                onClick={copyApiKey}
                                className="flex-shrink-0 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
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
                        </div>
                    </div>
                </div>

                {/* Installation Steps */}
                <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-8 mb-8 border border-white/10">
                    <div className="flex items-start gap-4 mb-6">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                            <span className="text-purple-400 font-bold">2</span>
                        </div>
                        <div className="flex-1">
                            <h2 className="text-2xl font-bold text-white mb-2">Install Extension</h2>
                            <p className="text-gray-400">
                                Install the CodeTrackr extension from VS Code Marketplace
                            </p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-black/30 rounded-lg p-6 border border-white/10">
                            <h3 className="text-white font-semibold mb-3">Option 1: Install from VS Code</h3>
                            <ol className="space-y-2 text-gray-300">
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-400 font-bold">•</span>
                                    Open VS Code
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-400 font-bold">•</span>
                                    Press <code className="bg-black/40 px-2 py-1 rounded text-sm">Ctrl+Shift+X</code> (or <code className="bg-black/40 px-2 py-1 rounded text-sm">Cmd+Shift+X</code> on Mac)
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-400 font-bold">•</span>
                                    Search for "CodeTrackr"
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-400 font-bold">•</span>
                                    Click "Install"
                                </li>
                            </ol>
                        </div>

                        <div className="bg-black/30 rounded-lg p-6 border border-white/10">
                            <h3 className="text-white font-semibold mb-3">Option 2: Install from Marketplace</h3>
                            <a
                                href="https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER.codetrackr"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg transition-all"
                            >
                                <Download className="w-5 h-5" />
                                Open Marketplace
                                <ExternalLink className="w-4 h-4" />
                            </a>
                        </div>
                    </div>
                </div>

                {/* Configuration Steps */}
                <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-8 mb-8 border border-white/10">
                    <div className="flex items-start gap-4 mb-6">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                            <span className="text-green-400 font-bold">3</span>
                        </div>
                        <div className="flex-1">
                            <h2 className="text-2xl font-bold text-white mb-2">Configure Extension</h2>
                            <p className="text-gray-400">
                                Enter your API key when prompted by the extension
                            </p>
                        </div>
                    </div>

                    <div className="bg-black/30 rounded-lg p-6 border border-white/10">
                        <ol className="space-y-3 text-gray-300">
                            <li className="flex items-start gap-3">
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">1</span>
                                <span>After installation, the extension will prompt you for an API key</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">2</span>
                                <span>Paste your API key (copied above) into the input field</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm">3</span>
                                <span>Start coding! Your activity will be automatically tracked</span>
                            </li>
                        </ol>
                    </div>
                </div>

                {/* Complete Button */}
                <div className="text-center">
                    <button
                        onClick={completeOnboarding}
                        className="px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl text-lg font-semibold transition-all inline-flex items-center gap-3 shadow-lg shadow-blue-500/25"
                    >
                        Continue to Dashboard
                        <ArrowRight className="w-6 h-6" />
                    </button>
                    <p className="text-gray-400 mt-4 text-sm">
                        You can always find your API key in your profile settings
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Onboarding;
