const TOKEN_KEY = 'dunyatek.token';
const USER_KEY = 'dunyatek.user';
const TERMINAL_KEY = 'dunyatek.terminal';

function storage(fn, fallback = null) {
  try {
    return fn(window.localStorage);
  } catch {
    return fallback;
  }
}

export const session = {
  get token() {
    return storage((s) => s.getItem(TOKEN_KEY));
  },
  get user() {
    return storage((s) => JSON.parse(s.getItem(USER_KEY) ?? 'null'));
  },
  get terminal() {
    return storage((s) => s.getItem(TERMINAL_KEY)) || 'KASA-1';
  },
  set terminal(v) {
    storage((s) => s.setItem(TERMINAL_KEY, v));
  },
  save(token, user) {
    storage((s) => {
      s.setItem(TOKEN_KEY, token);
      s.setItem(USER_KEY, JSON.stringify(user));
    });
  },
  clear() {
    storage((s) => {
      s.removeItem(TOKEN_KEY);
      s.removeItem(USER_KEY);
    });
  },
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`/api${path}`, window.location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(session.token ? { authorization: `Bearer ${session.token}` } : {}),
        'x-terminal': session.terminal,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Sunucuya ulaşılamıyor. Salon sunucusunun açık ve ağa bağlı olduğunu kontrol edin.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    session.clear();
    window.location.hash = '#/giris';
  }
  if (!res.ok) throw new ApiError(data.error ?? `Hata (${res.status})`, res.status);
  return data;
}
