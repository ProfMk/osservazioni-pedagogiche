/*
 * Geometria del DISCO (Visual Grammar V2.1, decisione C4) — modulo SOLO presentazionale.
 *
 * Converte posizioni già ricevute dal server (posizioneAsse 0–100) e un numero di categorie
 * in coordinate SVG. Usa seno e coseno per disegnare gli spicchi; non calcola percentuali,
 * bande, medie, certezza o confronti: tutta la semantica arriva dal server.
 *
 *   settore = categoria: tutti i settori hanno lo stesso angolo (mai proporzionale al valore);
 *   raggio  = valore:    0% = bordo interno, 100% = bordo esterno.
 *
 * Ordine dei settori: dall'alto, nel verso di lettura (orario in LTR, antiorario in RTL),
 * così il primo nucleo è sempre all'inizio della riga di lettura e il disco si specchia.
 * Caricabile dal browser (window.Geometria) e da Node (require) per i test.
 */
(function (radice, fabbrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabbrica();
  else radice.Geometria = fabbrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var INIZIO = -Math.PI / 2; // ore 12
  var SPAZIO = 0.035; // separazione tra settori (radianti); nessuna con un solo settore
  var MASSIMO_SETTORI = 6; // decisione C5: oltre, niente disco

  /** Settori di uguale ampiezza: [{ a0, a1, medio }] in radianti (verso orario, prima dello specchio RTL). */
  function settori(n) {
    var passo = (2 * Math.PI) / n;
    var spazio = n === 1 ? 0 : SPAZIO;
    var elenco = [];
    for (var i = 0; i < n; i += 1) {
      var a0 = INIZIO + i * passo + spazio / 2;
      var a1 = a0 + passo - spazio;
      elenco.push({ a0: a0, a1: a1, medio: (a0 + a1) / 2, ampiezza: a1 - a0 });
    }
    return elenco;
  }

  /** Raggio di una posizione 0–100 tra il bordo interno r0 e quello esterno r1. */
  function raggio(r0, r1, posizione) {
    return r0 + (r1 - r0) * (posizione / 100);
  }

  /** Punto (x, y) a raggio r e angolo a; in RTL la x si specchia. */
  function punto(r, a, rtl) {
    var x = r * Math.cos(a);
    return [rtl ? -x : x, r * Math.sin(a)];
  }

  function n(v) { return Math.round(v * 100) / 100; }

  /** Tracciato di una corona circolare tra r0 e r1, da a0 ad a1 (settore pieno se l'ampiezza è 2π). */
  function corona(r0, r1, a0, a1, rtl) {
    if (a1 - a0 >= 2 * Math.PI - 1e-9) {
      // Cerchio intero: due semicerchi per ciascun bordo, riempimento a regola evenodd.
      return [r1, r0].map(function (r) {
        return 'M' + n(r) + ' 0A' + n(r) + ' ' + n(r) + ' 0 1 1 ' + n(-r) + ' 0A' + n(r) + ' ' + n(r) + ' 0 1 1 ' + n(r) + ' 0Z';
      }).join('');
    }
    var grande = a1 - a0 > Math.PI ? 1 : 0;
    var verso = rtl ? 0 : 1;
    var p0 = punto(r1, a0, rtl);
    var p1 = punto(r1, a1, rtl);
    var p2 = punto(r0, a1, rtl);
    var p3 = punto(r0, a0, rtl);
    return 'M' + n(p0[0]) + ' ' + n(p0[1])
      + 'A' + n(r1) + ' ' + n(r1) + ' 0 ' + grande + ' ' + verso + ' ' + n(p1[0]) + ' ' + n(p1[1])
      + 'L' + n(p2[0]) + ' ' + n(p2[1])
      + 'A' + n(r0) + ' ' + n(r0) + ' 0 ' + grande + ' ' + (1 - verso) + ' ' + n(p3[0]) + ' ' + n(p3[1]) + 'Z';
  }

  /** Arco di raggio r da a0 ad a1 (cerchio intero se l'ampiezza è 2π). */
  function arco(r, a0, a1, rtl) {
    if (a1 - a0 >= 2 * Math.PI - 1e-9) {
      return 'M' + n(r) + ' 0A' + n(r) + ' ' + n(r) + ' 0 1 1 ' + n(-r) + ' 0A' + n(r) + ' ' + n(r) + ' 0 1 1 ' + n(r) + ' 0';
    }
    var p0 = punto(r, a0, rtl);
    var p1 = punto(r, a1, rtl);
    return 'M' + n(p0[0]) + ' ' + n(p0[1]) + 'A' + n(r) + ' ' + n(r) + ' 0 ' + (a1 - a0 > Math.PI ? 1 : 0) + ' ' + (rtl ? 0 : 1) + ' ' + n(p1[0]) + ' ' + n(p1[1]);
  }

  /** Segmento radiale (terminale dell'arco di classe) all'angolo a, tra r - l e r + l. */
  function terminale(r, l, a, rtl) {
    var p0 = punto(r - l, a, rtl);
    var p1 = punto(r + l, a, rtl);
    return 'M' + n(p0[0]) + ' ' + n(p0[1]) + 'L' + n(p1[0]) + ' ' + n(p1[1]);
  }

  /** Rombo (◇ storico) centrato nel punto (x, y). */
  function rombo(x, y, l) {
    return 'M' + n(x) + ' ' + n(y - l) + 'L' + n(x + l * 0.85) + ' ' + n(y) + 'L' + n(x) + ' ' + n(y + l) + 'L' + n(x - l * 0.85) + ' ' + n(y) + 'Z';
  }

  /** Lato dell'etichetta esterna: 'inizio', 'fine' o 'centro' (per text-anchor con direzione ltr). */
  function lato(x) {
    if (Math.abs(x) < 1) return 'middle';
    return x > 0 ? 'start' : 'end';
  }

  /** Impianto del disco: raggi e viewBox (il disco mini non ha etichette esterne). */
  function impianto(mini) {
    var R = 100;
    var orizzontale = R + (mini ? 6 : 130);
    var verticale = R + (mini ? 6 : 85);
    return { R: R, r0: mini ? 46 : 58, viewBox: (-orizzontale) + ' ' + (-verticale) + ' ' + orizzontale * 2 + ' ' + verticale * 2 };
  }

  /** Raggio del riempimento: mai meno di uno spessore visibile, anche per 0%. */
  function raggioRiempimento(r0, r1, posizione) {
    return Math.max(raggio(r0, r1, posizione), r0 + 1.5);
  }

  /** Angolo del ◇ storico: poco oltre il centro del settore, per non coprire l'arco della classe. */
  function angoloStorico(settore, n) {
    return settore.medio + (n === 1 ? 0.35 : Math.min(0.2, settore.ampiezza / 5));
  }

  /** Estremi dell'arco di classe (con terminali) dentro il settore. */
  function estremiArco(settore, n) {
    return n === 1 ? [settore.a0, settore.a1] : [settore.a0 + 0.06, settore.a1 - 0.06];
  }

  /** Posizione dell'etichetta esterna di un settore con `righe` righe di testo (interlinea 15). */
  function etichetta(R, settore, n, righe, rtl) {
    var p = punto(R + 16, n === 1 ? Math.PI / 2 : settore.medio, rtl);
    var y0 = p[1] > 20 ? p[1] + 12 : p[1] < -20 ? p[1] - righe * 15 - 4 : p[1] - (righe * 15) / 2;
    return { x: p[0], y: y0, ancora: lato(p[0]) };
  }

  return {
    MASSIMO_SETTORI: MASSIMO_SETTORI,
    settori: settori, raggio: raggio, punto: punto, corona: corona, arco: arco, terminale: terminale, rombo: rombo, lato: lato,
    impianto: impianto, raggioRiempimento: raggioRiempimento, angoloStorico: angoloStorico, estremiArco: estremiArco, etichetta: etichetta,
  };
}));
