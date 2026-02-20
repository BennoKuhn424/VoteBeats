const express = require('express');
const { getDeveloperToken } = require('../utils/appleMusicToken');

const router = express.Router();

// GET /api/token - returns MusicKit JWT developer token for frontend
router.get('/', (req, res) => {
  const token = getDeveloperToken();
  if (!token) {
    return res.status(503).json({
      error: 'Apple Music not configured. Set APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_MUSIC_KEY_PATH.',
    });
  }
  res.json({ developerToken: token });
});

module.exports = router;
