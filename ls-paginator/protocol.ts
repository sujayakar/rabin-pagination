import { Query, QueryResult } from "./query";
import { QueryId, PageId, Page, PageArguments } from "./types";

export type PageTransition = { kind: "success"; result: Page; }
  | { kind: "error"; errorMessage: string; errorData: any; }

export type CoreRequest = {
  kind: "addSyncQuery";
  queryId: QueryId;
  query: Query;
} | {
  kind: "removeSyncQuery";
  queryId: QueryId;
} | {
  kind: "networkTransition";
  serverTs: number;
  pages: Map<PageId, PageTransition>;
};
export type CoreResponse = {
  kind: "uiTransition";
  queryUpdates: Map<QueryId, QueryResult>;
} | {
  kind: "networkAddQuery";
  pageId: PageId;
  pageRequest: PageArguments;
} | {
  kind: "networkRemoveQuery";
  toRemove: QueryId[];
};
