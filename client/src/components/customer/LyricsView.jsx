import { useState, useEffect, useRef } from 'react';

// Parse LRC format: "[mm:ss.xx] lyric line" → [{ time, text }]
function parseLRC(lrc) {
  if (!lrc) return [];
  const parsed = [];
  for (const line of lrc.split('\n')) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (match) {
      const time =
        parseInt(match[1]) * 60 +
        parseInt(match[2]) +
        parseInt(match[3]) / (match[3].length === 3 ? 1000 : 100);
      const text = match[4].trim();
      if (text) parsed.push({ time, text });
    }
  }
  return parsed.sort((a, b) => a.time - b.time);
}

function initFromLyricsData(lyricsData) {
  const { syncedLyrics, plainLyrics } = lyricsData || {};
  if (syncedLyrics) return { lines: parseLRC(syncedLyrics), isSynced: true };
  if (plainLyrics) {
    return {
      lines: plainLyrics.split('\n').map((t) => t.trim()).filter(Boolean).map((text) => ({ time: null, text })),
      isSynced: false,
    };
  }
  return { lines: [], isSynced: false };
}

export default function LyricsView({ song, lyricsData, onClose }) {
  const init = initFromLyricsData(lyricsData);
  const [lines, setLines] = useState(init.lines);
  const [isSynced, setIsSynced] = useState(init.isSynced);
  const [currentIdx, setCurrentIdx] = useState(0);
  const lineRefs = useRef([]);
  // Ref so the tick always reads the latest anchor values without restarting the interval.
  // Supports both the new anchor pattern (positionMs + positionAnchoredAt) and
  // the legacy startedAt field.
  const anchorRef = useRef({
    positionMs: song?.positionMs ?? 0,
    positionAnchoredAt: song?.positionAnchoredAt ?? song?.startedAt ?? null,
    isPaused: song?.isPaused ?? false,
  });

  // Keep anchorRef in sync whenever the song prop updates (e.g. after reportPlaying)
  useEffect(() => {
    anchorRef.current = {
      positionMs: song?.positionMs ?? 0,
      positionAnchoredAt: song?.positionAnchoredAt ?? song?.startedAt ?? null,
      isPaused: song?.isPaused ?? false,
    };
  }, [song?.positionMs, song?.positionAnchoredAt, song?.startedAt, song?.isPaused]);

  // Re-parse if song or lyricsData changes while the overlay is mounted
  useEffect(() => {
    if (!song) return;
    setCurrentIdx(0);
    anchorRef.current = {
      positionMs: song.positionMs ?? 0,
      positionAnchoredAt: song.positionAnchoredAt ?? song.startedAt ?? null,
      isPaused: song.isPaused ?? false,
    };
    const { lines: newLines, isSynced: newSynced } = initFromLyricsData(lyricsData);
    setLines(newLines);
    setIsSynced(newSynced);
  }, [song?.appleId, lyricsData]);

  // Tick every 300ms to find the current lyric line.
  // Reads anchor values from a ref so server updates never restart the timer.
  useEffect(() => {
    if (!isSynced || !lines?.length) return;
    const tick = setInterval(() => {
      const { positionMs, positionAnchoredAt, isPaused } = anchorRef.current;
      if (!positionAnchoredAt) return;
      // Mirror server's getCurrentPositionMs: frozen when paused, else add elapsed time
      const elapsed = isPaused
        ? positionMs / 1000
        : (positionMs + (Date.now() - positionAnchoredAt)) / 1000;
      let idx = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].time <= elapsed) idx = i;
        else break;
      }
      setCurrentIdx(idx);
    }, 300);
    return () => clearInterval(tick);
  }, [isSynced, lines]);

  // Scroll the active line into view smoothly
  useEffect(() => {
    lineRefs.current[currentIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentIdx]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" style={{ fontFamily: 'inherit' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-safe-top py-4 border-b border-white/10 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-white font-bold text-sm truncate">{song?.title}</p>
          <p className="text-white/50 text-xs truncate">{song?.artist}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white text-xl shrink-0 active:bg-white/20"
        >
          ✕
        </button>
      </div>

      {/* Lyrics body */}
      <div className="flex-1 overflow-y-auto">
        {/* Not found */}
        {lines.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
            <span className="text-4xl">🎵</span>
            <p className="text-white/70 font-semibold">No lyrics found</p>
            <p className="text-white/40 text-sm">Lyrics aren't available for this song yet.</p>
          </div>
        )}

        {/* Lyrics lines */}
        {lines.length > 0 && (
          <div className="px-6 pb-48 pt-40 space-y-6">
            {lines.map((line, i) => (
              <p
                key={i}
                ref={(el) => { lineRefs.current[i] = el; }}
                className={`text-center font-bold leading-snug text-xl transition-all duration-300 origin-center ${
                  isSynced
                    ? i === currentIdx
                      ? 'text-white scale-[1.14]'
                      : i < currentIdx
                        ? 'text-white/25 scale-100'
                        : 'text-white/55 scale-100'
                    : 'text-white/80 scale-100'
                }`}
              >
                {line.text}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Plain lyrics note */}
      {lines.length > 0 && !isSynced && (
        <div className="shrink-0 py-3 text-center border-t border-white/10">
          <p className="text-white/30 text-xs">Synced lyrics not available — showing static text</p>
        </div>
      )}
    </div>
  );
}
