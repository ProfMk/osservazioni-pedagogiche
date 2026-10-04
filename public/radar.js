/*
 * Geometria del radar dei nuclei tematici (report pedagogico dello studente).
 *
 * SOLO disegno: riceve posizioni già calcolate dal server (posizioneRadar, 0-100) e restituisce
 * coordinate. Nessuna media, soglia o giudizio viene calcolato qui. Il numero degli assi è quello
 * dei nuclei ricevuti: niente è fissato per una materia o per una scala.
 *
 * Caricabile dal browser (<script>, espone window.RadarNuclei) e da Node (require) per i test.
 */
(function (radice, fabbrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabbrica();
  else radice.RadarNuclei = fabbrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Sotto questo numero di assi un radar non ha senso geometrico: si usano le barre.
  var MINIMO_ASSI_RADAR = 3;

  function arrotonda(valore) { return Math.round(valore * 100) / 100; }

  function limita(posizione) { return Math.max(0, Math.min(100, posizione)); }

  function haValore(posizione) { return posizione !== null && posizione !== undefined; }

  /**
   * @param {{assi: {id: *, posizione: number|null, pieno: boolean}[],
   *          bande: {etichetta: string, posizione: number|null}[], raggio?: number}} dati
   *   assi  - uno per nucleo, nell'ordine ricevuto; posizione null = nucleo non valutato.
   *   bande - soglie di giudizio dell'istituto già convertite in posizione; null = nessun anello.
   * @returns {{modalita: 'radar'|'barre', raggio: number, assi: object[], anelli: object[], tratti: object[]}}
   */
  function geometria(dati) {
    var raggio = dati.raggio || 100;
    var numero = dati.assi.length;
    var modalita = numero >= MINIMO_ASSI_RADAR ? 'radar' : 'barre';

    function punto(indice, posizione) {
      // Primo asse in alto, poi in senso orario.
      var angolo = -Math.PI / 2 + (2 * Math.PI * indice) / numero;
      var distanza = (raggio * posizione) / 100;
      return { x: arrotonda(Math.cos(angolo) * distanza), y: arrotonda(Math.sin(angolo) * distanza) };
    }

    var assi = dati.assi.map(function (asse, indice) {
      var valutato = haValore(asse.posizione);
      var posizione = valutato ? limita(asse.posizione) : null;
      var estremo = punto(indice, 100);
      var etichetta = punto(indice, 118);
      return {
        id: asse.id,
        indice: indice,
        valutato: valutato,
        posizione: posizione,
        pieno: valutato && !!asse.pieno,
        estremo: estremo,
        etichetta: {
          x: etichetta.x,
          y: etichetta.y,
          ancoraggio: Math.abs(etichetta.x) < raggio * 0.05 ? 'middle' : (etichetta.x > 0 ? 'start' : 'end'),
        },
        // Un nucleo non valutato NON ha punto: nessun valore inventato, nemmeno lo zero.
        punto: valutato ? punto(indice, posizione) : null,
      };
    });

    var anelli = (dati.bande || [])
      .filter(function (banda) { return haValore(banda.posizione) && banda.posizione > 0 && banda.posizione <= 100; })
      .map(function (banda) {
        return {
          etichetta: banda.etichetta,
          posizione: banda.posizione,
          raggio: arrotonda((raggio * banda.posizione) / 100),
          vertici: assi.map(function (asse) { return punto(asse.indice, banda.posizione); }),
        };
      });

    // Lati del poligono: solo tra assi ADIACENTI entrambi valutati, così il poligono si interrompe
    // attorno a un nucleo non valutato invece di attraversarlo. Tratteggiato se uno dei due estremi
    // è un risultato parziale o provvisorio (punto vuoto).
    var tratti = [];
    if (modalita === 'radar') {
      assi.forEach(function (asse, indice) {
        var successivo = assi[(indice + 1) % numero];
        if (!asse.valutato || !successivo.valutato) return;
        tratti.push({ da: asse.punto, a: successivo.punto, tratteggiato: !(asse.pieno && successivo.pieno) });
      });
    }

    return { modalita: modalita, raggio: raggio, assi: assi, anelli: anelli, tratti: tratti };
  }

  return { geometria: geometria, MINIMO_ASSI_RADAR: MINIMO_ASSI_RADAR };
}));
