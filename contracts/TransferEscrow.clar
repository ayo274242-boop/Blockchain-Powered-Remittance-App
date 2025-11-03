(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INVALID-CURRENCY u102)
(define-constant ERR-ESCROW-ALREADY-EXISTS u103)
(define-constant ERR-ESCROW-NOT-FOUND u104)
(define-constant ERR-INVALID-STATUS u105)
(define-constant ERR-INVALID-TIMESTAMP u106)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u107)
(define-constant ERR-INVALID-FEE u108)
(define-constant ERR-MAX-ESCROWS-EXCEEDED u109)
(define-constant ERR-INVALID-RECIPIENT u110)
(define-constant ERR-DISPUTE-ACTIVE u111)
(define-constant ERR-RESOLUTION-REQUIRED u112)
(define-constant ERR-INVALID-DISPUTE-RESOLUTION u113)
(define-constant ERR-TIMEOUT-EXPIRED u114)

(define-data-var next-escrow-id uint u0)
(define-data-var max-escrows uint u5000)
(define-data-var creation-fee uint u500)
(define-data-var dispute-timeout uint u144) ;; 24 hours in blocks approx
(define-data-var authority-contract (optional principal) none)

(define-map escrows
  uint
  {
    sender: principal,
    recipient: principal,
    amount: uint,
    currency: (string-ascii 3),
    status: (string-ascii 10),
    timestamp: uint,
    fee: uint,
    dispute-status: (string-ascii 10),
    resolver: (optional principal)
  }
)

(define-map escrows-by-sender-recipient
  { sender: principal, recipient: principal }
  uint
)

(define-map dispute-resolutions
  uint
  {
    resolution: (string-ascii 20),
    resolved-by: principal,
    resolution-timestamp: uint
  }
)

(define-read-only (get-escrow (id uint))
  (map-get? escrows id)
)

(define-read-only (get-dispute-resolution (id uint))
  (map-get? dispute-resolutions id)
)

(define-read-only (is-escrow-registered (sender principal) (recipient principal))
  (is-some (map-get? escrows-by-sender-recipient { sender: sender, recipient: recipient }))
)

(define-read-only (get-escrow-count)
  (var-get next-escrow-id)
)

(define-private (validate-amount (amt uint))
  (if (> amt u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)

(define-private (validate-currency (cur (string-ascii 3)))
  (if (or (is-eq cur "USD") (is-eq cur "EUR") (is-eq cur "STX"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-private (validate-status (st (string-ascii 10)))
  (if (or (is-eq st "pending") (is-eq st "released") (is-eq st "cancelled") (is-eq st "disputed"))
      (ok true)
      (err ERR-INVALID-STATUS))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-fee (fee uint))
  (if (>= fee u0)
      (ok true)
      (err ERR-INVALID-FEE))
)

(define-private (validate-recipient (rec principal))
  (if (not (is-eq rec tx-sender))
      (ok true)
      (err ERR-INVALID-RECIPIENT))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-private (check-dispute-eligible (escrow (tuple (status (string-ascii 10)) timestamp uint)))
  (let ((age (- block-height (get timestamp escrow))))
    (if (and (is-eq (get status escrow) "pending") (<= age (var-get dispute-timeout)))
        (ok true)
        (err ERR-DISPUTE-ACTIVE))
  )
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-escrows (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-FEE))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-escrows new-max)
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (try! (validate-fee new-fee))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (set-dispute-timeout (new-timeout uint))
  (begin
    (asserts! (> new-timeout u0) (err ERR-INVALID-FEE))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set dispute-timeout new-timeout)
    (ok true)
  )
)

(define-public (create-escrow
  (recipient principal)
  (amount uint)
  (currency (string-ascii 3))
  (fee uint)
)
  (let (
        (next-id (var-get next-escrow-id))
        (current-max (var-get max-escrows))
        (authority (var-get authority-contract))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-ESCROWS-EXCEEDED))
    (try! (validate-amount amount))
    (try! (validate-currency currency))
    (try! (validate-fee fee))
    (try! (validate-recipient recipient))
    (asserts! (is-none (map-get? escrows-by-sender-recipient { sender: tx-sender, recipient: recipient })) (err ERR-ESCROW-ALREADY-EXISTS))
    (asserts! (is-some authority) (err ERR-AUTHORITY-NOT-VERIFIED))
    (let ((authority-recipient (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get creation-fee) tx-sender authority-recipient))
    )
    (map-set escrows next-id
      {
        sender: tx-sender,
        recipient: recipient,
        amount: amount,
        currency: currency,
        status: "pending",
        timestamp: block-height,
        fee: fee,
        dispute-status: "none",
        resolver: none
      }
    )
    (map-set escrows-by-sender-recipient { sender: tx-sender, recipient: recipient } next-id)
    (var-set next-escrow-id (+ next-id u1))
    (print { event: "escrow-created", id: next-id })
    (ok next-id)
  )
)

(define-public (release-escrow (escrow-id uint))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND))))
    (try! (validate-status (get status escrow)))
    (asserts! (is-eq (get status escrow) "pending") (err ERR-INVALID-STATUS))
    (asserts! (or (is-eq tx-sender (get sender escrow)) (is-eq tx-sender (get recipient escrow))) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get dispute-status escrow) "none") (err ERR-DISPUTE-ACTIVE))
    (map-set escrows escrow-id (merge escrow { status: "released" }))
    (print { event: "escrow-released", id: escrow-id })
    (ok true)
  )
)

(define-public (cancel-escrow (escrow-id uint))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND))))
    (try! (validate-status (get status escrow)))
    (asserts! (is-eq (get status escrow) "pending") (err ERR-INVALID-STATUS))
    (asserts! (is-eq tx-sender (get sender escrow)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get dispute-status escrow) "none") (err ERR-DISPUTE-ACTIVE))
    (map-set escrows escrow-id (merge escrow { status: "cancelled" }))
    (print { event: "escrow-cancelled", id: escrow-id })
    (ok true)
  )
)

(define-public (dispute-escrow (escrow-id uint))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND))))
    (try! (check-dispute-eligible escrow))
    (asserts! (or (is-eq tx-sender (get sender escrow)) (is-eq tx-sender (get recipient escrow))) (err ERR-NOT-AUTHORIZED))
    (map-set escrows escrow-id (merge escrow { dispute-status: "active", resolver: (some tx-sender) }))
    (print { event: "escrow-disputed", id: escrow-id })
    (ok true)
  )
)

(define-public (resolve-dispute (escrow-id uint) (resolution (string-ascii 20)))
  (let (
        (escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND)))
        (dispute-res (map-get? dispute-resolutions escrow-id))
      )
    (asserts! (is-eq (get dispute-status escrow) "active") (err ERR-RESOLUTION-REQUIRED))
    (asserts! (is-some (get resolver escrow)) (err ERR-INVALID-DISPUTE-RESOLUTION))
    (asserts! (is-eq tx-sender (unwrap! (get resolver escrow) (err u0))) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none dispute-res) (err ERR-INVALID-DISPUTE-RESOLUTION))
    (if (is-eq resolution "release")
        (map-set escrows escrow-id (merge escrow { status: "released", dispute-status: "resolved" }))
        (if (is-eq resolution "cancel")
            (map-set escrows escrow-id (merge escrow { status: "cancelled", dispute-status: "resolved" }))
            (err ERR-INVALID-DISPUTE-RESOLUTION)
        )
    )
    (map-set dispute-resolutions escrow-id
      {
        resolution: resolution,
        resolved-by: tx-sender,
        resolution-timestamp: block-height
      }
    )
    (print { event: "dispute-resolved", id: escrow-id, resolution: resolution })
    (ok true)
  )
)

(define-public (check-escrow-existence (sender principal) (recipient principal))
  (ok (is-escrow-registered sender recipient))
)

(define-public (timeout-escrow (escrow-id uint))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND))))
    (let ((age (- block-height (get timestamp escrow))))
      (if (> age (var-get dispute-timeout))
          (begin
            (map-set escrows escrow-id (merge escrow { status: "cancelled" }))
            (print { event: "escrow-timed-out", id: escrow-id })
            (ok true)
          )
          (err ERR-TIMEOUT-EXPIRED)
      )
    )
  )
)