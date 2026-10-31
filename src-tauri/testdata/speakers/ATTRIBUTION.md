# Attribution

The clips in `clips/` are short excerpts of speeches in the European Parliament from **VoxPopuli**
(Wang et al., "VoxPopuli: A Large-Scale Multilingual Speech Corpus for Representation Learning,
Semi-Supervised Learning and Interpretation", ACL 2021), transcribed test split, as published at
<https://huggingface.co/datasets/facebook/voxpopuli>. The transcribed data is released under
**CC0-1.0**; no attribution is required, this note is given as a courtesy.

`manifest.json` lists for every clip the VoxPopuli utterance id, speaker id, transcript, licence and
SHA-256. The only changes are the conversion from 32-bit float to 16-bit PCM and trimmed silence at both
ends (`tools/extract_voxpopuli.py`).

The speakers are used only to test whether the app tells voices apart. The tests never try to find
out who a speaker is.

Clips under `CC-BY-4.0` need a line here naming the clip id, author and source. There are none.
