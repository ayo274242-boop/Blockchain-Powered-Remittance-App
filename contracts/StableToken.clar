(define-trait fungible-token-trait
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
  )
)

(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INSUFFICIENT-BALANCE u101)
(define-constant ERR-TRANSFER-FAILED u102)
(define-constant ERR-BURN-FAILED u103)
(define-constant ERR-MINT-FAILED u104)
(define-constant ERR-INVALID-AMOUNT u105)
(define-constant ERR-NOT-OWNER u106)
(define-constant ERR-PAUSED u107)
(define-constant ERR-ALREADY-PAUSED u108)
(define-constant ERR-NOT-PAUSED u109)
(define-constant ERR-INVALID-RECIPIENT u110)
(define-constant ERR-INVALID-DECIMALS u111)
(define-constant ERR-SUPPLY-CAP-REACHED u112)
(define-constant ERR-ZERO-ADDRESS u113)
(define-constant ERR-INVALID-METADATA u114)

(define-constant TOKEN-NAME "Seamless USD")
(define-constant TOKEN-SYMBOL "sUSD")
(define-constant TOKEN-DECIMALS u6)
(define-constant MAX-SUPPLY u1000000000000000)
(define-constant ONE-TOKEN u1000000)

(define-fungible-token sUSD MAX-SUPPLY)

(define-data-var token-owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var total-minted uint u0)
(define-data-var metadata-uri (string-ascii 256) "https://api.seamlessremit.io/metadata/susd.json")

(define-map minters principal bool)
(define-map burners principal bool)
(define-map pausers principal bool)

(define-read-only (get-name)
  (ok TOKEN-NAME)
)

(define-read-only (get-symbol)
  (ok TOKEN-SYMBOL)
)

(define-read-only (get-decimals)
  (ok TOKEN-DECIMALS)
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply sUSD))
)

(define-read-only (get-balance-of (account principal))
  (ok (ft-get-balance sUSD account))
)

(define-read-only (get-max-supply)
  (ok MAX-SUPPLY)
)

(define-read-only (get-token-uri)
  (ok (some (var-get metadata-uri)))
)

(define-read-only (is-paused)
  (ok (var-get paused))
)

(define-read-only (is-minter (account principal))
  (ok (default-to false (map-get? minters account)))
)

(define-read-only (is-burner (account principal))
  (ok (default-to false (map-get? burners account)))
)

(define-read-only (is-pauser (account principal))
  (ok (default-to false (map-get? pausers account)))
)

(define-private (assert-not-paused)
  (asserts! (not (var-get paused)) (err ERR-PAUSED))
)

(define-private (assert-valid-amount (amount uint))
  (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
)

(define-private (assert-valid-recipient (recipient principal))
  (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
)

(define-private (assert-owner)
  (asserts! (is-eq tx-sender (var-get token-owner)) (err ERR-NOT-OWNER))
)

(define-private (assert-minter)
  (asserts! (default-to false (map-get? minters tx-sender)) (err ERR-UNAUTHORIZED))
)

(define-private (assert-burner)
  (asserts! (default-to false (map-get? burners tx-sender)) (err ERR-UNAUTHORIZED))
)

(define-private (assert-pauser)
  (asserts! (default-to false (map-get? pausers tx-sender)) (err ERR-UNAUTHORIZED))
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (let (
      (sender-balance (ft-get-balance sUSD sender))
    )
    (try! (assert-not-paused))
    (try! (assert-valid-amount amount))
    (try! (assert-valid-recipient recipient))
    (asserts! (is-eq tx-sender sender) (err ERR-UNAUTHORIZED))
    (asserts! (>= sender-balance amount) (err ERR-INSUFFICIENT-BALANCE))
    (match (ft-transfer? sUSD amount sender recipient)
      success (begin
        (match memo data (print { event: "transfer-memo", memo: data }) (begin))
        (ok success)
      )
      error (err ERR-TRANSFER-FAILED)
    )
  )
)

(define-public (mint (amount uint) (recipient principal))
  (let (
      (new-total (+ (var-get total-minted) amount))
    )
    (try! (assert-not-paused))
    (try! (assert-minter))
    (try! (assert-valid-amount amount))
    (try! (assert-valid-recipient recipient))
    (asserts! (<= new-total MAX-SUPPLY) (err ERR-SUPPLY-CAP-REACHED))
    (match (ft-mint? sUSD amount recipient)
      success (begin
        (var-set total-minted new-total)
        (ok success)
      )
      error (err ERR-MINT-FAILED)
    )
  )
)

(define-public (burn (amount uint))
  (begin
    (try! (assert-not-paused))
    (try! (assert-burner))
    (try! (assert-valid-amount amount))
    (match (ft-burn? sUSD amount tx-sender)
      success (ok success)
      error (err ERR-BURN-FAILED)
    )
  )
)

(define-public (pause)
  (begin
    (try! (assert-pauser))
    (asserts! (not (var-get paused)) (err ERR-ALREADY-PAUSED))
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause)
  (begin
    (try! (assert-pauser))
    (asserts! (var-get paused) (err ERR-NOT-PAUSED))
    (var-set paused false)
    (ok true)
  )
)

(define-public (set-minter (account principal) (enabled bool))
  (begin
    (assert-owner)
    (map-set minters account enabled)
    (ok true)
  )
)

(define-public (set-burner (account principal) (enabled bool))
  (begin
    (assert-owner)
    (map-set burners account enabled)
    (ok true)
  )
)

(define-public (set-pauser (account principal) (enabled bool))
  (begin
    (assert-owner)
    (map-set pausers account enabled)
    (ok true)
  )
)

(define-public (update-metadata (new-uri (string-ascii 256)))
  (begin
    (assert-owner)
    (asserts! (> (len new-uri) u0) (err ERR-INVALID-METADATA))
    (var-set metadata-uri new-uri)
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (assert-owner)
    (try! (assert-valid-recipient new-owner))
    (var-set token-owner new-owner)
    (ok true)
  )
)

(define-public (rescue-stx (amount uint))
  (begin
    (assert-owner)
    (try! (assert-valid-amount amount))
    (stx-transfer? amount (as-contract tx-sender) (var-get token-owner))
  )
)

(define-public (rescue-token (token <fungible-token-trait>) (amount uint))
  (begin
    (assert-owner)
    (try! (assert-valid-amount amount))
    (contract-call? token transfer amount (as-contract tx-sender) (var-get token-owner) none)
  )
)

(begin
  (map-set minters tx-sender true)
  (map-set burners tx-sender true)
  (map-set pausers tx-sender true)
)