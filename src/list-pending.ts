import { listPendingLabels } from './actions';

listPendingLabels().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
