import { newId, nowIso, NotFoundError, ValidationError, optionalString, requireInt, requireString } from '@dunyatek/shared';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, publishRow } from '../database/outbox.ts';

export interface ServiceRow {
  id: string;
  name: string;
  kind: 'menu' | 'hizmet' | 'paket';
  pricing: 'sabit' | 'kisi_basi';
  price_kurus: number;
  description: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceInput {
  name: string;
  kind: ServiceRow['kind'];
  pricing: ServiceRow['pricing'];
  price_kurus: number;
  description?: string | null;
  active?: boolean;
}

function normalize(input: ServiceInput) {
  if (!['menu', 'hizmet', 'paket'].includes(input.kind)) throw new ValidationError('Geçersiz tür');
  if (!['sabit', 'kisi_basi'].includes(input.pricing)) throw new ValidationError('Geçersiz fiyatlandırma');
  return {
    name: requireString(input.name, 'Ad', 120),
    kind: input.kind,
    pricing: input.pricing,
    price_kurus: requireInt(input.price_kurus, 'Fiyat', { min: 0 }),
    description: optionalString(input.description, 'Açıklama', 1000),
    active: input.active === false ? 0 : 1,
  };
}

export function listServices(db: DB, includeInactive = false): ServiceRow[] {
  return all<ServiceRow>(
    db,
    `SELECT * FROM services ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY CASE kind WHEN 'paket' THEN 0 WHEN 'menu' THEN 1 ELSE 2 END, name`,
  );
}

export function saveService(db: DB, id: string | null, input: ServiceInput, userId: string | null): ServiceRow {
  const s = normalize(input);
  return tx(db, () => {
    const now = nowIso();
    if (id) {
      const res = run(
        db,
        'UPDATE services SET name = ?, kind = ?, pricing = ?, price_kurus = ?, description = ?, active = ?, updated_at = ? WHERE id = ?',
        s.name, s.kind, s.pricing, s.price_kurus, s.description, s.active, now, id,
      );
      if (res.changes === 0) throw new NotFoundError('Hizmet bulunamadı');
    } else {
      id = newId();
      run(
        db,
        'INSERT INTO services (id, name, kind, pricing, price_kurus, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, s.name, s.kind, s.pricing, s.price_kurus, s.description, s.active, now, now,
      );
    }
    publishRow(db, 'services', id);
    audit(db, userId, 'service.save', 'service', id);
    return one<ServiceRow>(db, 'SELECT * FROM services WHERE id = ?', id)!;
  });
}
