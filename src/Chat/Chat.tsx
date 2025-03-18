"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "convex/react";
import { FormEvent, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { MessageList } from "@/Chat/MessageList";
import { Message } from "@/Chat/Message";
import { ConvexClient } from "convex/browser";

import { Paginator } from "../../ls-paginator/paginator";

export const paginator = new Paginator(
  import.meta.env.VITE_CONVEX_URL as string,
  api.messages2.resolver,
  ["_creationTime"]
);

const query = {
  lowerBound: [],
  lowerBoundInclusive: true,
  upperBound: [],
  upperBoundInclusive: true,
};

export function Chat({ viewer }: { viewer: string }) {
  const [newMessageText, setNewMessageText] = useState("");
  const sendMessage = useMutation(api.messages.send);

  const results = paginator.useQuery(
    query,
    "asc",
    10
  );
  console.log('results', results);

  const [numRows, setNumRows] = useState(10);

  const messages: any[] = [];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNewMessageText("");
    sendMessage({ body: newMessageText, author: viewer }).catch((error) => {
      console.error("Failed to send message:", error);
    });
  };
  const clearAll = useMutation(api.messages.clearAll)

  return (
    <>
      <MessageList messages={messages}>
        {messages?.map((message) => (
          <Message key={message._id} author={message.author} viewer={viewer}>
            {message.body}
          </Message>
        ))}
      </MessageList>
      <div className="border-t">
        <form onSubmit={handleSubmit} className="container flex gap-2 py-4">
          <Input
            value={newMessageText}
            onChange={(event) => setNewMessageText(event.target.value)}
            placeholder="Write a message…"
          />
          <Button type="submit" disabled={newMessageText === ""}>
            Send
          </Button>
        </form>

      </div>
      <Button onClick={() => setNumRows(numRows + 10)}>{true ? "Loading..." : "Load More"}</Button>
      <Button onClick={() => clearAll()}>Clear all</Button>
    </>
  );
}
