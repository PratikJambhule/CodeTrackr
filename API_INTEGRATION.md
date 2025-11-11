# API Key Integration Documentation

## Overview
The CodeTrackr platform now includes a complete API key-based authentication system that allows VS Code extensions to securely track coding activity and sync it with user accounts.

## Architecture

### Backend Components

#### 1. User Model (`backend/models/user.js`)
- **Added Fields:**
  - `apiKey`: Unique 64-character hexadecimal string (generated using crypto.randomBytes(32))
  - `isFirstLogin`: Boolean flag to trigger onboarding flow

- **Methods:**
  - `generateApiKey()`: Creates a new API key using secure random generation

#### 2. Authentication Middleware (`backend/middleware/auth.js`)
- **`isAuthenticated`**: Validates session-based authentication for web users
- **`verifyApiKey`**: Validates API key from `x-api-key` header for extension requests

#### 3. API Routes

##### User Profile Routes (`backend/routes/user.js`)
- `GET /api/user/profile` - Returns user profile including API key
- `POST /api/user/regenerate-api-key` - Generates new API key, invalidates old one
- `POST /api/user/complete-onboarding` - Marks first login complete

##### Extension Routes (`backend/routes/extension.js`)
- `POST /api/extension/track` - Track single coding activity
- `POST /api/extension/track/batch` - Track multiple activities at once
- `GET /api/extension/verify` - Verify API key validity

### Frontend Components

#### 1. Onboarding Page (`frontend/src/pages/Onboarding.tsx`)
**Purpose**: First-time user experience showing API key and setup instructions

**Features:**
- Displays user's unique API key with copy button
- Step-by-step VS Code extension installation guide
- Instructions for API key configuration
- Links to VS Code Marketplace
- Redirects to dashboard after completion

#### 2. Profile Page (`frontend/src/pages/Profile.tsx`)
**Purpose**: User profile management and API key regeneration

**Features:**
- View user profile information
- Display API key with copy functionality
- Regenerate API key with confirmation dialog
- Security warnings about key invalidation

#### 3. App Routing (`frontend/src/App.tsx`)
- Automatic redirect to onboarding for first-time users
- Profile link in navigation bar
- Protected routes requiring authentication

## API Endpoints Reference

### Authentication Endpoints

#### POST /api/extension/track
Track a single coding activity event.

**Headers:**
```
x-api-key: YOUR_API_KEY_HERE
```

**Request Body:**
```json
{
  "fileName": "app.js",
  "fileType": "javascript",
  "projectName": "MyProject",
  "language": "JavaScript",
  "duration": 300,
  "linesAdded": 50,
  "linesRemoved": 20,
  "timestamp": "2024-01-20T10:30:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Activity tracked successfully",
  "activity": {
    "id": "...",
    "fileName": "app.js",
    "language": "JavaScript",
    "duration": 300,
    "timestamp": "2024-01-20T10:30:00Z"
  }
}
```

#### POST /api/extension/track/batch
Track multiple activities in a single request.

**Headers:**
```
x-api-key: YOUR_API_KEY_HERE
```

**Request Body:**
```json
{
  "activities": [
    {
      "fileName": "app.js",
      "language": "JavaScript",
      "duration": 300,
      "linesAdded": 50,
      "linesRemoved": 20
    },
    {
      "fileName": "styles.css",
      "language": "CSS",
      "duration": 120,
      "linesAdded": 30,
      "linesRemoved": 5
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "2 activities tracked successfully",
  "count": 2
}
```

#### GET /api/extension/verify
Verify that an API key is valid.

**Headers:**
```
x-api-key: YOUR_API_KEY_HERE
```

**Response:**
```json
{
  "success": true,
  "message": "API key is valid",
  "user": {
    "id": "...",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

### User Profile Endpoints

#### GET /api/user/profile
Get current user's profile with API key.

**Authentication:** Session-based (cookie)

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "...",
    "name": "John Doe",
    "email": "john@example.com",
    "profilePictureUrl": "https://...",
    "apiKey": "abc123...",
    "isFirstLogin": false,
    "lastLogin": "2024-01-20T10:00:00Z",
    "createdAt": "2024-01-15T08:00:00Z"
  }
}
```

#### POST /api/user/regenerate-api-key
Generate a new API key.

**Authentication:** Session-based (cookie)

**Response:**
```json
{
  "success": true,
  "message": "API key regenerated successfully",
  "apiKey": "new_key_here"
}
```

#### POST /api/user/complete-onboarding
Mark onboarding as complete.

**Authentication:** Session-based (cookie)

**Response:**
```json
{
  "success": true,
  "message": "Onboarding completed"
}
```

## Security Considerations

### API Key Generation
- Uses Node.js `crypto.randomBytes(32)` for cryptographic randomness
- 64 character hexadecimal string (256 bits of entropy)
- Stored with unique constraint in MongoDB

### API Key Storage
- **Backend:** Stored in MongoDB with unique index
- **Frontend:** Displayed only in Profile and Onboarding pages
- **Extension:** Should be stored in VS Code's secure settings storage

### API Key Validation
- Validated on every extension request via middleware
- User object attached to request after validation
- Failed validation returns 401 Unauthorized

### Key Regeneration
- Old key is immediately invalidated
- Requires confirmation in UI
- User must update extension configuration

## VS Code Extension Integration

### Extension Requirements
1. Prompt user for API key on first activation
2. Store API key securely in VS Code settings
3. Include API key in `x-api-key` header for all requests
4. Track coding activity (file edits, time spent, etc.)
5. Send activity to CodeTrackr backend

### Recommended Activity Tracking
```javascript
// Example VS Code extension code
const axios = require('axios');

async function trackActivity(apiKey, activityData) {
  try {
    const response = await axios.post(
      'http://localhost:5050/api/extension/track',
      activityData,
      {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Activity tracked:', response.data);
  } catch (error) {
    console.error('Failed to track activity:', error);
  }
}
```

### Batch Tracking (Recommended)
For better performance, collect activities and send in batches:
```javascript
let activityQueue = [];

function queueActivity(activity) {
  activityQueue.push(activity);
  
  // Send batch every 10 activities or 5 minutes
  if (activityQueue.length >= 10) {
    sendBatch();
  }
}

async function sendBatch() {
  if (activityQueue.length === 0) return;
  
  const activities = [...activityQueue];
  activityQueue = [];
  
  await axios.post(
    'http://localhost:5050/api/extension/track/batch',
    { activities },
    { headers: { 'x-api-key': apiKey } }
  );
}
```

## User Flow

### New User Journey
1. User signs in with Google OAuth
2. Backend generates API key automatically
3. User redirected to `/onboarding` page
4. Onboarding page displays:
   - Welcome message with user's name
   - Unique API key with copy button
   - Installation instructions for VS Code extension
   - Configuration steps
5. User clicks "Continue to Dashboard"
6. `isFirstLogin` flag set to false
7. User can access all features

### Returning User
1. User signs in with Google OAuth
2. Redirected directly to dashboard
3. Can view/regenerate API key in Profile page

### API Key Regeneration
1. User navigates to Profile page
2. Clicks "Regenerate Key" button
3. Confirmation dialog appears with warning
4. User confirms
5. New key generated, old key invalidated
6. New key displayed immediately
7. User must update VS Code extension with new key

## Testing

### Test API Key Validation
```bash
# Verify API key
curl -X GET http://localhost:5050/api/extension/verify \
  -H "x-api-key: YOUR_API_KEY"

# Should return user info if valid
```

### Test Activity Tracking
```bash
# Track single activity
curl -X POST http://localhost:5050/api/extension/track \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "test.js",
    "language": "JavaScript",
    "duration": 100,
    "linesAdded": 10,
    "linesRemoved": 2
  }'
```

## Future Enhancements

### Planned Features
- [ ] API key usage analytics (request count, last used)
- [ ] Multiple API keys per user (for different devices)
- [ ] API key expiration dates
- [ ] Rate limiting per API key
- [ ] API key scopes/permissions
- [ ] Webhook support for real-time notifications
- [ ] OAuth2 token-based authentication as alternative

### Security Enhancements
- [ ] API key rotation policy
- [ ] IP whitelist for API keys
- [ ] 2FA before API key regeneration
- [ ] Activity logging for API key usage
- [ ] Automatic key invalidation on suspicious activity

## Deployment Notes

### Environment Variables
```env
# Required for production
NODE_ENV=production
MONGO_URI=mongodb+srv://...
JWT_SECRET=your_secret_key
SESSION_SECRET=your_session_secret
FRONTEND_URL=https://yourdomain.com

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### CORS Configuration
Update `backend/app.js` CORS settings for production:
```javascript
app.use(cors({ 
  origin: [process.env.FRONTEND_URL], 
  methods: ["GET","POST","OPTIONS"], 
  credentials: true 
}));
```

### HTTPS Requirements
- Use HTTPS in production for secure API key transmission
- Update Google OAuth redirect URIs to HTTPS
- Configure secure cookies: `secure: true, sameSite: 'strict'`

## Support

### Common Issues

**Issue: API key not found**
- Solution: User needs to complete onboarding first
- Backend automatically generates key on first Google login

**Issue: 401 Unauthorized from extension**
- Solution 1: Verify API key is correctly copied (no spaces)
- Solution 2: Regenerate API key and update extension

**Issue: Activities not appearing in dashboard**
- Solution: Check that extension is sending correct userId
- Verify API key belongs to logged-in user

### Contact
For issues or questions about API integration:
- Backend API: Check `backend/routes/extension.js`
- Frontend: Check `frontend/src/pages/Onboarding.tsx`
- Documentation: This file

---

**Last Updated:** January 2024  
**Version:** 1.0.0  
**Status:** Production Ready ✅
