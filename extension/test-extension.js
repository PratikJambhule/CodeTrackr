const axios = require('axios');

const API_BASE = 'http://127.0.0.1:5050';
const TEST_API_KEY = 'YOUR_API_KEY_HERE'; // Replace with your actual API key

async function testBackendConnection() {
    console.log('🔍 Testing CodeTrackr Backend Connection...\n');

    // Test 1: Check if backend is running
    console.log('Test 1: Checking if backend is running...');
    try {
        const response = await axios.get(`${API_BASE}/api/extension/verify`, {
            headers: { 'x-api-key': TEST_API_KEY },
            timeout: 5000
        });
        console.log('✅ Backend is running');
        console.log('✅ API Key is valid');
        console.log(`✅ Connected as: ${response.data.user.name} (${response.data.user.email})\n`);
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.log('❌ Backend is NOT running');
            console.log('💡 Start backend with: cd backend && npm start\n');
            return false;
        } else if (error.response?.status === 401) {
            console.log('❌ Invalid API Key');
            console.log('💡 Get your API key from: http://localhost:5173/profile\n');
            return false;
        } else {
            console.log('❌ Error:', error.message);
            return false;
        }
    }

    // Test 2: Send a test activity
    console.log('Test 2: Sending test activity...');
    try {
        const testActivity = {
            timestamp: new Date().toISOString(),
            fileName: 'test.js',
            fileType: '.js',
            projectName: 'TestProject',
            language: 'javascript',
            duration: 60, // 60 seconds = 1 minute
            linesAdded: 10,
            linesRemoved: 2
        };

        const response = await axios.post(
            `${API_BASE}/api/extension/track`,
            testActivity,
            {
                headers: {
                    'x-api-key': TEST_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('✅ Test activity sent successfully');
        console.log(`✅ Activity ID: ${response.data.activity.id}`);
        console.log(`✅ Duration: ${response.data.activity.duration} seconds\n`);
    } catch (error) {
        console.log('❌ Failed to send test activity');
        console.log('Error:', error.response?.data?.message || error.message);
        return false;
    }

    console.log('✅ All tests passed! Extension should work correctly.\n');
    return true;
}

// Run tests
testBackendConnection().then(success => {
    if (success) {
        console.log('📋 Next Steps:');
        console.log('1. Reload VS Code window (Ctrl+Shift+P -> "Developer: Reload Window")');
        console.log('2. Configure API key in VS Code (Ctrl+Shift+P -> "CodeTrackr: Setup API Key")');
        console.log('3. Start tracking (Ctrl+Shift+P -> "CodeTrackr: Start Tracking")');
        console.log('4. Make some code changes and wait 30 seconds');
        console.log('5. You should see "CodeTrackr: Activity tracked ✅" in status bar\n');
    } else {
        console.log('💡 Fix the issues above and run this script again.');
    }
});
