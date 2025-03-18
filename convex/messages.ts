import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { ltOr, gtOr, rangeToQuery, paginationResolver, splitRange } from "../local-store/server/resolvers";

const FIELDS = ["_creationTime"] as const;

export const resolver = paginationResolver([...FIELDS], async function* (ctx: any, args) {
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
})

export const send = mutation({
  args: { body: v.string(), author: v.string() },
  handler: async (ctx, { body, author }) => {
    // Send a new message.
    await ctx.db.insert("messages", { body, author });
  },
});

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    for (const message of await ctx.db.query("messages").collect()) {
      await ctx.db.delete(message._id);
    }
  },
});
