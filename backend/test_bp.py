import sys

try:
    from basic_pitch.inference import predict
    print("basic_pitch predict imported successfully")
except ImportError as e:
    print(f"Import error: {e}")
