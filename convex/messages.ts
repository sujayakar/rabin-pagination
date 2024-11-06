import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { decodeId } from "./idEncoding";
import { Id } from "./_generated/dataModel";

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
    const stream = ctx.db.query("messages")
      .withIndex("by_creation_time", q => q.gt("_creationTime", args.start));
    const results = [];
    let pageBoundary: number | null = null;
    for await (const message of stream) {
      results.push(message)
      if (isPageBoundary(message._id, args.log2PageSize)) {
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

function isPageBoundary(id: Id<any>, log2PageSize: number) {
  const mask = (1 << log2PageSize) - 1;
  const { internalId } = decodeId(id);

  // We have 14 bytes of high quality randomness followed by 2 bytes of timestamp.
  // Use the first four bytes as an unsigned integer.      
  const randomInt = new DataView(internalId.buffer).getUint32(0, true);  
  return (randomInt & mask) === mask;
}

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


export const clearAll = mutation({
  handler: async (ctx) => {
    const documents = await ctx.db.query("messages").collect();
    for (const doc of documents) {
      await ctx.db.delete(doc._id);
    }
  }
})