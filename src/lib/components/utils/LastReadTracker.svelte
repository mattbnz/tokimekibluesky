<script lang="ts">
  import { setLastReadUri } from '$lib/lastReadClient';

  // Debug logging prefix for easy filtering in browser console
  const DEBUG_PREFIX = '[LASTREAD TRACKER]';
  function debugLog(...args: any[]) {
      console.log(DEBUG_PREFIX, ...args);
  }

  interface Props {
    did: string;
    columnId: string;
    scrollContainer: HTMLElement | null;
    trackingEnabled?: boolean;
  }

  let { did, columnId, scrollContainer, trackingEnabled = true }: Props = $props();

  let observer: IntersectionObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let currentTopUri: string | null = null;

  debugLog('Component created:', { columnId, hasScrollContainer: !!scrollContainer });

  function handleIntersection(entries: IntersectionObserverEntry[]) {
    // Find topmost visible item
    const visibleEntries = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

    const topEntry = visibleEntries[0];
    if (topEntry) {
      const uri = (topEntry.target as HTMLElement).dataset.uri;
      if (uri && uri !== currentTopUri) {
        debugLog('Top visible changed:', { columnId, previousUri: currentTopUri?.substring(0, 40), newUri: uri.substring(0, 40), trackingEnabled });
        currentTopUri = uri;
        // Only save position when tracking is enabled (after scroll restore completes)
        if (trackingEnabled) {
          setLastReadUri(did, columnId, uri); // Debounced internally
        } else {
          debugLog('Skipping SET - tracking not enabled yet:', { columnId });
        }
      }
    }
  }

  function setupObserver() {
    if (!scrollContainer) {
      debugLog('setupObserver skipped - no scrollContainer:', { columnId });
      return;
    }

    debugLog('setupObserver:', { columnId, scrollContainerTag: scrollContainer.tagName });

    observer = new IntersectionObserver(handleIntersection, {
      root: scrollContainer,
      rootMargin: '-52px 0px -70% 0px', // Top 30% of viewport (below header)
      threshold: 0.1
    });

    // Observe existing items
    const items = scrollContainer.querySelectorAll('[data-uri]');
    debugLog('Observing existing items:', { columnId, count: items.length });
    items.forEach(item => observer!.observe(item));

    // Watch for new items via MutationObserver
    mutationObserver = new MutationObserver((mutations) => {
      let newItemsCount = 0;
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            if (node.dataset?.uri) {
              observer?.observe(node);
              newItemsCount++;
            }
            const items = node.querySelectorAll?.('[data-uri]');
            items?.forEach(item => {
              observer?.observe(item);
              newItemsCount++;
            });
          }
        });
      });
      if (newItemsCount > 0) {
        debugLog('MutationObserver - new items observed:', { columnId, count: newItemsCount });
      }
    });

    mutationObserver.observe(scrollContainer, { childList: true, subtree: true });
  }

  function cleanup() {
    debugLog('cleanup:', { columnId });
    observer?.disconnect();
    mutationObserver?.disconnect();
    observer = null;
    mutationObserver = null;
  }

  $effect(() => {
    if (scrollContainer) {
      debugLog('$effect triggered - setting up observer:', { columnId });
      setupObserver();
      return cleanup;
    } else {
      debugLog('$effect triggered - no scrollContainer yet:', { columnId });
    }
  });
</script>
