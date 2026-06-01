# Noviscia System Diagram

## 1) System Structure

```mermaid
graph TD
  U[User / Wallet] --> W[Web App\nNext.js]
  W --> A[API Gateway\nExpress.js]
  W --> S[WebSocket Gateway]
  A --> L[Service Layer]
  S --> W

  L --> P[Price Service]
  L --> POS[Position Service]
  L --> Y[Yield Service]
  L --> ST[Staking Service]
  L --> B[Burn Service]

  P --> O1[Pyth Oracle]
  P --> O2[Switchboard Oracle]
  Y --> K[Kamino / Solend / Marginfi]
  B --> KEEPER[Keeper Bot]

  A --> DB[(PostgreSQL + Prisma)]
  L --> DB
  S --> R[(Redis Cache)]

  A --> O[Off-chain Services]
  O --> I[Indexer]
  O --> KEEPER[Keeper Bot]
  O --> PF[Price Feed]
  O --> WS[WebSocket Broadcaster]

  O --> C[Solana Programs]
  C --> E[Escrow]
  C --> LI[Lending Integrator]
  C --> SM[Staking Manager]
  C --> BE[Burn Engine]
  C --> TN[Token NVSC]
  C --> YD[Yield Distributor]
```

## 2) Trade Flow

```mermaid
sequenceDiagram
  participant U as User Wallet
  participant W as Web App
  participant A as API
  participant S as Services
  participant D as Database
  participant C as Solana Programs
  participant WS as WebSocket

  U->>W: Connect wallet
  U->>W: Submit trade
  W->>A: POST /api/trade
  A->>S: Validate price, margin, risk
  S->>D: Save trade draft / audit log
  S->>C: Recall funds / execute CPI
  C-->>D: Persist execution state
  C-->>WS: Broadcast position update
  WS-->>W: Push real-time update
  W-->>U: Show filled order / PnL
```

## 3) Yield Flow

```mermaid
flowchart TD
  A[Idle User Margin] --> B[Escrow PDA]
  B --> C[Lending Integrator]
  C --> D[Kamino / Solend / Marginfi]
  D --> E[Accrued Yield]
  E --> F[Yield Distributor]
  F --> G[85% to Users]
  F --> H[15% Platform Fee]
  H --> I[Auto-buy NVSC]
  I --> J[Burn Engine / Burn Address]
```

## 4) Deployment Flow

```mermaid
flowchart LR
  K[Code + Config] --> B1[anchor build]
  B1 --> B2[Deploy Solana Programs]
  B2 --> B3[Update Program IDs]
  B3 --> B4[Deploy API + Services]
  B4 --> B5[Deploy Web App]
  B5 --> B6[Health Check + Monitoring]
```

## Target Shape

- **Frontend:** wallet-connected trading UI
- **API:** validates requests and exposes market/user endpoints
- **Services:** keep prices, logs, and automation live
- **Programs:** own custody, staking, yield, and burn logic
- **Data:** PostgreSQL for persistence, Redis for fast live state

## Notes

- Keep the **web app** as the only user-facing entry point.
- Keep **Solana programs** as the source of truth for funds.
- Keep **off-chain services** stateless where possible.
- Broadcast live updates through **WebSocket**, not polling.
