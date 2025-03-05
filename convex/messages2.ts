import { GenericId, v } from "convex/values";
import { query, QueryCtx } from "./_generated/server";
import { ExactKey, IndexKey, isMaximal, isMinimal, Key, MAXIMAL_KEY, MINIMAL_KEY, PageResult } from "../ls-paginator/types";
import { AnyDataModel, GenericDocument, GenericQueryCtx } from "convex/server";

const FIELDS = ["_creationTime"] as const;

const indexResolver = async function* (ctx: GenericQueryCtx<any>, args: IndexResolverGeneratorArgs) {
  const { key, inclusive, direction } = args;
  // const stream = await ctx.db.query("messages").withIndex("by_creation_time", (q) => q.eq(q.field(FIELDS[0]), key));
  const stream = ctx.db.query("messages");
  for await (const document of stream) {
    yield document;
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