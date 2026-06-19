import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import { Play, Square, Minus, Plus } from 'lucide-react';

interface MetronomeProps {
  compact?: boolean;
}

const Metronome: React.FC<MetronomeProps> = ({ compact = false }) => {
  const [bpm, setBpm] = useState(100);
  const [isRunning, setIsRunning] = useState(false);
  const [beat, setBeat] = useState(0);         // 0-3 (4/4)
  const [pendulumDir, setPendulumDir] = useState<'left' | 'right'>('left');

  const loopRef = useRef<Tone.Loop | null>(null);
  const clickSynthRef = useRef<Tone.Synth | null>(null);

  // Create synth on mount
  useEffect(() => {
    clickSynthRef.current = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
      volume: -12,
    }).toDestination();
    return () => {
      clickSynthRef.current?.dispose();
      loopRef.current?.dispose();
    };
  }, []);

  // Update BPM when state changes
  useEffect(() => {
    Tone.getTransport().bpm.value = bpm;
  }, [bpm]);

  const startMetronome = useCallback(async () => {
    await Tone.start();
    Tone.getTransport().bpm.value = bpm;

    let beatCount = 0;
    loopRef.current = new Tone.Loop((time) => {
      const currentBeat = beatCount % 4;
      const isAccent = currentBeat === 0;

      // Play click — accent on beat 1
      if (clickSynthRef.current) {
        clickSynthRef.current.triggerAttackRelease(
          isAccent ? 'C5' : 'G4',
          '32n',
          time,
          isAccent ? 0.9 : 0.6
        );
      }

      // Schedule UI update
      Tone.getDraw().schedule(() => {
        setBeat(currentBeat);
        setPendulumDir(prev => prev === 'left' ? 'right' : 'left');
      }, time);

      beatCount++;
    }, '4n');

    loopRef.current.start(0);
    Tone.getTransport().start();
    setIsRunning(true);
  }, [bpm]);

  const stopMetronome = useCallback(() => {
    loopRef.current?.stop();
    loopRef.current?.dispose();
    loopRef.current = null;
    Tone.getTransport().stop();
    setBeat(0);
    setPendulumDir('left');
    setIsRunning(false);
  }, []);

  const toggleMetronome = () => {
    if (isRunning) stopMetronome();
    else startMetronome();
  };

  const changeBpm = (delta: number) => {
    setBpm(prev => Math.min(240, Math.max(40, prev + delta)));
  };

  // Pendulum angle
  const pendulumAngle = pendulumDir === 'left' ? -25 : 25;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border"
        style={{ background: 'rgba(0,0,0,0.25)', borderColor: 'var(--border)' }}>
        {/* Beat dots */}
        <div className="flex gap-1">
          {[0,1,2,3].map(i => (
            <div key={i} className="w-2 h-2 rounded-full transition-all duration-75"
              style={{
                background: isRunning && beat === i
                  ? (i === 0 ? 'var(--accent)' : 'rgba(223,190,93,0.5)')
                  : 'var(--border)',
                boxShadow: isRunning && beat === i && i === 0
                  ? '0 0 6px var(--accent)'
                  : 'none',
              }} />
          ))}
        </div>

        {/* BPM control */}
        <button onClick={() => changeBpm(-5)}
          className="w-6 h-6 flex items-center justify-center rounded"
          style={{ background: 'var(--btn-ghost-bg)', color: 'var(--text-muted)' }}>
          <Minus className="w-3 h-3" />
        </button>

        <span className="font-mono text-xs font-bold min-w-[3rem] text-center"
          style={{ color: isRunning ? 'var(--accent)' : 'var(--text-muted)' }}>
          {bpm} BPM
        </span>

        <button onClick={() => changeBpm(5)}
          className="w-6 h-6 flex items-center justify-center rounded"
          style={{ background: 'var(--btn-ghost-bg)', color: 'var(--text-muted)' }}>
          <Plus className="w-3 h-3" />
        </button>

        {/* Toggle */}
        <button onClick={toggleMetronome}
          className={`btn px-3 py-1.5 text-xs ${isRunning ? 'btn-record-active' : 'btn-ghost'}`}
          style={{ minHeight: '28px', fontSize: '10px' }}>
          {isRunning ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
          {isRunning ? 'Durdur' : 'Metronom'}
        </button>
      </div>
    );
  }

  // Full panel view
  return (
    <div className="glass p-4 flex flex-col gap-3">
      <p className="section-label">🥁 Metronom</p>

      {/* Pendulum visual */}
      <div className="flex justify-center items-end h-20">
        <div className="relative w-2 flex justify-center" style={{ height: 80 }}>
          {/* Pivot */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full z-10"
            style={{ background: 'var(--accent)' }} />
          {/* Arm */}
          <div
            className="metronome-arm absolute top-0 left-1/2 origin-top"
            style={{
              width: 3,
              height: 70,
              background: 'linear-gradient(to bottom, var(--accent), var(--text-muted))',
              borderRadius: 2,
              transform: `translateX(-50%) rotate(${isRunning ? pendulumAngle : 0}deg)`,
              transition: isRunning ? `transform ${(60 / bpm) * 0.5}s ease-in-out` : 'transform 0.3s ease',
            }}
          >
            {/* Bob */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full"
              style={{
                background: isRunning && beat === 0 ? 'var(--accent)' : 'var(--text-muted)',
                boxShadow: isRunning && beat === 0 ? '0 0 8px var(--accent)' : 'none',
                transition: 'background 0.1s',
              }} />
          </div>
        </div>
      </div>

      {/* BPM control */}
      <div className="flex items-center gap-2">
        <button onClick={() => changeBpm(-10)} className="btn btn-ghost px-3 py-2 text-xs">−10</button>
        <button onClick={() => changeBpm(-1)}  className="btn btn-ghost px-3 py-2 text-xs">−1</button>
        <div className="flex-1 text-center">
          <div className="text-2xl font-mono font-bold" style={{ color: 'var(--accent)' }}>{bpm}</div>
          <div className="text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>BPM</div>
        </div>
        <button onClick={() => changeBpm(1)}   className="btn btn-ghost px-3 py-2 text-xs">+1</button>
        <button onClick={() => changeBpm(10)}  className="btn btn-ghost px-3 py-2 text-xs">+10</button>
      </div>

      <input type="range" min={40} max={240} step={1} value={bpm}
        onChange={e => setBpm(+e.target.value)}
        className="w-full"
        style={{ background: `linear-gradient(to right, var(--accent) ${((bpm-40)/200)*100}%, var(--border) ${((bpm-40)/200)*100}%)` }} />

      {/* Beat dots */}
      <div className="flex justify-center gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className="w-4 h-4 rounded-full transition-all duration-75"
            style={{
              background: isRunning && beat === i
                ? (i === 0 ? 'var(--accent)' : 'rgba(223,190,93,0.5)')
                : 'var(--border)',
              boxShadow: isRunning && beat === i && i === 0 ? '0 0 8px var(--accent)' : 'none',
              transform: isRunning && beat === i ? 'scale(1.3)' : 'scale(1)',
            }} />
        ))}
      </div>

      <button onClick={toggleMetronome}
        className={`btn w-full font-bold ${isRunning ? 'btn-record-active' : 'btn-primary metallic-shine'}`}>
        {isRunning
          ? <><Square className="w-4 h-4 fill-current" /> Durdur</>
          : <><Play className="w-4 h-4 fill-current" /> Başlat</>}
      </button>
    </div>
  );
};

export default Metronome;
