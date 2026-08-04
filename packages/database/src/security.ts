import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { t } from '@arava/shared';
const KEY_LENGTH = 64;
const COST = 65_536;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 128 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: COST, maxmem: MAX_MEMORY, p: PARALLELIZATION, r: BLOCK_SIZE },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);

  return [
    'scrypt',
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELIZATION),
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, costValue, blockValue, parallelValue, saltValue, hashValue] =
    encodedHash.split('$');
  if (
    algorithm !== 'scrypt' ||
    !costValue ||
    !blockValue ||
    !parallelValue ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  const expected = Buffer.from(hashValue, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;

  try {
    if (
      Number(costValue) !== COST ||
      Number(blockValue) !== BLOCK_SIZE ||
      Number(parallelValue) !== PARALLELIZATION
    ) {
      return false;
    }
    const actual = await deriveKey(password, Buffer.from(saltValue, 'base64url'));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replaceAll(/\D/gu, '');
  if (digits.length < 5 || digits.length > 18) {
    throw new DomainError('VALIDATION', t('domain.validation.phone'));
  }
  return `+${digits}`;
}

export type DomainErrorCode =
  'AUTHENTICATION' | 'AUTHORIZATION' | 'CONFLICT' | 'NOT_FOUND' | 'VALIDATION';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'DomainError';
  }
}
