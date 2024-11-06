import { ConvexClient } from "convex/browser";
import { Doc } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";

type Key = number;

type Subscription = {
    id: SubscriptionId,
    start: Key,
    count: number,

    onUpdate: (s: SubscriptionState) => void,
};

export type SubscriptionState = {
    loading: boolean;
    results: Doc<"messages">[],
}
// Pages have optional exclusive start and inclusive ends.
type Page =
    | { type: "loading", start: Key }
    | { type: "loaded", documents: Doc<"messages">[], start: Key, end: Key };

type SubscriptionId = number;

// TODO:
// - order (via custom comparator?)
// - different sort keys
// - paginating backwards?
// - error handling
// - generics
export class Paginator22 {
    nextSubscriptionId = 0;

    subscriptions: Map<SubscriptionId, Subscription> = new Map();
    subscriptionState: Map<SubscriptionId, SubscriptionState> = new Map();

    // Sorted in ascending key order.
    pages: Array<Page> = [];

    log2PageSize = 4;

    constructor(private client: ConvexClient) {}

    subscribe(startExclusive: Key, count: number, onUpdate: (s: SubscriptionState) => void) {
        const id = this.nextSubscriptionId++;
        const subscription = { id, start: startExclusive, count, onUpdate };
        this.subscriptions.set(id, subscription);
        this.subscriptionState.set(id, { loading: true, results: [] });
        this.subscriptionsToPages();

        return () => {
            this.subscriptions.delete(id);
            this.subscriptionState.delete(id);
            this.subscriptionsToPages();            
        }
    }

    subscriptionsToPages() {
        console.log('subscriptionToPages')
        let modified = false;
        // We need pages to fully cover subscriptions.
        for (const subscription of this.subscriptions.values()) {
            let currentKey = subscription.start;
            let currentCount = subscription.count;

            while (currentCount > 0) {
                // Find the right most page whose start strictly precedes our start.
                let currentPage: Page | null = null;
                for (let i = this.pages.length - 1; i >= 0; i--) {
                    const page = this.pages[i];
                    if (page.start === null || page.start <= currentKey) {
                        currentPage = page;
                        break;
                    }
                }
                // If we're past the end of our pages, start loading another page.
                if (currentPage === null) {                    
                    const newPage: Page = { type: "loading", start: currentKey };                    
                    console.log('kicking off', newPage, this.pages)
                    this.client.onUpdate(api.messages.paginateMessages, { start: currentKey, log2PageSize: this.log2PageSize }, (result) => {
                        const { messages } = result;
                        (newPage as any).type = "loaded";
                        (newPage as any).documents = messages;
                        const end = messages.length > 0 ? messages[messages.length-1]._creationTime : Number.MAX_VALUE;
                        (newPage as any).end = end;
                        console.log('after result', this.pages);
                        this.pagesToSubscriptionState();
                        this.subscriptionsToPages();
                    });
                    modified = true;
                    this.pages.push(newPage);
                    this.pages.sort((a, b) => a.start - b.start);
                    currentPage = newPage;
                    break;
                }
                // If we hit a loading page, wait on that to finish before adding
                // another page.
                if (currentPage.type === "loading") {
                    break;
                }
                // Otherwise, use this page and continue.
                currentKey = currentPage.end;
                currentCount -= currentPage.documents.length;
            }
        }

        // TODO: 
        // - The algorithm above will naturally fill holes due to page splits, but it
        //   will externalize a loading state when doing so.
        // - GC pages that don't overlap with a subscription
        // - GC overlapping pages (due to page merges)
        if (modified) {
            this.pagesToSubscriptionState();
        }        
    }

    pagesToSubscriptionState() {
        console.log('pagesToSubscriptionState')
        
        for (const subscription of this.subscriptions.values()) {
            let currentKey = subscription.start;
            let currentCount = subscription.count;
            const results: Doc<"messages">[] = [];
            let loading = false;

            while (currentCount > 0) {                
                // Find the right most page whose start precedes our start.
                let currentPage: Page | null = null;
                for (let i = this.pages.length - 1; i >= 0; i--) {
                    const page = this.pages[i];
                    if (page.start <= currentKey) {
                        currentPage = page;
                        break;
                    }
                }
                if (currentPage === null || currentPage.type === "loading") {
                    loading = true;
                    break;
                }
                const toUse = Math.min(currentCount, currentPage.documents.length);
                results.push(...currentPage.documents.slice(0, toUse));

                // TODO: Is this the right condition for detecting empty lists?
                if (currentKey === currentPage.end) {
                    break;
                }
                currentKey = currentPage.end;
                currentCount -= toUse;
            }

            const state = this.subscriptionState.get(subscription.id)!;
            const modified = state.loading !== loading 
                || state.results.length !== results.length
                || state.results.some((r, i) => !documentsEqual(r, results[i]));
            if (modified) {
                state.loading = loading;
                state.results = results;
                subscription.onUpdate(state);
            }
        }            
    }
}    

function documentsEqual(a: Doc<"messages">, b: Doc<"messages">) {
    return a._creationTime === b._creationTime
        && a._id === b._id
        && a.author === b.author
        && a.body === b.body
}