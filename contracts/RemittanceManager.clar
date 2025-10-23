(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-RECIPIENT u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INVALID-CURRENCY u103)
(define-constant ERR-INVALID-RATE u104)
(define-constant ERR-KYC-NOT-VERIFIED u105)
(define-constant ERR-INSUFFICIENT-BALANCE u106)
(define-constant ERR-TRANSFER-FAILED u107)
(define-constant ERR-ESCROW-FAILED u108)
(define-constant ERR-INVALID-ESCROW-ID u109)
(define-constant ERR-ESCROW-NOT-PENDING u110)
(define-constant ERR-INVALID-FEE-RATE u111)
(define-constant ERR-INVALID-TIMESTAMP u112)
(define-constant ERR-AUTHORITY-NOT-SET u113)
(define-constant ERR-INVALID-MIN-AMOUNT u114)
(define-constant ERR-INVALID-MAX-AMOUNT u115)
(define-constant ERR-TRANSFER-ALREADY-EXISTS u116)
(define-constant ERR-TRANSFER-NOT-FOUND u117)
(define-constant ERR-INVALID-STATUS u118)
(define-constant ERR-INVALID-GRACE-PERIOD u119)
(define-constant ERR-INVALID-LOCATION u120)
(define-constant ERR-RECIPIENT-NOT-REGISTERED u121)
(define-constant ERR-SENDER-NOT-REGISTERED u122)
(define-constant ERR-INVALID-CONVERSION u123)
(define-constant ERR-FEE-CALCULATION-FAILED u124)
(define-constant ERR-REFUND-FAILED u125)

(define-data-var next-transfer-id uint u0)
(define-data-var max-transfers uint u10000)
(define-data-var transfer-fee-rate uint u1)
(define-data-var min-transfer-amount uint u100)
(define-data-var max-transfer-amount uint u1000000)
(define-data-var authority-contract (optional principal) none)
(define-data-var grace-period uint u144)

(define-map transfers
  uint
  {
    sender: principal,
    recipient: principal,
    amount-fiat: u128,
    currency: (string-ascii 3),
    amount-token: u128,
    fee: u128,
    timestamp: uint,
    status: (string-ascii 10),
    escrow-id: (optional uint),
    location-sender: (string-utf8 100),
    location-recipient: (string-utf8 100)
  }
)

(define-map transfers-by-sender
  principal
  (list 100 uint))

(define-map transfers-by-recipient
  principal
  (list 100 uint))

(define-constant user-registry 'SP000000000000000000002Q6VF78.byzantion-user-registry)
(define-constant stable-token 'SP000000000000000000002Q6VF78.byzantion-stable-token)
(define-constant oracle 'SP000000000000000000002Q6VF78.byzantion-exchange-oracle)
(define-constant escrow 'SP000000000000000000002Q6VF78.byzantion-transfer-escrow)

(define-read-only (get-transfer (id uint))
  (map-get? transfers id))

(define-read-only (get-transfers-by-sender (sender principal))
  (default-to (list) (map-get? transfers-by-sender sender)))

(define-read-only (get-transfers-by-recipient (recipient principal))
  (default-to (list) (map-get? transfers-by-recipient recipient)))

(define-read-only (get-next-transfer-id)
  (var-get next-transfer-id))

(define-read-only (get-transfer-fee-rate)
  (var-get transfer-fee-rate))

(define-read-only (get-min-transfer-amount)
  (var-get min-transfer-amount))

(define-read-only (get-max-transfer-amount)
  (var-get max-transfer-amount))

(define-private (validate-recipient (recipient principal))
  (if (not (is-eq recipient tx-sender))
      (ok true)
      (err ERR-INVALID-RECIPIENT)))

(define-private (validate-amount-fiat (amount u128))
  (let ((min (var-get min-transfer-amount))
        (max (var-get max-transfer-amount)))
    (if (and (>= amount min) (<= amount max))
      (ok true)
      (err ERR-INVALID-AMOUNT))))

(define-private (validate-currency (currency (string-ascii 3)))
  (if (or (is-eq currency "USD") (is-eq currency "EUR") (is-eq currency "GBP"))
      (ok true)
      (err ERR-INVALID-CURRENCY)))

(define-private (validate-rate (rate u128))
  (if (> rate u0)
      (ok true)
      (err ERR-INVALID-RATE)))

(define-private (validate-kyc (user principal))
  (let ((user-info (unwrap! (contract-call? user-registry get-user-info user) (err ERR-SENDER-NOT-REGISTERED))))
    (if (get kyc-verified user-info)
      (ok true)
      (err ERR-KYC-NOT-VERIFIED))))

(define-private (validate-balance (user principal) (amount u128))
  (let ((balance (unwrap! (contract-call? stable-token get-balance user) (err ERR-INSUFFICIENT-BALANCE))))
    (if (>= balance amount)
      (ok true)
      (err ERR-INSUFFICIENT-BALANCE))))

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP)))

(define-private (validate-status (status (string-ascii 10)))
  (if (or (is-eq status "pending") (is-eq status "completed") (is-eq status "cancelled"))
      (ok true)
      (err ERR-INVALID-STATUS)))

(define-private (validate-grace-period (period uint))
  (if (<= period u144)
      (ok true)
      (err ERR-INVALID-GRACE-PERIOD)))

(define-private (validate-location (loc (string-utf8 100)))
  (if (and (> (len loc) u0) (<= (len loc) u100))
      (ok true)
      (err ERR-INVALID-LOCATION)))

(define-private (calculate-fee (amount u128))
  (let ((rate (var-get transfer-fee-rate)))
    (ok (/ (* amount rate) u100))))

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-eq tx-sender contract-principal) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (var-set authority-contract (some contract-principal))
    (ok true)))

(define-public (set-transfer-fee-rate (new-rate uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (asserts! (<= new-rate u5) (err ERR-INVALID-FEE-RATE))
    (var-set transfer-fee-rate new-rate)
    (ok true)))

(define-public (set-min-transfer-amount (new-min uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (asserts! (> new-min u0) (err ERR-INVALID-MIN-AMOUNT))
    (var-set min-transfer-amount new-min)
    (ok true)))

(define-public (set-max-transfer-amount (new-max uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (asserts! (> new-max (var-get min-transfer-amount)) (err ERR-INVALID-MAX-AMOUNT))
    (var-set max-transfer-amount new-max)
    (ok true)))

(define-public (set-grace-period (new-period uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (try! (validate-grace-period new-period))
    (var-set grace-period new-period)
    (ok true)))

(define-public (initiate-transfer 
  (recipient principal) 
  (amount-fiat u128) 
  (currency (string-ascii 3))
  (location-sender (string-utf8 100))
  (location-recipient (string-utf8 100)))
  (let ((next-id (var-get next-transfer-id))
        (rate (unwrap! (contract-call? oracle get-rate currency) (err ERR-INVALID-RATE)))
        (amount-token (/ (* amount-fiat u1000000) rate))
        (fee (unwrap! (calculate-fee amount-fiat) (err ERR-FEE-CALCULATION-FAILED)))
        (total-token (+ amount-token fee)))
    (asserts! (< next-id (var-get max-transfers)) (err ERR-TRANSFER-ALREADY-EXISTS))
    (try! (validate-recipient recipient))
    (try! (validate-amount-fiat amount-fiat))
    (try! (validate-currency currency))
    (try! (validate-rate rate))
    (try! (validate-kyc tx-sender))
    (try! (validate-kyc recipient))
    (try! (validate-balance tx-sender total-token))
    (try! (validate-location location-sender))
    (try! (validate-location location-recipient))
    (try! (contract-call? stable-token transfer total-token tx-sender (as-contract tx-sender)))
    (let ((escrow-id (unwrap! (as-contract (contract-call? escrow create-escrow recipient amount-token currency)) (err ERR-ESCROW-FAILED))))
      (map-set transfers next-id
        {
          sender: tx-sender,
          recipient: recipient,
          amount-fiat: amount-fiat,
          currency: currency,
          amount-token: amount-token,
          fee: fee,
          timestamp: block-height,
          status: "pending",
          escrow-id: (some escrow-id),
          location-sender: location-sender,
          location-recipient: location-recipient
        })
      (map-set transfers-by-sender tx-sender (append (get-transfers-by-sender tx-sender) next-id))
      (map-set transfers-by-recipient recipient (append (get-transfers-by-recipient recipient) next-id))
      (var-set next-transfer-id (+ next-id u1))
      (print { event: "transfer-initiated", id: next-id })
      (ok next-id))))

(define-public (complete-transfer (transfer-id uint))
  (let ((transfer (unwrap! (map-get? transfers transfer-id) (err ERR-TRANSFER-NOT-FOUND)))
        (escrow-id (unwrap! (get escrow-id transfer) (err ERR-INVALID-ESCROW-ID))))
    (asserts! (is-eq (get sender transfer) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status transfer) "pending") (err ERR-ESCROW-NOT-PENDING))
    (try! (as-contract (contract-call? escrow release-escrow escrow-id)))
    (map-set transfers transfer-id (merge transfer { status: "completed" }))
    (print { event: "transfer-completed", id: transfer-id })
    (ok true)))

(define-public (cancel-transfer (transfer-id uint))
  (let ((transfer (unwrap! (map-get? transfers transfer-id) (err ERR-TRANSFER-NOT-FOUND)))
        (escrow-id (unwrap! (get escrow-id transfer) (err ERR-INVALID-ESCROW-ID)))
        (total-refund (+ (get amount-token transfer) (get fee transfer))))
    (asserts! (is-eq (get sender transfer) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status transfer) "pending") (err ERR-ESCROW-NOT-PENDING))
    (asserts! (< (- block-height (get timestamp transfer)) (var-get grace-period)) (err ERR-INVALID-GRACE-PERIOD))
    (try! (as-contract (contract-call? escrow cancel-escrow escrow-id)))
    (try! (as-contract (contract-call? stable-token transfer total-refund tx-sender (get sender transfer))))
    (map-set transfers transfer-id (merge transfer { status: "cancelled" }))
    (print { event: "transfer-cancelled", id: transfer-id })
    (ok true)))

(define-public (get-transfer-status (id uint))
  (let ((transfer (map-get? transfers id)))
    (match transfer
      t (ok (get status t))
      (err ERR-TRANSFER-NOT-FOUND))))

(define-public (update-transfer-location 
  (id uint) 
  (new-location-sender (string-utf8 100)) 
  (new-location-recipient (string-utf8 100)))
  (let ((transfer (unwrap! (map-get? transfers id) (err ERR-TRANSFER-NOT-FOUND))))
    (asserts! (is-eq (get sender transfer) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status transfer) "pending") (err ERR-INVALID-STATUS))
    (try! (validate-location new-location-sender))
    (try! (validate-location new-location-recipient))
    (map-set transfers id 
      (merge transfer 
        { 
          location-sender: new-location-sender, 
          location-recipient: new-location-recipient 
        }))
    (ok true)))