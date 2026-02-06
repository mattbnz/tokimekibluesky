<script lang="ts">
  import {_} from "svelte-i18n";
  import {agent, realtime, settings, changedFollowData} from '$lib/stores';
  import TimelineItem from "./TimelineItem.svelte";
  import {getPostRealtime} from "$lib/realtime";
  import {getDbFollows} from "$lib/getActorsList";
  import {playSound} from "$lib/sounds";
  import MoreDivider from "$lib/components/post/MoreDivider.svelte";
  import {isReasonRepost, isReasonPin} from "@atproto/api/dist/client/types/app/bsky/feed/defs";
  import {toast} from "svelte-sonner";
  import {getColumnState} from "$lib/classes/columnState.svelte";
  import {isAfter} from "date-fns";
  import {tick, onMount} from "svelte";
  import Infinite from "$lib/components/utils/Infinite.svelte";
  import { getLastReadUri, setLastReadUriImmediate } from '$lib/lastReadClient';
  import LastReadTracker from '$lib/components/utils/LastReadTracker.svelte';
  import { stableColumnId } from '$lib/util';

  // Debug logging prefix for easy filtering in browser console
  const DEBUG_PREFIX = '[TIMELINE]';
  function debugLog(...args: any[]) {
      console.log(DEBUG_PREFIX, ...args);
  }

  let { index, _agent = $agent, isJunk, unique, isSplit = false, column: columnProp = undefined } = $props();

  const columnState = getColumnState(isJunk);
  const column = columnProp ?? columnState.getColumn(index);

  debugLog('Component created:', {
    index,
    columnId: column?.id,
    columnName: column?.algorithm?.name,
    columnType: column?.algorithm?.type,
    initialFeedLength: column?.data?.feed?.length ?? 0,
    hasScrollElement: !!column?.scrollElement,
    isJunk,
  });

  let isActorsListFinished = false;
  let actors = [];
  let realtimeCounter = 0;
  let isDividerLoading = $state(false);
  let dividerFillerHeight = $state(0);
  let controller: null | AbortController = null;
  let hasRestoredPosition = false;
  let trackingEnabled = $state(false);

  // Restore scroll position to last-read item after initial feed load
  $effect(() => {
    const feedLength = column.data.feed.length;
    const hasScrollEl = !!column.scrollElement;

    debugLog('Restore effect check:', {
      columnId: column.id,
      feedLength,
      hasScrollElement: hasScrollEl,
      hasRestoredPosition,
      willRestore: feedLength > 0 && hasScrollEl && !hasRestoredPosition
    });

    if (feedLength > 0 && column.scrollElement && !hasRestoredPosition) {
      restoreScrollPosition();
    }
  });

  // Check if a URI exists in the current feed data (without DOM query)
  function feedContainsUri(uri: string): boolean {
    return column.data.feed.some(item => item?.post?.uri === uri);
  }

  // Get the oldest post timestamp from a batch of feed items
  function getOldestPostTime(feedItems: any[]): Date | null {
    let oldest: Date | null = null;
    for (const item of feedItems) {
      const indexedAt = item?.post?.indexedAt;
      if (indexedAt) {
        const d = new Date(indexedAt);
        if (!oldest || d < oldest) oldest = d;
      }
    }
    return oldest;
  }

  // Maximum age for scroll restoration: if the saved position is older than this,
  // we stop fetching and just show the top of the feed.
  const RESTORE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

  async function restoreScrollPosition() {
    debugLog('restoreScrollPosition started:', { columnId: column.id });
    hasRestoredPosition = true;
    const did = _agent.did();
    if (!did) {
      debugLog('restoreScrollPosition aborted - no DID:', { columnId: column.id });
      trackingEnabled = true;
      return;
    }

    const stableId = stableColumnId(column);
    debugLog('restoreScrollPosition - fetching last read URI:', { columnId: column.id, stableId, did: did.substring(0, 20) + '...' });
    let lastReadUri = await getLastReadUri(did, stableId);

    // Migration: if nothing found under stable ID, try the old random UUID
    if (!lastReadUri && column.id !== stableId) {
      debugLog('restoreScrollPosition - trying legacy UUID:', { columnId: column.id, stableId });
      lastReadUri = await getLastReadUri(did, column.id);
      if (lastReadUri) {
        debugLog('restoreScrollPosition - migrating legacy entry to stable ID:', { columnId: column.id, stableId, uri: lastReadUri.substring(0, 50) });
        setLastReadUriImmediate(did, stableId, lastReadUri);
      }
    }

    if (!lastReadUri) {
      debugLog('restoreScrollPosition - no saved position found:', { columnId: column.id });
      trackingEnabled = true;
      return;
    }

    debugLog('restoreScrollPosition - found saved URI:', { columnId: column.id, uri: lastReadUri.substring(0, 50) });

    // Check if the URI is already in the initially loaded feed
    if (!feedContainsUri(lastReadUri)) {
      debugLog('restoreScrollPosition - URI not in initial feed, fetching older pages:', { columnId: column.id });
      const now = Date.now();

      // Fetch older pages until we find the URI or hit the age cap
      while (column.data.cursor) {
        try {
          const res = await _agent.getTimeline({
            limit: 20,
            cursor: column.data.cursor,
            algorithm: column.algorithm,
            lang: $settings?.general?.userLanguage
          });

          if (!res?.data?.feed?.length) {
            debugLog('restoreScrollPosition - no more feed items, stopping fetch-back:', { columnId: column.id });
            break;
          }

          // Check if we've gone past the age cap
          const oldestTime = getOldestPostTime(res.data.feed);
          const pastAgeCap = oldestTime && (now - oldestTime.getTime()) > RESTORE_MAX_AGE_MS;

          // Deduplicate and append (same logic as handleLoadMore)
          const existingFeedMap = new Map(
            column.data.feed.map(item => [
              item.reason ? `${item.post.uri}|${item.reason.indexedAt}` : item.post.uri,
              item
            ])
          );
          const newItems = res.data.feed
            .filter(feed => {
              const key = feed.reason ? `${feed.post.uri}|${feed.reason.indexedAt}` : feed.post.uri;
              const existing = existingFeedMap.get(key);
              return !existing || !isDuplicatePost(existing, feed);
            })
            .map(item => {
              item.memoryCursor = res.data.cursor;
              return item;
            });

          column.data.feed.push(...newItems);
          column.data.cursor = res.data.cursor;

          // Check if the target URI is now in the feed
          if (newItems.some(item => item?.post?.uri === lastReadUri)) {
            debugLog('restoreScrollPosition - found target URI in fetched page:', { columnId: column.id });
            break;
          }

          // Stop after processing this batch if we've passed the age cap
          if (pastAgeCap) {
            debugLog('restoreScrollPosition - reached 2-day age cap, stopping fetch-back:', {
              columnId: column.id,
              oldestPostAge: Math.round((now - oldestTime.getTime()) / (60 * 60 * 1000)) + 'h'
            });
            break;
          }
        } catch (e) {
          debugLog('restoreScrollPosition - error fetching older page, stopping:', { columnId: column.id, error: e });
          break;
        }
      }
    }

    await tick(); // Wait for DOM update after any new items are rendered

    const item = column.scrollElement?.querySelector(`[data-uri="${CSS.escape(lastReadUri)}"]`);
    debugLog('restoreScrollPosition - DOM lookup:', {
      columnId: column.id,
      foundElement: !!item,
      scrollElementExists: !!column.scrollElement,
      feedLength: column.data.feed.length
    });

    if (item) {
      debugLog('restoreScrollPosition - scrolling to element:', { columnId: column.id });
      item.scrollIntoView({ block: 'start', behavior: 'instant' });
      debugLog('restoreScrollPosition - scroll complete:', { columnId: column.id });
    } else {
      debugLog('restoreScrollPosition - element NOT FOUND after fetch-back:', {
        columnId: column.id,
        uri: lastReadUri.substring(0, 50),
        feedLength: column.data.feed.length
      });
    }

    // Enable tracking after scroll restoration is complete (or attempted)
    trackingEnabled = true;
    debugLog('restoreScrollPosition - tracking enabled:', { columnId: column.id });
  }

  $effect(() => {
      insertRealtimeData($realtime);
  })

  $effect(() => {
      if (column.settings?.autoRefresh === -1 && !isActorsListFinished) {
          getActors();
      }
  })

  $effect(() => {
      if (!$changedFollowData || !isActorsListFinished || column.algorithm?.type !== 'default') {
          return;
      }

      if ($changedFollowData.actor !== column.did) {
          return;
      }

      const { did, following } = $changedFollowData;
      if (following) {
          if (!actors.includes(did)) {
              actors = [...actors, did];
          }
      } else {
          actors = actors.filter(actor => actor !== did);
      }
  })

  function insertRealtimeData(realtime) {
      if (!isActorsListFinished) {
          return false;
      }

      getPostRealtime(realtime, actors, _agent)
          .then(value => {
              if (!value) {
                  return false;
              }

              column.data.feed.unshift(value);
              realtimeCounter = realtimeCounter + 1;

              if (realtimeCounter === 20) {
                  realtimeCounter = 0;

                  _agent.getTimeline({limit: 20, cursor: '', algorithm: column.algorithm})
                      .then((res) => {
                          const refPost = res.data.feed.slice(-1)[0];
                          const cursor = res.data.cursor;
                          let i = 0;

                          while (i < 20) {
                              column.data.feed[i].memoryCursor = cursor;

                              if (isDuplicatePost(column.data.feed[i], refPost)) {
                                  break;
                              }

                              i++;
                          }

                          releaseOldPosts();
                      });
              }

              if (column.settings?.playSound) {
                  playSound(value?.post.indexedAt, column.lastRefresh, column.settings.playSound)
              }
          });
  }

  function releaseOldPosts() {
      const scrollEl = $settings.design?.layout === 'decks' ? column.scrollElement || document.querySelector(':root') : document.querySelector(':root');
      const scrollTop = scrollEl?.scrollTop ?? 0;

      if (scrollTop !== 0 || column.data.feed.length <= 40) {
          return;
      }

      const borderItem = column.data.feed[39];
      if (borderItem?.memoryCursor) {
          const lastCursorIndex = column.data.feed.findLastIndex(item => item.memoryCursor === borderItem.memoryCursor);
          if (lastCursorIndex !== -1) {
              column.data.feed.splice(lastCursorIndex + 1);
              column.data.cursor = borderItem.memoryCursor;
          }
      }
  }

  async function getActors() {
      if (column.algorithm.type === 'default') {
          actors = await getDbFollows(_agent);
      }

      if (column.algorithm.type === 'officialList') {
          actors = await _agent.getListActors(column.algorithm.algorithm);

      }
      isActorsListFinished = true;
  }

  function handleDividerClick(index, cursor, pos) {
      column.data.cursor = cursor;
      column.data.feed[index].isDivider = false;
      isDividerLoading = true;
      dividerFillerHeight = pos;
      column.data.feed.splice(index + 1);
  }

  async function handleDividerUp(index, cursor, dividerEl: HTMLElement | undefined) {
    try {
      const bottomEl: HTMLElement = dividerEl?.nextElementSibling;

      const res = await _agent.getTimeline({limit: 100, cursor: cursor, algorithm: column.algorithm});
      const last = column.data.feed[index + 1];

      if (!last) {
        return false;
      }

      const feed = res.data.feed.filter(feed => {
        if (isReasonRepost(feed.reason)) {
          if (isAfter(feed?.reason?.indexedAt, last?.reason?.indexedAt || last?.post?.indexedAt)) {
            return true;
          }
        } else {
          if (isAfter(feed?.post?.indexedAt, last?.reason?.indexedAt || last?.post?.indexedAt)) {
            return true;
          }
        }

        return false;
      }).map(item => {
        item.memoryCursor = res.data.cursor;
        return item;
      });

      column.data.feed.splice(index + 1, 0, ...feed);
      column.data.feed[index].isDivider = false;
      column.data.feed[index + feed.length].isDivider = true;

      if (bottomEl) {
        tick().then(() => {
          const scrollEl: HTMLElement = $settings.design?.layout === 'decks' ? column.scrollElement || document.querySelector(':root') : document.querySelector(':root');
          const offsetTop = bottomEl.offsetTop - 52;
          scrollEl.scrollTo(0, offsetTop);
        })
      }

      if (feed.length !== res.data.feed.length) {
        tick().then(() => {
          column.data.feed[index + feed.length].isDivider = false;
        })
      }
    } catch (e) {
      console.error(e);
    }
  }

  function isDuplicatePost(oldFeed, newFeed) {
      return newFeed.reason
          ? oldFeed.post.uri === newFeed.post.uri && oldFeed.reason?.indexedAt === newFeed.reason.indexedAt
          : oldFeed.post.uri === newFeed.post.uri;
  }

  const handleLoadMore = async (loaded, complete) => {
      try {
        controller = new AbortController();
        const res = await _agent.getTimeline({limit: 20, cursor: column.data.cursor, algorithm: column.algorithm, lang: $settings?.general?.userLanguage}, controller.signal);
          column.data.cursor = res.data.cursor;

        const existingFeedMap = new Map(
            column.data.feed.map(item => [
                item.reason ? `${item.post.uri}|${item.reason.indexedAt}` : item.post.uri,
                item
            ])
        );

        const feed = res.data.feed
            .filter(feed => {
                const key = feed.reason ? `${feed.post.uri}|${feed.reason.indexedAt}` : feed.post.uri;
                const existing = existingFeedMap.get(key);
                return !existing || !isDuplicatePost(existing, feed);
            })
            .map(item => {
                item.memoryCursor = res.data.cursor;
                return item;
            });

        if (column.algorithm.type === 'author') {
            const existingParentUris = new Set();
            const existingRootUris = new Set();

            column.data.feed.forEach(f => {
                if (f?.post?.uri) existingParentUris.add(f.post.uri);
                if (f?.reply?.root?.uri) existingRootUris.add(f.reply.root.uri);
            });

            feed.forEach(f => {
                const parentUri = f?.reply?.parent?.uri;
                if (parentUri) existingParentUris.add(parentUri);
            });

            const processedFeed = feed
                .filter(newFeed => {
                    if (isReasonRepost(newFeed.reason)) return true;
                    return !existingParentUris.has(newFeed?.post?.uri);
                })
                .map(newFeed => {
                    const rootUri = newFeed?.reply?.root?.uri;
                    const isDuplicate = rootUri && existingRootUris.has(rootUri);

                    if (rootUri) {
                        existingRootUris.add(rootUri);
                    }

                    return isDuplicate ? { ...newFeed, isRootHide: true } : newFeed;
                });

            column.data.feed.push(...processedFeed);
          } else {
            column.data.feed.push(...feed);
          }

          isDividerLoading = false;

          if (column.data.cursor) {
              loaded();
          } else {
              complete();
          }
      } catch (e) {
          console.error(e);

          if (e.message === 'BlockedActor') {
              toast.error($_('error_get_posts_because_blocking'));
          }

          if (e.message === 'BlockedByActor') {
              toast.error($_('error_get_posts_because_blocked'));
          }

          complete();
      }
  }

  $effect(() => {
    return () => {
      if (controller) {
        controller.abort();
      }
    }
  })
</script>

<div class="timeline timeline--{column.style}">
  <div class:media-list={column.style === 'media'} class:media-list--1={column.style === 'media' && column?.settings?.mediaColumns === 1} class:media-list--2={column.style === 'media' && column?.settings?.mediaColumns === 2} class:video-list={column.style === 'video'}>
    {#each column.data.feed as data, index (data)}
      {#if (data?.post?.author?.did)}
        <svelte:boundary>
          <TimelineItem
                  {data}
                  {index}
                  {column}
                  {_agent}
                  isReplyExpanded={column.algorithm.type === 'author' && !data.isRootHide}
                  isPinned={isReasonPin(data?.reason)}
          ></TimelineItem>

          {#snippet failed(error, reset)}
            <p style="padding: 16px;">post load error!!</p>
          {/snippet}
        </svelte:boundary>
      {/if}

      {#if data?.isDivider}
        <MoreDivider onDividerClick={(pos) => {handleDividerClick(index, data.memoryCursor, pos)}} onDividerUp={(el) => {handleDividerUp(index, data.memoryCursor, el)}}></MoreDivider>
      {/if}
    {/each}
  </div>

  {#key unique}
    <Infinite oninfinite={handleLoadMore}></Infinite>
  {/key}

  {#if (isDividerLoading)}
    <div class="more-divider-filler" style="--more-divider-filler-height: {dividerFillerHeight}px"></div>
  {/if}

  {#if column.scrollElement && _agent}
    <LastReadTracker
      did={_agent.did()}
      columnId={stableColumnId(column)}
      scrollContainer={column.scrollElement}
      {trackingEnabled}
    />
  {/if}
</div>
