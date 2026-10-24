# Pine Labs — Setup Guide

**Status:** interface, data model and entitlement rules implemented ([`integrations/pinelabs.ts`](../../apps/server/src/integrations/pinelabs.ts), [`services/payments.ts`](../../apps/server/src/services/payments.ts)). **Live API calls not implemented**; checkout shows “Paid access isn't available yet.” and no paid access can be granted.

## 1. What it does
Plus checkout → Render creates an `orders` row with a unique merchant reference → Pine Labs **hosted checkout** → return/webhook → Render fetches the **authoritative** order status from Pine Labs (never trusts redirect parameters) → `payments` row → exactly one `access_grants` row with `source = payment`. `environment` is stored as `uat` or `live`; UAT payments are integration proof, never revenue. Invitation-code access never creates payments.

## 2. What it needs
| Variable | Purpose |
|---|---|
| `PINELABS_ENV` | `uat` (default) or `live` |
| `PINELABS_BASE_URL` | UAT/live API host from Pine Labs |
| `PINELABS_CLIENT_ID`, `PINELABS_CLIENT_SECRET` | Server-only credentials (**secret**) |
| `PINELABS_MERCHANT_ID` | Merchant identifier |
| `PINELABS_WEBHOOK_SECRET` | Webhook signature verification (**secret**) |
| `PLUS_PRICE_MINOR`, `PLUS_CURRENCY` | Price in paise (configurable, not fixed to ₹99) |

## 3. Where to get it
Pine Labs merchant dashboard / onboarding team (UAT credentials first). Current API reference: pinelabs.com/docs/online-payments.

## 4. Where to configure it
Render → **first-five → Environment**. Webhook URL to register with Pine Labs: `https://<your-render-url>/api/payments/webhook/pinelabs`.

## 5. How to test
After implementing `createCheckout`, `fetchOrderStatus` and `verifyWebhook`: Settings → Paid plans → Upgrade → complete a UAT payment with Pine Labs' test instruments → confirm the order becomes `paid_verified`, one `payment` grant exists, and **/app/admin** shows it under “Verified UAT payments (test mode)”.

## 6. Expected success
`orders.status = paid_verified`, `payments.verified = true`, one `access_grants` row linked by `orderId`, webhook stored once in `payment_webhook_events`.

## 7. Common errors
`503 payment_unavailable` (expected today); `401 invalid_signature`; `409 amount_mismatch` (provider amount ≠ order amount → `verification_error`); duplicate webhooks are acknowledged and ignored.

## 8. Troubleshooting
Check `payment_webhook_events`, `orders`, Render logs. Never mark an order paid by hand.

## 9. How to disconnect
Remove the variables and redeploy. Existing verified grants remain; new checkouts show unavailable.

## 10. Re-run regression tests
`npm test` — includes the rule that unverified orders can't grant access.

**Claude Code prompt:** “Connect Pine Labs” — asks for UAT credentials only, implements the adapter against the current docs, and verifies a legitimate sandbox transaction.
