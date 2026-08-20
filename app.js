/* ══════════════════════════════════════════════════════════════════
   Cuenta Atrás — temporizadores persistentes en localStorage
   ══════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const STORAGE_KEY = 'countdown.timers.v1';
  const RING_LENGTH = 2 * Math.PI * 110; // radio del <circle> del SVG

  /* ── Estado ─────────────────────────────────────────────────────── */
  let timers = load();
  let activeId = null;          // temporizador cargado en el escenario
  let phase = 'idle';           // idle | running | paused | finished
  let totalMs = 0;              // duración completa del temporizador activo
  let remainingMs = 0;          // tiempo restante (fuente de verdad en pausa)
  let deadline = 0;             // instante de finalización (fuente de verdad en marcha)
  let ticker = null;
  let toastTimer = null;

  /* ── Referencias al DOM ─────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const el = {
    list: $('timer-list'), empty: $('empty-state'), count: $('count'),
    name: $('active-name'), desc: $('active-desc'),
    display: $('display'), badge: $('state-badge'), ring: $('ring-progress'),
    start: $('btn-start'), pause: $('btn-pause'), cont: $('btn-continue'), stop: $('btn-stop'),
    newBtn: $('btn-new'),
    modal: $('modal'), form: $('timer-form'), modalTitle: $('modal-title'), formError: $('form-error'),
    fId: $('f-id'), fName: $('f-name'), fDesc: $('f-desc'), fH: $('f-h'), fM: $('f-m'), fS: $('f-s'),
    toast: $('toast'),
  };

  /* ── Persistencia ───────────────────────────────────────────────── */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data.filter(isValidTimer) : [];
    } catch (err) {
      console.warn('No se pudo leer localStorage:', err);
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
    } catch (err) {
      console.warn('No se pudo escribir en localStorage:', err);
      toast('⚠️ No se han podido guardar los cambios');
    }
  }

  function isValidTimer(t) {
    return t && typeof t === 'object' && typeof t.id === 'string' &&
           [t.hours, t.minutes, t.seconds].every((n) => Number.isFinite(n));
  }

  const newId = () =>
    (crypto.randomUUID ? crypto.randomUUID() : `t_${Date.now()}_${Math.random().toString(16).slice(2)}`);

  /* ── Utilidades de tiempo ───────────────────────────────────────── */
  const durationOf = (t) => ((t.hours * 60 + t.minutes) * 60 + t.seconds) * 1000;

  function format(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  }

  /* ── Lista de temporizadores ────────────────────────────────────── */
  function renderList() {
    el.list.textContent = '';
    el.count.textContent = timers.length;
    el.empty.hidden = timers.length > 0;

    for (const t of timers) {
      const li = document.createElement('li');
      li.className = 'timer-card' + (t.id === activeId ? ' is-active' : '');

      const top = document.createElement('div');
      top.className = 'timer-card-top';

      const name = document.createElement('span');
      name.className = 'timer-name';
      name.textContent = t.name;

      const time = document.createElement('span');
      time.className = 'timer-time';
      time.textContent = format(durationOf(t));

      top.append(name, time);
      li.append(top);

      if (t.description) {
        const desc = document.createElement('p');
        desc.className = 'timer-desc';
        desc.textContent = t.description;
        li.append(desc);
      }

      const actions = document.createElement('div');
      actions.className = 'timer-actions';
      actions.append(
        action('▶ Lanzar', 'btn-start',  () => launch(t.id)),
        action('✎ Editar', 'btn-ghost',  () => openModal(t.id)),
        action('🗑 Borrar', 'btn-stop',   () => remove(t.id)),
      );
      li.append(actions);

      // Al pulsar la tarjeta (fuera de los botones) se carga sin arrancar.
      li.addEventListener('click', (e) => { if (!e.target.closest('button')) select(t.id); });

      el.list.append(li);
    }
  }

  function action(label, variant, onClick) {
    const b = document.createElement('button');
    b.className = `btn btn-sm ${variant}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  /* ── Escenario / cuenta atrás ───────────────────────────────────── */
  function render() {
    const t = timers.find((x) => x.id === activeId);

    el.name.textContent = t ? t.name : 'Sin temporizador';
    el.desc.textContent = t
      ? (t.description || 'Sin descripción')
      : 'Selecciona o crea un temporizador para empezar.';

    el.display.textContent = format(remainingMs);
    el.display.classList.toggle('is-finished', phase === 'finished');

    const labels = { idle: 'Detenido', running: 'En marcha', paused: 'En pausa', finished: '¡Tiempo!' };
    el.badge.textContent = labels[phase];
    el.badge.className = `badge badge-${phase}`;

    // Anillo de progreso: se vacía a medida que avanza la cuenta atrás.
    const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
    el.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - ratio));
    el.ring.classList.toggle('is-warning', phase !== 'idle' && ratio <= 0.25 && ratio > 0.1);
    el.ring.classList.toggle('is-danger',  phase === 'finished' || (phase !== 'idle' && ratio <= 0.1));

    el.start.disabled = !t || phase === 'running' || phase === 'paused';
    el.pause.disabled = phase !== 'running';
    el.cont.disabled  = phase !== 'paused';
    el.stop.disabled  = phase === 'idle';

    document.title = phase === 'running' || phase === 'paused'
      ? `${format(remainingMs)} · ${t.name}`
      : 'Cuenta Atrás';
  }

  function select(id) {
    stop();                                     // el escenario solo aloja un temporizador
    const t = timers.find((x) => x.id === id);
    if (!t) return;
    activeId = id;
    totalMs = durationOf(t);
    remainingMs = totalMs;
    phase = 'idle';
    renderList();
    render();
  }

  function start() {
    const t = timers.find((x) => x.id === activeId);
    if (!t) return;
    totalMs = durationOf(t);
    if (totalMs <= 0) return toast('⚠️ La duración debe ser mayor que 00:00:00');
    remainingMs = totalMs;
    deadline = Date.now() + remainingMs;
    phase = 'running';
    startTicker();
    render();
  }

  function pause() {
    if (phase !== 'running') return;
    remainingMs = Math.max(0, deadline - Date.now());
    phase = 'paused';
    stopTicker();
    render();
  }

  function resume() {
    if (phase !== 'paused') return;
    deadline = Date.now() + remainingMs;
    phase = 'running';
    startTicker();
    render();
  }

  function stop() {
    stopTicker();
    phase = 'idle';
    remainingMs = totalMs;
    render();
  }

  function launch(id) {
    select(id);
    start();
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(tick, 100);
  }

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  function tick() {
    remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      remainingMs = 0;
      phase = 'finished';
      stopTicker();
      alarm();
      const t = timers.find((x) => x.id === activeId);
      toast(`⏰ ¡Tiempo! — ${t ? t.name : ''}`, 6000);
      notify(t);
    }
    render();
  }

  /* ── Aviso sonoro y notificación ────────────────────────────────── */
  function alarm() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [0, 0.45, 0.9].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const at = ctx.currentTime + offset;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.4);
      });
      setTimeout(() => ctx.close(), 2000);
    } catch (err) {
      console.warn('Sin audio disponible:', err);
    }
  }

  function notify(t) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification('⏰ ¡Tiempo!', { body: t ? `${t.name}${t.description ? ' — ' + t.description : ''}` : '' });
  }

  /* ── Alta / edición ─────────────────────────────────────────────── */
  function openModal(id) {
    const t = id ? timers.find((x) => x.id === id) : null;
    el.modalTitle.textContent = t ? 'Editar temporizador' : 'Nuevo temporizador';
    el.formError.hidden = true;
    el.fId.value   = t ? t.id : '';
    el.fName.value = t ? t.name : '';
    el.fDesc.value = t ? t.description : '';
    el.fH.value    = t ? t.hours : 0;
    el.fM.value    = t ? t.minutes : 5;
    el.fS.value    = t ? t.seconds : 0;
    el.modal.hidden = false;
    el.fName.focus();
    el.fName.select();
  }

  function closeModal() {
    el.modal.hidden = true;
  }

  function clamp(value, max) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
  }

  function submit(event) {
    event.preventDefault();

    const name = el.fName.value.trim();
    const hours = clamp(el.fH.value, 99);
    const minutes = clamp(el.fM.value, 59);
    const seconds = clamp(el.fS.value, 59);

    if (!name) return showError('Escribe un nombre para el temporizador.');
    if (hours + minutes + seconds === 0) return showError('La duración debe ser mayor que 00:00:00.');

    const data = { name, description: el.fDesc.value.trim(), hours, minutes, seconds };
    const id = el.fId.value;

    if (id) {
      const t = timers.find((x) => x.id === id);
      if (!t) return showError('El temporizador ya no existe.');
      Object.assign(t, data);
      // Si se edita el que está en el escenario, se recarga con la nueva duración.
      if (id === activeId) select(id);
      toast('✔ Temporizador actualizado');
    } else {
      const created = { id: newId(), ...data, createdAt: new Date().toISOString() };
      timers.push(created);
      if (!activeId) select(created.id);
      toast('✔ Temporizador creado');
    }

    save();
    renderList();
    render();
    closeModal();
  }

  function showError(message) {
    el.formError.textContent = message;
    el.formError.hidden = false;
  }

  function remove(id) {
    const t = timers.find((x) => x.id === id);
    if (!t || !confirm(`¿Borrar el temporizador "${t.name}"?`)) return;

    timers = timers.filter((x) => x.id !== id);
    save();

    if (id === activeId) {
      stopTicker();
      activeId = null;
      phase = 'idle';
      totalMs = 0;
      remainingMs = 0;
    }
    renderList();
    render();
    toast('🗑 Temporizador borrado');
  }

  /* ── Toast ──────────────────────────────────────────────────────── */
  function toast(message, ms = 2600) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  /* ── Eventos ────────────────────────────────────────────────────── */
  el.newBtn.addEventListener('click', () => openModal(null));
  el.start.addEventListener('click', start);
  el.pause.addEventListener('click', pause);
  el.cont.addEventListener('click', resume);
  el.stop.addEventListener('click', stop);
  el.form.addEventListener('submit', submit);
  el.modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.hidden) closeModal();
  });

  // El intervalo se ralentiza en pestañas en segundo plano: al volver, se recalcula.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && phase === 'running') tick(); });

  // Sincroniza la lista si se edita desde otra pestaña.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    timers = load();
    if (activeId && !timers.some((t) => t.id === activeId)) { activeId = null; stop(); }
    renderList();
    render();
  });

  /* ── Arranque ───────────────────────────────────────────────────── */
  if ('Notification' in window && Notification.permission === 'default') {
    el.newBtn.addEventListener('click', () => Notification.requestPermission(), { once: true });
  }

  if (timers.length === 0) {
    timers = [
      { id: newId(), name: 'Café',        description: 'Tiempo de infusión para una cafetera de émbolo.', hours: 0, minutes: 4, seconds: 0, createdAt: new Date().toISOString() },
      { id: newId(), name: 'Pomodoro',    description: 'Bloque de trabajo concentrado sin interrupciones.', hours: 0, minutes: 25, seconds: 0, createdAt: new Date().toISOString() },
      { id: newId(), name: 'Descanso',    description: 'Pausa corta entre bloques de trabajo.',           hours: 0, minutes: 5, seconds: 0, createdAt: new Date().toISOString() },
    ];
    save();
  }

  if (timers.length) select(timers[0].id);
  renderList();
  render();
})();
