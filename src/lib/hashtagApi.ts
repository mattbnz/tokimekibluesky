import { env } from '$env/dynamic/public';


interface HashtagResult {
  tag: string;
  score: number;
}

interface HashtagApiResponse {
  success: boolean;
  data?: {
    hashtags: HashtagResult[];
  };
  error?: string;
}

export async function fetchTrendingHashtags(
  query?: string,
  limit: number = 10
): Promise<string[]> {
  if (!env.PUBLIC_HASHTAG_API_URL) {
    return [];
  }

  try {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    params.set('limit', limit.toString());

    const response = await fetch(`${env.PUBLIC_HASHTAG_API_URL}/api/hashtags?${params}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return [];
    }

    const result: HashtagApiResponse = await response.json();

    if (result.success && result.data?.hashtags) {
      return result.data.hashtags.map((h) => h.tag);
    }

    return [];
  } catch (error) {
    console.error('[HashtagAPI] Error:', error);
    return [];
  }
}
