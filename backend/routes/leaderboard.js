const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const User = require('../models/user');

// GET global leaderboard data
router.get('/', async (req, res) => {
    try {
        // First, get all users
        const allUsers = await User.find({}).select('_id name email profilePictureUrl').lean();

        // Get activity data aggregated by user
        const activityData = await Activity.aggregate([
            {
                $addFields: {
                    userIdObj: {
                        $cond: {
                            if: { $regexMatch: { input: "$userId", regex: /^[0-9a-fA-F]{24}$/ } },
                            then: { $toObjectId: "$userId" },
                            else: "$userId"
                        }
                    }
                }
            },
            {
                $group: {
                    _id: "$userIdObj",
                    totalDuration: { $sum: "$duration" },
                    totalLinesAdded: { $sum: "$linesAdded" },
                    totalLinesRemoved: { $sum: "$linesRemoved" },
                    projects: { $addToSet: "$projectName" },
                    activityCount: { $sum: 1 }
                }
            },
            {
                $addFields: {
                    totalHours: { $divide: ["$totalDuration", 3600] },
                    projectCount: { $size: "$projects" },
                    codeChanges: { $add: ["$totalLinesAdded", "$totalLinesRemoved"] },
                    netCodeChanges: { $subtract: ["$totalLinesAdded", "$totalLinesRemoved"] }
                }
            }
        ]);

        // Create a map of userId to activity data
        const activityMap = {};
        activityData.forEach(data => {
            activityMap[data._id.toString()] = {
                totalHours: data.totalHours || 0,
                totalLinesAdded: data.totalLinesAdded || 0,
                totalLinesRemoved: data.totalLinesRemoved || 0,
                codeChanges: data.codeChanges || 0,
                netCodeChanges: data.netCodeChanges || 0,
                projectCount: data.projectCount || 0,
                commits: data.activityCount || 0
            };
        });

        // Merge all users with their activity data
        const leaderboardData = allUsers.map(user => {
            const userIdStr = user._id.toString();
            const activity = activityMap[userIdStr] || {
                totalHours: 0,
                totalLinesAdded: 0,
                totalLinesRemoved: 0,
                codeChanges: 0,
                netCodeChanges: 0,
                projectCount: 0,
                commits: 0
            };

            return {
                userId: user._id,
                name: user.name,
                email: user.email,
                profilePictureUrl: user.profilePictureUrl,
                ...activity
            };
        });

        // Sort by totalHours descending
        leaderboardData.sort((a, b) => b.totalHours - a.totalHours);

        // Calculate metrics for each user
        const maxHours = leaderboardData[0]?.totalHours || 1;
        const maxChanges = Math.max(...leaderboardData.map(u => u.codeChanges), 1);
        const maxCommits = Math.max(...leaderboardData.map(u => u.commits), 1);

        leaderboardData.forEach((user, index) => {
            user.rank = index + 1;
            
            // Calculate scores (out of 5.0) - handle 0 values gracefully
            if (user.totalHours === 0) {
                user.speed = "0.0";
                user.quality = "0.0";
                user.engagement = "0.0";
                user.impact = "0.0";
                user.overall = "0.0";
                user.commitScore = "0.0";
            } else {
                // Speed: Based on commits frequency
                user.speed = Math.min(5.0, (user.commits / maxCommits) * 5).toFixed(1);
                
                // Quality: Based on code changes ratio
                user.quality = Math.min(5.0, (user.codeChanges / maxChanges) * 5).toFixed(1);
                
                // Engagement: Based on activity count and hours
                user.engagement = Math.min(5.0, ((user.totalHours / maxHours) * 5)).toFixed(1);
                
                // Impact: Based on total lines and projects
                user.impact = Math.min(5.0, ((user.netCodeChanges / maxChanges) * 5)).toFixed(1);
                
                // Overall: Average of all metrics
                user.overall = (
                    (parseFloat(user.speed) + 
                     parseFloat(user.quality) + 
                     parseFloat(user.engagement) + 
                     parseFloat(user.impact)) / 4
                ).toFixed(1);
                
                // Commit Score (out of 5.0)
                user.commitScore = Math.min(5.0, (user.commits / 20) * 5).toFixed(1);
            }
        });

        res.json(leaderboardData);

    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ message: 'Error fetching leaderboard data', error: error.message });
    }
});

module.exports = router;
