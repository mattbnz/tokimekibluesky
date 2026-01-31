import {accountsDb} from "$lib/db";
import {agent, agents} from "$lib/stores";
import {resumeAccountsSession} from "$lib/resumeAccountsSession";
import {goto} from '$app/navigation';
import {BskyAgent} from "@atproto/api";
import { PersistedState } from "runed";
import { get } from 'svelte/store';
import { unwrapFunctionStore, format } from 'svelte-i18n';

// Debug logging prefix for easy filtering in console
const DEBUG_PREFIX = '[APP STATE]';

function debugLog(...args: any[]) {
    console.log(DEBUG_PREFIX, ...args);
}

class AppState {
    ready: boolean = $state(false);
    status: number = $state(0);
    profile: PersistedState<number> = new PersistedState('currentProfile', 1);
    missingAccounts: string[] = $state([]);
    labelDefs = new PersistedState('labelDefs', []);
    subscribedLabelers = new PersistedState('subscribedLabelers', ['did:plc:ar7c4by46qjdydhdevvrndac']);
    singleColumnScrollPositions: Map<number, number> = new Map();

    async init() {
        debugLog('INIT started');
        const profiles = await accountsDb.profiles.toArray();
        const anyAccounts = await accountsDb.accounts
            .toArray();

        debugLog('INIT - loaded from DB:', {
            profilesCount: profiles.length,
            accountsCount: anyAccounts.length,
            currentProfileId: this.profile.current,
        });

        if (!anyAccounts.length) {
            debugLog('INIT - No accounts found, redirecting to login');
            console.log('Accounts are nothing');
            await goto('/login');
            return false;
        }

        if (this.ready) {
            debugLog('INIT - Already ready, skipping');
            return false;
        }

        if (!profiles.length) {
            debugLog('INIT - No profiles found, creating new profile');
            console.log('Profiles are empty. create new profile.');
            const acs = anyAccounts.map(account => account.id);
            const _format = unwrapFunctionStore(format);
            const id = await accountsDb.profiles.put({
                accounts: acs as number[],
                columns: [],
                createdAt: '',
                name: _format('workspace') + ' 1',
                primary: acs[0] as number,
            })
            this.profile.current = id;
            debugLog('INIT - Created new profile with id:', id);

            await this.init();
            return false;
        }

        const currentProfile = this.profile.current;

        if (!currentProfile) {
            debugLog('INIT - Current profile is missing');
            console.log('Current profile is missing.');
            this.status = 4;
            return false;
        }

        const profile = profiles.find(profile => profile.id === currentProfile);
        debugLog('INIT - Found profile:', {
            id: profile?.id,
            name: profile?.name,
            columnsCount: profile?.columns?.length ?? 0,
            accountsInProfile: profile?.accounts?.length ?? 0,
        });

        // Log column details from profile
        profile?.columns?.forEach((col, idx) => {
            debugLog(`INIT - profile.columns[${idx}]:`, {
                id: col.id,
                name: col.algorithm?.name,
                type: col.algorithm?.type,
                feedLength: col.data?.feed?.length ?? 0,
                cursor: col.data?.cursor ? `${col.data.cursor.substring(0, 30)}...` : 'none',
            });
        });

        const accounts = await accountsDb.accounts
            .where('id')
            .anyOf(profile.accounts)
            .toArray();
        const isPrimaryAvailable = accounts.find(account => account.id === profile.primary);

        if (!profile.accounts.length) {
            debugLog('INIT - No accounts in profile');
            console.log('There is no account in this profile.');
            this.status = 1;
            return false;
        }

        if (!accounts.length) {
            debugLog('INIT - Attached accounts are missing');
            console.log('Attached accounts are missing in this profile.');
            this.status = 2;
            return false;
        }

        if (!profile.primary || !isPrimaryAvailable) {
            debugLog('INIT - Primary account is missing');
            console.log('Primary account is missing.');
            this.status = 5;
            return false;
        }

        debugLog('INIT - Resuming account sessions...');
        let agentsMap = await resumeAccountsSession(accounts, profile?.appViewProxy);
        agents.set(agentsMap);
        const _agents = get(agents);
        agent.set(_agents.get(profile.primary));
        const _agent = get(agent);
        debugLog('INIT - Agent sessions resumed, agentsCount:', _agents.size);

        try {
            _agents.forEach((ag) => {
                ag.agent.configureLabelers(this.subscribedLabelers.current);
            });

            if (!Object.keys(this.labelDefs.current).length) {
                this.labelDefs.current = await _agent.agent.getLabelDefinitions(this.subscribedLabelers.current);
            }
        } catch (e) {
            console.error(e);
        }

        // this.status = 0;
        this.ready = true;
        debugLog('INIT - Complete, ready=true');
    }

    changeProfile(id) {
        debugLog('CHANGE PROFILE - from:', this.profile.current, 'to:', id);
        this.profile.current = id;
        appState.ready = false;
        appState.init();
    }
}

export const appState = new AppState();