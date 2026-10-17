import { esc } from './services/format.js';

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer;
export function toast(message, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('<div id="toast" role="status" aria-live="polite"></div>');
    document.body.append(el);
  }
  el.className = `toast show ${kind}`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 2500);
}

export function errorToast(err) {
  toast(err?.message ?? String(err), 'error');
}

/** Basit modal. onSubmit(formData) bir Promise döndürebilir; hata olursa modal açık kalır. */
export function modal({ title, body, submitLabel = 'Kaydet', onSubmit, onCancel, wide = false }) {
  const el = h(`
    <div class="modal-backdrop">
      <form class="modal ${wide ? 'wide' : ''}" novalidate>
        <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Kapat">✕</button></header>
        <div class="modal-body">${body}</div>
        ${onSubmit ? `<footer><button type="button" class="btn ghost" data-close>Vazgeç</button><button class="btn primary" type="submit">${esc(submitLabel)}</button></footer>` : ''}
      </form>
    </div>`);
  const close = () => {
    el.remove();
    window.removeEventListener('hashchange', close);
  };
  window.addEventListener('hashchange', close);
  const cancel = () => {
    close();
    onCancel?.();
  };
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) cancel();
  });
  el.addEventListener('keydown', (e) => e.key === 'Escape' && cancel());
  const form = el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const ok = await onSubmit(new FormData(form), form);
      if (ok !== false) close();
    } catch (err) {
      errorToast(err);
    } finally {
      btn.disabled = false;
    }
  });
  document.body.append(el);
  form.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  return { el, form, close };
}

export function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`;
}
