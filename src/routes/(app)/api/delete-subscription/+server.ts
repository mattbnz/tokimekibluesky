import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

function getSupabase() {
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

async function subscription(subscription) {
    const deleteDatabase = async () => {
        const { error } = await getSupabase()
            .from('v2-notification')
            .delete()
            .eq('subscription', JSON.stringify(subscription));

        if (error) {
            console.log(error);
        }
    }

    await deleteDatabase();
}

export async function POST ({ request }) {
    if (request.method === 'POST') {
        const textObj = await request.json();

        await subscription(textObj.subscription);
        console.log('Subscription deleted.')

        return new Response('200', { status: 200 });
    }
}