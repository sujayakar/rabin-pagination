import { compareKeys, compareValues, maximalKey, minimalKey } from "./compare";
import { createQueryToken } from "./queryTokens";
import { QueryResults } from "./queryResults";
import { IndexRangeBounds, QueryId, PageId, Page, PageArguments, Key, IndexPrefix, IndexKey } from "./types";
import { Query, QueryResult } from "./query";
import { CoreRequest, CoreResponse } from "./protocol";
import { FunctionReference, GenericDocument } from "convex/server";

export class PaginatorCore {
  private queries: Map<QueryId, Query> = new Map();
  private pages: Map<PageId, Page> = new Map();
  private queryResults: QueryResults = new QueryResults();

  private pendingTransition: Map<PageId, Page> = new Map();

  constructor(
    private paginationEndpoint: FunctionReference<"query", any, any>,
    private indexFields: string[],
  ) {
  }

  receive(request: CoreRequest): CoreResponse[] {
    const { responses, tryAdvanceSnapshots, tryUnsubscribe } = this.processRequest(request);
    const outputs: CoreResponse[] = [...responses];
    if (tryAdvanceSnapshots) {
      outputs.push(...this.advanceSnapshots());
    }
    if (tryUnsubscribe) {
      outputs.push(...this.unsubscribeFromPageQueries());
    }
    return outputs;
  }

  private processRequest(request: CoreRequest): {
    responses: CoreResponse[],
    tryAdvanceSnapshots: boolean,
    tryUnsubscribe: boolean,
  } {
    switch (request.kind) {
      case "addSyncQuery": {
        const responses = this.handleAddSyncQuery(request.query, request.queryId);
        return {
          responses,
          tryAdvanceSnapshots: false,
          tryUnsubscribe: false,
        }
      }
      case "removeSyncQuery": {
        const responses = this.handleRemoveSyncQuery(request.queryId);
        return {
          responses,
          tryAdvanceSnapshots: true,
          tryUnsubscribe: true,
        }
      }
      case "networkTransition": {
        const responses = this.handleNetworkTransition(request.serverTs, request.pages);
        return {
          responses,
          tryAdvanceSnapshots: true,
          tryUnsubscribe: false,
        }
      }
      default: {
        const _typecheck: never = request;
        throw new Error("Unreachable");
      }
    }
  }

  private handleAddSyncQuery(query: Query, queryId: QueryId): CoreResponse[] {

    this.queryResults.initializeQuery(queryId);
    this.queries.set(queryId, query);

    // Try to fulfill the query immediately if it's already covered by
    // existing pages.
    const responses = this.executeQueries([queryId]);
    return responses;
  }

  private executeQueries(queryIds: QueryId[]): CoreResponse[] {
    const allResponses: CoreResponse[] = [];
    const queryUpdates: Map<QueryId, QueryResult> = new Map();

    for (const queryId of queryIds) {
      const query = this.queries.get(queryId);
      if (!query) {
        throw new Error("Query not found");
      }
      this.queryResults.reset(queryId);

      let queryResult: QueryResult | undefined;
      const pagesRead = new Set<PageId>();

      let newPage: { pageId: PageId, args: PageArguments } | null = null;

      const executionResult = this.executeQuery(query);
      console.log('executionResult', queryId, executionResult);
      switch (executionResult.state) {
        case "fulfilled": {
          for (const pageId of executionResult.readPageIds) {
            pagesRead.add(pageId);
          }
          queryResult = { kind: "loaded", status: "success", value: executionResult.results };
          break;
        }
        case "waitingOnLoadingPage": {
          for (const pageId of executionResult.loadingPageIds) {
            pagesRead.add(pageId);
          }
          queryResult = { kind: "loading" };
          break;
        }
        case "needsMorePages": {
          executionResult.existingPageIds.forEach((id) => {
            pagesRead.add(id);
          });
          const pageRequest = {
            target: executionResult.targetKey,
            log2PageSize: LOG2_PAGE_SIZE,
          };
          const pageId = createQueryToken(
            this.paginationEndpoint,
            pageRequest,
          );
          newPage = { pageId: pageId, args: pageRequest };
          pagesRead.add(pageId);
          allResponses.push({
            kind: "networkAddQuery",
            pageId,
            pageRequest,
          });
          queryResult = { kind: "loading" };
          break;
        }
        default: {
          const _typecheck: never = executionResult;
          throw new Error("Unreachable");
        }
      }
      if (newPage !== null) {
        if (this.pages.has(newPage.pageId)) {
          throw new Error(`page already exists: ${newPage.pageId}`);
        }
        this.pages.set(newPage.pageId, {
          pageId: newPage.pageId,
          state: {
            kind: "loading",
            target: newPage.args.target,
          },
        });
        this.queryResults.initializePage(newPage.pageId);
      }
      this.queryResults.setResult(queryId, queryResult, pagesRead);
      queryUpdates.set(queryId, queryResult);
    }
    allResponses.push({
      kind: "uiTransition",
      queryUpdates,
    });
    return allResponses;
  }

  private executeQuery(query: Query):
    | {
      state: "fulfilled";
      readPageIds: PageId[];
      results: any[];
    }
    | {
      state: "waitingOnLoadingPage";
      loadingPageIds: PageId[];
    }
    | {
      state: "needsMorePages";
      existingPageIds: PageId[];
      targetKey: Key;
    } {
    const loadingPageIds = this.loadingPagesWithOverlap(query.indexRangeBounds);
    if (loadingPageIds.length > 0) {
      return {
        state: "waitingOnLoadingPage",
        loadingPageIds,
      }
    }
    const anchorKey = query.order === "asc" ?
      minimalKey(query.indexRangeBounds) :
      maximalKey(query.indexRangeBounds);

    const firstPageId = this.getLoadedPageContaining(anchorKey);
    if (firstPageId === null) {
      return {
        state: "needsMorePages",
        existingPageIds: [],
        targetKey: anchorKey,
      };
    }

    const pageIds: PageId[] = [
      firstPageId,
      ...this.getConsecutiveLoadedPagesInDirection(
        firstPageId,
        query.order,
      ),
    ];

    const subscribedPageIds: PageId[] = [];
    const documents: GenericDocument[] = [];

    for (const pageId of pageIds) {
      const page = this.pages.get(pageId);
      if (page === undefined) {
        throw new Error(`page not found: ${pageId}`);
      }
      if (page.state.kind === "loading") {
        throw new Error(`page is loading: ${pageId}`);
      }
      const pageResult = page.state.value;
      const pageInRange = pageResult.results.filter((d: GenericDocument) => {
        const cursor = this.keyForSyncObject(d);
        return (
          compareKeys(cursor, minimalKey(query.indexRangeBounds)) >=
            0 &&
          compareKeys(cursor, maximalKey(query.indexRangeBounds)) <=
            0
        );
      });
      if (query.order === "desc") {
        pageInRange.reverse();
      }
      documents.push(...pageInRange);
      subscribedPageIds.push(pageId);
      const isEndOfQueriedRange =
        query.order === "asc"
          ? compareKeys(
              pageResult.upperBound,
              maximalKey(query.indexRangeBounds),
            ) >= 0
          : compareKeys(
              pageResult.lowerBound,
              minimalKey(query.indexRangeBounds),
            ) <= 0;
      if (isEndOfQueriedRange || documents.length >= query.count) {
        return {
          state: "fulfilled",
          readPageIds: subscribedPageIds,
          results: documents.slice(0, query.count),
        };
      }
    }

    const lastPageId = pageIds[pageIds.length - 1];
    const lastPage = this.pages.get(lastPageId);
    if (lastPage === undefined || lastPage.state.kind === "loading") {
      throw new Error(`lastPage not found or still loading`);
    }
    const lastPageResult = lastPage.state.value;
    let nextTargetKey: Key;
    if (query.order === "asc") {
      nextTargetKey = {
        kind: "successor",
        value: lastPageResult.upperBound.value as IndexPrefix,
      };
    } else {
      nextTargetKey = {
        kind: "exact",
        // TODO -- why will this always be an IndexKey?
        value: lastPageResult.lowerBound.value as unknown as IndexKey,
      };
    }
    return {
      state: "needsMorePages",
      existingPageIds: subscribedPageIds,
      targetKey: nextTargetKey,
    }
  }

  private loadingPagesWithOverlap(rangeBounds: IndexRangeBounds): PageId[] {
    return this.getOrderedPages()
      .filter((p) => p.state.kind === "loading")
      .map((p) => p.pageId);
  }

  private getOrderedPages() {
    const pages = [...this.pages.values()];
    pages.sort((p1, p2) =>
      compareKeys(
        p1.state.kind === "loaded"
          ? p1.state.value.lowerBound
          : p1.state.target,
        p2.state.kind === "loaded"
          ? p2.state.value.lowerBound
          : p2.state.target,
      ),
    );
    return pages;
  }

  getLoadedPageContaining(key: Key): PageId | null {
    const page = this.getOrderedPages().find((p) => {
      if (p.state.kind === "loading") {
        return false;
      }
      const pageResult = p.state.value;
      return (
        compareKeys(key, pageResult.lowerBound) >= 0 &&
        compareKeys(key, pageResult.upperBound) <= 0
      );
    });
    return page ? page.pageId : null;
  }

  getConsecutiveLoadedPagesInDirection(
    initialPageSubscriptionId: PageId,
    direction: "asc" | "desc",
  ): PageId[] {
    const orderedPages = this.getOrderedPages();
    const initialPageIndex = orderedPages.findIndex(
      (p) => p.pageId === initialPageSubscriptionId,
    );
    if (initialPageIndex === -1) {
      throw new Error(`initialPage not found: ${initialPageSubscriptionId}`);
    }
    const initialPage = orderedPages[initialPageIndex];
    if (initialPage.state.kind === "loading") {
      throw new Error("initialPage is loading");
    }
    const result: PageId[] = [];
    const initialPageResult = initialPage.state.value;
    let pageBreak =
      direction === "asc"
        ? initialPageResult.upperBound
        : initialPageResult.lowerBound;
    const pageIncrement = direction === "asc" ? 1 : -1;

    let currentPageIndex = initialPageIndex + pageIncrement;
    while (0 <= currentPageIndex && currentPageIndex < orderedPages.length) {
      const page = orderedPages[currentPageIndex];
      if (page.state.kind === "loading") {
        break;
      }
      const pageResult = page.state.value;
      const nextPageBreak =
        direction === "asc" ? pageResult.lowerBound : pageResult.upperBound;
      // Whichever bound is the lower bound will be exclusive (kind: "successor") and whichever is the upper bound will be inclusive
      // (kind: "exact") so compare their values instead of comparing the keys directly
      // console.log(
      //   "#### compareValues",
      //   pageBreak,
      //   nextPageBreak,
      //   compareValues(pageBreak.value as any, nextPageBreak.value as any),
      // );
      if (
        page.state.kind === "loaded" &&
        compareValues(pageBreak.value as any, nextPageBreak.value as any) !== 0
      ) {
        break;
      }
      result.push(page.pageId);
      pageBreak =
        direction === "asc" ? pageResult.upperBound : pageResult.lowerBound;
      currentPageIndex += pageIncrement;
    }
    return result;
  }

  keyForSyncObject(doc: GenericDocument): { kind: "exact"; value: IndexKey } {
    return {
      kind: "exact",
      // TODO: Handle nested fields.
      // TODO: null is kind of wrong but we can't use undefined because it's not convex-json serializable
      value: this.indexFields.map((field) => doc[field] ?? null),
    }
  }

  private handleRemoveSyncQuery(queryId: QueryId): CoreResponse[] {
    const query = this.queries.get(queryId);
    if (!query) {
      throw new Error(`query not found: ${queryId}`);
    }
    this.queries.delete(queryId);
    this.queryResults.remove(queryId);
    return [];
  }

  // TODO: Handle removing pages after we get acknowlegement.
  private handleNetworkTransition(serverTs: number, results: Map<PageId, { kind: "success", result: Page } | { kind: "error", errorMessage: string, errorData: any }>): CoreResponse[] {
    for (const [pageId, result] of results.entries()) {
      if (result.kind === "success") {
        this.pendingTransition.set(pageId, result.result);
      } else {
        console.error(`page error: ${pageId}`, result.errorMessage, result.errorData);
      }
    }
    return [];
  }

  private advanceSnapshots(): CoreResponse[] {
    // Claim the current pending transition.
    const transition = this.pendingTransition;
    this.pendingTransition = new Map();
    if (transition.size === 0) {
      return [];
    }
    const queryIds = new Set<QueryId>();
    for (const [pageId, page] of transition.entries()) {
      const invalidatedQueryIds = this.queryResults.advancePage(pageId);
      for (const queryId of invalidatedQueryIds) {
        queryIds.add(queryId);
      }
      console.log("advanceSnapshots", pageId, page);
      this.pages.set(pageId, page);
    }
    this.queryResults.debug();

    const responses = this.executeQueries(Array.from(queryIds));
    return responses;
  }

  private unsubscribeFromPageQueries(): CoreResponse[] {
    if (this.queryResults.notStarted().length > 0) {
      throw new Error("Invariant failure: Queries not started when attempting to unsubscribe");
    }
    // One of our sync queries is still loading, so don't unsubscribe
    // to avoid dropping data we'll need on the next recomputation.
    if (this.queryResults.loading().length > 0) {
      return [];
    }
    const unusedPages = this.queryResults.unusedPages();
    return [
      {
        kind: "networkRemoveQuery",
        toRemove: unusedPages,
      },
    ];
  }
}

export const LOG2_PAGE_SIZE = 4;