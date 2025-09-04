;; WildCare Token (WCT) - Advanced SIP-010 Fungible Token with Governance Features

(define-fungible-token wct u1000000000) ;; Max supply: 1 billion

(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-INSUFFICIENT-BALANCE (err u402))
(define-constant ERR-PAUSED (err u403))
(define-constant ERR-BLACKLISTED (err u404))
(define-constant ERR-INVALID-AMOUNT (err u405))
(define-constant ERR-INVALID-RECIPIENT (err u406))
(define-constant ERR-MAX-SUPPLY-REACHED (err u407))
(define-constant ERR-ALREADY-INITIALIZED (err u408))
(define-constant ERR-NOT-ADMIN (err u409))
(define-constant ERR-NOT-MINTER (err u410))
(define-constant ERR-METADATA-TOO-LONG (err u411))
(define-constant ERR-INVALID-ROLE (err u412))

(define-data-var token-uri (string-utf8 256) u"https://wildcare.example/token-metadata.json")
(define-data-var owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var total-supply uint u0)
(define-data-var max-supply uint u1000000000)
(define-data-var admin principal tx-sender)
(define-data-var mint-cap uint u100000000) ;; Per mint cap for safety

(define-map minters principal bool)
(define-map blacklisted principal bool)
(define-map roles { user: principal, role: (string-ascii 32) } bool)
(define-map mint-history uint { minter: principal, amount: uint, recipient: principal, timestamp: uint })
(define-data-var mint-counter uint u0)

(define-map allowances { owner: principal, spender: principal } uint)

(define-trait sip010-trait
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-balance (principal) (response uint uint))
    (get-total-supply () (response uint uint))
    (get-name () (response (string-ascii 32) uint))
    (get-symbol () (response (string-ascii 32) uint))
    (get-decimals () (response uint uint))
    (get-token-uri () (response (optional (string-utf8 256)) uint))
  )
)

;; Initialization function (call once)
(define-public (initialize (initial-admin principal) (initial-uri (string-utf8 256)))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (var-get admin) tx-sender) ERR-ALREADY-INITIALIZED)
    (var-set admin initial-admin)
    (var-set token-uri initial-uri)
    (map-set minters initial-admin true)
    (ok true)
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (asserts! (not (default-to false (map-get? blacklisted recipient))) ERR-BLACKLISTED)
    (asserts! (>= (ft-get-balance wct sender) amount) ERR-INSUFFICIENT-BALANCE)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) ERR-INVALID-RECIPIENT) ;; Example invalid
    (try! (ft-transfer? wct amount sender recipient))
    (match memo some-memo (print { event: "transfer", memo: some-memo }) true)
    (ok true)
  )
)

(define-public (transfer-from (amount uint) (owner principal) (recipient principal) (spender principal))
  (let ((allowance (default-to u0 (map-get? allowances { owner: owner, spender: spender }))))
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (is-eq tx-sender spender) ERR-NOT-AUTHORIZED)
    (asserts! (>= allowance amount) ERR-INSUFFICIENT-BALANCE)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (try! (ft-transfer? wct amount owner recipient))
    (map-set allowances { owner: owner, spender: spender } (- allowance amount))
    (ok true)
  )
)

(define-public (approve (spender principal) (amount uint))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (map-set allowances { owner: tx-sender, spender: spender } amount)
    (ok true)
  )
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance wct account))
)

(define-read-only (get-total-supply)
  (ok (var-get total-supply))
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

(define-public (mint (amount uint) (recipient principal) (metadata (string-utf8 256)))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (default-to false (map-get? minters tx-sender)) ERR-NOT-MINTER)
    (asserts! (<= amount (var-get mint-cap)) ERR-INVALID-AMOUNT)
    (asserts! (<= (+ (var-get total-supply) amount) (var-get max-supply)) ERR-MAX-SUPPLY-REACHED)
    (asserts! (<= (len metadata) u256) ERR-METADATA-TOO-LONG)
    (try! (ft-mint? wct amount recipient))
    (var-set total-supply (+ (var-get total-supply) amount))
    (let ((id (+ (var-get mint-counter) u1)))
      (map-set mint-history id { minter: tx-sender, amount: amount, recipient: recipient, timestamp: block-height })
      (var-set mint-counter id)
    )
    (print { event: "mint", amount: amount, recipient: recipient, metadata: metadata })
    (ok true)
  )
)

(define-public (burn (amount uint))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (>= (ft-get-balance wct tx-sender) amount) ERR-INSUFFICIENT-BALANCE)
    (try! (ft-burn? wct amount tx-sender))
    (var-set total-supply (- (var-get total-supply) amount))
    (print { event: "burn", amount: amount, sender: tx-sender })
    (ok true)
  )
)

(define-public (pause)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (var-set paused false)
    (ok true)
  )
)

(define-public (add-minter (new-minter principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (map-set minters new-minter true)
    (ok true)
  )
)

(define-public (remove-minter (minter principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (map-set minters minter false)
    (ok true)
  )
)

(define-public (blacklist (account principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (map-set blacklisted account true)
    (ok true)
  )
)

(define-public (unblacklist (account principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (map-set blacklisted account false)
    (ok true)
  )
)

(define-public (set-mint-cap (new-cap uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (var-set mint-cap new-cap)
    (ok true)
  )
)

(define-public (assign-role (user principal) (role (string-ascii 32)))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (asserts! (or (is-eq role "admin") (is-eq role "minter") (is-eq role "auditor")) ERR-INVALID-ROLE)
    (map-set roles { user: user, role: role } true)
    (ok true)
  )
)

(define-public (revoke-role (user principal) (role (string-ascii 32)))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (map-delete roles { user: user, role: role })
    (ok true)
  )
)

(define-read-only (has-role (user principal) (role (string-ascii 32)))
  (ok (default-to false (map-get? roles { user: user, role: role })))
)

(define-read-only (get-mint-history (id uint))
  (map-get? mint-history id)
)

(define-read-only (is-paused)
  (ok (var-get paused))
)

(define-read-only (is-minter (account principal))
  (ok (default-to false (map-get? minters account)))
)

(define-read-only (is-blacklisted (account principal))
  (ok (default-to false (map-get? blacklisted account)))
)

(define-read-only (get-allowance (owner principal) (spender principal))
  (ok (default-to u0 (map-get? allowances { owner: owner, spender: spender })))
)