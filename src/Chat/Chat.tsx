"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConvex, useMutation } from "convex/react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { MessageList } from "@/Chat/MessageList";
import { Message } from "@/Chat/Message";
import { Doc } from "../../convex/_generated/dataModel";
import { ConvexClient } from "convex/browser";
import { Atom } from "jotai";
import { atomFamily } from "jotai/utils";
import { Paginator22, SubscriptionState } from "./paginator2";
// TODO: 
// - Client interest is a position + count: load more as needed, can have multiple
// - Given a client interest, return partial results and a loading flag
// - Check that page splits and merges work
// - Free pages that don't overlap with a client interest
// - Compute page boundaries based on document size 
// - Make data source generic
// - Support unions, joins, etc.

// type Unsubscribe<T> = {
//   (): void;
//   unsubscribe(): void;
//   getCurrentValue(): T | undefined;
// };

// const LOG2_PAGE_SIZE = 4;

// type Page = {
//   start: number;
//   unsubscribe: Unsubscribe<{
//     messages: Doc<"messages">[];
//     pageBoundary: number | null;
//   }>;
//   state: PageState;
// };

// type Subscription = {
//   start: number;
//   count: number;  
//   state: SubscriptionState;
//   updateState: (state: SubscriptionState) => void;
// }

// type SubscriptionState = {
//   loading: boolean;
//   results: Doc<"messages">[];  
// }

// type PageState =
//   | { kind: "loading" }
//   | { kind: "loaded"; messages: Doc<"messages">[]; end: number | null };

// class PaginationState {
//   // Sorted by descending creation time.
//   pages: Page[] = [];
//   convex: ConvexClient;

//   onChanged: Set<() => void> = new Set();
//   subscriptions: Set<Subscription> = new Set();

//   constructor() {
//     this.convex = new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
//     const start = Number.MAX_VALUE;
//     const unsubscribe = this.convex.onUpdate(
//       api.messages.paginateMessages,
//       { start, log2PageSize: LOG2_PAGE_SIZE },
//       (result) => {
//         this.receivePage(start, result);
//       },
//     );
//     this.pages.push({ start, unsubscribe, state: { kind: "loading" } });
//   }

//   collectSubscription(start: number, count: number) {
//     const results = [];
//     let loading = false;    
//     for (const page of this.pages) {
//       if (page.state.kind === "loading") {
//         if (0 < results.length && results.length < count) {
//           loading = true;
//         }
//         continue;        
//       }
//       for (const message of page.state.messages) {
//         if (message._creationTime > start || results.length >= count) {
//           continue;
//         }
//         results.push(message);        
//       }
//     }
//     return {
//       loading,
//       results,
//     }
//   }

//   useSubscription(start: number, count: number) {        
//     const [state, setState] = useState<SubscriptionState>({
//       loading: false,
//       results: [],
//     });
//     useEffect(() => {
//       const currentState = this.collectSubscription(start, count);
//       setState(currentState);
//       const subscription: Subscription = {
//         start,
//         count,
//         state: currentState,
//         updateState: setState, 
//       };    
//       this.subscriptions.add(subscription);
//       return () => {
//         this.subscriptions.delete(subscription);
//       };
//     }, [start, count]);
//     return state;
//   }  

//   receivePage(
//     start: number,
//     result: { messages: Doc<"messages">[]; pageBoundary: number | null },
//   ) {
//     console.log(
//       `Received ${result.messages.length} @ ${start} => ${result.pageBoundary}`,
//     );
//     for (let i = 0; i < this.pages.length; i++) {
//       const page = this.pages[i];
//       if (page.start === start) {
//         page.state = {
//           kind: "loaded",
//           messages: result.messages,
//           end: result.pageBoundary,
//         };

//         let nextPage = this.pages[i + 1];
//         if (nextPage && result.pageBoundary) {
//           // Page split: The end of our current page is less than the start of the next page.
//           if (result.pageBoundary < nextPage.start) {
//             console.log("Splitting page starting at ", start);
//             const newPageStart = result.pageBoundary;
//             const newPage: Page = {
//               start: newPageStart,
//               unsubscribe: this.convex.onUpdate(
//                 api.messages.paginateMessages,
//                 { start: result.pageBoundary, log2PageSize: LOG2_PAGE_SIZE },
//                 (result) => {
//                   this.receivePage(newPageStart, result);
//                 },
//               ),
//               state: { kind: "loading" },
//             };
//             this.pages.splice(i + 1, 0, newPage);            
//           }

//           // Page merge: The end of our current page is greater than the start of the next page.
//           let toRemove = 0;
//           for (let j = i + 1; j < this.pages.length; j++) {
//             const nextPage = this.pages[j];
//             if (result.pageBoundary <= nextPage.start) {
//               break;
//             }
//             console.log(
//               "Merging pages starting at ",
//               start,
//               " and ",
//               nextPage.start,
//             );
//             nextPage.unsubscribe();
//             toRemove++;
//           }
//           if (toRemove > 0) {
//             this.pages.splice(i + 1, toRemove);
//           }
//         }        
//         for (const subscription of this.subscriptions) {
//           subscription.updateState(this.collectSubscription(subscription.start, subscription.count));
//         }
//         return;
//       }
//     }    
//   }

//   loadMore() {
//     const lastPage = this.pages[this.pages.length - 1];
//     if (!lastPage) {
//       return;
//     }
//     if (lastPage.state.kind === "loading") {
//       console.log("Last page already loading");
//       return;
//     }
//     if (!lastPage.state.end) {
//       console.log("Already at end");
//       return;
//     }
//     console.log("Loading next page");
//     const nextPageStart = lastPage.state.end;
//     const nextPage: Page = {
//       start: nextPageStart,
//       unsubscribe: this.convex.onUpdate(
//         api.messages.paginateMessages,
//         { start: nextPageStart, log2PageSize: LOG2_PAGE_SIZE },
//         (result) => {
//           this.receivePage(nextPageStart, result);
//         },
//       ),
//       state: { kind: "loading" },
//     };
//     this.pages.push(nextPage);
//   }
// }

// // Subscription -> Set<PageSubscriptions>
// // PageSubscription -> PageValues
// // Subscription + PageValues -> SubscriptionResults

// type ClientSubscription = {
//   start: number,
//   count: number,
// }

// type ServerSubscription = {
//   start: number,
//   state: ServerSubscriptionState,
// }


// type ServerSubscriptionState = 
//   | { type: "loading" }
//   | { type: "loaded", pages: Doc<"messages">[], end: number | null }

// function visualizePaginator(paginator?: PaginationState) {
//   if (!paginator) {
//     return;
//   }
//   const pages = paginator.pages.map(page => {
//     return (
//       <ul>
//         <li>
//           State: {page.state.kind}
//         </li>
//         <li>
//           Start: {page.start}
//         </li>
//         {page.state.kind === "loaded" && (
//           <>
//             <li>
//               Messages: {page.state.messages.length}
//             </li>
//           <li>
//             End: {page.state.end}
//           </li>
//           </>
//         )}
//       </ul>
//     )
//   });
//   return (
//     <div className="border-t">
//       <ol>
//         {pages.map((page, index) => (
//           <li key={index}>
//             <span>Page {index}</span>
//             {page}
//           </li>
//         ))}
//       </ol>
//     </div>
//   )
// }

const convex = new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);

export function Chat({ viewer }: { viewer: string }) {
  const [newMessageText, setNewMessageText] = useState("");  
  const sendMessage = useMutation(api.messages.send);

  
  const paginator = useRef<Paginator22>();
  if (!paginator.current) {
    paginator.current = new Paginator22(convex);
  }

  const [start, setStart] = useState(0);
  const [numRows, setNumRows] = useState(10);

  const [result, setResult] = useState<SubscriptionState>({ loading: true, results: []});
  useEffect(() => {
    return paginator.current!.subscribe(start, numRows, setResult);
  }, [paginator, start, numRows])


  // const paginator = useRef<PaginationState>();
  // if (paginator.current === undefined) {
  //   paginator.current = new PaginationState();
  // }

  // const { results: messages, loading } = paginator.current.useSubscription(Number.MAX_VALUE, 10);
  // console.log(`${messages.length} messages loaded: ${loading ? "loading" : "ready"}`);

  const messages = result.results;

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
      <Button onClick={() => setNumRows(numRows + 10)}>{result.loading ? "Loading..." : "Load More"}</Button>
      <Button onClick={() => clearAll()}>Clear all</Button>
      {/* {visualizePaginator(paginator.current)} */}
    </>
  );
}
