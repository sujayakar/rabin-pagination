import { atom, Atom, PrimitiveAtom, useAtom, useSetAtom } from "jotai";
import { Doc } from "../../convex/_generated/dataModel";
import { useEffect } from "react";

type Key = number;

// Subscription -> Set<PageSubscriptions>
// PageSubscription -> PageValues
// Subscription + PageValues -> SubscriptionResults
type Subscription = {
  start: Key;
  count: number;
};

type SubscriptionState = 
  | { type: "loading", streamingResults: Doc<"messages">[] }
  | { type: "loaded", results: Doc<"messages">[] }

type Page = {
  start: Key;
  state: PageState;
};
type PageState = 
  | { type: "loading"; } 
  | { type: "loaded"; pages: Doc<"messages">[]; end: Key | null; };

type SubscriptionId = number;  

class Paginator2 {  
  nextSubscriptionId = 0;

  subscriptions: PrimitiveAtom<Map<SubscriptionId, Subscription>>;  
  subscriptionStates: Map<SubscriptionId, PrimitiveAtom<SubscriptionState>>;

  // Sorted in ascending `key` order.
  pages: Atom<Array<{ key: Key, page: Atom<PageState> }>>;


  constructor() {
      this.subscriptions = atom(new Map());
      this.subscriptionStates = new Map();
      this.pages = atom([]);
  }

  useSubscription(start: Key, count: number) {     
    const [subscriptions, setSubscriptions] = useAtom(this.subscriptions);    
    useEffect(() => {
      const subscriptionId = this.nextSubscriptionId++;
      const subscription = { start, count };

      const subscriptionState = atom<SubscriptionState>({ type: "loading", streamingResults: [] });

      this.subscriptionStates.set(subscriptionId, subscriptionState);
      setSubscriptions((subs) => {
        subs.set(subscriptionId, subscription);
        return subs;
      });
      return () => {
        this.subscriptionStates.delete(subscriptionId);
        setSubscriptions((subs) => {
          subs.delete(subscriptionId);
          return subs;
        });
      }
    }, [start, count, setSubscriptions]);



  }
}


// client -> subscription + subscription state
// subscription state + interval state -> return value

// subscriptions -> intervals
// interval state