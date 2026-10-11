/*
 * Grammatica visiva V2.1 (revisione 2) — componenti di presentazione condivisi da TUTTE le
 * viste: un concetto = lo stesso segno ovunque.
 *
 *   DISCO     settore = categoria (nucleo/criterio), stessa ampiezza per tutti;
 *             raggio del riempimento = valore (0% bordo interno, 100% bordo esterno);
 *             colore = banda (dal server, E1); righe sopra il colore = certezza parziale;
 *             fascia interna rosata = zona della banda critica (contesto, non dato);
 *             bordo pieno = in banda critica, tratteggiato = da verificare;
 *             ⌒ arco scuro con terminali = riferimento della classe; ◇ = storico dell'alunno;
 *             settore grigio tratteggiato = nessuna osservazione (null).
 *   CARTA     la stessa informazione in forma testuale, con lo stesso gesto di apertura.
 *   TABELLA   rappresentazione equivalente, accessibile e stampabile («Mostra come tabella»).
 *   VALORI    0…n = osservazione reale con il colore della sua banda (E2);
 *             null = non osservato, grigio neutro, mai un colore di banda.
 *
 * SOLO presentazione: valori, bande, colori, certezza, criticità e confronti arrivano dal
 * server. La geometria (seno e coseno) è in geometria.js. Nessun testo: tutto da I18n.
 * Il colore non è mai l'unico canale: numero, etichetta e testo accessibile lo accompagnano.
 */
(function (radice, fabbrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabbrica;
  else radice.Grammatica = fabbrica(radice.I18n, radice.Geometria);
}(typeof self !== 'undefined' ? self : this, function (I18n, Geo) {
  'use strict';

  var SVG = 'http://www.w3.org/2000/svg';

  // Segni del vocabolario chiuso (non sono testi: il nome accessibile viene dal catalogo).
  var SEGNI = {
    OBSERVATION: '●',
    OBSERVATION_EXCLUDED: '○',
    TEACHER_ASSESSMENT: '■',
    CLASS_REFERENCE: '⌒',
    HISTORICAL_LEVEL: '◇',
    CRITICAL: '⚠',
    COMPARISON_ABOVE: '▲',
    COMPARISON_BELOW: '▼',
    COMPARISON_ALIGNED: '=',
    NOT_OBSERVED: '–',
    BACK: '←',
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

  function s(tag, attributi, figli) {
    var nodo = document.createElementNS(SVG, tag);
    Object.keys(attributi || {}).forEach(function (nome) {
      var valore = attributi[nome];
      if (valore === null || valore === undefined || valore === false) return;
      if (nome.indexOf('on') === 0) nodo.addEventListener(nome.slice(2), valore);
      else nodo.setAttribute(nome, valore);
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

  function testoDi(valore) {
    if (!valore) return '';
    return typeof valore === 'string' ? valore : valore.testo;
  }

  function percentuale(valore, decimali) {
    return I18n.testo('UI_PERCENT', { valore: { valore: valore, decimali: decimali } });
  }

  function segno(carattere, chiave, parametri, classe) {
    var testo = I18n.testo(chiave, parametri);
    return el('span', { classe: 'segno ' + (classe || ''), role: 'img', 'aria-label': testo, title: testo }, [carattere]);
  }

  // --- Bande, colori, certezza ----------------------------------------------------------

  function banda(contesto, bandaId) {
    if (bandaId === null || bandaId === undefined) return null;
    return (contesto.bande || []).find(function (b) { return b.id === bandaId; }) || null;
  }

  function osservato(v) {
    return !!v && v.percentuale !== null && v.percentuale !== undefined;
  }

  /** Etichetta colorata della banda (colore dal server, E1) con l'etichetta come testo: il colore non è mai solo. */
  function chipBanda(v, contesto) {
    var b = v ? banda(contesto, v.bandaId) : null;
    if (!b) return el('span', { classe: 'chip vuoto' });
    return contenuto('span', b.etichetta, {
      classe: 'chip' + (v.certezza === 'CERTAINTY_PARTIAL' ? ' parziale' : ''),
      'data-banda': b.id,
      stile: { 'background-color': b.colore, color: b.inchiostro },
    });
  }

  /** Certezza come secondo canale: ●●● sufficiente, ●●○ parziale; il testo è sempre accessibile. */
  function certezza(v) {
    if (!v || !v.certezza || v.certezza === 'CERTAINTY_ABSENT') return el('span', { classe: 'certezza' });
    var testo = I18n.testo(v.certezza);
    return el('span', { classe: 'certezza', role: 'img', 'aria-label': testo, title: testo, 'data-certezza': v.certezza },
      [v.certezza === 'CERTAINTY_SUFFICIENT' ? '●●●' : '●●○']);
  }

  /** Criticità: ⚠ pieno = in banda critica (certezza sufficiente), ⚠ a contorno = da verificare. */
  function criticita(v) {
    if (!v || !v.criticita) return null;
    return segno(SEGNI.CRITICAL, v.criticita, null, v.criticita === 'CRITICAL_BAND' ? 'pieno' : 'contorno');
  }

  /**
   * Confronto confermato (▲ ▼ =) con il riferimento dichiarato dalla vista (es. «rispetto al
   * suo complessivo»); non confermato = etichetta senza glifo, con il motivo (P8).
   */
  function confronto(c, contesto, chiaveRiferimento) {
    if (!c) return null;
    if (c.esito === 'COMPARISON_UNCONFIRMED') {
      return t('span', 'COMPARISON_UNCONFIRMED', null, { classe: 'confronto non-confermato', title: I18n.testo(c.motivo) });
    }
    var parametri = { differenza: { valore: c.differenzaPunti, decimali: contesto.precisione.dettaglio }, riferimento: chiaveRiferimento };
    return segno(SEGNI[c.esito], c.esito, parametri, 'confronto' + (c.certezza && c.certezza !== 'CERTAINTY_SUFFICIENT' ? ' parziale' : ''));
  }

  function numero(v, contesto) {
    if (!osservato(v)) return t('span', v && v.stato === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'NOT_OBSERVED', null, { classe: 'numero vuoto' });
    return el('span', { classe: 'numero', testo: percentuale(v.percentuale, contesto.precisione.dettaglio) });
  }

  /** Descrizione accessibile completa di un valore (nome, numero, banda, certezza, criticità). */
  function descrizione(nome, v, contesto) {
    var parti = [testoDi(nome)];
    if (!osservato(v)) parti.push(I18n.testo(v && v.stato === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'NOT_OBSERVED'));
    else {
      parti.push(percentuale(v.percentuale, contesto.precisione.dettaglio));
      if (v.giudizio) parti.push(testoDi(v.giudizio));
      if (v.certezza) parti.push(I18n.testo(v.certezza));
      if (v.criticita) parti.push(I18n.testo(v.criticita));
    }
    return parti.filter(Boolean).join(' · ');
  }

  /**
   * Valore della scala (0…n) con il colore della SUA banda (E2: bandaId arriva con la scala);
   * null = non osservato, grigio neutro tratteggiato. Mai un colore di banda per null.
   */
  function valoreScala(valore, contesto) {
    if (valore === null || valore === undefined) {
      var nessuno = I18n.testo('NOT_OBSERVED');
      return el('span', { classe: 'valore nullo', role: 'img', 'aria-label': nessuno, title: nessuno, 'data-valore': 'null' }, [SEGNI.NOT_OBSERVED]);
    }
    var voce = (contesto.scala && contesto.scala.valori || []).find(function (v) { return v.valore === valore; });
    var b = voce ? banda(contesto, voce.bandaId) : null;
    var testo = I18n.numero(valore, 0) + (voce ? ' · ' + testoDi(voce.etichetta) : '') + (b ? ' · ' + testoDi(b.etichetta) : '');
    return el('span', {
      classe: 'valore' + (b ? '' : ' senza-banda'), role: 'img', 'aria-label': testo, title: testo,
      'data-valore': valore, 'data-banda': b ? b.id : null,
      stile: b ? { 'background-color': b.colore, color: b.inchiostro } : null,
    }, [I18n.numero(valore, 0)]);
  }

  // --- DISCO ----------------------------------------------------------------------------

  var progressivo = 0;

  function spezza(testo, massimo) {
    var righe = [''];
    String(testo).split(' ').forEach(function (parola) {
      var ultima = righe.length - 1;
      var candidata = (righe[ultima] + ' ' + parola).trim();
      if (righe[ultima] && candidata.length > massimo) righe.push(parola);
      else righe[ultima] = candidata;
    });
    return righe;
  }

  function attiva(nodo, apri) {
    if (!apri) return;
    nodo.setAttribute('tabindex', '0');
    nodo.setAttribute('role', 'link');
    nodo.addEventListener('click', apri);
    nodo.addEventListener('keydown', function (evento) {
      if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); apri(); }
    });
  }

  /**
   * DISCO. dati: { aria, centro (valore), settori: [{ chiave, nome, valore, riferimentoClasse,
   * storico, apri }], mini }. Oltre MASSIMO_SETTORI restituisce null (C5: solo carte/tabella).
   */
  function disco(dati, contesto) {
    var n = dati.settori.length;
    if (n === 0 || n > Geo.MASSIMO_SETTORI) return null;
    var rtl = I18n.rtl();
    var mini = !!dati.mini;
    var imp = Geo.impianto(mini);
    var R = imp.R;
    var r0 = imp.r0;
    var id = 'disco-' + (progressivo += 1);
    var critica = (contesto.bande || []).find(function (b) { return b.critica; });
    var svg = s('svg', {
      class: 'disco' + (mini ? ' mini' : ''), viewBox: imp.viewBox,
      role: 'group', 'aria-label': dati.aria || '', 'data-settori': n,
    });
    svg.append(s('defs', {}, [
      s('pattern', { id: id + '-righe', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, [
        s('rect', { width: 3.2, height: 8, class: 'righe-certezza' }),
      ]),
    ]));
    Geo.settori(n).forEach(function (geo, i) {
      var st = dati.settori[i];
      var v = st.valore || {};
      var g = s('g', {
        class: 'settore' + (osservato(v) ? '' : ' nullo') + (v.stato === 'NOT_CONFIGURED' ? ' non-configurato' : ''),
        'data-settore': st.chiave || i, 'aria-label': descrizione(st.nome, v, contesto),
      });
      g.append(s('title', {}, [document.createTextNode(descrizione(st.nome, v, contesto))]));
      g.append(s('path', { d: Geo.corona(r0, R, geo.a0, geo.a1, rtl), class: 'traccia', 'fill-rule': 'evenodd' }));
      if (critica) {
        g.append(s('path', { d: Geo.corona(r0, Geo.raggio(r0, R, critica.posizioneFine), geo.a0, geo.a1, rtl), class: 'zona-critica', 'fill-rule': 'evenodd' }));
      }
      if (osservato(v)) {
        var b = banda(contesto, v.bandaId);
        var tracciato = Geo.corona(r0, Geo.raggioRiempimento(r0, R, v.posizioneAsse), geo.a0, geo.a1, rtl);
        g.append(s('path', { d: tracciato, class: 'riempimento', 'fill-rule': 'evenodd', fill: b ? b.colore : null, 'data-banda': b ? b.id : null }));
        if (v.certezza === 'CERTAINTY_PARTIAL') {
          g.append(s('path', { d: tracciato, class: 'righe', 'fill-rule': 'evenodd', fill: 'url(#' + id + '-righe)', 'data-certezza': 'CERTAINTY_PARTIAL' }));
        }
      } else {
        g.append(s('path', { d: Geo.corona(r0, R, geo.a0, geo.a1, rtl), class: 'bordo-nullo', 'fill-rule': 'evenodd' }));
      }
      if (v.criticita) {
        g.append(s('path', {
          d: Geo.corona(r0, R + 3, geo.a0, geo.a1, rtl), class: 'bordo-critico ' + (v.criticita === 'CRITICAL_BAND' ? 'pieno' : 'contorno'), 'fill-rule': 'evenodd',
          'data-criticita': v.criticita,
        }));
      }
      var rc = st.riferimentoClasse;
      if (rc && rc.posizioneAsse !== null && rc.posizioneAsse !== undefined) {
        var rr = Geo.raggio(r0, R, rc.posizioneAsse);
        var titoloClasse = I18n.testo('UI_REFERENCE_CLASS', { valore: { valore: rc.posizioneAsse, decimali: contesto.precisione.dettaglio } });
        var estremi = Geo.estremiArco(geo, n);
        var b0 = estremi[0];
        var b1 = estremi[1];
        g.append(s('g', { class: 'riferimento-classe', 'data-riferimento': 'classe' }, [
          s('title', {}, [document.createTextNode(titoloClasse)]),
          s('path', { d: Geo.arco(rr, b0, b1, rtl) }),
          n === 1 ? null : s('path', { d: Geo.terminale(rr, 7, b0, rtl) }),
          n === 1 ? null : s('path', { d: Geo.terminale(rr, 7, b1, rtl) }),
        ]));
      }
      var st0 = st.storico;
      if (st0 && st0.posizioneAsse !== null && st0.posizioneAsse !== undefined) {
        var p = Geo.punto(Geo.raggio(r0, R, st0.posizioneAsse), Geo.angoloStorico(geo, n), rtl);
        var titoloStorico = I18n.testo('HISTORICAL_LEVEL', { valore: { valore: st0.percentuale, decimali: contesto.precisione.dettaglio } });
        g.append(s('g', { class: 'storico', 'data-riferimento': 'storico' }, [
          s('title', {}, [document.createTextNode(titoloStorico)]),
          s('path', { d: Geo.rombo(p[0], p[1], mini ? 7 : 9) }),
        ]));
      }
      if (!mini) {
        var righe = spezza(testoDi(st.nome), 14);
        var pe = Geo.etichetta(R, geo, n, righe.length, rtl);
        var testo = s('text', { x: pe.x, y: pe.y, 'text-anchor': pe.ancora, class: 'etichetta-settore', 'aria-hidden': 'true' });
        righe.forEach(function (riga, k) { testo.append(s('tspan', { x: pe.x, dy: k === 0 ? 0 : 15 }, [document.createTextNode(riga)])); });
        var valoreTesto = osservato(v) ? percentuale(v.percentuale, contesto.precisione.dettaglio) : I18n.testo(v.stato === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'NOT_OBSERVED');
        testo.append(s('tspan', { x: pe.x, dy: 18, class: 'valore-settore' }, [document.createTextNode(valoreTesto + (v.criticita ? '  ' + SEGNI.CRITICAL : ''))]));
        g.append(testo);
      }
      attiva(g, v.stato === 'NOT_CONFIGURED' ? null : st.apri);
      svg.append(g);
    });
    // Centro: valore aggregato del livello, banda, certezza (testo; il colore è nel riempimento).
    var c = dati.centro;
    var centro = s('g', { class: 'centro', 'aria-hidden': 'true' });
    if (osservato(c)) {
      centro.append(s('text', { x: 0, y: mini ? 9 : 4, class: 'centro-valore' }, [document.createTextNode(
        mini ? I18n.testo('UI_PERCENT', { valore: { valore: c.sintesi ? c.sintesi.valore : c.percentuale, decimali: c.sintesi ? c.sintesi.decimali : 0 } })
          : percentuale(c.percentuale, contesto.precisione.dettaglio)
      )]));
      if (!mini) {
        if (c.giudizio) centro.append(s('text', { x: 0, y: 24, class: 'centro-banda' + (testoDi(c.giudizio).length > 11 ? ' lunga' : '') }, [document.createTextNode(testoDi(c.giudizio))]));
        if (c.certezza && c.certezza !== 'CERTAINTY_ABSENT') {
          centro.append(s('text', { x: 0, y: 42, class: 'centro-certezza' }, [document.createTextNode(c.certezza === 'CERTAINTY_SUFFICIENT' ? '●●●' : '●●○')]));
        }
      }
    } else if (c) {
      centro.append(s('text', { x: 0, y: 5, class: 'centro-vuoto' }, [document.createTextNode(I18n.testo('NOT_OBSERVED'))]));
    }
    svg.append(centro);
    return svg;
  }

  // --- CARTA ----------------------------------------------------------------------------

  /** Carta: nome, numero, banda, certezza, criticità, confronto, righe di dettaglio; stesso gesto del settore. */
  function carta(dati, contesto) {
    var v = dati.valore || {};
    var figli = [
      el('span', { classe: 'carta-nome' }, [typeof dati.nome === 'object' && dati.nome && dati.nome.nodeType ? dati.nome : contenuto('span', dati.nome)]),
      el('span', { classe: 'carta-valore' }, [numero(v, contesto), criticita(v)]),
      el('span', { classe: 'carta-segni' }, [chipBanda(v, contesto), certezza(v), confronto(dati.confronto, contesto, dati.chiaveConfronto)]),
    ].concat((dati.righe || []).map(function (r) { return el('span', { classe: 'carta-dettaglio' }, [r]); }));
    var classe = 'carta' + (v.criticita === 'CRITICAL_BAND' ? ' critica' : v.criticita === 'CRITICAL_TO_VERIFY' ? ' verificare' : '')
      + (v.stato === 'NOT_CONFIGURED' ? ' attenuata' : '');
    if (dati.apri && v.stato !== 'NOT_CONFIGURED') {
      return el('button', { type: 'button', classe: classe + ' apribile', onclick: dati.apri, 'data-carta': dati.chiave || '' },
        figli.concat([el('span', { classe: 'carta-apri', 'aria-hidden': 'true' }, ['›'])]));
    }
    return el('div', { classe: classe, 'data-carta': dati.chiave || '' }, figli);
  }

  function riferimentoTesto(chiave, posizione, contesto) {
    if (!posizione || posizione.posizioneAsse === null || posizione.posizioneAsse === undefined) return null;
    var valore = posizione.percentuale !== undefined ? posizione.percentuale : posizione.posizioneAsse;
    return t('span', chiave, { valore: { valore: valore, decimali: contesto.precisione.dettaglio } });
  }

  // --- TABELLA EQUIVALENTE --------------------------------------------------------------

  function nomeCella(nome) {
    return typeof nome === 'object' && nome && nome.nodeType ? nome.cloneNode(true) : contenuto('span', nome);
  }

  /** Tabella accessibile e stampabile con la stessa informazione del disco (righe = settori). */
  function tabella(dati, contesto) {
    var conStorico = dati.settori.some(function (st) { return st.storico && st.storico.posizioneAsse !== null && st.storico.posizioneAsse !== undefined; });
    var conClasse = dati.settori.some(function (st) { return st.riferimentoClasse; });
    var colonne = ['COLUMN_NAME', 'COLUMN_AXIS', 'COLUMN_BAND', 'COLUMN_CRITICALITY', 'COLUMN_COMPARISON', 'COLUMN_CERTAINTY', 'COLUMN_BASE']
      .concat(conStorico ? ['COLUMN_HISTORY'] : []).concat(conClasse ? ['COLUMN_CLASS'] : []);
    var righe = [dati.centroRiga].concat(dati.settori).filter(Boolean).map(function (st) {
      var v = st.valore || {};
      var celle = [
        el('th', { scope: 'row' }, [nomeCella(st.nomeEsteso || st.nome)]),
        el('td', {}, [numero(v, contesto)]),
        el('td', {}, [v.giudizio ? contenuto('span', v.giudizio) : null]),
        el('td', {}, [v.criticita ? t('span', v.criticita) : null]),
        el('td', {}, [st.confronto ? (st.confronto.esito === 'COMPARISON_UNCONFIRMED' ? t('span', 'COMPARISON_UNCONFIRMED')
          : t('span', st.confronto.esito, { differenza: { valore: st.confronto.differenzaPunti, decimali: contesto.precisione.dettaglio }, riferimento: st.chiaveConfronto })) : null]),
        el('td', {}, [v.certezza ? t('span', v.certezza) : null]),
        el('td', {}, [v.base ? t('span', 'BASE_COUNT', { n: v.base.n, N: v.base.N }) : null]),
      ];
      if (conStorico) celle.push(el('td', {}, [st.storico && osservato(st.storico) ? el('span', { testo: percentuale(st.storico.percentuale, contesto.precisione.dettaglio) }) : null]));
      if (conClasse) celle.push(el('td', {}, [st.riferimentoClasse ? el('span', { testo: percentuale(st.riferimentoClasse.posizioneAsse, contesto.precisione.dettaglio) }) : null]));
      return el('tr', {}, celle);
    });
    return el('table', { classe: 'tabella-equivalente' }, [
      el('caption', {}, [dati.aria || '']),
      el('thead', {}, [el('tr', {}, colonne.map(function (c) { return t('th', c, null, { scope: 'col' }); }))]),
      el('tbody', {}, righe),
    ]);
  }

  /** Disco + «Mostra come tabella» (C5: senza disco, la tabella è sempre visibile insieme alle carte). */
  function discoConTabella(dati, contesto) {
    var grafico = disco(dati, contesto);
    var tab = tabella(dati, contesto);
    var contenitore = el('div', { classe: 'tabella-alternativa', hidden: grafico ? true : null }, [tab]);
    if (!grafico) return el('div', { classe: 'blocco-disco senza-disco' }, [contenitore]);
    var pulsante = t('button', 'UI_SHOW_TABLE', null, { type: 'button', classe: 'mostra-tabella', 'aria-expanded': 'false' });
    pulsante.addEventListener('click', function () {
      var aperta = contenitore.hidden;
      contenitore.hidden = !aperta;
      pulsante.setAttribute('aria-expanded', String(aperta));
      pulsante.textContent = I18n.testo(aperta ? 'UI_HIDE_TABLE' : 'UI_SHOW_TABLE');
    });
    return el('div', { classe: 'blocco-disco' }, [el('div', { classe: 'disco-contenitore' }, [grafico]), pulsante, contenitore]);
  }

  // --- DISTRIBUZIONI --------------------------------------------------------------------

  /** Alunni per banda del proprio complessivo (P11): segmenti con il colore della banda e i conteggi. */
  function distribuzioneBande(d, contesto) {
    var segmenti = d.bande.filter(function (x) { return x.studenti > 0; }).map(function (x) {
      var b = banda(contesto, x.bandaId);
      var testo = testoDi(x.etichetta) + ': ' + I18n.testo('UI_STUDENT_COUNT', { n: x.studenti });
      return el('span', {
        classe: 'segmento' + (x.studentiParziali ? ' con-parziali' : ''), title: testo, 'data-banda': x.bandaId,
        stile: { 'flex-grow': String(x.studenti), 'background-color': b ? b.colore : null, color: b ? b.inchiostro : null },
      }, [I18n.numero(x.studenti, 0)]);
    });
    var voci = d.bande.map(function (x) {
      var b = banda(contesto, x.bandaId);
      return el('li', {}, [
        el('span', { classe: 'campione', 'aria-hidden': 'true', stile: { 'background-color': b ? b.colore : null } }),
        contenuto('span', x.etichetta), ' ', t('span', 'UI_STUDENT_COUNT', { n: x.studenti }),
        x.studentiParziali ? el('span', { classe: 'tenue' }, [' · ', t('span', 'UI_PARTIAL_COUNT', { n: x.studentiParziali })]) : null,
      ]);
    });
    return el('div', { classe: 'distribuzione' }, [
      el('div', { classe: 'barra-segmenti', 'aria-hidden': 'true' }, segmenti),
      el('ul', { classe: 'voci-distribuzione' }, voci),
    ]);
  }

  /** Valori osservati di un criterio in un'attività: 0…n con il colore della banda, null grigio tratteggiato. */
  function distribuzioneValori(distribuzione, nonValutati, contesto) {
    var segmenti = distribuzione.filter(function (d) { return d.studenti > 0; }).map(function (d) {
      var voce = (contesto.scala.valori || []).find(function (v) { return v.valore === d.valore; });
      var b = voce ? banda(contesto, voce.bandaId) : null;
      return el('span', {
        classe: 'segmento', 'data-valore': d.valore, title: I18n.numero(d.valore, 0) + ' · ' + testoDi(d.etichetta) + ': ' + I18n.testo('UI_STUDENT_COUNT', { n: d.studenti }),
        stile: { 'flex-grow': String(d.studenti), 'background-color': b ? b.colore : null, color: b ? b.inchiostro : null },
      }, [I18n.numero(d.studenti, 0)]);
    });
    if (nonValutati > 0) {
      segmenti.push(el('span', {
        classe: 'segmento nullo', 'data-valore': 'null', title: I18n.testo('NOT_OBSERVED') + ': ' + I18n.testo('UI_STUDENT_COUNT', { n: nonValutati }),
        stile: { 'flex-grow': String(nonValutati) },
      }, [I18n.numero(nonValutati, 0)]));
    }
    var voci = distribuzione.map(function (d) {
      return el('li', {}, [valoreScala(d.valore, contesto), ' ', contenuto('span', d.etichetta), ' ', t('span', 'UI_STUDENT_COUNT', { n: d.studenti })]);
    }).concat([el('li', {}, [valoreScala(null, contesto), ' ', t('span', 'NOT_OBSERVED'), ' ', t('span', 'UI_STUDENT_COUNT', { n: nonValutati })])]);
    return el('div', { classe: 'distribuzione' }, [
      el('div', { classe: 'barra-segmenti', 'aria-hidden': 'true' }, segmenti),
      el('ul', { classe: 'voci-distribuzione' }, voci),
    ]);
  }

  return {
    SEGNI: SEGNI, el: el, t: t, contenuto: contenuto, testoDi: testoDi, segno: segno, percentuale: percentuale,
    banda: banda, chipBanda: chipBanda, certezza: certezza, criticita: criticita, confronto: confronto, numero: numero,
    valoreScala: valoreScala, disco: disco, discoConTabella: discoConTabella, tabella: tabella, carta: carta,
    riferimentoTesto: riferimentoTesto, distribuzioneBande: distribuzioneBande, distribuzioneValori: distribuzioneValori,
    osservato: osservato,
  };
}));
