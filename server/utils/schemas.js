const { z } = require('zod');

// ── Auth ─────────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(254, 'Email too long'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password too long'),
  venueName: z.string().trim().min(1, 'Venue name is required').max(100, 'Venue name too long'),
  location: z.string().trim().max(200, 'Location too long').optional().default(''),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').max(254, 'Email too long'),
  password: z.string().min(1, 'Password is required').max(128, 'Password too long'),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(254, 'Email too long'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required').max(256, 'Invalid token'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password too long'),
});

const resendVerificationSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(254, 'Email too long'),
});

// ── Queue ────────────────────────────────────────────────────────────────────

const songSchema = z.object({
  appleId: z.string().min(1, 'appleId is required').max(100),
  id: z.string().max(200).optional(),
  title: z.string().min(1, 'Song title is required').max(500, 'Song title too long'),
  artist: z.string().max(500, 'Artist name too long').optional().default(''),
  albumArt: z.string().max(500).optional(),
  duration: z.number().nonnegative().optional(),
});

const requestSongSchema = z.object({
  song: songSchema,
  deviceId: z.string().min(1, 'deviceId is required').max(256, 'Invalid deviceId'),
});

const voteSchema = z.object({
  songId: z.string().min(1, 'songId is required').max(200),
  voteValue: z.literal(1).or(z.literal(-1)),
  deviceId: z.string().min(1, 'deviceId is required').max(256, 'Invalid deviceId'),
});

const songIdSchema = z.object({
  songId: z.string().min(1, 'songId is required').max(200),
});

const playingSchema = z.object({
  songId: z.string().min(1, 'songId is required').max(200),
  positionSeconds: z.number().nonnegative().optional().default(0),
});

const volumeReportSchema = z.object({
  volumePercent: z.number().min(0).max(100),
});

const volumeFeedbackSchema = z.object({
  direction: z.enum(['too_loud', 'too_soft'], { message: 'direction must be too_loud or too_soft' }),
  deviceId: z.string().min(1, 'deviceId is required').max(256, 'Invalid deviceId'),
});

const createPaymentSchema = z.object({
  song: songSchema,
  deviceId: z.string().min(1, 'deviceId is required').max(256, 'Invalid deviceId'),
  clientOrigin: z.string().max(200).optional(),
});

// ── Venue ────────────────────────────────────────────────────────────────────

const createPlaylistSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Playlist name too long'),
});

const renamePlaylistSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Playlist name too long'),
});

const addSongToPlaylistSchema = z.object({
  appleId: z.string().min(1, 'appleId is required').max(100),
  id: z.string().max(200).optional(),
  title: z.string().min(1, 'title is required').max(500, 'Song title too long'),
  artist: z.string().max(500, 'Artist name too long').optional().default(''),
  albumArt: z.string().max(500).optional(),
  duration: z.number().nonnegative().optional(),
});

const banArtistSchema = z.object({
  artist: z.string().trim().min(1, 'Artist name is required').max(200, 'Artist name too long'),
});

const generateCheckoutSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required').max(500, 'Prompt too long'),
  count: z.number().int().min(25).max(400).optional().default(100),
});

const generatePlaylistSchema = z.object({
  checkoutId: z.string().min(1, 'checkoutId is required').max(200),
  prompt: z.string().trim().max(500).optional(),
  count: z.number().int().min(25).max(400).optional().default(100),
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  resendVerificationSchema,
  requestSongSchema,
  voteSchema,
  songIdSchema,
  playingSchema,
  volumeReportSchema,
  volumeFeedbackSchema,
  createPaymentSchema,
  createPlaylistSchema,
  renamePlaylistSchema,
  addSongToPlaylistSchema,
  banArtistSchema,
  generateCheckoutSchema,
  generatePlaylistSchema,
};
