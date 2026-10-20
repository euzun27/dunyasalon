export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export function requireString(v: unknown, field: string, max = 500): string {
  if (typeof v !== 'string' || v.trim() === '') throw new ValidationError(`${field} zorunludur`);
  if (v.length > max) throw new ValidationError(`${field} en fazla ${max} karakter olabilir`);
  return v.trim();
}

export function optionalString(v: unknown, field: string, max = 500): string | null {
  if (v === undefined || v === null || v === '') return null;
  return requireString(v, field, max);
}

export function requireInt(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new ValidationError(`${field} tamsayı olmalıdır`);
  if (opts.min !== undefined && v < opts.min) throw new ValidationError(`${field} en az ${opts.min} olmalıdır`);
  if (opts.max !== undefined && v > opts.max) throw new ValidationError(`${field} en fazla ${opts.max} olabilir`);
  return v;
}

export function requireDate(v: unknown, field: string): string {
  const s = requireString(v, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new ValidationError(`${field} YYYY-AA-GG biçiminde olmalıdır`);
  }
  return s;
}

export function requireTime(v: unknown, field: string): string {
  const s = requireString(v, field, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new ValidationError(`${field} SS:DD biçiminde olmalıdır`);
  return s;
}
