/*
 * Grammatica visuale V2 — componenti di presentazione condivisi da TUTTE le viste
 * (§12: un concetto = stesso segno ovunque; lo stesso asse in ogni vista).
 *
 * Riga, ordine logico invariabile (§12):
 *   1 nome · 2 asse · 3 banda · 4 criticità · 5 confronto · 6 andamento · 7 certezza · 8 n/N
 *
 * SOLO presentazione: valori, bande, posizioni, certezza, criticità e confronti arrivano
 * dal server già determinati. Nessun calcolo, nessun testo (tutto da I18n), nessuna
 * coordinata semantica sinistra/destra: le posizioni sull'asse sono applicate con
 * proprietà CSS logiche (inline-start), così in RTL l'asse si specchia da solo (decisione A).
 * Il colore non rappresenta mai banda né certezza (§16): solo forma e tratto.
 */
(function (radice, fabbrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabbrica;
  else radice.Grammatica = fabbrica(radice.I18n);
}(typeof self !== 'undefined' ? self : this, function (I18n) {
  'use strict';

  // Segni del vocabolario chiuso (non sono testi: il nome accessibile viene dal catalogo).
  var SEGNI = {
    OBSERVATION: '●', // ●
    OBSERVATION_EXCLUDED: '○', // ○
    AGGREGATE: '▬', // ▬
    TEACHER_ASSESSMENT: '■', // ■
    REFERENCE_MARK: '▏', // ▏
    HISTORICAL_LEVEL: '◇', // ◇
    CRITICAL: '⚠', // ⚠
    COMPARISON_ABOVE: '▲', // ▲
    COMPARISON_BELOW: '▼', // ▼
    COMPARISON_ALIGNED: '=',
    WINDOW_OPEN: '⟦', // ⟦
    WINDOW_CLOSE: '⟧', // ⟧
  };

  function el(tag, attributi, figli) {
    var nodo = document.createElement(tag);
    Object.keys(attributi || {}).forEach(function (nome) {
      var valore = attributi[nome];
      if (valore === null || valore === undefined || valore === false) return;
      if (nome === 'testo') nodo.textContent = valore;
      else if (nome === 'classe') nodo.className = valore;
      else if (nome === 'stile') Object.keys(valore).forEach(function (p) { nodo.style.setProperty(p, valore[p]); });
      else if (nome.indexOf('on') === 0) nodo.addEventListener(nome.slice(2), valore);
      else nodo.setAttribute(nome, valore === true ? '' : valore);
    });
    (figli || []).forEach(function (f) { if (f !== null && f !== undefined && f !== false) nodo.append(f); });
    return nodo;
  }

  /** Testo da catalogo in un elemento; se manca, il marcatore porta la chiave solo come dato diagnostico. */
  function t(tag, chiave, parametri, attributi) {
    var nodo = el(tag, attributi || {});
    nodo.textContent = I18n.testo(chiave, parametri);
    if (!I18n.esiste(chiave)) nodo.setAttribute('data-testo-mancante', chiave);
    return nodo;
  }

  /** Contenuto dell'istituto o d'autore { testo, lingua }: la UI imposta `lang` (B-3). */
  function contenuto(tag, valore, attributi) {
    var nodo = el(tag, attributi || {});
    if (!valore) return nodo;
    if (typeof valore === 'string') { nodo.textContent = valore; return nodo; }
    nodo.textContent = valore.testo;
    if (valore.lingua) nodo.setAttribute('lang', valore.lingua);
    return nodo;
  }

  function percentuale(valore, decimali) {
    return I18n.testo('UI_PERCENT', { valore: { valore: valore, decimali: decimali } });
  }

  /** Posizione 0-100 ricevuta dal server, applicata come proprietà logica (si specchia in RTL). */
  function posizione(valore) {
    return { 'inset-inline-start': valore + '%' };
  }

  function segno(carattere, chiave, parametri, classe) {
    return el('span', {
      classe: 'segno ' + (classe || ''), role: 'img', 'aria-label': I18n.testo(chiave, parametri), title: I18n.testo(chiave, parametri),
    }, [carattere]);
  }

  /**
   * ASSE (§12): zona critica (terracotta chiara tratteggiata), confini delle bande, ▬ fino
   * al valore, tacche ▏ di riferimento, ◇ del livello storico. Valore assente: traccia vuota.
   */
  function asse(dati, contesto) {
    var v = dati.valore || {};
    var figli = [];
    (contesto.bande || []).forEach(function (b) {
      if (b.critica) {
        figli.push(el('span', { classe: 'zona-critica', 'aria-hidden': 'true', stile: { 'inset-inline-start': b.posizioneInizio + '%', 'inline-size': b.ampiezza + '%' } }));
      }
      if (b.posizioneInizio > 0) figli.push(el('span', { classe: 'confine', 'aria-hidden': 'true', stile: posizione(b.posizioneInizio) }));
    });
    if (v.posizioneAsse !== null && v.posizioneAsse !== undefined) {
      figli.push(el('span', {
        classe: 'barra' + certezzaClasse(v) + (v.stato === 'INSUFFICIENT_DATA' ? ' insufficiente' : ''),
        'aria-hidden': 'true',
        stile: { 'inline-size': v.posizioneAsse + '%' },
      }));
    }
    (dati.riferimenti || []).forEach(function (r) {
      if (!r || r.posizioneAsse === null || r.posizioneAsse === undefined) return;
      var marca = el('span', {
        classe: 'tacca' + (r.certezza && r.certezza !== 'CERTAINTY_SUFFICIENT' ? ' debole' : ''),
        role: 'img', 'aria-label': I18n.testo(r.chiave, { valore: { valore: r.posizioneAsse, decimali: contesto.precisione.dettaglio } }),
        title: I18n.testo(r.chiave, { valore: { valore: r.posizioneAsse, decimali: contesto.precisione.dettaglio } }),
        stile: posizione(r.posizioneAsse),
      }, [SEGNI.REFERENCE_MARK]);
      figli.push(marca);
    });
    if (dati.storico && dati.storico.posizioneAsse !== null && dati.storico.posizioneAsse !== undefined) {
      var parametri = { valore: { valore: dati.storico.percentuale, decimali: contesto.precisione.dettaglio } };
      figli.push(el('span', {
        classe: 'storico', role: 'img', 'aria-label': I18n.testo('HISTORICAL_LEVEL', parametri), title: I18n.testo('HISTORICAL_LEVEL', parametri),
        stile: posizione(dati.storico.posizioneAsse),
      }, [SEGNI.HISTORICAL_LEVEL]));
    }
    var etichettaAsse = v.percentuale === null || v.percentuale === undefined
      ? I18n.testo(v.stato || 'NOT_OBSERVED')
      : percentuale(v.percentuale, contesto.precisione.dettaglio);
    var traccia = el('span', { classe: 'traccia', role: 'img', 'aria-label': etichettaAsse }, figli);
    var numero = v.percentuale === null || v.percentuale === undefined
      ? el('span', { classe: 'numero vuoto' })
      : el('span', { classe: 'numero' + (v.stato === 'INSUFFICIENT_DATA' ? ' insufficiente' : ''), testo: percentuale(v.percentuale, contesto.precisione.dettaglio) });
    return el('span', { classe: 'asse' }, [traccia, numero]);
  }

  function certezzaClasse(v) {
    if (v.certezza === 'CERTAINTY_PARTIAL') return ' parziale';
    return '';
  }

  /** Banda (strato OBSERVATION_DERIVED_LEVEL): etichetta con contorno, mai colorata, mai il timbro. */
  function banda(v) {
    if (!v || !v.giudizio) return el('span', { classe: 'banda vuota' });
    return contenuto('span', v.giudizio, { classe: 'banda' + certezzaClasse(v) + (v.stato === 'INSUFFICIENT_DATA' ? ' insufficiente' : '') });
  }

  /** Criticità (§8): ⚠ pieno = banda critica (certezza sufficiente), ⚠ a contorno = da verificare. */
  function criticita(v) {
    if (!v || !v.criticita) return el('span', { classe: 'criticita' });
    return el('span', { classe: 'criticita' }, [
      segno(SEGNI.CRITICAL, v.criticita, null, v.criticita === 'CRITICAL_BAND' ? 'pieno' : 'contorno'),
    ]);
  }

  /** Confronto (§9): glifo solo se consentito e confermato; non confermato = etichetta, nessun glifo (P8). */
  function confronto(c, contesto) {
    if (!c) return el('span', { classe: 'confronto' });
    var parametri = { differenza: { valore: c.differenzaPunti, decimali: contesto.precisione.dettaglio } };
    if (c.esito === 'COMPARISON_UNCONFIRMED') {
      return el('span', { classe: 'confronto non-confermato' }, [
        t('span', 'COMPARISON_UNCONFIRMED', null, { title: I18n.testo(c.motivo) }),
      ]);
    }
    return el('span', { classe: 'confronto' + (c.certezza && c.certezza !== 'CERTAINTY_SUFFICIENT' ? ' parziale' : '') }, [
      segno(SEGNI[c.esito], c.esito, parametri),
    ]);
  }

  /** Certezza (§7): sempre visibile, come testo; resa più debole senza colore. */
  function certezza(v) {
    if (!v || !v.certezza) return el('span', { classe: 'certezza' });
    return t('span', v.certezza, null, { classe: 'certezza' + certezzaClasse(v) });
  }

  function base(v) {
    if (!v || !v.base) return el('span', { classe: 'base' });
    return t('span', 'BASE_COUNT', { n: v.base.n, N: v.base.N }, { classe: 'base' });
  }

  /**
   * RIGA V2. `dati`: { nome, valore, riferimenti, storico, confronto }. Con `apri` la riga
   * intera è l'unico controllo di apertura (un solo gesto, §15).
   */
  function riga(dati, contesto, apri) {
    var v = dati.valore || {};
    var attenuata = v.stato === 'NOT_CONFIGURED';
    var celle = [
      el('span', { classe: 'nome' }, [typeof dati.nome === 'object' && dati.nome && dati.nome.nodeType ? dati.nome : contenuto('span', dati.nome)]),
      asse(dati, contesto),
      banda(v),
      criticita(v),
      confronto(dati.confronto, contesto),
      el('span', { classe: 'andamento' }),
      certezza(v),
      base(v),
    ];
    var classe = 'riga' + (attenuata ? ' attenuata' : '') + (dati.intestazione ? ' intestazione' : '');
    if (apri && !attenuata) {
      return el('button', { type: 'button', classe: classe + ' apribile', onclick: apri, 'data-riga': dati.chiave || '' }, celle);
    }
    return el('div', { classe: classe, 'data-riga': dati.chiave || '' }, celle);
  }

  /** Intestazioni di colonna della riga (COLUMN_*), nello stesso ordine. */
  function intestazioneColonne() {
    return el('div', { classe: 'riga colonne', 'aria-hidden': 'true' }, [
      'COLUMN_NAME', 'COLUMN_AXIS', 'COLUMN_BAND', 'COLUMN_CRITICALITY', 'COLUMN_COMPARISON', 'COLUMN_TREND', 'COLUMN_CERTAINTY', 'COLUMN_BASE',
    ].map(function (c) { return t('span', c); }));
  }

  /** Mini-riga (cella della matrice alunni × nuclei): asse, banda, criticità, certezza. */
  function miniRiga(v, contesto) {
    return el('span', { classe: 'mini-riga' + (v.stato === 'NOT_CONFIGURED' ? ' attenuata' : '') }, [
      asse({ valore: v }, contesto), banda(v), criticita(v), certezza(v),
    ]);
  }

  /** Barre di distribuzione (si specchiano in RTL): larghezze ricevute dal server. */
  function distribuzione(voci, etichettaVoce) {
    return el('span', { classe: 'distribuzione' }, voci.map(function (d) {
      return el('span', { classe: 'voce' + (d.studentiParziali ? ' con-parziali' : '') + (d.critica ? ' critica' : '') }, [
        contenuto('span', etichettaVoce(d), { classe: 'etichetta' }),
        el('span', { classe: 'barra-distribuzione' }, [el('span', { classe: 'pieno', stile: { 'inline-size': d.larghezza + '%' } })]),
        t('span', 'UI_STUDENT_COUNT', { n: d.studenti }, { classe: 'conteggio' }),
        d.studentiParziali ? t('span', 'UI_PARTIAL_COUNT', { n: d.studentiParziali }, { classe: 'conteggio parziale' }) : null,
      ]);
    }));
  }

  return {
    SEGNI: SEGNI, el: el, t: t, contenuto: contenuto, riga: riga, miniRiga: miniRiga, intestazioneColonne: intestazioneColonne,
    asse: asse, banda: banda, criticita: criticita, confronto: confronto, certezza: certezza, base: base,
    distribuzione: distribuzione, segno: segno, posizione: posizione, percentuale: percentuale,
  };
}));
