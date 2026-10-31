//! The input devices there are, behind [`AudioDevices`], and a source for one chosen by name.
//! Real: [`super::cpal_source::CpalAudioDevices`]; fake: [`FakeAudioDevices`].
//!
//! Devices are matched by name: `cpal` has no device id that is stable on every OS, so two identical
//! devices with the same name cannot be told apart. Names can be personal ("Jan's AirPods"); they
//! are never logged.

use std::sync::{Arc, Mutex};

use super::audio::{AudioSource, FakeAudioSource, FakeCounters, Pace, Tone};

pub trait AudioDevices: Send + Sync {
    /// Names of the connected input devices, without duplicates, in the order the OS gives them.
    fn list(&self) -> Vec<String>;
    /// A source for the device `name`. Starting it fails with `NoMicrophone` if the device is gone.
    fn open(&self, name: &str) -> Box<dyn AudioSource>;
}

/// No named devices: only the system default is used.
pub struct NoAudioDevices;

impl AudioDevices for NoAudioDevices {
    fn list(&self) -> Vec<String> {
        Vec::new()
    }

    fn open(&self, _name: &str) -> Box<dyn AudioSource> {
        Box::new(
            FakeAudioSource::new(Vec::new(), Pace::Fast)
                .failing_start(super::audio::AudioError::NoMicrophone),
        )
    }
}

type MakeSource = Box<dyn Fn(&str) -> FakeAudioSource + Send + Sync>;

/// Pretend devices for tests and `MEETING_COMPANION_AUDIO=fake`. Records which device was opened;
/// a device can be unplugged, and its running source then fails like a pulled USB cable.
pub struct FakeAudioDevices {
    names: Mutex<Vec<String>>,
    opened: Mutex<Vec<String>>,
    make: MakeSource,
    counters: Arc<FakeCounters>,
}

impl FakeAudioDevices {
    /// Devices that each play `make(name)`.
    pub fn new(
        names: &[&str],
        make: impl Fn(&str) -> FakeAudioSource + Send + Sync + 'static,
    ) -> Self {
        Self {
            names: Mutex::new(names.iter().map(|n| (*n).to_owned()).collect()),
            opened: Mutex::new(Vec::new()),
            make: Box::new(make),
            counters: Arc::new(FakeCounters::default()),
        }
    }

    /// The demo devices of `MEETING_COMPANION_AUDIO=fake`: each plays the demo tones.
    pub fn demo() -> Self {
        Self::new(
            &["Built-in Audio Analog Stereo", "USB Conference Microphone"],
            |_| FakeAudioSource::demo(),
        )
    }

    /// Devices playing speech then silence, at real-time pace.
    pub fn talking(names: &[&str]) -> Self {
        Self::new(names, |_| {
            FakeAudioSource::new(
                vec![Tone::speech(1_000), Tone::silence(500)],
                Pace::RealTime,
            )
            .repeating()
        })
    }

    /// Start and stop counts of every source opened through these devices.
    pub fn counters(&self) -> Arc<FakeCounters> {
        self.counters.clone()
    }

    /// Names of the devices opened, in order.
    pub fn opened(&self) -> Vec<String> {
        self.opened
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn set_connected(&self, names: &[&str]) {
        *self.names.lock().unwrap_or_else(|e| e.into_inner()) =
            names.iter().map(|n| (*n).to_owned()).collect();
    }
}

impl AudioDevices for FakeAudioDevices {
    fn list(&self) -> Vec<String> {
        self.names.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn open(&self, name: &str) -> Box<dyn AudioSource> {
        self.opened
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(name.to_owned());
        let source = (self.make)(name).with_counters(self.counters.clone());
        if self.list().iter().any(|n| n == name) {
            Box::new(source)
        } else {
            Box::new(source.failing_start(super::audio::AudioError::NoMicrophone))
        }
    }
}

impl<T: AudioDevices + ?Sized> AudioDevices for Arc<T> {
    fn list(&self) -> Vec<String> {
        (**self).list()
    }
    fn open(&self, name: &str) -> Box<dyn AudioSource> {
        (**self).open(name)
    }
}
