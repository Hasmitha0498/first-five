# Direct UPI payments (manual confirmation)

**Status:** live when `PAYMENTS_ENABLED=true` and `UPI_PAYEE_VPA` is set. Takes priority over Pine Labs.

## How it works
1. Buyer (signed in) opens `/checkout` → **Pay ₹99 with UPI** → an order is created with a unique reference (`FFXXXXXXXX`).
2. `/payment/status?order=…` shows a UPI QR code, an "Open UPI app" deep link (`upi://pay?pa=…&am=99.00&tn=First Five FF…`), the UPI ID and the reference.
3. After paying, the buyer submits the 12-digit UPI transaction ID (UTR). The order becomes **pending verification**. This is a claim, not proof; nothing is granted.
4. An admin opens **/app/admin → UPI payments**, checks their UPI/bank app for the amount and reference/UTR, and clicks **Confirm received** (or **Reject**).
5. Confirming marks the payment verified, sets the order `paid_verified`, grants exactly one study credit, records `payment_verified` and an audit entry. Repeat confirms are idempotent.

Safeguards: a UTR can be used on only one order; buyers can't see or confirm other orders; only admins can confirm; orders are `environment = live`.

## Configure
| Variable | Example |
|---|---|
| `PAYMENTS_ENABLED` | `true` |
| `UPI_PAYEE_VPA` | `yourname@bank` |
| `UPI_PAYEE_NAME` | `First Five` (shown in the payer's app) |
| `PAID_STUDY_PRICE_MINOR` | `9900` |

## Turn off
Set `PAYMENTS_ENABLED=false` (or remove `UPI_PAYEE_VPA`) and redeploy. Existing orders remain reviewable in the admin page.

## Limitations
- Confirmation is manual, so buyers wait until an admin checks.
- No automatic refunds; refund through your UPI app and reject or leave the order as-is.
- This is not the Pine Labs integration and doesn't satisfy a "Pine Labs payment" requirement.
