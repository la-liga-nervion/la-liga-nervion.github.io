(() => {
  'use strict';

  const DATA_URL = 'clasificacion.csv';

  const state = { teams: [], table: [], selected: null };

  const els = {
    teamGrid: document.getElementById('team-grid'),
    body: document.getElementById('standings-body'),
    heroStatus: document.getElementById('hero-status'),
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Utilidades ---------- */

  const escapeHtml = str =>
    String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const normalizeHeader = h =>
    h.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const pick = (rec, ...names) => {
    for (const n of names) if (rec[n] !== undefined && rec[n] !== '') return rec[n];
    return '';
  };

  const toPoints = v => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // La diferencia de goles puede ser negativa: admite "-2", "+3" y el signo menos tipográfico
  const toGoalDiff = v => {
    const n = Number.parseInt(String(v).replace('\u2212', '-'), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const nameFromKey = key =>
    key.split(/[-_\s]+/).filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // Color propio si es un hexadecimal válido; si no, uno estable generado a partir de la clave
  function teamColor(key, value) {
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;
    let hash = 0;
    for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 55% 30%)`;
  }

  // Letras decorativas de la tarjeta: iniciales, o las 3 primeras letras si es una sola palabra
  function teamInitials(name) {
    const words = name.split(/\s+/).filter(w => !/^(el|la|los|las)$/i.test(w));
    const list = words.length ? words : name.split(/\s+/);
    const letters = list.length > 1
      ? list.slice(0, 3).map(w => w.charAt(0)).join('')
      : list[0].slice(0, 3);
    return letters.toUpperCase();
  }

  /* ---------- Lectura de datos ---------- */

  function parseRows(text) {
    text = text.replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    return rows.filter(r => r.some(cell => cell.trim() !== ''));
  }

  function toRecords(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(normalizeHeader);
    return rows.slice(1).map(r =>
      Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))
    );
  }

  // Cada fila con una clave nueva se convierte en un equipo
  function buildTeams(records) {
    const seen = new Set();
    const teams = [];
    records.forEach(rec => {
      const clave = pick(rec, 'clave', 'key', 'id').toLowerCase();
      if (!clave || seen.has(clave)) return;
      seen.add(clave);
      const nombre = pick(rec, 'nombre', 'equipo', 'name') || nameFromKey(clave);
      teams.push({
        clave,
        nombre,
        siglas: teamInitials(nombre),
        color: teamColor(clave, pick(rec, 'color')),
        pts: toPoints(pick(rec, 'pts', 'puntos')),
        dg: toGoalDiff(pick(rec, 'dg', 'diferencia', 'diferencia de goles')),
      });
    });
    return teams;
  }

  // Orden: 1.º puntos, 2.º diferencia de goles, 3.º orden alfabético
  function buildStandings(teams) {
    const table = teams.map(team => ({ team, pts: team.pts, dg: team.dg }));

    table.sort((x, y) =>
      y.pts - x.pts ||
      y.dg - x.dg ||
      x.team.nombre.localeCompare(y.team.nombre, 'es')
    );

    // Solo comparten puesto los equipos empatados en puntos Y en diferencia de goles
    table.forEach((row, i) => {
      const prev = table[i - 1];
      row.rank = prev && row.pts === prev.pts && row.dg === prev.dg ? prev.rank : i + 1;
    });

    return table;
  }

  /* ---------- Dibujo ---------- */

  // Mientras nadie tenga puntos, no hay clasificación: en vez de un "1" para todos se muestra un guion
  const notStarted = () => state.table.every(r => r.pts === 0);
  const rankLabel = row => (notStarted() ? '\u2013' : String(row.rank));

  // Solo hay líder destacado si un único equipo va primero y tiene puntos
  function soleLeader() {
    const leaders = state.table.filter(r => r.rank === 1);
    return leaders.length === 1 && leaders[0].pts > 0 ? leaders[0].team.clave : null;
  }

  function renderTeams() {
    const leaderKey = soleLeader();
    // Con un líder claro, las tarjetas siguen el orden de la clasificación
    const ordered = leaderKey ? state.table.map(r => r.team) : state.teams;

    els.teamGrid.innerHTML = ordered.map(team => {
      const row = state.table.find(r => r.team.clave === team.clave);
      const nombre = escapeHtml(team.nombre);
      const isLeader = team.clave === leaderKey;
      return `<li${isLeader ? ' class="is-leader"' : ''}>
        <button class="team-tile" type="button"
                data-clave="${escapeHtml(team.clave)}" data-siglas="${escapeHtml(team.siglas)}"
                style="--tile:${team.color}"
                aria-pressed="${state.selected === team.clave}"
                aria-label="${nombre}, ${notStarted() ? 'sin puesto todavía' : 'puesto ' + row.rank}, ${row.pts} puntos${isLeader ? ', líder de la liga' : ''}. Ver en la clasificación.">
          <span class="tile-name">${nombre}</span>
          <span class="tile-stats">
            <span>Puesto ${rankLabel(row)}</span>
            <span>${row.pts} ${row.pts === 1 ? 'punto' : 'puntos'}</span>
          </span>
        </button>
      </li>`;
    }).join('');
  }

  function renderTable() {
    if (!state.table.length) {
      els.body.innerHTML = '<tr><td colspan="4" class="loading">La clasificación no está disponible en este momento. Vuelve a intentarlo más tarde.</td></tr>';
      return;
    }
    const anyPoints = state.table.some(r => r.pts > 0);
    els.body.innerHTML = state.table.map(r => {
      const leader = anyPoints && r.rank === 1;
      const classes = [leader ? 'is-leader' : '', state.selected === r.team.clave ? 'is-focus' : '']
        .filter(Boolean).join(' ');
      return `<tr data-clave="${escapeHtml(r.team.clave)}" class="${classes}" style="--team:${r.team.color}">
        <td class="col-pos"><span class="rank">${rankLabel(r)}</span></td>
        <td class="col-team">${escapeHtml(r.team.nombre)}</td>
        <td class="col-dg">${r.dg > 0 ? '+' + r.dg : r.dg}</td>
        <td class="col-pts">${r.pts}</td>
      </tr>`;
    }).join('');
  }

  function renderHeroStatus() {
    if (!state.table.length) {
      els.heroStatus.hidden = true;
      return;
    }
    els.heroStatus.hidden = false;
    const leaders = state.table.filter(r => r.rank === 1);
    const pts = leaders[0].pts;
    if (pts === 0) {
      els.heroStatus.textContent = 'La liga aún no ha empezado: todos los equipos parten de cero.';
      return;
    }
    const puntos = pts === 1 ? 'punto' : 'puntos';
    const names = new Intl.ListFormat('es', { style: 'long', type: 'conjunction' })
      .format(leaders.map(l => l.team.nombre));

    els.heroStatus.textContent = leaders.length === 1
      ? `${names} lidera la liga con ${pts} ${puntos}.`
      : `${names} comparten el liderato con ${pts} ${puntos}.`;
  }

  function renderAll() {
    renderTeams();
    renderTable();
    renderHeroStatus();
  }

  /* ---------- Interacción ---------- */

  const rowFor = clave =>
    [...els.body.querySelectorAll('tr')].find(tr => tr.dataset.clave === clave);

  function syncSelection() {
    els.teamGrid.querySelectorAll('.team-tile').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.clave === state.selected));
    });
    els.body.querySelectorAll('tr').forEach(tr => {
      tr.classList.toggle('is-focus', tr.dataset.clave === state.selected);
    });
  }

  els.teamGrid.addEventListener('click', e => {
    const btn = e.target.closest('.team-tile');
    if (!btn) return;
    state.selected = state.selected === btn.dataset.clave ? null : btn.dataset.clave;
    syncSelection();
    const row = state.selected && rowFor(state.selected);
    if (row) row.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });

  /* ---------- Parallax de la portada ---------- */

  // Detecta el dispositivo, no el ancho de la ventana: así el parallax también se
  // desactiva en un móvil en horizontal o con "ver como ordenador" activado.
  //  - (hover: none) and (pointer: coarse): pantalla táctil como entrada principal.
  //    No cambia con el modo ordenador del navegador ni al girar el móvil.
  //  - userAgentData / userAgent: refuerzo para navegadores que lo informan.
  //  - iPad reciente: se identifica como Mac, pero tiene pantalla táctil.
  function isMobileDevice() {
    const touchPrimary = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const uaMobile = navigator.userAgentData?.mobile === true;
    const uaMatch = /Android|iPhone|iPad|iPod|Mobile|KaiOS/i.test(navigator.userAgent);
    const iPadAsMac = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    return touchPrimary || uaMobile || uaMatch || iPadAsMac;
  }

  // Las líneas del campo se mueven a un 30 % de la velocidad del scroll, solo en
  // ordenador y si la persona no ha pedido reducir el movimiento.
  const hero = document.querySelector('.hero');

  if (hero && !reduceMotion.matches && !isMobileDevice()) {
    let ticking = false;

    const updateParallax = () => {
      ticking = false;
      const y = Math.min(Math.max(window.scrollY, 0), hero.offsetHeight);
      hero.style.setProperty('--parallax', `${(y * 0.3).toFixed(1)}px`);
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateParallax);
      }
    }, { passive: true });

    updateParallax();
  }

  /* ---------- Arranque ---------- */

  async function init() {
    try {
      // no-store evita la caché del navegador; el parámetro con la hora evita
      // también las cachés intermedias (hosting, CDN) que ignoran esa orden.
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const teams = buildTeams(toRecords(parseRows(await res.text())));
      if (!teams.length) throw new Error('Sin datos');
      state.teams = teams;
      state.table = buildStandings(teams);
    } catch (err) {
      console.error('No se pudo cargar la clasificación:', err);
      state.teams = [];
      state.table = [];
    }
    renderAll();
  }

  init();
})();
