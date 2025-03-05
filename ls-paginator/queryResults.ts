import { QueryResult } from "./query";
import { QueryId, PageId } from "./types";

export class QueryResults {
  results: Map<QueryId, { kind: "NotStarted"; } | { kind: "Ready"; result: QueryResult; }> = new Map();
  queryToPages: Map<QueryId, Set<PageId>> = new Map();
  pageToQueries: Map<PageId, Set<QueryId>> = new Map();

  debug() {
    console.log('results', this.results);
    console.log('queryToPages', this.queryToPages);
    console.log('pageToQueries', this.pageToQueries);
  }

  initializeQuery(queryId: QueryId) {
    if (this.results.has(queryId)) {
      throw new Error(`query already exists: ${queryId}`);
    }
    this.results.set(queryId, { kind: "NotStarted" });
    this.queryToPages.set(queryId, new Set());
  }

  initializePage(pageId: PageId) {
    if (this.pageToQueries.has(pageId)) {
      throw new Error(`page already exists: ${pageId}`);
    }
    this.pageToQueries.set(pageId, new Set());
  }

  setResult(queryId: QueryId, result: QueryResult, pagesRead: Set<PageId>) {
    if (!this.results.has(queryId)) {
      throw new Error(`query not found: ${queryId}`);
    }
    this.results.set(queryId, { kind: "Ready", result });
    this.queryToPages.set(queryId, pagesRead);
    for (const pageId of pagesRead) {
      const queryIds = this.pageToQueries.get(pageId);
      if (!queryIds) {
        throw new Error(`queryIds not found: ${pageId}`);
      }
      queryIds.add(queryId);
    }
  }

  reset(queryId: QueryId) {
    if (!this.results.has(queryId)) {
      throw new Error(`query not found: ${queryId}`);
    }
    this.results.set(queryId, { kind: "NotStarted" });
    const pageIds = this.queryToPages.get(queryId);
    if (!pageIds) {
      throw new Error(`pageIds not found: ${queryId}`);
    }
    for (const pageId of pageIds) {
      const pageQueryIds = this.pageToQueries.get(pageId);
      if (!pageQueryIds) {
        throw new Error(`pageQueryIds not found: ${pageId}`);
      }
      pageQueryIds.delete(queryId);
    }
  }

  remove(queryId: QueryId) {
    if (!this.results.has(queryId)) {
      throw new Error(`query not found: ${queryId}`);
    }
    this.results.delete(queryId);
    const pageIds = this.queryToPages.get(queryId);
    if (!pageIds) {
      throw new Error(`pageIds not found: ${queryId}`);
    }
    for (const pageId of pageIds) {
      const pageQueryIds = this.pageToQueries.get(pageId);
      if (!pageQueryIds) {
        throw new Error(`pageQueryIds not found: ${pageId}`);
      }
      pageQueryIds.delete(queryId);
    }
  }

  notStarted(): QueryId[] {
    return Array.from(this.results.entries())
      .filter(([_, result]) => result.kind === "NotStarted")
      .map(([queryId]) => queryId);
  }

  loading(): QueryId[] {
    return Array.from(this.results.entries())
      .filter(([_, result]) => result.kind === "Ready" && result.result.kind === "loading")
      .map(([queryId]) => queryId);
  }

  unusedPages(): PageId[] {
    return Array.from(this.pageToQueries.entries())
      .filter(([_, queryIds]) => queryIds.size === 0)
      .map(([pageId]) => pageId);
  }

  advancePage(pageId: PageId): Set<QueryId> {
    const queryIdSet = this.pageToQueries.get(pageId);
    if (!queryIdSet) {
      this.pageToQueries.set(pageId, new Set());
      return new Set();
    }
    const queryIds = Array.from(queryIdSet);
    for (const queryId of queryIds) {
      this.reset(queryId);
    }
    return new Set(queryIds);
  }
}
