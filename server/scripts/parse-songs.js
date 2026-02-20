/**
 * Parse song list and output MOCK_CATALOG entries.
 * Input format: Title \t\t Duration(M:SS) \t Artist \t Album \t Genre \t ? \t ?
 */
const fs = require('fs');
const path = require('path');

const input = fs.readFileSync(path.join(__dirname, 'songs-raw.txt'), 'utf8');
const lines = input.trim().split('\n');

function parseDuration(str) {
  if (!str || !str.includes(':')) return 180;
  const [m, s] = str.trim().split(':').map(Number);
  return (m || 0) * 60 + (s || 0) || 180;
}

const songs = [];
let id = 51;

for (const line of lines) {
  const parts = line.split('\t');
  // Format: Title \t\t Duration \t Artist \t Album \t Genre \t ? \t ?
  const title = parts[0]?.trim();
  const durationStr = parts[2]?.trim() || '3:00';  // Duration at index 2
  const artist = parts[3]?.trim();                   // Artist at index 3
  const genre = parts[5]?.trim() && !/^\d+$/.test(parts[5]) ? parts[5].trim() : 'Pop';
  if (!title || !artist) continue;
  const duration = parseDuration(durationStr);
  const appleId = `song_${String(id).padStart(3, '0')}`;
  const imgIdx = 200 + (id % 200);
  songs.push({
    appleId,
    title,
    artist,
    albumArt: `https://picsum.photos/${imgIdx}`,
    duration,
    genre
  });
  id++;
}

// Output as JS array entries for appleMusicAPI.js - write to file (UTF-8)
const esc = str => String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const outLines = songs.map(s =>
  `  { appleId: '${s.appleId}', title: '${esc(s.title)}', artist: '${esc(s.artist)}', albumArt: '${s.albumArt}', duration: ${s.duration}, genre: '${esc(s.genre)}' },`
);
fs.writeFileSync(path.join(__dirname, 'catalog-new.txt'), outLines.join('\n'), 'utf8');
