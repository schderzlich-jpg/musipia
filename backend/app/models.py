from typing import List, Optional
from datetime import datetime
from beanie import Document
from pydantic import BaseModel, Field

class NoteInfo(BaseModel):
    pitch: int          # MIDI note number (e.g. 60 for middle C)
    start_time: float   # Start time in seconds
    duration: float     # Duration in seconds
    velocity: int       # MIDI velocity (0-127)

class Song(Document):
    title: str
    composer: Optional[str] = "Unknown"
    notes: List[NoteInfo] = []
    duration: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    file_path: Optional[str] = None  # Path to original MIDI or image file

    class Settings:
        name = "songs"

class UserSetting(Document):
    user_id: str
    selected_piano_model: str = "Yamaha P-225"
    synth_type: str = "synthwave"
    synth_settings: dict = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "user_settings"
