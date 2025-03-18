import { describe, it, expect } from 'vitest';
import { PaginatorCore } from '../browser/core';
import { api } from "../../convex/_generated/api"
import { PageTransition } from '../browser/protocol';
import { MAXIMAL_KEY, MINIMAL_KEY } from '../shared/types';

describe('Paginator', () => {
  it('should be able to paginate messages', () => {
    const paginator = new PaginatorCore(
      api.messages.resolver,
      ["_creationTime"]
    );
    const responses1 = paginator.receive({
        kind: "addSyncQuery",
        queryId: "query1",
        query: {
            order: "asc",
            count: 10,
            indexRangeBounds: {
              lowerBound: [],
              lowerBoundInclusive: true,
              upperBound: [],
              upperBoundInclusive: true,
            },
        },
    })
    console.log(responses1);
    expect(responses1.length).toEqual(2);
    if (responses1[0].kind !== "networkAddQuery") {
      throw new Error("Invariant failure: First response is not a networkAddQuery");
    }
    const pageId = responses1[0].pageId;
    const pageResult: PageTransition = {
      kind: "success",
      result: {
        pageId,
        state: {
          kind: "loaded",
          value: {
            results: [
              {
                _id: "1",
                _creationTime: 1,
                _content: "Hello, world!",
              },
            ],
            lowerBound: MINIMAL_KEY,
            upperBound: MAXIMAL_KEY,
          },
        },
      },
    }
    const responses2 = paginator.receive({
        kind: "networkTransition",
        serverTs: 1,
        pages: new Map([[pageId, pageResult]]),
    })

    expect((responses2 as any)[0].queryUpdates.get("query1")).toEqual({
      kind: "loaded",
      status: "success",
      value: [
        {
          _id: "1",
          _creationTime: 1,
          _content: "Hello, world!",
        },
      ],
    });
  });
});
