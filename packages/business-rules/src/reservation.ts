import type { ReservationStatus } from '@dunyatek/shared';

/** Salonu bloke eden durumlar. "talep" yalnızca ön kayıttır, takvimi kilitlemez. */
export const BLOCKING_STATUSES: ReservationStatus[] = ['opsiyon', 'kesin'];

export interface TimeSlot {
  event_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string; // HH:MM; başlangıçtan küçük/eşitse ertesi gün biter (ör. 19:00-01:00)
}

export function slotToInterval(slot: TimeSlot): [number, number] {
  const start = Date.parse(`${slot.event_date}T${slot.start_time}:00Z`);
  let end = Date.parse(`${slot.event_date}T${slot.end_time}:00Z`);
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return [start, end];
}

/**
 * İki etkinlik aynı salonda çakışıyor mu?
 * bufferMinutes: etkinlikler arası temizlik/hazırlık payı.
 */
export function slotsOverlap(a: TimeSlot, b: TimeSlot, bufferMinutes = 0): boolean {
  const [as, ae] = slotToInterval(a);
  const [bs, be] = slotToInterval(b);
  const buf = bufferMinutes * 60 * 1000;
  return as < be + buf && bs < ae + buf;
}

/** Çakışma kontrolü için bakılması gereken tarihler (gece yarısını aşan etkinlikler). */
export function neighbourDates(date: string): string[] {
  const d = Date.parse(`${date}T00:00:00Z`);
  const day = 24 * 60 * 60 * 1000;
  return [d - day, d, d + day].map((t) => new Date(t).toISOString().slice(0, 10));
}

export function findConflicts<T extends TimeSlot & { id: string; status: ReservationStatus }>(
  candidate: TimeSlot & { id?: string },
  existing: T[],
  bufferMinutes = 0,
): T[] {
  return existing.filter(
    (r) => r.id !== candidate.id && BLOCKING_STATUSES.includes(r.status) && slotsOverlap(candidate, r, bufferMinutes),
  );
}
