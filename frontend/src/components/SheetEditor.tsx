import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Song, NoteInfo } from '../context/AppContext';
import { X, Plus, Trash2, Save, RotateCcw, Search, Play, Square, Piano } from 'lucide-react';
import soundEngine from '../services/soundEngine';

interface Props { song: Song; onClose: () => void; onSave: (notes: NoteInfo[]) => void; }

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const noteStr = (p: number) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const isBlack  = (p: number) => [1,3,6,8,10].includes(p % 12);

const PITCH_COLORS: Record<number, string> = {
  0: '#f87171', 1: '#fb923c', 2: '#fbbf24', 3: '#a3e635',
  4: '#34d399', 5: '#22d3ee', 6: '#60a5fa', 7: '#818cf8',
  8: '#c084fc', 9: '#f472b6', 10: '#e879a0', 11: '#f43f5e',
};

/* Mini piano roll rendered on canvas */
function drawRoll(
  canvas: HTMLCanvasElement,
  notes: NoteInfo[],
  playhead: number,
  totalDur: number
) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = '#07070a';
  ctx.fillRect(0, 0, W, H);

  if (!notes.length || totalDur <= 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '12px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Nota bulunamadı', W / 2, H / 2);
    return;
  }

  // Pitch range
  const pitches = notes.map(n => n.pitch);
  const minP = Math.max(21, Math.min(...pitches) - 2);
  const maxP = Math.min(108, Math.max(...pitches) + 2);
  const pitchRange = maxP - minP || 12;
  const rowH = Math.min(20, H / pitchRange);

  // Grid lines (octave boundaries)
  for (let p = minP; p <= maxP; p++) {
    const y = H - ((p - minP) / pitchRange) * H;
    if (p % 12 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, y - rowH / 2, W, rowH);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, y, W, 1);
      // Note name label
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '8px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(noteStr(p), 3, y - 2);
    }
  }

  // Time grid
  const secW = W / totalDur;
  const gridInterval = totalDur > 20 ? 2 : 1;
  for (let t = 0; t <= totalDur; t += gridInterval) {
    const x = t * secW;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '8px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${t}s`, x + 2, H - 2);
  }

  // Notes
  notes.forEach(n => {
    const x  = (n.start_time / totalDur) * W;
    const nw = Math.max(4, (n.duration / totalDur) * W - 1);
    const y  = H - ((n.pitch - minP + 0.5) / pitchRange) * H;
    const nh = Math.max(3, rowH - 1);

    const hue = PITCH_COLORS[n.pitch % 12];
    const alpha = 0.5 + (n.velocity / 127) * 0.5;

    ctx.fillStyle = hue + Math.round(alpha * 255).toString(16).padStart(2, '0');
    ctx.shadowColor = hue;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    (ctx as any).roundRect?.(x, y - nh / 2, nw, nh, 2) ?? ctx.rect(x, y - nh / 2, nw, nh);
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // Playhead
  if (playhead >= 0 && playhead <= totalDur) {
    const px = (playhead / totalDur) * W;
    ctx.strokeStyle = 'rgba(223,190,93,0.85)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#dfbe5d';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

export const SheetEditor: React.FC<Props> = ({ song, onClose, onSave }) => {
  const [notes,   setNotes]   = useState<NoteInfo[]>([]);
  const [search,  setSearch]  = useState('');
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef<number | null>(null);
  const startRef   = useRef<number>(0);
  const startPhRef = useRef<number>(0);

  useEffect(() => {
    setNotes(JSON.parse(JSON.stringify(song.notes)));
  }, [song]);

  // Recompute total duration
  const totalDur = useMemo(
    () => Math.max(1, notes.reduce((m, n) => Math.max(m, n.start_time + n.duration), 0) + 0.5),
    [notes]
  );

  // Redraw canvas whenever notes or playhead changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawRoll(canvas, notes, playhead, totalDur);
  }, [notes, playhead, totalDur]);

  // Playback loop
  const startPlay = async () => {
    await soundEngine.init?.();
    setPlaying(true);
    startRef.current = performance.now();
    startPhRef.current = playhead;

    const tick = () => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      const t = startPhRef.current + elapsed;
      if (t >= totalDur) {
        setPlaying(false);
        setPlayhead(0);
        return;
      }
      setPlayhead(t);

      // Trigger notes in window
      notes.forEach(n => {
        if (n.start_time >= t && n.start_time < t + 0.04) {
          soundEngine.triggerNoteOn(n.pitch, n.velocity);
          setTimeout(() => soundEngine.triggerNoteOff(n.pitch), n.duration * 1000);
        }
      });

      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  };

  const stopPlay = () => {
    setPlaying(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  };

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  // Seek on canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setPlayhead(ratio * totalDur);
  };

  // Note editing helpers
  const upd = (i: number, f: keyof NoteInfo, v: number) => {
    const next = [...notes];
    next[i] = { ...next[i], [f]: +v };
    if (f === 'start_time') next.sort((a, b) => a.start_time - b.start_time);
    setNotes(next);
  };
  const del   = (i: number) => setNotes(p => p.filter((_, j) => j !== i));
  const reset = () => setNotes(JSON.parse(JSON.stringify(song.notes)));
  const add   = () => {
    const last = notes[notes.length - 1];
    const newNote: NoteInfo = {
      pitch: last?.pitch ?? 60,
      start_time: (last?.start_time ?? 0) + (last?.duration ?? 0.5),
      duration: last?.duration ?? 0.4,
      velocity: 80,
    };
    setNotes([...notes, newNote].sort((a, b) => a.start_time - b.start_time));
  };

  const filtered = notes.filter(n =>
    !search || noteStr(n.pitch).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="glass w-full flex flex-col animate-slide-up"
        style={{
          maxWidth: 860,
          maxHeight: '92vh',
          border: '1px solid rgba(223,190,93,0.15)',
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(223,190,93,0.12)', border: '1px solid rgba(223,190,93,0.2)' }}>
              <Piano className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                {song.title}
              </h3>
              <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {song.composer} · {notes.length} nota · {totalDur.toFixed(2)}s
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Piano Roll Preview ── */}
        <div className="px-5 pt-4 pb-2 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-1">
            <span className="section-label flex items-center gap-1.5">
              <span>🎹</span> Piano Roll Önizleme
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>
                Konuma tıklayarak ileri sar
              </span>
              <button
                onClick={playing ? stopPlay : startPlay}
                className={`btn py-1.5 px-3 text-xs gap-1.5 ${playing ? 'btn-record-active' : 'btn-primary metallic-shine'}`}
                style={{ minHeight: 30 }}
              >
                {playing
                  ? <><Square className="w-3 h-3 fill-current" /> Durdur</>
                  : <><Play   className="w-3 h-3 fill-current" /> Dinle</>
                }
              </button>
            </div>
          </div>

          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            style={{
              width: '100%',
              height: 140,
              borderRadius: 8,
              border: '1px solid var(--border)',
              cursor: 'crosshair',
              display: 'block',
            }}
          />

          {/* Stats bar */}
          <div className="flex items-center gap-4 text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>
            {notes.length > 0 && (
              <>
                <span>Min: <span style={{ color: 'var(--accent)' }}>{noteStr(Math.min(...notes.map(n => n.pitch)))}</span></span>
                <span>Max: <span style={{ color: 'var(--accent)' }}>{noteStr(Math.max(...notes.map(n => n.pitch)))}</span></span>
                <span>Ort.Vel: <span style={{ color: 'var(--accent)' }}>
                  {Math.round(notes.reduce((s, n) => s + n.velocity, 0) / notes.length)}
                </span></span>
                <span>Süre: <span style={{ color: 'var(--accent)' }}>{totalDur.toFixed(2)}s</span></span>
              </>
            )}
          </div>
        </div>

        {/* ── Search ── */}
        <div className="px-5 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} />
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Nota ara… (örn: C4, D#, A3)"
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.3)',
                border: `1px solid var(--border)`,
                borderRadius: 8,
                paddingLeft: 32, paddingRight: 16,
                paddingTop: 7, paddingBottom: 7,
                fontSize: 12,
                color: 'var(--text)',
                outline: 'none',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            />
          </div>
        </div>

        {/* ── Column headers ── */}
        <div className="grid grid-cols-12 gap-2 px-5 py-2 border-b text-[9px] font-bold uppercase tracking-widest"
          style={{ borderColor: 'var(--border)', color: 'var(--text-dim)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="col-span-1">#</div>
          <div className="col-span-3">Nota</div>
          <div className="col-span-2">Başlangıç (s)</div>
          <div className="col-span-2">Süre (s)</div>
          <div className="col-span-3">Velocity</div>
          <div className="col-span-1 text-right">Sil</div>
        </div>

        {/* ── Note rows ── */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--text-dim)' }}>
              {search ? 'Eşleşen nota bulunamadı.' : 'Henüz nota yok.'}
            </div>
          ) : filtered.map(note => {
            const i = notes.indexOf(note);
            const bk = isBlack(note.pitch);
            const col = PITCH_COLORS[note.pitch % 12];

            return (
              <div
                key={`${i}-${note.pitch}-${note.start_time}`}
                className="grid grid-cols-12 gap-2 items-center px-3 py-2 rounded-xl transition-all"
                style={{
                  background: bk ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid rgba(255,255,255,0.05)`,
                  borderLeft: `3px solid ${col}55`,
                }}
              >
                {/* Index */}
                <div className="col-span-1 text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>{i + 1}</div>

                {/* Pitch */}
                <div className="col-span-3">
                  <select
                    value={note.pitch}
                    onChange={e => upd(i, 'pitch', +e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.4)',
                      border: `1px solid var(--border)`,
                      borderRadius: 6,
                      padding: '4px 6px',
                      fontSize: 11,
                      color: col,
                      outline: 'none',
                      fontFamily: 'JetBrains Mono, monospace',
                      cursor: 'pointer',
                    }}
                  >
                    {Array.from({ length: 88 }, (_, j) => j + 21).map(p => (
                      <option key={p} value={p} style={{ color: PITCH_COLORS[p % 12] }}>
                        {noteStr(p)} ({p})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Start time */}
                <div className="col-span-2">
                  <input
                    type="number" step="0.05" min="0"
                    value={note.start_time.toFixed(2)}
                    onChange={e => upd(i, 'start_time', parseFloat(e.target.value) || 0)}
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.4)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '4px 6px',
                      fontSize: 11,
                      color: 'var(--text)',
                      outline: 'none',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                </div>

                {/* Duration */}
                <div className="col-span-2">
                  <input
                    type="number" step="0.05" min="0.05"
                    value={note.duration.toFixed(2)}
                    onChange={e => upd(i, 'duration', parseFloat(e.target.value) || 0.1)}
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.4)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '4px 6px',
                      fontSize: 11,
                      color: 'var(--text)',
                      outline: 'none',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                </div>

                {/* Velocity */}
                <div className="col-span-3 flex items-center gap-2">
                  <input
                    type="range" min="1" max="127" value={note.velocity}
                    onChange={e => upd(i, 'velocity', +e.target.value)}
                    style={{
                      flex: 1,
                      height: 5,
                      borderRadius: 99,
                      background: `linear-gradient(to right, ${col} ${(note.velocity / 127) * 100}%, var(--border) ${(note.velocity / 127) * 100}%)`,
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      cursor: 'pointer',
                    }}
                  />
                  <span className="text-[10px] font-mono w-7 text-right" style={{ color: col }}>
                    {note.velocity}
                  </span>
                </div>

                {/* Delete */}
                <div className="col-span-1 flex justify-end">
                  <button
                    onClick={() => del(i)}
                    className="p-1 rounded-lg transition-colors"
                    style={{ color: 'var(--text-dim)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#f87171'}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3.5 border-t flex items-center gap-3"
          style={{ borderColor: 'var(--border)', background: 'rgba(0,0,0,0.25)' }}>
          <button onClick={add} className="btn btn-ghost px-3.5 py-2 text-xs gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Nota Ekle
          </button>
          <button onClick={reset} className="btn btn-ghost px-3 py-2 text-xs gap-1.5" title="Sıfırla">
            <RotateCcw className="w-3.5 h-3.5" /> Sıfırla
          </button>
          <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
            {notes.length} nota · {totalDur.toFixed(2)}s
          </span>
          <button onClick={onClose} className="btn btn-ghost px-4 py-2 text-xs">İptal</button>
          <button onClick={() => onSave(notes)} className="btn btn-primary px-5 py-2 text-xs metallic-shine gap-1.5">
            <Save className="w-3.5 h-3.5" /> Uygula & Çal
          </button>
        </div>
      </div>
    </div>
  );
};
