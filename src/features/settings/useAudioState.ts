import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAPTURE_OFF,
  MIC_TEST_OFF,
  listInputDevices,
  onCaptureState,
  onMicTest,
  recordingStatus,
  startMicTest,
  stopMicTest,
  type CaptureState,
  type MicTestState,
} from "../../lib/ipc";

/** How often the device list is asked again while the Audio section is open. */
export const DEVICE_REFRESH_MS = 4_000;

/** The core's capture state (REC chip, meter) for views that do not run the recording themselves. */
export function useCapture(): CaptureState {
  const [capture, setCapture] = useState<CaptureState>(CAPTURE_OFF);
  useEffect(() => {
    let cancelled = false;
    const stop = onCaptureState((s) => {
      if (!cancelled) setCapture(s);
    });
    void recordingStatus().then((s) => {
      if (!cancelled) setCapture(s);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return capture;
}

/** The connected input devices, asked again every few seconds while mounted. */
export function useInputDevices(): string[] | null {
  const [devices, setDevices] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void listInputDevices().then((d) => {
        if (!cancelled) setDevices(d);
      });
    load();
    const timer = setInterval(load, DEVICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return devices;
}

export interface MicTest {
  state: MicTestState;
  /** The test could not start, or the device failed during it. */
  busy: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/** "Test microphone": the core's test state; the test stops when the component unmounts. */
export function useMicTest(): MicTest {
  const [state, setState] = useState<MicTestState>(MIC_TEST_OFF);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const stop = onMicTest((s) => {
      if (cancelled) return;
      running.current = s.state === "running";
      setState(s);
    });
    return () => {
      cancelled = true;
      stop();
      // Leaving the section or the settings view ends a running test.
      if (running.current) void stopMicTest();
    };
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const s = await startMicTest();
      running.current = s.state === "running";
      setState(s);
    } catch (e) {
      const err = e as { kind: string; reason?: MicTestState["reason"] };
      setState({ ...MIC_TEST_OFF, state: "error", reason: err.reason ?? null });
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    running.current = false;
    await stopMicTest();
    setState(MIC_TEST_OFF);
  }, []);

  return { state, busy, start, stop };
}
