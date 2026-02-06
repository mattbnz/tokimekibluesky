import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

function getSupabase() {
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

async function subscription(subscription: any, did: string, language: string, notifications: string) {
    const addDatabase = async () => {
        const { error } = await getSupabase()
            .from('v2-notification')
            .upsert(
                {
                    subscription: subscription,
                    accounts: did,
                    language: language,
                    notifications: notifications,
                },
                {
                    onConflict: 'subscription',
                }
            )
            .single()

        if (error && error.code !== '23505') {
            console.log(error);
        }
    }

    await addDatabase();
}

export async function POST ({ request }) {
    if (request.method === 'POST') {
        const textObj = await request.json();

        await subscription(textObj.subscription, textObj.did, textObj.language, textObj.notifications);

        return new Response('200', { status: 200 });
    }
}