# Mercado Livre → Faturas & Etiquetas de envio

Automates Mercado Livre: generates order summary PDFs, sends them to a
WhatsApp group, and emails shipping labels daily (local cron or GitHub Actions).

## Stack
- Node.js + TypeScript
- Mercado Livre API (official)
- `pdfkit` for PDF generation
- `whatsapp-web.js` (WhatsApp Web) as primary delivery + click-to-chat fallback
- `@libsql/client` for SQLite (local file or Turso) send tracking

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   # fill in MELI_APP_ID + MELI_APP_SECRET, SMTP_* and EMAIL_TO
   ```
   - Create an app at [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br). With `MELI_APP_ID` + `MELI_APP_SECRET` the bot obtains a token automatically via `client_credentials` (`MELI_ACCESS_TOKEN` is optional). Add `MELI_REFRESH_TOKEN` for user-scoped access (see the [auth docs](https://developers.mercadolivre.com.br/en_us/authentication-and-authorization)).
   - For labels by email, set `SMTP_*`, `EMAIL_FROM` and `EMAIL_TO`.
   - For the WhatsApp group, set `WHATSAPP_GROUP_ID` (e.g. `120363123456789012@g.us`) or `WHATSAPP_GROUP_NAME` (looked up automatically).
   - `.env` is gitignored: never commit it.

## Usage
```bash
npm run orders     # list your latest orders (status, totals) for sanity checks
npm run pending    # show how many orders still need shipping labels
npm run labels     # download one PDF per pending label and email the fixed recipients
npm run db:migrate # copy sent-label history from local SQLite to Turso
npm start          # interactive menu (labels, invoices, email tests)
npm run build      # typecheck + compile to dist/
```

## Como rodar

`npm run labels` é idempotente: registra cada etiqueta enviada no SQLite
(`DB_PATH` local ou `DB_URL` no Turso) e ignora nas próximas execuções. Um
lock file evita duas execuções simultâneas na mesma máquina.

### Opção 1 — Local (cron)
1. No `.env`, use o banco local deixando `DB_URL` e `DB_AUTH_TOKEN` vazios:
   ```dotenv
   DB_PATH=./data/labels.db
   DB_URL=
   DB_AUTH_TOKEN=
   ```
   Ou aponte para o Turso (mesmo banco do GitHub Actions) preenchendo
   `DB_URL` + `DB_AUTH_TOKEN`.
2. Teste uma execução:
   ```bash
   npm run pending   # só conta, não envia
   npm run labels    # baixa e envia as pendentes
   ```
3. Para rodar 4x/dia (08h, 09h, 12h e 13h), adicione ao `crontab -e`:
   ```cron
   0 8,9,12,13 * * * cd /home/diogo/Repositorio/ml && mkdir -p logs && /usr/bin/npm run labels >> logs/labels.log 2>&1
   ```

> O cron local usa o fuso da máquina e o `npm` precisa estar no `PATH`. Se usar
> nvm, rode `which npm` e use o caminho completo no crontab. Se o computador
> estiver desligado, a execução não acontece — por isso a opção 2 é mais confiável.

### Opção 2 — GitHub Actions (nuvem, grátis)
O workflow `.github/workflows/labels.yml` roda **08h, 09h, 12h e 13h**
(America/Sao_Paulo), com redundância de 1h entre as tentativas, e também pode
ser disparado manualmente em **Actions → Send shipping labels → Run workflow**.
Em UTC os horários são 11:00, 12:00, 15:00 e 16:00.

1. Crie o banco no [Turso](https://turso.tech) (se ainda não tiver):
   ```bash
   turso db create ml-labels
   turso db show ml-labels --url
   turso db tokens create ml-labels
   ```
2. Cadastre em **Settings → Secrets and variables → Actions**:
   - `MELI_APP_ID`, `MELI_APP_SECRET`
   - `DB_URL` (`libsql://...turso.io`), `DB_AUTH_TOKEN`
   - `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_TO`
   - opcionais: `LABELS_EMAIL_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`
   - sem `LABELS_EMAIL_TO`, as etiquetas vão para `diogo1z@hotmail.com` e `mariana_costa019@hotmail.com`
3. Copie o histórico local para o Turso (evita reenviar etiquetas antigas):
   ```bash
   DB_URL='libsql://...' DB_AUTH_TOKEN='...' npm run db:migrate
   ```
   Se o `.env` já aponta para o Turso, basta `npm run db:migrate`.
4. Faça push do repositório e rode o workflow uma vez para testar.

Repo privado no plano Free tem 2.000 minutos/mês (cada execução usa ~1–3 min;
4x/dia ≈ 120–360 min/mês). O `npm ci` usa `PUPPETEER_SKIP_DOWNLOAD=true`,
porque labels não usam WhatsApp.

> Use **apenas um agendador por vez**. Se mantiver o cron local e o Actions,
> aponte os dois para o mesmo `DB_URL`/`DB_AUTH_TOKEN` do Turso; caso contrário
> os bancos ficam separados e uma etiqueta pode ser enviada duas vezes.

Delivery is controlled by `DELIVERY_MODE`: `email`, `whatsapp`, or `both`.
When unset, it falls back to `whatsapp`. For email, configure the SMTP variables
in `.env` (see `.env.example`) and use menu option **6** to send a test email.

On the first `npm start`, a **QR code** is printed to the terminal. Scan it from the phone (**WhatsApp → Settings → Linked devices**) to link the session. It is stored in `WHATSAPP_SESSION_DIR` (default `./.wwebjs_auth`) so later runs won't need it again.

## Configuration reference
See `.env.example` for all options:
- `ORDERS_DAYS` — look back window (default `7`)
- `ORDER_STATUSES` — comma-separated statuses to include (default `paid`)
- `WHATSAPP_MODE` — `web` (default) or `click-to-chat`
- `FALLBACK_NUMBERS` — phone numbers to print click-to-chat links for when mode is `click-to-chat`
- `OUTPUT_DIR` — where PDFs are saved (default `./invoices`)
- `DB_PATH` — local SQLite file used to track sent labels (default `./data/labels.db`)
- `DB_URL` / `DB_AUTH_TOKEN` — remote Turso/libSQL database (leave empty to use `DB_PATH`; set both to share state with GitHub Actions)
- `LABELS_MAX_ORDERS` — max paid orders scanned for pending shipments (default `300`)
- `TIMEZONE` — IANA timezone for the invoice date (default `America/Sao_Paulo`)
- `DELIVERY_MODE` — `whatsapp`, `email` or `both` (default `whatsapp`)
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` — SMTP server credentials
- `EMAIL_FROM` — sender address (defaults to `SMTP_USER`)
- `EMAIL_TO` — comma-separated recipients for invoices/other emails
- `LABELS_EMAIL_TO` — comma-separated shipping-label recipients (default `diogo1z@hotmail.com,mariana_costa019@hotmail.com`)

## Segurança
- `.env` está no `.gitignore` e nunca deve ser commitado.
- No GitHub Actions, as credenciais ficam apenas em **Settings → Secrets and variables → Actions**.
- Também são ignorados: `data/`, `logs/`, `invoices/`, `.wwebjs_auth/`, `.wwebjs_cache/` e `dist/`.

## Notes
- Invoices are **order summaries**, not fiscal documents (NF-e).
- `npm run labels` scans paid orders (paginated up to `LABELS_MAX_ORDERS`), finds shipments still `ready_to_ship`, downloads **one PDF per label** and emails them all to `LABELS_EMAIL_TO` (default: `diogo1z@hotmail.com` and `mariana_costa019@hotmail.com`), with the number of orders still to ship in the subject/body. Shipped/delivered shipments are skipped by the API.
- Successfully emailed shipments are saved in SQLite, so the same label is never sent twice; `npm run pending` shows the current count without sending.
- Mercado Livre access tokens expire (~6h). Providing `MELI_APP_ID` + `MELI_APP_SECRET` obtains a token automatically via `client_credentials`; adding `MELI_REFRESH_TOKEN` switches to the user-scoped refresh flow.
- whatsapp-web.js is browser-based automation; it may break if WhatsApp changes their web app. Disable it (`WHATSAPP_MODE=click-to-chat`) to only print share links.
- Email uses standard SMTP, so any provider works. Free tiers: Gmail (App Password), Brevo (300/day), Resend (100/day), SendGrid (100/day).