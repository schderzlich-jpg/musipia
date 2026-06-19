import React, { useRef, useEffect } from 'react';
import type { SynthParams } from '../services/soundEngine';
import { Sliders, Activity, Disc, Radio, Piano, Zap, Music2 } from 'lucide-react';

interface SynthControlsProps {
  params: SynthParams;
  onChange: (updated: Partial<SynthParams>) => void;
}

const PRESETS = [
  { id: 'piano',   label: 'Grand Piano',   icon: Piano,    activeClass: 'border-amber-500/50 text-amber-400 bg-amber-500/10', dot: 'bg-amber-400' },
  { id: 'lead',    label: 'Cyber Lead',    icon: Activity, activeClass: 'border-pink-500/50 text-pink-400 bg-pink-500/10',    dot: 'bg-pink-400' },
  { id: 'pad',     label: 'Cosmic Pad',    icon: Disc,     activeClass: 'border-violet-500/50 text-violet-400 bg-violet-500/10', dot: 'bg-violet-400' },
  { id: 'fm',      label: 'Retro FM',      icon: Radio,    activeClass: 'border-cyan-500/50 text-cyan-400 bg-cyan-500/10',     dot: 'bg-cyan-400' },
  { id: 'epiano',  label: 'Warm E-Piano',  icon: Music2,   activeClass: 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10', dot: 'bg-emerald-400' },
];

// ---- ADSR Canvas Visualizer ----
const AdsrCanvas: React.FC<{ params: SynthParams }> = ({ params }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (params.synthType === 'piano') {
      // Elegant physical sampler graphic message
      ctx.fillStyle = 'rgba(13, 13, 22, 0.7)';
      ctx.fillRect(0, 0, W, H);
      
      ctx.fillStyle = '#fbbf24';
      ctx.font = "bold 9px 'Orbitron', monospace";
      ctx.textAlign = 'center';
      ctx.fillText('ACOUSTIC SAMPLER PRESET', W / 2, H / 2 - 3);
      
      ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
      ctx.font = "8px 'Inter', sans-serif";
      ctx.fillText('Salamander Grand Piano v3 · 88 Keys', W / 2, H / 2 + 10);
      return;
    }

    // Restore text alignment for normal drawing
    ctx.textAlign = 'left';

    // Normalize time values into pixel widths
    const totalTime = params.attack + params.decay + 0.5 + params.release; // sustain = 0.5s hold
    const px = (t: number) => (t / totalTime) * W * 0.88; // 88% width used
    const sustainX = px(params.attack + params.decay);
    const releaseEndX = px(params.attack + params.decay + 0.5 + params.release);

    const attackX  = px(params.attack);
    const decayX   = px(params.attack + params.decay);
    const sustainY = H - params.sustain * (H - 8) - 4;
    const peakY    = 4;

    // Grid
    ctx.strokeStyle = 'rgba(39,39,42,0.4)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (H / 4) * i);
      ctx.lineTo(W, (H / 4) * i);
      ctx.stroke();
    }

    // Fill area under ADSR curve
    const grad = ctx.createLinearGradient(0, 0, releaseEndX, 0);
    grad.addColorStop(0, 'rgba(236,72,153,0.15)');
    grad.addColorStop(0.35, 'rgba(168,85,247,0.12)');
    grad.addColorStop(0.7, 'rgba(6,182,212,0.12)');
    grad.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H); // start
    ctx.lineTo(attackX, peakY); // attack rise
    ctx.lineTo(decayX, sustainY); // decay fall
    ctx.lineTo(sustainX, sustainY); // sustain hold
    ctx.lineTo(releaseEndX, H); // release
    ctx.lineTo(releaseEndX, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // ADSR line
    const lineGrad = ctx.createLinearGradient(0, 0, releaseEndX, 0);
    lineGrad.addColorStop(0, '#ec4899');
    lineGrad.addColorStop(0.35, '#a855f7');
    lineGrad.addColorStop(0.7, '#06b6d4');
    lineGrad.addColorStop(1, '#06b6d4');

    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(attackX, peakY);
    ctx.lineTo(decayX, sustainY);
    ctx.lineTo(sustainX, sustainY);
    ctx.lineTo(releaseEndX, H);
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Labels
    ctx.fillStyle = 'rgba(100,116,139,0.8)';
    ctx.font = "bold 9px 'Orbitron', monospace";
    ctx.fillText('A', attackX / 2 - 4, H - 2);
    ctx.fillText('D', (attackX + decayX) / 2 - 4, H - 2);
    ctx.fillText('S', (decayX + sustainX) / 2 - 4, H - 2);
    ctx.fillText('R', (sustainX + releaseEndX) / 2 - 4, H - 2);

    // Dot markers
    const dots: [number, number][] = [
      [0, H], [attackX, peakY], [decayX, sustainY], [sustainX, sustainY], [releaseEndX, H],
    ];
    dots.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#a855f7';
      ctx.fill();
    });
  }, [params.attack, params.decay, params.sustain, params.release, params.synthType]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={60}
      className="w-full rounded-lg bg-zinc-950/60 border border-zinc-900"
      style={{ imageRendering: 'crisp-edges' }}
    />
  );
};

// ---- Styled Slider Row ----
const SliderRow: React.FC<{
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  accent: 'pink' | 'cyan' | 'violet' | 'emerald' | 'amber';
  onChange: (v: number) => void;
}> = ({ label, value, displayValue, min, max, step, accent, onChange }) => {
  const pct = ((value - min) / (max - min)) * 100;
  const trackColors: Record<string, string> = {
    pink:    `linear-gradient(to right, #ec4899 ${pct}%, #181822 ${pct}%)`,
    cyan:    `linear-gradient(to right, #06b6d4 ${pct}%, #181822 ${pct}%)`,
    violet:  `linear-gradient(to right, #a855f7 ${pct}%, #181822 ${pct}%)`,
    emerald: `linear-gradient(to right, #10b981 ${pct}%, #181822 ${pct}%)`,
    amber:   `linear-gradient(to right, #fbbf24 ${pct}%, #181822 ${pct}%)`,
  };
  const thumbColors: Record<string, string> = {
    pink:    'accent-pink thumb-pink',
    cyan:    'accent-cyan',
    violet:  'accent-violet thumb-violet',
    emerald: 'accent-emerald thumb-emerald',
    amber:   'accent-amber thumb-amber',
  };

  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1.5">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-200 font-orbitron text-[10px]">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full h-1 appearance-none cursor-pointer bg-slate-900 ${thumbColors[accent]}`}
        style={{ background: trackColors[accent] }}
      />
    </div>
  );
};

export const SynthControls: React.FC<SynthControlsProps> = ({ params, onChange }) => {
  return (
    <div className="glass p-4 flex flex-col gap-4 border-slate-900">
      <div className="flex items-center gap-2 border-b border-white/[0.04] pb-2.5">
        <Sliders className="w-4 h-4 text-cyan-400" />
        <h2 className="font-bold text-xs uppercase tracking-wider text-slate-200">Synth Engine Rack</h2>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-500">
          <Zap className="w-3 h-3 text-yellow-500" /> Web Audio Engine
        </span>
      </div>

      {/* Preset Selector */}
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
          Sound Preset Select
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {PRESETS.map((preset) => {
            const Icon = preset.icon;
            const isSelected = params.synthType === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => onChange({ synthType: preset.id as any })}
                className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                  isSelected
                    ? preset.activeClass
                    : 'border-zinc-900 text-slate-500 bg-zinc-950/20 hover:text-slate-300 hover:border-zinc-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{preset.label}</span>
                {isSelected && (
                  <span className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${preset.dot} animate-pulse`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start mt-1">
        {/* ADSR Visual */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
            ADSR Envelope Monitor
          </label>
          <AdsrCanvas params={params} />
        </div>

        {/* ADSR Sliders */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block border-b border-white/[0.04] pb-1">
            Envelope Settings {params.synthType === 'piano' && (
              <span className="text-amber-500 text-[8px] lowercase font-normal ml-1">(bypassed)</span>
            )}
          </label>
          <div className={`grid grid-cols-2 gap-x-4 gap-y-2.5 ${params.synthType === 'piano' ? 'opacity-25 pointer-events-none' : ''}`}>
            <SliderRow
              label="Attack"
              value={params.attack}
              displayValue={`${params.attack.toFixed(2)}s`}
              min={0.01} max={2.0} step={0.01}
              accent="pink"
              onChange={(v) => onChange({ attack: v })}
            />
            <SliderRow
              label="Decay"
              value={params.decay}
              displayValue={`${params.decay.toFixed(2)}s`}
              min={0.1} max={2.0} step={0.05}
              accent="pink"
              onChange={(v) => onChange({ decay: v })}
            />
            <SliderRow
              label="Sustain"
              value={params.sustain}
              displayValue={`${Math.round(params.sustain * 100)}%`}
              min={0.0} max={1.0} step={0.05}
              accent="violet"
              onChange={(v) => onChange({ sustain: v })}
            />
            <SliderRow
              label="Release"
              value={params.release}
              displayValue={`${params.release.toFixed(1)}s`}
              min={0.1} max={5.0} step={0.1}
              accent="violet"
              onChange={(v) => onChange({ release: v })}
            />
          </div>
        </div>

        {/* Filter & FX */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block border-b border-white/[0.04] pb-1">
            Filter &amp; Master Effects
          </label>
          <div className="flex flex-col gap-2.5">
            <SliderRow
              label="Filter Cutoff"
              value={params.cutoff}
              displayValue={`${params.cutoff} Hz`}
              min={200} max={8000} step={100}
              accent="cyan"
              onChange={(v) => onChange({ cutoff: v })}
            />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <SliderRow
                  label="Q"
                  value={params.resonance}
                  displayValue={params.resonance.toFixed(1)}
                  min={0.1} max={15.0} step={0.1}
                  accent="cyan"
                  onChange={(v) => onChange({ resonance: v })}
                />
              </div>
              <div className="col-span-1">
                <SliderRow
                  label="Delay"
                  value={params.delayWet}
                  displayValue={`${Math.round(params.delayWet * 100)}%`}
                  min={0.0} max={1.0} step={0.05}
                  accent="violet"
                  onChange={(v) => onChange({ delayWet: v })}
                />
              </div>
              <div className="col-span-1">
                <SliderRow
                  label="Reverb"
                  value={params.reverbWet}
                  displayValue={`${Math.round(params.reverbWet * 100)}%`}
                  min={0.0} max={1.0} step={0.05}
                  accent="violet"
                  onChange={(v) => onChange({ reverbWet: v })}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default SynthControls;
