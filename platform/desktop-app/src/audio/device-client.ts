import type {
  AudioDeviceKindWire,
  AudioDeviceTransportWire,
  AudioDeviceWire,
} from "../../electron/audio-ipc-contract.js";

/**
 * Real browsers negotiate a fixed hardware sample rate per `AudioContext`
 * (commonly 44100/48000Hz) rather than exposing a device's full
 * supported-rate list. `resample.ts` performs real resampling for any
 * target in this range, so this is an honest "what we can actually
 * deliver," not a fabricated hardware spec.
 */
const SUPPORTED_SAMPLE_RATES_HZ: readonly number[] = [
  8000, 16000, 22050, 24000, 32000, 44100, 48000,
];

function detectTransport(label: string): AudioDeviceTransportWire {
  const lower = label.toLowerCase();
  if (lower.includes("bluetooth")) return "bluetooth";
  if (lower.includes("usb")) return "usb";
  if (lower.includes("virtual") || lower.includes("cable")) return "virtual";
  return "builtin";
}

/**
 * `enumerateDevices()` only returns real device labels once permission has
 * been granted at least once in this session (a real, deliberate browser
 * privacy behavior) — before that, labels come back empty and we report a
 * placeholder name rather than fabricating one.
 */
export async function listAudioDevicesReal(): Promise<readonly AudioDeviceWire[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const result: AudioDeviceWire[] = [];
  let sawDefaultMic = false;
  let sawDefaultSpeaker = false;

  for (const d of devices) {
    if (d.kind !== "audioinput" && d.kind !== "audiooutput") continue;
    const kind: AudioDeviceKindWire = d.kind === "audioinput" ? "microphone" : "speaker";
    const isExplicitDefault = d.deviceId === "default" || d.deviceId === "communications";
    const isFirstOfKind = kind === "microphone" ? !sawDefaultMic : !sawDefaultSpeaker;
    const isDefault = isExplicitDefault || isFirstOfKind;
    if (kind === "microphone") sawDefaultMic = true;
    else sawDefaultSpeaker = true;

    result.push({
      id: d.deviceId || `${kind}-unlabeled-${result.length}`,
      name:
        d.label ||
        `${kind === "microphone" ? "Microphone" : "Speaker"} (grant permission to see its name)`,
      kind,
      transport: detectTransport(d.label),
      isDefault,
      supportedSampleRatesHz: SUPPORTED_SAMPLE_RATES_HZ,
    });
  }
  return result;
}

export async function hasAudioPermission(kind: AudioDeviceKindWire): Promise<boolean> {
  if (kind === "speaker") {
    // No browser exposes a standard Permissions API entry for audio output
    // as of this phase — output devices generally don't gate on explicit
    // user permission the way capture does. Real signal we do have: at
    // least one output device is actually enumerable.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some((d) => d.kind === "audiooutput");
    } catch {
      return false;
    }
  }
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state === "granted";
  } catch {
    // Some engines don't implement the "microphone" permission descriptor —
    // fall back to attempting a real, silent enumerateDevices()-label check.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some((d) => d.kind === "audioinput" && d.label !== "");
    } catch {
      return false;
    }
  }
}

/** Actually prompts the OS/browser permission dialog by opening (and immediately closing) the mic. */
export async function requestAudioPermissionReal(kind: AudioDeviceKindWire): Promise<boolean> {
  if (kind === "speaker") return hasAudioPermission("speaker");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}
