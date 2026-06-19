import React, { useState, useEffect, useRef } from 'react';
import soundEngine from '../services/soundEngine';

interface NoteInfo { pitch: number; start_time: number; duration: number; velocity: number; }
interface Props {
  notes: NoteInfo[];
  currentTime: number;
  activeNotes: Set<number>;
  isPlaying: boolean;
  transposeOffset?: number;
}

const isBlack = (n: number) => [1,3,6,8,10].includes(n % 12);

// Per-semitone hue (spectral)
const NOTE_HUE = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

// Velocity → opacity boost
const velAlpha = (v: number) => 0.55 + (v / 127) * 0.45;

type Mode = 'synthesia' | 'roll' | 'scope';

export const Visualizer: React.FC<Props> = ({
  notes,
  currentTime,
  activeNotes,
  isPlaying,
  transposeOffset = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<Mode>('synthesia');

  interface Particle { x: number; y: number; vx: number; vy: number; life: number; hue: number; r: number; }
  const particles = useRef<Particle[]>([]);
  const prevActive = useRef(new Set<number>());

  const spawn = (x: number, w: number, y: number, hue: number) => {
    for (let i = 0; i < 8; i++) {
      particles.current.push({
        x: x + w / 2 + (Math.random() - .5) * w,
        y,
        vx: (Math.random() - .5) * 3,
        vy: -(Math.random() * 4 + 1),
        life: 1,
        hue,
        r: Math.random() * 3.5 + 2,
      });
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf: number;

    // ── Resize ─────────────────────────────
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width  = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width  = '100%';
      canvas.style.height = '100%';
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    // ── Keyboard layout (C2–B6, 61 keys from midi 36) ──
    const START_MIDI  = 36;
    const TOTAL_KEYS  = 61;
    const whiteNotes  = Array.from({ length: TOTAL_KEYS }, (_, i) => START_MIDI + i).filter(n => !isBlack(n));
    const WHITE_COUNT = whiteNotes.length;

    const getNoteX = (rawPitch: number, W: number) => {
      const pitch = rawPitch - transposeOffset;  // un-transpose for display
      const kw = W / WHITE_COUNT;
      if (isBlack(pitch)) {
        let pw = 0;
        for (let i = START_MIDI; i < pitch; i++) if (!isBlack(i)) pw++;
        return { x: pw * kw - kw * 0.3, nw: kw * 0.62 };
      } else {
        let wi = 0;
        for (let i = START_MIDI; i < pitch; i++) if (!isBlack(i)) wi++;
        return { x: wi * kw, nw: kw };
      }
    };

    // ── SYNTHESIA ─────────────────────────
    const renderSynthesia = (W: number, H: number) => {
      // Trailing fade
      ctx.fillStyle = 'rgba(7,7,10,0.40)';
      ctx.fillRect(0, 0, W, H);

      const kw  = W / WHITE_COUNT;
      const pps = 110;           // pixels per second
      const bly = H - 12;       // baseline Y

      // Vertical key columns (subtle)
      ctx.strokeStyle = 'rgba(255,255,255,0.022)';
      ctx.lineWidth = 1;
      let wki = 0;
      for (let i = 0; i < TOTAL_KEYS; i++) {
        const n = START_MIDI + i;
        if (!isBlack(n)) {
          ctx.strokeRect(wki * kw, 0, kw, H);
          // C marker
          if (n % 12 === 0) {
            ctx.strokeStyle = 'rgba(223,190,93,0.06)';
            ctx.beginPath(); ctx.moveTo(wki * kw, 0); ctx.lineTo(wki * kw, H); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.022)';
          }
          wki++;
        }
      }

      // Hit-line glow
      const hl = ctx.createLinearGradient(0, bly, W, bly);
      hl.addColorStop(0,   'transparent');
      hl.addColorStop(0.25, 'rgba(244,114,182,0.6)');
      hl.addColorStop(0.5,  'rgba(34,211,238,0.55)');
      hl.addColorStop(0.75, 'rgba(244,114,182,0.6)');
      hl.addColorStop(1,   'transparent');
      ctx.strokeStyle = hl; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, bly); ctx.lineTo(W, bly); ctx.stroke();

      // ── Draw notes ──
      notes.forEach(note => {
        const { x: nx, nw } = getNoteX(note.pitch + transposeOffset, W);
        const eof  = note.start_time + note.duration - currentTime;
        const ny   = bly - eof * pps;
        const nh   = Math.max(note.duration * pps, 5);

        if (ny + nh < 0 || ny > H) return;

        const hit    = currentTime >= note.start_time && currentTime <= note.start_time + note.duration;
        const played = activeNotes.has(note.pitch + transposeOffset);
        const hue    = NOTE_HUE[note.pitch % 12];
        const al     = velAlpha(note.velocity);

        ctx.shadowBlur = 0;
        const g = ctx.createLinearGradient(nx, ny, nx, ny + nh);

        if (hit && played) {
          g.addColorStop(0, `hsla(${hue},92%,75%,${al})`);
          g.addColorStop(1, `hsla(${hue},78%,52%,${al * 0.9})`);
          ctx.shadowColor = `hsla(${hue},90%,65%,0.9)`;
          ctx.shadowBlur  = 22;
        } else if (hit) {
          g.addColorStop(0, `rgba(244,114,182,${al})`);
          g.addColorStop(1, `rgba(219,39,119,${al * 0.88})`);
          ctx.shadowColor = '#f472b6'; ctx.shadowBlur = 16;
        } else {
          const progress = Math.max(0, (note.start_time - currentTime) / 4);
          const fade     = Math.max(0.3, 1 - progress * 0.6);
          g.addColorStop(0, `hsla(${(hue + 200) % 360},65%,58%,${al * fade})`);
          g.addColorStop(1, `hsla(${(hue + 220) % 360},55%,38%,${al * fade * 0.8})`);
        }

        ctx.fillStyle = g;
        ctx.beginPath();
        const r = isBlack(note.pitch) ? 3 : 5;
        (ctx as any).roundRect?.(nx + 1.5, ny, nw - 3, nh, r) ?? ctx.rect(nx + 1.5, ny, nw - 3, nh);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Velocity indicator stripe on top
        if (note.velocity > 90) {
          ctx.fillStyle = `hsla(${hue},100%,85%,0.5)`;
          ctx.fillRect(nx + 2, ny, nw - 4, 2);
        }
      });

      // ── Active key beams & particles ──
      activeNotes.forEach(an => {
        const { x, nw } = getNoteX(an, W);
        const hue = NOTE_HUE[an % 12];
        if (!prevActive.current.has(an)) spawn(x, nw, bly, hue);

        const bg = ctx.createLinearGradient(x, bly, x, 0);
        bg.addColorStop(0,   `hsla(${hue},80%,60%,0.55)`);
        bg.addColorStop(0.4, `hsla(${hue},70%,55%,0.12)`);
        bg.addColorStop(1,   'transparent');
        ctx.fillStyle = bg;
        ctx.fillRect(x + 1, 0, nw - 2, bly);

        // Dot at baseline
        ctx.shadowColor = `hsla(${hue},85%,65%,1)`;
        ctx.shadowBlur  = 26;
        ctx.fillStyle   = `hsla(${hue},90%,72%,0.95)`;
        ctx.beginPath();
        ctx.arc(x + nw / 2, bly, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });
      prevActive.current = new Set(activeNotes);

      // ── Particles ──
      particles.current = particles.current.filter(p => p.life > 0);
      particles.current.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.09; p.life -= 0.028;
        const al = Math.max(0, p.life);
        ctx.shadowColor = `hsla(${p.hue},85%,65%,${al})`; ctx.shadowBlur = 7;
        ctx.fillStyle   = `hsla(${p.hue},90%,72%,${al})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, p.r * p.life), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    };

    // ── PIANO ROLL (scrolled view) ─────────
    const renderRoll = (W: number, H: number) => {
      ctx.fillStyle = '#06060a';
      ctx.fillRect(0, 0, W, H);

      if (!notes.length) return;

      const pitches    = notes.map(n => n.pitch);
      const minP       = Math.max(21, Math.min(...pitches) - 3);
      const maxP       = Math.min(108, Math.max(...pitches) + 3);
      const pRange     = maxP - minP || 12;
      const totalDur   = Math.max(1, notes.reduce((m, n) => Math.max(m, n.start_time + n.duration), 0));
      const windowSec  = Math.min(totalDur, 16);   // visible seconds
      const startT     = Math.max(0, currentTime - windowSec * 0.25);
      const rowH       = Math.min(18, H / pRange);
      const pps        = W / windowSec;

      // Octave bands
      for (let p = minP; p <= maxP; p++) {
        if (p % 12 === 0) {
          const y = H - ((p - minP) / pRange) * H;
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(0, y - rowH / 2, W, rowH);
          ctx.fillStyle = 'rgba(223,190,93,0.15)';
          ctx.font = '8px JetBrains Mono, monospace';
          ctx.textAlign = 'left';
          const noteName = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][p % 12];
          ctx.fillText(`${noteName}${Math.floor(p / 12) - 1}`, 3, y - 2);
        }
        // Black key shade
        if (isBlack(p)) {
          const y = H - ((p - minP + 0.5) / pRange) * H;
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(0, y - rowH / 2, W, rowH);
        }
      }

      // Time grid
      for (let t = Math.floor(startT); t <= startT + windowSec + 1; t++) {
        const x = (t - startT) * pps;
        ctx.strokeStyle = t % 4 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
        ctx.lineWidth = t % 4 === 0 ? 1.5 : 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.setLineDash([]);
        if (t % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.font = '8px JetBrains Mono, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`${t}s`, x + 2, H - 3);
        }
      }

      // Notes
      notes.forEach(n => {
        const x  = (n.start_time - startT) * pps;
        const nw = Math.max(4, n.duration * pps - 1);
        const y  = H - ((n.pitch - minP + 0.5) / pRange) * H;
        const nh = Math.max(3, rowH - 1);
        if (x + nw < 0 || x > W) return;

        const hue  = NOTE_HUE[n.pitch % 12];
        const al   = velAlpha(n.velocity);
        const isHit = currentTime >= n.start_time && currentTime <= n.start_time + n.duration;

        ctx.shadowBlur = isHit ? 10 : 0;
        ctx.shadowColor = `hsla(${hue},90%,65%,0.8)`;
        ctx.fillStyle = `hsla(${hue},${isHit ? 90 : 70}%,${isHit ? 72 : 55}%,${al})`;
        ctx.beginPath();
        (ctx as any).roundRect?.(x, y - nh / 2, nw, nh, 2) ?? ctx.rect(x, y - nh / 2, nw, nh);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Playhead
      const phX = (currentTime - startT) * pps;
      ctx.strokeStyle = 'rgba(223,190,93,0.9)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#dfbe5d'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(phX, 0); ctx.lineTo(phX, H); ctx.stroke();
      ctx.shadowBlur = 0;
    };

    // ── OSCILLOSCOPE ──────────────────────
    const renderScope = (W: number, H: number) => {
      ctx.fillStyle = 'rgba(7,7,10,0.55)';
      ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (H / 4) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      for (let i = 1; i < 8; i++) {
        const x = (W / 8) * i;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      ctx.setLineDash([]);

      // Waveform
      const data = soundEngine.getWaveformData();
      const wg = ctx.createLinearGradient(0, 0, W, 0);
      wg.addColorStop(0, 'rgba(244,114,182,0.9)');
      wg.addColorStop(0.33, 'rgba(192,132,252,0.9)');
      wg.addColorStop(0.66, 'rgba(34,211,238,0.9)');
      wg.addColorStop(1, 'rgba(244,114,182,0.9)');
      ctx.shadowColor = '#c084fc'; ctx.shadowBlur = 10;
      ctx.strokeStyle = wg; ctx.lineWidth = 2;
      ctx.beginPath();
      if (data && data.length > 0) {
        const sw = W / data.length;
        for (let i = 0; i < data.length; i++) {
          const x = i * sw; const y = H / 2 + (data[i] * H) / 2;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
      }
      ctx.stroke(); ctx.shadowBlur = 0;

      // Label
      ctx.fillStyle = 'rgba(192,132,252,0.6)';
      ctx.font = "bold 9px 'JetBrains Mono', monospace";
      ctx.textAlign = 'left';
      ctx.fillText('OSCİLOSKOP', 10, 14);
    };

    // ── Main loop ─────────────────────────
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      if      (mode === 'synthesia') renderSynthesia(W, H);
      else if (mode === 'roll')      renderRoll(W, H);
      else                           renderScope(W, H);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, currentTime, activeNotes, isPlaying, mode, transposeOffset]);

  const MODES: { key: Mode; label: string }[] = [
    { key: 'synthesia', label: 'Synthesia' },
    { key: 'roll',      label: 'Piano Roll' },
    { key: 'scope',     label: 'Osiloskopu' },
  ];

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        height: 280,
        background: '#06060a',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 0 30px rgba(192,132,252,0.04), inset 0 0 12px rgba(0,0,0,0.7)',
      }}
    >
      {/* Glass glare */}
      <div className="absolute inset-0 pointer-events-none z-10"
        style={{ background: 'linear-gradient(135deg, transparent 0%, rgba(255,255,255,0.008) 50%, rgba(255,255,255,0.025) 100%)' }} />
      {/* Inset shadow */}
      <div className="absolute inset-0 pointer-events-none z-10"
        style={{ boxShadow: 'inset 0 0 14px rgba(0,0,0,0.8)' }} />

      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Mode switcher */}
      <div
        className="absolute top-2.5 right-2.5 flex gap-0.5 z-20"
        style={{
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(8px)',
          borderRadius: 8,
          padding: 3,
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {MODES.map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            style={{
              padding: '4px 10px',
              borderRadius: 5,
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              border: mode === m.key ? '1px solid rgba(223,190,93,0.3)' : '1px solid transparent',
              background: mode === m.key ? 'rgba(223,190,93,0.12)' : 'transparent',
              color: mode === m.key ? '#dfbe5d' : 'rgba(255,255,255,0.35)',
              transition: 'all 0.15s ease',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {notes.length === 0 && mode !== 'scope' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          <p className="text-xs font-bold tracking-widest uppercase"
            style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'JetBrains Mono, monospace' }}>
            PARÇA SEÇİLMEDİ
          </p>
          <p className="text-[10px] mt-1 uppercase"
            style={{ color: 'rgba(255,255,255,0.1)', fontFamily: 'JetBrains Mono, monospace' }}>
            Sol panelden bir parça seçin veya MIDI yükleyin
          </p>
        </div>
      )}

      {/* Playback indicator */}
      {isPlaying && (
        <div className="absolute bottom-2 left-3 flex items-center gap-1.5 z-20">
          <div className="w-1.5 h-1.5 rounded-full animate-ping"
            style={{ background: '#4ade80' }} />
          <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: '#4ade80', fontWeight: 700 }}>
            ÇALIYOR
          </span>
        </div>
      )}
    </div>
  );
};
