# Mercado Livre → Invoice → WhatsApp group

Automates the flow: fetch recent sold orders from Mercado Livre, generate a simple order PDF (invoice), and send it to a WhatsApp group.

## Stack
- Node.js + TypeScript
- Mercado Livre API (official)
- `pdfkit` for PDF generation
- `whatsapp-web.js` (WhatsApp Web) as primary delivery + click-to-chat fallback

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   # fill in MELI_ACCESS_TOKEN + WhatsApp group details
   ```
   - Get an ML access token: create an app at [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br), then request a token with the **read orders / offline_access** scopes (see the [auth docs](https://developers.mercadolivre.com.br/en_us/authentication-and-authorization)).
   - For the WhatsApp group, set `WHATSAPP_GROUP_ID` (e.g. `120363123456789012@g.us`) or `WHATSAPP_GROUP_NAME` (looked up automatically).

## Usage
```bash
npm run orders     # list your latest orders (status, totals) for sanity checks
npm start          # run the whole flow: fetch → invoice PDF → send to group
npm run build      # typecheck + compile to dist/
```

On the first `npm start`, a **QR code** is printed to the terminal. Scan it from the phone (**WhatsApp → Settings → Linked devices**) to link the session. It is stored in `WHATSAPP_SESSION_DIR` (default `./.wwebjs_auth`) so later runs won't need it again.

## Configuration reference
See `.env.example` for all options:
- `ORDERS_DAYS` — look back window (default `7`)
- `ORDER_STATUSES` — comma-separated statuses to include (default `paid`)
- `WHATSAPP_MODE` — `web` (default) or `click-to-chat`
- `FALLBACK_NUMBERS` — phone numbers to print click-to-chat links for when mode is `click-to-chat`
- `OUTPUT_DIR` — where PDFs are saved (default `./invoices`)
- `TIMEZONE` — IANA timezone for the invoice date (default `America/Sao_Paulo`)

## Notes
- Invoices are **order summaries**, not fiscal documents (NF-e).
- Mercado Livre access tokens expire (~6h). Providing `MELI_APP_ID` + `MELI_APP_SECRET` + `MELI_REFRESH_TOKEN` enables automatic refresh.
- whatsapp-web.js is browser-based automation; it may break if WhatsApp changes their web app. Disable it (`WHATSAPP_MODE=click-to-chat`) to only print share links.