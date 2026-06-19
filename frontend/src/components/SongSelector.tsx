import React, { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { Song } from '../context/AppContext';
import {
  Music, Upload, Eye, FileMusic, Trash2, Circle,
  RefreshCw, CheckCircle2, AlertCircle, Loader2, X
} from 'lucide-react';

interface Props { onShowEditor: (song: Song) => void; }

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export const SongSelector: React.FC<Props> = ({ onShowEditor }) => {
  const { songs, currentSong, setCurrentSong, uploadSheet, uploadYoutube, deleteSong, isLoading, fetchSongs } = useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag]       = useState(false);
  const [status, setStatus]   = useState<UploadStatus>('idle');
  const [statusMsg, setStatusMsg] = useState('');

  const doUpload = async (file: File) => {
    setStatus('uploading');
    setStatusMsg(`"${file.name}" işleniyor…`);
    try {
      const result = await uploadSheet(file);
      if (result) {
        setStatus('success');
        setStatusMsg(`✓ ${result.notes.length} nota okundu — "${result.title}"`);
      } else {
        setStatus('error');
        setStatusMsg('Nota okunamadı. Daha net bir görüntü deneyin.');
      }
    } catch (e) {
      setStatus('error');
      setStatusMsg('Yükleme sırasında bir hata oluştu.');
    }
    setTimeout(() => { setStatus('idle'); setStatusMsg(''); }, 4000);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) await doUpload(e.target.files[0]);
    e.target.value = '';
  };
  const onDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDrag(e.type === 'dragenter' || e.type === 'dragover');
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDrag(false);
    if (e.dataTransfer.files?.[0]) await doUpload(e.dataTransfer.files[0]);
  };
  const del = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Bu parçayı kaldırmak istiyor musunuz?')) deleteSong(id);
  };
  const isBuiltin = (s: Song) => s.id?.startsWith('builtin_');

  const dropBorder =
    drag       ? 'rgba(223,190,93,0.6)'  :
    status === 'uploading' ? 'rgba(96,165,250,0.5)' :
    status === 'success'   ? 'rgba(74,222,128,0.5)' :
    status === 'error'     ? 'rgba(248,113,113,0.5)' :
    'var(--border-hi)';

  const dropBg =
    drag       ? 'rgba(223,190,93,0.05)' :
    status === 'uploading' ? 'rgba(96,165,250,0.05)' :
    status === 'success'   ? 'rgba(74,222,128,0.05)' :
    status === 'error'     ? 'rgba(248,113,113,0.05)' :
    'transparent';

  return (
    <div className="glass p-3.5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <Music className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
        <span className="section-label">Parça Kütüphanesi</span>
        <span className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {songs.length}
        </span>
        <button onClick={fetchSongs}
          className="p-1 rounded-lg transition-colors"
          style={{ color: 'var(--text-dim)' }}
          title="Yenile">
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDragEnter={onDrag} onDragOver={onDrag} onDragLeave={onDrag} onDrop={onDrop}
        onClick={() => status === 'idle' && fileRef.current?.click()}
        style={{
          borderRadius: 10,
          border: `2px dashed ${dropBorder}`,
          background: dropBg,
          padding: '14px 10px',
          textAlign: 'center',
          cursor: status === 'uploading' ? 'wait' : 'pointer',
          transition: 'all 0.2s ease',
          transform: drag ? 'scale(1.015)' : 'scale(1)',
        }}
      >
        <input ref={fileRef} type="file"
          accept="image/*,audio/midi,.mid,.midi"
          onChange={onFile} className="hidden" />

        {/* Icon */}
        <div className="flex justify-center mb-2">
          {status === 'uploading' && <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#60a5fa' }} />}
          {status === 'success'   && <CheckCircle2 className="w-6 h-6" style={{ color: '#4ade80' }} />}
          {status === 'error'     && <AlertCircle className="w-6 h-6" style={{ color: '#f87171' }} />}
          {status === 'idle'      && <Upload className="w-6 h-6" style={{ color: drag ? 'var(--accent)' : 'var(--text-dim)' }} />}
        </div>

        <p className="text-[11px] font-semibold" style={{
          color: status === 'success' ? '#4ade80' :
                 status === 'error'   ? '#f87171' :
                 status === 'uploading' ? '#60a5fa' :
                 'var(--text-muted)'
        }}>
          {status === 'idle'
            ? (drag ? 'Bırakın!' : 'Nota, MIDI veya MusicXML yükleyin')
            : statusMsg}
        </p>

        {status === 'idle' && (
          <div>
            <p className="text-[9px] mt-1" style={{ color: 'var(--text-dim)' }}>
              JPG · PNG · .mid · .xml (MusicXML)
            </p>
            <p className="text-[8px] mt-0.5" style={{ color: 'var(--text-dim)', opacity: 0.7 }}>
              💡 MuseScore → Dosya → Dışa Aktar → Sıkıştırılmamış MusicXML (.xml)
            </p>
          </div>
        )}
      </div>

      {/* YouTube input */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Veya YouTube linki yapıştırın..."
          disabled={status !== 'idle'}
          className="flex-1 px-3 py-2 text-xs rounded-lg outline-none"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            opacity: status !== 'idle' ? 0.5 : 1
          }}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              const val = e.currentTarget.value.trim();
              if (val) {
                setStatus('uploading');
                setStatusMsg('YouTube\'dan ses indiriliyor ve işleniyor (1-2 dk)...');
                try {
                  const result = await uploadYoutube(val);
                  if (result) {
                    setStatus('success');
                    setStatusMsg(`✓ ${result.notes.length} nota okundu — "${result.title}"`);
                    e.currentTarget.value = ''; // clear input
                  } else {
                    setStatus('error');
                    setStatusMsg('Video işlenemedi veya müzik bulunamadı.');
                  }
                } catch (err) {
                  setStatus('error');
                  setStatusMsg('Yükleme sırasında bir hata oluştu.');
                }
                setTimeout(() => { setStatus('idle'); setStatusMsg(''); }, 5000);
              }
            }
          }}
        />
      </div>

      {/* Song list */}
      <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
        {songs.map(song => {
          const sid      = song.id || song._id || '';
          const selected = currentSong?.id === song.id || currentSong?._id === song._id;
          const isB      = isBuiltin(song);
          const noteCount = song.notes?.length ?? 0;

          return (
            <div
              key={sid}
              onClick={() => setCurrentSong(song)}
              className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
              style={{
                border: selected
                  ? '1px solid rgba(223,190,93,0.35)'
                  : '1px solid transparent',
                background: selected
                  ? 'rgba(223,190,93,0.07)'
                  : 'transparent',
              }}
              onMouseEnter={e => {
                if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)';
              }}
              onMouseLeave={e => {
                if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
              }}
            >
              {/* Icon */}
              <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: selected ? 'rgba(223,190,93,0.15)' : 'rgba(255,255,255,0.04)' }}>
                {isB
                  ? <Music     className="w-3.5 h-3.5" style={{ color: selected ? 'var(--accent)' : 'var(--text-muted)' }} />
                  : <FileMusic className="w-3.5 h-3.5" style={{ color: selected ? '#f472b6' : 'var(--text-muted)' }} />
                }
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate leading-none"
                  style={{ color: selected ? 'var(--accent)' : 'var(--text)' }}>
                  {song.title}
                </p>
                <p className="text-[9px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {song.composer}
                  {noteCount > 0 && (
                    <span className="ml-1.5 font-mono" style={{ color: 'var(--text-dim)' }}>
                      · {noteCount} nota
                    </span>
                  )}
                </p>
              </div>

              {/* Actions (hover) */}
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={e => { e.stopPropagation(); onShowEditor(song); }}
                  className="p-1 rounded-lg transition-colors"
                  style={{ color: 'var(--text-dim)' }}
                  title="Düzenle / Görüntüle"
                >
                  <Eye className="w-3 h-3" />
                </button>
                {!isB && (
                  <button
                    onClick={e => del(e, sid)}
                    className="p-1 rounded-lg transition-colors"
                    style={{ color: 'var(--text-dim)' }}
                    title="Sil"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Playing indicator */}
              {selected && (
                <Circle className="w-2 h-2 shrink-0 fill-current animate-pulse"
                  style={{ color: 'var(--accent)' }} />
              )}
            </div>
          );
        })}

        {songs.length === 0 && (
          <p className="text-center py-6 text-[11px]" style={{ color: 'var(--text-dim)' }}>
            Henüz parça yok
          </p>
        )}
      </div>
    </div>
  );
};
