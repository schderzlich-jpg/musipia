import os

class Settings:
    MONGODB_URL: str = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    DATABASE_NAME: str = os.getenv("DATABASE_NAME", "piano_synth")
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "/Users/eda/Desktop/piano-synth/uploads")

settings = Settings()
