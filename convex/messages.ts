import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { decodeId } from "./idEncoding";

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Grab the most recent messages.
    const messages = await ctx.db.query("messages").order("desc").take(100);
    return messages;
  },
});

export const paginateMessages = query({
  args: {
    start: v.number(),
    log2PageSize: v.number(),
  },
  handler: async (ctx, args) => {
    // Creation time descending.
    const mask = (1 << args.log2PageSize) - 1;

    const stream = ctx.db.query("messages")
      .withIndex("by_creation_time", q => q.lt("_creationTime", args.start))
      .order("desc");

    const results = [];
    let pageBoundary: number | null = null;
    for await (const message of stream) {
      results.push(message)

      const { internalId } = decodeId(message._id);

      // We have 14 bytes of high quality randomness followed by 2 bytes of timestamp.
      // Use the first four bytes as an unsigned integer.      
      const randomInt = new DataView(internalId.buffer).getUint32(0, true);
            
      if ((randomInt & mask) === mask) {
        pageBoundary = message._creationTime;
        break;
      }
    }
    console.log("numResults", results.length);
    return {
      messages: results,
      pageBoundary,
    };
  }
})

export const populate = mutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("messages", { body: `Message ${i}`, author: "Convex" });
    }
  },
});

export const send = mutation({
  args: { body: v.string(), author: v.string() },
  handler: async (ctx, { body, author }) => {
    // Send a new message.
    await ctx.db.insert("messages", { body, author });
  },
});
