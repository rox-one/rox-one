import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { AppConfig } from '../app/config.js';

const DOWNLOAD_TTL_MS = 10 * 60 * 1000;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MANAGED_UPLOAD_BYTES = 50 * 1024 * 1024;

interface ManagedUploadRecord {
  uploadRef: string;
  accountId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storedPath: string;
  createdAt: string;
  expiresAt: string;
}

export interface MediaDownloadRecord {
  downloadRef: string;
  accountId: string;
  peer: string;
  messageId: number;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;
  createdAt: string;
  expiresAt: string;
}

function storeRoot(config: AppConfig) {
  return join(dirname(config.sessionPath), 'managed-media');
}

function uploadRecordPath(config: AppConfig, uploadRef: string) {
  return join(storeRoot(config), 'uploads', `${uploadRef}.json`);
}

function downloadRecordPath(config: AppConfig, downloadRef: string) {
  return join(storeRoot(config), 'downloads', `${downloadRef}.json`);
}

function safeFileName(value: string) {
  const cleaned = basename(value).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 180);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'telegram-media';
}

function contentTypeForFile(fileName: string) {
  const extension = extname(fileName).toLowerCase();
  const known: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.mp4': 'video/mp4',
  };
  return known[extension] ?? 'application/octet-stream';
}

async function sha256File(path: string) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function stageManagedUpload(config: AppConfig, sourcePath: string) {
  const absoluteSource = resolve(sourcePath);
  const sourceStat = await stat(absoluteSource);
  if (!sourceStat.isFile()) {
    throw new Error('Managed upload source must be a regular file.');
  }
  if (sourceStat.size < 1 || sourceStat.size > MAX_MANAGED_UPLOAD_BYTES) {
    throw new Error(`Managed uploads must be between 1 byte and ${MAX_MANAGED_UPLOAD_BYTES} bytes.`);
  }

  const uploadRef = randomUUID();
  const fileName = safeFileName(absoluteSource);
  const uploadsDir = join(storeRoot(config), 'uploads');
  const storedPath = join(uploadsDir, `${uploadRef}${extname(fileName).toLowerCase()}`);
  await mkdir(uploadsDir, { recursive: true });
  await copyFile(absoluteSource, storedPath);
  const createdAt = new Date();
  const record: ManagedUploadRecord = {
    uploadRef,
    accountId: config.accountLabel,
    fileName,
    contentType: contentTypeForFile(fileName),
    sizeBytes: sourceStat.size,
    sha256: await sha256File(storedPath),
    storedPath,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + UPLOAD_TTL_MS).toISOString(),
  };
  await writeFile(uploadRecordPath(config, uploadRef), JSON.stringify(record, null, 2));
  return record;
}

export async function loadManagedUpload(config: AppConfig, uploadRef: string) {
  if (!/^[0-9a-f-]{36}$/i.test(uploadRef)) {
    throw new Error('Managed upload reference is invalid.');
  }
  const raw = await readFile(uploadRecordPath(config, uploadRef), 'utf8').catch(() => null);
  if (!raw) throw new Error('Managed upload reference was not found.');
  const record = JSON.parse(raw) as ManagedUploadRecord;
  if (record.accountId !== config.accountLabel) {
    throw new Error('Managed upload belongs to another Telegram account.');
  }
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    throw new Error('Managed upload reference has expired.');
  }
  const currentStat = await stat(record.storedPath);
  if (!currentStat.isFile() || currentStat.size !== record.sizeBytes) {
    throw new Error('Managed upload object changed after staging.');
  }
  const currentHash = await sha256File(record.storedPath);
  if (currentHash !== record.sha256) {
    throw new Error('Managed upload object failed its integrity check.');
  }
  return record;
}

export async function createMediaDownloadReference(
  config: AppConfig,
  input: Omit<MediaDownloadRecord, 'downloadRef' | 'accountId' | 'createdAt' | 'expiresAt'>,
) {
  const downloadRef = randomUUID();
  const createdAt = new Date();
  const record: MediaDownloadRecord = {
    ...input,
    fileName: safeFileName(input.fileName),
    downloadRef,
    accountId: config.accountLabel,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + DOWNLOAD_TTL_MS).toISOString(),
  };
  await mkdir(join(storeRoot(config), 'downloads'), { recursive: true });
  await writeFile(downloadRecordPath(config, downloadRef), JSON.stringify(record, null, 2));
  return record;
}

export async function loadMediaDownloadReference(config: AppConfig, downloadRef: string) {
  if (!/^[0-9a-f-]{36}$/i.test(downloadRef)) {
    throw new Error('Media download reference is invalid.');
  }
  const raw = await readFile(downloadRecordPath(config, downloadRef), 'utf8').catch(() => null);
  if (!raw) throw new Error('Media download reference was not found.');
  const record = JSON.parse(raw) as MediaDownloadRecord;
  if (record.accountId !== config.accountLabel) {
    throw new Error('Media download reference belongs to another Telegram account.');
  }
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    throw new Error('Media download reference has expired.');
  }
  return record;
}
