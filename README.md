# 💸 PayFlow — Full-Stack Fintech Application

> A production-grade, event-driven digital payments platform inspired by Paytm — built with **Next.js 14**, **BullMQ**, **Socket.IO**, **Redis**, and **PostgreSQL** in a **Turborepo** monorepo.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-Job_Queues-FF6B6B?style=flat-square)](https://bullmq.io/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Real--Time-010101?style=flat-square&logo=socketdotio&logoColor=white)](https://socket.io/)
[![Redis](https://img.shields.io/badge/Redis-Rate_Limiting-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-336791?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Turborepo](https://img.shields.io/badge/Turborepo-Monorepo-EF4444?style=flat-square&logo=turborepo&logoColor=white)](https://turbo.build/)

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Key Features & Engineering Decisions](#-key-features--engineering-decisions)
- [Monorepo Structure](#-monorepo-structure)
- [Flow Diagrams](#-flow-diagrams)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Database Schema](#-database-schema)
- [API Reference](#-api-reference)

---

## 🎯 Overview

PayFlow is a **production-grade digital wallet** that demonstrates real-world backend engineering patterns you'd find inside a fintech company:

| Capability | Implementation |
|---|---|
| Peer-to-Peer Transfers | Atomic Prisma transactions with balance locking |
| Bank Onramp (Add Money) | HMAC-verified webhook from mock HDFC bank |
| Real-Time Notifications | BullMQ → Socket.IO push to live browser tab |
| Background Email Alerts | Durable email queue with exponential backoff retries |
| Withdrawal to Bank | Full state machine: PENDING → PROCESSING → SUCCESS / FAILED |
| Rate Limiting | Redis atomic `SET NX EX` + `INCR` — race-condition-free |
| Transaction History | DB-level pagination with `skip/take` (no in-memory slice) |
| Auth | NextAuth.js with credential provider + JWT sessions |

---

## 🏗 Architecture

```
Browser (Next.js User App — port 3000)
        │  HTTPS / WebSocket
        ▼
┌──────────────────────────────────────────┐
│         apps/user-app  (Next.js 14)      │
│  Server Actions: p2pTransfer, onramp,    │
│  createWithdrawal, getTransactionHistory │
└──────┬───────────────┬───────────────────┘
       │ Prisma        │ BullMQ enqueue
       ▼               ▼
  PostgreSQL     Redis (BullMQ job store)
       ▲               │
       │    ┌──────────┴─────────┐
       │    │  3 BullMQ Queues   │
       │    │  notification-queue│
       │    │  email-queue       │
       │    │  withdrawal-queue  │
       │    └──────────┬─────────┘
       │               │  consumed by
       │    ┌──────────▼──────────────────────┐
       │    │   apps/notification-worker       │
       │    │   notificationWorker → /notify   │
       │    │   emailWorker → nodemailer       │
       ├────│   withdrawalWorker → bank API    │
       │    └──────────┬──────────────────────┘
       │               │ POST /notify
       │    ┌──────────▼──────────┐
       │    │  apps/ws-server     │
       │    │  Socket.IO (3003)   │
       │    │  JWT auth middleware│
       │    └──────────┬──────────┘
       │               │ socket.emit
       │               ▼
       │         Browser Toast 🎉
       │
  apps/bank-webhook  (Express, port 3002)
  ← POST /hdfcWebhook (HMAC-SHA256 verified)
  → credits user balance in PostgreSQL
```

---

## ✨ Key Features & Engineering Decisions

### 1. 🔐 Webhook Signature Verification
The HDFC bank webhook uses **HMAC-SHA256** on the **raw request body** (via `express.raw()`).

**Why raw body?** `express.json()` re-serializes an already-parsed object. Key ordering, whitespace, and Unicode escaping can all differ from the original bytes — the HMAC will never match. We verify first, then `JSON.parse` the raw buffer. We also guard `timingSafeEqual` with a buffer length check before calling it — a truncated or malformed signature would otherwise throw and crash the route instead of returning 401.

---

### 2. ⚡ Race-Condition-Free Rate Limiting
Max **5 requests per minute per user** on P2P and onramp routes using a single Redis atomic command.

```
SET ratelimit:<action>:<userId>  0  EX 60  NX
INCR ratelimit:<action>:<userId>
```

**Why not `INCR` → `EXPIRE`?** Under concurrent load, two requests can both `INCR` to `1` before either sets a TTL — leaving a key with no expiry that permanently blocks the user. `SET NX EX` is a single atomic operation with zero race window.

---

### 3. 🔔 Durable Real-Time Notifications
After a P2P transfer commits to PostgreSQL, two BullMQ jobs are enqueued:

```
prisma.$transaction([...]) → SUCCESS
         ↓
notificationQueue.add(...)  ← durable, retried on failure
emailQueue.add(...)
         ↓
notification-worker → POST /notify → ws-server → socket.emit → toast 🎉
```

**Why BullMQ instead of direct HTTP?** If ws-server is down when the transfer fires, the job stays in Redis and gets retried with exponential backoff. A direct HTTP call would silently lose the notification.

**Idempotency:** BullMQ retries run the job handler from scratch. Each retry would insert a duplicate `Notification` row without a guard. We store `job.id` as `externalJobId` with a `@unique` constraint — second attempt with the same job ID is caught and skipped. Socket push always fires (stateless → naturally idempotent).

---

### 4. 💰 Balance Locking for Safe Withdrawals
Funds are never deducted outright before the bank API confirms.

```
createWithdrawal()
  → prisma.$transaction:
      Balance.amount  -= 1000   (unavailable to spend)
      Balance.locked  += 1000   (reserved, pending transfer)
      Withdrawal.status = PENDING
  → withdrawalQueue.add(...)
  → worker calls mock HDFC API
      ✅ SUCCESS → locked  -= 1000  (money left system)
      ❌ FAILED  → amount  += 1000  (restored)
                   locked  -= 1000  (escrow cleared)
```

The withdrawal state machine: **PENDING → PROCESSING → SUCCESS | FAILED**

`PROCESSING` exists so if the worker crashes mid-flight, we know the job was picked up and don't blindly retry a bank transfer that may have already gone through. Balance restoration happens in `worker.on('failed')` — not inside the job handler — so intermediate retries don't prematurely restore funds.

---

### 5. 📊 DB-Level Pagination
Transaction history uses `skip` / `take` pushed into Prisma — the database does the work. The original pattern of fetching all rows into Node.js memory and slicing in JS is O(n) on every page load and doesn't scale.

---

## 📂 Monorepo Structure

```
.
├── apps/
│   ├── user-app/              # Next.js 14 — auth, dashboard, P2P, onramp, withdraw
│   │   ├── app/
│   │   │   ├── (dashboard)/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── transfer/
│   │   │   │   ├── transactions/  # paginated history (Sent/Received/Onramp)
│   │   │   │   └── withdraw/      # withdrawal form + status table
│   │   │   └── lib/
│   │   │       └── actions/
│   │   │           ├── p2pTransfer.ts
│   │   │           ├── createOnRampTransaction.ts
│   │   │           ├── createWithdrawal.ts
│   │   │           └── getTransactionHistory.ts
│   │   └── components/
│   │       └── NotificationProvider.tsx  # Socket.IO client + toast
│   │
│   ├── bank-webhook/          # Express — POST /hdfcWebhook (HMAC verified)
│   ├── ws-server/             # Socket.IO server — JWT auth, /notify endpoint
│   ├── notification-worker/   # BullMQ workers: notification, email, withdrawal
│   └── merchant-app/          # Stub (not in scope)
│
└── packages/
    ├── db/                    # Prisma client + schema + migrations
    ├── queues/                # Shared BullMQ queue definitions (single source of truth)
    ├── rate-limiter/          # Redis rate limiting utility
    ├── store/                 # Recoil atoms (balanceAtom)
    ├── ui/                    # Shared React components
    ├── eslint-config/
    └── typescript-config/
```

---

## 📸 Flow Diagrams

> Hand-drawn architecture diagrams by the author.

### 🗺 System Overview

![System Overview — full request flow from browser through Next.js, Redis, BullMQ, ws-server, and PostgreSQL](./ScreenShots/Screenshot%202026-06-17%20131853.png)

---

### 🔄 P2P Transfer Flow

![P2P Transfer — rate limiting, Prisma transaction, BullMQ enqueue, notification + email workers, WebSocket push](./ScreenShots/Screenshot%202026-06-17%20132947.png)

---

### 🏦 Bank Onramp (Add Money) Flow

![OnRamp — user adds money, Next.js creates PENDING record, bank webhook fires HMAC verification, balance credited in PostgreSQL](./ScreenShots/Screenshot%202026-06-17%20133005.png)

---

### 💸 Withdrawal State Machine

![Withdrawal — createWithdrawal locks funds atomically, BullMQ job calls HDFC API, SUCCESS releases locked, FAILED restores both amount and locked](./ScreenShots/Screenshot%202026-06-17%20133022.png)

---

## 🛠 Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | Next.js 14, TypeScript | App Router, Server Actions, RSC |
| **Auth** | NextAuth.js (Credentials + JWT) | Session handling, secure token flow |
| **State** | Recoil | Lightweight atom-based global state |
| **Database** | PostgreSQL + Prisma ORM | Type-safe queries, atomic transactions |
| **Job Queues** | BullMQ | Durable, Redis-backed, exponential backoff |
| **Real-Time** | Socket.IO (ws-server) | JWT-authenticated WebSocket connections |
| **Rate Limiting** | Redis (`ioredis`) | Atomic `SET NX EX` — no race conditions |
| **Webhook Server** | Express | Lightweight, raw body middleware |
| **Monorepo** | Turborepo + npm workspaces | Shared packages, parallel builds |
| **Infra** | Docker (PostgreSQL + Redis) | One-command local dev environment |

---

## 🚀 Getting Started

### Prerequisites

- Node.js ≥ 18
- Docker Desktop

### 1. Start Infrastructure

```bash
# PostgreSQL
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password --name paytm-pg postgres

# Redis (shared by BullMQ + rate limiter)
docker run -d -p 6379:6379 --name paytm-redis redis
```

### 2. Install Dependencies

```bash
git clone <your-repo-url>
cd Paytm
npm install
```

### 3. Configure Environment

Copy and fill in the `.env` files for each app and package (see [Environment Variables](#-environment-variables) below).

### 4. Run Migrations

```bash
cd packages/db
npx prisma migrate dev --name init
npx prisma generate
cd ../..
```

### 5. Start All Services

```bash
# Starts all apps in parallel via Turborepo
npm run dev
```

| Service | Port | Command (standalone) |
|---|---|---|
| user-app | 3000 | `cd apps/user-app && npm run dev` |
| bank-webhook | 3002 | `cd apps/bank-webhook && npm run dev` |
| ws-server | 3003 | `cd apps/ws-server && npm run dev` |
| notification-worker | — | `cd apps/notification-worker && npm run dev` |

---

## 🔑 Environment Variables

### `apps/user-app/.env`

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/paytm
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_WS_SERVER_URL=http://localhost:3003
```

### `apps/bank-webhook/.env`

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/paytm
HDFC_WEBHOOK_SECRET=your_shared_hmac_secret
```

### `apps/ws-server/.env`

```env
JWT_SECRET=your_jwt_secret
PORT=3003
```

### `apps/notification-worker/.env`

```env
REDIS_URL=redis://localhost:6379
WS_SERVER_URL=http://localhost:3003
DATABASE_URL=postgresql://postgres:password@localhost:5432/paytm
```

### `packages/queues/.env` & `packages/rate-limiter/.env`

```env
REDIS_URL=redis://localhost:6379
```

---

## 🗄 Database Schema

```prisma
model User {
  id               Int                  @id @default(autoincrement())
  email            String?              @unique
  name             String?
  number           String               @unique
  password         String
  Balance          Balance[]
  OnRampTransaction OnRampTransaction[]
  sentTransfers    p2pTransfer[]        @relation("fromUser")
  receivedTransfers p2pTransfer[]       @relation("toUser")
  notifications    Notification[]
  withdrawals      Withdrawal[]
}

model Balance {
  id     Int  @id @default(autoincrement())
  userId Int  @unique
  amount Int               // spendable balance (paise)
  locked Int  @default(0)  // funds reserved for in-flight withdrawals
  user   User @relation(fields: [userId], references: [id])
}

model OnRampTransaction {
  id        Int      @id @default(autoincrement())
  status    String
  token     String   @unique
  provider  String
  amount    Int
  startTime DateTime
  userId    Int
  user      User     @relation(fields: [userId], references: [id])
}

model p2pTransfer {
  id         Int      @id @default(autoincrement())
  amount     Int
  timestamp  DateTime
  fromUserId Int
  toUserId   Int
  fromUser   User     @relation("fromUser", fields: [fromUserId], references: [id])
  toUser     User     @relation("toUser", fields: [toUserId], references: [id])
}

model Notification {
  id            Int      @id @default(autoincrement())
  userId        Int
  title         String
  body          String
  read          Boolean  @default(false)
  externalJobId String   @unique   // BullMQ job.id — idempotency key
  createdAt     DateTime @default(now())
  user          User     @relation(fields: [userId], references: [id])
}

model Withdrawal {
  id        Int      @id @default(autoincrement())
  userId    Int
  amount    Int
  status    String   @default("PENDING")   // PENDING | PROCESSING | SUCCESS | FAILED
  bankRef   String?                         // populated on SUCCESS
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
}
```

---

## 🔌 API Reference

### `POST /hdfcWebhook` — `apps/bank-webhook` (port 3002)

Simulates a bank callback after the user adds money to their wallet.

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `x-hdfc-signature` | HMAC-SHA256 hex of raw body |

```json
{
  "token": "unique_onramp_token",
  "user_identifier": "user_phone_number",
  "amount": 50000
}
```

**Responses:** `200 Captured` · `401 Invalid signature` · `411 Processing error`

---

### `POST /notify` — `apps/ws-server` (port 3003, internal only)

Called by `notification-worker` to push real-time events to the browser.

```json
{
  "toUserId": 42,
  "amount": 50000,
  "fromName": "Tridibesh"
}
```

---

## ⚖️ License & Copyright

**Copyright © 2026 Tridibesh Samantroy. All Rights Reserved.**

This project and all of its source code, documentation, diagrams, and assets are the exclusive intellectual property of **Tridibesh Samantroy**.

**Unauthorized copying, reproduction, redistribution, modification, or commercial use of this project — in whole or in part — is strictly prohibited without prior written permission from the author.**

This repository is made publicly visible **for portfolio and demonstration purposes only**. Viewing the code does not grant any license to use, copy, fork, or distribute it.

For licensing inquiries, please contact the author directly.

---

<div align="center">

Built with ❤️ by **Tridibesh Samantroy**

*Production-grade backend engineering: event-driven architecture, atomic transactions, durable job queues, and real-time communication.*

**© 2026 Tridibesh Samantroy — All Rights Reserved**

</div>