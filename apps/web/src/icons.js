// Basit çizgi ikonlar (24×24, stroke = currentColor). Dış bağımlılık yok; salon ağı internetsiz çalışır.
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.5h11l2-8H6.3"/>',
  box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  ring: '<circle cx="12" cy="14.5" r="6.5"/><path d="m9 4.5 3-2 3 2-3 3.5z"/>',
  wallet: '<rect x="2.5" y="6" width="19" height="14" rx="2"/><path d="M2.5 10h19M16.5 15h2"/><path d="M5 6 16.5 2.5 18 6"/>',
  chart: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3" height="7"/><rect x="10.5" y="6" width="3" height="12"/><rect x="16" y="13.5" width="3" height="4.5"/>',
  menu: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 21V3c-2.2 0-3.5 2.5-3.5 6v4H17"/>',
  staff: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c.6-4 3.3-6.5 7-6.5s6.4 2.5 7 6.5"/><path d="m10.5 14.5 1.5 3 1.5-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  receipt: '<path d="M5 2.5h14v19l-2.5-1.5-2.5 1.5-2-1.5-2 1.5-2.5-1.5L5 21.5z"/><path d="M8.5 7.5h7M8.5 11.5h7M8.5 15.5h4"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5M4 13a8 8 0 0 0 14.3 4.6L20 15.5"/><path d="M4 3.5v5h5M20 20.5v-5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 16.5 14.5 12 10 7.5M14.5 12H4"/>',
  print: '<path d="M6.5 9V2.5h11V9"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M6.5 14h11v7.5h-11z"/>',
  whatsapp: '<path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.4-4.2a8.5 8.5 0 1 1 15.6-4.7z"/><path d="M8.8 8.3c.3 2.9 3.1 5.6 6 6l1.1-1.2-1.8-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-1.8z"/>',
  phone: '<path d="M5 3.5h3.5l1.5 4.5-2.2 1.3a11 11 0 0 0 5 5L14.1 12l4.4 1.5V17a2 2 0 0 1-2 2A13.5 13.5 0 0 1 3 5.5a2 2 0 0 1 2-2z"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  check: '<path d="m4.5 12.5 4.5 4.5L19.5 6.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 6.5h16M9 6.5V4h6v2.5M6.5 6.5 7.5 21h9l1-14.5"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8.5 12h7M8.5 16h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.6A3.8 3.8 0 0 1 17.5 18.5z"/>',
  doc: '<path d="M6 2.5h8l4.5 4.5V21.5H6z"/><path d="M14 2.5V7h4.5M9 12h6.5M9 15.5h6.5M9 19h4"/>',
};

export function icon(name, size = 18) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}
