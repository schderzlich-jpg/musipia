import React, { useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { KEYBOARD_MAP } from './KeyboardMap';

interface PianoKeyboardProps {
  activeNotes: Set<number>;
  targetNotes: Set<number>;
  onKeyMouseDown: (note: number, velocity?: number) => void;
  onKeyMouseUp: (note: number) => void;
  velocityMap?: Record<number, number>;
  transposeOffset?: number;
  showVelocityColors?: boolean;
  activeHand?: 'both' | 'right' | 'left';
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FREQ_TABLE: Record<number, number> = {};
for (let i = 21; i <= 108; i++) {
  FREQ_TABLE[i] = Math.round(440 * Math.pow(2, (i - 69) / 12) * 10) / 10;
}

// Is this MIDI note a black key?
const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(n % 12);

// Reverse-lookup keyboard shortcut
const NOTE_TO_KEY: Record<number, string> = {};
for (const [key, note] of Object.entries(KEYBOARD_MAP)) {
  if (!NOTE_TO_KEY[note]) NOTE_TO_KEY[note] = key.toUpperCase();
}

function getNoteName(note: number) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

// Velocity → CSS color (for heatmap mode)
function velColor(v: number): string {
  if (v < 20)  return 'rgba(96,165,250,0.55)';   // pp — blue
  if (v < 40)  return 'rgba(52,211,153,0.65)';    // p  — teal
  if (v < 55)  return 'rgba(163,230,53,0.70)';    // mp — green
  if (v < 70)  return 'rgba(251,191,36,0.75)';    // mf — yellow
  if (v < 85)  return 'rgba(251,146,60,0.80)';    // f  — orange
  return               'rgba(248,113,113,0.90)';  // ff — red
}

/*
  Black key left‑offset formula (standard piano geometry):
  Within each octave the 5 black keys sit between specific white keys.
  We track white-key index precisely to get pixel-perfect positioning.
*/
function buildKeyLayout(startMidi: number, count: number) {
  const keys: { midi: number; isBlack: boolean; whiteIndex: number }[] = [];
  let wIdx = 0;
  for (let i = 0; i < count; i++) {
    const midi = startMidi + i;
    const black = isBlack(midi);
    keys.push({ midi, isBlack: black, whiteIndex: black ? wIdx - 1 : wIdx });
    if (!black) wIdx++;
  }
  return { keys, whiteCount: wIdx };
}

const TOOLTIP_DELAY = 480;

const PianoKeyboard: React.FC<PianoKeyboardProps> = ({
  activeNotes,
  targetNotes,
  onKeyMouseDown,
  onKeyMouseUp,
  velocityMap = {},
  transposeOffset = 0,
  showVelocityColors = false,
  activeHand = 'both',
}) => {
  const [startMidi, setStartMidi] = useState(36);
  const [tooltipNote, setTooltipNote] = useState<number | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartX = useRef<number | null>(null);

  const TOTAL_KEYS = 61; // C2 → C7 (5 octaves + C)

  const shiftOctave = (dir: number) => {
    const next = startMidi + dir * 12;
    if (next >= 21 && next + TOTAL_KEYS <= 109) setStartMidi(next);
  };

  const pressStart = useCallback((note: number) => {
    tooltipTimer.current = setTimeout(() => setTooltipNote(note), TOOLTIP_DELAY);
  }, []);

  const pressEnd = useCallback((note: number) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltipNote(null);
    onKeyMouseUp(note);
  }, [onKeyMouseUp]);

  const onTouchStartBed = (e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX;
  };
  const onTouchEndBed = (e: React.TouchEvent) => {
    if (swipeStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    if (Math.abs(dx) > 90) shiftOctave(dx < 0 ? 1 : -1);
    swipeStartX.current = null;
  };

  const { keys, whiteCount } = buildKeyLayout(startMidi, TOTAL_KEYS);

  // Width of one white key as percentage
  const wkPct = 100 / whiteCount;
  // Black key: width = 62% of white, centered between two white keys
  const bkPct = wkPct * 0.62;

  const isDimmed = (note: number) => {
    if (activeHand === 'right') return note < 60;
    if (activeHand === 'left')  return note >= 60;
    return false;
  };

  return (
    <div
      className="select-none flex flex-col"
      style={{
        background: 'linear-gradient(to bottom, #1a1210 0%, #0d0908 100%)',
        borderTop: '2px solid rgba(223,190,93,0.15)',
        padding: '10px 12px 8px',
        gap: 8,
      }}
    >
      {/* ── Controls bar ────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        {/* Range label */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>Aralık</span>
          <span className="text-[11px] font-mono font-bold" style={{ color: 'var(--accent)' }}>
            {getNoteName(startMidi)} → {getNoteName(startMidi + TOTAL_KEYS - 1)}
          </span>
          {transposeOffset !== 0 && (
            <span
              className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
              style={{
                background: 'rgba(223,190,93,0.18)',
                border: '1px solid rgba(223,190,93,0.35)',
                color: 'var(--accent)',
              }}
            >
              {transposeOffset > 0 ? '+' : ''}{transposeOffset}
            </span>
          )}
        </div>

        {/* Legend + octave buttons */}
        <div className="flex items-center gap-3">
          {/* Legend */}
          <div className="hidden sm:flex items-center gap-3 text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#dfbe5d' }} />
              Aktif
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#f472b6' }} />
              Hedef
            </span>
          </div>

          <span className="text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>← Kaydır →</span>

          <button
            onClick={() => shiftOctave(-1)}
            disabled={startMidi <= 21}
            className="btn btn-ghost disabled:opacity-30 gap-1"
            style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }}
          >
            <ChevronLeft className="w-3 h-3" /> Oktav −
          </button>
          <button
            onClick={() => shiftOctave(1)}
            disabled={startMidi + TOTAL_KEYS >= 108}
            className="btn btn-ghost disabled:opacity-30 gap-1"
            style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }}
          >
            Oktav + <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Keyboard bed ────────────────────────────────────── */}
      <div
        className="relative w-full rounded-xl overflow-hidden"
        style={{
          height: 190,
          background: '#080504',
          border: '2px solid #000',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.8), inset 0 2px 8px rgba(0,0,0,0.6)',
          cursor: 'default',
        }}
        onTouchStart={onTouchStartBed}
        onTouchEnd={onTouchEndBed}
      >
        {/* ── WHITE KEYS ────────────────── */}
        {keys.map(({ midi, isBlack: black, whiteIndex }) => {
          if (black) return null;

          const isActive = activeNotes.has(midi);
          const isTarget = targetNotes.has(midi);
          const dimmed   = isDimmed(midi);
          const isMidC   = midi % 12 === 0;
          const kbdKey   = NOTE_TO_KEY[midi];
          const vColor   = showVelocityColors && !isActive && !isTarget ? velColor(velocityMap[midi] ?? 0) : null;
          const hasVel   = vColor && (velocityMap[midi] ?? 0) > 0;

          // Background
          let bg = 'linear-gradient(to bottom, #fefefe 0%, #f9f7f0 70%, #ede9de 100%)';
          if (isActive)    bg = 'linear-gradient(to bottom, #fff8e0 0%, #fce89a 60%, #ddb93a 100%)';
          else if (isTarget) bg = 'linear-gradient(to bottom, #fff0f8 0%, #fbb8d8 60%, #e879a0 100%)';
          else if (hasVel) bg = vColor!;

          // Bottom border (3D depth effect)
          const bottomColor = isActive ? '#b8901a' : isTarget ? '#c03070' : '#ccc6b8';
          const bottomW     = isActive || isTarget ? '3px' : '6px';

          // Shadow glow
          const glow = isActive
            ? '0 0 18px rgba(255,200,50,0.6), inset 0 4px 8px rgba(0,0,0,0.12)'
            : isTarget
            ? '0 0 18px rgba(244,114,182,0.55), inset 0 4px 8px rgba(0,0,0,0.1)'
            : 'inset 0 2px 3px rgba(255,255,255,0.9), 0 3px 5px rgba(0,0,0,0.18)';

          // Press depth
          const translateY = isActive || isTarget ? 4 : 0;

          return (
            <div
              key={midi}
              onMouseDown={() => { pressStart(midi); onKeyMouseDown(midi); }}
              onMouseUp={() => pressEnd(midi)}
              onMouseLeave={() => pressEnd(midi)}
              onTouchStart={e => { e.preventDefault(); pressStart(midi); onKeyMouseDown(midi); }}
              onTouchEnd={() => pressEnd(midi)}
              style={{
                position: 'absolute',
                left: `${whiteIndex * wkPct}%`,
                width: `${wkPct}%`,
                top: 0,
                bottom: 0,
                background: bg,
                borderRight: '1px solid rgba(0,0,0,0.13)',
                borderBottom: `${bottomW} solid ${bottomColor}`,
                borderRadius: '0 0 8px 8px',
                boxShadow: glow,
                transform: `translateY(${translateY}px)`,
                transition: 'transform 0.05s ease, background 0.05s ease, box-shadow 0.05s ease',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                alignItems: 'center',
                paddingBottom: 10,
                opacity: dimmed ? 0.32 : 1,
                userSelect: 'none',
                WebkitUserSelect: 'none',
                zIndex: 1,
              }}
            >
              {/* C marker dot */}
              {isMidC && !isActive && !isTarget && (
                <div style={{
                  position: 'absolute',
                  top: 6,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: 'rgba(180,130,40,0.45)',
                }} />
              )}

              {/* Long-press tooltip */}
              {tooltipNote === midi && (
                <div className="note-tooltip">
                  {getNoteName(midi)} · {FREQ_TABLE[midi]} Hz
                </div>
              )}

              {/* Keyboard shortcut */}
              {kbdKey && (
                <span style={{
                  fontSize: 8,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700,
                  opacity: 0.38,
                  marginBottom: 2,
                  color: isActive ? '#713f12' : isTarget ? '#831843' : '#666',
                }}>
                  {kbdKey}
                </span>
              )}

              {/* Note name */}
              <span style={{
                fontSize: isMidC ? 9 : 8,
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: isMidC ? 800 : 600,
                color: isActive ? '#713f12' : isTarget ? '#831843' : '#888',
                opacity: 0.75,
                letterSpacing: -0.5,
              }}>
                {isMidC ? getNoteName(midi) : NOTE_NAMES[midi % 12]}
              </span>
            </div>
          );
        })}

        {/* ── BLACK KEYS ────────────────── */}
        {keys.map(({ midi, isBlack: black, whiteIndex }) => {
          if (!black) return null;

          const isActive = activeNotes.has(midi);
          const isTarget = targetNotes.has(midi);
          const dimmed   = isDimmed(midi);
          const kbdKey   = NOTE_TO_KEY[midi];

          // Black key sits centered above the gap between two white keys
          // leftAnchor: right edge of left white key (whiteIndex)
          const leftEdge = (whiteIndex + 1) * wkPct; // right edge of left neighbor
          const leftPos  = leftEdge - bkPct / 2;     // centered on boundary

          let bg = 'linear-gradient(to bottom, #3a3330 0%, #1c1714 55%, #0a0807 100%)';
          if (isActive)    bg = 'linear-gradient(to bottom, #fce89a 0%, #ddb93a 55%, #8a6e10 100%)';
          else if (isTarget) bg = 'linear-gradient(to bottom, #f472b6 0%, #db2777 55%, #831843 100%)';

          const glow = isActive
            ? '0 0 14px rgba(255,200,50,0.7), inset 0 1px 2px rgba(255,255,255,0.15)'
            : isTarget
            ? '0 0 14px rgba(244,114,182,0.65), inset 0 1px 2px rgba(255,255,255,0.1)'
            : 'inset 0 1px 2px rgba(255,255,255,0.08), 0 4px 8px rgba(0,0,0,0.6)';

          const translateY = isActive || isTarget ? 4 : 0;

          return (
            <div
              key={midi}
              onMouseDown={() => { pressStart(midi); onKeyMouseDown(midi); }}
              onMouseUp={() => pressEnd(midi)}
              onMouseLeave={() => pressEnd(midi)}
              onTouchStart={e => { e.preventDefault(); pressStart(midi); onKeyMouseDown(midi); }}
              onTouchEnd={() => pressEnd(midi)}
              style={{
                position: 'absolute',
                left: `${leftPos}%`,
                width: `${bkPct}%`,
                top: 0,
                height: '62%',
                background: bg,
                borderLeft:   '1px solid rgba(0,0,0,0.7)',
                borderRight:  '1px solid rgba(0,0,0,0.7)',
                borderBottom: `${isActive || isTarget ? '2px' : '5px'} solid ${isActive ? '#5a3a00' : isTarget ? '#500020' : '#000'}`,
                borderRadius: '0 0 5px 5px',
                boxShadow: glow,
                transform: `translateY(${translateY}px)`,
                transition: 'transform 0.05s ease, background 0.05s ease, box-shadow 0.05s ease',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                alignItems: 'center',
                paddingBottom: 6,
                zIndex: 20,
                opacity: dimmed ? 0.32 : 1,
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              {/* Long-press tooltip */}
              {tooltipNote === midi && (
                <div className="note-tooltip" style={{ bottom: 'calc(100% + 5px)' }}>
                  {getNoteName(midi)} · {FREQ_TABLE[midi]} Hz
                </div>
              )}
              {kbdKey && (
                <span style={{
                  fontSize: 7,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700,
                  color: isActive ? '#fce89a' : isTarget ? '#fbb8d8' : 'rgba(255,255,255,0.35)',
                }}>
                  {kbdKey}
                </span>
              )}
            </div>
          );
        })}

        {/* Left edge shadow (depth effect) */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 10,
          background: 'linear-gradient(to right, rgba(0,0,0,0.35), transparent)',
          pointerEvents: 'none', zIndex: 30,
        }} />
        {/* Right edge shadow */}
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 10,
          background: 'linear-gradient(to left, rgba(0,0,0,0.35), transparent)',
          pointerEvents: 'none', zIndex: 30,
        }} />
      </div>
    </div>
  );
};

export { PianoKeyboard };
export default PianoKeyboard;
