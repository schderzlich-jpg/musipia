import React, { useEffect, useState } from 'react';
import { Cable, CheckCircle2, AlertTriangle, RefreshCw, ChevronDown } from 'lucide-react';

interface Props {
  onNoteOn:  (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
}

export const MidiConnector: React.FC<Props> = ({ onNoteOn, onNoteOff }) => {
  const [selected,    setSelected]    = useState<any>(null);
  const [allInputs,   setAllInputs]   = useState<any[]>([]);
  const [midiAccess,  setMidiAccess]  = useState<any>(null);
  const [status,      setStatus]      = useState<'checking'|'connected'|'disconnected'|'unsupported'>('checking');
  const [dropdown,    setDropdown]    = useState(false);

  const apply = (access: any) => {
    const inputs = Array.from(access.inputs.values()) as any[];
    setAllInputs(inputs);
    if (inputs.length > 0) {
      const yamaha = inputs.find((i: any) =>
        ['yamaha','p-225','p225'].some(k => i.name?.toLowerCase().includes(k)));
      setSelected(yamaha || inputs[0]);
      setStatus('connected');
    } else { setSelected(null); setStatus('disconnected'); }
  };

  const scan = (access?: any) => {
    const ma = access || midiAccess;
    if (!ma) {
      if (!navigator.requestMIDIAccess) { setStatus('unsupported'); return; }
      navigator.requestMIDIAccess()
        .then(a => { setMidiAccess(a); apply(a); a.onstatechange = () => apply(a); })
        .catch(() => setStatus('unsupported'));
      return;
    }
    apply(ma);
  };

  useEffect(() => { scan(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!selected) return;
    const handler = (e: any) => {
      const [sb, d1, d2] = e.data;
      const cmd = sb & 0xf0;
      if (cmd === 0x90 && d2 > 0) onNoteOn(d1, d2);
      else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) onNoteOff(d1);
    };
    selected.onmidimessage = handler;
    return () => { selected.onmidimessage = null; };
  }, [selected, onNoteOn, onNoteOff]);

  const connected = status === 'connected';

  return (
    <div className="relative w-full group">
      {/* Left Rack mount screw */}
      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-zinc-800 border border-zinc-700/60 shadow-inner flex items-center justify-center text-[7px] text-zinc-500 font-black pointer-events-none select-none z-10 font-mono">
        +
      </div>
      
      {/* Right Rack mount screw */}
      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-zinc-800 border border-zinc-700/60 shadow-inner flex items-center justify-center text-[7px] text-zinc-500 font-black pointer-events-none select-none z-10 font-mono">
        +
      </div>

      <div className={`glass pl-9 pr-9 py-3 flex items-center justify-between gap-3 transition-all relative ${
        connected ? 'glass-cyan border-cyan-500/20' : 'border-zinc-900/80 bg-zinc-950/20'
      }`}>
        {/* Left Status & Port */}
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all ${
            connected ? 'bg-cyan-500/10 border border-cyan-500/30' : 'bg-zinc-900 border border-zinc-850'
          }`}>
            <Cable className={`w-4 h-4 ${connected ? 'text-cyan-400 animate-pulse' : 'text-slate-500'}`} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-350">MIDI Link Input</p>
            <p className="text-[10px] text-slate-500 mt-0.5 font-medium">
              {connected ? `🎹 ${selected?.name}`
              : status==='disconnected' ? 'Connect a digital piano/MIDI keyboard via USB...'
              : status==='unsupported'  ? 'Web MIDI is not supported on this browser'
              : 'Scanning MIDI ports...'}
            </p>
          </div>

          {/* DIN-5 physical layout socket graphics */}
          <div className="hidden sm:flex items-center gap-2 ml-5 bg-black/45 border border-zinc-900 px-2 py-1 rounded-lg shrink-0">
            <span className="text-[7px] font-bold text-slate-500 tracking-wider font-mono">DIN-5 IN</span>
            <div className="w-5 h-5 rounded-full bg-zinc-950 border border-zinc-850 flex items-center justify-center relative shadow-inner">
              <span className="absolute w-1 h-1 rounded-full bg-zinc-900 top-0.5" />
              <span className="absolute w-0.5 h-0.5 rounded-full bg-zinc-700 top-2 left-1" />
              <span className="absolute w-0.5 h-0.5 rounded-full bg-zinc-700 top-2 right-1" />
              <span className="absolute w-0.5 h-0.5 rounded-full bg-zinc-700 bottom-1 left-1.5" />
              <span className="absolute w-0.5 h-0.5 rounded-full bg-zinc-700 bottom-1 right-1.5" />
            </div>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2.5 relative">
          {connected ? (
            <span className="flex items-center gap-1.5 text-[9px] font-mono px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-bold uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[9px] font-mono px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 font-bold uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Offline
            </span>
          )}

          {allInputs.length > 1 && (
            <div className="relative">
              <button onClick={() => setDropdown(p => !p)}
                className="p-1.5 rounded-lg hover:bg-white/[.05] text-slate-500 hover:text-slate-200 border border-transparent hover:border-zinc-800 transition-all cursor-pointer">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {dropdown && (
                <div className="absolute right-0 top-full mt-1.5 z-50 glass border-zinc-900 rounded-lg shadow-2xl min-w-[200px] overflow-hidden animate-slide-up bg-[#0d0d14]">
                  {allInputs.map((inp: any) => (
                    <button key={inp.id} onClick={() => { setSelected(inp); setDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-xs hover:bg-white/[.04] transition-colors cursor-pointer ${
                        selected?.id === inp.id ? 'text-cyan-400 bg-cyan-500/5 font-semibold' : 'text-slate-400'
                      }`}>
                      {inp.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button onClick={() => scan()}
            className="p-1.5 rounded-lg hover:bg-white/[.05] text-slate-500 hover:text-slate-250 border border-transparent hover:border-zinc-800 transition-all cursor-pointer" title="Rescan Ports">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
export default MidiConnector;
