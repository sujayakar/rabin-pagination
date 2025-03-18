import { convexToJson, GenericId, v, Value } from "convex/values";
import { query, QueryCtx } from "./_generated/server";
import { ExactKey, IndexKey, isMaximal, isMinimal, Key, MAXIMAL_KEY, MINIMAL_KEY, PageResult } from "../ls-paginator/types";
import { AnyDataModel, GenericDocument, GenericQueryCtx } from "convex/server";

const FIELDS = ["_creationTime"] as const;

const ltOr = (equal: boolean) => (equal ? "lte" : "lt");
const gtOr = (equal: boolean) => (equal ? "gte" : "gt");

function rangeToQuery(range: Bound[]) {
  return (q: any) => {
    for (const [boundType, field, value] of range) {
      q = q[boundType](field, value);
    }
    return q;
  };
}

const indexResolver: IndexResolverGenerator = async function* (ctx: GenericQueryCtx<any>, args: IndexResolverGeneratorArgs) {
  const { key, inclusive, direction } = args;
  const indexFields = [...FIELDS];

  const startIndexKey = [...key];
  const endIndexKey: string[] = [];
  const startInclusive = inclusive;
  const order = direction;

  const startBoundType =
    order === "desc" ? ltOr(startInclusive) : gtOr(startInclusive);
  const endInclusive = true;
  const endBoundType =
    order === "desc" ? gtOr(endInclusive) : ltOr(endInclusive);
  if (
    indexFields.length < startIndexKey.length ||
    indexFields.length < endIndexKey.length
  ) {
    throw new Error("Index key length exceeds index fields length");
  }
  const split = splitRange(
    indexFields,
    startIndexKey,
    endIndexKey,
    startBoundType,
    endBoundType,
  );
  for (const range of split) {
    const query = ctx.db
      .query("messages")
      .withIndex("by_creation_time", rangeToQuery(range))
      .order(order);
    for await (const document of query) {
      yield document;
    }
  }
}

export const resolver = query({
  args: {
    target: v.any(),
    log2PageSize: v.number(),
  },
  handler: async (ctx, args) => {
    const target = args.target as Key;
    const getCursor = (doc: GenericDocument) => {
      return {
        // TODO: null is kind of wrong but we can't use undefined because it's not convex-json serializable
        kind: "exact" as const,
        value: FIELDS.map((field: string) => doc[field] ?? null),
      };
    };
    const startKey = await getStartKey({
      ctx,
      indexResolver,
      getCursor,
      target,
    });
    // now startKey is a key that we want to find a page containing.
    // First look backwards and include all results after the previous page boundary.
    const results = [];
    let lowerBound: GeneratorCursor = MINIMAL_KEY;
    if (!isMinimal(startKey)) {
      const streamBack = syncDocumentGenerator({
        ctx,
        generator: indexResolver,
        args: {
          key: startKey.value,
          inclusive: isMaximal(startKey),
          direction: "desc",
        },
      });

      for await (const result of streamBack()) {
        const isBoundary = await isPageBoundary(
          (result as any)._id,
          args.log2PageSize,
        );
        // console.log("result cursor", getCursor(result));
        // console.log("isBoundary", isBoundary);
        if (isBoundary) {
          lowerBound = {
            kind: "successor",
            value: getCursor(result).value as any,
          };
          break;
        }
        results.push(result);
      }
      // results is now documents in reverse cursor order excluding the target document
      // now reverse it
      results.reverse();
    }

    let upperBound: GeneratorCursor = MAXIMAL_KEY;
    if (!isMaximal(startKey)) {
      const stream = syncDocumentGenerator({
        ctx,
        generator: indexResolver,
        args: {
            key: startKey.value,
            inclusive: true,
            direction: "asc",
          },
        });
        for await (const result of stream()) {
          // Add the document even if it's a page boundary since we include the upper bound.
          results.push(result);
        if (await isPageBoundary((result as any)._id, args.log2PageSize)) {
          upperBound = getCursor(result);
          break;
        }
      }
    }
    return {
      results,
      lowerBound,
      upperBound,
    } as PageResult;
  }
});

async function getStartKey({
  ctx,
  indexResolver,
  getCursor,
  target,
}: {
  ctx: GenericQueryCtx<any>;
  indexResolver: IndexResolverGenerator<AnyDataModel>;
  getCursor: (doc: GenericDocument) => GeneratorCursor;
  target: Key;
}): Promise<GeneratorCursor> {
  if (isMinimal(target)) {
    return MINIMAL_KEY;
  }
  if (isMaximal(target)) {
    return MAXIMAL_KEY;
  }
  if (target.kind === "exact") {
    return { kind: "exact", value: target.value };
  } else if (target.kind === "successor") {
    const stream = syncDocumentGenerator({
      ctx,
      generator: indexResolver,
      args: {
        key: target.value,
        inclusive: false,
        direction: "asc",
      },
    });
    const { value: firstResult, done: firstDone } = await stream().next();
    if (firstDone) {
      // if we are asking for the successor of something and we can't find anything after that something,
      // start from the end and walk backwards to find the last page.
      return MAXIMAL_KEY;
    }
    return getCursor(firstResult);
  } else if (target.kind === "predecessor") {
    const stream = syncDocumentGenerator({
      ctx,
      generator: indexResolver,
      args: {
        key: target.value,
        inclusive: false,
        direction: "desc",
      },
    });
    const { value: firstResult, done: firstDone } = await stream().next();
    if (firstDone) {
      return MINIMAL_KEY;
    }
    return getCursor(firstResult);
  }
  throw new Error(`Unexpected target kind ${(target as any).kind}`);
}

function syncDocumentGenerator({
  ctx,
  generator,
  args,
}: {
  ctx: GenericQueryCtx<any>;
  generator: IndexResolverGenerator<AnyDataModel>;
  args: IndexResolverGeneratorArgs;
}) {
  return async function* () {
    for await (const document of generator(ctx, args)) {
      yield document;
    }
  };
}

export type IndexResolverGenerator<DM extends AnyDataModel = AnyDataModel> = (
  ctx: GenericQueryCtx<DM>,
  args: IndexResolverGeneratorArgs,
) => AsyncGenerator<GenericDocument>;

export type IndexResolverGeneratorArgs = {
  key: IndexKey;
  inclusive: boolean;
  direction: "asc" | "desc";
};

export type GeneratorCursor =
  | typeof MAXIMAL_KEY
  | typeof MINIMAL_KEY
  | ExactKey;

async function isPageBoundary(id: GenericId<any>, log2PageSize: number) {
  const mask = (1 << log2PageSize) - 1;

  const encoder = new TextEncoder();
  const data = encoder.encode(id);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const randomInt = new DataView(hashBuffer).getUint32(0, true);

  return (randomInt & mask) === mask;
}

type Bound = ["gt" | "lt" | "gte" | "lte" | "eq", string, Value];

function equalValues(a: Value, b: Value): boolean {
  return JSON.stringify(convexToJson(a)) === JSON.stringify(convexToJson(b));
}

function exclType(boundType: "gt" | "lt" | "gte" | "lte") {
  if (boundType === "gt" || boundType === "gte") {
    return "gt";
  }
  return "lt";
}

function splitRange(
  indexFields: string[],
  startBound: IndexKey,
  endBound: IndexKey,
  startBoundType: "gt" | "lt" | "gte" | "lte",
  endBoundType: "gt" | "lt" | "gte" | "lte",
): Bound[][] {
  // Three parts to the split:
  // 1. reduce down from startBound to common prefix
  // 2. range with common prefix
  // 3. build back up from common prefix to endBound
  const commonPrefix: Bound[] = [];
  while (
    startBound.length > 0 &&
    endBound.length > 0 &&
    equalValues(startBound[0]!, endBound[0]!)
  ) {
    const indexField = indexFields[0]!;
    indexFields = indexFields.slice(1);
    const eqBound = startBound[0]!;
    startBound = startBound.slice(1);
    endBound = endBound.slice(1);
    commonPrefix.push(["eq", indexField, eqBound]);
  }
  const makeCompare = (
    boundType: "gt" | "lt" | "gte" | "lte",
    key: IndexKey,
  ) => {
    const range = commonPrefix.slice();
    let i = 0;
    for (; i < key.length - 1; i++) {
      range.push(["eq", indexFields[i]!, key[i]!]);
    }
    if (i < key.length) {
      range.push([boundType, indexFields[i]!, key[i]!]);
    }
    return range;
  };
  // Stage 1.
  const startRanges: Bound[][] = [];
  while (startBound.length > 1) {
    startRanges.push(makeCompare(startBoundType, startBound));
    startBoundType = exclType(startBoundType);
    startBound = startBound.slice(0, -1);
  }
  // Stage 3.
  const endRanges: Bound[][] = [];
  while (endBound.length > 1) {
    endRanges.push(makeCompare(endBoundType, endBound));
    endBoundType = exclType(endBoundType);
    endBound = endBound.slice(0, -1);
  }
  endRanges.reverse();
  // Stage 2.
  let middleRange;
  if (endBound.length === 0) {
    middleRange = makeCompare(startBoundType, startBound);
  } else if (startBound.length === 0) {
    middleRange = makeCompare(endBoundType, endBound);
  } else {
    const startValue = startBound[0]!;
    const endValue = endBound[0]!;
    middleRange = commonPrefix.slice();
    middleRange.push([startBoundType, indexFields[0]!, startValue]);
    middleRange.push([endBoundType, indexFields[0]!, endValue]);
  }
  return [...startRanges, middleRange, ...endRanges];
}