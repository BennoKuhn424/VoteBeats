function normalizePendingPayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { song: {} };
  }

  const isWrapped =
    Object.prototype.hasOwnProperty.call(parsed, 'song') ||
    Object.prototype.hasOwnProperty.call(parsed, 'kind') ||
    Object.prototype.hasOwnProperty.call(parsed, 'playlistId') ||
    Object.prototype.hasOwnProperty.call(parsed, 'prompt') ||
    Object.prototype.hasOwnProperty.call(parsed, 'count');

  if (!isWrapped) return { song: parsed };
  return {
    kind: parsed.kind,
    song: parsed.song || {},
    playlistId: parsed.playlistId || undefined,
    prompt: typeof parsed.prompt === 'string' ? parsed.prompt : undefined,
    count: Number.isFinite(Number(parsed.count)) ? Number(parsed.count) : undefined,
  };
}

function buildPendingPayload(data = {}) {
  return {
    kind: data.kind || (data.playlistId || data.prompt ? 'playlist_generation' : 'song_request'),
    song: data.song || {},
    ...(data.playlistId ? { playlistId: data.playlistId } : {}),
    ...(typeof data.prompt === 'string' ? { prompt: data.prompt } : {}),
    ...(data.count !== undefined ? { count: data.count } : {}),
  };
}

module.exports = { normalizePendingPayload, buildPendingPayload };
