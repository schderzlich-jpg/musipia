import os
import io
import re
import math
import zipfile
from xml.etree import ElementTree as ET
import tempfile
import shutil
import uuid
import subprocess
from pydantic import BaseModel
from typing import List, Dict, Tuple, Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
import mido
from PIL import Image, ImageFilter

from app.config import settings
from app.models import Song, UserSetting, NoteInfo

app = FastAPI(title="Piyano Stüdyosu API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    try:
        client = AsyncIOMotorClient(settings.MONGODB_URL)
        await init_beanie(database=client[settings.DATABASE_NAME], document_models=[Song, UserSetting])
        print("MongoDB bağlantısı başarılı.")
    except Exception as e:
        print(f"MongoDB bağlanamadı: {e}. Geliştirme modunda devam ediliyor.")

# ==========================================
# Mongo Endpoints
# ==========================================

@app.get("/api/v1/mongo/songs", response_model=List[Song])
async def get_songs():
    try:
        return await Song.find_all().to_list()
    except Exception:
        return []

@app.post("/api/v1/mongo/songs", response_model=Song)
async def create_song(song: Song):
    try:
        await song.insert()
        return song
    except Exception:
        return song

@app.get("/api/v1/mongo/songs/{song_id}", response_model=Song)
async def get_song(song_id: str):
    try:
        song = await Song.get(song_id)
        if not song:
            raise HTTPException(status_code=404, detail="Parça bulunamadı")
        return song
    except Exception:
        raise HTTPException(status_code=404, detail="Parça bulunamadı")

@app.delete("/api/v1/mongo/songs/{song_id}")
async def delete_song(song_id: str):
    try:
        song = await Song.get(song_id)
        if song:
            await song.delete()
            return {"status": "success", "message": "Parça silindi"}
        raise HTTPException(status_code=404, detail="Parça bulunamadı")
    except Exception:
        return {"status": "success", "message": "Parça silindi (simülasyon)"}

@app.get("/api/v1/mongo/settings/{user_id}", response_model=UserSetting)
async def get_settings(user_id: str):
    try:
        setting = await UserSetting.find_one(UserSetting.user_id == user_id)
        if not setting:
            setting = UserSetting(user_id=user_id)
            await setting.insert()
        return setting
    except Exception:
        return UserSetting(user_id=user_id)

@app.put("/api/v1/mongo/settings/{user_id}", response_model=UserSetting)
async def update_settings(user_id: str, new_settings: UserSetting):
    try:
        setting = await UserSetting.find_one(UserSetting.user_id == user_id)
        if setting:
            setting.selected_piano_model = new_settings.selected_piano_model
            setting.synth_type = new_settings.synth_type
            setting.synth_settings = new_settings.synth_settings
            await setting.save()
            return setting
        else:
            await new_settings.insert()
            return new_settings
    except Exception:
        return new_settings

# ==========================================
# MIDI TO MUSICXML CONVERTER
# ==========================================

def midi_to_musicxml(midi_bytes: bytes, title: str = "Converted from MIDI") -> str:
    """Convert MIDI bytes to MusicXML format."""
    try:
        mid = mido.MidiFile(file=io.BytesIO(midi_bytes))
        ticks_per_beat = mid.ticks_per_beat or 480
        
        # Get tempo from first track
        tempo = 500000  # Default 120 BPM
        for track in mid.tracks:
            for msg in track:
                if msg.type == 'set_tempo':
                    tempo = msg.tempo
                    break
            if tempo != 500000:
                break
        
        tempo_qpm = 60_000_000 / tempo
        
        # Extract notes
        notes_list = []
        active = {}
        abs_tick = 0
        
        for track in mid.tracks:
            abs_tick = 0
            for msg in track:
                abs_tick += msg.time
                if msg.type == 'note_on' and msg.velocity > 0:
                    key = (getattr(msg, 'channel', 0), msg.note)
                    active[key] = (abs_tick, msg.velocity)
                elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                    key = (getattr(msg, 'channel', 0), msg.note)
                    if key in active:
                        start_tick, vel = active.pop(key)
                        notes_list.append({
                            'start_tick': start_tick,
                            'end_tick': abs_tick,
                            'note': msg.note,
                            'velocity': vel
                        })
        
        # Sort by start time
        notes_list.sort(key=lambda x: x['start_tick'])
        
        # Convert ticks to seconds
        def ticks_to_seconds(tick: int) -> float:
            return (tick / ticks_per_beat) * (tempo / 1_000_000)
        
        # Create MusicXML
        divisions = 4  # Quarter note = 4 divisions
        
        xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC
    "-//Recordare//DTD MusicXML 4.0 Partwise//EN"
    "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>{title}</work-title>
  </work>
  <identification>
    <creator type="composer">Audio Conversion</creator>
    <creator type="arranger">Basic-Pitch + MIDI to MusicXML</creator>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>{divisions}</divisions>
        <key>
          <fifths>0</fifths>
          <mode>major</mode>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <staves>1</staves>
        <clef number="1">
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <direction placement="above">
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>{int(tempo_qpm)}</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="{int(tempo_qpm)}"/>
      </direction>
'''
        
        # Convert notes to MusicXML format
        for note_data in notes_list:
            start_sec = ticks_to_seconds(note_data['start_tick'])
            end_sec = ticks_to_seconds(note_data['end_tick'])
            duration_sec = end_sec - start_sec
            
            # Convert duration to divisions (quarter note = 4 divisions)
            duration_divs = int((duration_sec / (60 / tempo_qpm)) * divisions)
            if duration_divs < 1:
                duration_divs = 1
            
            # MIDI note to pitch
            midi_note = note_data['note']
            octave = (midi_note // 12) - 1
            step_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
            step = step_names[midi_note % 12]
            
            # Handle sharps/flats for MusicXML
            if '#' in step:
                step = step[0]
                alter = 1
            else:
                alter = 0
            
            xml += f'''
      <note>
        <pitch>
          <step>{step}</step>
          <octave>{octave}</octave>
          <alter>{alter}</alter>
        </pitch>
        <duration>{duration_divs}</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>'''
        
        xml += '''
    </measure>
  </part>
</score-partwise>'''
        
        return xml
    except Exception as e:
        print(f"MIDI to MusicXML conversion error: {e}")
        raise

# ==========================================
# MIDI PARSE — Gelişmiş Çok Parçalı Destek
# ==========================================

def parse_midi_file(file_bytes: bytes) -> Tuple[List[NoteInfo], float, str]:
    notes = []
    info  = ""
    try:
        mid = mido.MidiFile(file=io.BytesIO(file_bytes))
        ticks_per_beat = mid.ticks_per_beat or 480

        # Tempo haritası
        tempo_map: List[Tuple[int, int]] = [(0, 500000)]
        for track in mid.tracks:
            abs_tick = 0
            for msg in track:
                abs_tick += msg.time
                if msg.type == 'set_tempo':
                    tempo_map.append((abs_tick, msg.tempo))
        tempo_map.sort(key=lambda x: x[0])

        def ticks_to_seconds(tick: int) -> float:
            secs = 0.0
            prev_tick, prev_tempo = 0, 500000
            for map_tick, map_tempo in tempo_map:
                if map_tick >= tick:
                    break
                seg = min(tick, map_tick) - prev_tick
                if seg > 0:
                    secs += (seg / ticks_per_beat) * (prev_tempo / 1_000_000)
                prev_tick, prev_tempo = map_tick, map_tempo
            remaining = tick - prev_tick
            if remaining > 0:
                secs += (remaining / ticks_per_beat) * (prev_tempo / 1_000_000)
            return secs

        active: Dict[Tuple[int, int], Tuple[int, int]] = {}
        for track in mid.tracks:
            abs_tick = 0
            for msg in track:
                abs_tick += msg.time
                if msg.type == 'note_on' and msg.velocity > 0:
                    key = (getattr(msg, 'channel', 0), msg.note)
                    active[key] = (abs_tick, msg.velocity)
                elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                    key = (getattr(msg, 'channel', 0), msg.note)
                    if key in active:
                        start_tick, vel = active.pop(key)
                        start_sec = ticks_to_seconds(start_tick)
                        dur       = max(0.05, ticks_to_seconds(abs_tick) - start_sec)
                        if 21 <= msg.note <= 108:
                            notes.append(NoteInfo(
                                pitch=msg.note,
                                start_time=round(start_sec, 4),
                                duration=round(dur, 4),
                                velocity=vel
                            ))

        notes.sort(key=lambda n: n.start_time)
        info = f"{len(mid.tracks)} parça, {len(notes)} nota"
        print(f"MIDI ayrıştırıldı: {info}")
    except Exception as e:
        print(f"MIDI ayrıştırma hatası: {e}")
        info = f"Hata: {e}"

    duration = max((n.start_time + n.duration for n in notes), default=0.0)
    return notes, duration, info

# ==========================================
# MusicXML PARSE (.xml / .mxl)
# ==========================================

STEP_SEMITONES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
DYN_VELOCITY   = {'pppp':15,'ppp':25,'pp':40,'p':55,'mp':68,'mf':82,'f':96,'ff':110,'fff':120,'ffff':127}

def xml_pitch_to_midi(step: str, octave: int, alter: float) -> int:
    return (octave + 1) * 12 + STEP_SEMITONES.get(step, 0) + round(alter)

def divs_to_secs(divs: int, divisions: int, tempo_qpm: float) -> float:
    return (divs / max(1, divisions)) * (60.0 / max(1, tempo_qpm))

def parse_musicxml_bytes(xml_bytes: bytes) -> Tuple[List[NoteInfo], float, str]:
    notes: List[NoteInfo] = []
    try:
        root = ET.fromstring(xml_bytes)
        # Strip namespace if present
        for el in root.iter():
            el.tag = re.sub(r'\{[^}]*\}', '', el.tag)

        # Global tempo from first sound[@tempo]
        tempo_qpm = 120.0
        first_sound = root.find('.//sound[@tempo]')
        if first_sound is not None:
            tempo_qpm = float(first_sound.get('tempo', '120'))

        parts = root.findall('.//part')
        for part in parts:
            current_time = 0.0
            divisions    = 1
            part_tempo   = tempo_qpm
            tied: Dict[int, Dict] = {}   # midi → {start, vel, dur}

            for measure in part.findall('measure'):
                # Tempo change in this measure
                sound = measure.find('.//sound[@tempo]')
                if sound is not None:
                    part_tempo = float(sound.get('tempo', str(part_tempo)))

                # Divisions update
                divs_el = measure.find('.//divisions')
                if divs_el is not None and divs_el.text:
                    divisions = max(1, int(divs_el.text))

                # Dynamics
                velocity = 80
                dyn_el = measure.find('.//dynamics')
                if dyn_el is not None and len(dyn_el):
                    tag = dyn_el[0].tag.lower()
                    velocity = DYN_VELOCITY.get(tag, 80)

                mtime = current_time
                # voice → {cursor, last_start}
                vstates: Dict[str, Dict] = {}

                for note_el in measure.findall('note'):
                    if note_el.find('grace') is not None:
                        continue

                    is_chord  = note_el.find('chord') is not None
                    is_rest   = note_el.find('rest') is not None
                    voice_el  = note_el.find('voice')
                    voice     = voice_el.text if voice_el is not None and voice_el.text else '1'
                    dur_el    = note_el.find('duration')
                    dur_divs  = int(dur_el.text) if dur_el is not None and dur_el.text else 0
                    dur_secs  = divs_to_secs(dur_divs, divisions, part_tempo)

                    tie_stop  = note_el.find('tie[@type="stop"]')  is not None
                    tie_start = note_el.find('tie[@type="start"]') is not None

                    if voice not in vstates:
                        vstates[voice] = {'cursor': mtime, 'last_start': mtime}

                    start_sec = vstates[voice]['last_start'] if is_chord else vstates[voice]['cursor']

                    if not is_chord:
                        vstates[voice]['last_start'] = vstates[voice]['cursor']
                        vstates[voice]['cursor']    += dur_secs
                    if is_rest:
                        continue

                    pitch_el = note_el.find('pitch')
                    if pitch_el is None:
                        continue

                    step_el   = pitch_el.find('step')
                    oct_el    = pitch_el.find('octave')
                    alter_el  = pitch_el.find('alter')
                    step      = step_el.text.strip() if step_el is not None and step_el.text else 'C'
                    octave    = int(oct_el.text) if oct_el is not None and oct_el.text else 4
                    alter     = float(alter_el.text) if alter_el is not None and alter_el.text else 0.0
                    midi      = xml_pitch_to_midi(step, octave, alter)

                    if not (21 <= midi <= 108):
                        continue

                    if tie_stop and midi in tied:
                        tied[midi]['dur'] += dur_secs
                        if not tie_start:
                            t = tied.pop(midi)
                            notes.append(NoteInfo(
                                pitch=midi,
                                start_time=round(max(0, t['start']), 4),
                                duration=round(max(0.05, t['dur']), 4),
                                velocity=t['vel']
                            ))
                        continue

                    if tie_start:
                        tied[midi] = {'start': start_sec, 'vel': velocity, 'dur': dur_secs}
                        continue

                    notes.append(NoteInfo(
                        pitch=midi,
                        start_time=round(max(0, start_sec), 4),
                        duration=round(max(0.05, dur_secs), 4),
                        velocity=velocity
                    ))

                # Advance measure time
                if vstates:
                    current_time = max(s['cursor'] for s in vstates.values())

            # Flush pending ties
            for midi_p, t in tied.items():
                notes.append(NoteInfo(
                    pitch=midi_p,
                    start_time=round(max(0, t['start']), 4),
                    duration=round(max(0.05, t['dur']), 4),
                    velocity=t['vel']
                ))

        notes.sort(key=lambda n: n.start_time)
        duration = max((n.start_time + n.duration for n in notes), default=0.0)
        print(f"MusicXML ayrıştırıldı: {len(notes)} nota, {duration:.2f}s")
        return notes, duration, f"{len(notes)} nota"
    except Exception as e:
        print(f"MusicXML parse hatası: {e}")
        return [], 0.0, str(e)

def parse_musicxml_file(file_bytes: bytes, filename: str) -> Tuple[List[NoteInfo], float, str]:
    """Handle both .xml (uncompressed) and .mxl (ZIP) MusicXML."""
    name = filename.lower()
    if name.endswith('.mxl'):
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
                # Find the rootfile entry (META-INF/container.xml)
                xml_bytes = None
                try:
                    container = ET.fromstring(zf.read('META-INF/container.xml'))
                    for el in container.iter():
                        el.tag = re.sub(r'\{[^}]*\}', '', el.tag)
                    rf = container.find('.//rootfile')
                    if rf is not None:
                        path = rf.get('full-path', '')
                        xml_bytes = zf.read(path)
                except Exception:
                    pass
                # Fallback: find first .xml inside zip
                if xml_bytes is None:
                    for fn in zf.namelist():
                        if fn.endswith('.xml') and not fn.startswith('META'):
                            xml_bytes = zf.read(fn)
                            break
                if xml_bytes:
                    return parse_musicxml_bytes(xml_bytes)
        except Exception as e:
            print(f"MXL çıkarma hatası: {e}")
            return [], 0.0, str(e)
    else:
        return parse_musicxml_bytes(file_bytes)
    return [], 0.0, "MXL içerik bulunamadı"

# ==========================================
# OMR: Nota Fotoğrafı Okuma (Gelişmiş)
# ==========================================

# Diatonik dizi — her stave pozisyonu için MIDI notu
# Treble: aşağıdan (ledger below) → yukarıya (ledger above)
# Konumlar: B3(59), C4, D4, E4, F4, G4, A4, B4, C5, D5, E5, F5, G5, A5, B5, C6
TREBLE_POS = [59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]
# Bass: G1(43), A1, B1, C2, D2, E2, F2, G2, A2, B2, C3, D3, E3, F3, G3, A3, B3, C4
BASS_POS   = [43, 45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72]

def pitch_from_stave_position(step_from_bottom: float, is_bass: bool) -> int:
    """step_from_bottom=0 → lowest ledger line, 8 → middle line, etc."""
    pos_list = BASS_POS if is_bass else TREBLE_POS
    idx = max(0, min(len(pos_list) - 1, int(round(step_from_bottom))))
    return pos_list[idx]

def otsu_threshold(img_gray: Image.Image) -> int:
    """Compute Otsu's threshold for binarization."""
    histogram = img_gray.histogram()
    total = sum(histogram)
    if total == 0:
        return 128
    sum_total = sum(i * histogram[i] for i in range(256))
    sum_bg, weight_bg, max_var, threshold = 0.0, 0, 0.0, 128
    for i in range(256):
        weight_bg += histogram[i]
        if weight_bg == 0:
            continue
        weight_fg = total - weight_bg
        if weight_fg == 0:
            break
        sum_bg += i * histogram[i]
        mean_bg = sum_bg / weight_bg
        mean_fg = (sum_total - sum_bg) / weight_fg
        var = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
        if var > max_var:
            max_var, threshold = var, i
    return threshold

def detect_stave_lines(img_bin, W: int, H: int) -> List[int]:
    """Find horizontal staff lines via row projection. Returns y-positions."""
    # Row sum (black pixels)
    row_sums = []
    pix = img_bin.load()
    for y in range(H):
        s = sum(1 for x in range(W) if pix[x, y] < 128)
        row_sums.append(s)

    min_run = W * 0.20   # at least 20% of row width must be black
    candidates = []
    for y in range(1, H - 1):
        if row_sums[y] > min_run:
            # local peak
            if row_sums[y] >= row_sums[y - 1] and row_sums[y] >= row_sums[y + 1]:
                candidates.append(y)

    # Merge nearby candidates (within 4 px → pick peak)
    merged = []
    i = 0
    while i < len(candidates):
        group = [candidates[i]]
        while i + 1 < len(candidates) and candidates[i + 1] - candidates[i] <= 5:
            i += 1
            group.append(candidates[i])
        merged.append(int(sum(group) / len(group)))
        i += 1

    return merged

def group_into_staves(lines: List[int]) -> List[List[int]]:
    """Group detected horizontal lines into 5-line staves."""
    staves = []
    used   = set()
    for i in range(len(lines)):
        if i in used:
            continue
        group = [lines[i]]
        for j in range(i + 1, len(lines)):
            if j in used:
                continue
            sp = group[-1]
            expected = lines[i] + len(group) * (lines[i + 1] - lines[i] if i + 1 < len(lines) else 12)
            if abs(lines[j] - sp) <= max(4, (lines[j] - lines[i]) * 0.05 + 3):
                group.append(lines[j])
                used.add(j)
            if len(group) == 5:
                break
        if len(group) == 5:
            spacings = [group[k + 1] - group[k] for k in range(4)]
            avg_sp   = sum(spacings) / 4
            if avg_sp >= 4 and all(abs(s - avg_sp) < avg_sp * 0.5 + 3 for s in spacings):
                staves.append(group)
                used.add(i)
    return staves

def detect_note_heads(img_bin, x_start: int, x_end: int,
                       y_min: int, y_max: int, spacing: float) -> List[Tuple[float, float]]:
    """
    Detect filled elliptic noteheads using column-by-column run-length analysis.
    Returns list of (x_center, y_center) in image coordinates.
    """
    pix    = img_bin.load()
    W_img  = img_bin.width
    H_img  = img_bin.height
    heads  = []
    min_h  = spacing * 0.40
    max_h  = spacing * 1.55
    min_w  = spacing * 0.35

    # Collect runs per column in the stave band
    x = x_start
    while x < x_end:
        runs = []
        y = max(0, y_min)
        while y < min(H_img, y_max):
            if pix[x, y] < 128:
                ys = y
                while y < min(H_img, y_max) and pix[x, y] < 128:
                    y += 1
                ye = y
                h  = ye - ys
                if min_h <= h <= max_h:
                    runs.append((ys + ye) / 2, h)
            else:
                y += 1

        for (cy, rh) in runs:
            # Check horizontal extent
            w_count = 0
            for dx in range(-int(spacing * 0.9), int(spacing * 0.9)):
                nx = x + dx
                if 0 <= nx < W_img and pix[nx, int(cy)] < 128:
                    w_count += 1
            if w_count >= min_w:
                # Avoid duplicate (within spacing/2 of existing)
                too_close = any(abs(hx - x) < spacing * 0.6 and abs(hy - cy) < spacing * 0.5
                                for hx, hy in heads)
                if not too_close:
                    heads.append((float(x), float(cy)))
                    x += int(spacing * 0.5)
                    break
        x += 2

    return heads


def parse_sheet_image(file_bytes: bytes) -> List[NoteInfo]:
    """
    OMR: Detect grand staff lines, locate noteheads, assign pitches.
    Returns NoteInfo list sorted by start_time.
    """
    notes: List[NoteInfo] = []
    try:
        img = Image.open(io.BytesIO(file_bytes))
        # Handle transparency: replace transparent pixels with white
        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
            bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
            img = Image.alpha_composite(bg, img.convert('RGBA'))
        img = img.convert('L')
        
        W, H = img.size

        # Resize for speed
        max_dim = 1600
        if max(W, H) > max_dim:
            scale = max_dim / max(W, H)
            W, H  = int(W * scale), int(H * scale)
            img   = img.resize((W, H), Image.LANCZOS)

        # Light denoise
        img_smooth = img.filter(ImageFilter.MedianFilter(3))

        # Adaptive binarize using Otsu
        thr    = otsu_threshold(img_smooth)
        img_bin = img_smooth.point(lambda p: 0 if p < thr else 255)

        # Detect stave lines
        raw_lines = detect_stave_lines(img_bin, W, H)
        staves    = group_into_staves(raw_lines)

        # Retry with looser threshold if nothing found
        if not staves:
            img_bin2   = img_smooth.point(lambda p: 0 if p < min(thr + 30, 200) else 255)
            raw_lines2 = detect_stave_lines(img_bin2, W, H)
            staves     = group_into_staves(raw_lines2)
            if staves:
                img_bin = img_bin2

        if not staves:
            print("OMR: staff tespit edilemedi")
            return []

        print(f"OMR: {len(staves)} stave tespit edildi")

        current_time = 0.0
        BEAT_DUR     = 0.45   # seconds per detected note (approximation)
        BAR_GAP      = 0.3    # extra gap between systems

        i = 0
        while i < len(staves):
            treble = staves[i]
            sp_t   = (treble[4] - treble[0]) / 4.0
            x_start = int(sp_t * 6)     # skip clef symbol area

            # Check if next stave forms a grand staff
            if i + 1 < len(staves):
                bass = staves[i + 1]
                gap  = bass[0] - treble[4]
                sp_b = (bass[4] - bass[0]) / 4.0
                avg_sp = (sp_t + sp_b) / 2

                is_grand = 0.8 * avg_sp <= gap <= 5.5 * avg_sp

                if is_grand:
                    # Expand detection zone to include ledger lines
                    y_top_t = int(treble[0] - 3.5 * sp_t)
                    y_bot_t = int(treble[4] + 3.5 * sp_t)
                    y_top_b = int(bass[0]   - 3.5 * sp_b)
                    y_bot_b = int(bass[4]   + 3.5 * sp_b)

                    heads_t = detect_note_heads(img_bin, x_start, W - 5, y_top_t, y_bot_t, sp_t)
                    heads_b = detect_note_heads(img_bin, x_start, W - 5, y_top_b, y_bot_b, sp_b)

                    # Merge and sort by x (= time)
                    all_heads = [(x, cy, False) for x, cy in heads_t] + \
                                [(x, cy, True)  for x, cy in heads_b]
                    all_heads.sort(key=lambda h: h[0])

                    for (x, cy, is_bass) in all_heads:
                        lines  = bass if is_bass else treble
                        sp     = sp_b  if is_bass else sp_t
                        line5  = lines[4]  # bottom line y-position

                        # Steps from bottom line of stave (down = lower pitch)
                        # step 0 = bottom line, step 8 = top line
                        steps_from_bottom = (line5 - cy) / (sp / 2.0) + 4  # +4 → bottom=0 at line1
                        # Ledger lines shift further
                        pitch = pitch_from_stave_position(steps_from_bottom, is_bass)

                        notes.append(NoteInfo(
                            pitch=pitch,
                            start_time=round(current_time, 4),
                            duration=0.35,
                            velocity=72
                        ))
                        current_time += BEAT_DUR

                    current_time += BAR_GAP
                    i += 2
                    continue

            # Single stave (treble only)
            sp     = sp_t
            y_top  = int(treble[0] - 3 * sp)
            y_bot  = int(treble[4] + 3 * sp)
            heads  = detect_note_heads(img_bin, x_start, W - 5, y_top, y_bot, sp)

            for (x, cy) in heads:
                line5 = treble[4]
                steps = (line5 - cy) / (sp / 2.0) + 4
                pitch = pitch_from_stave_position(steps, False)
                notes.append(NoteInfo(
                    pitch=pitch,
                    start_time=round(current_time, 4),
                    duration=0.35,
                    velocity=72
                ))
                current_time += BEAT_DUR

            if heads:
                current_time += BAR_GAP
            i += 1

    except Exception as e:
        print(f"OMR ayrıştırma hatası: {e}")

    if notes:
        print(f"OMR: {len(notes)} nota tespit edildi")
    else:
        print("OMR: hiç nota tespit edilemedi — görüntü kalitesi düşük veya format desteklenmiyor")

    return notes

# ==========================================
# Dosya Yükleme Endpoint
# ==========================================

@app.post("/api/v1/upload/sheet")
async def upload_sheet(file: UploadFile = File(...)):
    filename    = file.filename or "upload"
    file_bytes  = await file.read()
    fname_lower = filename.lower()

    save_path = os.path.join(settings.UPLOAD_DIR, filename)
    try:
        with open(save_path, "wb") as f:
            f.write(file_bytes)
    except Exception:
        pass

    notes: List[NoteInfo] = []
    duration   = 0.0
    extra_info = ""
    composer   = "Yüklenen Eser"

    if fname_lower.endswith(('.mid', '.midi')):
        notes, duration, extra_info = parse_midi_file(file_bytes)
        composer = f"MIDI ({extra_info})"

    elif fname_lower.endswith(('.xml', '.musicxml', '.mxl')):
        notes, duration, extra_info = parse_musicxml_file(file_bytes, filename)
        composer = f"MusicXML ({extra_info})"

    else:
        # Image OMR
        notes = parse_sheet_image(file_bytes)
        if notes:
            duration = max(n.start_time + n.duration for n in notes) + 0.5
            extra_info = f"OMR: {len(notes)} nota"
            composer = "Nota Fotoğrafı (OMR)"

    if not notes:
        detail = (
            "Nota çıkarılamadı.\n"
            "• MIDI/MusicXML için: Geçerli bir .mid veya .xml dosyası yükleyin.\n"
            "• Görüntü için: Net, yüksek çözünürlüklü (>800px genişlik), beyaz arka planlı nota sayfası kullanın.\n"
            "• En iyi sonuç için MuseScore → Dosya → Dışa Aktar → Sıkıştırılmamış MusicXML (.xml)"
        )
        raise HTTPException(status_code=422, detail=detail)

    title = (
        os.path.splitext(filename)[0]
        .replace("_", " ").replace("-", " ")
        .strip().title()
    )

    new_song = Song(
        title=title,
        composer=composer,
        notes=notes,
        duration=duration + 0.5,
        file_path=save_path
    )
    try:
        await new_song.insert()
    except Exception:
        import time
        new_song.id = f"uploaded_{int(time.time())}"

    return {
        "status":  "success",
        "message": f"Dosya işlendi: {len(notes)} nota bulundu.",
        "song":    new_song
    }

class YoutubeRequest(BaseModel):
    url: str

@app.post("/api/v1/upload/audio")
async def upload_audio(file: UploadFile = File(...)):
    """Convert MP3 audio file to MusicXML using basic-pitch."""
    import subprocess
    import tempfile
    import os
    import shutil
    
    filename = file.filename or "upload.mp3"
    file_bytes = await file.read()
    
    tmp_dir = tempfile.mkdtemp()
    try:
        # Save uploaded MP3
        mp3_path = os.path.join(tmp_dir, filename)
        with open(mp3_path, "wb") as f:
            f.write(file_bytes)
        
        print(f"Converting {filename} to MIDI via basic-pitch...")
        # Run basic-pitch to convert audio to MIDI
        result = subprocess.run(
            ["basic-pitch", tmp_dir, mp3_path],
            capture_output=True, text=True
        )
        
        if result.returncode != 0:
            print("basic-pitch error:", result.stderr)
            raise HTTPException(status_code=500, detail="Nota çıkarma işlemi başarısız oldu.")
        
        # Find the generated .mid file
        mid_path = None
        for f in os.listdir(tmp_dir):
            if f.endswith('.mid'):
                mid_path = os.path.join(tmp_dir, f)
                break
        
        if not mid_path:
            raise HTTPException(status_code=500, detail="MIDI dosyası oluşturulamadı.")
        
        # Read MIDI file
        with open(mid_path, "rb") as f:
            midi_bytes = f.read()
        
        # Convert MIDI to MusicXML
        title = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ").strip().title()
        musicxml_str = midi_to_musicxml(midi_bytes, title)
        
        # Save MusicXML file
        xml_filename = f"{os.path.splitext(filename)[0]}.musicxml"
        xml_path = os.path.join(settings.UPLOAD_DIR, xml_filename)
        with open(xml_path, "w", encoding="utf-8") as f:
            f.write(musicxml_str)
        
        # Parse the MusicXML to get notes for the app
        notes, duration, _ = parse_musicxml_file(musicxml_str.encode('utf-8'), xml_filename)
        
        if not notes:
            raise HTTPException(status_code=500, detail="MusicXML işlenemedi.")
        
        new_song = Song(
            title=title,
            composer="Nuray Hafiftaş (Audio Conversion)",
            notes=notes,
            duration=duration + 0.5,
            file_path=xml_path
        )
        
        try:
            await new_song.insert()
        except Exception:
            import time
            new_song.id = f"audio_{int(time.time())}"
        
        return {
            "status": "success",
            "message": f"MP3 başarıyla MusicXML'e dönüştürüldü: {len(notes)} nota bulundu.",
            "song": new_song,
            "musicxml_path": xml_path
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Audio upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

@app.post("/api/v1/upload/youtube")
def upload_youtube(req: YoutubeRequest):
    import yt_dlp
    import subprocess
    import tempfile
    import os
    import shutil

    tmp_dir = tempfile.mkdtemp()
    try:
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(tmp_dir, '%(title)s.%(ext)s'),
            'noplaylist': True,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=True)

        title = info.get('title', 'YouTube Müzik').replace("_", " ").replace("-", " ").strip().title()
        uploader = info.get('uploader', 'YouTube')

        mp3_path = None
        for f in os.listdir(tmp_dir):
            if f.endswith('.mp3'):
                mp3_path = os.path.join(tmp_dir, f)
                break

        if not mp3_path:
            raise Exception("Ses dosyası indirilemedi.")

        print(f"Predicting MIDI for {mp3_path} via CLI...")
        # Run basic-pitch CLI
        result = subprocess.run(
            ["basic-pitch", tmp_dir, mp3_path],
            capture_output=True, text=True
        )
        
        if result.returncode != 0:
            print("basic-pitch error:", result.stderr)
            raise Exception("Nota çıkarma işlemi başarısız oldu.")

        # Find the generated .mid file
        mid_path = None
        for f in os.listdir(tmp_dir):
            if f.endswith('.mid'):
                mid_path = os.path.join(tmp_dir, f)
                break
                
        if not mid_path:
            raise Exception("MIDI dosyası oluşturulamadı.")
            
        with open(mid_path, "rb") as f:
            midi_bytes = f.read()
            
        notes, duration, _ = parse_midi_file(midi_bytes)

        if not notes:
            raise Exception("Videoda hiç nota tespit edilemedi.")

        new_song = {
            "id": "yt-" + os.urandom(4).hex(),
            "title": f"{title} — YouTube ({uploader})",
            "duration": duration,
            "notes": [n.dict() for n in notes]
        }
        return {
            "message": "YouTube başarıyla işlendi",
            "song": new_song
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Youtube hatası: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

@app.get("/health")
async def health():
    return {"status": "ok", "version": "3.0.0"}
