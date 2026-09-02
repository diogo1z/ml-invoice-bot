import { MercadoLivreClient } from './meli';

async function main() {
  const meli = new MercadoLivreClient();
  const orders = await meli.fetchSellerOrders(20);
  console.log(`Last ${orders.length} orders:`);
  for (const o of orders) {
    console.log(
      `- ${o.id} | ${o.status} | ${o.currency_id} ${o.total_amount.toFixed(2)} | ` +
        `${o.date_closed ?? o.date_created} | buyer=${o.buyer?.nickname ?? '?'}`
    );
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
