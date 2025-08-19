;; LandToken Contract
;; Clarity v2
;; Implements fungible token for fractional land ownership with locking, compliance, and admin controls

;; Error codes
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INSUFFICIENT-BALANCE u101)
(define-constant ERR-LOCKED-TOKENS u102)
(define-constant ERR-MAX-SUPPLY-REACHED u103)
(define-constant ERR-PAUSED u104)
(define-constant ERR-ZERO-ADDRESS u105)
(define-constant ERR-INVALID-PARCEL u106)
(define-constant ERR-TRANSFER-RESTRICTED u107)
(define-constant ERR-ALREADY-LOCKED u108)

;; Token metadata
(define-constant TOKEN-NAME "LandTrust Token")
(define-constant TOKEN-SYMBOL "LAND")
(define-constant TOKEN-DECIMALS u8)
(define-constant MAX-SUPPLY u10000000000000000) ;; 10T tokens (8 decimals)

;; Contract state
(define-data-var admin principal tx-sender)
(define-data-var paused bool false)
(define-data-var total-supply uint u0)
(define-data-var compliance-officer principal tx-sender)
(define-data-var transfer-restriction-enabled bool true)

;; Data maps
(define-map balances { owner: principal, parcel-id: uint } uint)
(define-map locked-balances { owner: principal, parcel-id: uint } { amount: uint, unlock-height: uint })
(define-map parcel-metadata uint { legal-id: (string-ascii 64), registered: bool, jurisdiction: (string-ascii 32) })
(define-map approved-transferees principal bool)

;; Private helper: is-admin
(define-private (is-admin)
  (is-eq tx-sender (var-get admin)))

;; Private helper: is-compliance-officer
(define-private (is-compliance-officer)
  (is-eq tx-sender (var-get compliance-officer)))

;; Private helper: ensure not paused
(define-private (ensure-not-paused)
  (asserts! (not (var-get paused)) (err ERR-PAUSED)))

;; Private helper: check valid parcel
(define-private (check-valid-parcel (parcel-id uint))
  (let ((metadata (default-to { legal-id: "", registered: false, jurisdiction: "" } (map-get? parcel-metadata parcel-id))))
    (asserts! (get registered metadata) (err ERR-INVALID-PARCEL))))

;; Transfer admin rights
(define-public (transfer-admin (new-admin principal))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq new-admin 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (var-set admin new-admin)
    (ok true)))

;; Set compliance officer
(define-public (set-compliance-officer (new-officer principal))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq new-officer 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (var-set compliance-officer new-officer)
    (ok true)))

;; Pause/unpause contract
(define-public (set-paused (pause bool))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (var-set paused pause)
    (ok pause)))

;; Toggle transfer restrictions
(define-public (set-transfer-restriction (enabled bool))
  (begin
    (asserts! (is-compliance-officer) (err ERR-NOT-AUTHORIZED))
    (var-set transfer-restriction-enabled enabled)
    (ok true)))

;; Register a land parcel
(define-public (register-parcel (parcel-id uint) (legal-id (string-ascii 64)) (jurisdiction (string-ascii 32)))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none? (map-get? parcel-metadata parcel-id)) (err ERR-INVALID-PARCEL))
    (map-set parcel-metadata parcel-id { legal-id: legal-id, registered: true, jurisdiction: jurisdiction })
    (ok true)))

;; Approve transferee for compliance
(define-public (approve-transferee (transferee principal))
  (begin
    (asserts! (is-compliance-officer) (err ERR-NOT-AUTHORIZED))
    (map-set approved-transferees transferee true)
    (ok true)))

;; Mint tokens for a parcel
(define-public (mint (recipient principal) (parcel-id uint) (amount uint))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (check-valid-parcel parcel-id)
    (let ((new-supply (+ (var-get total-supply) amount)))
      (asserts! (<= new-supply MAX-SUPPLY) (err ERR-MAX-SUPPLY-REACHED))
      (map-set balances { owner: recipient, parcel-id: parcel-id }
        (+ amount (default-to u0 (map-get? balances { owner: recipient, parcel-id: parcel-id }))))
      (var-set total-supply new-supply)
      (ok true))))

;; Burn tokens
(define-public (burn (parcel-id uint) (amount uint))
  (begin
    (ensure-not-paused)
    (check-valid-parcel parcel-id)
    (let ((balance (default-to u0 (map-get? balances { owner: tx-sender, parcel-id: parcel-id }))))
      (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
      (asserts! (is-none? (map-get? locked-balances { owner: tx-sender, parcel-id: parcel-id })) (err ERR-LOCKED-TOKENS))
      (map-set balances { owner: tx-sender, parcel-id: parcel-id } (- balance amount))
      (var-set total-supply (- (var-get total-supply) amount))
      (ok true))))

;; Transfer tokens
(define-public (transfer (recipient principal) (parcel-id uint) (amount uint))
  (begin
    (ensure-not-paused)
    (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (check-valid-parcel parcel-id)
    (asserts! (or (not (var-get transfer-restriction-enabled)) (default-to false (map-get? approved-transferees recipient)))
      (err ERR-TRANSFER-RESTRICTED))
    (let ((sender-balance (default-to u0 (map-get? balances { owner: tx-sender, parcel-id: parcel-id }))))
      (asserts! (>= sender-balance amount) (err ERR-INSUFFICIENT-BALANCE))
      (asserts! (is-none? (map-get? locked-balances { owner: tx-sender, parcel-id: parcel-id })) (err ERR-LOCKED-TOKENS))
      (map-set balances { owner: tx-sender, parcel-id: parcel-id } (- sender-balance amount))
      (map-set balances { owner: recipient, parcel-id: parcel-id }
        (+ amount (default-to u0 (map-get? balances { owner: recipient, parcel-id: parcel-id }))))
      (ok true))))

;; Lock tokens for regulatory compliance
(define-public (lock-tokens (parcel-id uint) (amount uint) (unlock-height uint))
  (begin
    (ensure-not-paused)
    (check-valid-parcel parcel-id)
    (let ((balance (default-to u0 (map-get? balances { owner: tx-sender, parcel-id: parcel-id }))))
      (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
      (asserts! (is-none? (map-get? locked-balances { owner: tx-sender, parcel-id: parcel-id })) (err ERR-ALREADY-LOCKED))
      (map-set balances { owner: tx-sender, parcel-id: parcel-id } (- balance amount))
      (map-set locked-balances { owner: tx-sender, parcel-id: parcel-id } { amount: amount, unlock-height: unlock-height })
      (ok true))))

;; Unlock tokens after lock period
(define-public (unlock-tokens (parcel-id uint))
  (begin
    (ensure-not-paused)
    (check-valid-parcel parcel-id)
    (let ((locked (default-to { amount: u0, unlock-height: u0 } (map-get? locked-balances { owner: tx-sender, parcel-id: parcel-id }))))
      (asserts! (> (get amount locked) u0) (err ERR-LOCKED-TOKENS))
      (asserts! (>= block-height (get unlock-height locked)) (err ERR-LOCKED-TOKENS))
      (map-set balances { owner: tx-sender, parcel-id: parcel-id }
        (+ (get amount locked) (default-to u0 (map-get? balances { owner: tx-sender, parcel-id: parcel-id }))))
      (map-delete locked-balances { owner: tx-sender, parcel-id: parcel-id })
      (ok true))))

;; Read-only: get balance
(define-read-only (get-balance (account principal) (parcel-id uint))
  (ok (default-to u0 (map-get? balances { owner: account, parcel-id: parcel-id }))))

;; Read-only: get locked balance
(define-read-only (get-locked-balance (account principal) (parcel-id uint))
  (ok (default-to { amount: u0, unlock-height: u0 } (map-get? locked-balances { owner: account, parcel-id: parcel-id }))))

;; Read-only: get total supply
(define-read-only (get-total-supply)
  (ok (var-get total-supply)))

;; Read-only: get parcel metadata
(define-read-only (get-parcel-metadata (parcel-id uint))
  (ok (default-to { legal-id: "", registered: false, jurisdiction: "" } (map-get? parcel-metadata parcel-id))))

;; Read-only: get admin
(define-read-only (get-admin)
  (ok (var-get admin)))

;; Read-only: get compliance officer
(define-read-only (get-compliance-officer)
  (ok (var-get compliance-officer)))

;; Read-only: check if paused
(define-read-only (is-paused)
  (ok (var-get paused)))

;; Read-only: check transfer restrictions
(define-read-only (is-transfer-restricted)
  (ok (var-get transfer-restriction-enabled)))

;; Read-only: check if transferee is approved
(define-read-only (is-approved-transferee (account principal))
  (ok (default-to false (map-get? approved-transferees account))))