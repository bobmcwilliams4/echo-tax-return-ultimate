# Echo Tax Return Ultimate

**AI-native tax preparation platform with 14 doctrine engines, IRS MeF e-file, and Claude Opus deep analysis.**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)]()
[![Status](https://img.shields.io/badge/status-operational-green.svg)]()
[![License](https://img.shields.io/badge/license-proprietary-red.svg)]()
[![Gold Standard](https://img.shields.io/badge/gold_standard-10%2F10-gold.svg)]()

## Overview

Echo Tax Return Ultimate (ETRU) is a production-grade, AI-powered tax preparation system built on Bun + Hono with SQLite WAL. It combines 14 specialized tax doctrine engines with Claude Opus subprocess integration to deliver CPA-grade tax analysis in milliseconds.

### Key Capabilities

- **14 Sovereign Tax Engines** — FIE (Federal), STE (State), BIE (Business), CRE (Credits), DEP (Depreciation), EST (Estate), CRY (Crypto), INT (International), AUD (Audit), PLN (Planning), LEG (Legal), RET (Retirement), plus TIE, PIE, and ARCS
- **Three-Layer Response Pattern** — Doctrine Cache (0-50ms) -> Semantic FTS5 (50-200ms) -> Claude Deep Analysis (1-15s)
- **Full 2025 Tax Tables** — Brackets, standard deductions, capital gains, AMT, FICA, NIIT, EIC, CTC, QBI, mileage rates, contribution limits
- **IRS MeF E-File** — SOAP 1.1 + MIME multipart XML generation with A2A transmission support
- **AES-256-GCM Encryption** — Zero-knowledge PII protection for SSN, bank accounts, and sensitive data
- **SHA-256 Hash-Chained Audit Trail** — Append-only, tamper-evident compliance logging
- **220+ API Endpoints** — Complete REST API with Zod validation, rate limiting, and RBAC

## Architecture

```
                    +-------------------+
                    |   Hono v4 Server  |
                    |    Port 9000      |
                    +--------+----------+
                             |
              +--------------+--------------+
              |              |              |
        +-----+-----+  +----+----+  +------+------+
        |  Auth MW   |  | Rate    |  |  Audit MW   |
        | API Key +  |  | Limit   |  | SHA-256     |
        | Bearer JWT |  | Tiered  |  | Hash Chain  |
        +-----+------+  +----+----+  +------+------+
              |              |              |
     +--------+--------+----+----+---------+---------+
     |        |        |        |         |          |
  Clients  Returns  Income  Deductions  Engine    E-File
  Routes   Routes   Routes   Routes     Routes    Routes
     |        |        |        |         |          |
     +--------+--------+--------+---------+----------+
                        |
              +---------+---------+
              |  SQLite WAL + FTS5 |
              |  24 Tables         |
              |  AES-256-GCM PII   |
              +--------------------+
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun 1.3+ |
| Framework | Hono v4 |
| Database | SQLite WAL (bun:sqlite native) |
| Search | FTS5 full-text search |
| Validation | Zod |
| Encryption | AES-256-GCM (Node crypto) |
| Logging | Pino (structured, PII-redacted) |
| AI Engine | Claude Opus 4.6 (CLI subprocess) |
| Payments | Stripe |
| Documents | pdf-lib, sharp |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.2+
- Claude CLI (for Layer 3 deep analysis)

### Installation

```bash
git clone https://github.com/bobmcwilliams4/echo-tax-return-ultimate.git
cd echo-tax-return-ultimate
bun install
bun run db/seed.ts   # Seeds 2025 tax tables + IRC authority + doctrine blocks
bun run dev          # Starts dev server on port 9000
```

### Environment Variables

```bash
PORT=9000                          # Server port
DATABASE_PATH=./data/returns.db    # SQLite database path
ECHO_API_KEY=your-api-key          # API authentication key
ENCRYPTION_KEY=your-32-byte-key    # AES-256 encryption key (hex)
CLAUDE_MODEL=claude-opus-4-6       # Claude model for deep analysis
CLAUDE_TIMEOUT_MS=60000            # Claude subprocess timeout
STRIPE_SECRET_KEY=sk_...           # Stripe API key
STRIPE_WEBHOOK_SECRET=whsec_...    # Stripe webhook secret
```

## API Reference

### Health Endpoints (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check with engine status |
| GET | `/health/ready` | Readiness probe |

### Client Management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v5/clients` | Create client (SSN encrypted) |
| GET | `/api/v5/clients/:id` | Get client |
| GET | `/api/v5/clients` | List clients (paginated) |
| PUT | `/api/v5/clients/:id` | Update client |
| DELETE | `/api/v5/clients/:id` | Delete client |
| GET | `/api/v5/clients/:id/tax-history` | Multi-year tax history |

### Tax Returns

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v5/returns` | Create return |
| GET | `/api/v5/returns/:id` | Get return with counts |
| GET | `/api/v5/returns` | List returns (filterable) |
| PUT | `/api/v5/returns/:id` | Update return |
| DELETE | `/api/v5/returns/:id` | Delete return |
| POST | `/api/v5/returns/:id/calculate` | Run full tax calculation |
| GET | `/api/v5/returns/:id/summary` | Income/deduction breakdown |
| GET | `/api/v5/returns/:id/health` | Completeness check |
| POST | `/api/v5/returns/:id/lock` | Lock for e-filing |
| POST | `/api/v5/returns/:id/unlock` | Unlock return |
| POST | `/api/v5/returns/:id/clone` | Clone for what-if analysis |

### Income Items

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v5/income` | Add income item |
| GET | `/api/v5/income/:returnId` | List income for return |
| PUT | `/api/v5/income/:incomeId` | Update income item |
| DELETE | `/api/v5/income/:incomeId` | Delete income item |

### Deductions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v5/deductions` | Add deduction |
| GET | `/api/v5/deductions/:returnId` | List deductions for return |
| PUT | `/api/v5/deductions/:dedId` | Update deduction |
| DELETE | `/api/v5/deductions/:dedId` | Delete deduction |

### Engine Queries

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v5/engine/query` | Query tax engine (3-layer response) |
| GET | `/api/v5/engine/doctrines` | List doctrine blocks |
| GET | `/api/v5/engine/irc/search?q=` | FTS5 IRC authority search |

### E-File

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v5/efile/:returnId/submit` | Submit for e-filing |
| GET | `/api/v5/efile/:returnId/status` | E-file status |

### Tax Calculations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v5/calc/amt` | AMT calculation |
| POST | `/api/v5/calc/niit` | NIIT calculation |
| POST | `/api/v5/calc/estimated-payments` | Estimated payment schedule |

### Reference Data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v5/reference/brackets/:year/:status` | Tax brackets |
| GET | `/api/v5/reference/deductions/:year/:status` | Standard deductions |
| GET | `/api/v5/reference/limits/:year` | Contribution limits |
| GET | `/api/v5/reference/mileage/:year` | Mileage rates |

### Authentication

All `/api/v5/*` endpoints require one of:

```bash
# API Key
curl -H "X-Echo-API-Key: your-key" http://localhost:9000/api/v5/clients

# Bearer Token (JWT)
curl -H "Authorization: Bearer eyJ..." http://localhost:9000/api/v5/clients
```

### Rate Limits

| Tier | Requests/min |
|------|-------------|
| Free | 100 |
| Pro | 500 |
| Business | 1,000 |
| Professional | 5,000 |
| Enterprise | 50,000 |

## Tax Calculation Engine

The Federal Income Engine (FIE) implements a 13-step calculation pipeline:

1. **Total Income** — Categorized: wages, business, capital gains, investment, rental
2. **Self-Employment Tax** — 92.35% net x 15.3% (SS + Medicare)
3. **Adjustments** — Above-the-line deductions (SE tax, HSA, IRA, student loan)
4. **Standard vs. Itemized** — Automatic comparison with SALT cap ($10K)
5. **QBI Deduction** — Section 199A (20% below threshold)
6. **Taxable Income** — AGI - deductions - QBI
7. **Ordinary Tax** — Progressive bracket calculation
8. **AMT Check** — Alternative Minimum Tax flag
9. **NIIT** — 3.8% on investment income above threshold
10. **Total Tax** — Ordinary + SE + AMT + NIIT
11. **Credits** — CTC ($2,000), ODC ($500), EIC
12. **Payments & Refund** — Withholding + estimated vs. total tax
13. **Optimization** — Suggestions for tax savings

## Database Schema

24 tables including:

- `clients` — PII with AES-256-GCM encryption
- `tax_returns` — Full return data with status workflow
- `income_items` — Categorized income with form mappings
- `deductions` — Itemized/above-line with schedule assignment
- `dependents` — Qualifying child/relative with credit flags
- `documents` — Document tracking with OCR status
- `efile_submissions` — E-file tracking with rejection handling
- `doctrine_blocks` — Engine knowledge base
- `irc_authority` + FTS5 — IRC sections with full-text search
- `tax_tables` — Year-specific rates, limits, thresholds
- `audit_trail` — SHA-256 hash-chained audit log
- `firms` / `preparers` — Multi-preparer firm support
- `subscriptions` / `api_usage` — Billing and usage tracking

## Security

- **AES-256-GCM** field-level encryption for all PII (SSN, bank accounts)
- **SHA-256 hash-chained** append-only audit trail
- **Rate limiting** per subscription tier
- **CORS** restricted to authorized origins
- **Secure headers** (HSTS, CSP, X-Frame-Options)
- **PII redaction** in all log output
- **Input validation** via Zod schemas on every endpoint

## Project Structure

```
echo-tax-return-ultimate/
  db/
    schema.sql          # 24-table schema with FTS5
    seed.ts             # 2025 tax data seeder
  src/
    index.ts            # Main Hono server
    types/tax.ts        # Zod schemas + TypeScript interfaces
    services/
      database.ts       # SQLite WAL + query helpers + audit
      tax-calculator.ts # FIE 13-step calculation engine
      claude-subprocess.ts # Claude CLI subprocess (Layer 3)
    middleware/
      auth.ts           # API key + JWT authentication
      rate-limit.ts     # Tiered rate limiting
      audit.ts          # Request audit logging
    utils/
      encryption.ts     # AES-256-GCM field encryption
      logger.ts         # Pino structured logger
    routes/
      clients.ts        # Client CRUD + tax history
      returns.ts        # Return CRUD + calculate + clone
      income.ts         # Income items + W-2 import
      deductions.ts     # Deductions + optimization
      dependents.ts     # Dependents + credit qualification
      documents.ts      # Document management + OCR
      engines.ts        # 14-engine query system
      efile.ts          # IRS MeF e-file
      calculations.ts   # AMT, NIIT, estimated payments
      reference.ts      # Tax tables, brackets, limits
      billing.ts        # Stripe subscriptions
      compliance.ts     # 14-rule compliance checks
      firms.ts          # Firm management
      planning.ts       # 10-year projection
      ops.ts            # Health, metrics, audit integrity
```

## License

Proprietary - Echo Prime Technologies

## Built By

Echo Prime Technologies | Bobby McWilliams II
