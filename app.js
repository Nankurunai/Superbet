// Stand‑alone Super App Scommesse
//
// Questo file contiene tutta la logica lato client per
// recuperare i dati delle partite, calcolare delle quote
// pseudo‑casuali ma deterministiche, registrare le giocate
// dell’utente e aggiornare gli esiti quando le partite
// risultano concluse. Non richiede alcuna chiave API
// grazie all’utilizzo dell’endpoint pubblico di football-data.org
// che consente la consultazione delle partite in base a
// intervalli di data. Tutto è salvato in localStorage.

/* global React, ReactDOM */

const { useState, useEffect, useCallback } = React;

// Wrapper per IndexedDB per gestire persistenza delle giocate.
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('superapp', 1);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('picks')) {
        db.createObjectStore('picks', { keyPath: 'id' });
      }
    };
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
  });
}

async function idbGetAllPicks() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('picks', 'readonly');
    const store = transaction.objectStore('picks');
    const request = store.getAll();
    request.onsuccess = event => resolve(event.target.result || []);
    request.onerror = event => reject(event.target.error);
  });
}

async function idbSaveAllPicks(picks) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('picks', 'readwrite');
    const store = transaction.objectStore('picks');
    // Clear store then put all
    const clearReq = store.clear();
    clearReq.onsuccess = () => {
      picks.forEach(pick => store.put(pick));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = event => reject(event.target.error);
  });
}

// Crea un generatore di numeri pseudo‑casuali deterministico
// basato sull’algoritmo mulberry32. Servirà per calcolare le
// quote in modo ripetibile a partire dall’ID della partita.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Calcola le quote (home, draw, away) in base all'id della partita.
// Il risultato è un oggetto con tre proprietà: home, draw e away.
// La somma reciproca (1/odds) fornisce probabilità fittizie che
// rispettano un overround del 5%. I valori sono arrotondati a 2 cifre.
function computePseudoOdds(matchId) {
  const rng = mulberry32(matchId);
  const r1 = rng();
  const r2 = rng();
  const r3 = rng();
  const total = r1 + r2 + r3;
  // Riserviamo una piccola commissione (overround) del 5%
  const margin = 0.05;
  const pHome = (r1 / total) * (1 - margin);
  const pDraw = (r2 / total) * (1 - margin);
  const pAway = (r3 / total) * (1 - margin);
  // Evitiamo quote ridicolmente basse o alte impostando un minimo e massimo
  const minOdd = 1.15;
  const maxOdd = 8;
  const homeOdd = Math.min(maxOdd, Math.max(minOdd, 1 / pHome));
  const drawOdd = Math.min(maxOdd, Math.max(minOdd, 1 / pDraw));
  const awayOdd = Math.min(maxOdd, Math.max(minOdd, 1 / pAway));
  return {
    home: Math.round(homeOdd * 100) / 100,
    draw: Math.round(drawOdd * 100) / 100,
    away: Math.round(awayOdd * 100) / 100,
  };
}

// Format a UTC date string into a local date/time string (Italian locale).
function formatDateTime(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return isoString;
  }
}

// Principale componente dell’app.
function App() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [picks, setPicks] = useState(() => {
    // Inizialmente recupera dal localStorage come fallback; i dati verranno
    // eventualmente sovrascritti da IndexedDB quando disponibili.
    try {
      return JSON.parse(localStorage.getItem('picks') || '[]');
    } catch (e) {
      return [];
    }
  });

  // Carica le giocate salvate da IndexedDB al montaggio. Se presenti,
  // sostituisce lo stato corrente (che deriva da localStorage). In questo
  // modo le giocate persistono anche se l’utente cancella i dati locali.
  useEffect(() => {
    let cancelled = false;
    idbGetAllPicks()
      .then(stored => {
        if (!cancelled && stored && stored.length > 0) {
          setPicks(stored);
        }
      })
      .catch(err => {
        console.error('Errore nel recupero da IndexedDB', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Aggiorna la persistenza ogni volta che cambia lo stato delle giocate.
  // Salva sia in localStorage (per compatibilità con vecchie versioni e debugging)
  // che in IndexedDB (per affidabilità e capacità).
  useEffect(() => {
    try {
      localStorage.setItem('picks', JSON.stringify(picks));
    } catch (e) {
      console.error('Errore salvataggio localStorage', e);
    }
    // Salva in IndexedDB in maniera asincrona
    idbSaveAllPicks(picks).catch(err => {
      console.error('Errore salvataggio IndexedDB', err);
    });
  }, [picks]);

  // Calcola la finestra temporale per richiedere partite (ieri‑domani)
  const computeDateRange = () => {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const format = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { from: format(from), to: format(to) };
  };

  // Funzione che recupera le partite dalla API pubblica
  const fetchMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Non usiamo più i parametri dateFrom/dateTo perché l'API restituisce un errore 400
      // se forniti senza autorizzazione. L'endpoint /matches senza parametri
      // restituisce per default le partite dalla data corrente al giorno successivo.
      let fetched = [];
      // Se l'app è eseguita all'interno di una WebView Android, è disponibile
      // l'oggetto window.android. In tal caso delega la richiesta al codice
      // nativo per superare il problema CORS. android.fetchMatches(from, to)
      // deve restituire una stringa JSON rappresentante l'oggetto restituito
      // dall'API football-data.org.
      if (typeof window !== 'undefined' && window.android && typeof window.android.fetchMatches === 'function') {
        // Calcola l'intervallo di date anche per l'invocazione nativa
        const { from, to } = computeDateRange();
        const jsonString = await window.android.fetchMatches(from, to);
        const parsed = JSON.parse(jsonString);
        fetched = parsed.matches || [];
      } else {
        // Altrimenti tenta di eseguire la richiesta via fetch. Se l'app è
        // aperta tramite protocollo file://, molte API rifiutano origine
        // null; perciò usiamo un proxy pubblico. Qualora il proxy restituisca
        // errore, catturiamo l'eccezione.
        const endpoint = `https://api.football-data.org/v4/matches`;
        const proxiedUrl = 'https://corsproxy.io/?' + encodeURIComponent(endpoint);
        const response = await fetch(proxiedUrl);
        if (!response.ok) {
          throw new Error(`Errore nella richiesta: ${response.status}`);
        }
        const json = await response.json();
        fetched = json.matches || [];
      }
      // Aggiorna lo stato delle partite
      setMatches(fetched);
      // Aggiorna gli esiti delle giocate concluse
      setPicks(prevPicks => {
        return prevPicks.map(pick => {
          if (pick.result !== null) return pick; // già valutata
          const match = fetched.find(m => m.id === pick.matchId);
          if (match && match.status === 'FINISHED') {
            const winner = match.score && match.score.winner;
            let newResult = null;
            if (winner === pick.selected) {
              newResult = 'WIN';
            } else {
              newResult = 'LOSE';
            }
            return {
              ...pick,
              result: newResult,
              closedAt: new Date().toISOString(),
            };
          }
          return pick;
        });
      });
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Effettua la prima richiesta e imposta refresh periodico (ogni 30 minuti).
  useEffect(() => {
    fetchMatches();
    const interval = setInterval(fetchMatches, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchMatches]);

  // Aggiungi una giocata alla lista
  const addPick = useCallback((match, selectedKey) => {
    const odds = computePseudoOdds(match.id);
    const pickOdds = selectedKey === 'HOME_TEAM' ? odds.home : selectedKey === 'DRAW' ? odds.draw : odds.away;
    const newPick = {
      id: Date.now() + Math.random(),
      matchId: match.id,
      selected: selectedKey,
      pickOdds,
      odds,
      competition: match.competition ? match.competition.name : '',
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      utcDate: match.utcDate,
      result: null,
      quality: null,
      note: '',
      addedAt: new Date().toISOString(),
      closedAt: null,
    };
    setPicks(prev => [...prev, newPick]);
  }, []);

  // Elimina una giocata
  const deletePick = useCallback((pickId) => {
    setPicks(prev => prev.filter(p => p.id !== pickId));
  }, []);

  // Aggiorna i campi review (quality e note) per una giocata
  const updateReview = useCallback((pickId, quality, note) => {
    setPicks(prev => prev.map(p => p.id === pickId ? { ...p, quality, note } : p));
  }, []);

  // Statistiche derivate dalle giocate
  const stats = picks.reduce((acc, pick) => {
    acc.total += 1;
    if (pick.result) {
      acc.resolved += 1;
      if (pick.result === 'WIN') acc.won += 1;
      if (pick.result === 'LOSE') acc.lost += 1;
      // Calcola profitto: stake 1 unità per giocata.
      acc.profit += pick.result === 'WIN' ? (pick.pickOdds - 1) : -1;
    }
    return acc;
  }, { total: 0, resolved: 0, won: 0, lost: 0, profit: 0 });

  // Separiamo le partite in scheduled/inplay e finished
  const upcomingMatches = matches.filter(m => m.status !== 'FINISHED');

  return (
    React.createElement('div', { style: { display: 'flex', flexDirection: 'row', gap: '1rem' } },
      // Colonna partite
      React.createElement('div', { className: 'column', style: { flex: 1 } },
        React.createElement('h2', null, 'Partite'),
        loading ? React.createElement('p', null, 'Caricamento in corso…') : null,
        error ? React.createElement('p', { style: { color: 'red' } }, `Errore: ${error}`) : null,
        upcomingMatches.length === 0 && !loading ? React.createElement('p', null, 'Nessuna partita in programma nel periodo selezionato.') : null,
        upcomingMatches.map(match => {
          const odds = computePseudoOdds(match.id);
          return React.createElement('div', { key: match.id, className: 'match-card' },
            React.createElement('div', { className: 'match-header' },
              React.createElement('span', { style: { fontWeight: 'bold' } }, match.competition ? match.competition.name : ''),
              React.createElement('span', { style: { fontSize: '0.85rem', color: '#6c757d' } }, formatDateTime(match.utcDate))
            ),
            React.createElement('div', { className: 'team-row' },
              React.createElement('span', null, match.homeTeam.name),
              React.createElement('span', null, 'vs'),
              React.createElement('span', null, match.awayTeam.name)
            ),
            React.createElement('div', { className: 'odds-row' },
              React.createElement('button', {
                className: 'pick-home',
                onClick: () => addPick(match, 'HOME_TEAM')
              }, `Casa ${odds.home}`),
              React.createElement('button', {
                className: 'pick-draw',
                onClick: () => addPick(match, 'DRAW')
              }, `Pareggio ${odds.draw}`),
              React.createElement('button', {
                className: 'pick-away',
                onClick: () => addPick(match, 'AWAY_TEAM')
              }, `Ospite ${odds.away}`)
            )
          );
        }),
        React.createElement('div', { style: { marginTop: '1rem' } },
          React.createElement('button', { onClick: fetchMatches }, 'Aggiorna partite')
        )
      ),
      // Colonna giocate
      React.createElement('div', { className: 'column', style: { flex: 1 } },
        React.createElement('h2', null, 'Le tue giocate'),
        picks.length === 0 ? React.createElement('p', null, 'Ancora nessuna giocata registrata.') : null,
        picks.map(pick => {
          const matchDate = formatDateTime(pick.utcDate);
          const outcomeLabel = pick.selected === 'HOME_TEAM' ? 'Casa' : pick.selected === 'DRAW' ? 'Pareggio' : 'Ospite';
          const resultColor = pick.result === 'WIN' ? '#198754' : pick.result === 'LOSE' ? '#dc3545' : '#0d6efd';
          const resultText = pick.result === 'WIN' ? 'Vinta' : pick.result === 'LOSE' ? 'Persa' : 'In attesa';
          return React.createElement('div', { key: pick.id, className: 'pick-card' },
            React.createElement('div', { className: 'match-header' },
              React.createElement('span', { style: { fontWeight: 'bold' } }, `${pick.homeTeam} vs ${pick.awayTeam}`),
              React.createElement('span', { style: { fontSize: '0.85rem', color: '#6c757d' } }, matchDate)
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' } },
              React.createElement('span', null, `Giocata: ${outcomeLabel} @ ${pick.pickOdds}`),
              React.createElement('span', { style: { color: resultColor, fontWeight: 'bold' } }, resultText)
            ),
            // Review fields (qualità e nota) solo se la giocata è risolta
            pick.result !== null ? React.createElement('div', { style: { marginTop: '0.5rem' } },
              React.createElement('label', { htmlFor: `quality-${pick.id}`, style: { fontSize: '0.8rem' } }, 'Valutazione (1‑5): '),
              React.createElement('input', {
                id: `quality-${pick.id}`,
                type: 'number',
                min: 1,
                max: 5,
                step: 1,
                value: pick.quality !== null ? pick.quality : '',
                onChange: e => updateReview(pick.id, e.target.value ? parseInt(e.target.value) : null, pick.note)
              }),
              React.createElement('br'),
              React.createElement('label', { htmlFor: `note-${pick.id}`, style: { fontSize: '0.8rem' } }, 'Nota: '),
              React.createElement('textarea', {
                id: `note-${pick.id}`,
                rows: 2,
                style: { width: '100%' },
                value: pick.note,
                onChange: e => updateReview(pick.id, pick.quality, e.target.value)
              })
            ) : null,
            React.createElement('button', {
              className: 'delete-btn',
              onClick: () => deletePick(pick.id)
            }, 'Elimina')
          );
        }),
        // Statistiche complessive
        React.createElement('div', { className: 'stats' },
          React.createElement('h3', null, 'Statistiche'),
          React.createElement('p', null, `Giocate totali: ${stats.total}`),
          React.createElement('p', null, `Risultate: ${stats.resolved} (Vinte: ${stats.won} / Perse: ${stats.lost})`),
          React.createElement('p', null, `Profitto stimato: ${stats.profit.toFixed(2)} unità`)
        )
      )
    )
  );
}

// Monta l’app nel contenitore app-root
const container = document.getElementById('app-root');
const root = ReactDOM.createRoot(container);
root.render(React.createElement(App));