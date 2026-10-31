"""Builds the speaker corpus clips from VoxPopuli (CC0-1.0), facebook/voxpopuli on Hugging Face.

Provenance record only; the tests never run it and never download anything. Run by hand:

    uv run --with pyarrow --with soundfile --with numpy python extract_voxpopuli.py <de-test.parquet> <en-test.parquet>

with the parquet files `de/test-00000-of-00001.parquet` and `en/test-00000-of-00001.parquet` from
https://huggingface.co/datasets/facebook/voxpopuli. It picks a few utterances per chosen speaker
(distinct texts, 6-13 s, spread over sessions), converts them from 32-bit float to 16-bit PCM WAV
(16 kHz mono, as published), trims silence at both ends, and writes `clips/*.wav` and `manifest.json`
next to this folder. Nothing else is changed in the audio.
"""

import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf

HERE = Path(__file__).resolve().parent.parent
SOURCE = "VoxPopuli, transcribed test split (facebook/voxpopuli)"
URL = "https://huggingface.co/datasets/facebook/voxpopuli"
# Corpus speaker id -> (language, VoxPopuli speaker_id, clips wanted).
SPEAKERS = {
    "de-f1": ("de", "124888", 3),
    "de-f2": ("de", "124838", 3),
    "de-f3": ("de", "124934", 3),
    "de-m1": ("de", "96871", 3),
    "de-m2": ("de", "190464", 3),
    "de-m3": ("de", "1859", 3),
    "en-f1": ("en", "28240", 4),
    "en-f2": ("en", "96920", 4),
    "en-m1": ("en", "88882", 4),
    "en-m2": ("en", "129256", 4),
}
MIN_S, MAX_S = 6.0, 13.0


def trim(x, rate=16000, frame=160, floor_db=-40.0, keep=1600):
    """Drops leading and trailing audio quieter than floor_db below the clip's loudest 10 ms frame."""
    n = len(x) // frame
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    loud = np.nonzero(20 * np.log10(rms / rms.max()) > floor_db)[0]
    start = max(0, loud[0] * frame - keep)
    end = min(len(x), (loud[-1] + 1) * frame + keep)
    return x[start:end]


def main(de_path, en_path):
    tables = {}
    for lang, path in (("de", de_path), ("en", en_path)):
        cols = ["audio", "speaker_id", "audio_id", "raw_text", "gender"]
        tables[lang] = pq.read_table(path, columns=cols).to_pylist()
    (HERE / "clips").mkdir(exist_ok=True)
    clips = []
    for corpus_id, (lang, vp_id, wanted) in SPEAKERS.items():
        rows = [r for r in tables[lang] if r["speaker_id"] == vp_id and r["raw_text"].strip()]
        rows.sort(key=lambda r: r["audio_id"])
        picked, texts, sessions = [], set(), {}
        for r in rows:
            audio, rate = sf.read(io.BytesIO(r["audio"]["bytes"]), dtype="float32")
            assert rate == 16000 and audio.ndim == 1
            d = len(audio) / rate
            text = r["raw_text"].strip()
            if not (MIN_S <= d <= MAX_S) or text in texts:
                continue
            session = r["audio_id"].split("_")[0].split("-PLENARY")[0]
            picked.append((sessions.get(session, 0), r, audio, text))
            sessions[session] = sessions.get(session, 0) + 1
            texts.add(text)
        # Fewest clips from the same session first, then by id: spread over sessions.
        picked.sort(key=lambda p: (p[0], p[1]["audio_id"]))
        for n, (_, r, audio, text) in enumerate(picked[:wanted], 1):
            pcm = np.clip(np.round(trim(audio) * 32767), -32768, 32767).astype("<i2")
            name = f"clips/{corpus_id}-{n}.wav"
            buf = io.BytesIO()
            sf.write(buf, pcm, 16000, subtype="PCM_16", format="WAV")
            data = buf.getvalue()
            (HERE / name).write_bytes(data)
            clips.append(
                {
                    "id": f"{corpus_id}-{n}",
                    "file": name,
                    "speaker": corpus_id,
                    "lang": lang,
                    "gender": r["gender"],
                    "source": SOURCE,
                    "url": URL,
                    "sourceSpeaker": vp_id,
                    "utterance": r["audio_id"],
                    "text": text,
                    "licence": "CC0-1.0",
                    "durationMs": len(pcm) * 1000 // 16000,
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            )
            print(name, round(len(pcm) / 16000, 1), r["audio_id"])
    manifest = {
        "marker": "meeting-companion-speaker-corpus-v1",
        "about": "Single-speaker clips for the speaker-accuracy tests. Built by tools/extract_voxpopuli.py.",
        "clips": clips,
    }
    (HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
