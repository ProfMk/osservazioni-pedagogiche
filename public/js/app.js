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

  var stato = { me: null, insegnamenti: null, rotta: null, comeLeggere: false, credenzialiDaMostrare: null };

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
      case 'amministrazione':
        // Sezione, livello (per le classi) e anno di lavoro restano nella rotta, mai in una preferenza salvata.
        return '#/amministrazione' + (r.sezione ? '/' + r.sezione : '') + (r.livelloId ? '/' + r.livelloId : '') + (r.annoId ? '?anno=' + r.annoId : '');
      case 'password': return '#/password';
      case 'istituti': return '#/istituti';
      case 'classi': return '#/classi';
      case 'classeDelLivello': return '#/classi/' + r.classId;
      default: return '#/insegnamenti';
    }
  }

  /** Rotta dell'indirizzo, oppure null se l'indirizzo è vuoto o non riconosciuto (allora vale la partenza). */
  function daHash(hash) {
    var parti = String(hash || '').replace(/^#\/?/, '').split('?');
    var p = parti[0].split('/');
    var id = function (i) { return Number(p[i]); };
    if (p[0] === 'insegnamenti') return { tipo: 'insegnamenti' };
    if (p[0] === 'classi') return p[1] ? { tipo: 'classeDelLivello', classId: id(1) } : { tipo: 'classi' };
    if (p[0] === 'materia' && p[1]) return { tipo: 'materia', subjectId: id(1) };
    if (p[0] === 'amministrazione') {
      var amministrazione = { tipo: 'amministrazione' };
      var anno = new URLSearchParams(parti[1] || '').get('anno');
      if (p[1]) amministrazione.sezione = p[1];
      if (p[2]) amministrazione.livelloId = id(2);
      if (anno) amministrazione.annoId = Number(anno);
      return amministrazione;
    }
    if (p[0] === 'password') return { tipo: 'password' };
    if (p[0] === 'istituti') return { tipo: 'istituti' };
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
    return null;
  }

  /**
   * Partenza per ruolo (nota 1): il server decide il codice (stato.me.partenza), qui solo la sua rotta.
   * Vale per l'indirizzo vuoto o non riconosciuto, dopo l'accesso, dopo «Cambia istituto» e per il titolo.
   */
  function rottaDiPartenza() {
    switch (stato.me && stato.me.partenza) {
      case 'scuole': return { tipo: 'amministrazione', sezione: 'scuole' };
      case 'quadro': return { tipo: 'amministrazione', sezione: 'quadro' };
      case 'classi': return { tipo: 'classi' };
      default: return { tipo: 'insegnamenti' };
    }
  }

  /** Va a un livello: nuova voce nella storia (o sostituzione), poi disegna. */
  function vai(rotta, opzioni) {
    var metodo = opzioni && opzioni.sostituisci ? 'replaceState' : 'pushState';
    history[metodo]({ rotta: rotta }, '', versoHash(rotta));
    return disegna(rotta);
  }

  /** Rotte che non richiedono un istituto attivo (scelta dell'istituto, amministrazione, password). */
  function senzaIstituto(rotta) {
    return ['istituti', 'amministrazione', 'password'].indexOf(rotta.tipo) >= 0;
  }

  window.addEventListener('popstate', function (evento) {
    if (!stato.me || stato.me.deveCambiarePassword) return;
    var rotta = evento.state && evento.state.rotta ? evento.state.rotta : (daHash(location.hash) || rottaDiPartenza());
    if (!stato.me.activeTenantId && !senzaIstituto(rotta)) return;
    disegna(rotta);
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
      if (errore instanceof ErroreApi && errore.codice === 'ERR_PASSWORD_CHANGE_REQUIRED') { await riprendiDaMe(); return; }
      mostraErrore(errore instanceof ErroreApi ? errore : { codice: 'ERR_INTERNAL' });
    }
  }

  /** Rilegge la sessione dal server e riparte (es. password temporanea da cambiare). */
  async function riprendiDaMe() {
    try {
      stato.me = await api('/auth/me');
      await avviaApp();
    } catch (errore) { mostraAccesso(); }
  }

  // --- Accesso, intestazione, lingua, tenant --------------------------------------------

  function mostraAccesso() {
    stato.me = null;
    stato.insegnamenti = null;
    stato.credenzialiDaMostrare = null;
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

  /** Scuole tra cui l'utente può scegliere (per il PLATFORM_ADMIN: tutte quelle attive). */
  function istitutiDisponibili() { return (stato.me && stato.me.tenantsDisponibiliPerSwitch) || []; }
  function idIstituto(tn) { return tn.tenant_id !== undefined ? tn.tenant_id : tn.id; }
  /** Account senza alcuna scuola (e non di piattaforma): solo il messaggio e «Esci». */
  function senzaScuole() { return !stato.me.isPlatformAdmin && istitutiDisponibili().length === 0; }

  function aggiornaIntestazione() {
    var me = stato.me;
    // Password temporanea da cambiare: solo nome ed «Esci» (le altre API sono bloccate).
    var limitata = !!me.deveCambiarePassword;
    // Nessuna scuola: solo nome ed «Esci».
    var ridotta = limitata || senzaScuole();
    $('intestazione').hidden = false;
    $('titolo-app').textContent = I18n.testo('UI_APP_TITLE');
    var ruoli = Array.from(new Set((me.ruoliNelTenantAttivo || []).map(function (r) { return I18n.testo('ROLE_' + r.ruolo); })));
    $('utente').textContent = me.account.nome + ' ' + me.account.cognome
      + (ruoli.length ? ' · ' + new Intl.ListFormat(I18n.locale(), { type: 'unit' }).format(ruoli) : '');

    // Istituto attivo come testo; «Cambia istituto» solo se le scuole sono più di una.
    var attivo = istitutiDisponibili().find(function (tn) { return idIstituto(tn) === me.activeTenantId; });
    $('blocco-tenant').hidden = !attivo || limitata;
    $('istituto-attivo').replaceChildren.apply($('istituto-attivo'), attivo
      ? [t('span', 'UI_ACTIVE_TENANT_LABEL', null, { classe: 'nascosta' }), ' ', el('bdi', {}, [attivo.nome])] : []);
    $('cambia-istituto').textContent = I18n.testo('UI_CHANGE_TENANT');
    $('cambia-istituto').hidden = limitata || istitutiDisponibili().length < 2;

    var lingue = (me.lingua && me.lingua.lingueAbilitate) || [];
    var selettoreLingua = $('lingua');
    $('blocco-lingua').hidden = ridotta || lingue.length < 2;
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
    $('cambia-password').textContent = I18n.testo('UI_CHANGE_PASSWORD');
    $('cambia-password').hidden = ridotta;
    $('come-leggere-apri').textContent = I18n.testo('HOW_TO_READ');
    $('come-leggere-apri').setAttribute('aria-expanded', String(stato.comeLeggere));
    $('come-leggere-apri').hidden = ridotta;
    if (ridotta) stato.comeLeggere = false;
    var amministrazione = $('amministrazione');
    amministrazione.textContent = I18n.testo('UI_ADMINISTRATION');
    amministrazione.hidden = ridotta || !(me.isPlatformAdmin || haPermesso('tenant.manage_config'));
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
    if (stato.me.deveCambiarePassword) {
      mostraCambioObbligatorio();
      return;
    }
    if (!stato.me.activeTenantId) {
      if (senzaScuole()) {
        $('percorso').replaceChildren();
        contenitore().replaceChildren(t('p', 'UI_NO_TENANT', null, { classe: 'stato', role: 'status' }));
        return;
      }
      // Nessuna scuola attiva: PLATFORM_ADMIN all'Amministrazione, chi ha più scuole alla scelta.
      var richiesta = daHash(location.hash);
      var iniziale = stato.me.isPlatformAdmin ? { tipo: 'amministrazione' } : { tipo: 'istituti' };
      await vai(richiesta && senzaIstituto(richiesta) ? richiesta : iniziale, { sostituisci: true });
      return;
    }
    stato.insegnamenti = null;
    // Un indirizzo valido ha la precedenza; dopo l'accesso o «Cambia istituto» (radice) vale la partenza.
    var rotta = opzioni && opzioni.radice ? rottaDiPartenza() : (daHash(location.hash) || rottaDiPartenza());
    await vai(rotta, { sostituisci: true });
  }

  // --- Moduli: campi con etichetta, aiuto ed errore associati ---------------------------

  /** Campo di modulo: etichetta, eventuale aiuto e area d'errore, collegati con for/aria-describedby. */
  function campo(id, chiaveEtichetta, input, aiuto) {
    input.setAttribute('id', id);
    var descrizioni = [];
    var figli = [t('label', chiaveEtichetta, null, { for: id }), input];
    if (aiuto) {
      figli.push(t('span', aiuto.chiave, aiuto.parametri, { id: id + '-aiuto', classe: 'aiuto' }));
      descrizioni.push(id + '-aiuto');
    }
    figli.push(el('span', { id: id + '-errore', classe: 'errore-campo', role: 'alert', hidden: true }));
    descrizioni.push(id + '-errore');
    input.setAttribute('aria-describedby', descrizioni.join(' '));
    return el('span', { classe: 'campo' }, figli);
  }

  function azzeraErroriCampi(modulo) {
    mostraErrore(null);
    modulo.querySelectorAll('.errore-campo').forEach(function (area) { area.hidden = true; area.replaceChildren(); area.removeAttribute('data-testo-mancante'); });
    modulo.querySelectorAll('[aria-invalid]').forEach(function (input) { input.removeAttribute('aria-invalid'); });
  }

  function mostraErroreCampo(input, errore) {
    var area = $(input.id + '-errore');
    area.textContent = I18n.testo(errore.codice, errore.parametri);
    if (!I18n.esiste(errore.codice)) area.setAttribute('data-testo-mancante', errore.codice);
    area.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }

  /**
   * Errore del server sul campo a cui si riferisce (parametro `campo` o codice), altrimenti
   * nell'area d'errore generale. Sessione scaduta: di nuovo l'accesso.
   */
  function assegnaErrore(errore, perCodice, perCampo) {
    if (errore instanceof ErroreApi && errore.stato === 401) { mostraAccesso(); return; }
    var input = (errore.parametri && perCampo[errore.parametri.campo]) || perCodice[errore.codice];
    if (input) mostraErroreCampo(input, errore);
    else mostraErrore(errore instanceof ErroreApi ? errore : { codice: 'ERR_INTERNAL' });
  }

  function conferma(chiave, parametri) {
    return t('p', chiave, parametri, { classe: 'conferma', role: 'status' });
  }

  // --- Cambio password (obbligatorio dopo una password temporanea, o volontario) --------

  /**
   * Modulo di cambio password. `obbligatorio`: primo accesso o password reimpostata (la
   * password attuale è quella temporanea). `fatto(me)` riceve la vista /me aggiornata.
   */
  function moduloCambioPassword(opzioni) {
    var regole = stato.me.regolePassword;
    var attributi = function (autocomplete) {
      return { type: 'password', required: true, 'aria-required': 'true', autocomplete: autocomplete, minlength: regole.minimo, maxlength: regole.massimo };
    };
    var attuale = el('input', { type: 'password', required: true, 'aria-required': 'true', autocomplete: 'current-password' });
    var nuova = el('input', attributi('new-password'));
    var ripetuta = el('input', attributi('new-password'));
    var invio = t('button', 'UI_PASSWORD_SAVE', null, { type: 'submit', classe: 'azione' });
    var perCodice = {
      ERR_PASSWORD_CURRENT_INVALID: attuale,
      ERR_PASSWORD_TOO_SHORT: nuova,
      ERR_PASSWORD_TOO_LONG: nuova,
      ERR_PASSWORD_SAME_AS_TEMPORARY: nuova,
      ERR_PASSWORD_SAME_AS_CURRENT: nuova,
      ERR_PASSWORD_CONFIRMATION_MISMATCH: ripetuta,
    };
    var perCampo = { UI_FIELD_PASSWORD_CURRENT: attuale, UI_FIELD_PASSWORD_NEW: nuova };
    var modulo = el('form', {
      classe: opzioni.obbligatorio ? 'modulo-accesso modulo-password' : 'modulo modulo-password',
      novalidate: true,
      onsubmit: async function (evento) {
        evento.preventDefault();
        azzeraErroriCampi(modulo);
        if (nuova.value !== ripetuta.value) {
          mostraErroreCampo(ripetuta, { codice: 'ERR_PASSWORD_CONFIRMATION_MISMATCH', parametri: {} });
          return;
        }
        invio.disabled = true;
        try {
          var me = await api('/auth/password', { method: 'POST', body: JSON.stringify({ passwordAttuale: attuale.value, passwordNuova: nuova.value }) });
          await opzioni.fatto(me);
        } catch (errore) {
          assegnaErrore(errore, perCodice, perCampo);
          invio.disabled = false;
        }
      },
    }, [
      opzioni.obbligatorio ? t('h1', 'UI_CHANGE_PASSWORD', null, { id: 'titolo-cambio-password' }) : null,
      opzioni.obbligatorio ? t('p', 'UI_CHANGE_PASSWORD_REQUIRED', null, { classe: 'nota' }) : null,
      el('div', { classe: 'campi colonna' }, [
        campo('password-attuale', opzioni.obbligatorio ? 'UI_PASSWORD_TEMPORARY' : 'UI_PASSWORD_CURRENT', attuale),
        campo('password-nuova', 'UI_PASSWORD_NEW', nuova, { chiave: 'UI_PASSWORD_RULES', parametri: regole }),
        campo('password-ripetuta', 'UI_PASSWORD_CONFIRM', ripetuta),
        invio,
      ]),
    ]);
    return modulo;
  }

  /** Primo accesso: la sola cosa possibile è cambiare la password (o uscire). */
  function mostraCambioObbligatorio() {
    $('percorso').replaceChildren();
    mostraErrore(null);
    var modulo = moduloCambioPassword({
      obbligatorio: true,
      fatto: async function (me) {
        stato.me = me;
        await avviaApp();
        contenitore().prepend(conferma('UI_PASSWORD_CHANGED'));
      },
    });
    contenitore().replaceChildren(modulo);
    $('password-attuale').focus();
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

  // --- «Classi del mio livello» (COORDINATOR, nota 1): solo API esistenti, nessun dato nuovo ------------

  var RADICE_CLASSI = { chiave: 'UI_MY_LEVEL_CLASSES', rotta: { tipo: 'classi' } };

  /** Livelli di cui l'utente è COORDINATOR nel tenant attivo (dai suoi ruoli, non da tentativi che rispondono 403). */
  function livelliCoordinati() {
    var ids = [];
    (stato.me.ruoliNelTenantAttivo || []).forEach(function (r) {
      if (r.ruolo === 'COORDINATOR' && r.scope_school_level_id && ids.indexOf(r.scope_school_level_id) < 0) ids.push(r.scope_school_level_id);
    });
    return ids;
  }

  /** Andata e ritorno tra «Insegnamenti» e «Classi del mio livello»: solo per chi è COORDINATOR qui. */
  function collegamentoVista(rotta, chiave) {
    if (!livelliCoordinati().length) return null;
    return el('p', { classe: 'collegamento-vista' }, [t('a', chiave, null, {
      href: versoHash(rotta), classe: 'collegamento', onclick: function (e) { e.preventDefault(); vai(rotta); },
    })]);
  }

  /** Livelli coordinati con le loro classi attive, nell'ordine dei livelli del tenant. */
  async function classiDeiLivelliCoordinati() {
    var ids = livelliCoordinati();
    var livelli = (await api('/school-levels')).filter(function (l) { return ids.indexOf(l.id) >= 0; });
    var classi = await Promise.all(livelli.map(function (l) { return api('/school-levels/' + l.id + '/classes'); }));
    return livelli.map(function (l, i) { return { livello: l, classi: classi[i] }; });
  }

  VISTE.classi = async function () {
    cornice([RADICE_CLASSI]);
    var gruppi = await classiDeiLivelliCoordinati();
    return [
      t('h2', 'UI_MY_LEVEL_CLASSES'),
      collegamentoVista({ tipo: 'insegnamenti' }, 'UI_TEACHINGS'),
      gruppi.length ? null : t('p', 'UI_MY_LEVEL_NONE', null, { classe: 'stato' }),
    ].concat(gruppi.map(function (g) {
      var idTitolo = 'livello-coordinato-' + g.livello.id;
      return el('section', { classe: 'sezione', 'aria-labelledby': idTitolo }, [
        contenuto('h3', g.livello.nome, { id: idTitolo }),
        g.classi.length ? el('div', { classe: 'elenco' }, g.classi.map(function (c) {
          var rotta = { tipo: 'classeDelLivello', classId: c.id };
          return el('a', { href: versoHash(rotta), classe: 'scelta', onclick: function (e) { e.preventDefault(); vai(rotta); } }, [
            el('span', { classe: 'titolo' }, [c.nome]),
          ]);
        })) : t('p', 'UI_NO_CLASSES', null, { classe: 'stato' }),
      ]);
    }));
  };

  /** Una classe del livello: i suoi insegnamenti, verso la scheda della classe già esistente. */
  VISTE.classeDelLivello = async function (r) {
    var classe = null;
    (await classiDeiLivelliCoordinati()).forEach(function (g) {
      g.classi.forEach(function (c) { if (c.id === r.classId) classe = c; });
    });
    if (!classe) throw new ErroreApi({ codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_CLASS' } }, 404);
    var elenco = await api('/classes/' + classe.id + '/teachings');
    var indietro = cornice([RADICE_CLASSI, { contenuto: classe.nome }]);
    return [indietro, el('h2', {}, [classe.nome]), elenco.length ? el('div', { classe: 'elenco' }, elenco.map(function (tn) {
      var rotta = { tipo: 'classe', teachingId: tn.teaching_id, scheda: 'quadro' };
      return el('a', { href: versoHash(rotta), classe: 'scelta', onclick: function (e) { e.preventDefault(); vai(rotta); } }, [
        contenuto('span', tn.materia, { classe: 'titolo' }),
        t('span', 'UI_CLASS_SUBTITLE', { anno: tn.anno_scolastico, docente: tn.docente_nome + ' ' + tn.docente_cognome }, { classe: 'sottotitolo' }),
      ]);
    })) : t('p', 'UI_CLASS_NO_TEACHINGS', null, { classe: 'stato' })];
  };

  VISTE.insegnamenti = async function () {
    cornice([RADICE]);
    var elenco = await insegnamenti();
    var materie = [];
    elenco.forEach(function (tn) {
      if (!materie.find(function (m) { return m.id === tn.subject_id; })) materie.push({ id: tn.subject_id, materia: tn.materia });
    });
    return [
      t('h2', 'UI_TEACHINGS'),
      collegamentoVista({ tipo: 'classi' }, 'UI_MY_LEVEL_CLASSES'),
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

  /** Regola di scrittura dell'insegnamento, decisa dal server: { attivita, osservazioni }, ognuna { consentita, motivo }. */
  function regolaDiScrittura(tn) { return api('/teachings/' + tn.teaching_id + '/scrittura'); }

  /**
   * Sola lettura (nota 6): avviso fisso, non chiudibile, con il motivo ricevuto dal server.
   * Il motivo dipende solo dallo stato (anno chiuso; più avanti scuola sospesa): uguale per tutti i ruoli.
   */
  function avvisoSolaLettura(regola) {
    if (!regola || !regola.motivo) return null;
    return el('div', { classe: 'avviso sola-lettura', role: 'status' }, [t('strong', 'UI_READ_ONLY'), ' ', t('span', regola.motivo)]);
  }

  SCHEDE_CLASSE.attivita = async function (tn) {
    var id = tn.teaching_id;
    var risposte = await Promise.all([api('/teachings/' + id + '/activities'), api('/teachings/' + id + '/pedagogical-units'), regolaDiScrittura(tn)]);
    var attivita = risposte[0];
    var unita = risposte[1];
    var scrittura = risposte[2];
    return [
      avvisoSolaLettura(scrittura.attivita),
      scrittura.attivita.consentita ? moduloNuovaAttivita(tn, unita) : null,
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
    var risposte = await Promise.all([api('/teachings/' + tn.teaching_id + '/activities'), regolaDiScrittura(tn)]);
    var elenco = risposte[0];
    var a = elenco.find(function (x) { return x.activity_id === r.activityId; });
    if (!a) throw new ErroreApi({ codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_ACTIVITY' } }, 404);
    var indietro = cornice([RADICE, voceMateria(tn), voceClasse(tn, 'attivita'), { contenuto: a.nome }]);
    var schede = el('div', { classe: 'schede', role: 'tablist' }, [['griglia', 'UI_GRID'], ['esito', 'VIEW_ACTIVITY_OUTCOME']].map(function (s) {
      var rotta = { tipo: 'attivita', teachingId: tn.teaching_id, activityId: a.activity_id, scheda: s[0] };
      return t('a', s[1], null, { href: versoHash(rotta), role: 'tab', 'aria-selected': String(s[0] === r.scheda), classe: 'scheda', onclick: function (e) { e.preventDefault(); vai(rotta); } });
    }));
    var corpo = r.scheda === 'esito' ? await esitoAttivita(a) : await grigliaAttivita(a);
    // L'avviso di sola lettura sta sopra le schede: lo si vede appena si entra, in griglia e in esito.
    return [indietro, el('h2', {}, [contenuto('span', a.nome), ' · ', el('bdi', {}, [I18n.data(a.data_attivita)])]),
      avvisoSolaLettura(risposte[1].osservazioni), schede,
      el('div', { classe: 'corpo-scheda', role: 'tabpanel' }, corpo.filter(Boolean))];
  };

  /** Esito di una riga: percentuale, banda e n/N come arrivano dal server (griglia o risposta del salvataggio). */
  function contenutoEsitoRiga(esito, ctx) {
    return [G.numero(esito, ctx), ' ', G.chipBanda(esito, ctx), ' ', t('span', 'BASE_COUNT', { n: esito.base.n, N: esito.base.N }, { classe: 'tenue' })];
  }

  /**
   * Griglia di inserimento (P14: stessa semantica): ogni cella mostra il valore con il colore della sua banda;
   * vuota = non osservato (grigio). Riferimenti stabili nel DOM: tr[data-iscrizione], td[data-criterio], td.esito.
   * I controlli compaiono solo se il server consente la scrittura (g.scrittura).
   * Una sola struttura per le due disposizioni (tabella o una scheda per alunno, vedi adattaGriglia): i ruoli
   * espliciti conservano la semantica tabellare anche quando la disposizione a schede cambia `display`.
   * L'etichetta del criterio ripetuta nella scheda è aria-hidden: il controllo ha già il suo nome accessibile.
   */
  async function grigliaAttivita(a) {
    var g = await api('/activities/' + a.activity_id + '/griglia');
    if (g.grigliaNonConfigurata) return [t('p', 'NOT_CONFIGURED', null, { classe: 'stato' })];
    var ctx = ctxDi(g);
    var scrittura = g.scrittura.consentita;
    // Una sola regione per l'annuncio cortese dei salvataggi, non una per cella.
    var annuncio = el('p', { classe: 'nascosta annuncio-salvataggio', role: 'status' });
    var contesto = { activityId: a.activity_id, ctx: ctx, annuncio: annuncio };
    var corpoTabella = el('tbody', { role: 'rowgroup' }, g.righe.map(function (riga) {
      var nomeAlunno = riga.cognome + ' ' + riga.nome;
      var statoRiga = { enrollmentId: riga.enrollmentId, coda: Promise.resolve(), esito: null };
      var celle = riga.celle.map(function (cella) {
        var criterio = g.criteri.find(function (c) { return c.id === cella.criterionId; });
        var etichetta = el('span', { classe: 'etichetta-scheda', 'aria-hidden': 'true' }, [criterio.codice, ' ', contenuto('span', criterio.descrizione)]);
        var segnoValore = G.valoreScala(cella.valore, ctx);
        if (!scrittura) {
          var voce = g.scala.valori.find(function (v) { return v.valore === cella.valore; });
          return el('td', { classe: 'cella-valore', role: 'cell', 'data-criterio': cella.criterionId }, [etichetta, segnoValore, ' ', voce ? contenuto('span', voce.etichetta) : t('span', 'UI_NOT_ASSESSED')]);
        }
        var selettore = el('select', { 'aria-label': I18n.testo('UI_CELL_LABEL', { alunno: nomeAlunno, criterio: criterio.descrizione }) }, [
          t('option', 'UI_NOT_ASSESSED', null, { value: '' }),
        ].concat(g.scala.valori.map(function (v) {
          return t('option', 'UI_SCALE_OPTION', { valore: v.valore, etichetta: v.etichetta }, { value: v.valore, selected: cella.valore === v.valore });
        })));
        var messaggio = el('span', { id: 'errore-cella-' + riga.enrollmentId + '-' + cella.criterionId, classe: 'errore-campo', role: 'alert', hidden: true });
        var td = el('td', { classe: 'cella-valore', role: 'cell', 'data-criterio': cella.criterionId }, [etichetta, segnoValore, ' ', selettore, messaggio]);
        var statoCella = { criterionId: cella.criterionId, td: td, selettore: selettore, segno: segnoValore, messaggio: messaggio, salvato: cella.valore, inCorso: 0 };
        selettore.addEventListener('change', function () { salvaCellaSulPosto(contesto, statoRiga, statoCella); });
        return td;
      });
      statoRiga.esito = el('span', { classe: 'valori-esito' }, contenutoEsitoRiga(riga.esito, ctx));
      var esito = el('td', { classe: 'esito', role: 'cell' }, [t('span', 'UI_ACTIVITY_RESULT', null, { classe: 'etichetta-scheda', 'aria-hidden': 'true' }), statoRiga.esito]);
      return el('tr', { role: 'row', 'data-iscrizione': riga.enrollmentId }, [el('th', { scope: 'row', role: 'rowheader' }, [nomeAlunno])].concat(celle).concat([esito]));
    }));
    var tabella = el('table', { classe: 'griglia', role: 'table' }, [
      el('caption', { classe: 'nascosta' }, [t('span', 'UI_GRID')]),
      el('thead', { role: 'rowgroup' }, [el('tr', { role: 'row' }, [t('th', 'UI_STUDENT', null, { scope: 'col', role: 'columnheader' })]
        .concat(g.criteri.map(function (c) { return el('th', { scope: 'col', role: 'columnheader' }, [c.codice, ' ', contenuto('span', c.descrizione)]); }))
        .concat([t('th', 'UI_ACTIVITY_RESULT', null, { scope: 'col', role: 'columnheader' })]))]),
      corpoTabella,
    ]);
    var contenitoreGriglia = el('div', { classe: 'griglia-contenitore' }, [tabella]);
    adattaGriglia(contenitoreGriglia, tabella);
    return [contenitoreGriglia, annuncio];
  }

  /**
   * Reflow della griglia (nota 7), solo presentazione: se la tabella non sta nel contenitore la griglia
   * diventa una scheda per alunno (classe a-schede), altrimenti resta tabella. La soglia non è fissa: è la
   * larghezza naturale della tabella (numero di criteri, scala, lunghezza dei testi tradotti), misurata in
   * modalità tabella e conservata, così la griglia non oscilla tra le due disposizioni. Il cambio avviene al
   * fotogramma successivo, fuori dal ciclo di ResizeObserver.
   */
  function adattaGriglia(contenitoreGriglia, tabella) {
    var larghezzaNaturale = null;
    var richiesto = false;
    var aSchede = function () { return contenitoreGriglia.classList.contains('a-schede'); };
    var misuraInTabella = function () {
      if (tabella.offsetWidth > contenitoreGriglia.clientWidth) {
        larghezzaNaturale = tabella.offsetWidth;
        contenitoreGriglia.classList.add('a-schede');
      }
    };
    var adatta = function () {
      richiesto = false;
      if (!contenitoreGriglia.isConnected || contenitoreGriglia.clientWidth === 0) return;
      if (!aSchede()) misuraInTabella();
      else if (larghezzaNaturale !== null && contenitoreGriglia.clientWidth >= larghezzaNaturale) {
        contenitoreGriglia.classList.remove('a-schede');
        misuraInTabella();
      }
    };
    var osservatore = new ResizeObserver(function () {
      if (!contenitoreGriglia.isConnected) { osservatore.disconnect(); return; }
      if (richiesto) return;
      richiesto = true;
      requestAnimationFrame(adatta);
    });
    osservatore.observe(contenitoreGriglia);
  }

  /**
   * Salvataggio sul posto (nota 8): nessun ridisegno e nessun «Caricamento»; il controllo non viene mai
   * disabilitato né sostituito (fuoco e scorrimento restano). Le scritture di una riga sono in coda: la
   * risposta di una non può mostrare un esito più vecchio di un'altra; di più scelte ravvicinate sulla
   * stessa cella si salva l'ultima. A salvataggio riuscito cambiano solo il segno della cella e l'esito della
   * riga, con i valori restituiti dal server. In caso d'errore il controllo torna all'ultimo valore salvato
   * e il messaggio compare accanto a lui.
   */
  function salvaCellaSulPosto(contesto, riga, cella) {
    cella.inCorso += 1;
    cella.td.setAttribute('aria-busy', 'true');
    riga.coda = riga.coda.then(async function () {
      var valore = cella.selettore.value === '' ? null : Number(cella.selettore.value);
      try {
        if (valore === cella.salvato) return;
        var risposta = await api('/activities/' + contesto.activityId + '/enrollments/' + riga.enrollmentId + '/criteria/' + cella.criterionId, {
          method: 'PUT', body: JSON.stringify({ valore: valore }),
        });
        cella.salvato = risposta.cella.valore;
        var segno = G.valoreScala(risposta.cella.valore, contesto.ctx);
        cella.segno.replaceWith(segno);
        cella.segno = segno;
        riga.esito.replaceChildren.apply(riga.esito, contenutoEsitoRiga(risposta.riga.esito, contesto.ctx));
        togliErroreCella(cella);
        contesto.annuncio.replaceChildren(t('span', 'UI_CELL_SAVED'));
      } catch (errore) {
        if (errore instanceof ErroreApi && errore.stato === 401) { mostraAccesso(); return; }
        cella.selettore.value = cella.salvato === null ? '' : String(cella.salvato);
        mostraErroreCella(cella, errore instanceof ErroreApi ? errore : { codice: 'ERR_INTERNAL' });
      } finally {
        cella.inCorso -= 1;
        if (cella.inCorso === 0) cella.td.removeAttribute('aria-busy');
      }
    });
  }

  function mostraErroreCella(cella, errore) {
    cella.messaggio.textContent = I18n.testo(errore.codice, errore.parametri);
    if (I18n.esiste(errore.codice)) cella.messaggio.removeAttribute('data-testo-mancante');
    else cella.messaggio.setAttribute('data-testo-mancante', errore.codice);
    cella.messaggio.hidden = false;
    cella.selettore.setAttribute('aria-invalid', 'true');
    cella.selettore.setAttribute('aria-describedby', cella.messaggio.id);
  }

  function togliErroreCella(cella) {
    cella.messaggio.hidden = true;
    cella.messaggio.replaceChildren();
    cella.messaggio.removeAttribute('data-testo-mancante');
    cella.selettore.removeAttribute('aria-invalid');
    cella.selettore.removeAttribute('aria-describedby');
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

  // --- Scelta dell'istituto (più scuole; PLATFORM_ADMIN) ---------------------------------

  /** Un pulsante per scuola, nella stessa forma dell'elenco degli insegnamenti: nome e ruoli dell'utente. */
  function elencoIstituti(elenco) {
    return el('div', { classe: 'elenco elenco-istituti' }, elenco.map(function (tn) {
      var id = idIstituto(tn);
      var ruoli = (tn.ruoli || []).map(function (r) { return I18n.testo('ROLE_' + r); });
      var pulsante = el('button', {
        type: 'button', classe: 'scelta', 'aria-current': id === stato.me.activeTenantId ? 'true' : null,
        onclick: async function () {
          pulsante.disabled = true;
          try {
            stato.me = await api('/auth/switch-tenant', { method: 'POST', body: JSON.stringify({ tenantId: id }) });
            await avviaApp({ radice: true });
          } catch (errore) {
            pulsante.disabled = false;
            if (errore instanceof ErroreApi && errore.stato === 401) mostraAccesso();
            else mostraErrore(errore instanceof ErroreApi ? errore : { codice: 'ERR_INTERNAL' });
          }
        },
      }, [
        el('span', { classe: 'titolo' }, [el('bdi', {}, [tn.nome])]),
        ruoli.length ? el('span', { classe: 'sottotitolo' }, [new Intl.ListFormat(I18n.locale(), { type: 'unit' }).format(ruoli)]) : null,
      ]);
      return pulsante;
    }));
  }

  VISTE.istituti = async function () {
    var voci = stato.me.activeTenantId ? [RADICE, { chiave: 'UI_CHOOSE_TENANT' }] : [{ chiave: 'UI_CHOOSE_TENANT' }];
    var indietro = cornice(voci);
    stato.me = await api('/auth/me'); // elenco aggiornato (per esempio dopo la creazione di una scuola)
    var elenco = istitutiDisponibili();
    return [indietro, t('h2', 'UI_CHOOSE_TENANT'),
      elenco.length ? elencoIstituti(elenco) : t('p', 'UI_NO_TENANT', null, { classe: 'stato' })];
  };

  // --- Cambio password volontario (dal menu) --------------------------------------------

  VISTE.password = async function () {
    var indietro = cornice([RADICE, { chiave: 'UI_CHANGE_PASSWORD' }]);
    var area = el('div', {});
    area.append(moduloCambioPassword({
      obbligatorio: false,
      fatto: async function (me) {
        stato.me = me;
        aggiornaIntestazione();
        area.replaceChildren(conferma('UI_PASSWORD_CHANGED'));
      },
    }));
    return [indietro, t('h2', 'UI_CHANGE_PASSWORD'), area];
  };

  // --- Amministrazione della piattaforma: scuole e amministratori ---

  function persona(a) { return a.nome + ' ' + a.cognome; }

  /**
   * Credenziali appena generate, mostrate UNA volta: restano solo in memoria fino al
   * prossimo disegno della vista (nessuna copia in storage, indirizzo o storia).
   */
  function riquadroCredenziali(c) {
    var figli = [];
    if (c.scuola) figli.push(t('p', 'UI_SCHOOL_CREATED', { scuola: c.scuola }, { classe: 'conferma' }));
    if (c.accountEsistente) {
      figli.push(t('p', 'UI_ADMIN_EXISTING_ACCOUNT', { email: c.account.email }));
    } else {
      var esitoCopia = el('span', { classe: 'esito-copia', role: 'status' });
      var codice = el('code', { id: 'password-temporanea', classe: 'password-temporanea', translate: 'no' }, [el('bdi', {}, [c.passwordTemporanea])]);
      var copia = t('button', 'UI_COPY', null, {
        type: 'button', classe: 'azione', 'aria-describedby': 'password-temporanea',
        onclick: async function () {
          try {
            await navigator.clipboard.writeText(c.passwordTemporanea);
            esitoCopia.replaceChildren(t('span', 'UI_COPIED'));
          } catch (errore) {
            window.getSelection().selectAllChildren(codice);
            esitoCopia.replaceChildren(t('span', 'UI_COPY_FAILED'));
          }
        },
      });
      figli.push(
        t('h3', 'UI_TEMP_PASSWORD_TITLE', { persona: persona(c.account) }, { id: 'titolo-credenziali', tabindex: '-1' }),
        t('p', 'UI_TEMP_PASSWORD_FOR', { email: c.account.email }),
        el('p', { classe: 'riga-password' }, [codice, ' ', copia, ' ', esitoCopia]),
        el('p', { classe: 'avvertenza' }, [t('strong', 'UI_TEMP_PASSWORD_WARNING')]),
        t('p', 'UI_TEMP_PASSWORD_EXPIRES', { scadenza: I18n.dataOra(c.scadeIl) }, { classe: 'nota' })
      );
    }
    var riquadro = el('section', { classe: 'riquadro-credenziali', 'aria-labelledby': c.accountEsistente ? null : 'titolo-credenziali' }, figli);
    riquadro.append(t('button', 'UI_DONE', null, { type: 'button', classe: 'collegamento', onclick: function () { riquadro.remove(); } }));
    return riquadro;
  }

  async function mostraCredenziali(credenziali) {
    stato.credenzialiDaMostrare = credenziali;
    await disegna({ tipo: 'amministrazione', sezione: 'scuole' });
    var titolo = $('titolo-credenziali');
    if (titolo) titolo.focus();
  }

  function moduloNuovaScuola() {
    var testo = function (massimo, autocomplete) {
      return el('input', { type: 'text', required: true, 'aria-required': 'true', maxlength: massimo, autocomplete: autocomplete || 'off' });
    };
    var nomeScuola = testo(200, 'organization');
    var slug = testo(60);
    slug.setAttribute('spellcheck', 'false');
    slug.setAttribute('autocapitalize', 'none');
    var nome = testo(100);
    var cognome = testo(100);
    var email = el('input', { type: 'email', required: true, 'aria-required': 'true', maxlength: 255, autocomplete: 'off' });
    var invio = t('button', 'UI_CREATE_SCHOOL', null, { type: 'submit', classe: 'azione' });
    var perCodice = { ERR_TENANT_SLUG_INVALID: slug, ERR_TENANT_SLUG_TAKEN: slug, ERR_EMAIL_INVALID: email, ERR_ACCOUNT_DISABLED: email };
    var perCampo = { UI_FIELD_NOME: nomeScuola, UI_FIELD_SLUG: slug, UI_FIELD_ADMIN_NAME: nome, UI_FIELD_ADMIN_SURNAME: cognome };
    var modulo = el('form', {
      classe: 'modulo modulo-scuola',
      novalidate: true,
      'aria-labelledby': 'titolo-nuova-scuola',
      onsubmit: async function (evento) {
        evento.preventDefault();
        azzeraErroriCampi(modulo);
        invio.disabled = true;
        try {
          var creata = await api('/platform/tenants', {
            method: 'POST',
            body: JSON.stringify({
              slug: slug.value.trim(), nome: nomeScuola.value,
              amministratore: { nome: nome.value, cognome: cognome.value, email: email.value },
            }),
          });
          var a = creata.amministratore;
          await mostraCredenziali({
            scuola: creata.nome, account: a.account, accountEsistente: a.accountEsistente,
            passwordTemporanea: a.passwordTemporanea, scadeIl: a.passwordTemporaneaScadeIl,
          });
        } catch (errore) {
          assegnaErrore(errore, perCodice, perCampo);
          invio.disabled = false;
        }
      },
    }, [
      t('h3', 'UI_NEW_SCHOOL', null, { id: 'titolo-nuova-scuola' }),
      el('div', { classe: 'campi' }, [
        campo('scuola-nome', 'UI_SCHOOL_NAME', nomeScuola),
        campo('scuola-slug', 'UI_SCHOOL_SLUG', slug, { chiave: 'UI_SCHOOL_SLUG_HINT' }),
      ]),
      el('fieldset', { classe: 'gruppo' }, [
        t('legend', 'UI_FIRST_ADMIN'),
        el('div', { classe: 'campi' }, [
          campo('admin-nome', 'UI_FIRST_NAME', nome),
          campo('admin-cognome', 'UI_LAST_NAME', cognome),
          campo('admin-email', 'UI_EMAIL', email),
        ]),
      ]),
      invio,
    ]);
    return modulo;
  }

  function voceScuola(tn) {
    var amministratori = tn.amministratori || [];
    return el('li', {}, [
      tn.nome, ' · ', tn.slug, ' · ', t('span', 'STATUS_TENANT_' + tn.stato.toUpperCase()),
      amministratori.length ? el('ul', { classe: 'amministratori' }, amministratori.map(function (a) {
        return el('li', {}, [
          t('span', 'UI_SCHOOL_ADMIN', { persona: persona(a), email: a.email }), ' ',
          t('button', 'UI_RESET_PASSWORD', null, {
            type: 'button', classe: 'collegamento', 'aria-label': I18n.testo('UI_RESET_PASSWORD_FOR', { persona: persona(a) }),
            onclick: async function () {
              if (!window.confirm(I18n.testo('UI_RESET_CONFIRM', { persona: persona(a) }))) return;
              try {
                var r = await api('/platform/tenants/' + tn.id + '/admins/' + a.account_id + '/reset-password', { method: 'POST' });
                await mostraCredenziali({ account: r.account, accountEsistente: false, passwordTemporanea: r.passwordTemporanea, scadeIl: r.passwordTemporaneaScadeIl });
              } catch (errore) {
                if (errore instanceof ErroreApi && errore.stato === 401) mostraAccesso();
                else mostraErrore(errore instanceof ErroreApi ? errore : { codice: 'ERR_INTERNAL' });
              }
            },
          }),
        ]);
      })) : el('ul', { classe: 'amministratori' }, [t('li', 'UI_NO_SCHOOL_ADMIN', null, { classe: 'stato' })]),
    ]);
  }

  // --- Amministrazione: cornice, sezioni, anno di lavoro (iterazione 2A) ----------------------

  /**
   * Sezioni dell'amministrazione (solo quelle già realizzate). Quelle dell'istituto
   * richiedono un istituto attivo e tenant.manage_config; «Scuole» è del PLATFORM_ADMIN.
   * `anno`: la sezione segue l'anno su cui si lavora (selettore in alto).
   */
  var SEZIONI_ADMIN = [
    { id: 'quadro', chiave: 'UI_ADMIN_SECTION_OVERVIEW', istituto: true, anno: true },
    { id: 'calendario', chiave: 'UI_ADMIN_SECTION_CALENDAR', istituto: true, anno: true },
    { id: 'livelli', chiave: 'UI_ADMIN_SECTION_LEVELS', istituto: true },
    { id: 'scuole', chiave: 'UI_ADMIN_SECTION_SCHOOLS', piattaforma: true },
  ];

  function amministraIstituto() { return !!(stato.me.activeTenantId && haPermesso('tenant.manage_config')); }

  function sezioniDisponibili() {
    return SEZIONI_ADMIN.filter(function (s) { return s.istituto ? amministraIstituto() : !!stato.me.isPlatformAdmin; });
  }

  function chiaveStatoAnno(statoAnno) { return 'STATUS_SCHOOL_YEAR_' + statoAnno.toUpperCase(); }
  function chiaveStatoLivello(statoLivello) { return 'STATUS_SCHOOL_LEVEL_' + statoLivello.toUpperCase(); }
  function chiaveStatoClasse(statoClasse) { return 'STATUS_CLASS_' + statoClasse.toUpperCase(); }

  function rottaAdmin(r, modifiche) { return Object.assign({ tipo: 'amministrazione', annoId: r.annoId }, modifiche); }

  function collegamentoA(rotta, figli, attributi) {
    return el('a', Object.assign({ href: versoHash(rotta), classe: 'collegamento', onclick: function (e) { e.preventDefault(); vai(rotta); } }, attributi || {}), figli);
  }

  /** Dopo una scrittura riuscita: la vista si ridisegna dal server, con la conferma in testa. */
  async function ridisegna() {
    await disegna(stato.rotta);
    contenitore().prepend(conferma('UI_SAVED'));
  }

  function erroreAzione(errore) {
    if (errore instanceof ErroreApi && errore.stato === 401) mostraAccesso();
    else mostraErrore(errore instanceof ErroreApi ? errore : { codice: 'ERR_INTERNAL' });
  }

  /** Pulsante d'azione: nome accessibile con l'oggetto, conferma esplicita se indicata, poi la vista aggiornata. */
  function pulsanteAzione(chiave, opzioni) {
    var pulsante = t('button', chiave, null, {
      type: 'button', classe: opzioni.classe || 'collegamento',
      'aria-label': opzioni.per ? I18n.testo(opzioni.per, opzioni.parametri) : null,
      onclick: async function () {
        if (opzioni.conferma && !window.confirm(I18n.testo(opzioni.conferma, opzioni.parametri))) return;
        pulsante.disabled = true;
        try {
          await opzioni.esegui();
          await ridisegna();
        } catch (errore) {
          pulsante.disabled = false;
          erroreAzione(errore);
        }
      },
    });
    return pulsante;
  }

  /**
   * Modulo dell'amministrazione: campi con etichetta, aiuto ed errore (campo()), novalidate,
   * errori del server sul campo indicato dal parametro `campo` (UI_FIELD_*).
   */
  function moduloAdmin(o) {
    var invio = t('button', o.invio, null, { type: 'submit', classe: 'azione' });
    var perCampo = {};
    o.campi.forEach(function (c) { perCampo[c.campo] = c.input; });
    var modulo = el('form', {
      classe: 'modulo modulo-admin', novalidate: true, 'aria-labelledby': o.id + '-titolo',
      onsubmit: async function (evento) {
        evento.preventDefault();
        azzeraErroriCampi(modulo);
        invio.disabled = true;
        try {
          await o.invia();
          await ridisegna();
        } catch (errore) {
          assegnaErrore(errore, {}, perCampo);
          invio.disabled = false;
        }
      },
    }, [
      t('h4', o.titolo, o.parametri, { id: o.id + '-titolo' }),
      o.nota ? t('p', o.nota, o.parametri, { classe: 'nota' }) : null,
      el('div', { classe: 'campi' }, o.campi.map(function (c) { return campo(o.id + '-' + c.nome, c.etichetta, c.input, c.aiuto); })),
      el('div', { classe: 'pulsanti' }, [invio, o.annulla ? t('button', 'UI_CANCEL', null, { type: 'button', classe: 'collegamento', onclick: o.annulla }) : null]),
    ]);
    return modulo;
  }

  function inputTesto(massimo, valore) {
    return el('input', { type: 'text', required: true, 'aria-required': 'true', maxlength: massimo, autocomplete: 'off', value: valore || null });
  }
  function inputData(valore) { return el('input', { type: 'date', required: true, 'aria-required': 'true', value: valore || null }); }

  function corpoJson(metodo, corpo) { return { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo) }; }

  /** Anno su cui si lavora: un collegamento per anno, con il suo stato; la scelta resta nella rotta. */
  function selettoreAnno(anni, scelto, r) {
    var figli = [t('span', 'UI_WORKING_YEAR', null, { id: 'titolo-anno-di-lavoro', classe: 'etichetta' })];
    if (!anni.length) {
      figli.push(t('span', 'UI_NO_SCHOOL_YEARS', null, { classe: 'stato' }));
      return el('div', { classe: 'anno-di-lavoro' }, figli);
    }
    figli.push(el('ul', {}, anni.map(function (a) {
      var rotta = Object.assign({}, r, { annoId: a.id });
      return el('li', {}, [el('a', {
        href: versoHash(rotta), classe: 'scelta-anno', 'aria-current': a.id === scelto.id ? 'true' : null,
        onclick: function (e) { e.preventDefault(); vai(rotta); },
      }, [el('bdi', {}, [a.nome]), ' ', t('span', chiaveStatoAnno(a.stato), null, { classe: 'sottotitolo' })])]);
    })));
    return el('nav', { classe: 'anno-di-lavoro', 'aria-labelledby': 'titolo-anno-di-lavoro' }, figli);
  }

  function menuAdmin(sezioni, corrente, r) {
    if (sezioni.length < 2) return null;
    return el('nav', { classe: 'menu-amministrazione', 'aria-label': I18n.testo('UI_ADMIN_SECTIONS') }, [el('ul', {}, sezioni.map(function (s) {
      var rotta = rottaAdmin(r, { sezione: s.id });
      return el('li', {}, [t('a', s.chiave, null, {
        href: versoHash(rotta), classe: 'voce-menu', 'aria-current': s.id === corrente.id ? 'page' : null,
        onclick: function (e) { e.preventDefault(); vai(rotta); },
      })]);
    }))]);
  }

  /**
   * Amministrazione: titolo, menu delle sezioni, anno di lavoro (per le sezioni legate
   * all'anno), poi la sezione. Senza sezione nella rotta: il Quadro per chi amministra
   * l'istituto, le Scuole per il PLATFORM_ADMIN senza istituto attivo.
   */
  VISTE.amministrazione = async function (r) {
    var sezioni = sezioniDisponibili();
    var richiesta = r.sezione === 'classi' ? 'livelli' : r.sezione;
    var sezione = sezioni.find(function (s) { return s.id === richiesta; }) || sezioni[0];
    if (!sezione) {
      cornice([RADICE, { chiave: 'UI_ADMINISTRATION' }]);
      return [t('h2', 'UI_ADMINISTRATION'), t('p', 'ERR_FORBIDDEN', null, { classe: 'stato' })];
    }
    var datiAnni = null;
    var anno = null;
    if (sezione.anno) {
      datiAnni = await api('/admin/school-years');
      anno = datiAnni.anni.find(function (a) { return a.id === r.annoId; })
        || datiAnni.anni.find(function (a) { return a.id === datiAnni.annoDiLavoro; }) || null;
    }
    var esito = await SEZIONI_VISTE[r.sezione === 'classi' ? 'classi' : sezione.id](r, { anno: anno, datiAnni: datiAnni });
    var voci = [RADICE];
    if (r.sezione) voci.push({ chiave: 'UI_ADMINISTRATION', rotta: rottaAdmin(r, {}) }, { chiave: sezione.chiave, rotta: rottaAdmin(r, { sezione: sezione.id }) });
    else voci.push({ chiave: 'UI_ADMINISTRATION' });
    var indietro = cornice(voci.concat(esito.voci || []));
    return [
      indietro,
      t('h2', 'UI_ADMINISTRATION'),
      menuAdmin(sezioni, sezione, r),
      sezione.anno ? selettoreAnno(datiAnni.anni, anno, rottaAdmin(r, { sezione: r.sezione })) : null,
      el('div', { classe: 'sezione-amministrazione' }, esito.nodi.filter(Boolean)),
    ];
  };

  var SEZIONI_VISTE = {};

  // --- Quadro dell'istituto: cose da fare e riepilogo per livello (tutto dal server) ---------

  /** Il collegamento di una cosa da fare compare solo se la sua sezione esiste già (e l'utente la vede). */
  function sezioneEsistente(c) {
    var id = c.sezione === 'classi' ? 'livelli' : c.sezione;
    return sezioniDisponibili().some(function (s) { return s.id === id; });
  }

  function rottaCollegamento(c, r) {
    if (c.sezione === 'classi') return rottaAdmin(r, { sezione: 'classi', livelloId: c.livelloId });
    return rottaAdmin(r, { sezione: c.sezione, annoId: c.annoId || r.annoId });
  }

  async function sezioneCompletezza() {
    var completezza = await api('/admin/traduzioni/completezza');
    var nodi = [t('h3', 'UI_TRANSLATION_COMPLETENESS')];
    if (!completezza.lingue.length) nodi.push(t('p', 'UI_TRANSLATION_SINGLE_LANGUAGE', null, { classe: 'stato' }));
    completezza.lingue.forEach(function (l) {
      nodi.push(el('table', { classe: 'semplice' }, [
        el('caption', {}, [t('span', 'UI_LANGUAGE_' + l.lingua.toUpperCase().replace(/[^A-Z0-9]/g, '_'))]),
        el('tbody', {}, l.campi.map(function (c) {
          return el('tr', {}, [
            t('th', 'UI_TRANSLATION_FIELD_' + c.campo.toUpperCase().replace(/[^A-Z0-9]/g, '_'), null, { scope: 'row' }),
            el('td', {}, [t('span', 'BASE_COUNT', { n: c.tradotti, N: c.totale })]),
          ]);
        })),
      ]));
    });
    return nodi;
  }

  SEZIONI_VISTE.quadro = async function (r, contesto) {
    var q = await api('/admin/overview' + (contesto.anno ? '?anno=' + contesto.anno.id : ''));
    var cose = q.daFare.map(function (v) {
      var testo = t('span', v.codice, v.parametri);
      return el('li', {}, [v.collegamento && sezioneEsistente(v.collegamento) ? collegamentoA(rottaCollegamento(v.collegamento, r), [testo]) : testo]);
    });
    var nodi = [
      t('h3', 'UI_ADMIN_TODO'),
      cose.length ? el('ul', { classe: 'cose-da-fare' }, cose) : t('p', 'UI_TODO_NONE', null, { classe: 'stato' }),
      t('h3', 'UI_ADMIN_SUMMARY_BY_LEVEL'),
    ];
    if (!q.riepilogo.length) nodi.push(t('p', 'UI_ADMIN_SUMMARY_EMPTY', null, { classe: 'stato' }));
    else {
      nodi.push(el('table', { classe: 'semplice riepilogo-livelli' }, [
        q.anno ? t('caption', 'UI_ADMIN_SUMMARY_CAPTION', { anno: q.anno.nome }) : null,
        el('thead', {}, [el('tr', {}, ['COLUMN_LEVEL', 'COLUMN_CLASSES', 'COLUMN_STUDENTS_ENROLLED', 'COLUMN_TEACHERS', 'COLUMN_TEACHINGS']
          .map(function (k) { return t('th', k, null, { scope: 'col' }); }))]),
        el('tbody', {}, q.riepilogo.map(function (riga) {
          return el('tr', {}, [
            el('th', { scope: 'row' }, [contenuto('span', riga.livello.nome)].concat(riga.livello.stato === 'attivo' ? [] : [' · ', t('span', chiaveStatoLivello(riga.livello.stato))])),
            el('td', {}, [I18n.numero(riga.classi, 0)]),
            el('td', {}, [I18n.numero(riga.alunni, 0)]),
            el('td', {}, [I18n.numero(riga.docenti, 0)]),
            el('td', {}, [I18n.numero(riga.insegnamenti, 0)]),
          ]);
        })),
      ]));
    }
    return { nodi: nodi.concat(await sezioneCompletezza()) };
  };

  // --- Calendario: anni (con le loro azioni) e periodi dell'anno di lavoro ------------------

  /** Azioni sugli anni, nell'ordine in cui compaiono; il server dice quali sono ammesse. */
  var AZIONI_ANNO = [
    { id: 'attiva', percorso: 'activate', metodo: 'POST', chiave: 'UI_YEAR_ACTIVATE', per: 'UI_YEAR_ACTIVATE_FOR', conferma: 'UI_YEAR_ACTIVATE_CONFIRM' },
    { id: 'chiudi', percorso: 'close', metodo: 'POST', chiave: 'UI_YEAR_CLOSE', per: 'UI_YEAR_CLOSE_FOR', conferma: 'UI_YEAR_CLOSE_CONFIRM' },
    { id: 'riapri', percorso: 'reopen', metodo: 'POST', chiave: 'UI_YEAR_REOPEN', per: 'UI_YEAR_REOPEN_FOR', conferma: 'UI_YEAR_REOPEN_CONFIRM' },
    { id: 'elimina', percorso: '', metodo: 'DELETE', chiave: 'UI_DELETE', per: 'UI_YEAR_DELETE_FOR', conferma: 'UI_YEAR_DELETE_CONFIRM' },
  ];

  /** Nuovo nome di un anno, nel corpo della pagina (le date non cambiano: governano i periodi). */
  function moduloRinominaAnno(a, annulla) {
    var nome = inputTesto(20, a.nome);
    return moduloAdmin({
      id: 'anno-' + a.id, titolo: 'UI_YEAR_RENAME_FOR', parametri: { anno: a.nome }, nota: 'UI_YEAR_RENAME_NOTE',
      invio: 'UI_SAVE', annulla: annulla,
      campi: [{ nome: 'nome', etichetta: 'UI_SCHOOL_YEAR_NAME', input: nome, campo: 'UI_FIELD_NOME', aiuto: { chiave: 'UI_SCHOOL_YEAR_NAME_HINT' } }],
      invia: async function () {
        var rinominato = await api('/admin/school-years/' + a.id, corpoJson('PUT', { nome: nome.value }));
        stato.insegnamenti = null; // il nome dell'anno compare negli insegnamenti (anno_scolastico)
        return rinominato;
      },
    });
  }

  function rigaAnno(a) {
    var riga = el('li', { classe: 'voce-admin' });
    var azioni = AZIONI_ANNO.filter(function (z) { return a.azioni.indexOf(z.id) >= 0; }).map(function (z) {
      return pulsanteAzione(z.chiave, {
        per: z.per, conferma: z.conferma, parametri: { anno: a.nome },
        esegui: function () { return api('/admin/school-years/' + a.id + (z.percorso ? '/' + z.percorso : ''), corpoJson(z.metodo)); },
      });
    });
    // «Rinomina» solo se il server lo consente (campo rinominabile, distinto dalle azioni di transizione).
    if (a.rinominabile) {
      azioni.unshift(t('button', 'UI_RENAME', null, {
        type: 'button', classe: 'collegamento', 'aria-label': I18n.testo('UI_YEAR_RENAME_FOR', { anno: a.nome }),
        onclick: function () {
          riga.replaceChildren(moduloRinominaAnno(a, function () { disegna(stato.rotta); }));
          riga.querySelector('input').focus();
        },
      }));
    }
    riga.append.apply(riga, [
      el('span', { classe: 'titolo' }, [el('bdi', {}, [a.nome])]),
      ' ', t('span', chiaveStatoAnno(a.stato), null, { classe: 'etichetta-stato stato-' + a.stato }),
      ' ', t('span', 'UI_DATES_RANGE', { inizio: I18n.data(a.dataInizio), fine: I18n.data(a.dataFine) }, { classe: 'sottotitolo' }),
      azioni.length ? el('span', { classe: 'azioni' }, azioni) : '',
    ]);
    return riga;
  }

  function bloccoPassaggio(p) {
    var parametri = { da: p.daAnno.nome, a: p.aAnno.nome };
    return el('section', { classe: 'passaggio', 'aria-labelledby': 'titolo-passaggio' }, [
      t('h4', 'UI_YEAR_SWITCH', null, { id: 'titolo-passaggio' }),
      t('p', 'UI_YEAR_SWITCH_TEXT', parametri),
      pulsanteAzione('UI_YEAR_SWITCH', {
        classe: 'azione', conferma: 'UI_YEAR_SWITCH_CONFIRM', parametri: parametri,
        esegui: function () { return api('/admin/school-years/' + p.aAnno.id + '/switch-to', corpoJson('POST')); },
      }),
    ]);
  }

  function moduloNuovoAnno() {
    var nome = inputTesto(20);
    var inizio = inputData();
    var fine = inputData();
    return moduloAdmin({
      id: 'nuovo-anno', titolo: 'UI_NEW_SCHOOL_YEAR', nota: 'UI_NEW_SCHOOL_YEAR_NOTE', invio: 'UI_CREATE',
      campi: [
        { nome: 'nome', etichetta: 'UI_SCHOOL_YEAR_NAME', input: nome, campo: 'UI_FIELD_NOME', aiuto: { chiave: 'UI_SCHOOL_YEAR_NAME_HINT' } },
        { nome: 'inizio', etichetta: 'UI_DATE_START', input: inizio, campo: 'UI_FIELD_DATA_INIZIO' },
        { nome: 'fine', etichetta: 'UI_DATE_END', input: fine, campo: 'UI_FIELD_DATA_FINE' },
      ],
      invia: function () { return api('/admin/school-years', corpoJson('POST', { nome: nome.value, dataInizio: inizio.value, dataFine: fine.value })); },
    });
  }

  /** Modulo di un periodo: nuovo (periodo assente) o modifica sul posto. */
  function moduloPeriodo(anno, periodo, annulla) {
    var nome = inputTesto(50, periodo ? periodo.nome.testo : null);
    var inizio = inputData(periodo ? periodo.dataInizio : null);
    var fine = inputData(periodo ? periodo.dataFine : null);
    return moduloAdmin({
      id: periodo ? 'periodo-' + periodo.id : 'nuovo-periodo',
      titolo: periodo ? 'UI_EDIT_PERIOD' : 'UI_NEW_PERIOD', parametri: { nome: periodo ? periodo.nome : null, anno: anno.nome },
      nota: periodo ? null : 'UI_PERIOD_NOTE', invio: periodo ? 'UI_SAVE' : 'UI_CREATE', annulla: annulla,
      campi: [
        { nome: 'nome', etichetta: 'UI_PERIOD_NAME', input: nome, campo: 'UI_FIELD_NOME' },
        { nome: 'inizio', etichetta: 'UI_DATE_START', input: inizio, campo: 'UI_FIELD_DATA_INIZIO' },
        { nome: 'fine', etichetta: 'UI_DATE_END', input: fine, campo: 'UI_FIELD_DATA_FINE' },
      ],
      invia: function () {
        var corpo = { nome: nome.value, dataInizio: inizio.value, dataFine: fine.value };
        return periodo ? api('/admin/periods/' + periodo.id, corpoJson('PUT', corpo)) : api('/admin/school-years/' + anno.id + '/periods', corpoJson('POST', corpo));
      },
    });
  }

  function rigaPeriodo(anno, p, modificabile) {
    var riga = el('li', { classe: 'voce-admin' });
    var parametri = { nome: p.nome };
    var azioni = [];
    if (modificabile) {
      azioni.push(t('button', 'UI_EDIT', null, {
        type: 'button', classe: 'collegamento', 'aria-label': I18n.testo('UI_EDIT_FOR', parametri),
        onclick: function () {
          riga.replaceChildren(moduloPeriodo(anno, p, function () { disegna(stato.rotta); }));
          riga.querySelector('input').focus();
        },
      }));
      if (p.eliminabile) {
        azioni.push(pulsanteAzione('UI_DELETE', {
          per: 'UI_DELETE_FOR', conferma: 'UI_PERIOD_DELETE_CONFIRM', parametri: parametri,
          esegui: function () { return api('/admin/periods/' + p.id, corpoJson('DELETE')); },
        }));
      }
    }
    riga.append(
      contenuto('span', p.nome, { classe: 'titolo' }),
      ' ', t('span', 'UI_DATES_RANGE', { inizio: I18n.data(p.dataInizio), fine: I18n.data(p.dataFine) }, { classe: 'sottotitolo' }),
      azioni.length ? el('span', { classe: 'azioni' }, azioni) : ''
    );
    return riga;
  }

  SEZIONI_VISTE.calendario = async function (r, contesto) {
    var dati = contesto.datiAnni;
    var nodi = [t('h3', 'UI_SCHOOL_YEARS')];
    if (dati.passaggio) nodi.push(bloccoPassaggio(dati.passaggio));
    nodi.push(dati.anni.length ? el('ul', { classe: 'elenco-admin elenco-anni' }, dati.anni.map(rigaAnno)) : t('p', 'UI_NO_SCHOOL_YEARS', null, { classe: 'stato' }));
    nodi.push(moduloNuovoAnno());
    if (contesto.anno) {
      var periodi = await api('/admin/school-years/' + contesto.anno.id + '/periods');
      nodi.push(t('h3', 'UI_ASSESSMENT_PERIODS_OF', { anno: contesto.anno.nome }));
      if (!periodi.modificabile) nodi.push(t('p', 'UI_PERIODS_READ_ONLY', { anno: contesto.anno.nome }, { classe: 'nota' }));
      nodi.push(periodi.periodi.length
        ? el('ul', { classe: 'elenco-admin elenco-periodi' }, periodi.periodi.map(function (p) { return rigaPeriodo(contesto.anno, p, periodi.modificabile); }))
        : t('p', 'UI_NO_PERIODS', null, { classe: 'stato' }));
      if (periodi.modificabile) nodi.push(moduloPeriodo(contesto.anno, null, null));
    }
    return { nodi: nodi };
  };

  // --- Livelli e classi --------------------------------------------------------------------

  function moduloLivello(livello, annulla) {
    var nome = inputTesto(100, livello ? livello.nome.testo : null);
    var ordine = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', size: 6, value: livello ? String(livello.ordine) : null });
    return moduloAdmin({
      id: livello ? 'livello-' + livello.id : 'nuovo-livello',
      titolo: livello ? 'UI_EDIT_LEVEL' : 'UI_NEW_SCHOOL_LEVEL', parametri: { nome: livello ? livello.nome : null },
      invio: livello ? 'UI_SAVE' : 'UI_CREATE', annulla: annulla,
      campi: [
        { nome: 'nome', etichetta: 'UI_LEVEL_NAME', input: nome, campo: 'UI_FIELD_NOME', aiuto: { chiave: 'UI_LEVEL_NAME_HINT' } },
        { nome: 'ordine', etichetta: 'UI_LEVEL_ORDER', input: ordine, campo: 'UI_FIELD_ORDINE', aiuto: { chiave: 'UI_LEVEL_ORDER_HINT' } },
      ],
      invia: function () {
        var corpo = { nome: nome.value, ordine: ordine.value };
        return livello ? api('/admin/school-levels/' + livello.id, corpoJson('PUT', corpo)) : api('/admin/school-levels', corpoJson('POST', corpo));
      },
    });
  }

  function rigaLivello(l, r) {
    var riga = el('li', { classe: 'voce-admin' });
    var parametri = { nome: l.nome, livello: l.nome };
    var azioni = [
      haPermesso('class.manage') ? collegamentoA(rottaAdmin(r, { sezione: 'classi', livelloId: l.id }), [t('span', 'UI_LEVEL_OPEN_CLASSES')], {
        'aria-label': I18n.testo('UI_LEVEL_OPEN_CLASSES_FOR', parametri),
      }) : null,
      t('button', 'UI_EDIT', null, {
        type: 'button', classe: 'collegamento', 'aria-label': I18n.testo('UI_EDIT_FOR', parametri),
        onclick: function () { riga.replaceChildren(moduloLivello(l, function () { disegna(stato.rotta); })); riga.querySelector('input').focus(); },
      }),
      l.azioni.indexOf('disattiva') >= 0 ? pulsanteAzione('UI_DEACTIVATE', {
        per: 'UI_DEACTIVATE_FOR', conferma: 'UI_LEVEL_DEACTIVATE_CONFIRM', parametri: parametri,
        esegui: function () { return api('/admin/school-levels/' + l.id + '/deactivate', corpoJson('POST')); },
      }) : null,
      l.azioni.indexOf('riattiva') >= 0 ? pulsanteAzione('UI_REACTIVATE', {
        per: 'UI_REACTIVATE_FOR', parametri: parametri,
        esegui: function () { return api('/admin/school-levels/' + l.id + '/reactivate', corpoJson('POST')); },
      }) : null,
      l.azioni.indexOf('elimina') >= 0 ? pulsanteAzione('UI_DELETE', {
        per: 'UI_DELETE_FOR', conferma: 'UI_LEVEL_DELETE_CONFIRM', parametri: parametri,
        esegui: function () { return api('/admin/school-levels/' + l.id, corpoJson('DELETE')); },
      }) : null,
    ];
    riga.append(
      contenuto('span', l.nome, { classe: 'titolo' }),
      ' ', t('span', chiaveStatoLivello(l.stato), null, { classe: 'etichetta-stato stato-' + l.stato }),
      ' ', el('span', { classe: 'sottotitolo' }, [t('span', 'UI_LEVEL_POSITION', { n: l.ordine }), ' · ', t('span', 'UI_LEVEL_CLASSES_COUNT', { n: l.classiAttive })]),
      el('span', { classe: 'azioni' }, azioni)
    );
    return riga;
  }

  SEZIONI_VISTE.livelli = async function (r) {
    var livelli = await api('/admin/school-levels');
    return {
      nodi: [
        t('h3', 'UI_SCHOOL_LEVELS'),
        t('p', 'UI_SCHOOL_LEVELS_NOTE', null, { classe: 'nota' }),
        livelli.length ? el('ul', { classe: 'elenco-admin elenco-livelli' }, livelli.map(function (l) { return rigaLivello(l, r); }))
          : t('p', 'UI_NO_SCHOOL_LEVELS', null, { classe: 'stato' }),
        moduloLivello(null, null),
      ],
    };
  };

  function moduloClasse(livello, classe, annulla) {
    var nome = inputTesto(50, classe ? classe.nome : null);
    return moduloAdmin({
      id: classe ? 'classe-' + classe.id : 'nuova-classe',
      titolo: classe ? 'UI_RENAME_CLASS' : 'UI_NEW_CLASS', parametri: { nome: classe ? classe.nome : null, livello: livello.nome },
      invio: classe ? 'UI_SAVE' : 'UI_CREATE', annulla: annulla,
      campi: [{ nome: 'nome', etichetta: 'UI_CLASS_NAME', input: nome, campo: 'UI_FIELD_NOME', aiuto: classe ? null : { chiave: 'UI_CLASS_NAME_HINT' } }],
      invia: function () {
        return classe ? api('/admin/classes/' + classe.id, corpoJson('PUT', { nome: nome.value }))
          : api('/admin/school-levels/' + livello.id + '/classes', corpoJson('POST', { nome: nome.value }));
      },
    });
  }

  function rigaClasse(livello, c) {
    var riga = el('li', { classe: 'voce-admin' });
    var parametri = { nome: c.nome, livello: livello.nome };
    var azioni = [
      t('button', 'UI_RENAME', null, {
        type: 'button', classe: 'collegamento', 'aria-label': I18n.testo('UI_RENAME_FOR', parametri),
        onclick: function () { riga.replaceChildren(moduloClasse(livello, c, function () { disegna(stato.rotta); })); riga.querySelector('input').focus(); },
      }),
      c.azioni.indexOf('disattiva') >= 0 ? pulsanteAzione('UI_DEACTIVATE', {
        per: 'UI_DEACTIVATE_FOR', conferma: 'UI_CLASS_DEACTIVATE_CONFIRM', parametri: parametri,
        esegui: function () { return api('/admin/classes/' + c.id + '/deactivate', corpoJson('POST')); },
      }) : null,
      c.azioni.indexOf('riattiva') >= 0 ? pulsanteAzione('UI_REACTIVATE', {
        per: 'UI_REACTIVATE_FOR', parametri: parametri,
        esegui: function () { return api('/admin/classes/' + c.id + '/reactivate', corpoJson('POST')); },
      }) : null,
      c.azioni.indexOf('elimina') >= 0 ? pulsanteAzione('UI_DELETE', {
        per: 'UI_DELETE_FOR', conferma: 'UI_CLASS_DELETE_CONFIRM', parametri: parametri,
        esegui: function () { return api('/admin/classes/' + c.id, corpoJson('DELETE')); },
      }) : null,
    ];
    riga.append(
      el('span', { classe: 'titolo' }, [el('bdi', {}, [c.nome])]),
      ' ', t('span', chiaveStatoClasse(c.stato), null, { classe: 'etichetta-stato stato-' + c.stato }),
      el('span', { classe: 'azioni' }, azioni)
    );
    return riga;
  }

  SEZIONI_VISTE.classi = async function (r) {
    var dati = await api('/admin/school-levels/' + r.livelloId + '/classes');
    var livello = dati.livello;
    return {
      voci: [{ contenuto: livello.nome }],
      nodi: [
        el('h3', {}, [t('span', 'UI_CLASSES_OF_LEVEL'), ' ', contenuto('span', livello.nome)]),
        livello.stato === 'attivo' ? null : t('p', 'UI_LEVEL_DEACTIVATED_NOTE', null, { classe: 'nota' }),
        dati.classi.length ? el('ul', { classe: 'elenco-admin elenco-classi' }, dati.classi.map(function (c) { return rigaClasse(livello, c); }))
          : t('p', 'UI_NO_CLASSES', null, { classe: 'stato' }),
        livello.stato === 'attivo' ? moduloClasse(livello, null, null) : null,
      ],
    };
  };

  // --- Scuole (PLATFORM_ADMIN): entrare in una scuola, crearla, reimpostare una password ----

  SEZIONI_VISTE.scuole = async function () {
    var credenziali = stato.credenzialiDaMostrare;
    stato.credenzialiDaMostrare = null;
    var tenants = await api('/platform/tenants');
    // Entrare in una scuola: lo stesso elenco di pulsanti, con tutte le scuole attive (sempre aggiornato).
    var attive = tenants.filter(function (tn) { return tn.stato === 'attivo'; });
    return {
      nodi: [
        credenziali ? riquadroCredenziali(credenziali) : null,
        el('section', { classe: 'sezione', 'aria-labelledby': 'titolo-entra-istituto' }, [
          t('h3', 'UI_ENTER_TENANT', null, { id: 'titolo-entra-istituto' }),
          attive.length ? elencoIstituti(attive) : t('p', 'UI_NO_TENANT', null, { classe: 'stato' }),
        ]),
        moduloNuovaScuola(),
        t('h3', 'UI_TENANTS'),
        el('ul', { classe: 'elenco-semplice elenco-scuole' }, tenants.map(voceScuola)),
      ],
    };
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
  $('cambia-password').addEventListener('click', function () { vai({ tipo: 'password' }); });
  $('titolo-app').addEventListener('click', function () {
    if (!stato.me || stato.me.deveCambiarePassword || senzaScuole()) return;
    if (stato.me.activeTenantId) vai(rottaDiPartenza());
    else vai(stato.me.isPlatformAdmin ? { tipo: 'amministrazione' } : { tipo: 'istituti' });
  });
  $('cambia-istituto').addEventListener('click', function () { vai({ tipo: 'istituti' }); });

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
