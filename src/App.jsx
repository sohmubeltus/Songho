import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================
// CONSTANTS
// ============================================================
const RULES = {
  pitsPerPlayer: 7,
  initialSeeds: 5,
  totalSeeds: 70,
  victoryScore: 40,
  lowBoardLimit: 10,
  captureValues: [2, 3, 4],
  maxNormalSow: 13,
};

const CYCLE = [
  { player: "north", pitIndex: 0 },
  { player: "north", pitIndex: 1 },
  { player: "north", pitIndex: 2 },
  { player: "north", pitIndex: 3 },
  { player: "north", pitIndex: 4 },
  { player: "north", pitIndex: 5 },
  { player: "north", pitIndex: 6 },
  { player: "south", pitIndex: 6 },
  { player: "south", pitIndex: 5 },
  { player: "south", pitIndex: 4 },
  { player: "south", pitIndex: 3 },
  { player: "south", pitIndex: 2 },
  { player: "south", pitIndex: 1 },
  { player: "south", pitIndex: 0 },
];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
const other = (p) => (p === "north" ? "south" : "north");
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const samePos = (a, b) => a.player === b.player && a.pitIndex === b.pitIndex;
const cycleIndexOf = (pos) => CYCLE.findIndex((c) => samePos(c, pos));

const attackPit = (player) =>
  player === "north"
    ? { player: "north", pitIndex: 6 }
    : { player: "south", pitIndex: 0 };

const opponentFirstPit = (player) =>
  player === "north"
    ? { player: "south", pitIndex: 6 }
    : { player: "north", pitIndex: 0 };

const opponentPath = (player) =>
  player === "north"
    ? [6, 5, 4, 3, 2, 1, 0].map((i) => ({ player: "south", pitIndex: i }))
    : [0, 1, 2, 3, 4, 5, 6].map((i) => ({ player: "north", pitIndex: i }));

const nextPositionsAfter = (source) => {
  const start = cycleIndexOf(source);
  return Array.from({ length: 13 }, (_, step) =>
    CYCLE[(start + step + 1) % CYCLE.length]
  );
};

const cloneState = (state) => ({
  board: { north: [...state.board.north], south: [...state.board.south] },
  scores: { ...state.scores },
  currentPlayer: state.currentPlayer,
  status: state.status,
  winner: state.winner,
  reason: state.reason,
  moveNumber: state.moveNumber,
  history: [...state.history],
});

const boardSeeds = (state) =>
  sum(state.board.north) + sum(state.board.south);

const totalSeeds = (state) =>
  state.scores.north + state.scores.south + boardSeeds(state);

const isCaptureValue = (n) => n === 2 || n === 3 || n === 4;

// ============================================================
// SOWING
// ============================================================
function sowNormal(state, player, pitIndex) {
  const seeds = state.board[player][pitIndex];
  const source = { player, pitIndex };
  const visited = [];
  state.board[player][pitIndex] = 0;
  const path = nextPositionsAfter(source);
  for (let i = 0; i < seeds; i++) {
    const pos = path[i];
    state.board[pos.player][pos.pitIndex] += 1;
    visited.push(pos);
  }
  return { visited, lastPosition: visited[visited.length - 1], specialCapture: 0 };
}

function sowGranary(state, player, pitIndex) {
  const seeds = state.board[player][pitIndex];
  const source = { player, pitIndex };
  const visited = [];
  let remaining = seeds;
  let specialCapture = 0;
  state.board[player][pitIndex] = 0;

  for (const pos of nextPositionsAfter(source)) {
    state.board[pos.player][pos.pitIndex] += 1;
    visited.push(pos);
    remaining -= 1;
  }

  const path = opponentPath(player);
  for (let i = 0; i < remaining; i++) {
    const pos = path[i % path.length];
    const isLast = i === remaining - 1;
    const isProtected = samePos(pos, opponentFirstPit(player));
    if (isLast && isProtected) {
      specialCapture += 1;
      visited.push(pos);
      continue;
    }
    state.board[pos.player][pos.pitIndex] += 1;
    visited.push(pos);
  }
  return { visited, lastPosition: visited[visited.length - 1], specialCapture };
}

function sow(state, player, pitIndex) {
  const seeds = state.board[player][pitIndex];
  if (seeds <= 0) throw new Error("Case vide");
  return seeds <= RULES.maxNormalSow
    ? sowNormal(state, player, pitIndex)
    : sowGranary(state, player, pitIndex);
}

// ============================================================
// CAPTURE
// ============================================================
function canStartCapture(state, player, lastPos) {
  if (!lastPos || lastPos.player === player) return false;
  if (samePos(lastPos, opponentFirstPit(player))) return false;
  return isCaptureValue(state.board[lastPos.player][lastPos.pitIndex]);
}

function captureChainPositions(state, player, lastPos) {
  const path = opponentPath(player);
  const lastIdx = path.findIndex((p) => samePos(p, lastPos));
  if (lastIdx <= 0) return [];
  const captured = [];
  for (let i = lastIdx; i >= 0; i--) {
    const pos = path[i];
    const count = state.board[pos.player][pos.pitIndex];
    if (!isCaptureValue(count)) break;
    captured.push({ ...pos, seeds: count });
  }
  return captured;
}

function wouldEmpty(state, player, captureList) {
  const opp = other(player);
  const rem = [...state.board[opp]];
  for (const c of captureList) rem[c.pitIndex] -= c.seeds;
  return sum(rem) === 0;
}

function applyCaptureIfAllowed(state, player, captureList) {
  if (!captureList.length) return 0;
  if (wouldEmpty(state, player, captureList)) return 0;
  let total = 0;
  for (const c of captureList) {
    state.board[c.player][c.pitIndex] -= c.seeds;
    total += c.seeds;
  }
  state.scores[player] += total;
  return total;
}

function resolveCaptures(state, player, sowingResult) {
  if (sowingResult.specialCapture > 0) {
    state.scores[player] += sowingResult.specialCapture;
    return { captured: sowingResult.specialCapture, type: "special-granary" };
  }
  const last = sowingResult.lastPosition;
  if (!canStartCapture(state, player, last)) {
    return { captured: 0, type: "none" };
  }
  const list = captureChainPositions(state, player, last);
  const captured = applyCaptureIfAllowed(state, player, list);
  return {
    captured,
    type: captured > 0 && list.length > 1 ? "chain" : captured > 0 ? "normal" : "none",
    cancelledByStarvation: captured === 0 && list.length > 0,
  };
}

// ============================================================
// LEGAL MOVES
// ============================================================
function ownNonEmpty(state, player) {
  return Array.from({ length: 7 }, (_, i) => i).filter(
    (i) => state.board[player][i] > 0
  );
}

function wouldMoveCapture(state, player, pitIndex) {
  const sim = cloneState(state);
  const sowing = sow(sim, player, pitIndex);
  if (sowing.specialCapture > 0) return true;
  return canStartCapture(sim, player, sowing.lastPosition);
}

function isForbiddenAttackMove(state, player, pitIndex) {
  const atk = attackPit(player);
  if (atk.player !== player || atk.pitIndex !== pitIndex) return false;
  const seeds = state.board[player][pitIndex];
  if (seeds === 1) return true;
  if (seeds === 2) return !wouldMoveCapture(state, player, pitIndex);
  return false;
}

function countDeliveredToOpponent(state, player, pitIndex) {
  const sim = cloneState(state);
  const before = sum(sim.board[other(player)]);
  sow(sim, player, pitIndex);
  return sum(sim.board[other(player)]) - before;
}

function getSolidarityMoves(state, player) {
  const candidates = ownNonEmpty(state, player);
  const ordinary = candidates.filter((i) => !isForbiddenAttackMove(state, player, i));
  const enriched = ordinary.map((i) => ({
    pitIndex: i,
    delivered: countDeliveredToOpponent(state, player, i),
  }));
  const seven = enriched.filter((m) => m.delivered >= 7);
  if (seven.length) return seven.map((m) => ({ pitIndex: m.pitIndex }));
  const pos = enriched.filter((m) => m.delivered > 0);
  if (pos.length) {
    const max = Math.max(...pos.map((m) => m.delivered));
    return pos.filter((m) => m.delivered === max).map((m) => ({ pitIndex: m.pitIndex }));
  }
  const forced = candidates.filter(
    (i) =>
      samePos({ player, pitIndex: i }, attackPit(player)) &&
      [1, 2].includes(state.board[player][i])
  );
  return forced.map((i) => ({ pitIndex: i, forcedDonation: true }));
}

function getLegalMoves(state) {
  const player = state.currentPlayer;
  if (state.status !== "playing") return [];
  const oppEmpty = sum(state.board[other(player)]) === 0;
  if (oppEmpty) return getSolidarityMoves(state, player);
  return ownNonEmpty(state, player)
    .filter((i) => !isForbiddenAttackMove(state, player, i))
    .map((i) => ({ pitIndex: i }));
}

// ============================================================
// END GAME
// ============================================================
function collectRemaining(state) {
  state.scores.north += sum(state.board.north);
  state.scores.south += sum(state.board.south);
  state.board.north = [0, 0, 0, 0, 0, 0, 0];
  state.board.south = [0, 0, 0, 0, 0, 0, 0];
}

function computeWinner(state) {
  if (state.scores.north >= 40) return "north";
  if (state.scores.south >= 40) return "south";
  if (state.scores.north > state.scores.south) return "north";
  if (state.scores.south > state.scores.north) return "south";
  return "draw";
}

function resolveEndAfterMove(state) {
  if (state.scores.north >= 40 || state.scores.south >= 40) {
    state.status = "ended";
    state.reason = "score_40";
    state.winner = computeWinner(state);
    return;
  }
  if (boardSeeds(state) < 10) {
    collectRemaining(state);
    state.status = "ended";
    state.reason = "low_board";
    state.winner = computeWinner(state);
  }
}

function resolveEndBeforeTurn(state) {
  if (!getLegalMoves(state).length) {
    collectRemaining(state);
    state.status = "ended";
    state.reason = "no_legal_move";
    state.winner = computeWinner(state);
  }
}

// ============================================================
// APPLY MOVE
// ============================================================
function applyMove(state, pitIndex) {
  const s = cloneState(state);
  const player = s.currentPlayer;
  const legalMoves = getLegalMoves(s);
  const legalMove = legalMoves.find((m) => m.pitIndex === pitIndex);
  if (!legalMove) return { state: s, ok: false, error: "Coup illégal" };

  let actionResult;
  if (legalMove.forcedDonation) {
    const seeds = s.board[player][pitIndex];
    s.board[player][pitIndex] = 0;
    s.scores[other(player)] += seeds;
    actionResult = { type: "forced-donation", donated: seeds };
  } else {
    const sowingResult = sow(s, player, pitIndex);
    const capture = resolveCaptures(s, player, sowingResult);
    actionResult = { type: "sow", sowing: sowingResult, capture };
  }

  s.moveNumber += 1;
  s.history.push({ moveNumber: s.moveNumber, player, pitIndex, result: actionResult });
  resolveEndAfterMove(s);
  if (s.status === "playing") {
    s.currentPlayer = other(player);
    resolveEndBeforeTurn(s);
  }

  if (totalSeeds(s) !== 70) {
    throw new Error(`Invariant cassé: ${totalSeeds(s)} graines`);
  }

  return { state: s, ok: true, action: actionResult };
}

function createGame(startingPlayer = "south") {
  return {
    board: {
      north: [5, 5, 5, 5, 5, 5, 5],
      south: [5, 5, 5, 5, 5, 5, 5],
    },
    scores: { north: 0, south: 0 },
    currentPlayer: startingPlayer,
    status: "playing",
    winner: null,
    reason: null,
    moveNumber: 0,
    history: [],
  };
}

// ============================================================
// AI (Minimax with alpha-beta)
// ============================================================
function evaluateState(state, aiPlayer) {
  if (state.status === "ended") {
    if (state.winner === aiPlayer) return 10000;
    if (state.winner === other(aiPlayer)) return -10000;
    return 0;
  }
  const me = state.scores[aiPlayer];
  const opp = state.scores[other(aiPlayer)];
  const mySeeds = sum(state.board[aiPlayer]);
  const oppSeeds = sum(state.board[other(aiPlayer)]);
  return (me - opp) * 3 + (mySeeds - oppSeeds) * 0.5;
}

function minimax(state, depth, alpha, beta, maximizing, aiPlayer) {
  if (depth === 0 || state.status !== "playing") {
    return { score: evaluateState(state, aiPlayer) };
  }
  const moves = getLegalMoves(state);
  if (!moves.length) return { score: evaluateState(state, aiPlayer) };

  let bestMove = null;
  if (maximizing) {
    let maxScore = -Infinity;
    for (const m of moves) {
      const result = applyMove(state, m.pitIndex);
      if (!result.ok) continue;
      const { score } = minimax(result.state, depth - 1, alpha, beta, false, aiPlayer);
      if (score > maxScore) { maxScore = score; bestMove = m; }
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    return { score: maxScore, move: bestMove };
  } else {
    let minScore = Infinity;
    for (const m of moves) {
      const result = applyMove(state, m.pitIndex);
      if (!result.ok) continue;
      const { score } = minimax(result.state, depth - 1, alpha, beta, true, aiPlayer);
      if (score < minScore) { minScore = score; bestMove = m; }
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
    return { score: minScore, move: bestMove };
  }
}

function getBestAIMove(state, aiPlayer) {
  const { move } = minimax(state, 4, -Infinity, Infinity, true, aiPlayer);
  return move;
}

// ============================================================
// COMPONENTS
// ============================================================

// Seed display - shows seeds as dots in a pit
function SeedDots({ count, isGranary }) {
  if (count === 0) return <span className="seed-zero">—</span>;
  if (count > 13) {
    return (
      <span className="seed-count granary-count">
        <span className="granary-icon">🏺</span>
        {count}
      </span>
    );
  }
  return <span className={`seed-count ${isGranary ? "granary-count" : ""}`}>{count}</span>;
}

// Individual pit
function Pit({ player, pitIndex, seeds, isLegal, isAttack, isFirst, isSelected, isActive, onClick, showHuman }) {
  const humanIndex = player === "north" ? pitIndex + 1 : 7 - pitIndex;
  const isGranary = seeds > 13;
  const cls = [
    "pit",
    isLegal ? "pit-legal" : "",
    isSelected ? "pit-selected" : "",
    isAttack ? "pit-attack" : "",
    isFirst ? "pit-first" : "",
    isGranary ? "pit-granary" : "",
    !isActive ? "pit-inactive" : "",
  ].join(" ");

  return (
    <button className={cls} onClick={onClick} disabled={!isLegal} title={`Case ${showHuman ? humanIndex : pitIndex} : ${seeds} graine${seeds !== 1 ? "s" : ""}`}>
      <span className="pit-label">{showHuman ? humanIndex : `${player === "north" ? "N" : "S"}${pitIndex}`}</span>
      <SeedDots count={seeds} isGranary={isGranary} />
    </button>
  );
}

// Board row
function BoardRow({ player, board, legalPitIndices, selectedPit, currentPlayer, onPitClick, showHuman }) {
  const isActive = currentPlayer === player;
  const atkPit = player === "north" ? 6 : 0;
  const firstAdv = player === "north" ? 6 : 0;

  return (
    <div className={`board-row board-row-${player}`}>
      {board.map((seeds, i) => (
        <Pit
          key={i}
          player={player}
          pitIndex={i}
          seeds={seeds}
          isLegal={isActive && legalPitIndices.includes(i)}
          isAttack={i === atkPit}
          isFirst={i === firstAdv && !isActive}
          isSelected={selectedPit !== null && selectedPit.player === player && selectedPit.pitIndex === i}
          isActive={isActive}
          onClick={() => onPitClick(player, i)}
          showHuman={showHuman}
        />
      ))}
    </div>
  );
}

// Score bar
function ScoreBar({ north, south, winner }) {
  const total = 70;
  const northPct = Math.round((north / total) * 100);
  const southPct = Math.round((south / total) * 100);
  return (
    <div className="score-bar">
      <div className="score-bar-inner">
        <div className="score-fill north-fill" style={{ width: `${northPct}%` }} />
        <div className="score-fill south-fill" style={{ width: `${southPct}%` }} />
      </div>
      <div className="score-labels">
        <span className={`score-label ${winner === "north" ? "score-winner" : ""}`}>Nord : {north}</span>
        <span className="score-target">/ 40</span>
        <span className={`score-label ${winner === "south" ? "score-winner" : ""}`}>Sud : {south}</span>
      </div>
    </div>
  );
}

// Move log entry
function MoveLogEntry({ entry }) {
  const { player, pitIndex, result } = entry;
  const label = player === "north" ? `N${pitIndex}` : `S${pitIndex}`;
  let detail = "";
  if (result.type === "forced-donation") {
    detail = `Don forcé (${result.donated} gr.)`;
  } else if (result.type === "sow") {
    const c = result.capture;
    if (c.captured > 0) {
      detail = c.type === "chain" ? `Chaîne : +${c.captured}` : `Prise : +${c.captured}`;
    } else if (c.cancelledByStarvation) {
      detail = "Prise annulée (affamement)";
    } else {
      detail = "Semaille";
    }
  } else if (result.type === "special-granary") {
    detail = "Grenier spécial +1";
  }
  return (
    <div className={`log-entry log-${player}`}>
      <span className="log-turn">#{entry.moveNumber}</span>
      <span className="log-player">{player === "north" ? "N" : "S"}</span>
      <span className="log-case">{label}</span>
      <span className="log-detail">{detail}</span>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function SonghoGame() {
  const [gameState, setGameState] = useState(null);
  const [mode, setMode] = useState(null); // "local" | "vs-ai"
  const [aiPlayer, setAiPlayer] = useState("north");
  const aiPlayerRef = useRef("north");
  const [nextStarter, setNextStarter] = useState("south"); // alterne à chaque partie
  const [legalMoves, setLegalMoves] = useState([]);
  const [selectedPit, setSelectedPit] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const [notification, setNotification] = useState(null);
  const [showHuman, setShowHuman] = useState(true);
  const [aiThinking, setAiThinking] = useState(false);
  const aiLock = useRef(false);
  const logRef = useRef(null);

  const notify = useCallback((msg, type = "info", duration = 3000) => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), duration);
  }, []);

  useEffect(() => {
    if (gameState) {
      const moves = getLegalMoves(gameState);
      setLegalMoves(moves.map((m) => m.pitIndex));
      if (gameState.status === "ended") {
        const winMsg =
          gameState.winner === "draw"
            ? "Match nul !"
            : `${gameState.winner === "north" ? "Nord" : "Sud"} remporte la partie !`;
        const reason = {
          score_40: "(40 graines capturées)",
          low_board: "(moins de 10 graines sur le tablier)",
          no_legal_move: "(aucun coup légal)",
          solidarity_impossible: "(solidarité impossible)",
        }[gameState.reason] || "";
        notify(`🏆 ${winMsg} ${reason}`, "win", 0);
      }
    }
  }, [gameState, notify]);

  // AI turn - use ref lock to avoid useEffect re-trigger loop
  useEffect(() => {
    const currentAiPlayer = aiPlayerRef.current;
    if (
      mode !== "vs-ai" ||
      !gameState ||
      gameState.status !== "playing" ||
      gameState.currentPlayer !== currentAiPlayer ||
      aiLock.current
    ) return;

    aiLock.current = true;
    setAiThinking(true);

    const timer = setTimeout(() => {
      const bestMove = getBestAIMove(gameState, currentAiPlayer);
      if (bestMove) {
        const result = applyMove(gameState, bestMove.pitIndex);
        if (result.ok) {
          setGameState(result.state);
          setLastAction(result.action);
        }
      }
      setAiThinking(false);
      aiLock.current = false;
    }, 750);

    return () => {
      clearTimeout(timer);
      aiLock.current = false;
      setAiThinking(false);
    };
  }, [gameState, mode]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [gameState?.history?.length]);

  const startGame = (gameMode) => {
    // nextStarter alterne automatiquement à chaque nouvelle partie
    const starter = nextStarter;
    // En mode vs-IA : l'IA joue le camp opposé au joueur humain (qui commence)
    if (gameMode === "vs-ai") {
      const aiSide = other(starter);
      aiPlayerRef.current = aiSide;
      setAiPlayer(aiSide);
    }
    const newState = createGame(starter);
    setNextStarter(other(starter));
    setGameState(newState);
    setMode(gameMode);
    setLastAction(null);
    setSelectedPit(null);
    setNotification(null);
    setAiThinking(false);
    aiLock.current = false;
  };

  const handlePitClick = (player, pitIndex) => {
    if (!gameState || gameState.status !== "playing") return;
    if (player !== gameState.currentPlayer) return;
    if (mode === "vs-ai" && player === aiPlayer) return;
    if (aiThinking) return;
    if (!legalMoves.includes(pitIndex)) {
      notify("Ce coup n'est pas légal.", "error");
      return;
    }
    const result = applyMove(gameState, pitIndex);
    if (result.ok) {
      setGameState(result.state);
      setLastAction(result.action);
      setSelectedPit(null);
      if (result.action?.capture?.cancelledByStarvation) {
        notify("⚠️ Prise annulée — affamer l'adversaire est interdit.", "warn");
      }
    } else {
      notify(result.error, "error");
    }
  };

  // ============================================================
  // MENU SCREEN
  // ============================================================
  if (!gameState) {
    return (
      <div className="app menu-screen">
        <style>{CSS}</style>
        <div className="menu-container">
          <div className="menu-logo">
            <div className="logo-symbol">⬡</div>
            <h1 className="logo-title">SONGHO</h1>
            <p className="logo-sub">Jeu de Mancala · Variante Ewondo-Bulu · Cameroun</p>
          </div>

          <div className="menu-card">
            <h2 className="menu-card-title">Nouvelle Partie</h2>
            <div className="starter-info">
              ▶ Commence : <strong>{nextStarter === "south" ? "Sud" : "Nord"}</strong>
            </div>
            <div className="menu-options">
              <button className="menu-btn btn-local" onClick={() => startGame("local")}>
                <span className="btn-icon">👥</span>
                <span className="btn-label">2 Joueurs</span>
                <span className="btn-desc">Sur le même écran</span>
              </button>
              <button
                className="menu-btn btn-ai"
                onClick={() => startGame("vs-ai")}
              >
                <span className="btn-icon">🤖</span>
                <span className="btn-label">Vs IA</span>
                <span className="btn-desc">Vous êtes {nextStarter === "south" ? "Sud" : "Nord"}</span>
              </button>
            </div>
          </div>

          <div className="menu-rules">
            <h3>Comment jouer</h3>
            <ul>
              <li>Chaque joueur possède <strong>7 cases</strong> contenant <strong>5 graines</strong> chacune.</li>
              <li>À votre tour, choisissez une case non vide et semez ses graines une par une.</li>
              <li>Capturez si la dernière graine tombe chez l'adversaire avec <strong>2, 3 ou 4</strong> graines.</li>
              <li>Le premier à capturer <strong>40 graines</strong> remporte la partie.</li>
              <li>⚑ La case d'attaque et la première case adverse ont des règles spéciales.</li>
              <li>🏺 Un grenier (&#62;13 graines) suit un algorithme de semaille spécial.</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // GAME SCREEN
  // ============================================================
  const human = mode === "vs-ai" ? other(aiPlayer) : null;
  const currentName = gameState.currentPlayer === "north" ? "Nord" : "Sud";
  const northLegal = gameState.currentPlayer === "north" ? legalMoves : [];
  const southLegal = gameState.currentPlayer === "south" ? legalMoves : [];

  return (
    <div className="app game-screen">
      <style>{CSS}</style>

      {/* Notification */}
      {notification && (
        <div className={`notification notif-${notification.type}`}>
          {notification.msg}
          {notification.type === "win" && (
            <button className="notif-close" onClick={() => setNotification(null)}>✕</button>
          )}
        </div>
      )}

      {/* Header */}
      <header className="game-header">
        <button className="btn-back" onClick={() => { setGameState(null); setMode(null); }}>
          ← Menu
        </button>
        <h1 className="game-title">SONGHO</h1>
        <div className="header-right">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showHuman}
              onChange={(e) => setShowHuman(e.target.checked)}
            />
            Num. humains
          </label>
          <span className="move-counter">Tour #{gameState.moveNumber + 1}</span>
        </div>
      </header>

      <main className="game-main">
        {/* Score */}
        <ScoreBar
          north={gameState.scores.north}
          south={gameState.scores.south}
          winner={gameState.winner}
        />

        {/* Turn indicator */}
        <div className={`turn-indicator turn-${gameState.currentPlayer}`}>
          {gameState.status === "playing" ? (
            <>
              {aiThinking && mode === "vs-ai" && gameState.currentPlayer === aiPlayer
                ? <span>🤖 L'IA réfléchit…</span>
                : <span>▶ Tour de <strong>{currentName}</strong>{mode === "vs-ai" && gameState.currentPlayer === aiPlayer ? " (IA)" : ""}</span>
              }
            </>
          ) : (
            <span>
              {gameState.winner === "draw"
                ? "🤝 Match nul"
                : `🏆 ${gameState.winner === "north" ? "Nord" : "Sud"} gagne !`}
            </span>
          )}
        </div>

        {/* Board */}
        <div className="board-container">
          {/* Nord label */}
          <div className="player-label player-label-north">
            <span className="player-badge north-badge">N</span>
            <span>{mode === "vs-ai" && aiPlayer === "north" ? "IA" : "Nord"}</span>
            {gameState.currentPlayer === "north" && gameState.status === "playing" && <span className="active-dot" />}
          </div>

          <div className="board">
            {/* North row - displayed in reverse for visual correctness */}
            <div className="board-row-wrap north-wrap">
              {[...gameState.board.north].reverse().map((seeds, revIdx) => {
                const i = 6 - revIdx;
                return (
                  <Pit
                    key={i}
                    player="north"
                    pitIndex={i}
                    seeds={seeds}
                    isLegal={northLegal.includes(i)}
                    isAttack={i === 6}
                    isFirst={i === 6}
                    isSelected={selectedPit?.player === "north" && selectedPit?.pitIndex === i}
                    isActive={gameState.currentPlayer === "north"}
                    onClick={() => handlePitClick("north", i)}
                    showHuman={showHuman}
                  />
                );
              })}
            </div>

            {/* Board divider */}
            <div className="board-divider">
              <div className="board-gutter north-gutter">
                <span className="gutter-label">NORD</span>
              </div>
              <div className="board-spine" />
              <div className="board-gutter south-gutter">
                <span className="gutter-label">SUD</span>
              </div>
            </div>

            {/* South row */}
            <div className="board-row-wrap south-wrap">
              {gameState.board.south.map((seeds, i) => (
                <Pit
                  key={i}
                  player="south"
                  pitIndex={i}
                  seeds={seeds}
                  isLegal={southLegal.includes(i)}
                  isAttack={i === 0}
                  isFirst={i === 0}
                  isSelected={selectedPit?.player === "south" && selectedPit?.pitIndex === i}
                  isActive={gameState.currentPlayer === "south"}
                  onClick={() => handlePitClick("south", i)}
                  showHuman={showHuman}
                />
              ))}
            </div>
          </div>

          {/* Sud label */}
          <div className="player-label player-label-south">
            <span className="player-badge south-badge">S</span>
            <span>{mode === "vs-ai" && aiPlayer === "south" ? "IA" : "Sud"}</span>
            {gameState.currentPlayer === "south" && gameState.status === "playing" && <span className="active-dot" />}
          </div>
        </div>

        {/* Last action info */}
        {lastAction && (
          <div className="last-action">
            {lastAction.type === "sow" && lastAction.capture?.captured > 0 && (
              <span className="action-capture">
                ✦ {lastAction.capture.type === "chain" ? "Prise à la chaîne" : "Prise"} : +{lastAction.capture.captured} graine{lastAction.capture.captured > 1 ? "s" : ""}
              </span>
            )}
            {lastAction.type === "forced-donation" && (
              <span className="action-donation">↗ Don forcé : {lastAction.donated} graine{lastAction.donated > 1 ? "s" : ""} à l'adversaire</span>
            )}
            {lastAction.type === "special-granary" && (
              <span className="action-granary">🏺 Grenier : 1 graine capturée</span>
            )}
            {lastAction.type === "sow" && lastAction.capture?.cancelledByStarvation && (
              <span className="action-cancelled">⊘ Prise annulée (affamement interdit)</span>
            )}
          </div>
        )}

        {/* Move log + new game */}
        <div className="bottom-panel">
          <div className="move-log" ref={logRef}>
            <div className="log-header">Historique</div>
            {gameState.history.length === 0 && (
              <div className="log-empty">Aucun coup joué</div>
            )}
            {gameState.history.map((entry) => (
              <MoveLogEntry key={entry.moveNumber} entry={entry} />
            ))}
          </div>

          <div className="side-controls">
            <button className="btn-newgame" onClick={() => startGame(mode)}>
              Nouvelle partie<br/>
              <span style={{fontSize:"0.7rem", fontWeight:400, opacity:0.8}}>
                ▶ {nextStarter === "south" ? "Sud" : "Nord"} commence
              </span>
            </button>
            <button className="btn-menu2" onClick={() => { setGameState(null); setMode(null); }}>
              Menu principal
            </button>

            <div className="legend">
              <div className="legend-title">Légende</div>
              <div className="legend-item"><span className="leg-dot leg-legal" />Case jouable</div>
              <div className="legend-item"><span className="leg-dot leg-attack" />Case d'attaque</div>
              <div className="legend-item"><span className="leg-dot leg-granary" />Grenier (&#62;13)</div>
            </div>

            <div className="invariant-check">
              <span className="inv-label">Total graines</span>
              <span className="inv-value">{totalSeeds(gameState)} / 70</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ============================================================
// CSS — Palette: ébène #1A120B, or #C9A84C, terracotta #C4622D,
//       crème #F5ECD7, vert mousse #4A7C59
// ============================================================
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Lato:wght@300;400;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ebene:      #1A120B;
    --or:         #C9A84C;
    --or-light:   #E8C96A;
    --terracotta: #C4622D;
    --creme:      #F5ECD7;
    --creme-dark: #E8D5B0;
    --mousse:     #4A7C59;
    --mousse-light: #6EA87A;
    --nord:       #3B6E8F;
    --nord-light: #6AAEC9;
    --sud:        #8B3B6E;
    --sud-light:  #C96AAE;
    --shadow:     rgba(26,18,11,0.45);
  }

  .app {
    min-height: 100vh;
    background: var(--ebene);
    font-family: 'Lato', sans-serif;
    color: var(--creme);
  }

  /* ---- MENU ---- */
  .menu-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at 30% 20%, #2D1F0E 0%, var(--ebene) 70%);
  }

  .menu-container {
    width: 100%;
    max-width: 640px;
    padding: 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .menu-logo {
    text-align: center;
  }

  .logo-symbol {
    font-size: 4rem;
    color: var(--or);
    line-height: 1;
    filter: drop-shadow(0 0 12px rgba(201,168,76,0.6));
  }

  .logo-title {
    font-family: 'Cinzel', serif;
    font-size: 3.5rem;
    font-weight: 900;
    letter-spacing: 0.25em;
    color: var(--or);
    text-shadow: 0 0 30px rgba(201,168,76,0.4);
    line-height: 1;
    margin-top: 0.25rem;
  }

  .logo-sub {
    color: var(--creme-dark);
    opacity: 0.7;
    font-size: 0.85rem;
    margin-top: 0.5rem;
    letter-spacing: 0.08em;
  }

  .menu-card {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(201,168,76,0.2);
    border-radius: 1rem;
    padding: 1.5rem;
  }

  .menu-card-title {
    font-family: 'Cinzel', serif;
    font-size: 1rem;
    color: var(--or);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin-bottom: 1rem;
    text-align: center;
  }

  .starter-info {
    text-align: center;
    font-size: 0.85rem;
    color: var(--creme-dark);
    margin-bottom: 0.75rem;
    padding: 0.3rem 0.75rem;
    background: rgba(201,168,76,0.08);
    border-radius: 0.4rem;
    border: 1px solid rgba(201,168,76,0.15);
  }

  .starter-info strong { color: var(--or); font-weight: 700; }

  .menu-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .menu-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 1.25rem 1rem;
    border: none;
    border-radius: 0.75rem;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
    font-family: 'Lato', sans-serif;
  }

  .menu-btn:hover { transform: translateY(-2px); }

  .btn-local {
    background: linear-gradient(135deg, var(--mousse), #2E5038);
    color: var(--creme);
    box-shadow: 0 4px 20px rgba(74,124,89,0.4);
  }

  .btn-ai {
    background: linear-gradient(135deg, var(--terracotta), #8B3318);
    color: var(--creme);
    box-shadow: 0 4px 20px rgba(196,98,45,0.4);
  }

  .btn-icon { font-size: 2rem; }
  .btn-label { font-weight: 700; font-size: 1rem; }
  .btn-desc { font-size: 0.75rem; opacity: 0.8; }

  .menu-rules {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 0.75rem;
    padding: 1.25rem;
  }

  .menu-rules h3 {
    font-family: 'Cinzel', serif;
    color: var(--or);
    font-size: 0.9rem;
    letter-spacing: 0.1em;
    margin-bottom: 0.75rem;
  }

  .menu-rules ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .menu-rules li {
    font-size: 0.85rem;
    color: var(--creme-dark);
    padding-left: 1rem;
    position: relative;
    line-height: 1.4;
  }

  .menu-rules li::before {
    content: "▸";
    position: absolute;
    left: 0;
    color: var(--or);
  }

  /* ---- GAME SCREEN ---- */
  .game-screen {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: radial-gradient(ellipse at 50% 0%, #2A1A0E 0%, var(--ebene) 60%);
  }

  .game-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    background: rgba(0,0,0,0.4);
    border-bottom: 1px solid rgba(201,168,76,0.15);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .game-title {
    font-family: 'Cinzel', serif;
    font-size: 1.4rem;
    font-weight: 900;
    letter-spacing: 0.25em;
    color: var(--or);
  }

  .btn-back, .btn-newgame, .btn-menu2 {
    border: none;
    cursor: pointer;
    border-radius: 0.4rem;
    font-family: 'Lato', sans-serif;
    font-weight: 700;
    transition: opacity 0.15s, transform 0.1s;
  }

  .btn-back {
    background: rgba(255,255,255,0.08);
    color: var(--creme);
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
  }

  .btn-back:hover { opacity: 0.8; }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .toggle-label {
    font-size: 0.75rem;
    color: var(--creme-dark);
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
  }

  .toggle-label input { accent-color: var(--or); }

  .move-counter {
    font-size: 0.75rem;
    color: var(--or);
    opacity: 0.8;
  }

  /* ---- MAIN ---- */
  .game-main {
    flex: 1;
    padding: 1rem;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* ---- SCORE BAR ---- */
  .score-bar {
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 0.6rem;
    padding: 0.6rem 1rem;
  }

  .score-bar-inner {
    height: 8px;
    border-radius: 4px;
    background: rgba(255,255,255,0.08);
    display: flex;
    overflow: hidden;
    margin-bottom: 0.4rem;
  }

  .score-fill {
    height: 100%;
    transition: width 0.5s ease;
  }

  .north-fill { background: linear-gradient(90deg, var(--nord), var(--nord-light)); }
  .south-fill { background: linear-gradient(90deg, var(--sud), var(--sud-light)); }

  .score-labels {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
  }

  .score-label { font-weight: 700; }
  .score-winner { color: var(--or); }
  .score-target { color: rgba(255,255,255,0.3); font-size: 0.75rem; }

  /* ---- TURN INDICATOR ---- */
  .turn-indicator {
    text-align: center;
    padding: 0.5rem;
    border-radius: 0.5rem;
    font-size: 0.9rem;
    font-weight: 400;
    letter-spacing: 0.03em;
    border: 1px solid transparent;
  }

  .turn-north {
    background: rgba(59,110,143,0.15);
    border-color: rgba(59,110,143,0.3);
    color: var(--nord-light);
  }

  .turn-south {
    background: rgba(139,59,110,0.15);
    border-color: rgba(139,59,110,0.3);
    color: var(--sud-light);
  }

  .turn-indicator strong { font-weight: 700; }

  /* ---- BOARD ---- */
  .board-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .player-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--creme-dark);
    padding: 0 0.25rem;
  }

  .player-label-north { justify-content: flex-end; }
  .player-label-south { justify-content: flex-start; }

  .player-badge {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 900;
  }

  .north-badge { background: var(--nord); color: white; }
  .south-badge { background: var(--sud); color: white; }

  .active-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--or);
    animation: pulse 1.2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }

  .board {
    background: linear-gradient(180deg, #2D1E0F 0%, #1A120B 100%);
    border: 2px solid rgba(201,168,76,0.25);
    border-radius: 1rem;
    padding: 0.5rem;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(201,168,76,0.1);
    overflow: hidden;
  }

  .board-row-wrap {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.4rem;
    padding: 0.4rem;
  }

  .board-divider {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 0.4rem;
  }

  .board-gutter {
    flex: 1;
    padding: 0.2rem 0.5rem;
    font-family: 'Cinzel', serif;
    font-size: 0.6rem;
    letter-spacing: 0.2em;
    opacity: 0.4;
  }

  .north-gutter { text-align: right; }
  .south-gutter { text-align: left; }

  .board-spine {
    height: 1px;
    width: 100%;
    flex: 2;
    background: linear-gradient(90deg, transparent, rgba(201,168,76,0.3), transparent);
  }

  /* ---- PIT ---- */
  .pit {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.08);
    background: radial-gradient(ellipse at 30% 30%, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.2) 100%);
    cursor: default;
    transition: transform 0.1s, box-shadow 0.15s, border-color 0.15s;
    padding: 0.2rem;
    min-width: 0;
  }

  .pit-label {
    font-size: 0.5rem;
    opacity: 0.4;
    line-height: 1;
    color: var(--creme);
  }

  .seed-count {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--creme);
    line-height: 1;
  }

  .seed-zero {
    font-size: 0.7rem;
    opacity: 0.2;
    color: var(--creme);
  }

  .granary-count {
    color: var(--or);
    font-size: 0.9rem;
  }

  .granary-icon {
    font-size: 0.65rem;
    display: block;
    line-height: 1;
  }

  .pit-legal {
    cursor: pointer;
    border-color: rgba(201,168,76,0.5);
    background: radial-gradient(ellipse at 30% 30%, rgba(201,168,76,0.12) 0%, rgba(0,0,0,0.1) 100%);
    box-shadow: 0 0 10px rgba(201,168,76,0.2);
  }

  .pit-legal:hover {
    transform: scale(1.08);
    border-color: var(--or);
    box-shadow: 0 0 20px rgba(201,168,76,0.5);
  }

  .pit-legal:active { transform: scale(0.97); }

  .pit-attack {
    border-style: dashed;
    border-color: rgba(196,98,45,0.4);
  }

  .pit-attack.pit-legal {
    border-color: rgba(196,98,45,0.7);
    box-shadow: 0 0 10px rgba(196,98,45,0.3);
  }

  .pit-granary {
    border-color: rgba(201,168,76,0.4);
    background: radial-gradient(ellipse at 30% 30%, rgba(201,168,76,0.08) 0%, rgba(0,0,0,0.2) 100%);
  }

  .pit-inactive { opacity: 0.65; }

  /* ---- LAST ACTION ---- */
  .last-action {
    text-align: center;
    font-size: 0.85rem;
    min-height: 1.5rem;
  }

  .action-capture { color: var(--or); font-weight: 700; }
  .action-donation { color: var(--mousse-light); }
  .action-granary { color: var(--or); }
  .action-cancelled { color: var(--terracotta); }

  /* ---- NOTIFICATION ---- */
  .notification {
    position: fixed;
    top: 70px;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.75rem 1.25rem;
    border-radius: 0.5rem;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-weight: 700;
    max-width: 90vw;
    text-align: center;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    animation: slideDown 0.25s ease;
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  .notif-info { background: rgba(59,110,143,0.9); color: white; }
  .notif-error { background: rgba(196,98,45,0.9); color: white; }
  .notif-warn { background: rgba(180,140,0,0.9); color: white; }
  .notif-win { background: linear-gradient(135deg, #2A1800, #3D2200); border: 2px solid var(--or); color: var(--or); font-family: 'Cinzel', serif; font-size: 1rem; letter-spacing: 0.05em; }

  .notif-close {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 1rem;
    opacity: 0.7;
    padding: 0 0.25rem;
  }

  /* ---- BOTTOM PANEL ---- */
  .bottom-panel {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.75rem;
    align-items: start;
  }

  .move-log {
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 0.6rem;
    max-height: 180px;
    overflow-y: auto;
    font-size: 0.78rem;
  }

  .log-header {
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    font-family: 'Cinzel', serif;
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    color: var(--or);
    opacity: 0.8;
    position: sticky;
    top: 0;
    background: rgba(26,18,11,0.9);
  }

  .log-empty { padding: 0.5rem 0.6rem; color: rgba(255,255,255,0.3); font-size: 0.75rem; }

  .log-entry {
    display: grid;
    grid-template-columns: 2rem 1rem 2.5rem 1fr;
    gap: 0.25rem;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    align-items: center;
  }

  .log-north { border-left: 2px solid var(--nord); }
  .log-south { border-left: 2px solid var(--sud); }

  .log-turn { color: rgba(255,255,255,0.3); font-size: 0.7rem; }
  .log-player { font-weight: 700; font-size: 0.7rem; }
  .log-north .log-player { color: var(--nord-light); }
  .log-south .log-player { color: var(--sud-light); }
  .log-case { font-family: 'Cinzel', serif; font-size: 0.75rem; color: var(--creme-dark); }
  .log-detail { color: var(--creme-dark); opacity: 0.75; }

  /* ---- SIDE CONTROLS ---- */
  .side-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 130px;
  }

  .btn-newgame {
    background: linear-gradient(135deg, var(--mousse), #2E5038);
    color: var(--creme);
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    box-shadow: 0 2px 10px rgba(74,124,89,0.4);
  }

  .btn-newgame:hover { opacity: 0.9; transform: translateY(-1px); }

  .btn-menu2 {
    background: rgba(255,255,255,0.07);
    color: var(--creme-dark);
    padding: 0.4rem 0.75rem;
    font-size: 0.75rem;
    border: 1px solid rgba(255,255,255,0.1);
  }

  .btn-menu2:hover { background: rgba(255,255,255,0.1); }

  .legend {
    background: rgba(0,0,0,0.2);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 0.5rem;
    padding: 0.5rem;
    font-size: 0.72rem;
  }

  .legend-title {
    font-family: 'Cinzel', serif;
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    color: var(--or);
    margin-bottom: 0.3rem;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--creme-dark);
    margin-bottom: 0.2rem;
  }

  .leg-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .leg-legal { background: rgba(201,168,76,0.6); border: 1px solid var(--or); }
  .leg-attack { background: transparent; border: 2px dashed var(--terracotta); }
  .leg-granary { background: rgba(201,168,76,0.2); border: 1px solid var(--or); }

  .invariant-check {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    color: rgba(255,255,255,0.3);
    padding: 0.3rem 0.1rem;
  }

  .inv-value { color: var(--mousse-light); }

  /* ---- RESPONSIVE ---- */
  @media (max-width: 600px) {
    .logo-title { font-size: 2.5rem; }
    .menu-options { grid-template-columns: 1fr 1fr; }
    .board-row-wrap { gap: 0.25rem; padding: 0.25rem; }
    .pit { border-width: 1.5px; }
    .seed-count { font-size: 0.95rem; }
    .pit-label { display: none; }
    .bottom-panel { grid-template-columns: 1fr; }
    .side-controls { flex-direction: row; flex-wrap: wrap; }
    .legend { display: none; }
    .move-log { max-height: 120px; }
  }

  @media (max-width: 400px) {
    .seed-count { font-size: 0.8rem; }
    .board { padding: 0.3rem; }
  }
`;
