import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

/** What unmuteMicrophone changed: nothing means Windows did not have the microphone off. */
export type MicFix = 'unmuted' | 'raised'

// Electron has no API for the system microphone, so this talks to Windows Core Audio through
// PowerShell. Both the console and the communications default device, as Chromium may use either.
const SCRIPT = (change: boolean): string => `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float l, ref Guid g); int SetMasterVolumeLevelScalar(float l, ref Guid g);
  int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint c, float l, ref Guid g); int SetChannelVolumeLevelScalar(uint c, float l, ref Guid g);
  int GetChannelVolumeLevel(uint c, out float l); int GetChannelVolumeLevelScalar(uint c, out float l);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int mask, out IntPtr list);
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
public static class MarginaliaMic {
  public static string Fix(bool change) {
    var found = "";
    var devices = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    foreach (var role in new[] { 0, 2 }) {
      IMMDevice device;
      if (devices.GetDefaultAudioEndpoint(1, role, out device) != 0) continue;
      var iid = typeof(IAudioEndpointVolume).GUID;
      object o;
      Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out o));
      var volume = (IAudioEndpointVolume)o;
      var none = Guid.Empty;
      bool muted; float level;
      volume.GetMute(out muted);
      volume.GetMasterVolumeLevelScalar(out level);
      if (muted) { found += " unmuted"; if (change) volume.SetMute(false, ref none); }
      if (level < 0.05f) { found += " raised"; if (change) volume.SetMasterVolumeLevelScalar(0.8f, ref none); }
    }
    return found;
  }
}
'@
[MarginaliaMic]::Fix($${change ? 'true' : 'false'})
`

/**
 * Turns the default microphone back on when Windows has it muted or at (almost) zero volume.
 * With `change` false it only reports what it would do.
 */
export async function fixMicrophone(change = true): Promise<MicFix[]> {
  const encoded = Buffer.from(SCRIPT(change), 'utf16le').toString('base64')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, timeout: 20_000 }
  )
  return [...new Set(stdout.trim().split(/\s+/).filter(Boolean))] as MicFix[]
}
