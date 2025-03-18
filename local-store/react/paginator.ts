import { PaginatorCore } from "../browser/core";
import { IndexRangeBounds, Page, PageId, QueryId } from "../shared/types";
import { useEffect, useState } from "react";
import { CoreRequest, CoreResponse, PageTransition } from "../browser/protocol";
import { QueryResult } from "../shared/query";
import { BaseConvexClient, QueryToken } from "convex/browser";
import { FunctionReference, getFunctionName } from "convex/server";
import { Value } from "convex/values";

type PageSubscription = { unsubscribe: () => void, queryToken: QueryToken };

export class Paginator {
  private convex: BaseConvexClient;
  private core: PaginatorCore;

  querySubscriptions: Map<QueryId, (result: QueryResult) => void> = new Map();

  // TODO: Make this many to many?
  pageSubscriptions: Map<PageId, PageSubscription> = new Map();
  pageByQueryToken: Map<QueryToken, PageId> = new Map();


  constructor(
    address: string,
    private paginationEndpoint: FunctionReference<"query", any, any>,
    indexFields: string[],
  ) {
    this.convex = new BaseConvexClient(address, (q) => this.transition(q));
    this.core = new PaginatorCore(paginationEndpoint, indexFields);
  }

  useQuery(indexRange: IndexRangeBounds, order: "asc" | "desc", count: number) {
    const [result, setResult] = useState<QueryResult | undefined>();
    useEffect(() => {
      const queryId = crypto.randomUUID();
      this.querySubscriptions.set(queryId, (result) => {
        setResult(result);
      });
      this.sendRequest({
        kind: "addSyncQuery",
        queryId,
        query: {
          count,
          indexRangeBounds: indexRange,
          order,
        },
      });
      return () => {
        this.sendRequest({
          kind: "removeSyncQuery",
          queryId,
        });
        this.querySubscriptions.delete(queryId);
      }
    }, [indexRange, order, count]);
    return result;
  }

  private transition(updatedQueries: QueryToken[]) {
    const pages = new Map<PageId, PageTransition>();
    for (const queryToken of updatedQueries) {
      let pageTransition: PageTransition;
      const pageId = this.pageByQueryToken.get(queryToken);
      if (!pageId) {
        throw new Error(`Page not found for query token ${queryToken}`);
      }
      try {
        const result = (this.convex as any).localQueryResultByToken(queryToken);
        if (!result) {
          continue;
        }
        pageTransition = {
          kind: "success",
          result: {
            pageId,
            state: {
              kind: "loaded",
              value: result,
            },
          },
        }
      } catch (e: any) {
        pageTransition = {
          kind: "error",
          errorMessage: e.message,
          errorData: e.data,
        }
      }
      pages.set(pageId, pageTransition);
    }
    this.sendRequest({
      kind: "networkTransition",
      serverTs: 1,
      pages,
    })
  }

  private sendRequest(request: CoreRequest) {
    console.log("sendRequest", request,);
    const responses = this.core.receive(request);
    this.handleResponses(responses);
  }

  private handleResponses(responses: CoreResponse[]) {
    console.log("handleResponses", responses);
    for (const response of responses) {
      switch (response.kind) {
        case "uiTransition": {
          for (const [queryId, queryResult] of response.queryUpdates) {
            const subscription = this.querySubscriptions.get(queryId);
            if (!subscription) {
              throw new Error(`Query not found for query id ${queryId}`);
            }
            subscription(queryResult);
          }
          continue;
        }
        case "networkAddQuery": {
          const { queryToken, unsubscribe } = this.convex.subscribe(
            getFunctionName(this.paginationEndpoint),
            response.pageRequest as any as Record<string, Value>,
          )
          this.pageByQueryToken.set(queryToken, response.pageId);
          this.pageSubscriptions.set(response.pageId, { unsubscribe, queryToken });
          continue;
        }
        case "networkRemoveQuery": {
          for (const pageId of response.toRemove) {
            const subscription = this.pageSubscriptions.get(pageId);
            if (!subscription) {
              throw new Error(`Page not found for page id ${pageId}`);
            }
            subscription.unsubscribe();
            this.pageSubscriptions.delete(pageId);
            this.pageByQueryToken.delete(subscription.queryToken);
          }
          continue;
        }
      }
    }
  }
}