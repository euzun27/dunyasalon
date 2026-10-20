import { newId, nowIso, NotFoundError, optionalString, requireInt, requireString } from '@dunyatek/shared';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, publishRow } from '../database/outbox.ts';

export interface StaffRow {
  id: string;
  full_name: string;
  phone: string | null;
  title: string | null;
  daily_wage_kurus: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export function listStaff(db: DB, includeInactive = false) {
  const today = new Date().toISOString().slice(0, 10);
  return all<StaffRow & { upcoming_events: number; month_wage_kurus: number }>(
    db,
    `SELECT s.*,
            (SELECT COUNT(*) FROM event_staff es JOIN reservations r ON r.id = es.reservation_id
              WHERE es.staff_id = s.id AND es.deleted_at IS NULL AND r.status != 'iptal' AND r.event_date >= ?) AS upcoming_events,
            (SELECT COALESCE(SUM(es.wage_kurus), 0) FROM event_staff es JOIN reservations r ON r.id = es.reservation_id
              WHERE es.staff_id = s.id AND es.deleted_at IS NULL AND r.status != 'iptal' AND substr(r.event_date, 1, 7) = ?) AS month_wage_kurus
       FROM staff s ${includeInactive ? '' : 'WHERE s.active = 1'} ORDER BY s.full_name`,
    today,
    today.slice(0, 7),
  );
}

export function saveStaff(
  db: DB,
  id: string | null,
  input: { full_name: string; phone?: string | null; title?: string | null; daily_wage_kurus?: number; active?: boolean },
  userId: string | null,
): StaffRow {
  const s = {
    name: requireString(input.full_name, 'Ad soyad', 100),
    phone: optionalString(input.phone, 'Telefon', 30),
    title: optionalString(input.title, 'Görev', 60),
    wage: requireInt(input.daily_wage_kurus ?? 0, 'Yevmiye', { min: 0 }),
    active: input.active === false ? 0 : 1,
  };
  return tx(db, () => {
    const now = nowIso();
    if (id) {
      const res = run(db, 'UPDATE staff SET full_name = ?, phone = ?, title = ?, daily_wage_kurus = ?, active = ?, updated_at = ? WHERE id = ?',
        s.name, s.phone, s.title, s.wage, s.active, now, id);
      if (res.changes === 0) throw new NotFoundError('Personel bulunamadı');
    } else {
      id = newId();
      run(db, 'INSERT INTO staff (id, full_name, phone, title, daily_wage_kurus, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, s.name, s.phone, s.title, s.wage, s.active, now, now);
    }
    publishRow(db, 'staff', id);
    audit(db, userId, 'staff.save', 'staff', id);
    return one<StaffRow>(db, 'SELECT * FROM staff WHERE id = ?', id)!;
  });
}

export function staffSchedule(db: DB, staffId: string) {
  return all(
    db,
    `SELECT es.id, es.task, es.wage_kurus, r.id AS reservation_id, r.event_date, r.start_time, r.end_time, r.event_type,
            h.name AS hall_name, c.full_name AS customer_name
       FROM event_staff es JOIN reservations r ON r.id = es.reservation_id
       JOIN halls h ON h.id = r.hall_id JOIN customers c ON c.id = r.customer_id
      WHERE es.staff_id = ? AND es.deleted_at IS NULL AND r.status != 'iptal'
      ORDER BY r.event_date DESC LIMIT 100`,
    staffId,
  );
}
