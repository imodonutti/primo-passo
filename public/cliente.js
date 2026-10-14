(() => {
  const id = location.pathname.split('/').pop();
  const API = `/api/s/${encodeURIComponent(id)}`;
  const $ = (s) => document.querySelector(s);
  const chat = $('#chat');
  const testo = $('#testo');
  const modulo = $('#modulo');
  const invia = $('#invia');
  const fileInput = $('#file');
  let occupato = false;
  let tipoFileRichiesto = 'documento';

  function formatta(t) {
    const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .split(/\n{2,}/)
      .map((p) => `<p>${p}</p>`)
      .join('');
  }

  function scorri() {
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  }

  function aggiungiMessaggio(chi, t) {
    const d = document.createElement('div');
    d.className = `msg ${chi}`;
    d.innerHTML = formatta(t);
    chat.appendChild(d);
    scorri();
  }

  function aggiungiNota(classe, t) {
    const d = document.createElement('div');
    d.className = classe;
    d.textContent = t;
    chat.appendChild(d);
    scorri();
  }

  function rimuoviInterattivi() {
    chat.querySelectorAll('[data-interattivo]').forEach((n) => n.remove());
  }

  function mostraStili(stili) {
    rimuoviInterattivi();
    const g = document.createElement('div');
    g.className = 'stili';
    g.dataset.interattivo = '';
    for (const s of stili) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stile';
      b.innerHTML = `
        <div class="anteprima" style="background:${s.sfondo};color:${s.testo}">
          <div class="nav"><i style="background:${s.testo}"></i><i style="background:${s.testo}"></i><i style="background:${s.testo}"></i></div>
          <div class="tit ${s.titoli === 'serif' ? 'serif' : ''}">La tua attività,<br>in primo piano</div>
          <div class="riga" style="background:${s.testo};width:80%"></div>
          <div class="riga" style="background:${s.testo};width:60%"></div>
          <div class="bottone" style="background:${s.accento};color:${s.sfondo}">Contattaci</div>
        </div>
        <div class="info"><strong></strong><span></span></div>`;
      b.querySelector('strong').textContent = s.id;
      b.querySelector('span').textContent = s.descrizione;
      b.addEventListener('click', () => {
        rimuoviInterattivi();
        manda(`Scelgo la direzione "${s.id}".`);
      });
      g.appendChild(b);
    }
    chat.appendChild(g);
    scorri();
  }

  function mostraUpload(tipo) {
    rimuoviInterattivi();
    tipoFileRichiesto = tipo;
    const d = document.createElement('div');
    d.className = 'riquadro';
    d.dataset.interattivo = '';
    const nomi = { logo: 'il logo', foto: 'le foto', documento: 'il documento' };
    d.innerHTML = `<button class="btn" type="button">Carica ${nomi[tipo] || 'un file'}</button>
      <span style="font-size:14px;color:var(--inchiostro-2)">PNG, JPG, WEBP, SVG o PDF, fino a 10 MB</span>
      <button class="btn secondario" type="button">Non ce l'ho</button>`;
    const [carica, salta] = d.querySelectorAll('button');
    carica.addEventListener('click', () => fileInput.click());
    salta.addEventListener('click', () => {
      rimuoviInterattivi();
      manda(tipo === 'logo' ? 'Non ho un logo da caricare.' : 'Non ho file da caricare per ora.');
    });
    chat.appendChild(d);
    scorri();
  }

  function mostraRiepilogo(riepilogo) {
    rimuoviInterattivi();
    const d = document.createElement('div');
    d.className = 'riquadro riepilogo';
    d.dataset.interattivo = '';
    d.innerHTML = `<h2>Ecco il riepilogo</h2><div class="testo"></div>
      <div class="azioni"><button class="btn" type="button">Confermo e invio</button>
      <button class="btn secondario" type="button">Voglio cambiare qualcosa</button></div>`;
    d.querySelector('.testo').textContent = riepilogo;
    const [ok, cambia] = d.querySelectorAll('button');
    ok.addEventListener('click', conferma);
    cambia.addEventListener('click', () => { rimuoviInterattivi(); testo.focus(); testo.placeholder = 'Dimmi cosa vuoi cambiare…'; });
    chat.appendChild(d);
    scorri();
  }

  function mostraUi(ui) {
    if (!ui) return;
    if (ui.tipo === 'stili') mostraStili(ui.stili || window.__stili || []);
    if (ui.tipo === 'upload') mostraUpload(ui.tipoFile);
    if (ui.tipo === 'riepilogo') mostraRiepilogo(ui.riepilogo);
  }

  function aggiornaAvanzamento(d) {
    $('#barra').style.width = `${d.percentuale || 0}%`;
    const tappe = $('#tappe');
    tappe.innerHTML = '';
    for (const s of d.sezioni || []) {
      const t = document.createElement('span');
      t.className = `tappa${s.completa ? ' fatta' : ''}`;
      t.textContent = s.titolo;
      tappe.appendChild(t);
    }
    if (d.stato === 'confermato') {
      $('#composer').classList.add('nascosto');
      chat.style.paddingBottom = '40px';
    }
  }

  function inScrittura(on) {
    let n = chat.querySelector('.scrive');
    if (on && !n) {
      n = document.createElement('div');
      n.className = 'scrive';
      n.innerHTML = '<i></i><i></i><i></i>';
      chat.appendChild(n);
      scorri();
    } else if (!on && n) n.remove();
  }

  function blocca(on) {
    occupato = on;
    invia.disabled = on;
    inScrittura(on);
  }

  async function manda(t) {
    if (occupato || !t.trim()) return;
    rimuoviInterattivi();
    aggiungiMessaggio('cliente', t);
    blocca(true);
    try {
      const r = await fetch(`${API}/messaggio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: t }) });
      const d = await r.json();
      blocca(false);
      if (!r.ok) return aggiungiNota('msg errore', d.errore || 'Qualcosa non ha funzionato.');
      let ui = null;
      for (const e of d.eventi) {
        if (e.tipo === 'messaggio') aggiungiMessaggio('assistente', e.testo);
        else if (e.tipo === 'attivita') aggiungiNota('attivita', e.testo);
        else if (e.tipo === 'errore') aggiungiNota('msg errore', e.testo);
        else if (e.tipo === 'stili') { window.__stili = e.stili; ui = e; }
        else if (e.tipo === 'upload') ui = { tipo: 'upload', tipoFile: e.tipoFile };
        else if (e.tipo === 'riepilogo') ui = e;
      }
      mostraUi(ui); // i componenti interattivi vanno dopo l'ultimo messaggio
      aggiornaAvanzamento(d);
    } catch {
      blocca(false);
      aggiungiNota('msg errore', 'Connessione persa. Il messaggio potrebbe non essere arrivato: riprova.');
    }
  }

  async function conferma() {
    blocca(true);
    try {
      const r = await fetch(`${API}/conferma`, { method: 'POST' });
      const d = await r.json();
      blocca(false);
      if (!r.ok) return aggiungiNota('msg errore', d.errore || 'Conferma non riuscita.');
      rimuoviInterattivi();
      aggiungiMessaggio('assistente', d.messaggi[d.messaggi.length - 1].testo);
      aggiornaAvanzamento(d);
    } catch {
      blocca(false);
      aggiungiNota('msg errore', 'Connessione persa: riprova.');
    }
  }

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return aggiungiNota('msg errore', 'Il file supera i 10 MB.');
    const fd = new FormData();
    fd.append('tipo', tipoFileRichiesto);
    fd.append('file', f);
    aggiungiNota('attivita', `Carico ${f.name}…`);
    try {
      const r = await fetch(`${API}/file`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) return aggiungiNota('msg errore', d.errore || 'Caricamento non riuscito.');
      manda(`Ho caricato ${d.tipo === 'documento' ? 'un file' : `il file per: ${d.tipo}`} (${d.nome}).`);
    } catch {
      aggiungiNota('msg errore', 'Caricamento non riuscito: riprova.');
    }
  });

  $('#allega').addEventListener('click', () => fileInput.click());
  modulo.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = testo.value;
    testo.value = '';
    testo.style.height = '';
    manda(t);
  });
  testo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      modulo.requestSubmit();
    }
  });
  testo.addEventListener('input', () => {
    testo.style.height = 'auto';
    testo.style.height = `${Math.min(testo.scrollHeight, 160)}px`;
  });

  (async () => {
    try {
      const r = await fetch(API);
      const d = await r.json();
      if (!r.ok) return aggiungiNota('msg errore', d.errore || 'Link non valido.');
      if (d.demo) $('#demo').classList.remove('nascosto');
      for (const m of d.messaggi) aggiungiMessaggio(m.chi, m.testo);
      mostraUi(d.uiInAttesa);
      aggiornaAvanzamento(d);
      testo.focus();
    } catch {
      aggiungiNota('msg errore', 'Non riesco a caricare la conversazione. Ricarica la pagina.');
    }
  })();
})();
