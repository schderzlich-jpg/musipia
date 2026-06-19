import React, { useMemo, useRef, useEffect } from 'react';
import { BarChart3, Thermometer, TrendingUp, Music } from 'lucide-react';

interface VelocityAnalyticsProps {
  velocityHistory: number[];      // son N basışın velocity değerleri
  noteHistory: number[];          // karşılık gelen MIDI nota numaraları
  lastVelocity: number;
  velocitySum: number;
  velocityCount: number;
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const OCTAVES = [2, 3, 4, 5, 6]; // Gösterilecek oktavlar (60 = C4)

function getDynamic(v: number): { label: string; color: string } {
  if (v < 20)  return { label: 'ppp', color: '#60a5fa' };
  if (v < 40)  return { label: 'pp',  color: '#7dd3fc' };
  if (v < 55)  return { label: 'p',   color: '#34d399' };
  if (v < 70)  return { label: 'mp',  color: '#a3e635' };
  if (v < 85)  return { label: 'mf',  color: '#fbbf24' };
  if (v < 100) return { label: 'f',   color: '#f97316' };
  if (v < 115) return { label: 'ff',  color: '#ef4444' };
  return              { label: 'fff', color: '#dc2626' };
}

function getHeatColor(count: number, max: number): string {
  if (count === 0) return 'transparent';
  const ratio = count / max;
  if (ratio < 0.15) return 'rgba(96,165,250,0.5)';
  if (ratio < 0.35) return 'rgba(52,211,153,0.7)';
  if (ratio < 0.55) return 'rgba(163,230,53,0.75)';
  if (ratio < 0.75) return 'rgba(251,191,36,0.8)';
  if (ratio < 0.90) return 'rgba(249,115,22,0.85)';
  return 'rgba(239,68,68,0.95)';
}

const VelocityAnalytics: React.FC<VelocityAnalyticsProps> = ({
  velocityHistory,
  noteHistory,
  lastVelocity,
  velocitySum,
  velocityCount,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  const avgVelocity = velocityCount > 0 ? Math.round(velocitySum / velocityCount) : 0;
  const maxVelocity = velocityHistory.length > 0 ? Math.max(...velocityHistory) : 0;
  const minVelocity = velocityHistory.length > 0 ? Math.min(...velocityHistory) : 0;
  const dynamic = getDynamic(lastVelocity);
  const avgDynamic = getDynamic(avgVelocity);

  // Nota bazında vuruş sayısı haritası (C2 → B6 = 60 nota)
  const noteCounts = useMemo(() => {
    const map: Record<number, number> = {};
    for (const n of noteHistory) {
      map[n] = (map[n] || 0) + 1;
    }
    return map;
  }, [noteHistory]);

  const maxCount = useMemo(() => Math.max(1, ...Object.values(noteCounts)), [noteCounts]);

  // SVG Grafik: son 60 vuruşun velocity seyri
  const graphPoints = useMemo(() => {
    const recent = velocityHistory.slice(-60);
    if (recent.length < 2) return '';
    const W = 280, H = 70;
    return recent
      .map((v, i) => {
        const x = (i / (recent.length - 1)) * W;
        const y = H - (v / 127) * H;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [velocityHistory]);

  const graphArea = useMemo(() => {
    const recent = velocityHistory.slice(-60);
    if (recent.length < 2) return '';
    const W = 280, H = 70;
    const pts = recent
      .map((v, i) => {
        const x = (i / (recent.length - 1)) * W;
        const y = H - (v / 127) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return `M0,${H} L${pts} L${W},${H} Z`;
  }, [velocityHistory]);

  // 14-segment LED bar
  const ledSegments = 16;
  const activeSegs = Math.ceil((lastVelocity / 127) * ledSegments);

  return (
    <div className="flex flex-col gap-3 animate-fade-in">

      {/* Büyük Dinamik Göstergesi + LED Bar */}
      <div className="glass p-4 flex flex-col gap-3">
        <p className="section-label flex items-center gap-1.5">
          <Thermometer className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          Anlık Vuruş Şiddeti
        </p>

        <div className="flex items-center gap-4">
          {/* Dinamik etiketi */}
          <div className="flex flex-col items-center gap-0.5">
            <span className="dynamic-badge" style={{ color: dynamic.color }}>
              {lastVelocity > 0 ? dynamic.label : '—'}
            </span>
            <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>DİNAMİK</span>
          </div>

          {/* LED bar */}
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="velocity-meter">
              {Array.from({ length: ledSegments }).map((_, idx) => {
                const isActive = idx < activeSegs;
                let cls = 'velocity-led-segment';
                if (idx < 8)        cls += ' green';
                else if (idx < 12)  cls += ' yellow';
                else if (idx < 14)  cls += ' orange';
                else                cls += ' red';
                if (isActive) cls += ' active';
                return <div key={idx} className={cls} />;
              })}
            </div>
            <div className="flex justify-between text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>
              <span>0 — ppp</span>
              <span className="font-bold" style={{ color: dynamic.color }}>{lastVelocity} / 127</span>
              <span>fff — 127</span>
            </div>
          </div>
        </div>
      </div>

      {/* İstatistikler Satırı */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Ortalama', value: avgVelocity, sub: avgDynamic.label, color: avgDynamic.color },
          { label: 'Maksimum', value: maxVelocity, sub: getDynamic(maxVelocity).label, color: getDynamic(maxVelocity).color },
          { label: 'Minimum',  value: minVelocity, sub: getDynamic(minVelocity).label, color: getDynamic(minVelocity).color },
          { label: 'Toplam',   value: velocityCount, sub: 'tuş', color: 'var(--accent)' },
        ].map((s) => (
          <div key={s.label} className="stat-card flex flex-col gap-0.5">
            <div className="text-base font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[8px] font-mono" style={{ color: s.color, opacity: 0.8 }}>{s.sub}</div>
            <div className="text-[7px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Oturum Grafiği */}
      <div className="glass p-3 flex flex-col gap-2">
        <p className="section-label flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          Oturum Grafiği <span className="ml-auto font-mono text-[9px]" style={{ color: 'var(--text-dim)' }}>son {Math.min(velocityHistory.length, 60)} vuruş</span>
        </p>
        <div className="session-graph">
          {velocityHistory.length < 2 ? (
            <div className="w-full h-full flex items-center justify-center text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
              Henüz veri yok — tuşlara basın
            </div>
          ) : (
            <svg ref={svgRef} viewBox="0 0 280 70" preserveAspectRatio="none" className="w-full h-full">
              {/* Grid lines */}
              {[0.25, 0.5, 0.75].map((r) => (
                <line key={r} x1="0" y1={70 * (1 - r)} x2="280" y2={70 * (1 - r)}
                  stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3,3" />
              ))}
              {/* Area fill */}
              <path d={graphArea} fill="rgba(223,190,93,0.08)" />
              {/* Line */}
              <path d={graphPoints} fill="none" stroke="var(--accent)" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
              {/* Average line */}
              {avgVelocity > 0 && (
                <line x1="0" y1={70 - (avgVelocity / 127) * 70}
                  x2="280" y2={70 - (avgVelocity / 127) * 70}
                  stroke="rgba(223,190,93,0.4)" strokeWidth="1" strokeDasharray="5,3" />
              )}
            </svg>
          )}
        </div>
        {/* Y labels */}
        <div className="flex justify-between text-[8px] font-mono" style={{ color: 'var(--text-dim)' }}>
          <span>pp</span><span>mp</span><span>mf</span><span>f</span><span>fff</span>
        </div>
      </div>

      {/* Nota Isı Haritası */}
      <div className="glass p-3 flex flex-col gap-2">
        <p className="section-label flex items-center gap-1.5">
          <Music className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          Nota Isı Haritası
          <span className="ml-auto text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>C2 → B6</span>
        </p>
        <div className="heatmap-grid" style={{ gridTemplateColumns: 'repeat(12, 1fr)' }}>
          {OCTAVES.flatMap((oct) =>
            NOTE_NAMES.map((name, ni) => {
              const midiNote = (oct + 1) * 12 + ni;
              const count = noteCounts[midiNote] || 0;
              const color = getHeatColor(count, maxCount);
              const isBlack = [1,3,6,8,10].includes(ni);
              return (
                <div
                  key={midiNote}
                  className="heatmap-cell"
                  data-label={`${name}${oct}: ${count} kez`}
                  style={{
                    background: count > 0 ? color : 'var(--border)',
                    border: `1px solid ${isBlack ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.08)'}`,
                    boxShadow: count > 0 ? `0 0 4px ${color}` : 'none',
                  }}
                />
              );
            })
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[8px] font-mono" style={{ color: 'var(--text-dim)' }}>Az</span>
          <div className="flex-1 h-2 rounded-full" style={{
            background: 'linear-gradient(to right, rgba(96,165,250,0.5), rgba(52,211,153,0.7), rgba(251,191,36,0.8), rgba(239,68,68,0.95))'
          }} />
          <span className="text-[8px] font-mono" style={{ color: 'var(--text-dim)' }}>Çok</span>
        </div>
      </div>

    </div>
  );
};

export default VelocityAnalytics;
