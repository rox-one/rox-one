/**
 * Pure launchd builder — plist, 0600 env file and 0700 wrapper.
 *
 * Nothing here touches the filesystem or launchctl: given a definition the
 * builder returns the exact bytes a transactional install will publish. The
 * wrapper is the LaunchAgent's program: it verifies the 0600 environment file
 * against an embedded SHA-256 (exit 78 = sysexits EX_CONFIG when the file is
 * missing or tampered) and only then execs the real executable, so secrets never
 * live in the world-readable plist.
 */

import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { assertServiceLabel, ServiceOperationError } from './types.ts'

export const SERVICE_ENV_FILE_MODE = 0o600
export const SERVICE_WRAPPER_MODE = 0o700
export const SERVICE_PLIST_MODE = 0o600
export const SERVICE_EXIT_CONFIG = 78

export const SERVICE_ENV_FILE_NAME = 'service.env'
export const SERVICE_WRAPPER_FILE_NAME = 'service-wrapper.sh'

export const SERVICE_ENV_HEADER = '# ROX managed service environment (mode 0600). Generated; do not edit.\n'

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface LaunchAgentBuildInput {
  /** Reverse-DNS launchd label, e.g. `com.rox.service`. */
  readonly label: string
  /** Absolute path to the real executable the wrapper execs. */
  readonly executable: string
  readonly args?: readonly string[]
  /** Secret-bearing environment; written only to the 0600 file. */
  readonly environment?: Readonly<Record<string, string>>
  /** Host-owned 0700 directory holding the env file and wrapper. */
  readonly serviceDirectory: string
  /** Absolute path to `~/Library/LaunchAgents`. */
  readonly launchAgentsDirectory: string
  readonly workingDirectory: string
  readonly logDirectory: string
  readonly runAtLoad?: boolean
  readonly keepAlive?: boolean
  readonly throttleIntervalSeconds?: number
}

export interface BuiltServiceFile {
  readonly name: string
  readonly path: string
  readonly content: string
  readonly mode: number
}

export interface LaunchAgentFiles {
  readonly label: string
  readonly serviceDirectory: string
  readonly plistPath: string
  readonly plist: string
  readonly envFile: BuiltServiceFile
  readonly wrapper: BuiltServiceFile
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** POSIX single-quote a value so it survives `sh` sourcing verbatim. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function assertSafeText(value: string, field: string): void {
  if (value.includes('\u0000') || value.includes('\n') || value.includes('\r')) {
    throw new ServiceOperationError('INVALID_DEFINITION')
  }
  void field
}

function assertAbsolute(path: string): void {
  if (!isAbsolute(path) || path.includes('\u0000')) {
    throw new ServiceOperationError('INVALID_DEFINITION')
  }
}

/** Deterministic env file: ASCII-sorted keys, one quoted assignment per line. */
export function buildServiceEnvFile(environment: Readonly<Record<string, string>>): string {
  const lines = Object.keys(environment).sort().map(key => {
    if (!ENV_KEY_PATTERN.test(key)) throw new ServiceOperationError('INVALID_DEFINITION')
    const value = environment[key]!
    assertSafeText(value, key)
    return `${key}=${shellQuote(value)}`
  })
  return `${SERVICE_ENV_HEADER}${lines.map(line => `${line}\n`).join('')}`
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Wrapper body. `envSha256` is the digest of the exact env-file bytes; a
 * mismatch or a missing file exits 78 before any executable runs.
 */
export function buildServiceWrapper(input: {
  readonly envFilePath: string
  readonly envSha256: string
  readonly executable: string
  readonly args: readonly string[]
}): string {
  const exec = [input.executable, ...input.args].map(shellQuote).join(' ')
  return [
    '#!/bin/sh',
    '# ROX managed service wrapper (mode 0700). Generated; do not edit.',
    '# Verifies the companion environment file before exec; a missing or tampered',
    '# file exits 78 (EX_CONFIG) so launchd reports a real failure.',
    'set -eu',
    `ENV_FILE=${shellQuote(input.envFilePath)}`,
    `EXPECTED_SHA256=${shellQuote(input.envSha256)}`,
    'if [ ! -f "$ENV_FILE" ]; then',
    '  echo "rox-service: environment file missing" >&2',
    `  exit ${SERVICE_EXIT_CONFIG}`,
    'fi',
    'ACTUAL_SHA256=$(/usr/bin/shasum -a 256 "$ENV_FILE" | /usr/bin/awk \'{print $1}\')',
    'if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then',
    '  echo "rox-service: environment file integrity check failed" >&2',
    `  exit ${SERVICE_EXIT_CONFIG}`,
    'fi',
    'set -a',
    '. "$ENV_FILE"',
    'set +a',
    `exec ${exec}`,
    '',
  ].join('\n')
}

function plistString(value: string): string {
  return `  <string>${xmlEscape(value)}</string>`
}

/** Deterministic plist. Keys are emitted in a fixed order for byte-stable tests. */
export function buildLaunchAgentPlist(input: {
  readonly label: string
  readonly programArguments: readonly string[]
  readonly workingDirectory: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly runAtLoad: boolean
  readonly keepAlive: boolean
  readonly throttleIntervalSeconds: number
}): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    plistString(input.label),
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...input.programArguments.map(argument => `    <string>${xmlEscape(argument)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key>',
    input.runAtLoad ? '  <true/>' : '  <false/>',
    '  <key>KeepAlive</key>',
    input.keepAlive ? '  <true/>' : '  <false/>',
    '  <key>ThrottleInterval</key>',
    `  <integer>${input.throttleIntervalSeconds}</integer>`,
    '  <key>WorkingDirectory</key>',
    plistString(input.workingDirectory),
    '  <key>StandardOutPath</key>',
    plistString(input.stdoutPath),
    '  <key>StandardErrorPath</key>',
    plistString(input.stderrPath),
    '</dict>',
    '</plist>',
    '',
  ]
  return lines.join('\n')
}

/** Resolve every path and build the three artifacts as pure strings. */
export function buildLaunchAgentFiles(input: LaunchAgentBuildInput): LaunchAgentFiles {
  assertServiceLabel(input.label)
  assertAbsolute(input.executable)
  assertAbsolute(input.serviceDirectory)
  assertAbsolute(input.launchAgentsDirectory)
  assertAbsolute(input.workingDirectory)
  assertAbsolute(input.logDirectory)
  for (const argument of input.args ?? []) assertSafeText(argument, 'arg')

  const serviceDirectory = input.serviceDirectory
  const envPath = join(serviceDirectory, SERVICE_ENV_FILE_NAME)
  const wrapperPath = join(serviceDirectory, SERVICE_WRAPPER_FILE_NAME)
  const plistPath = join(input.launchAgentsDirectory, `${input.label}.plist`)

  const envContent = buildServiceEnvFile(input.environment ?? {})
  const wrapperContent = buildServiceWrapper({
    envFilePath: envPath,
    envSha256: sha256Hex(envContent),
    executable: input.executable,
    args: input.args ?? [],
  })
  const plist = buildLaunchAgentPlist({
    label: input.label,
    programArguments: [wrapperPath],
    workingDirectory: input.workingDirectory,
    stdoutPath: join(input.logDirectory, `${input.label}.out.log`),
    stderrPath: join(input.logDirectory, `${input.label}.err.log`),
    runAtLoad: input.runAtLoad ?? true,
    keepAlive: input.keepAlive ?? true,
    throttleIntervalSeconds: input.throttleIntervalSeconds ?? 10,
  })

  return {
    label: input.label,
    serviceDirectory,
    plistPath,
    plist,
    envFile: { name: SERVICE_ENV_FILE_NAME, path: envPath, content: envContent, mode: SERVICE_ENV_FILE_MODE },
    wrapper: { name: SERVICE_WRAPPER_FILE_NAME, path: wrapperPath, content: wrapperContent, mode: SERVICE_WRAPPER_MODE },
  }
}