import React from 'react';

// Computer keyboard → MIDI note mapping (starting from C3 = 48)
// White keys: A S D F G H J K L ;
// Black keys: W E   T Y U   O P
export const KEYBOARD_MAP: Record<string, number> = {
  // Row 1: Black keys (sharps)
  w: 49, // C#3
  e: 51, // D#3
  t: 54, // F#3
  y: 56, // G#3
  u: 58, // A#3
  o: 61, // C#4
  p: 63, // D#4
  // Row 2: White keys
  a: 48, // C3
  s: 50, // D3
  d: 52, // E3
  f: 53, // F3
  g: 55, // G3
  h: 57, // A3
  j: 59, // B3
  k: 60, // C4 (Middle C)
  l: 62, // D4
  ';': 64, // E4
  // Higher octave (shift + same keys via z-/ row)
  z: 60, // C4
  x: 62, // D4
  c: 64, // E4
  v: 65, // F4
  b: 67, // G4
  n: 69, // A4
  m: 71, // B4
  ',': 72, // C5
};

// Display layout for keyboard help
const DISPLAY_ROWS = [
  {
    keys: ['w', 'e', '', 't', 'y', 'u', '', 'o', 'p'],
    isBlack: [true, true, false, true, true, true, false, true, true],
  },
  {
    keys: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
    isBlack: Array(10).fill(false),
  },
  {
    keys: ['z', 'x', 'c', 'v', 'b', 'n', 'm', ','],
    isBlack: Array(8).fill(false),
  },
];

interface KeyboardMapProps {
  activeKeys: Set<string>;
}

export const KeyboardMap: React.FC<KeyboardMapProps> = ({ activeKeys }) => {
  return (
    <div className="glass-panel p-4 flex flex-col gap-3 border-slate-800">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
        <svg className="w-4 h-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="6" width="20" height="13" rx="2" />
          <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h.01M12 14h.01M16 14h.01M6 18h12" />
        </svg>
        <h2 className="font-bold text-sm uppercase tracking-wider text-slate-200">Klavye Modu</h2>
        <span className="ml-auto text-[10px] bg-violet-500/10 border border-violet-500/20 text-violet-400 px-2 py-0.5 rounded-full font-semibold">
          AKTIF
        </span>
      </div>

      <div className="space-y-2">
        {/* Row 1: Black keys */}
        <div className="flex gap-1 items-center justify-center pl-4">
          {DISPLAY_ROWS[0].keys.map((key, i) => {
            if (key === '') return <div key={i} className="w-6" />;
            const isActive = activeKeys.has(key);
            return (
              <div
                key={key + i}
                className={`kbd-key text-[9px] font-orbitron ${isActive ? 'active' : ''}`}
                style={{ background: isActive ? undefined : 'rgba(15,15,17,0.9)' }}
              >
                {key.toUpperCase()}
              </div>
            );
          })}
        </div>

        {/* Row 2: Main white keys */}
        <div className="flex gap-1 items-center justify-center">
          {DISPLAY_ROWS[1].keys.map((key, i) => {
            const isActive = activeKeys.has(key);
            return (
              <div key={key + i} className={`kbd-key ${isActive ? 'active' : ''}`}>
                {key === ';' ? ';' : key.toUpperCase()}
              </div>
            );
          })}
        </div>

        {/* Row 3: Z-row (octave up) */}
        <div className="flex gap-1 items-center justify-center">
          {DISPLAY_ROWS[2].keys.map((key, i) => {
            const isActive = activeKeys.has(key);
            return (
              <div key={key + i} className={`kbd-key ${isActive ? 'active' : ''}`}>
                {key === ',' ? ',' : key.toUpperCase()}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-slate-500 text-center leading-relaxed">
        A–; → C3–E4 · Z–, → C4–C5 · W/E/T/Y/U/O/P → siyah tuşlar
      </p>
    </div>
  );
};
