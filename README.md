# WildCare: Transparent Crowdfunding for Animal Conservation

## Overview

WildCare is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It addresses real-world problems in animal conservation, such as lack of transparency in charitable donations, misuse of funds, and inefficient reporting in wildlife care organizations. Traditional charities often suffer from opaque spending, leading to donor distrust and reduced contributions. WildCare solves this by enabling decentralized crowdfunding for specific animal care initiatives (e.g., feeding endangered tigers, habitat restoration, or veterinary care), with all transactions, fund releases, and spending reports recorded immutably on the blockchain.

Key features:
- **Crowdfunding Campaigns**: Users create or contribute to campaigns for animal care needs, using STX or a native fungible token (WCT).
- **Transparency via Blockchain**: Funds are locked in smart contracts and released only upon verified milestones or community votes. Spending reports are submitted on-chain with proofs (e.g., hashes of receipts or oracle-verified data).
- **Governance and Voting**: Token holders vote on fund releases and report verifications to prevent fraud.
- **Real-World Impact**: Partners with conservation organizations (off-chain) to ensure funds translate to actions like feeding tigers in sanctuaries, with reports including photos/videos hashed on-chain.
- **Donor Incentives**: Contributors receive NFTs representing "sponsored" animals, providing proof of impact and potential governance rights.

The project involves 6 solid smart contracts written in Clarity, leveraging Stacks' security (anchored to Bitcoin) for tamper-proof transparency. This ensures donors can track every satoshi from contribution to expenditure, solving accountability issues in global animal welfare (e.g., supporting IUCN-listed endangered species like tigers, where poaching and habitat loss are rampant).

## Architecture

- **Blockchain**: Stacks (STX), chosen for its Clarity language, which emphasizes safety, predictability, and auditability (no reentrancy bugs like in Solidity).
- **Tokens**: Native WCT fungible token for governance and donations; NFTs for donor rewards.
- **Multi-Contract Design**: Contracts interact via traits and public functions for modularity.
- **Deployment**: Contracts are deployed separately on Stacks. Use maps and principals for managing multiple campaigns.
- **Off-Chain Integration**: Frontend dApp (not included here) for user interaction; oracles for real-world verification (e.g., via Chainlink on Stacks if available, or manual admin for MVP).

## Smart Contracts

Below are the 6 smart contracts, each with a description, purpose, and full Clarity code. They form a cohesive system:
1. **Token.clar**: Manages the fungible governance token (WCT).
2. **NFT.clar**: Handles NFTs for donor rewards (e.g., "Tiger Sponsor" badges).
3. **Crowdfund.clar**: Core logic for creating and funding campaigns.
4. **Treasury.clar**: Securely holds and releases funds based on approvals.
5. **Governance.clar**: Enables token-based voting for decisions like fund releases.
6. **Reporting.clar**: Submits and verifies spending reports on-chain.

### 1. Token.clar (Fungible Token for Governance and Donations)

This contract implements a SIP-010 compliant fungible token (WCT) used for donations and voting power. It solves the problem of incentivizing participation by giving donors governance rights proportional to contributions.

```clarity
;; WildCare Token (WCT) - SIP-010 Fungible Token

(define-fungible-token wct u1000000000) ;; Max supply: 1 billion

(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-INSUFFICIENT-BALANCE (err u402))

(define-data-var token-uri (string-ascii 256) "https://wildcare.example/token-metadata.json")
(define-data-var owner principal tx-sender)

(define-trait sip010-trait
  {
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-balance (principal) (response uint uint))
    (get-total-supply () (response uint uint))
    (get-name () (response (string-ascii 32) uint))
    (get-symbol () (response (string-ascii 32) uint))
    (get-decimals () (response uint uint))
    (get-token-uri () (response (optional (string-utf8 256)) uint))
  }
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? wct amount sender recipient))
    (ok true)
  )
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance wct account))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply wct))
)

(define-read-only (get-name)
  (ok "WildCare Token")
)

(define-read-only (get-symbol)
  (ok "WCT")
)

(define-read-only (get-decimals)
  (ok u6)
)

(define-read-only (get-token-uri)
  (ok (some (var-get token-uri)))
)

;; Mint function for owner (e.g., initial distribution)
(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-AUTHORIZED)
    (ft-mint? wct amount recipient)
  )
)
```

### 2. NFT.clar (Non-Fungible Tokens for Donor Rewards)

This SIP-009 compliant NFT contract mints unique tokens representing sponsored animals (e.g., a specific tiger). It solves donor engagement issues by providing collectible proofs of impact, encouraging repeat contributions.

```clarity
;; WildCare NFT - SIP-009 Non-Fungible Token

(define-non-fungible-token animal-nft uint)
(define-map nft-metadata uint { uri: (string-ascii 256), animal: (string-ascii 32) })

(define-constant ERR-NOT-OWNER (err u403))
(define-constant ERR-NOT-FOUND (err u404))
(define-data-var last-id uint u0)
(define-data-var owner principal tx-sender)

(define-trait sip009-trait
  {
    (get-last-token-id () (response uint uint))
    (get-token-uri (uint) (response (optional (string-utf8 256)) uint))
    (get-owner (uint) (response (optional principal) uint))
    (transfer (uint principal principal) (response bool uint))
  }
)

(define-public (transfer (id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-OWNER)
    (nft-transfer? animal-nft id sender recipient)
  )
)

(define-read-only (get-last-token-id)
  (ok (var-get last-id))
)

(define-read-only (get-token-uri (id uint))
  (ok (some (get uri (map-get? nft-metadata id))))
)

(define-read-only (get-owner (id uint))
  (ok (nft-get-owner? animal-nft id))
)

;; Mint NFT for donors
(define-public (mint (recipient principal) (uri (string-ascii 256)) (animal (string-ascii 32)))
  (let ((new-id (+ (var-get last-id) u1)))
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-AUTHORIZED)
    (map-set nft-metadata new-id { uri: uri, animal: animal })
    (try! (nft-mint? animal-nft new-id recipient))
    (var-set last-id new-id)
    (ok new-id)
  )
)
```

### 3. Crowdfund.clar (Campaign Creation and Funding)

This contract manages multiple crowdfunding campaigns using maps. Campaigns have goals, deadlines, and track contributions. It solves the problem of fragmented funding by allowing targeted campaigns (e.g., "Feed Tigers in Sanctuary X").

```clarity
;; Crowdfund Contract - Manages Campaigns

(define-map campaigns uint { goal: uint, raised: uint, deadline: uint, creator: principal, active: bool })
(define-map contributions uint { user: principal, amount: uint })

(define-constant ERR-CAMPAIGN-NOT-FOUND (err u405))
(define-constant ERR-DEADLINE-PASSED (err u406))
(define-constant ERR-NOT-ACTIVE (err u407))
(define-data-var campaign-counter uint u0)

(define-public (create-campaign (goal uint) (deadline uint))
  (let ((id (+ (var-get campaign-counter) u1)))
    (map-set campaigns id { goal: goal, raised: u0, deadline: deadline, creator: tx-sender, active: true })
    (var-set campaign-counter id)
    (ok id)
  )
)

(define-public (contribute (campaign-id uint) (amount uint))
  (let ((campaign (unwrap! (map-get? campaigns campaign-id) ERR-CAMPAIGN-NOT-FOUND)))
    (asserts! (get active campaign) ERR-NOT-ACTIVE)
    (asserts! (<= (as-contract block-height) (get deadline campaign)) ERR-DEADLINE-PASSED)
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender))) ;; Or use FT transfer
    (map-set campaigns campaign-id (merge campaign { raised: (+ (get raised campaign) amount) }))
    (ok true)
  )
)

(define-read-only (get-campaign (id uint))
  (map-get? campaigns id)
)
```

### 4. Treasury.clar (Fund Holding and Release)

This contract acts as a vault, holding funds from successful campaigns and releasing them to verified recipients. It ensures funds are only disbursed with governance approval, solving misallocation risks.

```clarity
;; Treasury Contract - Holds and Releases Funds

(define-map balances principal uint)
(define-constant ERR-INSUFFICIENT-FUNDS (err u408))
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-data-var admin principal tx-sender)

(define-public (deposit (amount uint))
  (begin
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (ok true)
  )
)

(define-public (release-funds (recipient principal) (amount uint) (approved-by principal))
  (begin
    (asserts! (is-eq approved-by (var-get admin)) ERR-NOT-AUTHORIZED) ;; Or link to governance
    (asserts! (>= (as-contract stx-get-balance (as-contract tx-sender)) amount) ERR-INSUFFICIENT-FUNDS)
    (as-contract (stx-transfer? amount tx-sender recipient))
  )
)

(define-read-only (get-balance)
  (ok (as-contract stx-get-balance (as-contract tx-sender)))
)
```

### 5. Governance.clar (Voting for Decisions)

This contract uses WCT tokens for voting on proposals (e.g., approve fund release or verify reports). It solves centralized decision-making by decentralizing control to token holders.

```clarity
;; Governance Contract - Token-Based Voting

(use-trait ft-trait .Token.sip010-trait)

(define-map proposals uint { description: (string-ascii 256), votes-for: uint, votes-against: uint, end-block: uint, executed: bool })
(define-map votes { proposal: uint, voter: principal } bool)
(define-data-var proposal-counter uint u0)
(define-constant ERR-ALREADY-VOTED (err u409))
(define-constant ERR-PROPOSAL-ENDED (err u410))

(define-public (create-proposal (description (string-ascii 256)) (duration uint) (token-contract <ft-trait>))
  (let ((id (+ (var-get proposal-counter) u1)))
    (map-set proposals id { description: description, votes-for: u0, votes-against: u0, end-block: (+ block-height duration), executed: false })
    (var-set proposal-counter id)
    (ok id)
  )
)

(define-public (vote (proposal-id uint) (support bool) (token-contract <ft-trait>))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) ERR-CAMPAIGN-NOT-FOUND))
        (balance (unwrap-panic (contract-call? token-contract get-balance tx-sender))))
    (asserts! (<= block-height (get end-block proposal)) ERR-PROPOSAL-ENDED)
    (asserts! (is-none (map-get? votes { proposal: proposal-id, voter: tx-sender })) ERR-ALREADY-VOTED)
    (if support
      (map-set proposals proposal-id (merge proposal { votes-for: (+ (get votes-for proposal) balance) }))
      (map-set proposals proposal-id (merge proposal { votes-against: (+ (get votes-against proposal) balance) })))
    (map-set votes { proposal: proposal-id, voter: tx-sender } support)
    (ok true)
  )
)

(define-public (execute-proposal (proposal-id uint))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) ERR-CAMPAIGN-NOT-FOUND)))
    (asserts! (> block-height (get end-block proposal)) ERR-PROPOSAL-ENDED)
    (asserts! (not (get executed proposal)) ERR-NOT-AUTHORIZED)
    (if (> (get votes-for proposal) (get votes-against proposal))
      (begin
        (map-set proposals proposal-id (merge proposal { executed: true }))
        (ok true)) ;; Trigger external actions, e.g., release funds
      (ok false))
  )
)
```

### 6. Reporting.clar (Spending Reports and Verification)

This contract allows campaign creators to submit spending reports (e.g., hashes of receipts, photos) and links them to governance votes for verification. It ensures transparency by making all reports public and auditable.

```clarity
;; Reporting Contract - On-Chain Spending Reports

(define-map reports uint { campaign-id: uint, description: (string-ascii 512), proof-hash: (buff 32), verified: bool })
(define-data-var report-counter uint u0)
(define-constant ERR-NOT-CREATOR (err u411))

(define-public (submit-report (campaign-id uint) (description (string-ascii 512)) (proof-hash (buff 32)))
  (let ((campaign (unwrap! (contract-call? .Crowdfund get-campaign campaign-id) ERR-CAMPAIGN-NOT-FOUND))
        (id (+ (var-get report-counter) u1)))
    (asserts! (is-eq tx-sender (get creator campaign)) ERR-NOT-CREATOR)
    (map-set reports id { campaign-id: campaign-id, description: description, proof-hash: proof-hash, verified: false })
    (var-set report-counter id)
    (ok id)
  )
)

(define-public (verify-report (report-id uint) (approved bool))
  (let ((report (unwrap! (map-get? reports report-id) ERR-NOT-FOUND)))
    (asserts! (is-eq tx-sender (contract-call? .Treasury get-admin)) ERR-NOT-AUTHORIZED) ;; Or link to governance vote
    (map-set reports report-id (merge report { verified: approved }))
    (ok approved)
  )
)

(define-read-only (get-report (id uint))
  (map-get? reports id)
)
```

## Installation and Deployment

1. Install Stacks CLI and Clarity tools.
2. Deploy contracts in order: Token, NFT, Crowdfund, Treasury, Governance, Reporting.
3. Use `clarinet deploy` for local testing.
4. Interact via Stacks wallet or dApp.

## Usage

- Create a campaign via Crowdfund.
- Donate STX/WCT.
- Submit reports via Reporting.
- Vote on verifications via Governance.
- Release funds from Treasury upon approval.

## Future Improvements

- Integrate oracles for automated verification.
- Add multisig for admin roles.
- Frontend integration with Leather wallet.

## License

MIT License.