# EarnHub Backend API

Express.js REST API for the EarnHub earn-and-play mini-app.

## Setup

```bash
cd earnhub-backend
npm install
npm start          # production
npm run dev        # development with auto-reload (needs nodemon)
```

Runs on **http://localhost:4000**

Set environment variables:
```
PORT=4000
JWT_SECRET=your_super_secret_key
```

---

## Authentication

All protected routes require a Bearer token in the `Authorization` header:
```
Authorization: Bearer <token>
```

---

## API Reference

### Auth

| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | `/auth/register` | `{ username, password, handle?, referrerId? }` | Register new user |
| POST | `/auth/login` | `{ username, password }` | Login, get token |

---

### User

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/me` | Get own profile |

---

### Daily Claim

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/claim/daily` | Claim daily NOVA bonus |

---

### Earning

| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | `/earn/ad-complete` | — | Record watched ad, +$0.20 |
| GET | `/tasks` | — | List all tasks with completion status |
| POST | `/tasks/:id/complete` | — | Complete a task, earn NOVA |

---

### Games

#### Spin Wheel
| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | `/games/spin` | — | Spin (-15 NOVA), get result |

#### Number Zone
| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | `/games/number-zone` | `{ rangeIndex: 0|1|2 }` | Roll dice in range |

#### Gem Rush
| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | `/games/gem-rush/start` | `{ bet? }` | Start session |
| POST | `/games/gem-rush/reveal` | `{ sessionId, index }` | Reveal a cell |
| POST | `/games/gem-rush/cashout` | `{ sessionId }` | Cash out winnings |

#### Guess Number
| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | `/games/guess-number/start` | `{ bet? }` | Start session |
| POST | `/games/guess-number/guess` | `{ sessionId, guess }` | Submit a guess |

#### Tic Tac Toe
| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | `/games/tictactoe/start` | — | Pay entry fee (-20 NOVA) |
| POST | `/games/tictactoe/move` | `{ board, cellIndex }` | Play move, get AI response |

#### Game History
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/games/history` | Get last 50 game results |

---

### Withdrawals

| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | `/withdraw` | `{ method, address, amount }` | Submit withdrawal request |
| GET | `/withdraw/history` | — | List own withdrawal history |

Methods: `usdt` · `paypal` · `topup`

---

### Referrals & Leaderboard

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/referrals` | Get own referral stats & list |
| GET | `/leaderboard?type=nova` | Top 20. type: `nova` / `balance` / `referrals` |

---

### Health

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | API health check |

---

## Data Flow: Referral System

1. User A registers → gets `referralLink` = `https://yourapp.com/join?ref={A.id}`
2. User B opens the link → registers with `referrerId: A.id`
3. B gets **+70 NOVA** signup bonus
4. A gets **+70 NOVA** + **+$0.50** credit immediately
5. Every ad B watches → A gets **10%** of the reward ($0.02)
6. Every task B completes → A gets **10%** NOVA reward

---

## Production Checklist

- [ ] Replace in-memory `Map`s with PostgreSQL or MongoDB
- [ ] Use `process.env.JWT_SECRET` (long random string)
- [ ] Add rate limiting (`express-rate-limit`)
- [ ] Add input validation (`zod` or `joi`)
- [ ] Lock CORS to your domain
- [ ] Add HTTPS (nginx / Caddy in front)
- [ ] Implement real ad verification (Adsgram / IronSource callback)
- [ ] Add admin routes for approving withdrawals
