/**
 * EarnHub Backend API — Node.js + Express
 *
 * Stack: Node.js, Express, bcrypt, JWT, UUID
 * Database: in-memory (swap with MongoDB/PostgreSQL in production)
 *
 * Install: npm install express bcryptjs jsonwebtoken uuid cors helmet morgan
 * Run:     node server.js
 */

const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const cors     = require("cors");
const helmet   = require("helmet");
const morgan   = require("morgan");

const app = express();

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT       || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "earnhub_dev_secret_change_in_prod";
const JWT_EXPIRY = "7d";

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));           // lock to your domain in production
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

// ─── In-Memory "Database" ────────────────────────────────────────────────────
// Replace these Maps with real DB calls in production.
const DB = {
  users:        new Map(),   // userId  → user object
  sessions:     new Map(),   // userId  → { lastSeen, adsToday, adDate }
  withdrawals:  new Map(),   // wdId    → withdrawal object
  tasks:        new Map(),   // taskId  → task object
  taskProgress: new Map(),   // `${userId}:${taskId}` → boolean
  gameHistory:  new Map(),   // userId  → [ ...game records ]
  referrals:    new Map(),   // referrerId → [ userId ]
};

// Seed a few tasks
const SEEDED_TASKS = [
  { id:"t1", name:"Join EarnHub Channel",   platform:"TELEGRAM", reward:15, link:"https://t.me/earnhubchannel" },
  { id:"t2", name:"Join EarnHub Community", platform:"TELEGRAM", reward:15, link:"https://t.me/earnhubchat" },
  { id:"t3", name:"Start Partner Bot",       platform:"BOT",      reward:10, link:"https://t.me/earnhubpartnerbot" },
  { id:"t4", name:"Subscribe YouTube",       platform:"YOUTUBE",  reward:12, link:"https://youtube.com/c/earnhub" },
  { id:"t5", name:"Join Discord Server",     platform:"DISCORD",  reward:10, link:"https://discord.gg/earnhub" },
];
SEEDED_TASKS.forEach(t => DB.tasks.set(t.id, t));

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sign   = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
const ms     = (days)    => days * 86400000;
const today  = ()        => new Date().toISOString().slice(0, 10);

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });
  const token = header.split(" ")[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function getUser(id) {
  return DB.users.get(id) || null;
}

function saveUser(user) {
  DB.users.set(user.id, user);
  return user;
}

function newUser({ username, handle, passwordHash, referrerId }) {
  const id   = uuid();
  const user = {
    id,
    username,
    handle:              handle || `@${username.toLowerCase()}`,
    passwordHash,
    balance:             0,
    nova:                referrerId ? 70 : 0,   // 70 NOVA sign-up bonus for referral
    adsWatched:          0,
    adsWatchedToday:     0,
    adDate:              "",
    streak:              0,
    lastClaim:           null,
    tasksCompleted:      0,
    friendsInvited:      0,
    earnedFromInvites:   0,
    referrerId:          referrerId || null,
    createdAt:           Date.now(),
  };
  saveUser(user);

  // Credit referrer
  if (referrerId) {
    const referrer = getUser(referrerId);
    if (referrer) {
      referrer.nova            += 70;
      referrer.balance         += 0.50;
      referrer.friendsInvited  += 1;
      referrer.earnedFromInvites += 0.50;
      saveUser(referrer);
      const list = DB.referrals.get(referrerId) || [];
      list.push(id);
      DB.referrals.set(referrerId, list);
    }
  }

  return user;
}

function sanitize(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────

// POST /auth/register
app.post("/auth/register", async (req, res) => {
  const { username, handle, password, referrerId } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username and password required" });

  // Check duplicate username
  for (const u of DB.users.values()) {
    if (u.username.toLowerCase() === username.toLowerCase()) {
      return res.status(409).json({ error: "Username already taken" });
    }
  }

  if (referrerId && !DB.users.has(referrerId)) {
    return res.status(400).json({ error: "Invalid referral ID" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user  = newUser({ username, handle, passwordHash, referrerId });
  const token = sign({ id: user.id });

  res.status(201).json({ token, user: sanitize(user) });
});

// POST /auth/login
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username and password required" });

  let found = null;
  for (const u of DB.users.values()) {
    if (u.username.toLowerCase() === username.toLowerCase()) { found = u; break; }
  }
  if (!found) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, found.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = sign({ id: found.id });
  res.json({ token, user: sanitize(found) });
});

// ─── User Routes ─────────────────────────────────────────────────────────────

// GET /me  — get own profile
app.get("/me", auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(sanitize(user));
});

// ─── Daily Claim ─────────────────────────────────────────────────────────────
const DAILY_BONUS = [25, 35, 50, 60, 75, 100, 150];

// POST /claim/daily
app.post("/claim/daily", auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const now  = Date.now();
  const last = user.lastClaim || 0;
  const diff = now - last;

  if (diff < ms(1)) {
    const next = ms(1) - diff;
    return res.status(429).json({ error: "Already claimed", nextClaimInMs: next });
  }

  const dayIdx = user.streak % 7;
  const bonus  = DAILY_BONUS[dayIdx];

  user.nova     += bonus;
  user.streak   += 1;
  user.lastClaim = now;
  saveUser(user);

  res.json({ bonus, nova: user.nova, streak: user.streak, user: sanitize(user) });
});

// ─── Ads ─────────────────────────────────────────────────────────────────────
const AD_REWARD  = 0.20;
const MAX_ADS    = 10;

// POST /earn/ad-complete
app.post("/earn/ad-complete", auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  // Reset daily counter
  if (user.adDate !== today()) {
    user.adsWatchedToday = 0;
    user.adDate = today();
  }

  if (user.adsWatchedToday >= MAX_ADS) {
    return res.status(429).json({ error: "Daily ad limit reached", limit: MAX_ADS });
  }

  user.adsWatchedToday += 1;
  user.adsWatched      += 1;
  user.balance          = +(user.balance + AD_REWARD).toFixed(2);
  saveUser(user);

  // 10% to referrer
  if (user.referrerId) {
    const referrer = getUser(user.referrerId);
    if (referrer) {
      referrer.earnedFromInvites = +(referrer.earnedFromInvites + AD_REWARD * 0.1).toFixed(4);
      referrer.balance           = +(referrer.balance + AD_REWARD * 0.1).toFixed(2);
      saveUser(referrer);
    }
  }

  res.json({ reward: AD_REWARD, balance: user.balance, adsWatchedToday: user.adsWatchedToday, user: sanitize(user) });
});

// ─── Tasks ───────────────────────────────────────────────────────────────────

// GET /tasks  — list all tasks + completion status for user
app.get("/tasks", auth, (req, res) => {
  const tasks = Array.from(DB.tasks.values()).map(t => ({
    ...t,
    done: DB.taskProgress.has(`${req.user.id}:${t.id}`),
  }));
  res.json(tasks);
});

// POST /tasks/:id/complete
app.post("/tasks/:id/complete", auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const task = DB.tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const key = `${user.id}:${task.id}`;
  if (DB.taskProgress.has(key)) return res.status(409).json({ error: "Task already completed" });

  DB.taskProgress.set(key, true);
  user.nova           += task.reward;
  user.tasksCompleted += 1;
  saveUser(user);

  // 10% to referrer
  if (user.referrerId) {
    const referrer = getUser(user.referrerId);
    if (referrer) {
      const share = Math.floor(task.reward * 0.1);
      referrer.nova += share;
      saveUser(referrer);
    }
  }

  res.json({ reward: task.reward, nova: user.nova, tasksCompleted: user.tasksCompleted, user: sanitize(user) });
});

// ─── Games ───────────────────────────────────────────────────────────────────
// All games are server-authoritative. Frontend sends the user's action,
// backend does the RNG and returns the result.

function recordGame(userId, game, bet, result, payout) {
  const history = DB.gameHistory.get(userId) || [];
  history.unshift({ game, bet, result, payout, time: Date.now() });
  if (history.length > 50) history.pop();
  DB.gameHistory.set(userId, history);
}

// GET /games/history
app.get("/games/history", auth, (req, res) => {
  res.json(DB.gameHistory.get(req.user.id) || []);
});

// POST /games/spin — Spin Wheel
const SEGS = [
  { l:"+5",  v:5   }, { l:"LOSE", v:-15 }, { l:"+25", v:25  }, { l:"+10", v:10  },
  { l:"LOSE",v:-15 }, { l:"+50", v:50  }, { l:"+15", v:15  }, { l:"+3",  v:3   },
];
const SPIN_FEE = 15;

app.post("/games/spin", auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.nova < SPIN_FEE) return res.status(400).json({ error: "Insufficient NOVA" });

  user.nova -= SPIN_FEE;
  const idx  = Math.floor(Math.random() * SEGS.length);
  const seg  = SEGS[idx];
  user.nova  = Math.max(0, user.nova + seg.v);
  saveUser(user);
  recordGame(user.id, "spin", SPIN_FEE, seg.l, seg.v);

  res.json({ segmentIndex: idx, segment: seg, nova: user.nova, user: sanitize(user) });
});

// POST /games/number-zone — Number Zone
const NZ_FEE   = 20;
const NZ_RANGES = [
  { min:1,  max:33,  mult:3   },
  { min:34, max:66,  mult:2   },
  { min:67, max:100, mult:1.5 },
];

app.post("/games/number-zone", auth, (req, res) => {
  const { rangeIndex } = req.body;
  if (rangeIndex === undefined || rangeIndex < 0 || rangeIndex > 2) {
    return res.status(400).json({ error: "Invalid rangeIndex (0, 1, or 2)" });
  }

  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.nova < NZ_FEE) return res.status(400).json({ error: "Insufficient NOVA" });

  user.nova -= NZ_FEE;
  const roll  = Math.floor(Math.random() * 100) + 1;
  const range = NZ_RANGES[rangeIndex];
  const won   = roll >= range.min && roll <= range.max;
  const payout = won ? Math.floor(NZ_FEE * range.mult) : 0;
  if (won) user.nova += payout;
  saveUser(user);
  recordGame(user.id, "number-zone", NZ_FEE, `roll=${roll} range=${rangeIndex} won=${won}`, won ? payout : -NZ_FEE);

  res.json({ roll, won, payout, nova: user.nova, user: sanitize(user) });
});

// POST /games/gem-rush/start — Gem Rush (start)
const GEM_FEE   = 20;
const GEM_ROWS  = 4, GEM_COLS = 5, GEM_TOTAL = GEM_ROWS * GEM_COLS, GEM_BOMBS = 4;
const gemSessions = new Map();  // sessionId → { userId, grid, earned, bet }

app.post("/games/gem-rush/start", auth, (req, res) => {
  const { bet = GEM_FEE } = req.body;
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.nova < bet) return res.status(400).json({ error: "Insufficient NOVA" });

  user.nova -= bet;
  saveUser(user);

  // Build hidden grid
  const bombs = new Set();
  while (bombs.size < GEM_BOMBS) bombs.add(Math.floor(Math.random() * GEM_TOTAL));
  const grid = Array.from({ length: GEM_TOTAL }, (_, i) => ({
    bomb:     bombs.has(i),
    value:    Math.floor(Math.random() * 8) + 3,
    revealed: false,
  }));

  const sessionId = uuid();
  gemSessions.set(sessionId, { userId: user.id, grid, earned: 0, bet, done: false });
  setTimeout(() => gemSessions.delete(sessionId), ms(1));  // auto-expire after 24h

  // Return grid without bomb positions
  const clientGrid = grid.map(c => ({ revealed: false }));
  res.json({ sessionId, clientGrid, nova: user.nova, user: sanitize(user) });
});

// POST /games/gem-rush/reveal
app.post("/games/gem-rush/reveal", auth, (req, res) => {
  const { sessionId, index } = req.body;
  const session = gemSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found or expired" });
  if (session.userId !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  if (session.done) return res.status(400).json({ error: "Session already ended" });

  const cell = session.grid[index];
  if (!cell || cell.revealed) return res.status(400).json({ error: "Already revealed" });
  cell.revealed = true;

  if (cell.bomb) {
    session.done = true;
    recordGame(req.user.id, "gem-rush", session.bet, "bomb", -session.bet);
    return res.json({ bomb: true, earned: session.earned, done: true });
  }

  session.earned += cell.value;
  res.json({ bomb: false, value: cell.value, earned: session.earned, done: false });
});

// POST /games/gem-rush/cashout
app.post("/games/gem-rush/cashout", auth, (req, res) => {
  const { sessionId } = req.body;
  const session = gemSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.userId !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  if (session.done) return res.status(400).json({ error: "Session already ended" });
  if (session.earned === 0) return res.status(400).json({ error: "Nothing to cash out" });

  session.done = true;
  const user = getUser(req.user.id);
  user.nova += session.earned;
  saveUser(user);
  recordGame(req.user.id, "gem-rush", session.bet, `cashout=${session.earned}`, session.earned - session.bet);

  res.json({ won: session.earned, nova: user.nova, user: sanitize(user) });
});

// POST /games/guess-number
const GUESS_FEE = 20;
const guessSessions = new Map();  // sessionId → { userId, target, attempts, bet }

app.post("/games/guess-number/start", auth, (req, res) => {
  const { bet = GUESS_FEE } = req.body;
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.nova < bet) return res.status(400).json({ error: "Insufficient NOVA" });

  user.nova -= bet;
  saveUser(user);

  const sessionId = uuid();
  guessSessions.set(sessionId, { userId: user.id, target: Math.floor(Math.random() * 500) + 1, attempts: 0, bet, done: false });
  setTimeout(() => guessSessions.delete(sessionId), ms(1));

  res.json({ sessionId, nova: user.nova });
});

app.post("/games/guess-number/guess", auth, (req, res) => {
  const { sessionId, guess } = req.body;
  const session = guessSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.userId !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  if (session.done) return res.status(400).json({ error: "Session ended" });

  const n = parseInt(guess);
  if (!n || n < 1 || n > 500) return res.status(400).json({ error: "Enter 1–500" });

  session.attempts += 1;
  const MAX_ATT = 7;

  if (n === session.target) {
    session.done = true;
    const bonus = Math.max(40 - session.attempts * 4, 10);
    const user  = getUser(req.user.id);
    user.nova  += bonus;
    saveUser(user);
    recordGame(req.user.id, "guess-number", session.bet, `correct in ${session.attempts}`, bonus - session.bet);
    return res.json({ correct: true, bonus, attempts: session.attempts, nova: user.nova, user: sanitize(user) });
  }

  if (session.attempts >= MAX_ATT) {
    session.done = true;
    recordGame(req.user.id, "guess-number", session.bet, `failed target=${session.target}`, -session.bet);
    return res.json({ correct: false, hint: n < session.target ? "too_low" : "too_high", attempts: session.attempts, done: true, target: session.target });
  }

  res.json({ correct: false, hint: n < session.target ? "too_low" : "too_high", attempts: session.attempts, done: false });
});

// POST /games/tictactoe
const TTT_FEE = 20;
const TTT_WIN = 35;

function checkTTT(board) {
  const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a, b, c] of wins) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  if (board.every(Boolean)) return "draw";
  return null;
}

function tttAI(board) {
  const empties = board.map((v, i) => v ? null : i).filter(v => v !== null);
  for (const i of empties) { const t = [...board]; t[i] = "O"; if (checkTTT(t) === "O") return i; }
  for (const i of empties) { const t = [...board]; t[i] = "X"; if (checkTTT(t) === "X") return i; }
  if (empties.includes(4)) return 4;
  const corners = empties.filter(i => [0,2,6,8].includes(i));
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  return empties[Math.floor(Math.random() * empties.length)];
}

app.post("/games/tictactoe/move", auth, (req, res) => {
  const { board, cellIndex, nova } = req.body;
  // board = current 9-cell array of "X"|"O"|null
  // cellIndex = where user placed X
  // nova = current nova (deduct fee only when starting fresh)
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  // Apply user move
  const nb = [...board];
  nb[cellIndex] = "X";

  const w1 = checkTTT(nb);
  if (w1) {
    if (w1 === "X") {
      user.nova += TTT_WIN;
      saveUser(user);
      recordGame(user.id, "tictactoe", TTT_FEE, "player_win", TTT_WIN - TTT_FEE);
    }
    return res.json({ board: nb, result: w1, aiMove: null, nova: user.nova, user: sanitize(user) });
  }

  // AI move
  const aiIdx = tttAI(nb);
  if (aiIdx !== null && aiIdx !== undefined) nb[aiIdx] = "O";

  const w2 = checkTTT(nb);
  if (w2 === "O") {
    recordGame(user.id, "tictactoe", TTT_FEE, "ai_win", -TTT_FEE);
    saveUser(user);
  } else if (w2 === "draw") {
    recordGame(user.id, "tictactoe", TTT_FEE, "draw", -TTT_FEE);
    saveUser(user);
  }

  res.json({ board: nb, result: w2 || null, aiMove: aiIdx, nova: user.nova, user: sanitize(user) });
});

// POST /games/tictactoe/start  — deduct fee when starting
app.post("/games/tictactoe/start", auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.nova < TTT_FEE) return res.status(400).json({ error: "Need 20 NOVA" });

  user.nova -= TTT_FEE;
  saveUser(user);

  res.json({ nova: user.nova, user: sanitize(user) });
});

// ─── Withdrawals ─────────────────────────────────────────────────────────────
const MIN_WITHDRAW = 10;

// POST /withdraw
app.post("/withdraw", auth, (req, res) => {
  const { method, address, amount } = req.body;
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const a = parseFloat(amount);
  if (!a || a < MIN_WITHDRAW) return res.status(400).json({ error: `Minimum withdrawal is $${MIN_WITHDRAW}` });
  if (a > user.balance) return res.status(400).json({ error: "Insufficient balance" });
  if (!method || !address) return res.status(400).json({ error: "method and address are required" });

  const VALID_METHODS = ["usdt", "paypal", "topup"];
  if (!VALID_METHODS.includes(method)) return res.status(400).json({ error: `Invalid method. Use: ${VALID_METHODS.join(", ")}` });

  user.balance = +(user.balance - a).toFixed(2);
  saveUser(user);

  const wd = { id: uuid(), userId: user.id, method, address, amount: a, status: "pending", createdAt: Date.now() };
  DB.withdrawals.set(wd.id, wd);

  res.json({ withdrawal: wd, balance: user.balance, user: sanitize(user) });
});

// GET /withdraw/history
app.get("/withdraw/history", auth, (req, res) => {
  const list = Array.from(DB.withdrawals.values())
    .filter(w => w.userId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────

// GET /leaderboard?type=nova|balance|referrals
app.get("/leaderboard", (req, res) => {
  const type = req.query.type || "nova";
  const key  = { nova:"nova", balance:"balance", referrals:"friendsInvited" }[type] || "nova";

  const ranked = Array.from(DB.users.values())
    .map(u => ({ id:u.id, username:u.username, value:u[key] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20)
    .map((u, i) => ({ ...u, rank: i + 1 }));

  res.json(ranked);
});

// ─── Referrals ────────────────────────────────────────────────────────────────

// GET /referrals  — get my referral info
app.get("/referrals", auth, (req, res) => {
  const user    = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const list    = DB.referrals.get(user.id) || [];
  const details = list.map(uid => {
    const u = getUser(uid);
    return u ? { id:u.id, username:u.username, nova:u.nova, joinedAt:u.createdAt } : null;
  }).filter(Boolean);

  res.json({
    referralLink:       `https://yourapp.com/join?ref=${user.id}`,
    friendsInvited:     user.friendsInvited,
    earnedFromInvites:  user.earnedFromInvites,
    referrals:          details,
  });
});

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status:"ok", ts: Date.now() }));

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// ─── Error Handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✦ EarnHub API running on http://localhost:${PORT}`);
});

module.exports = app;
