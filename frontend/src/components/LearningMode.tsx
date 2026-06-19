import React, { useState, useEffect, useCallback } from 'react';
import { GraduationCap, Hand, Shuffle, CheckCircle, XCircle, Star } from 'lucide-react';
import type { NoteInfo } from '../context/AppContext';

interface LearningModeProps {
  currentSongNotes: NoteInfo[];
  activeNotes: Set<number>;
  onHandChange?: (hand: 'both' | 'right' | 'left') => void;
  activeHand: 'both' | 'right' | 'left';
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function getNoteName(midi: number): string {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

// Generate a random quiz note (white keys only, C3-C6 range)
function randomQuizNote(): number {
  const whiteKeyOffsets = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
  const octave = Math.floor(Math.random() * 3) + 3; // 3,4,5
  const offset = whiteKeyOffsets[Math.floor(Math.random() * whiteKeyOffsets.length)];
  return octave * 12 + offset;
}

type QuizResult = 'idle' | 'correct' | 'wrong';

const LearningMode: React.FC<LearningModeProps> = ({
  currentSongNotes,
  activeNotes,
  onHandChange,
  activeHand,
}) => {
  const [mode, setMode] = useState<'hand' | 'quiz'>('hand');

  // Quiz state
  const [quizNote, setQuizNote] = useState<number>(randomQuizNote());
  const [result, setResult] = useState<QuizResult>('idle');
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [answered, setAnswered] = useState(false);

  // Hand mode: filter note counts
  const rightHandNotes = currentSongNotes.filter(n => n.pitch >= 60).length;
  const leftHandNotes  = currentSongNotes.filter(n => n.pitch <  60).length;

  // Watch activeNotes for quiz answer
  useEffect(() => {
    if (mode !== 'quiz' || answered) return;
    if (activeNotes.size === 0) return;

    const pressed = Array.from(activeNotes);
    const correct = pressed.some(n => (n % 12) === (quizNote % 12));

    if (correct) {
      setResult('correct');
      setScore(s => s + 1);
      setStreak(s => {
        const ns = s + 1;
        setBestStreak(b => Math.max(b, ns));
        return ns;
      });
    } else {
      setResult('wrong');
      setStreak(0);
    }

    setAttempts(a => a + 1);
    setAnswered(true);

    // Next note after delay
    setTimeout(() => {
      setResult('idle');
      setAnswered(false);
      setQuizNote(randomQuizNote());
    }, 1200);
  }, [activeNotes, mode, quizNote, answered]);

  const resetQuiz = useCallback(() => {
    setScore(0);
    setAttempts(0);
    setStreak(0);
    setQuizNote(randomQuizNote());
    setResult('idle');
    setAnswered(false);
  }, []);

  const accuracy = attempts > 0 ? Math.round((score / attempts) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      {/* Mode tabs */}
      <div className="tab-bar">
        <button className={`tab-btn ${mode === 'hand' ? 'active' : ''}`} onClick={() => setMode('hand')}>
          <Hand className="w-3.5 h-3.5" /> El Seçimi
        </button>
        <button className={`tab-btn ${mode === 'quiz' ? 'active' : ''}`} onClick={() => setMode('quiz')}>
          <GraduationCap className="w-3.5 h-3.5" /> Nota Sınavı
        </button>
      </div>

      {/* ── HAND SELECTION MODE ── */}
      {mode === 'hand' && (
        <div className="glass p-4 flex flex-col gap-3">
          <p className="section-label flex items-center gap-1.5">
            <Hand className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            El Seçimi Pratiği
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Parçayı iki elde ayrı ayrı pratik edin. Seçilen el dışındaki notalar gri gösterilir.
          </p>

          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'both',  label: '🎹 Her İki El', count: currentSongNotes.length },
              { key: 'right', label: '✋ Sağ El',     count: rightHandNotes },
              { key: 'left',  label: '🤚 Sol El',     count: leftHandNotes  },
            ].map(h => (
              <button
                key={h.key}
                onClick={() => onHandChange?.(h.key as any)}
                className={`btn py-3 flex-col gap-1 text-[11px] ${activeHand === h.key ? 'btn-primary metallic-shine' : 'btn-ghost'}`}
                style={{ minHeight: 64 }}
              >
                <span className="text-base">{h.label.split(' ')[0]}</span>
                <span>{h.label.split(' ').slice(1).join(' ')}</span>
                <span className="text-[9px] font-mono opacity-70">{h.count} nota</span>
              </button>
            ))}
          </div>

          {/* Info panel */}
          <div className="rounded-lg p-3 text-[10px] font-mono"
            style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)' }}>
            <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}>
              <span>Sağ El (≥C4):</span>
              <span style={{ color: 'var(--accent)' }}>{rightHandNotes} nota</span>
            </div>
            <div className="flex justify-between mt-1" style={{ color: 'var(--text-muted)' }}>
              <span>Sol El (&lt;C4):</span>
              <span style={{ color: 'var(--accent)' }}>{leftHandNotes} nota</span>
            </div>
            <div className="flex justify-between mt-1" style={{ color: 'var(--text-muted)' }}>
              <span>Aktif Mod:</span>
              <span style={{ color: 'var(--accent)' }}>
                {activeHand === 'both' ? 'Her İki El' : activeHand === 'right' ? 'Sağ El' : 'Sol El'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── QUIZ MODE ── */}
      {mode === 'quiz' && (
        <div className="flex flex-col gap-3">
          {/* Quiz card */}
          <div className="glass p-5 flex flex-col items-center gap-3">
            <p className="section-label flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              Bu notaya basın!
            </p>

            {/* Note display */}
            <div className={`quiz-note-display ${
              result === 'correct' ? 'quiz-result-correct' :
              result === 'wrong'   ? 'quiz-result-wrong'   : ''
            }`} style={{
              color: result === 'correct' ? '#4ade80' :
                     result === 'wrong'   ? '#f87171' :
                     'var(--accent)',
            }}>
              {getNoteName(quizNote)}
            </div>

            {/* Result feedback */}
            <div className="h-8 flex items-center justify-center">
              {result === 'correct' && (
                <div className="flex items-center gap-2 text-green-400 animate-slide-up">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-bold text-sm">Doğru! +1</span>
                </div>
              )}
              {result === 'wrong' && (
                <div className="flex items-center gap-2 text-red-400 animate-slide-up">
                  <XCircle className="w-5 h-5" />
                  <span className="font-bold text-sm">Yanlış! Doğru: {getNoteName(quizNote)}</span>
                </div>
              )}
              {result === 'idle' && (
                <span className="text-[10px] font-mono animate-pulse" style={{ color: 'var(--text-dim)' }}>
                  Herhangi bir oktavda basabilirsiniz
                </span>
              )}
            </div>

            {/* Streak badge */}
            {streak >= 3 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full animate-slide-up"
                style={{ background: 'rgba(223,190,93,0.12)', border: '1px solid rgba(223,190,93,0.3)' }}>
                <Star className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} fill="currentColor" />
                <span className="text-xs font-bold font-mono" style={{ color: 'var(--accent)' }}>
                  {streak} seri!
                </span>
              </div>
            )}
          </div>

          {/* Score panel */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Doğru', value: score, color: '#4ade80' },
              { label: 'Toplam', value: attempts, color: 'var(--accent)' },
              { label: 'Başarı', value: `${accuracy}%`, color: accuracy >= 70 ? '#4ade80' : accuracy >= 40 ? '#fbbf24' : '#f87171' },
              { label: 'En İyi Seri', value: bestStreak, color: 'var(--accent)' },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="text-base font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[7px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-dim)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            <button onClick={resetQuiz} className="btn btn-ghost flex-1 text-xs gap-2">
              <Shuffle className="w-3.5 h-3.5" /> Sıfırla
            </button>
            <button onClick={() => { setQuizNote(randomQuizNote()); setResult('idle'); setAnswered(false); }}
              className="btn btn-primary metallic-shine flex-1 text-xs gap-2">
              <Shuffle className="w-3.5 h-3.5" /> Sonraki Nota
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LearningMode;
