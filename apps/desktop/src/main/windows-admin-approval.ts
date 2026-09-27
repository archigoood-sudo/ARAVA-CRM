import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function encoded(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

// The proof is written below HKLM by an elevated process. A standard user can read it,
// but cannot create the unpredictable subkey under HKLM\SOFTWARE without UAC approval.
export async function approveWindowsAdministrator(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const nonce = randomBytes(32).toString('hex');
  const key = `HKLM:\\SOFTWARE\\ARAVA-Owner-Recovery-${nonce}`;
  const approvedAt = Math.floor(Date.now() / 1000);
  const elevated = [
    "$ErrorActionPreference = 'Stop'",
    '$identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
    '$principal = [Security.Principal.WindowsPrincipal]::new($identity)',
    'if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }',
    `New-Item -Path '${key}' -Force | Out-Null`,
    `New-ItemProperty -Path '${key}' -Name ApprovedAt -PropertyType QWord -Value ${String(approvedAt)} -Force | Out-Null`,
  ].join('; ');
  const outer = [
    "$ErrorActionPreference = 'Stop'",
    `$result = Start-Process -FilePath "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encoded(elevated)}') -Verb RunAs -Wait -PassThru`,
    'exit $result.ExitCode',
  ].join('; ');
  const powershell = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  try {
    await exec(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(outer)], {
      timeout: 120_000,
      windowsHide: true,
    });
    const read = `$value = (Get-ItemProperty -Path '${key}' -Name ApprovedAt -ErrorAction Stop).ApprovedAt; [Console]::Out.Write($value)`;
    const result = await exec(
      powershell,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(read)],
      { timeout: 10_000, windowsHide: true },
    );
    return Number(result.stdout.trim()) === approvedAt && Date.now() / 1000 - approvedAt < 180;
  } catch {
    return false;
  }
}
