/*
 * Client V2: percorso unico (P15) Insegnamenti -> materia -> classe -> {Quadro, Studenti,
 * Attività, Valutazioni}; dentro le viste, gerarchia L0 -> L1 -> L2 -> L3 (§15) con la riga
 * selezionata che diventa l'intestazione della vista successiva (§12).
 *
 * Il client NON calcola (valori, bande, certezza, criticità, confronti e geometrie arrivano
 * dal server), NON contiene testi (tutto da I18n/catalogo), NON decide la lingua (catalogo
 * e direzione risolti dal server per la sessione), NON ordina per livello.
 */
(function () {
  'use strict';

  var G = window.Grammatica;
  var el = G.el;
  var t = G.t;
  var contenuto = G.contenuto;

  var stato = { me: null, percorso: [], ridisegna: null, comeLeggere: false };

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
  function ErroreApi(errore, stato) {
    this.codice = errore && errore.codice ? errore.codice : 'ERR_INTERNAL';
    this.parametri = (errore && errore.parametri) || {};
    this.stato = stato;
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

  function caricamento() {
    contenitore().replaceChildren(t('p', 'STATUS_LOADING', null, { classe: 'stato', role: 'status' }));
  }

  /** Esegue una vista: azzera l'errore, mostra lo stato di caricamento, intercetta gli errori. */
  async function vista(disegna) {
    stato.ridisegna = disegna;
    mostraErrore(null);
    caricamento();
    try {
      await disegna();
    } catch (errore) {
      contenitore().replaceChildren();
      if (errore instanceof ErroreApi && errore.stato === 401) return mostraAccesso();
      mostraErrore(errore instanceof ErroreApi ? errore : { codice: 'ERR_INTERNAL' });
    }
  }

  function haPermesso(codice) {
    return !!(stato.me && stato.me.permessiNelTenantAttivo && stato.me.permessiNelTenantAttivo.indexOf(codice) >= 0);
  }

  // --- Percorso (breadcrumb): un solo percorso di navigazione ---------------------------

  function impostaPercorso(voci) {
    stato.percorso = voci;
    var nav = $('percorso');
    nav.setAttribute('aria-label', I18n.testo('UI_BREADCRUMB'));
    nav.replaceChildren();
    voci.forEach(function (voce, i) {
      if (i > 0) nav.append(el('span', { classe: 'separatore', 'aria-hidden': 'true' }, ['›']));
      var etichetta = voce.chiave ? t('span', voce.chiave) : contenuto('span', voce.contenuto);
      nav.append(voce.apri && i < voci.length - 1
        ? el('button', { type: 'button', classe: 'collegamento', onclick: voce.apri }, [etichetta])
        : el('span', { 'aria-current': i === voci.length - 1 ? 'page' : null }, [etichetta]));
    });
  }

  // --- Accesso, intestazione, lingua, tenant --------------------------------------------

  function mostraAccesso() {
    stato.me = null;
    $('intestazione').hidden = true;
    impostaPercorso([]);
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
        await avviaApp();
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
        await caricaCatalogo();
        aggiornaIntestazione();
        impostaPercorso(stato.percorso);
        if (stato.ridisegna) await vista(stato.ridisegna);
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

  /** HOW_TO_READ (§15): legenda dei segni, solo su richiesta. */
  function disegnaComeLeggere() {
    var pannello = $('come-leggere');
    pannello.hidden = !stato.comeLeggere;
    if (!stato.comeLeggere) return;
    var S = G.SEGNI;
    var voci = [
      [S.OBSERVATION, 'OBSERVATION_LEGEND'], [S.OBSERVATION_EXCLUDED, 'OBSERVATION_EXCLUDED'], [S.AGGREGATE, 'AGGREGATE'],
      [null, 'OBSERVATION_DERIVED_LEVEL'], [S.TEACHER_ASSESSMENT, 'TEACHER_ASSESSMENT'], [S.REFERENCE_MARK, 'REFERENCE_MARK'],
      [S.HISTORICAL_LEVEL, 'CURRENT_VS_HISTORICAL_GAP'], [S.WINDOW_OPEN + ' ' + S.WINDOW_CLOSE, 'OBSERVATION_WINDOW'],
      [S.CRITICAL, 'CRITICAL_BAND'], [S.CRITICAL, 'CRITICAL_TO_VERIFY'],
      [S.COMPARISON_ABOVE, 'COMPARISON_ABOVE_LEGEND'], [S.COMPARISON_BELOW, 'COMPARISON_BELOW_LEGEND'], [S.COMPARISON_ALIGNED, 'COMPARISON_ALIGNED_LEGEND'],
      [null, 'COMPARISON_UNCONFIRMED'], [null, 'CERTAINTY_SUFFICIENT'], [null, 'CERTAINTY_PARTIAL'], [null, 'CERTAINTY_ABSENT'],
      [null, 'NOT_OBSERVED'], [null, 'INSUFFICIENT_DATA'], [null, 'NOT_CONFIGURED'], [null, 'BASE_COUNT_LEGEND'],
    ];
    pannello.replaceChildren(
      t('h2', 'HOW_TO_READ'),
      el('dl', { classe: 'legenda' }, voci.reduce(function (lista, voce) {
        var forma = voce[1] === 'CRITICAL_BAND' ? 'segno pieno' : voce[1] === 'CRITICAL_TO_VERIFY' ? 'segno contorno' : 'segno';
        lista.push(el('dt', { 'aria-hidden': 'true' }, [el('span', { classe: forma }, [voce[0] || ' '])]));
        lista.push(t('dd', voce[1]));
        return lista;
      }, []))
    );
  }

  async function avviaApp() {
    await caricaCatalogo();
    aggiornaIntestazione();
    if (!stato.me.activeTenantId) {
      impostaPercorso([]);
      contenitore().replaceChildren(t('p', 'UI_SELECT_TENANT_PROMPT', null, { classe: 'stato' }));
      return;
    }
    mostraInsegnamenti();
  }

  // --- Percorso unico: Insegnamenti -> materia -> classe ------------------------------

  var RADICE = { chiave: 'UI_TEACHINGS', apri: function () { mostraInsegnamenti(); } };

  function mostraInsegnamenti() {
    impostaPercorso([RADICE]);
    return vista(async function () {
      var insegnamenti = await api('/teachings');
      var materie = [];
      insegnamenti.forEach(function (tn) {
        var gruppo = materie.find(function (m) { return m.id === tn.subject_id; });
        if (!gruppo) { gruppo = { id: tn.subject_id, materia: tn.materia, insegnamenti: [] }; materie.push(gruppo); }
        gruppo.insegnamenti.push(tn);
      });
      var lista = el('div', { classe: 'elenco' });
      materie.forEach(function (m) {
        lista.append(el('button', { type: 'button', classe: 'scelta', onclick: function () { mostraClassiDiMateria(m); } }, [contenuto('span', m.materia, { classe: 'titolo' })]));
      });
      contenitore().replaceChildren(t('h2', 'UI_TEACHINGS'), materie.length ? lista : t('p', 'UI_EMPTY_TEACHINGS', null, { classe: 'stato' }));
    });
  }

  function mostraClassiDiMateria(materia) {
    var voceMateria = { contenuto: materia.materia, apri: function () { mostraClassiDiMateria(materia); } };
    impostaPercorso([RADICE, voceMateria]);
    return vista(async function () {
      var lista = el('div', { classe: 'elenco' });
      materia.insegnamenti.forEach(function (tn) {
        lista.append(el('button', { type: 'button', classe: 'scelta', onclick: function () { apriClasse(tn, materia, 'quadro'); } }, [
          el('span', { classe: 'titolo' }, [tn.classe]),
          t('span', tn.proprio ? 'UI_CLASS_SUBTITLE_OWN' : 'UI_CLASS_SUBTITLE', {
            anno: tn.anno_scolastico, docente: tn.docente.nome + ' ' + tn.docente.cognome,
          }, { classe: 'sottotitolo' }),
        ]));
      });
      contenitore().replaceChildren(contenuto('h2', materia.materia), lista);
    });
  }

  var SCHEDE = [
    { id: 'quadro', chiave: 'VIEW_CLASS_OVERVIEW', disegna: disegnaQuadro },
    { id: 'studenti', chiave: 'VIEW_STUDENTS', disegna: disegnaStudenti },
    { id: 'attivita', chiave: 'VIEW_ACTIVITIES', disegna: disegnaAttivita },
    { id: 'valutazioni', chiave: 'VIEW_ASSESSMENT', disegna: disegnaValutazioni },
  ];

  /** Classe: le quattro viste del percorso unico, come schede. */
  function apriClasse(tn, materia, scheda) {
    var contestoClasse = { teaching: tn, materia: materia };
    contestoClasse.voci = [
      RADICE,
      { contenuto: materia.materia, apri: function () { mostraClassiDiMateria(materia); } },
      { contenuto: tn.classe, apri: function () { apriClasse(tn, materia, scheda); } },
    ];
    var definizione = SCHEDE.find(function (s) { return s.id === scheda; });
    impostaPercorso(contestoClasse.voci.concat([{ chiave: definizione.chiave }]));
    return vista(async function () {
      var schede = el('div', { classe: 'schede', role: 'tablist' }, SCHEDE.map(function (s) {
        return t('button', s.chiave, null, {
          type: 'button', role: 'tab', 'aria-selected': String(s.id === scheda), classe: 'scheda',
          onclick: function () { apriClasse(tn, materia, s.id); },
        });
      }));
      var corpo = el('div', { classe: 'corpo-scheda', role: 'tabpanel' });
      await definizione.disegna(corpo, contestoClasse);
      contenitore().replaceChildren(
        el('h2', {}, [contenuto('span', materia.materia), ' · ', tn.classe, ' · ', tn.anno_scolastico]),
        schede, corpo
      );
    });
  }

  /** Ingresso in un livello interno (L1-L3) della classe: il percorso resta unico. */
  function apriLivello(contestoClasse, vociAggiuntive, disegna) {
    impostaPercorso(contestoClasse.voci.concat(vociAggiuntive));
    return vista(async function () {
      var corpo = el('div', { classe: 'corpo-scheda' });
      await disegna(corpo);
      contenitore().replaceChildren(corpo);
    });
  }

  function intestazioneVista(chiave) { return t('h3', chiave); }

  function avviso(chiave) {
    if (!chiave) return document.createDocumentFragment();
    return el('div', { classe: 'avviso', role: 'status' }, [
      G.segno(G.SEGNI.CRITICAL, chiave, null, 'pieno'), ' ', t('strong', chiave), ' ', t('span', chiave + '_DETAIL'),
    ]);
  }

  function nomeChiave(chiave) { return t('span', chiave); }

  function riferimento(r, chiave) {
    return r ? Object.assign({}, r, { chiave: chiave }) : null;
  }

  // --- QUADRO CLASSE (VIEW_CLASS_OVERVIEW, L0 classe) -----------------------------------

  async function disegnaQuadro(corpo, contestoClasse) {
    var q = await api('/teachings/' + contestoClasse.teaching.teaching_id + '/class-overview');
    var ctx = { bande: q.bande, precisione: q.precisione };
    corpo.append(avviso(q.avviso));
    corpo.append(el('section', { classe: 'livello' }, [
      G.intestazioneColonne(),
      G.riga({ chiave: 'complessivo', nome: nomeChiave('UI_OVERALL'), valore: q.complessivo }, ctx),
    ]));
    corpo.append(el('section', { classe: 'distribuzione-classe' }, [
      intestazioneVista('DISTRIBUTION'),
      G.distribuzione(q.distribuzione.bande, function (d) { return d.etichetta; }),
      el('p', { classe: 'nota' }, [t('span', 'BASE_COUNT', q.distribuzione.base), ' · ', t('span', q.distribuzione.certezza)]),
    ]));
    var blocco = el('ul', { classe: 'blocco-attenzione' });
    q.bloccoAttenzione.forEach(function (voce) {
      var nucleo = q.nuclei.find(function (n) { return n.id === voce.nucleoId; });
      blocco.append(el('li', {}, [el('button', { type: 'button', classe: 'collegamento', onclick: function () { apriNucleoClasse(contestoClasse, q, nucleo); } }, [
        G.segno(G.SEGNI.CRITICAL, 'CRITICAL_BAND', null, 'pieno'), ' ', voce.codice ? voce.codice + ' ' : '', contenuto('span', voce.nome),
      ])]));
    });
    corpo.append(el('section', { classe: 'attenzione' }, [
      intestazioneVista('ATTENTION_BLOCK'),
      q.bloccoAttenzione.length ? blocco : t('p', 'UI_ATTENTION_EMPTY', null, { classe: 'stato' }),
    ]));
    var nuclei = el('section', { classe: 'livello' }, [intestazioneVista('UI_NUCLEI'), G.intestazioneColonne()]);
    q.nuclei.forEach(function (n) {
      nuclei.append(G.riga({
        chiave: 'nucleo-' + n.id, nome: n.nome, valore: n.risultato, confronto: n.confrontoConComplessivo,
        riferimenti: [riferimento(n.confrontoConComplessivo && n.confrontoConComplessivo.riferimento, 'UI_REFERENCE_OVERALL')],
      }, ctx, function () { apriNucleoClasse(contestoClasse, q, n); }));
    });
    corpo.append(nuclei);
    if (q.esclusioni.length) corpo.append(esclusioni(q.esclusioni));
  }

  function esclusioni(voci) {
    return el('section', { classe: 'esclusioni' }, [
      intestazioneVista('EXCLUDED'),
      el('ul', {}, voci.map(function (e) { return el('li', {}, [G.SEGNI.OBSERVATION_EXCLUDED, ' ', t('span', e.motivo), ' · ', t('span', 'UI_OBSERVATION_COUNT', { n: e.osservazioni })]); })),
    ]);
  }

  /** L1 classe: il nucleo selezionato diventa intestazione; righe dei criteri (L2) con tacca del nucleo e glifo confermato. */
  function apriNucleoClasse(contestoClasse, q, n) {
    var ctx = { bande: q.bande, precisione: q.precisione };
    return apriLivello(contestoClasse, [
      { chiave: 'VIEW_CLASS_OVERVIEW', apri: function () { apriClasse(contestoClasse.teaching, contestoClasse.materia, 'quadro'); } },
      { contenuto: n.nome },
    ], async function (corpo) {
      corpo.append(el('h2', {}, [contenuto('span', contestoClasse.materia.materia), ' · ', contestoClasse.teaching.classe, ' · ', contenuto('span', n.nome)]));
      corpo.append(G.intestazioneColonne());
      corpo.append(G.riga({ chiave: 'nucleo-' + n.id, intestazione: true, nome: n.nome, valore: n.risultato, confronto: n.confrontoConComplessivo,
        riferimenti: [riferimento(n.confrontoConComplessivo && n.confrontoConComplessivo.riferimento, 'UI_REFERENCE_OVERALL')] }, ctx));
      var criteri = el('section', { classe: 'livello' }, [intestazioneVista('UI_CRITERIA')]);
      n.criteri.forEach(function (c) {
        criteri.append(G.riga({
          chiave: 'criterio-' + c.id, nome: el('span', {}, [c.codice, ' ', contenuto('span', c.descrizione)]), valore: c.risultato,
          confronto: c.confrontoConNucleo, riferimenti: [riferimento(c.riferimentoNucleo, 'UI_REFERENCE_NUCLEUS')],
        }, ctx));
      });
      corpo.append(criteri);
    });
  }

  // --- STUDENTI (VIEW_STUDENTS: matrice alunni × nuclei) --------------------------------

  async function disegnaStudenti(corpo, contestoClasse) {
    var m = await api('/teachings/' + contestoClasse.teaching.teaching_id + '/students-matrix');
    var ctx = { bande: m.bande, precisione: m.precisione };
    var filtro = el('input', { type: 'checkbox', id: 'filtro-zona-critica' });
    var tabella = el('table', { classe: 'matrice' });
    var vuoto = t('p', 'UI_EMPTY_FILTER', null, { classe: 'stato', hidden: true });
    function disegnaRighe() {
      var corpoTabella = el('tbody');
      var visibili = m.studenti.filter(function (s) { return !filtro.checked || s.inZonaCritica; });
      visibili.forEach(function (s) {
        corpoTabella.append(el('tr', {}, [
          el('th', { scope: 'row' }, [el('button', { type: 'button', classe: 'collegamento', onclick: function () { apriProfilo(contestoClasse, s); } }, [s.cognome + ' ' + s.nome])]),
        ].concat(s.celle.map(function (c) { return el('td', {}, [G.miniRiga(c, ctx)]); }))));
      });
      tabella.replaceChildren(
        el('caption', { classe: 'nascosta' }, [t('span', 'VIEW_STUDENTS')]),
        el('thead', {}, [el('tr', {}, [t('th', 'COLUMN_NAME', null, { scope: 'col' })].concat(m.nuclei.map(function (n) { return contenuto('th', n.nome, { scope: 'col' }); })))]),
        corpoTabella
      );
      vuoto.hidden = visibili.length > 0;
    }
    filtro.addEventListener('change', disegnaRighe);
    disegnaRighe();
    corpo.append(
      el('div', { classe: 'filtri' }, [filtro, t('label', 'UI_FILTER_CRITICAL_ZONE', null, { for: 'filtro-zona-critica' })]),
      el('div', { classe: 'scorrimento' }, [tabella]), vuoto
    );
  }

  // --- PROFILO ALUNNO (L0 studente) -> nucleo (L1) -> criterio (L2) -> osservazioni (L3) ---

  function nomeStudente(s) { return s.cognome + ' ' + s.nome; }

  function apriProfilo(contestoClasse, studente) {
    var vociBase = [
      { chiave: 'VIEW_STUDENTS', apri: function () { apriClasse(contestoClasse.teaching, contestoClasse.materia, 'studenti'); } },
    ];
    return apriLivello(contestoClasse, vociBase.concat([{ contenuto: nomeStudente(studente) }]), async function (corpo) {
      var p = await api('/teachings/' + contestoClasse.teaching.teaching_id + '/students/' + studente.enrollmentId + '/progress');
      var ctx = { bande: p.bande, precisione: p.precisione };
      var contestoProfilo = { contestoClasse: contestoClasse, studente: studente, p: p, ctx: ctx, vociBase: vociBase };
      corpo.append(el('h2', {}, [nomeStudente(p.alunno)]));
      corpo.append(avviso(p.avviso));
      corpo.append(el('section', { classe: 'livello' }, [
        G.intestazioneColonne(), G.riga({ chiave: 'complessivo', nome: nomeChiave('UI_OVERALL'), valore: p.complessivo }, ctx),
      ]));
      var nuclei = el('section', { classe: 'livello' }, [intestazioneVista('UI_NUCLEI'), G.intestazioneColonne()]);
      p.nuclei.forEach(function (n) { nuclei.append(rigaNucleoStudente(n, ctx, function () { apriNucleoStudente(contestoProfilo, n); })); });
      corpo.append(nuclei);
      corpo.append(sezioneValutazioni(p.valutazioni, ctx, false));
      if (p.criteriNonPiuAttivi.length) corpo.append(sezioneNonPiuAttivi(p.criteriNonPiuAttivi));
    });
  }

  function rigaNucleoStudente(n, ctx, apri, intestazione) {
    return G.riga({
      chiave: 'nucleo-' + n.id, intestazione: intestazione, nome: n.nome, valore: n.risultatoCorrente, confronto: n.confrontoConComplessivo,
      storico: n.cumulativo,
      riferimenti: [
        riferimento(n.confrontoConComplessivo && n.confrontoConComplessivo.riferimento, 'UI_REFERENCE_OVERALL'),
        riferimento(n.riferimentoClasse, 'UI_REFERENCE_CLASS'),
      ],
    }, ctx, apri);
  }

  function rigaCriterioStudente(c, ctx, apri, intestazione) {
    return G.riga({
      chiave: 'criterio-' + c.id, intestazione: intestazione, nome: el('span', {}, [c.codice, ' ', contenuto('span', c.descrizione)]),
      valore: c.risultatoCorrente, storico: c.cumulativo,
      riferimenti: [riferimento(c.riferimentoNucleo, 'UI_REFERENCE_NUCLEUS'), riferimento(c.riferimentoClasse, 'UI_REFERENCE_CLASS')],
    }, ctx, apri);
  }

  function apriNucleoStudente(cp, n) {
    var voci = cp.vociBase.concat([
      { contenuto: nomeStudente(cp.studente), apri: function () { apriProfilo(cp.contestoClasse, cp.studente); } },
      { contenuto: n.nome },
    ]);
    return apriLivello(cp.contestoClasse, voci, async function (corpo) {
      corpo.append(el('h2', {}, [nomeStudente(cp.p.alunno), ' · ', contenuto('span', n.nome)]));
      corpo.append(G.intestazioneColonne(), rigaNucleoStudente(n, cp.ctx, null, true));
      var criteri = el('section', { classe: 'livello' }, [intestazioneVista('UI_CRITERIA')]);
      n.criteri.forEach(function (c) { criteri.append(rigaCriterioStudente(c, cp.ctx, function () { apriCriterioStudente(cp, n, c); })); });
      if (!n.criteri.length) criteri.append(t('p', 'NOT_CONFIGURED', null, { classe: 'stato' }));
      corpo.append(criteri);
    });
  }

  function apriCriterioStudente(cp, n, c) {
    var voci = cp.vociBase.concat([
      { contenuto: nomeStudente(cp.studente), apri: function () { apriProfilo(cp.contestoClasse, cp.studente); } },
      { contenuto: n.nome, apri: function () { apriNucleoStudente(cp, n); } },
      { contenuto: c.codice },
    ]);
    return apriLivello(cp.contestoClasse, voci, async function (corpo) {
      corpo.append(el('h2', {}, [nomeStudente(cp.p.alunno), ' · ', c.codice, ' ', contenuto('span', c.descrizione)]));
      corpo.append(G.intestazioneColonne(), rigaCriterioStudente(c, cp.ctx, null, true));
      corpo.append(sequenza(c.osservazioni, cp.p.scala));
    });
  }

  /**
   * L3 OSSERVAZIONI: griglia dei valori della scala nel tempo (ordine cronologico del server,
   * che si specchia in RTL), ● osservazione, ○ esclusa con motivo, ⟦ ⟧ finestra corrente.
   */
  function sequenza(osservazioni, scala) {
    var sezione = el('section', { classe: 'osservazioni' }, [intestazioneVista('UI_OBSERVATIONS')]);
    if (!osservazioni.length) { sezione.append(t('p', 'NOT_OBSERVED', null, { classe: 'stato' })); return sezione; }
    var primaFinestra = osservazioni.findIndex(function (o) { return o.inFinestra; });
    var ultimaFinestra = osservazioni.length - 1 - osservazioni.slice().reverse().findIndex(function (o) { return o.inFinestra; });
    var testata = el('tr', {}, [t('th', 'UI_SCALE_VALUE', null, { scope: 'col' })].concat(osservazioni.map(function (o, i) {
      return el('th', { scope: 'col', classe: o.inFinestra ? 'in-finestra' : '' }, [
        i === primaFinestra ? el('span', { classe: 'finestra', role: 'img', 'aria-label': I18n.testo('OBSERVATION_WINDOW') }, [G.SEGNI.WINDOW_OPEN]) : null,
        I18n.data(o.dataOsservazione),
        i === ultimaFinestra ? el('span', { classe: 'finestra', 'aria-hidden': 'true' }, [G.SEGNI.WINDOW_CLOSE]) : null,
      ]);
    })));
    var righe = scala.valori.slice().reverse().map(function (v) {
      return el('tr', {}, [el('th', { scope: 'row' }, [I18n.numero(v.valore, 0), ' ', contenuto('span', v.etichetta)])].concat(osservazioni.map(function (o) {
        if (o.valore !== v.valore || !o.etichetta) return el('td', {});
        return el('td', {}, [segnoOsservazione(o)]);
      })));
    });
    var fuoriScala = osservazioni.some(function (o) { return !o.etichetta; });
    if (fuoriScala) {
      righe.push(el('tr', {}, [t('th', 'EXCLUSION_SCALE_INCOMPATIBLE', null, { scope: 'row' })].concat(osservazioni.map(function (o) {
        return el('td', {}, [o.etichetta ? null : segnoOsservazione(o)]);
      }))));
    }
    sezione.append(el('div', { classe: 'scorrimento' }, [el('table', { classe: 'sequenza' }, [
      el('caption', { classe: 'nascosta' }, [t('span', 'UI_OBSERVATIONS')]), el('thead', {}, [testata]), el('tbody', {}, righe),
    ])]));
    sezione.append(el('ul', { classe: 'dettaglio-osservazioni' }, osservazioni.map(function (o) {
      return el('li', {}, [
        o.conteggiata ? G.SEGNI.OBSERVATION : G.SEGNI.OBSERVATION_EXCLUDED, ' ', I18n.data(o.dataOsservazione), ' · ',
        contenuto('span', o.attivita), ' · ', I18n.numero(o.valore, 0), o.etichetta ? ' ' : '', contenuto('span', o.etichetta),
        o.nota ? ' · ' : '', contenuto('span', o.nota),
        o.inFinestra ? el('span', {}, [' · ', t('span', 'OBSERVATION_WINDOW')]) : null,
        o.motivoEsclusione ? el('span', {}, [' · ', t('span', 'EXCLUDED'), ': ', t('span', o.motivoEsclusione)]) : null,
      ]);
    })));
    return sezione;
  }

  function segnoOsservazione(o) {
    var parametri = { data: I18n.data(o.dataOsservazione) };
    return o.conteggiata
      ? G.segno(G.SEGNI.OBSERVATION, 'OBSERVATION', parametri, 'osservazione')
      : G.segno(G.SEGNI.OBSERVATION_EXCLUDED, o.motivoEsclusione || 'OBSERVATION_EXCLUDED', parametri, 'osservazione esclusa');
  }

  function sezioneNonPiuAttivi(criteri) {
    return el('section', { classe: 'esclusioni' }, [intestazioneVista('EXCLUDED')].concat(criteri.map(function (c) {
      return el('div', {}, [
        el('p', {}, [c.codice, ' ', contenuto('span', c.descrizione), ' · ', contenuto('span', c.nucleo)]),
        el('ul', {}, c.osservazioni.map(function (o) {
          return el('li', {}, [G.SEGNI.OBSERVATION_EXCLUDED, ' ', I18n.data(o.dataOsservazione), ' · ', contenuto('span', o.attivita), ' · ', t('span', o.motivoEsclusione)]);
        })),
      ]);
    })));
  }

  // --- VALUTAZIONI (VIEW_ASSESSMENT): timbro, periodo, autore, sintesi come evidenza -----

  function sezioneValutazioni(valutazioni, ctx, conAlunno) {
    var sezione = el('section', { classe: 'valutazioni' }, [intestazioneVista('TEACHER_ASSESSMENT')]);
    if (!valutazioni.length) { sezione.append(t('p', 'UI_EMPTY_ASSESSMENTS', null, { classe: 'stato' })); return sezione; }
    if (valutazioni.some(function (v) { return v.evidenza; })) sezione.append(G.intestazioneColonne());
    valutazioni.forEach(function (v) {
      sezione.append(el('article', { classe: 'valutazione' }, [
        el('p', { classe: 'timbro' }, [
          G.segno(G.SEGNI.TEACHER_ASSESSMENT, 'TEACHER_ASSESSMENT', null, 'timbro-segno'), ' ', contenuto('strong', v.giudizio),
        ]),
        el('p', { classe: 'nota' }, [
          conAlunno ? v.alunno.cognome + ' ' + v.alunno.nome + ' · ' : '',
          v.criterio ? el('span', {}, [v.criterio.codice, ' ', contenuto('span', v.criterio.descrizione)]) : t('span', 'UI_SUBJECT_ASSESSMENT'),
          ' · ', contenuto('span', v.periodo.nome), ' (', I18n.data(v.periodo.dataInizio), ' – ', I18n.data(v.periodo.dataFine), ')',
          ' · ', t('span', 'UI_AUTHOR', { autore: v.autore.nome + ' ' + v.autore.cognome }), ' · ', I18n.data(v.aggiornataIl),
        ]),
        v.evidenza ? G.riga({ chiave: 'evidenza-' + v.id, nome: nomeChiave('UI_EVIDENCE'), valore: v.evidenza }, ctx) : null,
      ]));
    });
    return sezione;
  }

  async function disegnaValutazioni(corpo, contestoClasse) {
    var r = await api('/teachings/' + contestoClasse.teaching.teaching_id + '/assessments');
    corpo.append(sezioneValutazioni(r.valutazioni, { bande: r.bande, precisione: r.precisione }, true));
  }

  // --- ATTIVITÀ (VIEW_ACTIVITIES) -> griglia di inserimento / esito (VIEW_ACTIVITY_OUTCOME) ---

  async function disegnaAttivita(corpo, contestoClasse) {
    var id = contestoClasse.teaching.teaching_id;
    var risposte = await Promise.all([api('/teachings/' + id + '/activities'), api('/teachings/' + id + '/pedagogical-units')]);
    var attivita = risposte[0];
    var unita = risposte[1];
    if (haPermesso('activity.create')) corpo.append(moduloNuovaAttivita(contestoClasse, unita));
    if (!attivita.length) { corpo.append(t('p', 'UI_EMPTY_ACTIVITIES', null, { classe: 'stato' })); return; }
    corpo.append(el('div', { classe: 'elenco' }, attivita.map(function (a) {
      return el('button', { type: 'button', classe: 'scelta', onclick: function () { apriAttivita(contestoClasse, a, 'griglia'); } }, [
        contenuto('span', a.nome, { classe: 'titolo' }),
        el('span', { classe: 'sottotitolo' }, [contenuto('span', a.unita_pedagogica), ' · ', I18n.data(a.data_attivita)]),
      ]);
    })));
  }

  function moduloNuovaAttivita(contestoClasse, unita) {
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
          await api('/teachings/' + contestoClasse.teaching.teaching_id + '/activities', {
            method: 'POST', body: JSON.stringify({ nome: nome.value, dataAttivita: dataAttivita.value, pedagogicalUnitId: Number(scelta.value) }),
          });
          apriClasse(contestoClasse.teaching, contestoClasse.materia, 'attivita');
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

  function apriAttivita(contestoClasse, a, scheda) {
    var voci = [
      { chiave: 'VIEW_ACTIVITIES', apri: function () { apriClasse(contestoClasse.teaching, contestoClasse.materia, 'attivita'); } },
      { contenuto: a.nome },
    ];
    return apriLivello(contestoClasse, voci, async function (corpo) {
      var schede = el('div', { classe: 'schede', role: 'tablist' }, [['griglia', 'UI_GRID'], ['esito', 'VIEW_ACTIVITY_OUTCOME']].map(function (s) {
        return t('button', s[1], null, {
          type: 'button', role: 'tab', 'aria-selected': String(s[0] === scheda), classe: 'scheda',
          onclick: function () { apriAttivita(contestoClasse, a, s[0]); },
        });
      }));
      corpo.append(el('h2', {}, [contenuto('span', a.nome), ' · ', I18n.data(a.data_attivita)]), schede);
      if (scheda === 'griglia') await disegnaGriglia(corpo, contestoClasse, a);
      else await disegnaEsito(corpo, a);
    });
  }

  /** Griglia di inserimento: conserva la propria semantica (P14); testi ed etichette dal catalogo e dalla scala. */
  async function disegnaGriglia(corpo, contestoClasse, a) {
    var g = await api('/activities/' + a.activity_id + '/griglia');
    if (g.grigliaNonConfigurata) { corpo.append(t('p', 'NOT_CONFIGURED', null, { classe: 'stato' })); return; }
    var scrittura = haPermesso('observation.create');
    var ctx = { bande: g.bande, precisione: g.precisione };
    var tabella = el('table', { classe: 'griglia' }, [
      el('caption', { classe: 'nascosta' }, [t('span', 'UI_GRID')]),
      el('thead', {}, [el('tr', {}, [t('th', 'UI_STUDENT', null, { scope: 'col' })]
        .concat(g.criteri.map(function (c) { return el('th', { scope: 'col' }, [c.codice, ' ', contenuto('span', c.descrizione)]); }))
        .concat([t('th', 'UI_ACTIVITY_RESULT', null, { scope: 'col' })]))]),
    ]);
    var corpoTabella = el('tbody');
    g.righe.forEach(function (riga) {
      var nomeAlunno = riga.cognome + ' ' + riga.nome;
      var celle = riga.celle.map(function (cella) {
        var criterio = g.criteri.find(function (c) { return c.id === cella.criterionId; });
        var valoreScala = g.scala.valori.find(function (v) { return v.valore === cella.valore; });
        if (!scrittura) return el('td', {}, [valoreScala ? contenuto('span', valoreScala.etichetta) : t('span', 'UI_NOT_ASSESSED')]);
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
            await apriAttivita(contestoClasse, a, 'griglia');
          } catch (errore) { mostraErrore(errore); selettore.disabled = false; }
        });
        return el('td', {}, [selettore]);
      });
      corpoTabella.append(el('tr', {}, [el('th', { scope: 'row' }, [nomeAlunno])].concat(celle).concat([
        el('td', { classe: 'esito' }, [G.base(riga.esito), ' ', riga.esito.percentuale === null ? '' : G.percentuale(riga.esito.percentuale, ctx.precisione.dettaglio), ' ', G.banda(riga.esito)]),
      ])));
    });
    tabella.append(corpoTabella);
    corpo.append(el('div', { classe: 'scorrimento' }, [tabella]));
  }

  /** ESITO DELL'ATTIVITÀ: distribuzione dei valori della scala per criterio, base e aggregato; nessun ◇, nessuna finestra. */
  async function disegnaEsito(corpo, a) {
    var r = await api('/activities/' + a.activity_id + '/report-classe');
    if (r.grigliaNonConfigurata) { corpo.append(t('p', 'NOT_CONFIGURED', null, { classe: 'stato' })); return; }
    var ctx = { bande: r.bande, precisione: r.precisione };
    r.unitaPedagogiche.forEach(function (u) {
      var sezione = el('section', { classe: 'livello' }, [G.intestazioneColonne(), G.riga({ chiave: 'unita-' + u.id, nome: u.nome, valore: u.risultato }, ctx)]);
      var criteri = el('div', { classe: 'criteri-esito' });
      u.criteri.forEach(function (c) {
        criteri.append(G.riga({ chiave: 'criterio-' + c.id, nome: el('span', {}, [c.codice, ' ', contenuto('span', c.descrizione)]), valore: c.esito }, ctx));
        criteri.append(el('div', { classe: 'distribuzione-criterio' }, [
          t('span', 'DISTRIBUTION', null, { classe: 'nota' }),
          G.distribuzione(c.distribuzione, function (d) { return d.etichetta; }),
        ]));
      });
      sezione.append(criteri);
      corpo.append(sezione);
    });
    if (r.esclusioni.length) corpo.append(esclusioni(r.esclusioni));
  }

  // --- Amministrazione (piattaforma: tenant; istituto: completezza delle traduzioni, B-6) ---

  function mostraAmministrazione() {
    impostaPercorso([{ chiave: 'UI_ADMINISTRATION' }]);
    return vista(async function () {
      var corpo = el('div', { classe: 'corpo-scheda' }, [t('h2', 'UI_ADMINISTRATION')]);
      if (stato.me.isPlatformAdmin) {
        var tenants = await api('/platform/tenants');
        corpo.append(t('h3', 'UI_TENANTS'), el('ul', { classe: 'elenco-semplice' }, tenants.map(function (tn) {
          return el('li', {}, [tn.nome, ' · ', tn.slug, ' · ', t('span', 'STATUS_TENANT_' + tn.stato.toUpperCase())]);
        })));
      }
      if (stato.me.activeTenantId && haPermesso('tenant.manage_config')) {
        var completezza = await api('/admin/traduzioni/completezza');
        corpo.append(t('h3', 'UI_TRANSLATION_COMPLETENESS'));
        if (!completezza.lingue.length) corpo.append(t('p', 'UI_TRANSLATION_SINGLE_LANGUAGE', null, { classe: 'stato' }));
        completezza.lingue.forEach(function (l) {
          corpo.append(el('table', { classe: 'semplice' }, [
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
      contenitore().replaceChildren(corpo);
    });
  }

  // --- Avvio -------------------------------------------------------------------------

  $('esci').addEventListener('click', async function () {
    await api('/auth/logout', { method: 'POST' }).catch(function () {});
    await caricaCatalogo();
    mostraAccesso();
  });
  $('come-leggere-apri').addEventListener('click', function () {
    stato.comeLeggere = !stato.comeLeggere;
    $('come-leggere-apri').setAttribute('aria-expanded', String(stato.comeLeggere));
    disegnaComeLeggere();
  });
  $('amministrazione').addEventListener('click', function () { mostraAmministrazione(); });
  $('titolo-app').addEventListener('click', function () { if (stato.me && stato.me.activeTenantId) mostraInsegnamenti(); });

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
