(() => {
  const $ = (s) => document.querySelector(s);
  let token = '';
  try { token = sessionStorage.getItem('pp-token') || ''; } catch {}
  let corrente = null;

  async function api(percorso, opzioni = {}) {
    const r = await fetch(percorso, {
      ...opzioni,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opzioni.headers || {}) },
    });
    if (r.status === 401) { esci(); throw new Error('Token non valido'); }
    return r;
  }

  function esci() {
    token = '';
    try { sessionStorage.removeItem('pp-token'); } catch {}
    $('#area').classList.add('nascosto');
    $('#accesso').classList.remove('nascosto');
  }

  const STATI = { in_corso: 'in corso', da_confermare: 'da confermare', confermato: 'confermato' };
  const data = (iso) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  async function carica() {
    const r = await api('/api/admin/sessioni');
    const d = await r.json();
    $('#accesso').classList.add('nascosto');
    $('#area').classList.remove('nascosto');
    const m = $('#modalita');
    m.textContent = d.demo ? 'DEMO · nessuna chiave Gemini' : d.modello;
    m.classList.remove('nascosto');
    const righe = $('#righe');
    righe.innerHTML = '';
    $('#vuoto').classList.toggle('nascosto', d.sessioni.length > 0);
    for (const s of d.sessioni) {
      const tr = document.createElement('tr');
      tr.className = 'cliccabile';
      tr.innerHTML = '<td></td><td><span class="stato"></span></td><td></td><td></td><td></td><td class="col-azioni"></td>';
      const td = tr.querySelectorAll('td');
      td[0].textContent = s.azienda || s.etichetta || '(senza nome)';
      if (s.azienda && s.etichetta && s.azienda !== s.etichetta) {
        const sm = document.createElement('div');
        sm.style.cssText = 'font-size:12px;color:var(--inchiostro-2)';
        sm.textContent = s.etichetta;
        td[0].appendChild(sm);
      }
      const st = td[1].firstChild;
      st.textContent = STATI[s.stato] || s.stato;
      st.classList.add(s.stato);
      td[2].textContent = `${s.percentuale}%`;
      td[3].textContent = s.messaggi;
      td[4].textContent = data(s.aggiornata);
      td[5].appendChild(bottoneElimina(s.id, s.azienda || s.etichetta, true));
      tr.addEventListener('click', () => dettaglio(s.id));
      righe.appendChild(tr);
    }
  }

  // Eliminazione in due clic: il primo arma il pulsante ("Conferma?"), il secondo elimina.
  function armaElimina(btn, id, testoNormale) {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!btn.dataset.armato) {
        btn.dataset.armato = '1';
        btn.textContent = 'Conferma?';
        btn.classList.add('armato');
        btn._timer = setTimeout(() => { delete btn.dataset.armato; btn.textContent = testoNormale; btn.classList.remove('armato'); }, 4000);
        return;
      }
      clearTimeout(btn._timer);
      btn.disabled = true;
      const r = await api(`/api/admin/sessioni/${id}`, { method: 'DELETE' });
      if (!r.ok) { btn.disabled = false; btn.textContent = 'Errore'; return; }
      if (corrente?.id === id) { corrente = null; $('#dettaglio').classList.add('nascosto'); }
      carica();
    });
  }

  function bottoneElimina(id, nome, compatto) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn secondario elimina piccolo';
    b.title = `Elimina il brief ${nome || ''}`.trim();
    b.setAttribute('aria-label', b.title);
    const testo = compatto ? '🗑' : 'Elimina';
    b.textContent = testo;
    armaElimina(b, id, testo);
    return b;
  }

  function scarica(nome, contenuto, tipo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenuto], { type: tipo }));
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function dettaglio(id) {
    const r = await api(`/api/admin/sessioni/${id}`);
    corrente = await r.json();
    corrente.id = id;
    const b = corrente.brief;
    $('#dettaglio').classList.remove('nascosto');
    $('#det-titolo').textContent = b.campi.nome_azienda?.valore || b.etichetta || 'Brief';
    $('#det-md').textContent = corrente.markdown;
    const nuovoElimina = bottoneElimina(id, $('#det-titolo').textContent, false);
    nuovoElimina.classList.remove('piccolo');
    nuovoElimina.id = 'elimina-dettaglio';
    $('#elimina-dettaglio').replaceWith(nuovoElimina);
    const tr = $('#det-trascr');
    tr.innerHTML = '';
    for (const m of corrente.trascrizione) {
      const d = document.createElement('div');
      d.className = m.chi;
      d.innerHTML = '<b></b>';
      d.firstChild.textContent = m.chi;
      d.append(m.testo);
      tr.appendChild(d);
    }
    const df = $('#det-file');
    df.innerHTML = '';
    for (const f of b.file) {
      const btn = document.createElement('button');
      btn.className = 'btn secondario';
      btn.textContent = `⬇ ${f.tipo}: ${f.nome}`;
      btn.addEventListener('click', async () => {
        const rf = await api(`/api/admin/sessioni/${id}/file/${f.salvato}`);
        scarica(f.nome, await rf.blob(), rf.headers.get('content-type'));
      });
      df.appendChild(btn);
    }
    $('#dettaglio').scrollIntoView({ behavior: 'smooth' });
  }

  const nomeFile = () => (corrente.brief.campi.nome_azienda?.valore || 'brief').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  $('#scarica-md').addEventListener('click', () => scarica(`${nomeFile()}.md`, corrente.markdown, 'text/markdown'));
  $('#scarica-json').addEventListener('click', () => scarica(`${nomeFile()}.json`, JSON.stringify(corrente.brief, null, 2), 'application/json'));
  $('#apri-link').addEventListener('click', () => window.open(`/s/${corrente.id}`, '_blank', 'noopener'));

  $('#form-accesso').addEventListener('submit', async (e) => {
    e.preventDefault();
    token = $('#token').value.trim();
    try {
      await carica();
      try { sessionStorage.setItem('pp-token', token); } catch {}
    } catch { alert('Token non valido'); }
  });

  $('#form-nuova').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('/api/admin/sessioni', { method: 'POST', body: JSON.stringify({ etichetta: $('#etichetta').value }) });
    const d = await r.json();
    const url = `${location.origin}${d.link}`;
    const box = $('#link-creato');
    box.innerHTML = '<span></span><button class="btn secondario" type="button">Copia</button>';
    box.firstChild.textContent = url;
    box.querySelector('button').addEventListener('click', async (ev) => {
      try { await navigator.clipboard.writeText(url); ev.target.textContent = 'Copiato'; } catch { ev.target.textContent = 'Copia a mano'; }
    });
    box.classList.remove('nascosto');
    $('#etichetta').value = '';
    carica();
  });

  if (token) carica().catch(() => {});
})();
