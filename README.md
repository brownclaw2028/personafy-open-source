# Personafy

**Privacy-first personal context vault for AI agents.**

Personafy stores your preferences, sizes, dietary needs, and other personal facts — then selectively shares them with AI agents via an approval flow. You control what gets shared, with whom, and for how long.

## Architecture

```
┌──────────────┐        ┌──────────────────┐
│  AI Agent    │  ──→   │  OpenClaw Plugin  │
│  (e.g. shop) │  ←──   │  personafy_req..  │
└──────────────┘        └───────┬──────────┘
                                │ approval flow
                        ┌───────▼──────────┐
                        │  Personafy Vault  │
                        │  (local JSON)     │
                        └──────────────────┘
```

- **Vault**: Local JSON store with personas, facts, rules, and audit log
- **Plugin**: OpenClaw tool (`personafy_request_context`) that gates access to personal data
- **Web App**: React dashboard for managing personas, reviewing approvals, creating rules

## Quick Start

```bash
# Install dependencies
cd apps/web && npm install
cd ../../packages/openclaw-plugin && npm install

# Start dev server
cd apps/web && npm run dev
# → http://localhost:5173

# Run tests
cd apps/web && npx vitest run           # 197 web tests
cd ../../packages/openclaw-plugin && npx vitest run  # 52 plugin tests
# Total: 249 tests
```

## Optional Hippius Cloud Backup (Internal Beta)

Cloud backup remains local-first and opt-in:

- Default mode keeps existing behavior (`Supabase` sync path, no Hippius backup by default).
- Backup uploads are encrypted snapshots only.
- Restore uses the latest cloud-backup snapshot source (not the sync envelope lane), with explicit confirmation and local decrypt verification.

### Beta Flag Matrix

Client (`VITE_*`) flags:

- `VITE_CLOUD_MIGRATION_MODE=supabase-only|coexist|hippius-only`
- `VITE_CLOUD_BACKUP_PROVIDER=supabase|hippius`
- `VITE_ENABLE_HIPPIUS_BACKUP=true|false`
- `VITE_CLOUD_BACKUP_DEFAULT_ON=false` (must remain false)

Server flags:

- `HIPPIUS_ACCESS_KEY_ID`
- `HIPPIUS_SECRET_ACCESS_KEY`
- `HIPPIUS_BUCKET`
- `HIPPIUS_RPC_URL`

### Internal Cohort Rollout (Phase 6)

1. Start with `coexist` mode and `hippius` backup provider for internal users only.
2. Keep backup opt-in by default (`VITE_CLOUD_BACKUP_DEFAULT_ON=false`).
3. Monitor telemetry for completion rate, 429s, and latency before widening rollout.

### One-Step Rollback

If Hippius backup regresses:

1. Set `VITE_CLOUD_BACKUP_PROVIDER=supabase`
2. Set `VITE_ENABLE_HIPPIUS_BACKUP=false`
3. Redeploy

No local vault migration is required, and local-first behavior remains unaffected.

## Project Structure

```
apps/web/                    React + Vite + TypeScript + Tailwind
  src/
    components/              Shared UI (Layout, Topbar, Toast, Sparkline, ...)
      VaultErrorState.tsx    Retry-able error state for vault connection failures
      KeyboardShortcuts.tsx  Global ? toggle for shortcuts help panel
      persona/               PersonaDetail sub-components (FactsPanel, SharingPanel, ...)
      settings/              Settings sub-components (PostureSection, SettingsWidgets)
    pages/                   16 screens (lazy-loaded via React.lazy)
    lib/                     Pure logic + hooks
      extractor.ts           Client-side ChatGPT conversation extractor
      sparkline.ts           Pure SVG sparkline computation (no charting lib)
      quickstart-converter.ts  Questionnaire answers → personas converter
      utils.ts               timeAgo, eventType, groupFactsByCategory, completionScore, sortFacts, deriveHighlights, validateVaultImport, detectDuplicateFacts
      useNow.ts              Periodic Date.now() via useSyncExternalStore
      useDocumentTitle.ts    Dynamic <title> per page with cleanup
      vault.ts               Types + fetchVault/saveVault API
      VaultProvider.tsx       Shared context + serialized save queue
    workers/                 Web Worker for off-main-thread extraction
packages/openclaw-plugin/    OpenClaw integration
  index.ts                   Plugin entry (tools, commands, config)
  lib.ts                     Pure functions (matchFacts, checkAutoAllow, ...)
vault-data.json              Local vault data (not committed)
```

## Screens (16 + modals)

| Screen | Description |
|--------|-------------|
| Welcome | Privacy posture selection (Simple Lock / Alarm System / Safe Room) |
| Create Vault | Passphrase + Touch ID + derived-facts toggle |
| Home | Dashboard with stats, sparkline histogram, persona coverage, recent activity |
| Import | Upload ChatGPT export JSON (processed in Web Worker) |
| QuickStart | Gamified questionnaire (5 categories, 22 questions) |
| Import Review | Extracted personas + facts with confidence/sensitivity |
| Personas | Card grid with completion meters + **Create Persona** modal |
| Persona Detail | Facts CRUD (inline edit), sharing history, per-persona settings (tabbed) |
| Approvals | Master-detail timeline with search, filters, expandable cards, rule creation |
| Rules | Full CRUD (create/edit/delete modals), search, status filter, toast feedback |
| Audit Log | Full event timeline with search, category filters (All/Access/Config), stats |
| Devices | Vault-backed paired devices, pairing flow with QR code + code, `/personafy pair` CLI support, device removal with ConfirmDialog |
| Sources | Data source connections with vault-driven stats |
| Settings | Privacy posture, context TTL, export/import backup, destroy vault |

## Key Features

- **Three onboarding paths**: ChatGPT import, QuickStart questionnaire, manual persona creation
- **Cmd+K search**: Multi-type results (personas, facts, settings), keyboard navigation
- **Live timestamps**: All time-ago labels, approval badges, and rule expiry counters update via `useNow` hook — zero frozen `Date.now()` patterns
- **Dynamic completion scores**: Recalculate on every fact add/edit/delete (70% coverage + 30% confidence)
- **Serialized save queue**: VaultProvider chains saves via Promise queue — rapid changes can't clobber, epoch-based staleness detection prevents stale fetches from overwriting optimistic state
- **Vault error recovery**: All 9 data pages show retry-able error state (stale-while-revalidate pattern)
- **Destroy vault**: Type-to-confirm "DESTROY" gate, clears all data + localStorage, redirects to setup
- **Toast notifications**: All user-facing operations confirm via toast (no native alerts/confirms)
- **Import/Export backup**: Import validates structure (posture, persona sub-fields), shows preview dialog; export downloads full vault JSON
- **Vault Highlights**: Home dashboard shows smart per-persona fact snippets via priority key lists (category-aware, sensitivity-masked)
- **Fact search + sort**: PersonaDetail search filters by key/value with counter; sort by key, sensitivity, or confidence
- **App branding**: Custom SVG favicon, meta tags, dynamic `<title>` per page (e.g., "Shopping — Personafy")
- **Duplicate fact detection**: Yellow warning banner in PersonaDetail, "Show duplicates" filter toggle with counter
- **Keyboard shortcuts**: Press `?` for global shortcuts panel (⌘K search, tab nav, focus controls)
- **Staggered animations**: CSS `animate-fade-in` + `stagger-children` for polished card entrances
- **Accessibility**: Skip-to-content link, `<main>` landmark, aria-live route change announcer for screen readers
- **Vault-backed devices**: Devices page reads/writes vault, pairing creates pending entry, ConfirmDialog for removal
- **Device pairing**: QR code generation (via `qrcode` library), `/personafy pair <CODE> [name]` CLI command, 10-minute expiry
- **Rule audit logging**: Creating rules (manual or from approvals) logs `rule_created/...` events to audit log
- **Dashboard devices**: Home shows Paired Devices stat card + dynamic Vault Health status

## Privacy Postures

- **Simple Lock**: Auto-allows low-sensitivity facts
- **Alarm System** (recommended): Requires approval for medium/high — rules cannot bypass
- **Safe Room**: Blocks all — every request needs explicit approval, rules disabled

## Design

Dark premium aesthetic inspired by Linear/Raycast:
- Navy `#0D1117`, Blue `#0172ED`, Mint `#51E8A6`
- SF Pro typography, glassmorphism cards with gradient borders
- CSS animations (fade-in, slide-up, scale-in, stagger-children)
- Responsive layout with mobile sidebar overlay

## Tech Stack

- **Frontend**: React 19.2, TypeScript 5.9, Vite 7, Tailwind CSS 3
- **Testing**: Vitest 4 — 249 tests across 5 suites
  - `extractor.test.ts` (42) — conversation parsing + pattern matching
  - `sparkline.test.ts` (41) — SVG computation, data sanitization
  - `utils.test.ts` (97) — timeAgo, eventType, createRuleCreatedAuditEvent, grouping, completionScore, sortFacts, validateVaultImport (devices + settings validation), deriveHighlights, detectDuplicateFacts
  - `quickstart-converter.test.ts` (17) — questionnaire → persona conversion
  - `lib.test.ts` (52) — plugin matchFacts, checkAutoAllow, sensitivity, getContextTtlSeconds
- **Plugin**: OpenClaw plugin API (TypeBox schemas)
- **Build**: ~1.2s production build, ~132KB gzip main bundle, 22+ lazy-loaded chunks
- **Code Quality**: 0 TSC errors, 0 ESLint errors, strict React hooks rules

## Development

```bash
# Full check (what the build loop runs every cycle)
cd apps/web
npx tsc --noEmit                          # Type check
npx eslint src/ --max-warnings 0          # Lint
npx vitest run                            # Tests (191)
npx vite build                            # Production build

cd ../../packages/openclaw-plugin
npx vitest run                            # Plugin tests (48)
```

## Build History

68+ cycles of autonomous build-improve-test-harden (ralph-loop):
- Cycles 1–10: Foundation — Topbar, Layout, VaultProvider, lint zero
- Cycles 11–13: Extractor tests, fact CRUD, persona edit/delete
- Cycles 14–17: Cmd+K search, persona settings, plugin visibility, Web Worker
- Cycles 18–20: Dual-model adversarial reviews + plugin test suite
- Cycles 21–27: Sparkline, QuickStart, ConfirmDialog, adversarial fixes
- Cycles 28–34: Bug fixes, lazy loading, production build, README
- Cycles 35–42: Error states, AuditLog filters, Create Persona, dynamic scores
- Cycles 43–49: Import/export backup, vault highlights, fact search/sort, branding, validation tests
- Cycle 50: Documentation update + production build verification
- Cycle 51: Duplicate fact detection with filter toggle + 8 tests
- Cycle 52: Global keyboard shortcuts help panel (press `?`)
- Cycle 53: Code-duo Mode C adversarial audit (Claude Opus + GPT-5.2) — 14 findings, 5 fixed
- Cycle 54: README update (229 tests, cycles 51-53 documented)
- Cycle 55: PersonaDetail decomposition (1052→435 lines — FactsPanel, SharingPanel, PersonaSettingsPanel)
- Cycle 56: VaultProvider hardening — refresh starvation fix, save-clobber epoch-based detection, deferred refresh
- Cycle 57: Accessibility — skip-to-content, `<main>` landmark, route change announcer
- Cycle 58: Settings decomposition (516→360 lines — PostureSection, SettingsWidgets)
- Cycle 59: README update (cycles 54-58 documented)
- Cycle 60: Wire Devices to vault + fix 6 TS build errors + VaultDevice model
- Cycle 61: Home dashboard Paired Devices card + dynamic health status + device quick action
- Cycle 62: Device validation in validateVaultImport + 10 new tests (191 total)
- Cycle 63: README update — cycles 59-62, 62 total, device features + 239 tests documented
- Cycle 64: Cmd+K search now includes Devices (name, type, status)
- Cycle 65: Keyboard shortcuts help mentions devices in Cmd+K search
- Cycle 66: Preserve devices when (re)creating vault; plugin uses vault TTL for context expiry + accurate deny audit logging; validate settings in vault import; handle invalid TTL gracefully (248 tests)
- Cycle 67: Rules search/filter, Rules page improvements
- Cycle 68: `/personafy pair <CODE> [name]` CLI pairing command, Devices modal shows real QR code, rule creation logs to audit, Rules modal saving fixes (249 tests)

## License

Private — © 2026
