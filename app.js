/* global React, ReactDOM */

const { useState, useEffect, useCallback } = React;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}

function computePseudoOdds(matchId) {
  const rng = mulberry32(seedFromString(String(matchId)));
  const r1 = rng();
  const r2 = rng();
  const r3 = rng();
  const total = r1 + r2 + r3;
  const margin = 0.06;
  const pHome = (r1 / total) * (1 - margin);
  const pDraw = (r2 / total) * (1 - margin);
  const pAway = (r3 / total) * (1 - margin);
  return {
    home: Math.max(1.15, +(1 / pHome).toFixed(2)),
    draw: Math.max(1.15, +(1 / pDraw).toFixed(2)),
    away: Math.max(1.15, +(1 / pAway).toFixed(2)),
  };
}

function formatDateTime(isoString) {
  try {
    return new Date(isoString).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeEvent(ev) {
  return {
    id: ev.idEvent || `${ev.strHomeTeam}-${ev.strAwayTeam}-${ev.dateEvent}`,
    status: ev.strStatus || "Scheduled",
    utcDate: ev.strTimestamp || `${ev.dateEvent}T${ev.strTime || "20:45:00"}`,
    homeTeam: { name: ev.strHomeTeam || "Casa" },
    awayTeam: { name: ev.strAwayTeam || "Ospite" },
    competition: { name: ev.strLeague || ev.strLeagueAlternate || "Competizione" },
    score: {
      winner:
        ev.intHomeScore != null && ev.intAwayScore != null
          ? ev.intHomeScore > ev.intAwayScore
            ? "HOME_TEAM"
            : ev.intHomeScore < ev.intAwayScore
            ? "AWAY_TEAM"
            : "DRAW"
          : null,
    },
  };
}

async function fetchSoccerEvents() {
  const dates = [todayPlus(0), todayPlus(1), todayPlus(2)];
  const requests = dates.map((d) =>
    fetch(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${d}&s=Soccer`)
      .then((r) => r.json())
      .then((j) => j.events || [])
      .catch(() => [])
  );

  const chunks = await Promise.all(requests);
  const all = chunks.flat();

  const seen = new Set();
  return all
    .filter((ev) => ev.strHomeTeam && ev.strAwayTeam)
    .map(normalizeEvent)
    .filter((ev) => {
      if (seen.has(ev.id)) return false;
      seen.add(ev.id);
      return true;
    });
}

function App() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [picks, setPicks] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("picks") || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("picks", JSON.stringify(picks));
  }, [picks]);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchSoccerEvents();
      setMatches(fetched);

      setPicks((prev) =>
        prev.map((pick) => {
          if (pick.result !== null) return pick;
          const match = fetched.find((m) => m.id === pick.matchId);
          if (!match) return pick;
          if (!match.score || !match.score.winner) return pick;

          return {
            ...pick,
            result: match.score.winner === pick.selected ? "WIN" : "LOSE",
            closedAt: new Date().toISOString(),
          };
        })
      );
    } catch (err) {
      setError(err?.message || "Errore nel caricamento eventi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatches();
    const interval = setInterval(fetchMatches, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchMatches]);

  const addPick = useCallback((match, selectedKey) => {
    const odds = computePseudoOdds(match.id);
    const pickOdds =
      selectedKey === "HOME_TEAM"
        ? odds.home
        : selectedKey === "DRAW"
        ? odds.draw
        : odds.away;

    const newPick = {
      id: Date.now() + Math.random(),
      matchId: match.id,
      selected: selectedKey,
      pickOdds,
      odds,
      competition: match.competition?.name || "",
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      utcDate: match.utcDate,
      result: null,
      quality: null,
      note: "",
      addedAt: new Date().toISOString(),
      closedAt: null,
    };

    setPicks((prev) => [...prev, newPick]);
  }, []);

  const deletePick = useCallback((pickId) => {
    setPicks((prev) => prev.filter((p) => p.id !== pickId));
  }, []);

  const updateReview = useCallback((pickId, quality, note) => {
    setPicks((prev) =>
      prev.map((p) => (p.id === pickId ? { ...p, quality, note } : p))
    );
  }, []);

  const stats = picks.reduce(
    (acc, pick) => {
      acc.total += 1;
      if (pick.result) {
        acc.resolved += 1;
        if (pick.result === "WIN") acc.won += 1;
        if (pick.result === "LOSE") acc.lost += 1;
        acc.profit += pick.result === "WIN" ? pick.pickOdds - 1 : -1;
      }
      return acc;
    },
    { total: 0, resolved: 0, won: 0, lost: 0, profit: 0 }
  );

  const upcomingMatches = matches;

  return React.createElement(
    "div",
    { style: { display: "flex", flexDirection: "row", gap: "1rem" } },
    React.createElement(
      "div",
      { className: "column", style: { flex: 1 } },
      React.createElement("h2", null, "Partite"),
      loading ? React.createElement("p", null, "Caricamento in corso…") : null,
      error ? React.createElement("p", { style: { color: "red" } }, `Errore: ${error}`) : null,
      upcomingMatches.length === 0 && !loading
        ? React.createElement("p", null, "Nessuna partita disponibile al momento.")
        : null,
      upcomingMatches.map((match) => {
        const odds = computePseudoOdds(match.id);
        return React.createElement(
          "div",
          { key: match.id, className: "match-card" },
          React.createElement(
            "div",
            { className: "match-header" },
            React.createElement(
              "span",
              { style: { fontWeight: "bold" } },
              match.competition?.name || ""
            ),
            React.createElement(
              "span",
              { style: { fontSize: "0.85rem", color: "#6c757d" } },
              formatDateTime(match.utcDate)
            )
          ),
          React.createElement(
            "div",
            { className: "team-row" },
            React.createElement("span", null, match.homeTeam.name),
            React.createElement("span", null, "vs"),
            React.createElement("span", null, match.awayTeam.name)
          ),
          React.createElement(
            "div",
            { className: "odds-row" },
            React.createElement(
              "button",
              { className: "pick-home", onClick: () => addPick(match, "HOME_TEAM") },
              `Casa ${odds.home}`
            ),
            React.createElement(
              "button",
              { className: "pick-draw", onClick: () => addPick(match, "DRAW") },
              `Pareggio ${odds.draw}`
            ),
            React.createElement(
              "button",
              { className: "pick-away", onClick: () => addPick(match, "AWAY_TEAM") },
              `Ospite ${odds.away}`
            )
          )
        );
      }),
      React.createElement(
        "div",
        { style: { marginTop: "1rem" } },
        React.createElement("button", { onClick: fetchMatches }, "Aggiorna partite")
      )
    ),
    React.createElement(
      "div",
      { className: "column", style: { flex: 1 } },
      React.createElement("h2", null, "Le tue giocate"),
      picks.length === 0
        ? React.createElement("p", null, "Ancora nessuna giocata registrata.")
        : null,
      picks.map((pick) => {
        const matchDate = formatDateTime(pick.utcDate);
        const outcomeLabel =
          pick.selected === "HOME_TEAM"
            ? "Casa"
            : pick.selected === "DRAW"
            ? "Pareggio"
            : "Ospite";
        const resultColor =
          pick.result === "WIN" ? "#198754" : pick.result === "LOSE" ? "#dc3545" : "#0d6efd";
        const resultText =
          pick.result === "WIN" ? "Vinta" : pick.result === "LOSE" ? "Persa" : "In attesa";

        return React.createElement(
          "div",
          { key: pick.id, className: "pick-card" },
          React.createElement(
            "div",
            { className: "match-header" },
            React.createElement(
              "span",
              { style: { fontWeight: "bold" } },
              `${pick.homeTeam} vs ${pick.awayTeam}`
            ),
            React.createElement(
              "span",
              { style: { fontSize: "0.85rem", color: "#6c757d" } },
              matchDate
            )
          ),
          React.createElement(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.9rem" } },
            React.createElement("span", null, `Giocata: ${outcomeLabel} @ ${pick.pickOdds}`),
            React.createElement("span", { style: { color: resultColor, fontWeight: "bold" } }, resultText)
          ),
          pick.result !== null
            ? React.createElement(
                "div",
                { style: { marginTop: "0.5rem" } },
                React.createElement("label", { htmlFor: `quality-${pick.id}`, style: { fontSize: "0.8rem" } }, "Valutazione (1-5): "),
                React.createElement("input", {
                  id: `quality-${pick.id}`,
                  type: "number",
                  min: 1,
                  max: 5,
                  step: 1,
                  value: pick.quality !== null ? pick.quality : "",
                  onChange: (e) =>
                    updateReview(pick.id, e.target.value ? parseInt(e.target.value) : null, pick.note),
                }),
                React.createElement("br"),
                React.createElement("label", { htmlFor: `note-${pick.id}`, style: { fontSize: "0.8rem" } }, "Nota: "),
                React.createElement("textarea", {
                  id: `note-${pick.id}`,
                  rows: 2,
                  style: { width: "100%" },
                  value: pick.note,
                  onChange: (e) => updateReview(pick.id, pick.quality, e.target.value),
                })
              )
            : null,
          React.createElement(
            "button",
            { className: "delete-btn", onClick: () => deletePick(pick.id) },
            "Elimina"
          )
        );
      }),
      React.createElement(
        "div",
        { className: "stats" },
        React.createElement("h3", null, "Statistiche"),
        React.createElement("p", null, `Giocate totali: ${stats.total}`),
        React.createElement("p", null, `Risultate: ${stats.resolved} (Vinte: ${stats.won} / Perse: ${stats.lost})`),
        React.createElement("p", null, `Profitto stimato: ${stats.profit.toFixed(2)} unità`)
      )
    )
  );
}

const container = document.getElementById("app-root");
const root = ReactDOM.createRoot(container);
root.render(React.createElement(App));
