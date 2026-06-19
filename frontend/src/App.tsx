import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import type { Song, NoteInfo } from './context/AppContext';
import { MidiConnector } from './components/MidiConnector';
import { PianoKeyboard } from './components/PianoKeyboard';
import { SynthControls } from './components/SynthControls';
import { Visualizer } from './components/Visualizer';
import { SongSelector } from './components/SongSelector';
import { SheetEditor } from './components/SheetEditor';
import { KeyboardMap, KEYBOARD_MAP } from './components/KeyboardMap';
import VelocityAnalytics from './components/VelocityAnalytics';
import Metronome from './components/Metronome';
import LearningMode from './components/LearningMode';
import soundEngine, { defaultParams } from './services/soundEngine';
import type { SynthParams } from './services/soundEngine';
import {
  Play, Square, Sparkles, Volume2, Piano, Circle,
  BarChart3, Music2, Keyboard, ChevronRight, Loader2,
  Sun, Moon, Minus, Plus, Mic, Settings2, GraduationCap, Plug
} from 'lucide-react';
import './App.css';

/* ── Ambient background particles ──────────────────────── */
const PARTICLES = Array.from({ length: 10 }, (_, i) => ({
  id: i, size: Math.random() * 3 + 1.5,
  left: Math.random() * 100,
  dur: Math.random() * 15 + 10,
  delay: Math.random() * -18,
}));

type RightTab = 'gorsel' | 'sentez' | 'analiz' | 'midi';

/* ================================================================
   MAIN APP CONTENT
   ================================================================ */
const AppContent: React.FC = () => {
  const { currentSong, setCurrentSong, updateSettings, addSong, transposeOffset, setTransposeOffset } = useApp();

  /* Core States */
  const [activeNotes,  setActiveNotes]  = useState<Set<number>>(new Set());
  const [targetNotes,  setTargetNotes]  = useState<Set<number>>(new Set());
  const [synthParams,  setSynthParams]  = useState<SynthParams>(defaultParams);
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [currentTime,  setCurrentTime]  = useState(0.0);
  const [isAutoplay,   setIsAutoplay]   = useState(false);
  const [isWaiting,    setIsWaiting]    = useState(false);
  const [tempo,        setTempo]        = useState(1.0);
  const [audioStarted, setAudioStarted] = useState(false);
  const [masterVol,    setMasterVol]    = useState(-40); // Start muted
  const [isRecording,  setIsRecording]  = useState(false);
  const [recordCount,  setRecordCount]  = useState(0);

  /* Velocity & Stats */
  const [notesPressed,   setNotesPressed]   = useState(0);
  const [correctNotes,   setCorrectNotes]   = useState(0);
  const [lastVelocity,   setLastVelocity]   = useState<number>(0);
  const [velocitySum,    setVelocitySum]    = useState<number>(0);
  const [velocityCount,  setVelocityCount]  = useState<number>(0);
  const [velocityHistory, setVelocityHistory] = useState<number[]>([]);
  const [noteHistory,     setNoteHistory]    = useState<number[]>([]);
  const [velocityMap,     setVelocityMap]    = useState<Record<number, number>>({}); // note → last velocity

  /* UI States */
  const [pianoLoaded,  setPianoLoaded]  = useState(soundEngine.pianoLoaded);
  const [editingSong,  setEditingSong]  = useState<Song | null>(null);
  const [activeKbd,    setActiveKbd]    = useState<Set<string>>(new Set());
  const [showKbd,      setShowKbd]      = useState(false);
  const [leftOpen,     setLeftOpen]     = useState(true);
  const [rightTab,     setRightTab]     = useState<RightTab>('gorsel');
  const [theme,        setTheme]        = useState<'dark' | 'light'>('dark');
  const [showVelColors, setShowVelColors] = useState(false);
  const [activeHand,   setActiveHand]   = useState<'both' | 'right' | 'left'>('both');

  const timerRef        = useRef<number | null>(null);
  const lastTimeRef     = useRef(0);
  const recordedRef     = useRef<NoteInfo[]>([]);
  const recordStartRef  = useRef(0);
  const noteOnTimesRef  = useRef<Record<number, { time: number; velocity: number }>>({});

  /* Apply theme */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  /* Subscribe to Sound Engine Piano Loader */
  useEffect(() => {
    soundEngine.onPianoLoaded(() => setPianoLoaded(true));
  }, []);

  /* ── Stop all sounds on mount to prevent stuck notes ──────────────────────── */
  useEffect(() => {
    const stopStuckNotes = () => {
      soundEngine.stopAllNotes();
      soundEngine.setMasterVolume(-40); // Mute initially
    };

    // Stop sounds immediately when component mounts
    const timer = setTimeout(() => {
      stopStuckNotes();
    }, 100);

    return () => {
      clearTimeout(timer);
      stopStuckNotes();
    };
  }, []);

  /* ── Audio init ──────────────────────── */
  const startAudio = useCallback(async () => {
    if (audioStarted) return;
    await soundEngine.init();
    soundEngine.setMasterVolume(masterVol);
    setAudioStarted(true);
  }, [audioStarted, masterVol]);

  /* ── Note on / off ───────────────────── */
  const handleNoteOn = useCallback((noteRaw: number, velocity = 80) => {
    const note = noteRaw + transposeOffset;
    startAudio();
    setActiveNotes(p => new Set(p).add(note));
    soundEngine.triggerNoteOn(note, velocity);
    setNotesPressed(p => p + 1);
    setLastVelocity(velocity);
    setVelocitySum(p => p + velocity);
    setVelocityCount(p => p + 1);
    setVelocityHistory(p => [...p.slice(-99), velocity]);
    setNoteHistory(p => [...p.slice(-999), note]);
    setVelocityMap(p => ({ ...p, [note]: velocity }));
    if (targetNotes.has(note)) setCorrectNotes(p => p + 1);
    if (isRecording) {
      const t = (performance.now() - recordStartRef.current) / 1000;
      noteOnTimesRef.current[note] = { time: t, velocity };
    }
  }, [startAudio, targetNotes, isRecording, transposeOffset]);

  const handleNoteOff = useCallback((noteRaw: number) => {
    const note = noteRaw + transposeOffset;
    setActiveNotes(p => { const n = new Set(p); n.delete(note); return n; });
    soundEngine.triggerNoteOff(note);
    if (isRecording && noteOnTimesRef.current[note]) {
      const t = (performance.now() - recordStartRef.current) / 1000;
      const { time, velocity } = noteOnTimesRef.current[note];
      delete noteOnTimesRef.current[note];
      recordedRef.current.push({
        pitch: note, start_time: time,
        duration: Math.max(.05, t - time), velocity
      });
      setRecordCount(p => p + 1);
    }
  }, [isRecording, transposeOffset]);

  /* ── Computer keyboard ───────────────── */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const note = KEYBOARD_MAP[e.key.toLowerCase()];
      if (note !== undefined) {
        e.preventDefault();
        setActiveKbd(p => new Set(p).add(e.key.toLowerCase()));
        handleNoteOn(note, Math.floor(Math.random() * 25) + 80);
      }
    };
    const up = (e: KeyboardEvent) => {
      const note = KEYBOARD_MAP[e.key.toLowerCase()];
      if (note !== undefined) {
        setActiveKbd(p => { const n = new Set(p); n.delete(e.key.toLowerCase()); return n; });
        handleNoteOff(note);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [handleNoteOn, handleNoteOff]);

  /* ── Synth params ────────────────────── */
  const handleSynthChange = (upd: Partial<SynthParams>) => {
    setSynthParams(p => ({ ...p, ...upd }));
    soundEngine.updateParams(upd);
    if (upd.synthType) updateSettings({ synth_type: upd.synthType });
  };

  const handleVolume = (db: number) => {
    setMasterVol(db);
    if (audioStarted) soundEngine.setMasterVolume(db);
  };

  /* ── Target notes + autoplay ─────────── */
  useEffect(() => {
    if (!currentSong) { setTargetNotes(new Set()); return; }
    const active = new Set<number>();

    // Filter by active hand
    const filteredNotes = currentSong.notes.filter(n => {
      if (activeHand === 'right') return n.pitch >= 60;
      if (activeHand === 'left')  return n.pitch <  60;
      return true;
    });

    filteredNotes.forEach(n => {
      if (currentTime >= n.start_time && currentTime <= n.start_time + n.duration)
        active.add(n.pitch + transposeOffset);
    });
    setTargetNotes(active);

    if (isPlaying && isAutoplay) {
      const fe = currentTime + 0.03 * tempo;
      filteredNotes.forEach(n => {
        if (n.start_time >= currentTime && n.start_time < fe) {
          const tp = n.pitch + transposeOffset;
          soundEngine.triggerNoteOn(tp, n.velocity || 80);
          setLastVelocity(n.velocity || 80);
          setVelocitySum(p => p + (n.velocity || 80));
          setVelocityCount(p => p + 1);
          setTimeout(() => soundEngine.triggerNoteOff(tp), n.duration * 1000);
        }
      });
    }
  }, [currentTime, currentSong, isPlaying, isAutoplay, tempo, activeHand, transposeOffset]);

  /* ── Playback sequencer ──────────────── */
  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = performance.now();
      const tick = () => {
        const now = performance.now();
        const delta = ((now - lastTimeRef.current) / 1000) * tempo;
        lastTimeRef.current = now;
        let wait = false;
        if (isWaiting && targetNotes.size > 0) {
          wait = !Array.from(targetNotes).every(n => activeNotes.has(n));
        }
        if (!wait) {
          setCurrentTime(prev => {
            const next = prev + delta;
            if (currentSong && next >= currentSong.duration) { setIsPlaying(false); return 0; }
            return next;
          });
        }
        timerRef.current = requestAnimationFrame(tick);
      };
      timerRef.current = requestAnimationFrame(tick);
    } else {
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    }
    return () => { if (timerRef.current) cancelAnimationFrame(timerRef.current); };
  }, [isPlaying, isWaiting, targetNotes, activeNotes, currentSong, tempo]);

  const togglePlay = () => {
    startAudio();
    if (isPlaying) setIsPlaying(false);
    else { if (currentTime >= (currentSong?.duration || 0)) setCurrentTime(0); setIsPlaying(true); }
  };
  const stopPlay = () => { setIsPlaying(false); setCurrentTime(0); setTargetNotes(new Set()); };

  /* ── Recording ───────────────────────── */
  const startRec = () => {
    startAudio();
    recordedRef.current = [];
    noteOnTimesRef.current = {};
    setRecordCount(0);
    recordStartRef.current = performance.now();
    setIsRecording(true);
  };
  const stopRec = () => {
    setIsRecording(false);
    const notes = recordedRef.current.sort((a, b) => a.start_time - b.start_time);
    if (!notes.length) return;
    const duration = Math.max(...notes.map(n => n.start_time + n.duration)) + 0.5;
    addSong({
      id: `rec_${Date.now()}`,
      title: `Kayıt — ${new Date().toLocaleTimeString('tr-TR')}`,
      composer: 'Kayıt',
      notes, duration
    });
  };

  const handleSaveNotes = (upd: NoteInfo[]) => {
    if (currentSong) {
      const dur = upd.reduce((m, n) => Math.max(m, n.start_time + n.duration), 0) + 1;
      setCurrentSong({ ...currentSong, notes: upd, duration: dur });
    }
    setEditingSong(null);
  };

  const accuracy = notesPressed > 0 ? Math.round((correctNotes / notesPressed) * 100) : 0;
  const volPct   = Math.round(((masterVol + 40) / 40) * 100);
  const progress = currentSong ? (currentTime / currentSong.duration) * 100 : 0;

  const RIGHT_TABS: { key: RightTab; icon: React.ReactNode; label: string }[] = [
    { key: 'gorsel',  icon: <Music2 className="w-3.5 h-3.5" />,       label: 'Görsel'    },
    { key: 'sentez',  icon: <Settings2 className="w-3.5 h-3.5" />,    label: 'Sentez'    },
    { key: 'analiz',  icon: <BarChart3 className="w-3.5 h-3.5" />,    label: 'Analiz'    },
    { key: 'midi',    icon: <Plug className="w-3.5 h-3.5" />,         label: 'MIDI'      },
  ];

  return (
    <div className="relative h-screen max-h-screen overflow-hidden flex flex-col select-none"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}>

      {/* Decorative ambient background */}
      <div className="app-bg">
        <div className="grid-overlay" />
        {PARTICLES.map(p => (
          <div key={p.id} className="particle" style={{
            width: p.size, height: p.size,
            left: `${p.left}%`,
            background: 'rgba(223,190,93,0.15)',
            boxShadow: `0 0 ${p.size * 3}px rgba(223,190,93,0.07)`,
            ['--dur' as any]: `${p.dur}s`,
            ['--delay' as any]: `${p.delay}s`,
          }} />
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════
          HEADER
          ══════════════════════════════════════════════════════ */}
      <header className="relative z-10 border-b px-4 py-2.5 flex items-center gap-3 flex-wrap shrink-0"
        style={{ background: 'var(--header-bg)', borderColor: 'var(--border)' }}>

        {/* Brand */}
        <div className="flex items-center gap-2.5 mr-2">
          <div className="relative">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-soft))', borderColor: 'rgba(223,190,93,0.3)' }}>
              <Piano className="w-4.5 h-4.5" style={{ color: '#1a0e08' }} />
            </div>
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 animate-pulse"
              style={{ background: 'var(--accent)', borderColor: 'var(--bg)' }} />
          </div>
          <div>
            <h1 className="shimmer-text text-xs font-black tracking-widest leading-none uppercase">
              Piyano Stüdyosu
            </h1>
            <p className="text-[8px] tracking-widest font-bold uppercase font-mono mt-0.5"
              style={{ color: 'var(--text-muted)' }}>
              Profesyonel Akustik Modeli
            </p>
          </div>
        </div>

        {/* Ses seviyesi */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border"
          style={{ background: 'rgba(0,0,0,0.18)', borderColor: 'var(--border)' }}>
          <Volume2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <input type="range" min={-40} max={0} step={1} value={masterVol}
            onChange={e => handleVolume(+e.target.value)}
            className="w-20 cursor-pointer"
            style={{ background: `linear-gradient(to right, var(--accent) ${volPct}%, var(--border) ${volPct}%)` }} />
          <span className="text-[10px] font-mono font-bold w-7 text-right" style={{ color: 'var(--accent)' }}>
            {volPct}%
          </span>
        </div>

        {/* Tempo */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border"
          style={{ background: 'rgba(0,0,0,0.18)', borderColor: 'var(--border)' }}>
          <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-muted)' }}>Hız</span>
          <input type="range" min={0.5} max={2.0} step={0.05} value={tempo}
            onChange={e => setTempo(+e.target.value)}
            className="w-20 cursor-pointer"
            style={{ background: `linear-gradient(to right, var(--accent) ${((tempo-.5)/1.5)*100}%, var(--border) ${((tempo-.5)/1.5)*100}%)` }} />
          <span className="text-[10px] font-mono font-bold w-9 text-right" style={{ color: 'var(--accent)' }}>
            {tempo.toFixed(2)}×
          </span>
        </div>

        {/* Transpoz */}
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border"
          style={{ background: 'rgba(0,0,0,0.18)', borderColor: 'var(--border)' }}>
          <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-muted)' }}>Transpoz</span>
          <button onClick={() => setTransposeOffset(Math.max(-6, transposeOffset - 1))}
            className="w-6 h-6 flex items-center justify-center rounded hover:opacity-70 transition-opacity"
            style={{ background: 'var(--btn-ghost-bg)', color: 'var(--text-muted)' }}>
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-[11px] font-mono font-bold w-8 text-center"
            style={{ color: transposeOffset !== 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
            {transposeOffset > 0 ? '+' : ''}{transposeOffset}
          </span>
          <button onClick={() => setTransposeOffset(Math.min(6, transposeOffset + 1))}                
            className="w-6 h-6 flex items-center justify-center rounded hover:opacity-70 transition-opacity"
            style={{ background: 'var(--btn-ghost-bg)', color: 'var(--text-muted)' }}>
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Kompakt Metronom */}
        <Metronome compact />

        {/* Piano yükleme durumu */}
        {synthParams.synthType === 'piano' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border"
            style={{ background: 'rgba(0,0,0,0.18)', borderColor: 'var(--border)' }}>
            {!pianoLoaded ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} />
                <span className="text-[9px] font-mono font-bold uppercase animate-pulse"
                  style={{ color: 'var(--accent)' }}>Piyano Yükleniyor...</span>
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full animate-ping" style={{ background: 'var(--accent)' }} />
                <span className="text-[9px] font-mono font-bold uppercase" style={{ color: 'var(--accent)' }}>
                  Kuyruklu Piyano Hazır
                </span>
              </>
            )}
          </div>
        )}

        {!audioStarted && (
          <button onClick={startAudio}
            className="btn btn-primary px-4 py-2 text-xs font-bold metallic-shine">
            <Volume2 className="w-3.5 h-3.5" /> Sesi Başlat
          </button>
        )}

        {/* Sağ taraf araçlar */}
        <div className="ml-auto flex items-center gap-2">
          {audioStarted && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] font-mono font-bold"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }}>
              ● CANLI
            </span>
          )}

          {/* Tema değiştir */}
          <div className="flex items-center gap-1.5">
            <Sun className="w-3.5 h-3.5" style={{ color: theme === 'light' ? 'var(--accent)' : 'var(--text-dim)' }} />
            <button className={`theme-toggle ${theme === 'light' ? 'active' : ''}`}
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Aydınlık Mod' : 'Karanlık Mod'}>
              <div className="theme-toggle-knob" />
            </button>
            <Moon className="w-3.5 h-3.5" style={{ color: theme === 'dark' ? 'var(--accent)' : 'var(--text-dim)' }} />
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════
          DAW WORKSPACE
          ══════════════════════════════════════════════════════ */}
      <div className="relative z-10 flex flex-1 overflow-hidden min-h-0">

        {/* ────────────────────────────────────────
            SOL PANEL
            ──────────────────────────────────────── */}
        <aside className={`flex flex-col border-r transition-all duration-300 h-full shrink-0 ${leftOpen ? 'w-72 min-w-72' : 'w-0 min-w-0 overflow-hidden'}`}
          style={{ background: 'var(--sidebar-bg)', borderColor: 'var(--border)' }}>
          <div className="flex flex-col gap-3 p-3 overflow-y-auto flex-1 min-h-0">

            {/* Parça Kütüphanesi */}
            <SongSelector onShowEditor={s => setEditingSong(s)} />

            {/* Çalma & Pratik */}
            <div className="glass p-3.5 flex flex-col gap-2.5">
              <p className="section-label flex items-center gap-1.5">
                <Music2 className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} /> Çalma & Pratik
              </p>

              <div className="flex gap-2">
                <button onClick={togglePlay} disabled={!currentSong}
                  className={`btn flex-1 py-2.5 text-xs font-bold disabled:opacity-40 ${isPlaying ? 'btn-ghost' : 'btn-primary metallic-shine'}`}>
                  {isPlaying
                    ? <><Square className="w-3.5 h-3.5 fill-current" /> Duraklat</>
                    : <><Play  className="w-3.5 h-3.5 fill-current"  /> Çal</>}
                </button>
                <button onClick={stopPlay} disabled={!currentSong}
                  className="btn btn-ghost px-3 py-2.5 disabled:opacity-40" title="Durdur">
                  <Square className="w-4 h-4 fill-current" />
                </button>
                <button onClick={() => soundEngine.stopAllNotes()} className="btn btn-ghost px-3 py-2.5" title="Tüm Sesleri Durdur">
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>

              {/* Progress bar */}
              {currentSong && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    <span>{currentTime.toFixed(2)}s</span>
                    <span className="font-bold truncate max-w-[110px] text-center" style={{ color: 'var(--text)' }}>
                      {currentSong.title}
                    </span>
                    <span>{currentSong.duration.toFixed(2)}s</span>
                  </div>
                  <div className="progress-bar-track"
                    onClick={e => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setCurrentTime(((e.clientX - r.left) / r.width) * (currentSong?.duration ?? 0));
                    }}>
                    <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setIsAutoplay(p => !p)}
                  className={`btn py-2 text-[11px] font-bold ${isAutoplay ? 'btn-primary metallic-shine' : 'btn-ghost'}`}>
                  <Volume2 className="w-3.5 h-3.5" /> Otomatik
                </button>
                <button onClick={() => { setIsWaiting(p => !p); if (isAutoplay && !isWaiting) setIsAutoplay(false); }}
                  className={`btn py-2 text-[11px] font-bold ${isWaiting ? 'btn-success' : 'btn-ghost'}`}>
                  <Sparkles className="w-3.5 h-3.5" /> Pratik
                </button>
              </div>

              {isWaiting && (
                <p className="text-[9px] font-mono text-center animate-pulse font-bold tracking-widest uppercase"
                  style={{ color: 'var(--accent)' }}>
                  GİRİŞ BEKLENİYOR...
                </p>
              )}
            </div>

            {/* Kayıt */}
            <div className={`glass p-3.5 flex flex-col gap-2.5 ${isRecording ? 'glass-pink' : ''}`}>
              <p className="section-label flex items-center gap-1.5">
                <Circle className={`w-3 h-3 ${isRecording ? 'fill-red-500 text-red-500 animate-record' : ''}`}
                  style={{ color: isRecording ? '#ef4444' : 'var(--text-muted)' }} />
                Gerçek Zamanlı Kayıt
                {isRecording && (
                  <span className="ml-auto text-[9px] font-mono px-2 py-0.5 rounded"
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}>
                    {recordCount} nota
                  </span>
                )}
              </p>
              {!isRecording
                ? <button onClick={startRec} className="btn btn-record w-full py-2.5 text-xs font-bold">
                    <Mic className="w-3.5 h-3.5" /> Kayıta Başla
                  </button>
                : <button onClick={stopRec} className="btn btn-record-active w-full py-2.5 text-xs font-bold">
                    <Square className="w-3.5 h-3.5 fill-current" /> Durdur & Kaydet
                  </button>
              }
            </div>

            {/* İstatistik özeti */}
            <div className="glass p-3.5 flex flex-col gap-2.5">
              <p className="section-label flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} /> Performans
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: 'Nota',     value: notesPressed,  color: 'var(--accent)' },
                  { label: 'İsabet',   value: correctNotes,  color: '#4ade80' },
                  { label: 'Doğruluk', value: `${accuracy}%`, color: accuracy >= 70 ? '#4ade80' : accuracy >= 40 ? '#fbbf24' : '#f87171' },
                ].map(s => (
                  <div key={s.label} className="stat-card">
                    <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-[7px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-dim)' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Mini velocity bar */}
              <div className="velocity-meter">
                {Array.from({ length: 16 }).map((_, idx) => {
                  const active = idx < Math.ceil((lastVelocity / 127) * 16);
                  let cls = 'velocity-led-segment';
                  if      (idx < 8)  cls += ' green';
                  else if (idx < 12) cls += ' yellow';
                  else if (idx < 14) cls += ' orange';
                  else               cls += ' red';
                  if (active) cls += ' active';
                  return <div key={idx} className={cls} />;
                })}
              </div>
              <div className="flex justify-between text-[8px] font-mono" style={{ color: 'var(--text-dim)' }}>
                <span>Son: <span style={{ color: 'var(--accent)' }}>{lastVelocity}</span></span>
                <span>Ort: <span style={{ color: 'var(--accent)' }}>
                  {velocityCount > 0 ? Math.round(velocitySum / velocityCount) : 0}
                </span></span>
              </div>

              <button onClick={() => {
                setNotesPressed(0); setCorrectNotes(0);
                setLastVelocity(0); setVelocitySum(0); setVelocityCount(0);
                setVelocityHistory([]); setNoteHistory([]); setVelocityMap({});
              }}
                className="text-[10px] text-center font-bold transition-colors hover:opacity-80"
                style={{ color: 'var(--text-dim)' }}>
                Monitörü Sıfırla
              </button>
            </div>

            {/* Öğrenme Modu */}
            <LearningMode
              currentSongNotes={currentSong?.notes ?? []}
              activeNotes={activeNotes}
              activeHand={activeHand}
              onHandChange={setActiveHand}
            />

          </div>
        </aside>

        {/* Sidebar toggle */}
        <button
          onClick={() => setLeftOpen(p => !p)}
          className="relative z-20 self-start mt-5 -ml-px w-5 flex items-center justify-center h-12 rounded-r-lg transition-all shrink-0 cursor-pointer shadow-lg"
          style={{
            background: 'var(--panel)',
            border: `1px solid var(--border)`,
            color: 'var(--text-muted)',
          }}>
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${leftOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* ────────────────────────────────────────
            SAĞ ANA ALAN
            ──────────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col gap-3 p-3 overflow-y-auto h-full"
          style={{ background: 'rgba(0,0,0,0.06)' }}>

          {/* Sekme Bar */}
          <div className="tab-bar w-full">
            {RIGHT_TABS.map(t => (
              <button key={t.key}
                className={`tab-btn flex-1 justify-center ${rightTab === t.key ? 'active' : ''}`}
                onClick={() => setRightTab(t.key)}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ── GÖRSEL sekmesi ── */}
          {rightTab === 'gorsel' && (
            <div className="flex flex-col gap-3 animate-fade-in">
              <Visualizer
                notes={currentSong?.notes ?? []}
                currentTime={currentTime}
                activeNotes={activeNotes}
                isPlaying={isPlaying}
                transposeOffset={transposeOffset}
              />
              {/* Klavye haritası */}
              <div>
                <button onClick={() => setShowKbd(p => !p)}
                  className={`btn w-full py-2.5 text-xs gap-2 font-bold ${showKbd ? 'btn-primary metallic-shine' : 'btn-ghost'}`}>
                  <Keyboard className="w-4 h-4" />
                  {showKbd ? 'Klavye Haritasını Gizle' : 'Bilgisayar Klavye Tuşlarını Göster (A/S/D/F...)'}
                </button>
                {showKbd && (
                  <div className="mt-2 animate-slide-up">
                    <KeyboardMap activeKeys={activeKbd} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── SENTEZ sekmesi ── */}
          {rightTab === 'sentez' && (
            <div className="animate-fade-in">
              <SynthControls params={synthParams} onChange={handleSynthChange} />
            </div>
          )}

          {/* ── ANALİZ sekmesi ── */}
          {rightTab === 'analiz' && (
            <div className="flex flex-col gap-3 animate-fade-in">
              {/* Velocity rengi toggle */}
              <div className="glass p-3 flex items-center justify-between">
                <span className="section-label">Klavye Isı Haritası</span>
                <button onClick={() => setShowVelColors(p => !p)}
                  className={`btn py-1.5 px-4 text-xs font-bold ${showVelColors ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ minHeight: 32 }}>
                  {showVelColors ? '🔥 Aktif' : '🎹 Göster'}
                </button>
              </div>
              <VelocityAnalytics
                velocityHistory={velocityHistory}
                noteHistory={noteHistory}
                lastVelocity={lastVelocity}
                velocitySum={velocitySum}
                velocityCount={velocityCount}
              />
            </div>
          )}

          {/* ── MIDI sekmesi ── */}
          {rightTab === 'midi' && (
            <div className="flex flex-col gap-3 animate-fade-in">
              <MidiConnector onNoteOn={handleNoteOn} onNoteOff={handleNoteOff} />
              {/* Tam Metronom paneli */}
              <Metronome compact={false} />
            </div>
          )}

        </main>
      </div>

      {/* ══════════════════════════════════════════════════════
          PİYANO KLAVYE (Dip bölge)
          ══════════════════════════════════════════════════════ */}
      <div className="relative z-10 shrink-0 border-t" style={{ borderColor: 'var(--border)' }}>
        <PianoKeyboard
          activeNotes={activeNotes}
          targetNotes={targetNotes}
          onKeyMouseDown={n => handleNoteOn(n)}
          onKeyMouseUp={n => handleNoteOff(n)}
          velocityMap={velocityMap}
          transposeOffset={transposeOffset}
          showVelocityColors={showVelColors}
          activeHand={activeHand}
        />
      </div>

      {/* ── Nota Editörü Modalı ── */}
      {editingSong && (
        <SheetEditor song={editingSong} onClose={() => setEditingSong(null)} onSave={handleSaveNotes} />
      )}
    </div>
  );
};

export const App: React.FC = () => (
  <AppProvider><AppContent /></AppProvider>
);

export default App;
