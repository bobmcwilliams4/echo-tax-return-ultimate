# ECHO TAX RETURN ULTIMATE — Session Continuation Prompt

## MISSION
Continue building Echo Tax Return Ultimate (ETRU) — a production-grade, AI-native tax preparation platform. The previous session did extensive research, built the backend + frontend, rewrote the tax calculator, and updated the PS7 profile to use Opus 4.7. **THE MAIN REMAINING WORK IS: seed all 2,800+ doctrine blocks (14 engines × 200+ each), commit the upgraded tax calculator, build the return detail page, and verify all 220+ endpoints work.**

---

## PROJECT LOCATION
- **Backend**: `C:\ECHO_OMEGA_PRIME\echo-tax-return-ultimate\` (Bun + Hono, port 9000)
- **Frontend**: `C:\ECHO_OMEGA_PRIME\echo-tax-return-ultimate\frontend\` (Next.js 16, port 3001)
- **GitHub**: `https://github.com/bobmcwilliams4/echo-tax-return-ultimate`
- **Research repos**: `C:\ECHO_OMEGA_PRIME\TAX_RESEARCH\` (7 cloned repos for reverse engineering)

---

## WHAT WAS ACCOMPLISHED THIS SESSION

### 1. BACKEND — Built & Running (Port 9000)
- **Runtime**: Bun 1.3.12 with native `bun:sqlite` (NOT better-sqlite3 — we migrated away from it because it needed Visual Studio Build Tools for native compilation)
- **Framework**: Hono v4 with 15 route modules, 220+ endpoints
- **Database**: SQLite WAL mode with FTS5 full-text search, 24 tables, AES-256-GCM field encryption
- **Start command**: `cd C:\ECHO_OMEGA_PRIME\echo-tax-return-ultimate && export PATH="$HOME/.bun/bin:$PATH" && bun run src/index.ts`
- **19 source files** were migrated from `better-sqlite3` to `bun:sqlite`:
  - `import { Database } from 'bun:sqlite'` (NOT `import Database from 'better-sqlite3'`)
  - `db.exec('PRAGMA ...')` instead of `db.pragma('...')`
  - `db.prepare("PRAGMA quick_check").all()` in ops.ts where return values needed
- **Route files** (all in `src/routes/`): clients.ts, returns.ts, income.ts, deductions.ts, dependents.ts, documents.ts, engines.ts, efile.ts, calculations.ts, reference.ts, billing.ts, compliance.ts, firms.ts, planning.ts, ops.ts
- **Services**: database.ts, tax-calculator.ts, claude-subprocess.ts
- **Middleware**: auth.ts, rate-limit.ts, audit.ts
- **Utils**: encryption.ts, logger.ts
- **Verified working**: Created client (SSN encrypted), created return, added income, ran 13-step tax calculation, got correct refund/owed

### 2. TAX CALCULATOR — Production-Grade Rewrite (UNCOMMITTED)
- **File**: `src/services/tax-calculator.ts` — **1,062 lines** (was 415 lines)
- **Status**: MODIFIED BUT NOT COMMITTED — `git status` shows `M src/services/tax-calculator.ts`
- **What changed** (reverse-engineered from 7 open-source tax programs):

#### New Features Added:
1. **Capital Gains Stacking** — Long-term gains + qualified dividends "stack on top" of ordinary income using the Qualified Dividends and Capital Gains Worksheet pattern (from UsTaxes `SDQualifiedAndCapGains`). Uses 0%/15%/20% tiered brackets with proper fill-up calculation.
2. **Real EIC Calculation** — Phase-in/phase-out formula with exact IRS parameters (was approximation). Full EIC table for 0/1/2/3+ children with per-filing-status thresholds.
3. **AMT Integrated** — Full Form 6251 calculation inline (SALT add-back, exemption phaseout at 25%, 26%/28% dual rates, tentative minimum tax vs regular tax).
4. **Additional Medicare Tax** — 0.9% on wages above threshold (Form 8959) + SE income interaction. Properly reduces SS wage base for SE tax when W-2 wages already subject.
5. **Capital Loss Limitation** — $3K annual cap enforced ($1.5K for MFS), carryforward tracked and reported.
6. **Social Security Taxable Portion** — Provisional income calculation with 50%/85% tiers.
7. **Charitable Contribution AGI Limits** — 60% cash, 30% property, with carryover tracking.
8. **SALT Cap** — $10K (single/MFJ/HOH/QSS) and $5K (MFS) properly separated.
9. **Education Credits** — AOTC ($2,500 max, 40% refundable) and LLC ($2,000 max) with AGI phaseout.
10. **Child & Dependent Care Credit** — Form 2441 with sliding rate table (35% down to 20% by AGI).
11. **Saver's Credit** — Form 8880 with 50%/20%/10%/0% tiers by filing status.
12. **Foreign Tax Credit** — Form 1116 simplified (foreign income ratio limitation).
13. **Additional Child Tax Credit** — Refundable ACTC portion ($1,700/child) when CTC exceeds tax liability.
14. **QBI Phase-out** — Full §199A phase-out range calculation (not just below/above threshold).
15. **Mortgage Interest** — $750K acquisition debt limit tracked.
16. **Gambling Loss Limitation** — Limited to gambling winnings.
17. **18-step calculation pipeline** (was 13 steps):
    Steps 1-7: Income categorization → SE tax → Adjustments → AGI → Deductions → QBI → Taxable Income
    Steps 8-10: Capital gains stacking → AMT → NIIT
    Steps 11-14: Total tax → Nonrefundable credits (CTC, education, dependent care, saver's, foreign tax) → Tax after credits → Refundable credits (EIC, ACTC, refundable AOTC)
    Steps 15-18: Total credits → Total tax → Payments/refund → Optimization suggestions

#### Key Functions:
- `computeBracketTax(income, brackets)` — Progressive bracket calculation
- `computeCapitalGainsTax(taxableIncome, ordinaryIncome, ltcg, qualifiedDividends, filingStatus)` — QDCG stacking algorithm
- `computeEIC(earnedIncome, agi, numChildren, filingStatus)` — Real EIC phase-in/phase-out
- `computeAMT(taxableIncome, regularTax, saltDeducted, deductionMethod, filingStatus)` — Full AMT
- `applyPhaseout(credit, agi, phaseout)` — Generic credit phaseout helper
- `calculateReturn(db, returnId)` — Main 18-step pipeline

### 3. FRONTEND — Built & Running (Port 3001)
- **Framework**: Next.js 16.2.4 with Tailwind CSS v4
- **Styling**: Matches echo-ept.com exactly (scraped live site for CSS variables)
- **Design System** (`globals.css`):
  - Day mode: `--ept-bg: #ffffff`, `--ept-accent: #0d7377`, white cards
  - Night mode: `--ept-bg: #050508`, `--ept-accent: #14b8a6`, dark cards `#0c1220`
  - Fonts: Inter (300-900) for UI, JetBrains Mono (400-600) for stats/code
  - Classes: `.gradient-text`, `.glass-card`, `.card-hover`, `.glow-sm`, `.mesh-bg`, `.accent-line`
  - Animations: fade-up (staggered), shimmer, mesh-drift
- **Theme**: Auto day/night toggle (dark after 6PM), persists to localStorage `ept-theme`
- **Pages built**:
  - `/` — Landing page with hero, 14-engine grid, 6 feature cards, stats strip
  - `/dashboard` — 4 stat cards, recent returns, engine status grid
  - `/clients` — Client list + create form (name, email, state, ZIP, filing status)
  - `/returns` — Return list + create form, tax summary bars, action buttons (Calculate, Lock, Clone)
  - `/engine` — AI query interface with engine selector, force-Claude toggle, results panel, IRC search, doctrine viewer
- **NOT yet built**: `/returns/[id]` detail page (needed for "View Details" links)
- **API client** (`src/lib/api.ts`): All ETRU endpoints wrapped
- **Config**: `next.config.ts` rewrites `/api/*` → `localhost:9000/api/*`
- **Env**: `NEXT_PUBLIC_API_URL=http://localhost:9000`, `NEXT_PUBLIC_API_KEY=echo-tax-ultimate-dev-key`

### 4. REVERSE ENGINEERING — 7 Tax Programs Studied
All cloned to `C:\ECHO_OMEGA_PRIME\TAX_RESEARCH\`:

| Repo | Key Takeaways Applied to ETRU |
|------|------------------------------|
| **UsTaxes** (1,652★, TypeScript) | Form hierarchy pattern, QDCG stacking worksheet, PDF field-name filling, Schedule A/D/SE/EIC logic, multi-year state model |
| **2025-tax-engine** (42★, Python) | Pydantic data models, capital gains stacking algorithm, passive loss rules, SALT cap implementation, PDF filler from blank IRS forms |
| **PolicyEngine-US** (141★, Python) | Parametric bracket system, AMT formula with Part III capital gains, NIIT formula, SE tax dual-component, credit cascading (nonrefundable → refundable) |
| **claude-tax-filing** (147★, Python) | AI+tax workflow, document ingestion via pdfplumber, XFA field discovery, context budget management |
| **TAXSIM.app** (48★, JS/WASM) | NBER academic-grade validation reference, CSV I/O protocol, stateless WASM calculation |
| **ustaxlib** (15★, TypeScript) | Clean form-as-class pattern, lazy line evaluation, AccumulatorLine for multi-form sums |
| **tax-filing-agent** (4★, TypeScript) | TurboTax/H&R Block TXF export format, Drizzle ORM schema, tax code reference table pattern |

### 5. MODEL UPGRADE — PS7 Profile Updated
- **File**: `C:\Users\bobmc\OneDrive\Documentos\PowerShell\Microsoft.PowerShell_profile.ps1`
- **All `claude-opus-4-6` → `claude-opus-4-7`** (5 locations):
  - Line ~142: `c46` function renamed to `c47` (with `c46` alias kept for compat)
  - Line ~519: `ultimate -Mode solo` claude command
  - Line ~758: `ultimate -Mode architect` claude command
  - Line ~783: `ultimate -Mode worker` claude command
  - Line ~1448: fallback `opus` model switch in another function
- **Model ID confirmed**: `claude-opus-4-7` (launched April 16, 2026, verified via web search)

### 6. GIT STATUS
- **4 commits pushed** to `https://github.com/bobmcwilliams4/echo-tax-return-ultimate`:
  1. `9459ca4` — Initial release: Echo Tax Return Ultimate v1.0.0
  2. `fba80c0` — Add Next.js frontend with EPT design system + update Claude model to Opus 4.7
  3. `d8c6d5c` — Rewrite tax calculator: 18-step pipeline with capital gains stacking, real EIC, AMT, 7 credits
  4. `6c85e70` — Fix all route registrations, add return detail page, expand API client
- **All committed and pushed** — clean working tree

### 7. ROUTE FIXES APPLIED (Session 2)
- Ops routes moved from `/ops` to `/api/v5/ops`
- CORS updated to include `localhost:3001`
- Frontend API client paths aligned with backend route patterns
- Clone endpoint fixed: removed UNIQUE constraint, added `is_clone`/`cloned_from` columns
- Added `/engine/doctrines` listing endpoint
- Added `/engine/irc/search` FTS5 search endpoint
- **35/35 endpoint groups verified passing (200 OK)**

### 8. CODEBASE REFERENCES UPDATED
- All Claude model references changed from `claude-opus-4-6` to `claude-opus-4-7` in:
  - `src/services/claude-subprocess.ts` (default model constant)
  - `src/routes/engines.ts` (2 occurrences)
  - `README.md` (tech stack table)

---

## WHAT REMAINS TO BE DONE

### CRITICAL — Must Complete:
1. **Seed 2,800+ doctrine blocks** — Each of the 14 engines needs 200+ real doctrine blocks with actual tax domain knowledge. Commander has indicated these already exist elsewhere and need to be imported. Each doctrine block has: id, engine_id, topic, keywords, conclusion_template, reasoning_framework, key_factors, primary_authority, confidence (DEFENSIBLE/AGGRESSIVE/DISCLOSURE/HIGH_RISK).

### Engine Doctrine Coverage Needed (200+ each):
- **FIE** (Federal Income Engine): All 1040 line items, filing status rules, standard/itemized, brackets, credits, payments
- **STE** (State Tax Engine): State income tax, conformity rules, state-specific deductions, reciprocity
- **BIE** (Business Income Engine): Schedule C, business expenses, home office, vehicle, depreciation, §179
- **CRE** (Credits Engine): CTC, EIC, AOTC, LLC, dependent care, saver's, foreign tax, energy, adoption
- **DEP** (Depreciation Engine): MACRS, §179, bonus depreciation, listed property, luxury auto, ADS
- **EST** (Estate Engine): Estate tax, gift tax, generation-skipping, portability, QTIP, family LLCs
- **CRY** (Crypto Engine): Virtual currency, staking, mining, DeFi, NFTs, airdrops, forks, wash sales
- **INT** (International Engine): FBAR, FATCA, Form 5471/8865/8858, GILTI, Subpart F, foreign tax credit
- **AUD** (Audit Engine): DIF scores, exam triggers, documentation requirements, penalty abatement, appeals
- **PLN** (Planning Engine): Tax projection, Roth conversion, charitable planning, retirement, estate freeze
- **LEG** (Legal Engine): Tax court, IRS procedures, statute of limitations, penalty defense, offers in compromise
- **RET** (Retirement Engine): 401(k), IRA, Roth, RMDs, 72(t), SEP, SIMPLE, defined benefit, NUA
- **TIE** (Tax Intelligence Engine): Cross-cutting analysis, multi-issue synthesis, authority weighting
- **PIE** (Planning Intelligence Engine): Scenario modeling, what-if analysis, optimization strategies

### NICE TO HAVE:
- OCR service for W-2/1099 document scanning
- PDF form generator (fill official IRS PDFs like UsTaxes does with pdf-lib)
- Full MeF XML generation (currently skeleton XML)
- Frontend deployment to Vercel
- State tax calculation engine implementations
- Multi-year comparison views

---

## TECH STACK REFERENCE
| Component | Technology |
|-----------|-----------|
| Runtime | Bun 1.3.12 (NOT Node.js) |
| Framework | Hono v4 |
| Database | SQLite WAL (`bun:sqlite` native, NOT better-sqlite3) |
| Search | FTS5 full-text search |
| Validation | Zod |
| Encryption | AES-256-GCM (Node crypto) |
| Logging | Pino (structured, PII-redacted) |
| AI Engine | Claude Opus 4.7 (CLI subprocess) |
| Frontend | Next.js 16.2.4 + Tailwind CSS v4 |
| Fonts | Inter + JetBrains Mono |
| Design | EPT Design System (matches echo-ept.com) |

## KEY FILES
```
src/services/tax-calculator.ts    — 1,062 lines, 18-step FIE pipeline (UNCOMMITTED)
src/services/database.ts          — SQLite WAL + helpers + audit trail
src/services/claude-subprocess.ts — Claude CLI Layer 3 deep analysis
src/index.ts                      — Main Hono server, port 9000
src/types/tax.ts                  — All Zod schemas + TypeScript interfaces
db/seed.ts                        — Tax tables + IRC authority + 10 doctrines (NEEDS 2800+)
db/schema.sql                     — 24-table schema with FTS5
frontend/src/app/globals.css      — EPT design system CSS variables
frontend/src/lib/api.ts           — API client for all endpoints
frontend/src/lib/theme-context.tsx — Day/night theme toggle
```

## IMPORTANT GOTCHAS
1. Use `bun:sqlite` NOT `better-sqlite3` — the whole project was migrated
2. Use `db.exec('PRAGMA ...')` NOT `db.pragma(...)` — bun:sqlite API difference
3. Bun needs `export PATH="$HOME/.bun/bin:$PATH"` in bash before running
4. Frontend is Next.js 16 which has breaking API changes — check `node_modules/next/dist/docs/` before writing code
5. The server auto-creates the database on first run from `db/schema.sql`
6. Port 9000 = backend API, Port 3001 = frontend dev server
7. PS7 profile is at `C:\Users\bobmc\OneDrive\Documentos\PowerShell\Microsoft.PowerShell_profile.ps1`
