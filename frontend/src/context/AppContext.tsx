import React, { createContext, useContext, useState, useEffect } from 'react';

export interface NoteInfo {
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
}

export interface Song {
  id?: string;
  _id?: string;
  title: string;
  composer?: string;
  notes: NoteInfo[];
  duration: number;
  file_path?: string;
  isExternal?: boolean; // Flag for loading notes from external file
}

export interface UserSettings {
  selected_piano_model: string;
  synth_type: string;
  synth_settings: any;
}

interface AppContextType {
  songs: Song[];
  currentSong: Song | null;
  setCurrentSong: (song: Song | null) => void;
  isLoading: boolean;
  userSettings: UserSettings;
  fetchSongs: () => Promise<void>;
  uploadSheet: (file: File) => Promise<Song | null>;
  uploadYoutube: (url: string) => Promise<Song | null>;
  updateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  addSong: (song: Song) => void;
  deleteSong: (songId: string) => void;
  transposeOffset: number;
  setTransposeOffset: (offset: number) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'; // FastAPI backend

// =========================================================
// CLIENT-SIDE MIDI PARSER (no backend needed for .mid files)
// =========================================================
async function parseMidiClientSide(file: File): Promise<NoteInfo[]> {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  let pos = 0;

  const readUint32 = () => {
    const v = view.getUint32(pos); pos += 4; return v;
  };
  const readUint16 = () => {
    const v = view.getUint16(pos); pos += 2; return v;
  };
  const readVarLen = () => {
    let val = 0;
    let b: number;
    do {
      b = bytes[pos++];
      val = (val << 7) | (b & 0x7f);
    } while (b & 0x80);
    return val;
  };

  // Header
  if (readUint32() !== 0x4d546864) throw new Error('Not a MIDI file');
  readUint32(); // header length (6)
  readUint16(); // format
  const numTracks = readUint16();
  const tpb = readUint16(); // ticks per beat

  const tracks: { tick: number; type: string; ch?: number; note?: number; vel?: number; tempo?: number }[][] = [];

  for (let t = 0; t < numTracks; t++) {
    if (readUint32() !== 0x4d54726b) { pos += view.getUint32(pos); pos += 4; continue; }
    const trackLen = readUint32();
    const trackEnd = pos + trackLen;
    const events: typeof tracks[0] = [];
    let absTick = 0;
    let runStatus = 0;

    while (pos < trackEnd) {
      const delta = readVarLen();
      absTick += delta;
      let statusByte = bytes[pos];

      if (statusByte & 0x80) { runStatus = statusByte; pos++; }
      else { statusByte = runStatus; }

      const type = statusByte & 0xf0;
      const ch   = statusByte & 0x0f;

      if (type === 0x90) {
        const note = bytes[pos++]; const vel = bytes[pos++];
        events.push({ tick: absTick, type: vel > 0 ? 'noteOn' : 'noteOff', ch, note, vel });
      } else if (type === 0x80) {
        const note = bytes[pos++]; pos++; // velocity ignored on noteOff
        events.push({ tick: absTick, type: 'noteOff', ch, note });
      } else if (type === 0xA0) { pos += 2; }
      else if (type === 0xB0) { pos += 2; }
      else if (type === 0xC0) { pos += 1; }
      else if (type === 0xD0) { pos += 1; }
      else if (type === 0xE0) { pos += 2; }
      else if (statusByte === 0xFF) {
        const metaType = bytes[pos++];
        const metaLen  = readVarLen();
        if (metaType === 0x51 && metaLen === 3) {
          const tempo = (bytes[pos] << 16) | (bytes[pos+1] << 8) | bytes[pos+2];
          events.push({ tick: absTick, type: 'tempo', tempo });
        }
        pos += metaLen;
      } else if (statusByte === 0xF0 || statusByte === 0xF7) {
        const sysLen = readVarLen(); pos += sysLen;
      } else { pos++; }
    }
    pos = trackEnd;
    tracks.push(events);
  }

  // Build tempo map (global, from all tracks)
  const tempoMap: { tick: number; tempo: number }[] = [{ tick: 0, tempo: 500000 }];
  for (const track of tracks) {
    for (const ev of track) {
      if (ev.type === 'tempo' && ev.tempo) {
        tempoMap.push({ tick: ev.tick, tempo: ev.tempo });
      }
    }
  }
  tempoMap.sort((a, b) => a.tick - b.tick);

  const ticksToSecs = (tick: number): number => {
    let secs = 0;
    let prevTick = 0;
    let prevTempo = 500000;
    for (const tm of tempoMap) {
      if (tm.tick >= tick) break;
      secs += ((Math.min(tick, tm.tick) - prevTick) / tpb) * (prevTempo / 1_000_000);
      prevTick = tm.tick; prevTempo = tm.tempo;
    }
    secs += ((tick - prevTick) / tpb) * (prevTempo / 1_000_000);
    return secs;
  };

  // Merge all tracks and extract notes
  const notes: NoteInfo[] = [];
  const pending: Record<string, { startTick: number; vel: number }> = {};

  for (const track of tracks) {
    for (const ev of track) {
      const key = `${ev.ch}_${ev.note}`;
      if (ev.type === 'noteOn' && ev.note !== undefined && ev.vel !== undefined) {
        pending[key] = { startTick: ev.tick, vel: ev.vel };
      } else if (ev.type === 'noteOff' && ev.note !== undefined && pending[key]) {
        const { startTick, vel } = pending[key];
        delete pending[key];
        const startSec = ticksToSecs(startTick);
        const endSec   = ticksToSecs(ev.tick);
        const dur = Math.max(0.05, endSec - startSec);
        if (ev.note >= 21 && ev.note <= 108) {
          notes.push({ pitch: ev.note, start_time: +startSec.toFixed(4), duration: +dur.toFixed(4), velocity: vel });
        }
      }
    }
  }

  notes.sort((a, b) => a.start_time - b.start_time);
  return notes;
}

// =========================================================
// CLIENT-SIDE MUSICXML PARSER (.xml / .mxl)
// Parses MuseScore, Sibelius, Finale exports accurately
// =========================================================

/** Convert MusicXML step/octave/alter to MIDI note number */
function xmlPitchToMidi(step: string, octave: number, alter: number): number {
  const steps: Record<string, number> = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  return (octave + 1) * 12 + (steps[step] ?? 0) + Math.round(alter);
}

/** Convert MusicXML duration divisions to seconds */
function divsToSecs(divs: number, divisionsPerQuarter: number, tempoQPM: number): number {
  return (divs / divisionsPerQuarter) * (60 / tempoQPM);
}

async function parseMusicXMLClientSide(file: File): Promise<NoteInfo[]> {
  let xmlText = '';

  // MXL = zipped MusicXML. Try to detect by reading first 4 bytes (PK = zip magic)
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip  = header[0] === 0x50 && header[1] === 0x4B;

  if (isZip) {
    // Use browser's DecompressionStream if available, otherwise fall back
    try {
      // Try dynamic import of JSZip-like approach via fetch of a public CDN
      // Since we can't use npm here, fall back to informing user
      throw new Error('MXL decompression not available client-side. Please use .xml (uncompressed MusicXML).');
    } catch {
      // If backend is available, let it handle .mxl
      throw new Error('MXL gereksinimi: Lütfen .xml (sıkıştırılmamış MusicXML) veya backend kullanın.');
    }
  }

  xmlText = await file.text();

  const parser = new DOMParser();
  const doc    = parser.parseFromString(xmlText, 'application/xml');

  // Check for parse error
  const parseErr = doc.querySelector('parseerror');
  if (parseErr) throw new Error(`XML ayrıştırma hatası: ${parseErr.textContent?.slice(0, 100)}`);

  const notes: NoteInfo[] = [];
  const parts = Array.from(doc.querySelectorAll('part'));

  // Global tempo (default 120 BPM)
  let tempoQPM = 120;
  const tempoEl = doc.querySelector('sound[tempo]');
  if (tempoEl) tempoQPM = parseFloat(tempoEl.getAttribute('tempo') ?? '120');

  for (const part of parts) {
    const measures = Array.from(part.querySelectorAll('measure'));
    let currentTimeSec = 0;
    let divisionsPerQ  = 1;

    // Tied notes: track start+pitch → accumulated duration
    const tiedNotes = new Map<number, { startSec: number; velocity: number; dur: number }>();

    for (const measure of measures) {
      // Check for tempo change
      const soundEl = measure.querySelector('sound[tempo]');
      if (soundEl) tempoQPM = parseFloat(soundEl.getAttribute('tempo') ?? `${tempoQPM}`);

      // Update divisions
      const divsEl = measure.querySelector('divisions');
      if (divsEl) divisionsPerQ = parseInt(divsEl.textContent ?? '1', 10) || 1;

      let measureTimeSec = currentTimeSec;
      // voice → { cursor: current time after last note, lastStart: start of last non-chord note }
      const voiceState: Record<string, { cursor: number; lastStart: number }> = {};

      const noteEls = Array.from(measure.querySelectorAll('note'));

      for (const noteEl of noteEls) {
        if (noteEl.querySelector('grace')) continue;

        const isChord    = !!noteEl.querySelector('chord');
        const isRest     = !!noteEl.querySelector('rest');
        const voice      = noteEl.querySelector('voice')?.textContent ?? '1';
        const durDivs    = parseInt(noteEl.querySelector('duration')?.textContent ?? '0', 10);
        const durSec     = divsToSecs(durDivs, divisionsPerQ, tempoQPM);
        const isTieStop  = !!noteEl.querySelector('tie[type="stop"]');
        const isTieStart = !!noteEl.querySelector('tie[type="start"]');

        // Initialise voice state
        if (!voiceState[voice]) voiceState[voice] = { cursor: measureTimeSec, lastStart: measureTimeSec };

        // Determine this note's start time
        // Chord element → share start with the previous non-chord note in same voice
        const startSec = isChord ? voiceState[voice].lastStart : voiceState[voice].cursor;

        // Advance cursor only for non-chord notes/rests
        if (!isChord) {
          voiceState[voice].lastStart = voiceState[voice].cursor; // save before advancing
          voiceState[voice].cursor   += durSec;
        }

        if (isRest) continue;

        const pitchEl = noteEl.querySelector('pitch');
        if (!pitchEl) continue;

        const step   = pitchEl.querySelector('step')?.textContent?.trim() ?? 'C';
        const octave = parseInt(pitchEl.querySelector('octave')?.textContent ?? '4', 10);
        const alter  = parseFloat(pitchEl.querySelector('alter')?.textContent ?? '0') || 0;
        const midi   = xmlPitchToMidi(step, octave, alter);

        if (midi < 21 || midi > 108) continue;

        // Velocity: check <dynamics> element within the measure
        let velocity = 80;
        const dynEl = measure.querySelector('dynamics');
        if (dynEl) {
          const tag = dynEl.firstElementChild?.tagName?.toLowerCase() ?? '';
          const dynMap: Record<string, number> = {
            pppp:15, ppp:25, pp:40, p:55, mp:68, mf:82, f:96, ff:110, fff:120, ffff:127
          };
          if (dynMap[tag]) velocity = dynMap[tag];
        }

        // Handle ties
        if (isTieStop && tiedNotes.has(midi)) {
          const tied = tiedNotes.get(midi)!;
          tied.dur += durSec;
          if (!isTieStart) {
            notes.push({
              pitch: midi,
              start_time: +tied.startSec.toFixed(4),
              duration:   +Math.max(0.05, tied.dur).toFixed(4),
              velocity:   tied.velocity,
            });
            tiedNotes.delete(midi);
          }
          continue;
        }

        if (isTieStart) {
          tiedNotes.set(midi, { startSec: startSec, velocity, dur: durSec });
          continue;
        }

        notes.push({
          pitch:      midi,
          start_time: +Math.max(0, startSec).toFixed(4),
          duration:   +Math.max(0.05, durSec).toFixed(4),
          velocity,
        });
      }

      // Advance measure time by the longest voice cursor
      const cursors = Object.values(voiceState).map(s => s.cursor);
      currentTimeSec = cursors.length > 0 ? Math.max(...cursors) : currentTimeSec;
    }

    // Flush any remaining tied notes
    for (const [midi, tied] of tiedNotes) {
      notes.push({
        pitch: midi,
        start_time: +tied.startSec.toFixed(4),
        duration: +Math.max(0.05, tied.dur).toFixed(4),
        velocity: tied.velocity,
      });
    }
  }

  notes.sort((a, b) => a.start_time - b.start_time);
  console.log(`MusicXML: ${notes.length} nota okundu`);
  return notes;
}


// =========================================================
// BUILT-IN DEMO SONGS
// =========================================================
const BUILTIN_SONGS: Song[] = [
  {
    id: 'builtin_1',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven',
    notes: [
      { pitch: 76, start_time: 0.0,  duration: 0.2, velocity: 80 },
      { pitch: 75, start_time: 0.25, duration: 0.2, velocity: 75 },
      { pitch: 76, start_time: 0.5,  duration: 0.2, velocity: 80 },
      { pitch: 75, start_time: 0.75, duration: 0.2, velocity: 75 },
      { pitch: 76, start_time: 1.0,  duration: 0.2, velocity: 80 },
      { pitch: 71, start_time: 1.25, duration: 0.2, velocity: 75 },
      { pitch: 74, start_time: 1.5,  duration: 0.2, velocity: 78 },
      { pitch: 72, start_time: 1.75, duration: 0.2, velocity: 75 },
      { pitch: 69, start_time: 2.0,  duration: 0.6, velocity: 85 },
      { pitch: 60, start_time: 2.75, duration: 0.2, velocity: 65 },
      { pitch: 64, start_time: 3.0,  duration: 0.2, velocity: 68 },
      { pitch: 69, start_time: 3.25, duration: 0.5, velocity: 78 },
      { pitch: 71, start_time: 3.75, duration: 0.5, velocity: 75 },
      { pitch: 64, start_time: 4.25, duration: 0.2, velocity: 70 },
      { pitch: 68, start_time: 4.5,  duration: 0.2, velocity: 72 },
      { pitch: 71, start_time: 4.75, duration: 0.5, velocity: 78 },
    ],
    duration: 5.5,
  },
  {
    id: 'builtin_2',
    title: 'Turkish March',
    composer: 'Wolfgang Amadeus Mozart',
    notes: [
      { pitch: 69, start_time: 0.0,  duration: 0.15, velocity: 85 },
      { pitch: 68, start_time: 0.2,  duration: 0.15, velocity: 82 },
      { pitch: 69, start_time: 0.4,  duration: 0.15, velocity: 85 },
      { pitch: 71, start_time: 0.6,  duration: 0.3,  velocity: 90 },
      { pitch: 71, start_time: 1.0,  duration: 0.15, velocity: 80 },
      { pitch: 72, start_time: 1.2,  duration: 0.15, velocity: 78 },
      { pitch: 71, start_time: 1.4,  duration: 0.15, velocity: 80 },
      { pitch: 69, start_time: 1.6,  duration: 0.3,  velocity: 88 },
      { pitch: 67, start_time: 2.0,  duration: 0.15, velocity: 75 },
      { pitch: 65, start_time: 2.2,  duration: 0.15, velocity: 72 },
      { pitch: 64, start_time: 2.4,  duration: 0.15, velocity: 75 },
      { pitch: 65, start_time: 2.6,  duration: 0.35, velocity: 85 },
    ],
    duration: 3.2,
  },
  {
    id: 'builtin_3',
    title: 'Moonlight Sonata',
    composer: 'Ludwig van Beethoven',
    notes: [
      // Triplet arpeggio pattern (simplified)
      { pitch: 44, start_time: 0.0,  duration: 0.9, velocity: 55 },
      { pitch: 48, start_time: 0.0,  duration: 0.9, velocity: 55 },
      { pitch: 52, start_time: 0.0,  duration: 0.25, velocity: 60 },
      { pitch: 56, start_time: 0.33, duration: 0.25, velocity: 58 },
      { pitch: 60, start_time: 0.66, duration: 0.25, velocity: 62 },
      { pitch: 44, start_time: 1.0,  duration: 0.9, velocity: 55 },
      { pitch: 48, start_time: 1.0,  duration: 0.9, velocity: 55 },
      { pitch: 52, start_time: 1.0,  duration: 0.25, velocity: 60 },
      { pitch: 56, start_time: 1.33, duration: 0.25, velocity: 58 },
      { pitch: 60, start_time: 1.66, duration: 0.25, velocity: 62 },
      { pitch: 63, start_time: 2.0,  duration: 1.8,  velocity: 72 },
      { pitch: 44, start_time: 2.0,  duration: 0.9, velocity: 55 },
      { pitch: 48, start_time: 2.0,  duration: 0.9, velocity: 55 },
      { pitch: 52, start_time: 2.0,  duration: 0.25, velocity: 60 },
      { pitch: 56, start_time: 2.33, duration: 0.25, velocity: 58 },
      { pitch: 60, start_time: 2.66, duration: 0.25, velocity: 62 },
      { pitch: 43, start_time: 3.0,  duration: 0.9, velocity: 55 },
      { pitch: 47, start_time: 3.0,  duration: 0.9, velocity: 55 },
      { pitch: 50, start_time: 3.0,  duration: 0.25, velocity: 60 },
      { pitch: 55, start_time: 3.33, duration: 0.25, velocity: 58 },
      { pitch: 59, start_time: 3.66, duration: 0.25, velocity: 62 },
    ],
    duration: 4.5,
  },
  {
    id: 'builtin_4',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven',
    notes: [
      { pitch: 64, start_time: 0.0,  duration: 0.45, velocity: 80 },
      { pitch: 64, start_time: 0.5,  duration: 0.45, velocity: 80 },
      { pitch: 65, start_time: 1.0,  duration: 0.45, velocity: 82 },
      { pitch: 67, start_time: 1.5,  duration: 0.45, velocity: 85 },
      { pitch: 67, start_time: 2.0,  duration: 0.45, velocity: 85 },
      { pitch: 65, start_time: 2.5,  duration: 0.45, velocity: 82 },
      { pitch: 64, start_time: 3.0,  duration: 0.45, velocity: 80 },
      { pitch: 62, start_time: 3.5,  duration: 0.45, velocity: 78 },
      { pitch: 60, start_time: 4.0,  duration: 0.45, velocity: 78 },
      { pitch: 60, start_time: 4.5,  duration: 0.45, velocity: 78 },
      { pitch: 62, start_time: 5.0,  duration: 0.45, velocity: 80 },
      { pitch: 64, start_time: 5.5,  duration: 0.45, velocity: 82 },
      { pitch: 64, start_time: 6.0,  duration: 0.65, velocity: 88 },
      { pitch: 62, start_time: 6.75, duration: 0.2,  velocity: 75 },
      { pitch: 62, start_time: 7.0,  duration: 0.9,  velocity: 85 },
    ],
    duration: 8.2,
  },
  {
    id: 'builtin_5',
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    notes: [
      { pitch: 74, start_time: 0.0,  duration: 0.45, velocity: 75 },
      { pitch: 69, start_time: 0.5,  duration: 0.45, velocity: 72 },
      { pitch: 71, start_time: 1.0,  duration: 0.45, velocity: 75 },
      { pitch: 66, start_time: 1.5,  duration: 0.45, velocity: 72 },
      { pitch: 67, start_time: 2.0,  duration: 0.45, velocity: 75 },
      { pitch: 64, start_time: 2.5,  duration: 0.45, velocity: 72 },
      { pitch: 67, start_time: 3.0,  duration: 0.45, velocity: 75 },
      { pitch: 69, start_time: 3.5,  duration: 0.45, velocity: 78 },
      { pitch: 74, start_time: 4.0,  duration: 0.2,  velocity: 78 },
      { pitch: 71, start_time: 4.25, duration: 0.2,  velocity: 75 },
      { pitch: 69, start_time: 4.5,  duration: 0.2,  velocity: 72 },
      { pitch: 71, start_time: 4.75, duration: 0.2,  velocity: 75 },
      { pitch: 72, start_time: 5.0,  duration: 0.45, velocity: 80 },
      { pitch: 69, start_time: 5.5,  duration: 0.2,  velocity: 75 },
      { pitch: 67, start_time: 5.75, duration: 0.2,  velocity: 72 },
      { pitch: 69, start_time: 6.0,  duration: 0.45, velocity: 78 },
      { pitch: 71, start_time: 6.5,  duration: 0.45, velocity: 75 },
      { pitch: 67, start_time: 7.0,  duration: 0.45, velocity: 72 },
      { pitch: 69, start_time: 7.5,  duration: 0.9,  velocity: 82 },
    ],
    duration: 9.0,
  },
  {
    id: 'builtin_6',
    title: 'Twinkle Twinkle',
    composer: 'Traditional',
    notes: [
      { pitch: 60, start_time: 0.0,  duration: 0.45, velocity: 80 },
      { pitch: 60, start_time: 0.5,  duration: 0.45, velocity: 80 },
      { pitch: 67, start_time: 1.0,  duration: 0.45, velocity: 82 },
      { pitch: 67, start_time: 1.5,  duration: 0.45, velocity: 82 },
      { pitch: 69, start_time: 2.0,  duration: 0.45, velocity: 85 },
      { pitch: 69, start_time: 2.5,  duration: 0.45, velocity: 85 },
      { pitch: 67, start_time: 3.0,  duration: 0.9,  velocity: 88 },
      { pitch: 65, start_time: 4.0,  duration: 0.45, velocity: 80 },
      { pitch: 65, start_time: 4.5,  duration: 0.45, velocity: 80 },
      { pitch: 64, start_time: 5.0,  duration: 0.45, velocity: 78 },
      { pitch: 64, start_time: 5.5,  duration: 0.45, velocity: 78 },
      { pitch: 62, start_time: 6.0,  duration: 0.45, velocity: 80 },
      { pitch: 62, start_time: 6.5,  duration: 0.45, velocity: 80 },
      { pitch: 60, start_time: 7.0,  duration: 0.9,  velocity: 88 },
    ],
    duration: 8.2,
  },
  {
    id: 'builtin_7',
    title: 'Minuet in G Major',
    composer: 'Johann Sebastian Bach',
    notes: [
      { pitch: 74, start_time: 0.0,  duration: 0.4, velocity: 85 }, // D5
      { pitch: 67, start_time: 0.5,  duration: 0.2, velocity: 78 }, // G4
      { pitch: 69, start_time: 0.75, duration: 0.2, velocity: 80 }, // A4
      { pitch: 71, start_time: 1.0,  duration: 0.2, velocity: 82 }, // B4
      { pitch: 72, start_time: 1.25, duration: 0.2, velocity: 84 }, // C5
      { pitch: 74, start_time: 1.5,  duration: 0.4, velocity: 85 }, // D5
      { pitch: 67, start_time: 2.0,  duration: 0.4, velocity: 78 }, // G4
      { pitch: 67, start_time: 2.5,  duration: 0.4, velocity: 78 }, // G4
      
      { pitch: 76, start_time: 3.0,  duration: 0.4, velocity: 85 }, // E5
      { pitch: 72, start_time: 3.5,  duration: 0.2, velocity: 78 }, // C5
      { pitch: 74, start_time: 3.75, duration: 0.2, velocity: 80 }, // D5
      { pitch: 76, start_time: 4.0,  duration: 0.2, velocity: 82 }, // E5
      { pitch: 78, start_time: 4.25, duration: 0.2, velocity: 84 }, // F#5
      { pitch: 79, start_time: 4.5,  duration: 0.4, velocity: 85 }, // G5
      { pitch: 67, start_time: 5.0,  duration: 0.4, velocity: 78 }, // G4
      { pitch: 67, start_time: 5.5,  duration: 0.4, velocity: 78 }, // G4
    ],
    duration: 6.2,
  },
  {
    id: 'builtin_8',
    title: 'Prelude in E Minor',
    composer: 'Frédéric Chopin',
    notes: [
      { pitch: 71, start_time: 0.0,  duration: 1.4, velocity: 60 }, // B4
      { pitch: 52, start_time: 0.0,  duration: 0.45, velocity: 45 }, // E3 bass
      { pitch: 55, start_time: 0.0,  duration: 0.45, velocity: 45 }, // G3
      { pitch: 59, start_time: 0.0,  duration: 0.45, velocity: 45 }, // B3
      
      { pitch: 52, start_time: 0.5,  duration: 0.45, velocity: 43 },
      { pitch: 55, start_time: 0.5,  duration: 0.45, velocity: 43 },
      { pitch: 59, start_time: 0.5,  duration: 0.45, velocity: 43 },
      
      { pitch: 52, start_time: 1.0,  duration: 0.45, velocity: 45 },
      { pitch: 55, start_time: 1.0,  duration: 0.45, velocity: 45 },
      { pitch: 59, start_time: 1.0,  duration: 0.45, velocity: 45 },
      
      { pitch: 72, start_time: 1.5,  duration: 0.4, velocity: 68 }, // C5
      { pitch: 71, start_time: 2.0,  duration: 1.4, velocity: 58 }, // B4
      
      { pitch: 51, start_time: 2.0,  duration: 0.45, velocity: 43 }, // D#3
      { pitch: 55, start_time: 2.0,  duration: 0.45, velocity: 43 }, 
      { pitch: 57, start_time: 2.0,  duration: 0.45, velocity: 43 }, // A3
      
      { pitch: 51, start_time: 2.5,  duration: 0.45, velocity: 40 },
      { pitch: 55, start_time: 2.5,  duration: 0.45, velocity: 40 },
      { pitch: 57, start_time: 2.5,  duration: 0.45, velocity: 40 },
      
      { pitch: 70, start_time: 3.5,  duration: 0.4, velocity: 55 }, // Bb4
      { pitch: 69, start_time: 4.0,  duration: 1.9, velocity: 52 }, // A4
      
      { pitch: 50, start_time: 4.0,  duration: 0.9, velocity: 42 }, // D3
      { pitch: 53, start_time: 4.0,  duration: 0.9, velocity: 42 }, // F3
      { pitch: 57, start_time: 4.0,  duration: 0.9, velocity: 42 }, 
    ],
    duration: 6.2,
  },
  {
    id: 'builtin_9',
    title: 'Clair de Lune',
    composer: 'Claude Debussy',
    notes: [
      { pitch: 65, start_time: 0.0,  duration: 0.9, velocity: 50 }, // F4
      { pitch: 68, start_time: 0.0,  duration: 0.9, velocity: 50 }, // Ab4
      { pitch: 72, start_time: 0.0,  duration: 0.9, velocity: 52 }, // C5
      
      { pitch: 77, start_time: 1.0,  duration: 0.9, velocity: 52 }, // F5
      { pitch: 80, start_time: 1.0,  duration: 0.9, velocity: 52 }, // Ab5
      
      { pitch: 85, start_time: 2.0,  duration: 1.8, velocity: 58 }, // Db6
      { pitch: 56, start_time: 2.0,  duration: 0.9, velocity: 45 }, // Ab3
      { pitch: 60, start_time: 2.0,  duration: 0.9, velocity: 45 }, // C4
      
      { pitch: 84, start_time: 4.0,  duration: 0.45, velocity: 55 }, // C6
      { pitch: 80, start_time: 4.5,  duration: 0.45, velocity: 52 }, // Ab5
      { pitch: 77, start_time: 5.0,  duration: 0.9,  velocity: 50 }, // F5
      { pitch: 53, start_time: 5.0,  duration: 0.9,  velocity: 42 }, // F3
      { pitch: 57, start_time: 5.0,  duration: 0.9,  velocity: 42 }, // A3
    ],
    duration: 6.2,
  }
];

// Extra built-in songs
const EXTRA_SONGS: Song[] = [
  {
    id: 'builtin_10',
    title: 'Nocturne Op.9 No.2',
    composer: 'Frédéric Chopin',
    notes: [
      { pitch: 71, start_time: 0.0,  duration: 1.8, velocity: 52 },
      { pitch: 47, start_time: 0.0,  duration: 0.55, velocity: 42 },
      { pitch: 54, start_time: 0.0,  duration: 0.55, velocity: 42 },
      { pitch: 59, start_time: 0.0,  duration: 0.55, velocity: 42 },
      { pitch: 47, start_time: 0.6,  duration: 0.55, velocity: 40 },
      { pitch: 54, start_time: 0.6,  duration: 0.55, velocity: 40 },
      { pitch: 59, start_time: 0.6,  duration: 0.55, velocity: 40 },
      { pitch: 47, start_time: 1.2,  duration: 0.55, velocity: 42 },
      { pitch: 54, start_time: 1.2,  duration: 0.55, velocity: 42 },
      { pitch: 59, start_time: 1.2,  duration: 0.55, velocity: 42 },
      { pitch: 72, start_time: 1.8,  duration: 0.4, velocity: 58 },
      { pitch: 71, start_time: 2.4,  duration: 1.8, velocity: 50 },
      { pitch: 45, start_time: 2.4,  duration: 0.55, velocity: 40 },
      { pitch: 52, start_time: 2.4,  duration: 0.55, velocity: 40 },
      { pitch: 57, start_time: 2.4,  duration: 0.55, velocity: 40 },
      { pitch: 45, start_time: 3.0,  duration: 0.55, velocity: 38 },
      { pitch: 52, start_time: 3.0,  duration: 0.55, velocity: 38 },
      { pitch: 57, start_time: 3.0,  duration: 0.55, velocity: 38 },
      { pitch: 74, start_time: 4.5,  duration: 0.3, velocity: 60 },
      { pitch: 73, start_time: 4.9,  duration: 0.3, velocity: 58 },
      { pitch: 71, start_time: 5.3,  duration: 2.0, velocity: 55 },
    ],
    duration: 7.5,
  },
  {
    id: 'builtin_11',
    title: 'Moonsonata Adagio (Tam)',
    composer: 'Ludwig van Beethoven',
    notes: [
      // Bar 1
      { pitch: 44, start_time: 0.0,  duration: 0.9, velocity: 50 },
      { pitch: 48, start_time: 0.0,  duration: 0.9, velocity: 50 },
      { pitch: 52, start_time: 0.0,  duration: 0.28, velocity: 55 },
      { pitch: 56, start_time: 0.32, duration: 0.28, velocity: 53 },
      { pitch: 60, start_time: 0.64, duration: 0.28, velocity: 57 },
      // Bar 2
      { pitch: 44, start_time: 1.0,  duration: 0.9, velocity: 50 },
      { pitch: 48, start_time: 1.0,  duration: 0.9, velocity: 50 },
      { pitch: 52, start_time: 1.0,  duration: 0.28, velocity: 55 },
      { pitch: 56, start_time: 1.32, duration: 0.28, velocity: 53 },
      { pitch: 60, start_time: 1.64, duration: 0.28, velocity: 57 },
      // Bar 3 (melody)
      { pitch: 63, start_time: 2.0,  duration: 1.8, velocity: 68 },
      { pitch: 44, start_time: 2.0,  duration: 0.9, velocity: 48 },
      { pitch: 48, start_time: 2.0,  duration: 0.9, velocity: 48 },
      { pitch: 52, start_time: 2.0,  duration: 0.28, velocity: 53 },
      { pitch: 56, start_time: 2.32, duration: 0.28, velocity: 51 },
      { pitch: 60, start_time: 2.64, duration: 0.28, velocity: 55 },
      // Bar 4
      { pitch: 43, start_time: 4.0,  duration: 0.9, velocity: 50 },
      { pitch: 47, start_time: 4.0,  duration: 0.9, velocity: 50 },
      { pitch: 50, start_time: 4.0,  duration: 0.28, velocity: 53 },
      { pitch: 55, start_time: 4.32, duration: 0.28, velocity: 51 },
      { pitch: 59, start_time: 4.64, duration: 0.28, velocity: 55 },
      // Bar 5
      { pitch: 43, start_time: 5.0,  duration: 0.9, velocity: 50 },
      { pitch: 47, start_time: 5.0,  duration: 0.9, velocity: 50 },
      { pitch: 50, start_time: 5.0,  duration: 0.28, velocity: 52 },
      { pitch: 55, start_time: 5.32, duration: 0.28, velocity: 50 },
      { pitch: 59, start_time: 5.64, duration: 0.28, velocity: 54 },
      { pitch: 63, start_time: 6.5,  duration: 1.4, velocity: 72 },
    ],
    duration: 8.0,
  },
  {
    id: 'builtin_12',
    title: 'Jesu, Joy of Man\'s Desiring',
    composer: 'Johann Sebastian Bach',
    notes: [
      { pitch: 74, start_time: 0.0,  duration: 0.3, velocity: 78 },
      { pitch: 76, start_time: 0.33, duration: 0.3, velocity: 75 },
      { pitch: 77, start_time: 0.66, duration: 0.3, velocity: 76 },
      { pitch: 76, start_time: 1.0,  duration: 0.3, velocity: 74 },
      { pitch: 74, start_time: 1.33, duration: 0.3, velocity: 76 },
      { pitch: 71, start_time: 1.66, duration: 0.3, velocity: 72 },
      { pitch: 74, start_time: 2.0,  duration: 0.3, velocity: 78 },
      { pitch: 76, start_time: 2.33, duration: 0.3, velocity: 75 },
      { pitch: 74, start_time: 2.66, duration: 0.3, velocity: 76 },
      { pitch: 71, start_time: 3.0,  duration: 0.6, velocity: 80 },
      { pitch: 69, start_time: 3.66, duration: 0.3, velocity: 72 },
      { pitch: 71, start_time: 4.0,  duration: 0.3, velocity: 74 },
      { pitch: 72, start_time: 4.33, duration: 0.3, velocity: 76 },
      { pitch: 74, start_time: 4.66, duration: 0.3, velocity: 78 },
      { pitch: 76, start_time: 5.0,  duration: 0.3, velocity: 80 },
      { pitch: 77, start_time: 5.33, duration: 0.3, velocity: 78 },
      { pitch: 79, start_time: 5.66, duration: 0.3, velocity: 80 },
      { pitch: 81, start_time: 6.0,  duration: 0.6, velocity: 85 },
    ],
    duration: 7.0,
  },
  {
    id: 'builtin_13',
    title: 'Toza Döndüm - Tam Piyano Düzenlemesi',
    composer: 'Nuray Hafiftaş',
    notes: [
      // Measure 1 - Right hand (quarter notes at 75 BPM = 0.8s each)
      { pitch: 76, start_time: 0.0,  duration: 0.8, velocity: 80 }, // E5
      { pitch: 74, start_time: 0.8,  duration: 0.8, velocity: 78 }, // D5
      { pitch: 72, start_time: 1.6,  duration: 0.8, velocity: 76 }, // C5
      { pitch: 71, start_time: 2.4,  duration: 0.8, velocity: 75 }, // B4
      // Measure 1 - Left hand (eighth notes = 0.4s each)
      { pitch: 45, start_time: 0.0,  duration: 0.4, velocity: 65 }, // A2
      { pitch: 52, start_time: 0.4,  duration: 0.4, velocity: 65 }, // E3
      { pitch: 57, start_time: 0.4,  duration: 0.4, velocity: 65 }, // A3
      { pitch: 52, start_time: 0.8,  duration: 0.4, velocity: 65 }, // E3
      { pitch: 48, start_time: 0.8,  duration: 0.4, velocity: 65 }, // C3
      { pitch: 52, start_time: 1.2,  duration: 0.4, velocity: 65 }, // E3
      { pitch: 57, start_time: 1.2,  duration: 0.4, velocity: 65 }, // A3
      { pitch: 52, start_time: 1.6,  duration: 0.4, velocity: 65 }, // E3
      // Measure 2 - Right hand
      { pitch: 77, start_time: 3.2,  duration: 0.8, velocity: 80 }, // F5
      { pitch: 76, start_time: 4.0,  duration: 0.8, velocity: 78 }, // E5
      { pitch: 74, start_time: 4.8,  duration: 0.8, velocity: 76 }, // D5
      { pitch: 72, start_time: 5.6,  duration: 0.8, velocity: 75 }, // C5
      // Measure 2 - Left hand
      { pitch: 50, start_time: 3.2,  duration: 0.4, velocity: 65 }, // D3
      { pitch: 57, start_time: 3.6,  duration: 0.4, velocity: 65 }, // A3
      { pitch: 62, start_time: 3.6,  duration: 0.4, velocity: 65 }, // D4
      { pitch: 57, start_time: 4.0,  duration: 0.4, velocity: 65 }, // A3
      { pitch: 53, start_time: 4.4,  duration: 0.4, velocity: 65 }, // F3
      { pitch: 57, start_time: 4.8,  duration: 0.4, velocity: 65 }, // A3
      { pitch: 62, start_time: 4.8,  duration: 0.4, velocity: 65 }, // D4
      { pitch: 57, start_time: 5.2,  duration: 0.4, velocity: 65 }, // A3
      // Measure 3 - Right hand (Verse)
      { pitch: 69, start_time: 6.4,  duration: 0.8, velocity: 78 }, // A4
      { pitch: 71, start_time: 7.2,  duration: 0.8, velocity: 76 }, // B4
      { pitch: 72, start_time: 8.0,  duration: 0.8, velocity: 75 }, // C5
      { pitch: 72, start_time: 8.8,  duration: 0.8, velocity: 75 }, // C5
      // Measure 3 - Left hand
      { pitch: 45, start_time: 6.4,  duration: 0.4, velocity: 65 }, // A2
      { pitch: 52, start_time: 6.8,  duration: 0.4, velocity: 65 }, // E3
      { pitch: 57, start_time: 6.8,  duration: 0.4, velocity: 65 }, // A3
      { pitch: 52, start_time: 7.2,  duration: 0.4, velocity: 65 }, // E3
      { pitch: 48, start_time: 7.2,  duration: 0.4, velocity: 65 }, // C3
      { pitch: 52, start_time: 7.6,  duration: 0.4, velocity: 65 }, // E3
      { pitch: 57, start_time: 7.6,  duration: 0.4, velocity: 65 }, // A3
      { pitch: 52, start_time: 8.0,  duration: 0.4, velocity: 65 }, // E3
      // Measure 4 - Right hand
      { pitch: 71, start_time: 9.6,  duration: 0.8, velocity: 76 }, // B4
      { pitch: 72, start_time: 10.4, duration: 0.8, velocity: 75 }, // C5
      { pitch: 74, start_time: 11.2, duration: 1.6, velocity: 78 }, // D5
      // Measure 4 - Left hand
      { pitch: 50, start_time: 9.6,  duration: 0.4, velocity: 65 }, // D3
      { pitch: 57, start_time: 10.0, duration: 0.4, velocity: 65 }, // A3
      { pitch: 62, start_time: 10.0, duration: 0.4, velocity: 65 }, // D4
      { pitch: 57, start_time: 10.4, duration: 0.4, velocity: 65 }, // A3
      { pitch: 53, start_time: 10.8, duration: 0.4, velocity: 65 }, // F3
      { pitch: 57, start_time: 11.2, duration: 0.4, velocity: 65 }, // A3
      { pitch: 62, start_time: 11.2, duration: 0.4, velocity: 65 }, // D4
      { pitch: 57, start_time: 11.6, duration: 0.4, velocity: 65 }, // A3
      // Measure 5 - Right hand (Chorus transition E7)
      { pitch: 71, start_time: 12.8, duration: 0.8, velocity: 76 }, // B4
      { pitch: 72, start_time: 13.6, duration: 0.8, velocity: 75 }, // C5
    ],
    duration: 14.5,
  },
  {
    id: 'builtin_14',
    title: 'Toza Döndüm - Tam Piyano',
    composer: 'Nuray Hafiftaş',
    notes: [], // Will be loaded dynamically
    duration: 688.25,
    file_path: '/uploads/nuray_notes.json',
    isExternal: true, // Flag to load notes from file
  },
];

const ALL_BUILTIN_SONGS = [...BUILTIN_SONGS, ...EXTRA_SONGS];

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [transposeOffset, setTransposeOffset] = useState<number>(0);

  // Custom setCurrentSong that loads external notes
  const handleSetCurrentSong = async (song: Song | null) => {
    if (song && song.isExternal && song.file_path && song.notes.length === 0) {
      try {
        setIsLoading(true);
        const response = await fetch(song.file_path);
        if (response.ok) {
          const data = await response.json();
          const songWithNotes = { ...song, notes: data.notes };
          setCurrentSong(songWithNotes);
          // Update the song in the songs array as well
          setSongs(prev => prev.map(s => s.id === song.id ? songWithNotes : s));
        } else {
          console.error('Failed to load external notes');
          setCurrentSong(song);
        }
      } catch (error) {
        console.error('Error loading external notes:', error);
        setCurrentSong(song);
      } finally {
        setIsLoading(false);
      }
    } else {
      setCurrentSong(song);
    }
  };
  const [userSettings, setUserSettings] = useState<UserSettings>({
    selected_piano_model: 'Yamaha P-225',
    synth_type: 'lead',
    synth_settings: {},
  });

  const fetchSongs = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/mongo/songs`);
      if (response.ok) {
        const data = await response.json();
        const merged = [...ALL_BUILTIN_SONGS, ...data];
        setSongs(merged);
        if (!currentSong) handleSetCurrentSong(ALL_BUILTIN_SONGS[0]);
      } else {
        throw new Error('fetch failed');
      }
    } catch (_err) {
      // Backend offline — use built-in songs only
      setSongs(ALL_BUILTIN_SONGS);
      if (!currentSong) handleSetCurrentSong(ALL_BUILTIN_SONGS[0]);
    } finally {
      setIsLoading(false);
    }
  };

  const uploadSheet = async (file: File): Promise<Song | null> => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/api/v1/upload/sheet`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        const newSong = result.song as Song;
        // Ensure notes sorted by start_time and duration calculated
        newSong.notes = (newSong.notes ?? []).sort((a, b) => a.start_time - b.start_time);
        newSong.duration = newSong.notes.reduce((m, n) => Math.max(m, n.start_time + n.duration), 0) + 0.5;
        setSongs((prev) => [newSong, ...prev]);
        setCurrentSong(newSong);
        return newSong;
      } else {
        const err = await response.json().catch(() => ({ detail: 'Bilinmeyen hata' }));
        console.error('Upload error:', err.detail);
        return null;
      }
    } catch (_err) {
      const name = file.name.toLowerCase();
      const isMidi = name.endsWith('.mid') || name.endsWith('.midi');
      const isXML  = name.endsWith('.xml') || name.endsWith('.musicxml');
      const isMXL  = name.endsWith('.mxl');

      // ── MusicXML (.xml) — works fully client-side ──
      if (isXML) {
        try {
          const notes = await parseMusicXMLClientSide(file);
          if (notes.length > 0) {
            const duration = notes.reduce((m, n) => Math.max(m, n.start_time + n.duration), 0) + 0.5;
            const newSong: Song = {
              id: `xml_${Date.now()}`,
              title: file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim(),
              composer: 'MusicXML İçe Aktarma',
              notes,
              duration,
            };
            setSongs((prev) => [newSong, ...prev]);
            setCurrentSong(newSong);
            return newSong;
          }
        } catch (xmlErr: any) {
          console.error('MusicXML parse error:', xmlErr?.message ?? xmlErr);
        }
        return null;
      }

      // ── Compressed MXL — needs backend ──
      if (isMXL) {
        console.warn('MXL dosyası backend gerektiriyor. Backend çalışmıyor. Lütfen MuseScore\'da "Uncompressed MusicXML (.xml)" olarak dışa aktarın.');
        return null;
      }

      // ── MIDI — works client-side ──
      if (isMidi) {
        try {
          const notes = await parseMidiClientSide(file);
          if (notes.length > 0) {
            const duration = notes.reduce((m, n) => Math.max(m, n.start_time + n.duration), 0) + 0.5;
            const newSong: Song = {
              id: `midi_${Date.now()}`,
              title: file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim(),
              composer: 'MIDI Dosyası',
              notes,
              duration,
            };
            setSongs((prev) => [newSong, ...prev]);
            handleSetCurrentSong(newSong);
            return newSong;
          }
        } catch (midiErr) {
          console.error('Client MIDI parse error:', midiErr);
        }
        return null;
      }

      // ── Image OMR — needs backend ──
      console.warn('Backend offline. Görüntü OMR için backend çalıştırılmalı.');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const uploadYoutube = async (url: string): Promise<Song | null> => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/upload/youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (response.ok) {
        const result = await response.json();
        const newSong = result.song as Song;
        newSong.notes = (newSong.notes ?? []).sort((a, b) => a.start_time - b.start_time);
        newSong.duration = newSong.notes.reduce((m, n) => Math.max(m, n.start_time + n.duration), 0) + 0.5;
        setSongs((prev) => [newSong, ...prev]);
        setCurrentSong(newSong);
        return newSong;
      } else {
        const err = await response.json().catch(() => ({ detail: 'Bilinmeyen hata' }));
        console.error('YouTube upload error:', err.detail);
        return null;
      }
    } catch (error) {
      console.error('YouTube request failed', error);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const addSong = async (song: Song) => {
    setSongs((prev) => [song, ...prev]);
    handleSetCurrentSong(song);
  };

  const deleteSong = (songId: string) => {
    setSongs((prev) => {
      const next = prev.filter((s) => (s.id || s._id) !== songId);
      return next;
    });
    if ((currentSong?.id || currentSong?._id) === songId) {
      setSongs((prev) => {
        const remaining = prev.filter((s) => (s.id || s._id) !== songId);
        handleSetCurrentSong(remaining[0] ?? null);
        return remaining;
      });
    }
  };

  const updateSettings = async (settings: Partial<UserSettings>) => {
    const updated = { ...userSettings, ...settings };
    setUserSettings(updated);

    try {
      await fetch(`${API_BASE}/api/v1/mongo/settings/default_user`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'default_user', ...updated }),
      });
    } catch (_err) {
      /* silent — backend might be offline */
    }
  };

  useEffect(() => {
    fetchSongs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppContext.Provider
      value={{
        songs,
        currentSong,
        setCurrentSong: handleSetCurrentSong,
        isLoading,
        userSettings,
        fetchSongs,
        uploadSheet,
        uploadYoutube,
        updateSettings,
        addSong,
        deleteSong,
        transposeOffset,
        setTransposeOffset,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
