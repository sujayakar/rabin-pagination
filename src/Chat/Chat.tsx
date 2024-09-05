"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "convex/react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { MessageList } from "@/Chat/MessageList";
import { Message } from "@/Chat/Message";
import { Doc } from "../../convex/_generated/dataModel";
import { ConvexClient } from "convex/browser";

// TODO: 
// - Client interest is a position + count: load more as needed, can have multiple
// - Given a client interest, return partial results and a loading flag
// - Check that page splits and merges work
// - Free pages that don't overlap with a client interest
// - Compute page boundaries based on document size 
// - Make data source generic
// - Support unions, joins, etc.

type Unsubscribe<T> = {
  (): void;
  unsubscribe(): void;
  getCurrentValue(): T | undefined;
};

const LOG2_PAGE_SIZE = 4;

type Page = {
  start: number;
  unsubscribe: Unsubscribe<{
    messages: Doc<"messages">[];
    pageBoundary: number | null;
  }>;
  state: PageState;
};

type PageState =
  | { kind: "loading" }
  | { kind: "loaded"; messages: Doc<"messages">[]; end: number | null };

class PaginationState {
  // Sorted by descending creation time.
  pages: Page[] = [];
  convex: ConvexClient;

  onChanged: Set<() => void> = new Set();

  constructor() {
    this.convex = new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
    const start = Number.MAX_VALUE;
    const unsubscribe = this.convex.onUpdate(
      api.messages.paginateMessages,
      { start, log2PageSize: LOG2_PAGE_SIZE },
      (result) => {
        this.receivePage(start, result);
      },
    );
    this.pages.push({ start, unsubscribe, state: { kind: "loading" } });
  }

  receivePage(
    start: number,
    result: { messages: Doc<"messages">[]; pageBoundary: number | null },
  ) {
    console.log(
      `Received ${result.messages.length} @ ${start} => ${result.pageBoundary}`,
    );
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      if (page.start === start) {
        page.state = {
          kind: "loaded",
          messages: result.messages,
          end: result.pageBoundary,
        };

        let nextPage = this.pages[i + 1];
        if (nextPage && result.pageBoundary) {
          // Page split: The end of our current page is less than the start of the next page.
          if (result.pageBoundary < nextPage.start) {
            console.log("Splitting page starting at ", start);
            const newPageStart = result.pageBoundary;
            const newPage: Page = {
              start: newPageStart,
              unsubscribe: this.convex.onUpdate(
                api.messages.paginateMessages,
                { start: result.pageBoundary, log2PageSize: LOG2_PAGE_SIZE },
                (result) => {
                  this.receivePage(newPageStart, result);
                },
              ),
              state: { kind: "loading" },
            };
            this.pages.splice(i + 1, 0, newPage);            
          }

          // Page merge: The end of our current page is greater than the start of the next page.
          let toRemove = 0;
          for (let j = i + 1; j < this.pages.length; j++) {
            const nextPage = this.pages[j];
            if (result.pageBoundary <= nextPage.start) {
              break;
            }
            console.log(
              "Merging pages starting at ",
              start,
              " and ",
              nextPage.start,
            );
            nextPage.unsubscribe();
            toRemove++;
          }
          if (toRemove > 0) {
            this.pages.splice(i + 1, toRemove);
          }
        }        
        this.onChanged.forEach(fn => fn());
        return;
      }
    }    
  }

  allMessages() {
    return this.pages.flatMap(page => {
      if (page.state.kind === "loaded") {
        return page.state.messages;
      }
      return [];
    });    
  }

  useMessages() {
    const [_, setUpdate] = useState(0);    
    useEffect(() => {
      const onChanged = () => setUpdate(update => update + 1);
      this.onChanged.add(onChanged);
      return () => {
        this.onChanged.delete(onChanged);
      };
    }, []);
    return this.allMessages();
  }

  loadMore() {
    const lastPage = this.pages[this.pages.length - 1];
    if (!lastPage) {
      return;
    }
    if (lastPage.state.kind === "loading") {
      console.log("Last page already loading");
      return;
    }
    if (!lastPage.state.end) {
      console.log("Already at end");
      return;
    }
    console.log("Loading next page");
    const nextPageStart = lastPage.state.end;
    const nextPage: Page = {
      start: nextPageStart,
      unsubscribe: this.convex.onUpdate(
        api.messages.paginateMessages,
        { start: nextPageStart, log2PageSize: LOG2_PAGE_SIZE },
        (result) => {
          this.receivePage(nextPageStart, result);
        },
      ),
      state: { kind: "loading" },
    };
    this.pages.push(nextPage);
  }
}

function visualizePaginator(paginator?: PaginationState) {
  if (!paginator) {
    return;
  }
  const pages = paginator.pages.map(page => {
    return (
      <ul>
        <li>
          State: {page.state.kind}
        </li>
        <li>
          Start: {page.start}
        </li>
        {page.state.kind === "loaded" && (
          <>
            <li>
              Messages: {page.state.messages.length}
            </li>
          <li>
            End: {page.state.end}
          </li>
          </>
        )}
      </ul>
    )
  });
  return (
    <div className="border-t">
      <ol>
        {pages.map((page, index) => (
          <li key={index}>
            <span>Page {index}</span>
            {page}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Chat({ viewer }: { viewer: string }) {
  const [newMessageText, setNewMessageText] = useState("");  
  const sendMessage = useMutation(api.messages.send);

  const paginator = useRef<PaginationState>();
  if (paginator.current === undefined) {
    paginator.current = new PaginationState();
  }

  const messages = paginator.current.useMessages();
  console.log(`${messages.length} messages loaded`);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNewMessageText("");
    sendMessage({ body: newMessageText, author: viewer }).catch((error) => {
      console.error("Failed to send message:", error);
    });
  };

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
      <Button onClick={() => paginator.current?.loadMore()}>Load More</Button>
      {visualizePaginator(paginator.current)}
    </>
  );
}
