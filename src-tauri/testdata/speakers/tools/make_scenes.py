"""Writes scenes.json: the test meetings mixed from the clips in manifest.json.

Provenance record; the tests read scenes.json and never run this. Run by hand (Python 3, no packages):

    python3 make_scenes.py

Times are milliseconds. A turn plays `lenMs` of a clip from `fromMs`, starting at `atMs` of the meeting;
a negative gap overlaps the previous turn. Turn text is reference text attached to the turn (what the
transcript line would say), not an alignment of the spoken words: the introductions of the name round
are not spoken in the audio.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
CLIPS = {c["id"]: c for c in json.loads((HERE / "manifest.json").read_text())["clips"]}


class Scene:
    def __init__(self, id, lang, about, participants, seed=1, noise=None, lead_in=500, tail=1500):
        self.d = {
            "id": id,
            "lang": lang,
            "about": about,
            "seed": seed,
            "noiseSnrDb": noise,
            "tailMs": tail,
            "participants": [{"speaker": s, "name": n} for s, n in participants],
            "turns": [],
        }
        self.end = lead_in - 0  # the first turn starts after the lead-in
        self.first = True

    def say(self, clip, gap=700, frm=0, length=None, text=None):
        c = CLIPS[clip]
        length = length if length is not None else c["durationMs"] - frm
        assert 0 <= frm and frm + length <= c["durationMs"], (clip, frm, length)
        at = self.end if self.first else self.end + gap
        self.first = False
        self.d["turns"].append(
            {
                "speaker": c["speaker"],
                "clip": clip,
                "atMs": at,
                "fromMs": frm,
                "lenMs": length,
                "text": text if text is not None else c["text"],
            }
        )
        self.end = max(self.end, at + length)
        return self

    def wait(self, ms):
        self.end += ms
        return self


DE_PEOPLE = [
    ("de-f1", "Mara Klein"),
    ("de-m1", "Tobias Brandt"),
    ("de-f2", "Jana Roth"),
    ("de-m2", "Yusuf Aydin"),
    ("de-f3", "Svenja Weiß"),
    ("de-m3", "Jürgen Groß"),
    (None, "Petra Sand"),
]

scenes = []

# 1. Name round at check-in, 6 people (de), then a discussion. Each introduction is the text of the
#    speaker's first turn; Petra Sand is invited but absent.
s = Scene(
    "de-name-round",
    "de",
    "Check-in with a name round, six speakers, then a discussion with mixed turn gaps.",
    DE_PEOPLE,
    seed=11,
)
intro = {
    "de-f1": "Hallo, ich bin Mara Klein und leite das Produktteam.",
    "de-m1": "Guten Morgen, Tobias Brandt hier, ich kümmere mich um die Technik.",
    "de-f2": "Ich bin Jana Roth aus der Schulverwaltung.",
    "de-m2": "Yusuf Aydin, ich schreibe heute das Protokoll.",
    "de-f3": "Svenja Weiß, ich bin für die Pilotschulen zuständig.",
    "de-m3": "Und ich bin Jürgen Groß vom Medienzentrum.",
}
for spk in ["de-f1", "de-m1", "de-f2", "de-m2", "de-f3", "de-m3"]:
    s.say(f"{spk}-1", gap=900, length=min(6000, CLIPS[f"{spk}-1"]["durationMs"]), text=intro[spk])
for clip, gap in [
    ("de-m2-2", 1200), ("de-f1-2", 400), ("de-m3-2", 900), ("de-f2-2", 300), ("de-m1-2", 1100),
    ("de-f3-2", 500), ("de-f1-3", 800), ("de-m2-3", 400), ("de-f3-3", 1000), ("de-m3-3", 300),
    ("de-f2-3", 700), ("de-m1-3", 900),
]:
    s.say(clip, gap=gap)
scenes.append(s.d)

# 2. Overlapping speech (en, 3 speakers): every change of speaker overlaps by 1-2 s.
s = Scene(
    "en-overlap",
    "en",
    "Three speakers who talk over each other at every change of turn.",
    [("en-f1", "Alice Morgan"), ("en-m1", "Ben Carter"), ("en-f2", "Carol Hughes")],
    seed=22,
)
for clip, gap in [
    ("en-f1-1", 0), ("en-m1-3", -1500), ("en-f2-2", -1800), ("en-f1-2", -1200),
    ("en-m1-4", -2000), ("en-f2-3", -1500), ("en-f1-3", -1600),
]:
    s.say(clip, gap=gap)
scenes.append(s.d)

# 3. Short turns (en, 2 speakers): long turns answered with short acknowledgements (< 1 s), some
#    right after the other speaker, some after a longer pause.
s = Scene(
    "en-short-turns",
    "en",
    "Two speakers; one talks, the other answers with short turns under one second.",
    [("en-m2", "David Price"), ("en-f2", "Carol Hughes")],
    seed=33,
)
s.say("en-m2-1")
s.say("en-f2-1", gap=400, frm=500, length=800, text="Yes, exactly.")
s.say("en-m2-2", gap=600)
s.say("en-f2-4", gap=1500, frm=1200, length=700, text="Right.")
s.say("en-m2-3", gap=500, length=6000)
s.say("en-f2-2", gap=300, frm=2000, length=900, text="Okay, agreed.")
s.say("en-f2-2", gap=1400, frm=6000, length=4500)
s.say("en-m2-4", gap=1200, frm=300, length=650, text="Sure.")
s.say("en-f2-3", gap=700, length=5000)
s.say("en-m2-4", gap=1500, frm=2000, length=850, text="Fine by me.")
s.say("en-m2-3", gap=1100, frm=6500, length=5000)
s.say("en-f2-3", gap=800, frm=5500, length=600, text="Yes.")
scenes.append(s.d)

# 4. A voice that comes back after more than a minute, and one who says only a few words (en, 4).
s = Scene(
    "en-return",
    "en",
    "en-m2 speaks, is silent for over a minute, and speaks again; en-f1 says only a few words.",
    [("en-m1", "Ben Carter"), ("en-f2", "Carol Hughes"), ("en-m2", "David Price"), ("en-f1", "Alice Morgan")],
    seed=44,
)
s.say("en-m2-1")
for clip, gap in [
    ("en-m1-1", 800), ("en-f2-1", 700), ("en-m1-2", 1000), ("en-f2-4", 600),
    ("en-m1-3", 900), ("en-f2-2", 700), ("en-m1-4", 800),
]:
    s.say(clip, gap=gap)
s.say("en-f1-4", gap=1200, frm=1000, length=1700, text="Can I just add one thing?")
s.say("en-m2-3", gap=1500)
s.say("en-f2-3", gap=900, length=7000)
scenes.append(s.d)

# 5. Background noise (de, 3 speakers), generated noise at 10 dB SNR.
s = Scene(
    "de-noise",
    "de",
    "Three speakers with generated background noise at 10 dB SNR.",
    [("de-f2", "Jana Roth"), ("de-m3", "Jürgen Groß"), ("de-f3", "Svenja Weiß")],
    seed=55,
    noise=10.0,
)
for clip, gap in [
    ("de-f2-3", 0), ("de-m3-2", 900), ("de-f3-3", 700), ("de-m3-3", 1100), ("de-f2-2", 600),
    ("de-f3-2", 800), ("de-m3-1", 900), ("de-f2-1", 700),
]:
    s.say(clip, gap=gap)
scenes.append(s.d)

doc = {
    "about": "Test meetings for the speaker-accuracy tests, mixed in memory from the clips in manifest.json. "
    "Built by tools/make_scenes.py; see there for the fields.",
    "sampleRate": 16000,
    "turnRmsDbfs": -26.0,
    "scenes": scenes,
}
(HERE / "scenes.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
for sc in scenes:
    end = max(t["atMs"] + t["lenMs"] for t in sc["turns"])
    print(sc["id"], len(sc["turns"]), "turns", end / 1000, "s")
