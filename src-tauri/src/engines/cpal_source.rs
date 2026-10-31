//! [`AudioSource`] for the default input device or one chosen by name, and [`AudioDevices`] listing
//! the input devices, with `cpal`. The stream lives on its own thread
//! (it is not `Send` on every OS); samples are mixed to mono, resampled to 16 kHz and pushed into the
//! bounded in-memory sink. Nothing is written to disk.

use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, FromSample, Sample, SampleFormat, SizedSample};

use super::audio::{AudioError, AudioSink, AudioSource, SAMPLE_RATE};
use super::devices::AudioDevices;

#[derive(Default)]
pub struct CpalAudioSource {
    /// `None`: the system default input device.
    device: Option<String>,
    running: Option<(mpsc::Sender<()>, JoinHandle<()>)>,
}

impl CpalAudioSource {
    /// The system default input device.
    pub fn new() -> Self {
        Self::default()
    }

    /// The input device with this name.
    pub fn named(name: &str) -> Self {
        Self {
            device: Some(name.to_owned()),
            running: None,
        }
    }
}

/// The input devices of the default host, by name.
pub struct CpalAudioDevices;

impl AudioDevices for CpalAudioDevices {
    fn list(&self) -> Vec<String> {
        let Ok(devices) = cpal::default_host().input_devices() else {
            return Vec::new();
        };
        let mut names: Vec<String> = Vec::new();
        for name in devices.map(|d| d.to_string()) {
            if !name.is_empty() && !names.contains(&name) {
                names.push(name);
            }
        }
        names
    }

    fn open(&self, name: &str) -> Box<dyn AudioSource> {
        Box::new(CpalAudioSource::named(name))
    }
}

/// Mono mix and linear resampling to [`SAMPLE_RATE`], keeping state across callbacks.
struct Converter {
    channels: usize,
    step: f64,
    pos: f64,
}

impl Converter {
    fn new(channels: u16, rate: u32) -> Self {
        Self {
            channels: usize::from(channels.max(1)),
            step: f64::from(rate) / f64::from(SAMPLE_RATE),
            pos: 0.0,
        }
    }

    fn convert<T>(&mut self, data: &[T]) -> Vec<f32>
    where
        T: Sample,
        f32: FromSample<T>,
    {
        let mono: Vec<f32> = data
            .chunks(self.channels)
            .map(|frame| {
                frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / frame.len() as f32
            })
            .collect();
        let mut out = Vec::with_capacity((mono.len() as f64 / self.step) as usize + 1);
        while self.pos < mono.len() as f64 {
            let i = self.pos.floor() as usize;
            let frac = (self.pos - i as f64) as f32;
            let a = mono[i];
            let b = mono.get(i + 1).copied().unwrap_or(a);
            out.push(a + (b - a) * frac);
            self.pos += self.step;
        }
        self.pos -= mono.len() as f64;
        out
    }
}

fn map_error(kind: ErrorKind) -> AudioError {
    match kind {
        ErrorKind::PermissionDenied | ErrorKind::DeviceBusy => AudioError::Blocked,
        ErrorKind::DeviceNotAvailable | ErrorKind::HostUnavailable => AudioError::NoMicrophone,
        _ => AudioError::Blocked,
    }
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    sink: AudioSink,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let mut conv = Converter::new(config.channels, config.sample_rate);
    let failed = sink.clone();
    device.build_input_stream::<T, _, _>(
        config,
        move |data: &[T], _| sink.push(&conv.convert(data)),
        move |err: cpal::Error| match err.kind() {
            // A rerouted default device keeps running; everything else ends the capture.
            ErrorKind::DeviceChanged | ErrorKind::Xrun => {}
            _ => failed.fail(AudioError::DeviceLost),
        },
        None,
    )
}

fn open(sink: AudioSink, name: Option<&str>) -> Result<cpal::Stream, AudioError> {
    let host = cpal::default_host();
    let device = match name {
        None => host.default_input_device(),
        Some(name) => host
            .input_devices()
            .map_err(|e| map_error(e.kind()))?
            .find(|d| d.to_string() == name),
    }
    .ok_or(AudioError::NoMicrophone)?;
    let supported = device
        .default_input_config()
        .map_err(|e| map_error(e.kind()))?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let stream = match format {
        SampleFormat::F32 => build::<f32>(&device, config, sink),
        SampleFormat::I16 => build::<i16>(&device, config, sink),
        SampleFormat::U16 => build::<u16>(&device, config, sink),
        SampleFormat::I32 => build::<i32>(&device, config, sink),
        SampleFormat::I8 => build::<i8>(&device, config, sink),
        SampleFormat::U8 => build::<u8>(&device, config, sink),
        _ => return Err(AudioError::Blocked),
    }
    .map_err(|e| map_error(e.kind()))?;
    stream.play().map_err(|e| map_error(e.kind()))?;
    Ok(stream)
}

impl AudioSource for CpalAudioSource {
    fn start(&mut self, sink: AudioSink) -> Result<(), AudioError> {
        self.stop();
        let (ready_tx, ready_rx) = mpsc::channel();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let name = self.device.clone();
        let handle = std::thread::spawn(move || match open(sink, name.as_deref()) {
            Ok(stream) => {
                let _ = ready_tx.send(Ok(()));
                // Holds the stream open until stop() (or the source is dropped).
                let _ = stop_rx.recv();
                drop(stream);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        });
        match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => {
                self.running = Some((stop_tx, handle));
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = handle.join();
                Err(e)
            }
            Err(_) => {
                drop(stop_tx);
                Err(AudioError::Blocked)
            }
        }
    }

    fn stop(&mut self) {
        if let Some((stop, handle)) = self.running.take() {
            let _ = stop.send(());
            let _ = handle.join();
        }
    }
}

impl Drop for CpalAudioSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converter_mixes_to_mono_and_resamples_to_16_khz() {
        let mut c = Converter::new(2, 48_000);
        // 100 ms of stereo at 48 kHz, left 0.5 and right -0.1 → mono 0.2.
        let data: Vec<f32> = (0..4_800).flat_map(|_| [0.5f32, -0.1]).collect();
        let out = c.convert(&data);
        assert_eq!(out.len(), 1_600);
        assert!(out[10..].iter().all(|s| (s - 0.2).abs() < 1e-5));
        // The next callback continues where the last one ended.
        assert_eq!(c.convert(&data).len(), 1_600);
    }

    #[test]
    fn converter_handles_integer_samples() {
        let mut c = Converter::new(1, 16_000);
        let out = c.convert(&[i16::MAX, 0, i16::MIN]);
        assert_eq!(out.len(), 3);
        assert!((out[0] - 1.0).abs() < 1e-3);
    }
}
