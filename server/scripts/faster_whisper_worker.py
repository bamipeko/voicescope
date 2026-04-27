#!/usr/bin/env python3
"""
VoiceScope faster-whisper worker.
Called by Node.js server as a subprocess.

Usage:
  python faster_whisper_worker.py --audio <path> [--model <size>] [--language <code>]
  python faster_whisper_worker.py --check

Output: JSON to stdout, progress/errors to stderr.
"""

import sys
import json
import argparse
import os

def check_availability():
    """Check if faster-whisper is installed and report capabilities."""
    result = {"available": False, "version": None, "gpu": False}
    try:
        import faster_whisper
        result["available"] = True
        result["version"] = getattr(faster_whisper, "__version__", "unknown")
        # Check CUDA availability
        try:
            import torch
            result["gpu"] = torch.cuda.is_available()
        except ImportError:
            # faster-whisper can use CTranslate2 CUDA without torch
            try:
                import ctranslate2
                result["gpu"] = "cuda" in ctranslate2.get_supported_compute_types("auto")
            except Exception:
                result["gpu"] = False
    except ImportError:
        pass
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["available"] else 1)


def transcribe(audio_path, model_size="base", language=None):
    """Run transcription and output JSON result."""
    from faster_whisper import WhisperModel

    # Determine compute type based on available hardware
    try:
        import ctranslate2
        compute_types = ctranslate2.get_supported_compute_types("auto")
        if "float16" in compute_types:
            device = "cuda"
            compute_type = "float16"
        elif "int8" in compute_types:
            device = "cpu"
            compute_type = "int8"
        else:
            device = "cpu"
            compute_type = "int8"
    except Exception:
        device = "cpu"
        compute_type = "int8"

    print(f"Loading model: {model_size} (device={device}, compute={compute_type})", file=sys.stderr)

    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    transcribe_opts = {
        "beam_size": 5,
        "vad_filter": True,
        "vad_parameters": {"min_silence_duration_ms": 500},
    }
    if language and language != "auto":
        transcribe_opts["language"] = language

    print("Transcribing...", file=sys.stderr)
    segments_gen, info = model.transcribe(audio_path, **transcribe_opts)

    segments = []
    for seg in segments_gen:
        segments.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
        })
        # Progress output
        print(f"[{seg.start:.1f}s - {seg.end:.1f}s] {seg.text.strip()}", file=sys.stderr)

    result = {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 1),
        "segments": segments,
    }

    print(json.dumps(result, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="VoiceScope faster-whisper worker")
    parser.add_argument("--check", action="store_true", help="Check if faster-whisper is available")
    parser.add_argument("--audio", type=str, help="Path to audio file")
    parser.add_argument("--model", type=str, default="base", help="Model size: tiny, base, small, medium, large-v3")
    parser.add_argument("--language", type=str, default=None, help="Language code (e.g., ja, en) or auto")

    args = parser.parse_args()

    if args.check:
        check_availability()
    elif args.audio:
        if not os.path.exists(args.audio):
            print(json.dumps({"error": f"Audio file not found: {args.audio}"}))
            sys.exit(1)
        try:
            transcribe(args.audio, model_size=args.model, language=args.language)
        except Exception as e:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
