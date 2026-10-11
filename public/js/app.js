/*
 * Client V2.1 (revisione 2): percorso unico P15 Insegnamenti -> materia -> classe ->
 * {Quadro, Studenti, Attività, Valutazioni}; dentro le viste, gerarchia L0 -> L1 -> L2 -> L3
 * con lo STESSO disco a ogni livello (settori = nuclei, poi criteri, poi il criterio).
 *
 * Navigazione a pila: ogni livello ha «← livello superiore», briciole leggere e una voce
 * nella storia del browser (history.pushState): il tasto Indietro torna al livello
 * precedente; il clic sul settore del disco e quello sulla carta portano allo stesso posto.
 *
 * Il client NON calcola (valori, bande, colori, certezza, criticità, confronti arrivano dal
 * server; la sola geometria grafica è in geometria.js), NON contiene testi (catalogo I18n),
 * NON decide la lingua, NON ordina per livello.
 */
(function () {
  'use strict';

  var G = window.Grammatica;
  var el = G.el;
  var t = G.t;
  var contenuto = G.contenuto;

  var stato = { me: null, insegnamenti: null, rotta: null, comeLeggere: false };

  // --- Infrastruttura -----------------------------------------------------------------

  function $(id) { return document.getElementById(id); }

  async function caricaCatalogo() {
    var risposta = await fetch('/api/i18n', { credentials: 'same-origin' });
    var catalogo = await risposta.json();
    I18n.imposta(catalogo);
    document.documentElement.setAttribute('lang', catalogo.lingua);
    document.documentElement.setAttribute('dir', catalogo.direzione);
    document.title = I18n.testo('UI_APP_TITLE');
  }

  /** Errore server { codice, parametri } -> testo dal catalogo (mai il codice grezzo). */
  function ErroreApi(errore, codiceHttp) {
    this.codice = errore && errore.codice ? errore.codice : 'ERR_INTERNAL';
    this.parametri = (errore && errore.parametri) || {};
    this.stato = codiceHttp;
  }

  async function api(percorso, opzioni) {
    var intestazioni = { 'Content-Type': 'application/json' };
    if (stato.me && stato.me.csrfToken) intestazioni['X-CSRF-Token'] = stato.me.csrfToken;
    var risposta = await fetch('/api' + percorso, Object.assign({ credentials: 'same-origin' }, opzioni || {}, { headers: intestazioni }));
    if (!risposta.ok) {
      var corpo = await risposta.json().catch(function () { return {}; });
      throw new ErroreApi(corpo.errore, risposta.status);
    }
    return risposta.status === 204 ? null : risposta.json();
  }

  function mostraErrore(errore) {
    var area = $('errore');
    area.replaceChildren();
    if (!errore) return;
    area.append(t('div', errore.codice || 'ERR_INTERNAL', errore.parametri, { classe: 'errore', role: 'alert' }));
  }

  function contenitore() { return $('contenuto'); }

  function haPermesso(codice) {
    return !!(stato.me && stato.me.permessiNelTenantAttivo && stato.me.permessiNelTenantAttivo.indexOf(codice) >= 0);
  }

  function nomeStudente(s) { return s.cognome + ' ' + s.nome; }

  // --- Rotte e storia del browser -----------------------------------------------------

  /** Rotta <-> frammento dell'indirizzo (il frammento non va mai al server). */
  function versoHash(r) {
    switch (r.tipo) {
      case 'materia': return '#/materia/' + r.subjectId;
      case 'classe': return '#/classe/' + r.teachingId + '/' + r.scheda;
      case 'nucleoClasse': return '#/classe/' + r.teachingId + '/nucleo/' + r.nucleoId;
      case 'alunno': return '#/classe/' + r.teachingId + '/alunno/' + r.enrollmentId;
      case 'nucleoAlunno': return '#/classe/' + r.teachingId + '/alunno/' + r.enrollmentId + '/nucleo/' + r.nucleoId;
      case 'criterioAlunno': return '#/classe/' + r.teachingId + '/alunno/' + r.enrollmentId + '/nucleo/' + r.nucleoId + '/criterio/' + r.criterioId;
      case 'attivita': return '#/classe/' + r.teachingId + '/attivita/' + r.activityId + '/' + r.scheda;
      case 'amministrazione': return '#/amministrazione';
      default: return '#/insegnamenti';
    }
  }

  function daHash(hash) {
    var p = String(hash || '').replace(/^#\/?/, '').split('/');
    var id = function (i) { return Number(p[i]); };
    if (p[0] === 'materia' && p[1]) return { tipo: 'materia', subjectId: id(1) };
    if (p[0] === 'amministrazione') return { tipo: 'amministrazione' };
    if (p[0] === 'classe' && p[1]) {
      if (p[2] === 'nucleo') return { tipo: 'nucleoClasse', teachingId: id(1), nucleoId: id(3) };
      if (p[2] === 'alunno') {
        if (p[6] === 'criterio') return { tipo: 'criterioAlunno', teachingId: id(1), enrollmentId: id(3), nucleoId: id(5), criterioId: id(7) };
        if (p[4] === 'nucleo') return { tipo: 'nucleoAlunno', teachingId: id(1), enrollmentId: id(3), nucleoId: id(5) };
        return { tipo: 'alunno', teachingId: id(1), enrollmentId: id(3) };
      }
      if (p[2] === 'attivita' && p[3]) return { tipo: 'attivita', teachingId: id(1), activityId: id(3), scheda: p[4] === 'esito' ? 'esito' : 'griglia' };
      var schede = ['quadro', 'studenti', 'attivita', 'valutazioni'];
      return { tipo: 'classe', teachingId: id(1), scheda: schede.indexOf(p[2]) >= 0 ? p[2] : 'quadro' };
    }
    return { tipo: 'insegnamenti' };
  }

  /** Va a un livello: nuova voce nella storia (o sostituzione), poi disegna. */
  function vai(rotta, opzioni) {
    var metodo = opzioni && opzioni.sostituisci ? 'replaceState' : 'pushState';
    history[metodo]({ rotta: rotta }, '', versoHash(rotta));
    return disegna(rotta);
  }

  window.addEventListener('popstate', function (evento) {
    if (!stato.me || !stato.me.activeTenantId) return;
    disegna(evento.state && evento.state.rotta ? evento.state.rotta : daHash(location.hash));
  });

  // --- Cornice di ogni livello: «← superiore», briciole, titolo -------------------------

  function etichettaVoce(voce) {
    if (voce.classe) return el('span', {}, [voce.classe, ' · ', t('span', voce.chiave)]);
    return voce.chiave ? t('span', voce.chiave) : contenuto('span', voce.contenuto);
  }

  function testoVoce(voce) {
    if (voce.classe) return voce.classe + ' · ' + I18n.testo(voce.chiave);
    return voce.chiave ? I18n.testo(voce.chiave) : G.testoDi(voce.contenuto);
  }

  /** voci: [{ chiave | contenuto, rotta }] dal primo livello al corrente (l'ultimo senza rotta). */
  function cornice(voci) {
    var nav = $('percorso');
    nav.setAttribute('aria-label', I18n.testo('UI_BREADCRUMB'));
    nav.replaceChildren();
    voci.forEach(function (voce, i) {
      if (i > 0) nav.append(el('span', { classe: 'separatore', 'aria-hidden': 'true' }, ['›']));
      nav.append(voce.rotta && i < voci.length - 1
        ? el('a', { href: versoHash(voce.rotta), classe: 'collegamento', onclick: function (e) { e.preventDefault(); vai(voce.rotta); } }, [etichettaVoce(voce)])
        : el('span', { 'aria-current': 'page' }, [etichettaVoce(voce)]));
    });
    var superiore = voci.length > 1 ? voci[voci.length - 2] : null;
    if (!superiore) return null;
    return el('a', {
      href: versoHash(superiore.rotta), classe: 'indietro', 'aria-label': I18n.testo('UI_BACK_TO', { livello: testoVoce(superiore) }),
      onclick: function (e) { e.preventDefault(); vai(superiore.rotta); },
    }, [el('span', { 'aria-hidden': 'true' }, [G.SEGNI.BACK]), ' ', etichettaVoce(superiore)]);
  }

  function caricamento() {
    contenitore().replaceChildren(t('p', 'STATUS_LOADING', null, { classe: 'stato', role: 'status' }));
  }

  /** Disegna una rotta: azzera l'errore, mostra il caricamento, intercetta gli errori. */
  async function disegna(rotta) {
    stato.rotta = rotta;
    mostraErrore(null);
    caricamento();
    try {
      var vista = VISTE[rotta.tipo] || VISTE.insegnamenti;
      var nodi = await vista(rotta);
      if (stato.rotta !== rotta) return; // nel frattempo l'utente è andato altrove
      contenitore().replaceChildren.apply(contenitore(), nodi.filter(Boolean));
      var titolo = contenitore().querySelector('h2');
      if (titolo) { titolo.setAttribute('tabindex', '-1'); titolo.focus({ preventScroll: true }); }
    } catch (errore) {
      contenitore().replaceChildren();
      if (errore instanceof ErroreApi && errore.stato === 401) { mostraAccesso(); return; }
      mostraErrore(errore instanceof ErroreApi ? errore : { codice: 'ERR_INTERNAL' });
    }
  }

  // --- Accesso, intestazione, lingua, tenant --------------------------------------------

  function mostraAccesso() {
    stato.me = null;
    stato.insegnamenti = null;
    $('intestazione').hidden = true;
    $('percorso').replaceChildren();
    var email = el('input', { type: 'email', id: 'campo-email', required: true, autocomplete: 'username' });
    var password = el('input', { type: 'password', id: 'campo-password', required: true, autocomplete: 'current-password' });
    var invio = t('button', 'UI_LOGIN_SUBMIT', null, { type: 'submit', classe: 'azione' });
    var modulo = el('form', {
      classe: 'modulo-accesso',
      onsubmit: async function (evento) {
        evento.preventDefault();
        mostraErrore(null);
        invio.disabled = true;
        try {
          stato.me = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
          await avviaApp();
        } catch (errore) {
          mostraErrore(errore);
          invio.disabled = false;
        }
      },
    }, [
      t('h1', 'UI_LOGIN_TITLE'),
      t('label', 'UI_EMAIL', null, { for: 'campo-email' }), email,
      t('label', 'UI_PASSWORD', null, { for: 'campo-password' }), password,
      invio,
    ]);
    contenitore().replaceChildren(modulo);
  }

  function aggiornaIntestazione() {
    var me = stato.me;
    $('intestazione').hidden = false;
    $('titolo-app').textContent = I18n.testo('UI_APP_TITLE');
    var ruoli = Array.from(new Set((me.ruoliNelTenantAttivo || []).map(function (r) { return I18n.testo('ROLE_' + r.ruolo); })));
    $('utente').textContent = me.account.nome + ' ' + me.account.cognome
      + (ruoli.length ? ' · ' + new Intl.ListFormat(I18n.locale(), { type: 'unit' }).format(ruoli) : '');

    var selettoreTenant = $('tenant');
    $('etichetta-tenant').textContent = I18n.testo('UI_TENANT');
    selettoreTenant.replaceChildren(t('option', 'UI_TENANT_NONE', null, { value: '' }));
    me.tenantsDisponibiliPerSwitch.forEach(function (tn) {
      var id = tn.tenant_id !== undefined ? tn.tenant_id : tn.id;
      selettoreTenant.append(el('option', { value: id, selected: id === me.activeTenantId }, [tn.nome]));
    });
    selettoreTenant.onchange = async function () {
      if (!selettoreTenant.value) return;
      try {
        stato.me = await api('/auth/switch-tenant', { method: 'POST', body: JSON.stringify({ tenantId: Number(selettoreTenant.value) }) });
        await avviaApp({ radice: true });
      } catch (errore) { mostraErrore(errore); }
    };

    var lingue = (me.lingua && me.lingua.lingueAbilitate) || [];
    var selettoreLingua = $('lingua');
    $('blocco-lingua').hidden = lingue.length < 2;
    $('etichetta-lingua').textContent = I18n.testo('UI_LANGUAGE');
    selettoreLingua.replaceChildren();
    lingue.forEach(function (l) {
      selettoreLingua.append(t('option', 'UI_LANGUAGE_' + l.codice.toUpperCase().replace(/[^A-Z0-9]/g, '_'), null, {
        value: l.codice, selected: l.codice === me.lingua.codice,
      }));
    });
    selettoreLingua.onchange = async function () {
      try {
        await api('/me/lingua', { method: 'PUT', body: JSON.stringify({ lingua: selettoreLingua.value }) });
        stato.me = await api('/auth/me');
        stato.insegnamenti = null;
        await caricaCatalogo();
        aggiornaIntestazione();
        await disegna(stato.rotta || { tipo: 'insegnamenti' });
      } catch (errore) { mostraErrore(errore); }
    };

    $('esci').textContent = I18n.testo('UI_LOGOUT');
    $('come-leggere-apri').textContent = I18n.testo('HOW_TO_READ');
    $('come-leggere-apri').setAttribute('aria-expanded', String(stato.comeLeggere));
    var amministrazione = $('amministrazione');
    amministrazione.textContent = I18n.testo('UI_ADMINISTRATION');
    amministrazione.hidden = !(me.isPlatformAdmin || haPermesso('tenant.manage_config'));
    disegnaComeLeggere();
  }

  /** HOW_TO_READ (rev. 2 §17): legenda corta per il docente; il resto in «Dettagli». */
  function disegnaComeLeggere() {
    var pannello = $('come-leggere');
    pannello.hidden = !stato.comeLeggere;
    if (!stato.comeLeggere) return;
    var campione = function (classe) { return el('span', { classe: 'campione ' + classe, 'aria-hidden': 'true' }); };
    var voce = function (segnoNodo, chiave) { return el('li', {}, [segnoNodo, ' ', t('span', chiave)]); };
    pannello.replaceChildren(
      t('h2', 'HOW_TO_READ'),
      el('div', { classe: 'legenda' }, [
        el('ul', {}, [
          voce(campione('osservato'), 'LEGEND_OBSERVED'),
          voce(el('span', { classe: 'valore nullo', 'aria-hidden': 'true' }, [G.SEGNI.NOT_OBSERVED]), 'LEGEND_NOT_OBSERVED'),
          voce(el('span', { classe: 'segno-legenda', 'aria-hidden': 'true' }, [G.SEGNI.HISTORICAL_LEVEL]), 'LEGEND_HISTORY'),
          voce(el('span', { classe: 'segno-legenda forte', 'aria-hidden': 'true' }, [G.SEGNI.CLASS_REFERENCE]), 'LEGEND_CLASS'),
        ]),
        el('ul', {}, [
          voce(campione('parziale'), 'LEGEND_PARTIAL'),
          voce(campione('zona-critica'), 'LEGEND_CRITICAL_ZONE'),
          voce(el('span', { classe: 'segno pieno', 'aria-hidden': 'true' }, [G.SEGNI.CRITICAL]), 'CRITICAL_BAND'),
          voce(el('span', { classe: 'segno contorno', 'aria-hidden': 'true' }, [G.SEGNI.CRITICAL]), 'CRITICAL_TO_VERIFY'),
          voce(el('span', { classe: 'segno-legenda', 'aria-hidden': 'true' }, [G.SEGNI.COMPARISON_ABOVE + ' ' + G.SEGNI.COMPARISON_BELOW + ' ' + G.SEGNI.COMPARISON_ALIGNED]), 'LEGEND_COMPARISON'),
        ]),
        el('div', { classe: 'legenda-bande' }, [t('p', 'LEGEND_BANDS_INTRO', null, { classe: 'nota' }), el('ul', { id: 'legenda-bande' })]),
      ]),
      el('details', { classe: 'dettagli' }, [
        t('summary', 'UI_DETAILS'),
        el('ul', {}, ['DETAIL_BASE', 'DETAIL_CERTAINTY', 'DETAIL_TO_VERIFY', 'DETAIL_EXCLUDED', 'DETAIL_CURRENT_VALUE'].map(function (c) { return t('li', c); })),
      ])
    );
    aggiornaLegendaBande();
  }

  /** Le bande della legenda sono quelle dell'istituto, con il colore ricevuto dal server. */
  var ultimeBande = null;
  function aggiornaLegendaBande(bande) {
    if (bande) ultimeBande = bande;
    var lista = document.getElementById('legenda-bande');
    if (!lista || !ultimeBande) return;
    // Campioni «osservato» e «parziale» con i colori delle bande ricevuti dal server (mai scritti nel client).
    var colori = ultimeBande.map(function (b) { return b.colore; });
    document.querySelectorAll('#come-leggere .campione.osservato').forEach(function (c) { c.style.setProperty('background', 'conic-gradient(' + colori.join(', ') + ')'); });
    document.querySelectorAll('#come-leggere .campione.parziale').forEach(function (c) {
      c.style.setProperty('background', 'repeating-linear-gradient(135deg, ' + colori[0] + ' 0 3px, rgba(255, 255, 255, .6) 3px 6px)');
    });
    lista.replaceChildren.apply(lista, ultimeBande.map(function (b) {
      return el('li', {}, [el('span', { classe: 'campione', 'aria-hidden': 'true', stile: { 'background-color': b.colore } }), ' ', contenuto('span', b.etichetta)]);
    }));
  }

  async function avviaApp(opzioni) {
    await caricaCatalogo();
    aggiornaIntestazione();
    if (!stato.me.activeTenantId) {
      $('percorso').replaceChildren();
      contenitore().replaceChildren(t('p', 'UI_SELECT_TENANT_PROMPT', null, { classe: 'stato' }));
      return;
    }
    stato.insegnamenti = null;
    var rotta = opzioni && opzioni.radice ? { tipo: 'insegnamenti' } : daHash(location.hash);
    await vai(rotta, { sostituisci: true });
  }

  // --- Dati condivisi -------------------------------------------------------------------

  async function insegnamenti() {
    if (!stato.insegnamenti) stato.insegnamenti = await api('/teachings');
    return stato.insegnamenti;
  }

  async function insegnamento(teachingId) {
    var tn = (await insegnamenti()).find(function (x) { return x.teaching_id === teachingId; });
    if (!tn) throw new ErroreApi({ codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_TEACHING' } }, 404);
    return tn;
  }

  function ctxDi(r, scala) {
    aggiornaLegendaBande(r.bande);
    return { bande: r.bande, precisione: r.precisione, scala: scala || r.scala || null };
  }

  var RADICE = { chiave: 'UI_TEACHINGS', rotta: { tipo: 'insegnamenti' } };
  function voceMateria(tn) { return { contenuto: tn.materia, rotta: { tipo: 'materia', subjectId: tn.subject_id } }; }
  /** Voce «2A · Scheda»: un solo passo per tornare alla scheda della classe da cui si è partiti. */
  function voceClasse(tn, scheda) {
    var definizione = SCHEDE.find(function (s) { return s.id === scheda; });
    return { classe: tn.classe, chiave: definizione.chiave, rotta: { tipo: 'classe', teachingId: tn.teaching_id, scheda: scheda } };
  }

  var SCHEDE = [
    { id: 'quadro', chiave: 'VIEW_CLASS_OVERVIEW' },
    { id: 'studenti', chiave: 'VIEW_STUDENTS' },
    { id: 'attivita', chiave: 'VIEW_ACTIVITIES' },
    { id: 'valutazioni', chiave: 'VIEW_ASSESSMENT' },
  ];

  function titoloClasse(tn, extra) {
    return el('h2', {}, [contenuto('span', tn.materia), ' · ', tn.classe].concat(extra ? [' · '].concat(extra) : []));
  }

  function avviso(chiave) {
    if (!chiave) return null;
    return el('div', { classe: 'avviso', role: 'status' }, [
      G.segno(G.SEGNI.CRITICAL, chiave, null, 'pieno'), ' ', t('strong', chiave), ' ', t('span', chiave + '_DETAIL'),
    ]);
  }

  function sezione(chiave, figli, classe) {
    return el('section', { classe: 'sezione ' + (classe || '') }, [t('h3', chiave)].concat(figli));
  }

  function carte(elenco) { return el('div', { classe: 'carte' }, elenco); }

  function esclusioni(voci) {
    if (!voci || !voci.length) return null;
    return sezione('EXCLUDED', [el('ul', { classe: 'esclusioni' }, voci.map(function (e) {
      return el('li', {}, [G.SEGNI.OBSERVATION_EXCLUDED, ' ', t('span', e.motivo), ' · ', t('span', 'UI_OBSERVATION_COUNT', { n: e.osservazioni })]);
    }))], 'attenuata');
  }

  function righeRiferimenti(storico, classe, base, chiaveBase, ctx) {
    return [
      storico && G.osservato(storico) ? G.riferimentoTesto('HISTORICAL_LEVEL', storico, ctx) : null,
      classe ? G.riferimentoTesto('UI_REFERENCE_CLASS', classe, ctx) : null,
      base ? t('span', chiaveBase, { n: base.n, N: base.N }) : null,
    ].filter(Boolean).map(function (n, i, tutti) { return i < tutti.length - 1 ? el('span', {}, [n, ' · ']) : n; });
  }

  function dettaglio(nodi) { return nodi.length ? el('span', {}, nodi) : null; }

  // --- VISTE ------------------------------------------------------------------------------

  var VISTE = {};

  VISTE.insegnamenti = async function () {
    cornice([RADICE]);
    var elenco = await insegnamenti();
    var materie = [];
    elenco.forEach(function (tn) {
      if (!materie.find(function (m) { return m.id === tn.subject_id; })) materie.push({ id: tn.subject_id, materia: tn.materia });
    });
    return [
      t('h2', 'UI_TEACHINGS'),
      materie.length ? el('div', { classe: 'elenco' }, materie.map(function (m) {
        return el('a', { href: versoHash({ tipo: 'materia', subjectId: m.id }), classe: 'scelta', onclick: function (e) { e.preventDefault(); vai({ tipo: 'materia', subjectId: m.id }); } },
          [contenuto('span', m.materia, { classe: 'titolo' })]);
      })) : t('p', 'UI_EMPTY_TEACHINGS', null, { classe: 'stato' }),
    ];
  };

  VISTE.materia = async function (r) {
    var elenco = (await insegnamenti()).filter(function (tn) { return tn.subject_id === r.subjectId; });
    if (!elenco.length) throw new ErroreApi({ codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_TEACHING' } }, 404);
    var indietro = cornice([RADICE, { contenuto: elenco[0].materia }]);
    return [indietro, contenuto('h2', elenco[0].materia), el('div', { classe: 'elenco' }, elenco.map(function (tn) {
      var rotta = { tipo: 'classe', teachingId: tn.teaching_id, scheda: 'quadro' };
      return el('a', { href: versoHash(rotta), classe: 'scelta', onclick: function (e) { e.preventDefault(); vai(rotta); } }, [
        el('span', { classe: 'titolo' }, [tn.classe]),
        t('span', tn.proprio ? 'UI_CLASS_SUBTITLE_OWN' : 'UI_CLASS_SUBTITLE', { anno: tn.anno_scolastico, docente: tn.docente.nome + ' ' + tn.docente.cognome }, { classe: 'sottotitolo' }),
      ]);
    }))];
  };

  /** Classe: le quattro viste del percorso unico, come schede (ogni scheda è un livello della storia). */
  VISTE.classe = async function (r) {
    var tn = await insegnamento(r.teachingId);
    var definizione = SCHEDE.find(function (s) { return s.id === r.scheda; }) || SCHEDE[0];
    var indietro = cornice([RADICE, voceMateria(tn), { contenuto: tn.classe }]);
    var schede = el('div', { classe: 'schede', role: 'tablist' }, SCHEDE.map(function (s) {
      var rotta = { tipo: 'classe', teachingId: tn.teaching_id, scheda: s.id };
      return t('a', s.chiave, null, {
        href: versoHash(rotta), role: 'tab', 'aria-selected': String(s.id === definizione.id), classe: 'scheda',
        onclick: function (e) { e.preventDefault(); vai(rotta); },
      });
    }));
    var corpo = await SCHEDE_CLASSE[definizione.id](tn);
    return [indietro, el('h2', {}, [contenuto('span', tn.materia), ' · ', tn.classe, ' · ', tn.anno_scolastico]), schede,
      el('div', { classe: 'corpo-scheda', role: 'tabpanel' }, corpo.filter(Boolean))];
  };

  var SCHEDE_CLASSE = {};

  /** QUADRO CLASSE (L0): disco dei nuclei della classe, «Da guardare», alunni per banda, carte. */
  SCHEDE_CLASSE.quadro = async function (tn) {
    var q = await api('/teachings/' + tn.teaching_id + '/class-overview');
    var ctx = ctxDi(q);
    var apriNucleo = function (n) { return function () { vai({ tipo: 'nucleoClasse', teachingId: tn.teaching_id, nucleoId: n.id }); }; };
    var settori = q.nuclei.map(function (n) {
      return { chiave: 'nucleo-' + n.id, nome: n.nome, valore: n.risultato, confronto: n.confrontoConComplessivo, chiaveConfronto: 'UI_VS_CLASS_OVERALL', apri: apriNucleo(n) };
    });
    var blocco = q.bloccoAttenzione.map(function (voce) {
      var nucleo = q.nuclei.find(function (n) { return n.id === voce.nucleoId; });
      return el('li', {}, [el('a', { href: versoHash({ tipo: 'nucleoClasse', teachingId: tn.teaching_id, nucleoId: nucleo.id }), classe: 'collegamento', onclick: function (e) { e.preventDefault(); apriNucleo(nucleo)(); } }, [
        G.segno(G.SEGNI.CRITICAL, 'CRITICAL_BAND', null, 'pieno'), ' ', voce.codice ? voce.codice + ' ' : '', contenuto('span', voce.nome),
      ])]);
    });
    return [
      avviso(q.avviso),
      el('div', { classe: 'panoramica' }, [
        G.discoConTabella({ aria: I18n.testo('VIEW_CLASS_OVERVIEW'), centro: q.complessivo, centroRiga: { nome: I18n.testo('UI_OVERALL'), valore: q.complessivo }, settori: settori }, ctx),
        el('div', { classe: 'pannello-laterale' }, [
          sezione('ATTENTION_BLOCK', [blocco.length ? el('ul', { classe: 'blocco-attenzione' }, blocco) : t('p', 'UI_ATTENTION_EMPTY', null, { classe: 'stato' })]),
          sezione('DISTRIBUTION', [
            G.distribuzioneBande(q.distribuzione, ctx),
            el('p', { classe: 'nota' }, [t('span', 'UI_BASE_STUDENTS', q.distribuzione.base), ' · ', t('span', q.distribuzione.certezza)]),
          ]),
        ]),
      ]),
      sezione('UI_NUCLEI', [carte(q.nuclei.map(function (n) {
        return G.carta({
          chiave: 'nucleo-' + n.id, nome: n.nome, valore: n.risultato, confronto: n.confrontoConComplessivo, chiaveConfronto: 'UI_VS_CLASS_OVERALL',
          righe: [dettaglio(righeRiferimenti(null, null, n.risultato.base, 'UI_BASE_CRITERIA', ctx))], apri: n.grigliaNonConfigurata ? null : apriNucleo(n),
        }, ctx);
      }))]),
      esclusioni(q.esclusioni),
    ];
  };

  /** Nucleo della classe (L1): stesso disco, settori = criteri; confronto con il nucleo. */
  VISTE.nucleoClasse = async function (r) {
    var tn = await insegnamento(r.teachingId);
    var q = await api('/teachings/' + tn.teaching_id + '/class-overview');
    var ctx = ctxDi(q);
    var n = q.nuclei.find(function (x) { return x.id === r.nucleoId; });
    if (!n) throw new ErroreApi({ codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_CRITERION' } }, 404);
    var indietro = cornice([RADICE, voceMateria(tn), voceClasse(tn, 'quadro'), { contenuto: n.nome }]);
    var settori = n.criteri.map(function (c) {
      return { chiave: 'criterio-' + c.id, nome: c.codice, nomeEsteso: c.codice + ' ' + G.testoDi(c.descrizione), valore: c.risultato, confronto: c.confrontoConNucleo, chiaveConfronto: 'UI_VS_NUCLEUS' };
    });
    return [
      indietro, titoloClasse(tn, [contenuto('span', n.nome)]),
      G.discoConTabella({ aria: G.testoDi(n.nome), centro: n.risultato, centroRiga: { nome: n.nome, valore: n.risultato }, settori: settori }, ctx),
      sezione('UI_CRITERIA', [carte(n.criteri.map(function (c) {
        return G.carta({
          chiave: 'criterio-' + c.id, nome: el('span', {}, [c.codice, ' ', contenuto('span', c.descrizione)]), valore: c.risultato,
          confronto: c.confrontoConNucleo, chiaveConfronto: 'UI_VS_NUCLEUS', righe: [dettaglio(righeRiferimenti(null, null, c.risultato.base, 'UI_BASE_STUDENTS', ctx))],
        }, ctx);
      }))]),
    ];
  };

  /** STUDENTI: mini-dischi (stesso nucleo = stesso settore per tutti), centro = complessivo (E3), filtro P12. */
  SCHEDE_CLASSE.studenti = async function (tn) {
    var m = await api('/teachings/' + tn.teaching_id + '/students-matrix');
    var ctx = ctxDi(m);
    var filtro = el('input', { type: 'checkbox', id: 'filtro-zona-critica' });
    var griglia = el('ul', { classe: 'griglia-alunni' });
    var tabella = el('table', { classe: 'tabella-equivalente matrice' });
    var vuoto = t('p', 'UI_EMPTY_FILTER', null, { classe: 'stato', hidden: true });
    var nomeNucleo = function (id) { return m.nuclei.find(function (n) { return n.id === id; }).nome; };
    function aggiorna() {
      var visibili = m.studenti.filter(function (s) { return !filtro.checked || s.inZonaCritica; });
      griglia.replaceChildren.apply(griglia, visibili.map(function (s) {
        var rotta = { tipo: 'alunno', teachingId: tn.teaching_id, enrollmentId: s.enrollmentId };
        var descrizione = nomeStudente(s) + ' · ' + I18n.testo('UI_OVERALL') + ' '
          + (G.osservato(s.complessivo) ? G.percentuale(s.complessivo.percentuale, ctx.precisione.dettaglio) : I18n.testo('NOT_OBSERVED'))
          + (s.inZonaCritica ? ' · ' + I18n.testo('UI_IN_CRITICAL_ZONE') : '');
        var mini = G.disco({
          mini: true, aria: descrizione, centro: s.complessivo,
          settori: s.celle.map(function (c) { return { chiave: 'nucleo-' + c.nucleoId, nome: nomeNucleo(c.nucleoId), valore: c }; }),
        }, ctx);
        return el('li', {}, [el('a', {
          href: versoHash(rotta), classe: 'alunno' + (s.inZonaCritica ? ' in-zona' : ''), 'aria-label': descrizione, 'data-alunno': s.enrollmentId,
          onclick: function (e) { e.preventDefault(); vai(rotta); },
        }, [mini, el('span', { classe: 'nome-alunno' }, [nomeStudente(s)])])]);
      }));
      tabella.replaceChildren(
        el('caption', {}, [t('span', 'VIEW_STUDENTS')]),
        el('thead', {}, [el('tr', {}, [t('th', 'COLUMN_NAME', null, { scope: 'col' }), t('th', 'UI_OVERALL', null, { scope: 'col' })]
          .concat(m.nuclei.map(function (n) { return contenuto('th', n.nome, { scope: 'col' }); })))]),
        el('tbody', {}, visibili.map(function (s) {
          var cella = function (v) {
            return el('td', {}, [G.numero(v, ctx), ' ', v && v.giudizio ? contenuto('span', v.giudizio) : null, ' ', v && v.certezza ? t('span', v.certezza, null, { classe: 'tenue' }) : null,
              v && v.criticita ? el('span', {}, [' · ', t('span', v.criticita)]) : null]);
          };
          return el('tr', {}, [el('th', { scope: 'row' }, [nomeStudente(s)]), cella(s.complessivo)].concat(s.celle.map(cella)));
        }))
      );
      vuoto.hidden = visibili.length > 0;
    }
    filtro.addEventListener('change', aggiorna);
    aggiorna();
    var contenitoreTabella = el('div', { classe: 'tabella-alternativa', hidden: true }, [tabella]);
    var pulsante = t('button', 'UI_SHOW_TABLE', null, { type: 'button', classe: 'mostra-tabella', 'aria-expanded': 'false' });
    pulsante.addEventListener('click', function () {
      var aperta = contenitoreTabella.hidden;
      contenitoreTabella.hidden = !aperta;
      pulsante.setAttribute('aria-expanded', String(aperta));
      pulsante.textContent = I18n.testo(aperta ? 'UI_HIDE_TABLE' : 'UI_SHOW_TABLE');
    });
    return [
      el('div', { classe: 'filtri' }, [filtro, t('label', 'UI_FILTER_CRITICAL_ZONE', null, { for: 'filtro-zona-critica' })]),
      el('p', { classe: 'nota' }, [t('span', 'UI_MATRIX_SECTORS'), ' ', new Intl.ListFormat(I18n.locale(), { type: 'conjunction' }).format(m.nuclei.map(function (n) { return G.testoDi(n.nome); }))]),
      griglia, vuoto, pulsante, contenitoreTabella,
    ];
  };

  /** Profilo alunno (L0 studente): una sola richiesta per profilo, nucleo e criterio. */
  async function profilo(r) {
    var tn = await insegnamento(r.teachingId);
    var p = await api('/teachings/' + tn.teaching_id + '/students/' + r.enrollmentId + '/progress');
    var voci = [RADICE, voceMateria(tn), voceClasse(tn, 'studenti')];
    return { tn: tn, p: p, ctx: ctxDi(p), voci: voci, rottaAlunno: { tipo: 'alunno', teachingId: tn.teaching_id, enrollmentId: r.enrollmentId } };
  }

  function settoreNucleoAlunno(n, apri) {
    return {
      chiave: 'nucleo-' + n.id, nome: n.nome, valore: n.risultatoCorrente, riferimentoClasse: n.riferimentoClasse, storico: n.cumulativo,
      confronto: n.confrontoConComplessivo, chiaveConfronto: 'UI_VS_OWN_OVERALL', apri: n.grigliaNonConfigurata ? null : apri,
    };
  }

  VISTE.alunno = async function (r) {
    var d = await profilo(r);
    var p = d.p;
    var ctx = d.ctx;
    var indietro = cornice(d.voci.concat([{ contenuto: nomeStudente(p.alunno) }]));
    var apri = function (n) { return function () { vai({ tipo: 'nucleoAlunno', teachingId: d.tn.teaching_id, enrollmentId: r.enrollmentId, nucleoId: n.id }); }; };
    return [
      indietro,
      el('h2', {}, [nomeStudente(p.alunno), ' ', el('span', { classe: 'sottotitolo' }, [contenuto('span', d.tn.materia), ' · ', d.tn.classe])]),
      avviso(p.avviso),
      G.discoConTabella({
        aria: nomeStudente(p.alunno), centro: p.complessivo, centroRiga: { nome: I18n.testo('UI_OVERALL'), valore: p.complessivo },
        settori: p.nuclei.map(function (n) { return settoreNucleoAlunno(n, apri(n)); }),
      }, ctx),
      sezione('UI_NUCLEI', [carte(p.nuclei.map(function (n) {
        var s = settoreNucleoAlunno(n, apri(n));
        return G.carta({
          chiave: s.chiave, nome: n.nome, valore: n.risultatoCorrente, confronto: n.confrontoConComplessivo, chiaveConfronto: 'UI_VS_OWN_OVERALL',
          righe: [dettaglio(righeRiferimenti(n.cumulativo, n.riferimentoClasse, n.risultatoCorrente.base, 'UI_BASE_CRITERIA', ctx))], apri: s.apri,
        }, ctx);
      }))]),
      sezioneValutazioni(p.valutazioni, ctx, false),
      p.criteriNonPiuAttivi.length ? sezioneNonPiuAttivi(p.criteriNonPiuAttivi, ctx) : null,
    ];
  };

  VISTE.nucleoAlunno = async function (r) {
    var d = await profilo(r);
    var p = d.p;
    var ctx = d.ctx;
    var n = p.nuclei.find(function (x) { return x.id === r.nucleoId; });
    if (!n) throw new ErroreApi({ codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_CRITERION' } }, 404);
    var indietro = cornice(d.voci.concat([{ contenuto: nomeStudente(p.alunno), rotta: d.rottaAlunno }, { contenuto: n.nome }]));
    var apri = function (c) { return function () { vai({ tipo: 'criterioAlunno', teachingId: d.tn.teaching_id, enrollmentId: r.enrollmentId, nucleoId: n.id, criterioId: c.id }); }; };
    if (!n.criteri.length) return [indietro, el('h2', {}, [contenuto('span', n.nome)]), t('p', 'NOT_CONFIGURED', null, { classe: 'stato' })];
    return [
      indietro,
      el('h2', {}, [contenuto('span', n.nome), ' ', el('span', { classe: 'sottotitolo' }, [nomeStudente(p.alunno)])]),
      G.discoConTabella({
        aria: G.testoDi(n.nome), centro: n.risultatoCorrente, centroRiga: { nome: n.nome, valore: n.risultatoCorrente, storico: n.cumulativo, riferimentoClasse: n.riferimentoClasse },
        settori: n.criteri.map(function (c) {
          return { chiave: 'criterio-' + c.id, nome: c.codice, nomeEsteso: c.codice + ' ' + G.testoDi(c.descrizione), valore: c.risultatoCorrente, riferimentoClasse: c.riferimentoClasse, storico: c.cumulativo, apri: apri(c) };
        }),
      }, ctx),
      sezione('UI_CRITERIA', [carte(n.criteri.map(function (c) {
        return G.carta({
          chiave: 'criterio-' + c.id, nome: el('span', {}, [c.codice, ' ', contenuto('span', c.descrizione)]), valore: c.risultatoCorrente,
          righe: [dettaglio(righeRiferimenti(c.cumulativo, c.riferimentoClasse, c.risultatoCorrente.base, 'UI_BASE_OBSERVATIONS', ctx))], apri: apri(c),
        }, ctx);
      }))]),
    ];
  };

  /** Criterio (L2) e osservazioni (L3): disco pieno, poi la sequenza con valori colorati (0…n) e finestra corrente. */
  VISTE.criterioAlunno = async function (r) {
    var d = await profilo(r);
    var p = d.p;
    var ctx = d.ctx;
    var n = p.nuclei.find(function (x) { return x.id === r.nucleoId; });
    var c = n && n.criteri.find(function (x) { return x.id === r.criterioId; });
    if (!c) throw new ErroreApi({ codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_CRITERION' } }, 404);
    var indietro = cornice(d.voci.concat([
      { contenuto: nomeStudente(p.alunno), rotta: d.rottaAlunno },
      { contenuto: n.nome, rotta: { tipo: 'nucleoAlunno', teachingId: d.tn.teaching_id, enrollmentId: r.enrollmentId, nucleoId: n.id } },
      { contenuto: c.codice },
    ]));
    return [
      indietro,
      el('h2', {}, [c.codice, ' · ', contenuto('span', c.descrizione), ' ', el('span', { classe: 'sottotitolo' }, [nomeStudente(p.alunno)])]),
      el('div', { classe: 'criterio-testa' }, [
        G.discoConTabella({
          aria: c.codice + ' ' + G.testoDi(c.descrizione), centro: c.risultatoCorrente,
          settori: [{ chiave: 'criterio-' + c.id, nome: c.codice, nomeEsteso: c.codice + ' ' + G.testoDi(c.descrizione), valore: c.risultatoCorrente, riferimentoClasse: c.riferimentoClasse, storico: c.cumulativo }],
        }, ctx),
        el('div', { classe: 'pannello-laterale' }, [
          G.carta({ chiave: 'criterio-' + c.id, nome: el('span', {}, [c.codice]), valore: c.risultatoCorrente, righe: [dettaglio(righeRiferimenti(c.cumulativo, c.riferimentoClasse, c.risultatoCorrente.base, 'UI_BASE_OBSERVATIONS', ctx))] }, ctx),
          t('p', 'DETAIL_CURRENT_VALUE', null, { classe: 'nota' }),
        ]),
      ]),
      sequenza(c.osservazioni, ctx),
    ];
  };

  /**
   * L3 OSSERVAZIONI: data, attività, valore (colore della sua banda, E2), etichetta, uso.
   * Le righe della finestra corrente ⟦ ⟧ hanno uno sfondo; le escluse restano, attenuate, con il motivo.
   */
  function sequenza(osservazioni, ctx) {
    if (!osservazioni.length) return sezione('UI_OBSERVATIONS', [t('p', 'NOT_OBSERVED', null, { classe: 'stato' })]);
    var righe = osservazioni.map(function (o) {
      var uso = !o.conteggiata
        ? el('span', {}, [t('span', 'EXCLUDED'), ': ', t('span', o.motivoEsclusione)])
        : t('span', o.inFinestra ? 'UI_OBS_IN_WINDOW' : 'UI_OBS_HISTORY_ONLY');
      return el('tr', { classe: (o.inFinestra ? 'in-finestra' : '') + (o.conteggiata ? '' : ' esclusa'), 'data-osservazione': o.observationId }, [
        el('td', {}, [el('bdi', {}, [I18n.data(o.dataOsservazione)])]),
        el('td', {}, [contenuto('span', o.attivita)]),
        el('td', { classe: 'cella-valore' }, [o.etichetta ? G.valoreScala(o.valore, ctx) : el('span', { classe: 'valore senza-banda' }, [I18n.numero(o.valore, 0)]), ' ', contenuto('span', o.etichetta)]),
        el('td', {}, [uso]),
        el('td', {}, [contenuto('span', o.nota)]),
      ]);
    });
    return sezione('UI_OBSERVATIONS', [el('div', { classe: 'scorrimento' }, [el('table', { classe: 'osservazioni' }, [
      el('caption', { classe: 'nascosta' }, [t('span', 'UI_OBSERVATIONS')]),
      el('thead', {}, [el('tr', {}, ['COLUMN_DATE', 'COLUMN_ACTIVITY', 'COLUMN_VALUE', 'COLUMN_USE', 'COLUMN_NOTE'].map(function (k) { return t('th', k, null, { scope: 'col' }); }))]),
      el('tbody', {}, righe),
    ])]), el('p', { classe: 'nota' }, [el('span', { classe: 'campione finestra', 'aria-hidden': 'true' }), ' ', el('span', { 'aria-hidden': 'true' }, ['⟦ ⟧ ']), t('span', 'LEGEND_WINDOW')])]);
  }

  function sezioneNonPiuAttivi(criteri) {
    return sezione('EXCLUDED', criteri.map(function (c) {
      return el('div', {}, [
        el('p', {}, [c.codice, ' ', contenuto('span', c.descrizione), ' · ', contenuto('span', c.nucleo)]),
        el('ul', {}, c.osservazioni.map(function (o) {
          return el('li', {}, [G.SEGNI.OBSERVATION_EXCLUDED, ' ', el('bdi', {}, [I18n.data(o.dataOsservazione)]), ' · ', contenuto('span', o.attivita), ' · ', t('span', o.motivoEsclusione)]);
        })),
      ]);
    }), 'attenuata');
  }

  // --- VALUTAZIONI: ■ giudizio del docente (colore della banda solo se abbinato, E4), periodo, evidenza ---

  function giudizioDocente(v, ctx) {
    var b = G.banda(ctx, v.bandaId);
    return el('span', { classe: 'giudizio-docente' }, [
      el('span', { classe: 'segno timbro', role: 'img', 'aria-label': I18n.testo('TEACHER_ASSESSMENT'), title: I18n.testo('TEACHER_ASSESSMENT'), stile: b ? { color: b.colore } : null }, [G.SEGNI.TEACHER_ASSESSMENT]),
      ' ',
      contenuto('strong', v.giudizio, { classe: 'chip giudizio' + (b ? '' : ' senza-banda'), 'data-banda': b ? b.id : null, stile: b ? { 'background-color': b.colore, color: b.inchiostro } : null }),
      ' ', t('span', 'TEACHER_ASSESSMENT', null, { classe: 'nota' }),
    ]);
  }

  function sezioneValutazioni(valutazioni, ctx, conAlunno) {
    if (!valutazioni.length) return sezione('TEACHER_ASSESSMENT', [t('p', 'UI_EMPTY_ASSESSMENTS', null, { classe: 'stato' })]);
    return sezione('TEACHER_ASSESSMENT', valutazioni.map(function (v) {
      return el('article', { classe: 'valutazione', 'data-valutazione': v.id }, [
        el('p', { classe: 'timbro-riga' }, [giudizioDocente(v, ctx)]),
        el('p', { classe: 'nota' }, [
          conAlunno ? nomeStudente(v.alunno) + ' · ' : '',
          v.criterio ? el('span', {}, [v.criterio.codice, ' ', contenuto('span', v.criterio.descrizione)]) : t('span', 'UI_SUBJECT_ASSESSMENT'),
          ' · ', contenuto('span', v.periodo.nome), ' (', el('bdi', {}, [I18n.data(v.periodo.dataInizio)]), ' – ', el('bdi', {}, [I18n.data(v.periodo.dataFine)]), ')',
          ' · ', t('span', 'UI_AUTHOR', { autore: v.autore.nome + ' ' + v.autore.cognome }), ' · ', el('bdi', {}, [I18n.data(v.aggiornataIl)]),
        ]),
        v.evidenza ? el('p', { classe: 'evidenza' }, [t('span', 'UI_EVIDENCE'), ': ', G.numero(v.evidenza, ctx), ' ', G.chipBanda(v.evidenza, ctx), ' ', G.certezza(v.evidenza)]) : null,
      ]);
    }));
  }

  SCHEDE_CLASSE.valutazioni = async function (tn) {
    var r = await api('/teachings/' + tn.teaching_id + '/assessments');
    return [sezioneValutazioni(r.valutazioni, ctxDi(r), true)];
  };

  // --- ATTIVITÀ: elenco, griglia di inserimento, esito (P14) ------------------------------

  SCHEDE_CLASSE.attivita = async function (tn) {
    var id = tn.teaching_id;
    var risposte = await Promise.all([api('/teachings/' + id + '/activities'), api('/teachings/' + id + '/pedagogical-units')]);
    var attivita = risposte[0];
    var unita = risposte[1];
    return [
      haPermesso('activity.create') ? moduloNuovaAttivita(tn, unita) : null,
      attivita.length ? el('div', { classe: 'elenco' }, attivita.map(function (a) {
        var rotta = { tipo: 'attivita', teachingId: id, activityId: a.activity_id, scheda: 'griglia' };
        return el('a', { href: versoHash(rotta), classe: 'scelta', onclick: function (e) { e.preventDefault(); vai(rotta); } }, [
          contenuto('span', a.nome, { classe: 'titolo' }),
          el('span', { classe: 'sottotitolo' }, [contenuto('span', a.unita_pedagogica), ' · ', el('bdi', {}, [I18n.data(a.data_attivita)])]),
        ]);
      })) : t('p', 'UI_EMPTY_ACTIVITIES', null, { classe: 'stato' }),
    ];
  };

  function moduloNuovaAttivita(tn, unita) {
    var nome = el('input', { type: 'text', id: 'nuova-nome', required: true });
    var dataAttivita = el('input', { type: 'date', id: 'nuova-data', required: true });
    var scelta = el('select', { id: 'nuova-unita', required: true }, [t('option', 'UI_CHOOSE_UNIT', null, { value: '' })]
      .concat(unita.map(function (u) { return contenuto('option', u.nome, { value: u.id }); })));
    var invio = t('button', 'UI_CREATE_ACTIVITY', null, { type: 'submit', classe: 'azione' });
    return el('form', {
      classe: 'modulo',
      onsubmit: async function (evento) {
        evento.preventDefault();
        invio.disabled = true;
        try {
          await api('/teachings/' + tn.teaching_id + '/activities', {
            method: 'POST', body: JSON.stringify({ nome: nome.value, dataAttivita: dataAttivita.value, pedagogicalUnitId: Number(scelta.value) }),
          });
          await disegna({ tipo: 'classe', teachingId: tn.teaching_id, scheda: 'attivita' });
        } catch (errore) { mostraErrore(errore); invio.disabled = false; }
      },
    }, [
      t('h3', 'UI_NEW_ACTIVITY'),
      el('div', { classe: 'campi' }, [
        el('span', {}, [t('label', 'UI_FIELD_NOME', null, { for: 'nuova-nome' }), nome]),
        el('span', {}, [t('label', 'UI_FIELD_DATA_ATTIVITA', null, { for: 'nuova-data' }), dataAttivita]),
        el('span', {}, [t('label', 'UI_FIELD_UNIT', null, { for: 'nuova-unita' }), scelta]),
        invio,
      ]),
    ]);
  }

  VISTE.attivita = async function (r) {
    var tn = await insegnamento(r.teachingId);
    var elenco = await api('/teachings/' + tn.teaching_id + '/activities');
    var a = elenco.find(function (x) { return x.activity_id === r.activityId; });
    if (!a) throw new ErroreApi({ codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_ACTIVITY' } }, 404);
    var indietro = cornice([RADICE, voceMateria(tn), voceClasse(tn, 'attivita'), { contenuto: a.nome }]);
    var schede = el('div', { classe: 'schede', role: 'tablist' }, [['griglia', 'UI_GRID'], ['esito', 'VIEW_ACTIVITY_OUTCOME']].map(function (s) {
      var rotta = { tipo: 'attivita', teachingId: tn.teaching_id, activityId: a.activity_id, scheda: s[0] };
      return t('a', s[1], null, { href: versoHash(rotta), role: 'tab', 'aria-selected': String(s[0] === r.scheda), classe: 'scheda', onclick: function (e) { e.preventDefault(); vai(rotta); } });
    }));
    var corpo = r.scheda === 'esito' ? await esitoAttivita(a) : await grigliaAttivita(tn, a, r);
    return [indietro, el('h2', {}, [contenuto('span', a.nome), ' · ', el('bdi', {}, [I18n.data(a.data_attivita)])]), schede,
      el('div', { classe: 'corpo-scheda', role: 'tabpanel' }, corpo.filter(Boolean))];
  };

  /** Griglia di inserimento (P14: stessa semantica): ogni cella mostra il valore con il colore della sua banda; vuota = non osservato (grigio). */
  async function grigliaAttivita(tn, a, rotta) {
    var g = await api('/activities/' + a.activity_id + '/griglia');
    if (g.grigliaNonConfigurata) return [t('p', 'NOT_CONFIGURED', null, { classe: 'stato' })];
    var ctx = ctxDi(g);
    var scrittura = haPermesso('observation.create');
    var corpoTabella = el('tbody', {}, g.righe.map(function (riga) {
      var nomeAlunno = riga.cognome + ' ' + riga.nome;
      var celle = riga.celle.map(function (cella) {
        var criterio = g.criteri.find(function (c) { return c.id === cella.criterionId; });
        var segnoValore = G.valoreScala(cella.valore, ctx);
        if (!scrittura) {
          var voce = g.scala.valori.find(function (v) { return v.valore === cella.valore; });
          return el('td', { classe: 'cella-valore' }, [segnoValore, ' ', voce ? contenuto('span', voce.etichetta) : t('span', 'UI_NOT_ASSESSED')]);
        }
        var selettore = el('select', { 'aria-label': I18n.testo('UI_CELL_LABEL', { alunno: nomeAlunno, criterio: criterio.descrizione }) }, [
          t('option', 'UI_NOT_ASSESSED', null, { value: '' }),
        ].concat(g.scala.valori.map(function (v) {
          return t('option', 'UI_SCALE_OPTION', { valore: v.valore, etichetta: v.etichetta }, { value: v.valore, selected: cella.valore === v.valore });
        })));
        selettore.addEventListener('change', async function () {
          selettore.disabled = true;
          try {
            await api('/activities/' + a.activity_id + '/enrollments/' + riga.enrollmentId + '/criteria/' + cella.criterionId, {
              method: 'PUT', body: JSON.stringify({ valore: selettore.value === '' ? null : Number(selettore.value) }),
            });
            await disegna(rotta);
          } catch (errore) { mostraErrore(errore); selettore.disabled = false; }
        });
        return el('td', { classe: 'cella-valore' }, [segnoValore, ' ', selettore]);
      });
      return el('tr', {}, [el('th', { scope: 'row' }, [nomeAlunno])].concat(celle).concat([
        el('td', { classe: 'esito' }, [G.numero(riga.esito, ctx), ' ', G.chipBanda(riga.esito, ctx), ' ', t('span', 'BASE_COUNT', { n: riga.esito.base.n, N: riga.esito.base.N }, { classe: 'tenue' })]),
      ]));
    }));
    return [el('div', { classe: 'scorrimento' }, [el('table', { classe: 'griglia' }, [
      el('caption', { classe: 'nascosta' }, [t('span', 'UI_GRID')]),
      el('thead', {}, [el('tr', {}, [t('th', 'UI_STUDENT', null, { scope: 'col' })]
        .concat(g.criteri.map(function (c) { return el('th', { scope: 'col' }, [c.codice, ' ', contenuto('span', c.descrizione)]); }))
        .concat([t('th', 'UI_ACTIVITY_RESULT', null, { scope: 'col' })]))]),
      corpoTabella,
    ])])];
  }

  /** ESITO DELL'ATTIVITÀ (P14): solo i dati di questa attività; nessun ◇, nessuna finestra. */
  async function esitoAttivita(a) {
    var r = await api('/activities/' + a.activity_id + '/report-classe');
    if (r.grigliaNonConfigurata) return [t('p', 'NOT_CONFIGURED', null, { classe: 'stato' })];
    var ctx = ctxDi(r);
    return r.unitaPedagogiche.map(function (u) {
      return el('section', { classe: 'sezione' }, [
        G.discoConTabella({
          aria: G.testoDi(u.nome), centro: u.risultato, centroRiga: { nome: u.nome, valore: u.risultato },
          settori: u.criteri.map(function (c) { return { chiave: 'criterio-' + c.id, nome: c.codice, nomeEsteso: c.codice + ' ' + G.testoDi(c.descrizione), valore: c.esito }; }),
        }, ctx),
        el('div', { classe: 'criteri-esito' }, u.criteri.map(function (c) {
          return el('div', { classe: 'criterio-esito', 'data-criterio': c.id }, [
            G.carta({ chiave: 'criterio-' + c.id, nome: el('span', {}, [c.codice, ' ', contenuto('span', c.descrizione)]), valore: c.esito, righe: [t('span', 'UI_BASE_STUDENTS', c.base)] }, ctx),
            el('div', { classe: 'distribuzione-criterio' }, [t('p', 'UI_OBSERVED_VALUES', null, { classe: 'titoletto' }), G.distribuzioneValori(c.distribuzione, c.nonValutati, ctx)]),
          ]);
        })),
      ]);
    }).concat([esclusioni(r.esclusioni)]);
  }

  // --- Amministrazione (piattaforma: tenant; istituto: completezza delle traduzioni, B-6) ---

  VISTE.amministrazione = async function () {
    var indietro = cornice([RADICE, { chiave: 'UI_ADMINISTRATION' }]);
    var corpo = [indietro, t('h2', 'UI_ADMINISTRATION')];
    if (stato.me.isPlatformAdmin) {
      var tenants = await api('/platform/tenants');
      corpo.push(t('h3', 'UI_TENANTS'), el('ul', { classe: 'elenco-semplice' }, tenants.map(function (tn) {
        return el('li', {}, [tn.nome, ' · ', tn.slug, ' · ', t('span', 'STATUS_TENANT_' + tn.stato.toUpperCase())]);
      })));
    }
    if (stato.me.activeTenantId && haPermesso('tenant.manage_config')) {
      var completezza = await api('/admin/traduzioni/completezza');
      corpo.push(t('h3', 'UI_TRANSLATION_COMPLETENESS'));
      if (!completezza.lingue.length) corpo.push(t('p', 'UI_TRANSLATION_SINGLE_LANGUAGE', null, { classe: 'stato' }));
      completezza.lingue.forEach(function (l) {
        corpo.push(el('table', { classe: 'semplice' }, [
          el('caption', {}, [t('span', 'UI_LANGUAGE_' + l.lingua.toUpperCase().replace(/[^A-Z0-9]/g, '_'))]),
          el('tbody', {}, l.campi.map(function (c) {
            return el('tr', {}, [
              t('th', 'UI_TRANSLATION_FIELD_' + c.campo.toUpperCase().replace(/[^A-Z0-9]/g, '_'), null, { scope: 'row' }),
              el('td', {}, [t('span', 'BASE_COUNT', { n: c.tradotti, N: c.totale })]),
            ]);
          })),
        ]));
      });
    }
    return corpo;
  };

  // --- Avvio -------------------------------------------------------------------------

  $('esci').addEventListener('click', async function () {
    await api('/auth/logout', { method: 'POST' }).catch(function () {});
    history.replaceState(null, '', location.pathname);
    await caricaCatalogo();
    mostraAccesso();
  });
  $('come-leggere-apri').addEventListener('click', function () {
    stato.comeLeggere = !stato.comeLeggere;
    $('come-leggere-apri').setAttribute('aria-expanded', String(stato.comeLeggere));
    disegnaComeLeggere();
  });
  $('amministrazione').addEventListener('click', function () { vai({ tipo: 'amministrazione' }); });
  $('titolo-app').addEventListener('click', function () { if (stato.me && stato.me.activeTenantId) vai({ tipo: 'insegnamenti' }); });

  (async function () {
    await caricaCatalogo();
    try {
      stato.me = await api('/auth/me');
      await avviaApp();
    } catch (errore) {
      mostraAccesso();
    }
  }());
}());
