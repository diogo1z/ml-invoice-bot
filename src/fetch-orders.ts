import { listRecentOrders } from './actions';

listRecentOrders().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
