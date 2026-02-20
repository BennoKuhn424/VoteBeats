require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { advanceToNextSong } = require('./utils/queueAdvance');
const db = require('./utils/database');
const { yocoWebhook } = require('./routes/webhooks');

const app = express();

app.use(cors());

// Yoco webhook needs raw body for signature verification (must be before express.json)
app.post('/api/webhooks/yoco', express.raw({ type: 'application/json' }), yocoWebhook);

app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/token', require('./routes/token'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/search', require('./routes/search'));
app.use('/api/music', require('./routes/music'));
app.use('/api/venue', require('./routes/venue'));
app.use('/api/admin', require('./routes/admin'));

// Auto-advance songs when duration ends; also start first song when queue has items but nothing playing
setInterval(() => {
  const queues = db.getQueues();
  Object.entries(queues).forEach(([venueCode, queue]) => {
    const upcoming = queue.upcoming || [];
    if (queue.nowPlaying) {
      const elapsed = Date.now() - (queue.nowPlaying.startedAt || 0);
      let durationSec = queue.nowPlaying.duration || 180;
      if (durationSec < 60) durationSec = 180;
      const durationMs = durationSec * 1000;
      if (elapsed >= durationMs) {
        advanceToNextSong(venueCode);
      }
    } else if (upcoming.length > 0) {
      // Auto-start first song when nothing is playing
      advanceToNextSong(venueCode);
    }
  });
}, 5000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VoteBeats server running on port ${PORT}`));
