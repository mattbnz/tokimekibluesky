import type { HandleServerError } from '@sveltejs/kit';

export const handleError: HandleServerError = async ({ error, event, status, message }) => {
  console.error('=== SERVER ERROR ===');
  console.error('Status:', status);
  console.error('Message:', message);
  console.error('URL:', event.url.pathname);
  console.error('Error:', error);
  if (error instanceof Error) {
    console.error('Stack:', error.stack);
  }
  console.error('====================');

  return {
    message: message,
  };
};
