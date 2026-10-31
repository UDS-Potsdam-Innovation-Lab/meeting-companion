//! Reading the corpus clips: 16 kHz mono 16-bit PCM WAV, in memory. Test-only.

use crate::engines::audio::SAMPLE_RATE;

/// The samples of a 16 kHz mono 16-bit PCM WAV file, scaled to -1..1.
pub fn samples(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a WAV file".into());
    }
    let mut pos = 12;
    let mut format = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        let body = &bytes[pos + 8..(pos + 8 + size).min(bytes.len())];
        if id == b"fmt " && body.len() >= 16 {
            let u16_at = |i: usize| u16::from_le_bytes([body[i], body[i + 1]]);
            let rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
            format = Some((u16_at(0), u16_at(2), rate, u16_at(14)));
        } else if id == b"data" {
            if format != Some((1, 1, SAMPLE_RATE, 16)) {
                return Err(format!("need 16 kHz mono 16-bit PCM, got {format:?}"));
            }
            return Ok(body
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| f32::from(i16::from_le_bytes(*c)) / 32_768.0)
                .collect());
        }
        pos += 8 + size + (size & 1);
    }
    Err("no data chunk".into())
}

/// A 16 kHz mono 16-bit PCM WAV file holding `pcm` (for temp-folder fixtures).
pub fn encode(pcm: &[i16]) -> Vec<u8> {
    let data_len = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + pcm.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in pcm {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn encoded_pcm_reads_back() {
        let wav = super::encode(&[0, 16_384, -32_768]);
        assert_eq!(super::samples(&wav).unwrap(), [0.0, 0.5, -1.0]);
        assert!(super::samples(b"RIFF....WAVEjunk").is_err());
        let mut stereo = wav.clone();
        stereo[22] = 2;
        assert!(super::samples(&stereo).is_err());
    }
}
