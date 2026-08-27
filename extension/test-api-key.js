const axios = require('axios');

// IMPORTANT: Replace this with your actual API key from the dashboard
const YOUR_API_KEY = 'PASTE_YOUR_API_KEY_HERE';
const API_BASE = 'http://127.0.0.1:5050';

async function testApiKey() {
    console.log('🔑 Testing CodeTrackr API Key...\n');
    console.log('Using API base:', API_BASE);
    console.log('API Key length:', YOUR_API_KEY.length, 'characters');
    console.log('API Key (first 10 chars):', YOUR_API_KEY.substring(0, 10) + '...\n');

    // Test 1: Check API key format
    console.log('Test 1: Checking API key format...');
    if (YOUR_API_KEY === 'PASTE_YOUR_API_KEY_HERE') {
        console.log('❌ Please replace PASTE_YOUR_API_KEY_HERE with your actual API key!');
        console.log('💡 Get your API key from: http://localhost:5173/profile\n');
        return;
    }

    if (YOUR_API_KEY.length !== 64) {
        console.log(`⚠️  Warning: API key should be 64 characters, yours is ${YOUR_API_KEY.length}`);
    }

    if (!/^[a-f0-9]+$/i.test(YOUR_API_KEY)) {
        console.log('⚠️  Warning: API key should only contain hexadecimal characters (0-9, a-f)');
    } else {
        console.log('✅ API key format looks correct\n');
    }

    // Test 2: Check if backend is running
    console.log('Test 2: Checking if backend is running...');
    try {
        const healthCheck = await axios.get(`${API_BASE}/`, { timeout: 5000 });
        console.log('✅ Backend is running\n');
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.log('❌ Backend is NOT running!');
            console.log('💡 Start backend with: cd backend && npm start\n');
            return;
        }
    }

    // Test 3: Verify API key with backend
    console.log('Test 3: Verifying API key with backend...');
    try {
        const response = await axios.get(`${API_BASE}/api/extension/verify`, {
            headers: { 'x-api-key': YOUR_API_KEY.trim() },
            timeout: 5000
        });

        console.log('✅ API Key is VALID!');
        console.log('✅ User:', response.data.user.name);
        console.log('✅ Email:', response.data.user.email);
        console.log('✅ User ID:', response.data.user.id);
        console.log('\n🎉 Your API key works perfectly!\n');

        console.log('📋 Next Steps:');
        console.log('1. Copy this API key: ' + YOUR_API_KEY);
        console.log('2. Open VS Code');
        console.log('3. Press Ctrl+Shift+P');
        console.log('4. Type "CodeTrackr: Setup API Key"');
        console.log('5. Paste your API key');
        console.log('6. Wait for "API key configured successfully!" message');
        console.log('7. Extension will auto-start tracking\n');

    } catch (error) {
        if (error.response?.status === 401) {
            console.log('❌ API Key is INVALID!');
            console.log('💡 Get a new API key from: http://localhost:5173/profile');
            console.log('💡 Make sure you copy the ENTIRE key without any extra spaces\n');
        } else {
            console.log('❌ Verification failed:', error.message);
            console.log('Error details:', error.response?.data || error.code);
        }
    }
}

testApiKey();
