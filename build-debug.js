import { build } from 'vite';

try {
  await build();
} catch (error) {
  console.error('Full error object:', error);
  console.error('Error stack:', error.stack);
  console.error('Error message:', error.message);
  console.error('Error cause:', error.cause);
  process.exit(1);
}
