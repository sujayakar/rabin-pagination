import { GenericDocument } from "convex/server";

export type QueryId = string;

export type PageId = string;
export type Page = {
  pageId: PageId;
  state: { kind: "loading"; target: Key; } |
  { kind: "loaded"; value: PageResult; };
};

export type PageArguments = {
  target: Key;
  log2PageSize: number;
};

export type PageResult = {
  results: GenericDocument[];
  lowerBound: LowerBound;
  upperBound: UpperBound;
};

export type LowerBound = { kind: "successor"; value: IndexPrefix; } |
  typeof MINIMAL_KEY;

export type UpperBound = ExactKey | typeof MAXIMAL_KEY;
export type IndexKey = ReadonlyArray<any>;
export type IndexPrefix = ReadonlyArray<any>;

export const MAXIMAL_KEY = {
  kind: "successor",
  value: [],
} as const;

export const MINIMAL_KEY = {
  kind: "predecessor",
  value: [],
} as const;

export type ExactKey = {
  kind: "exact";
  value: IndexKey;
};

export const isMaximal = (c: Key): c is typeof MAXIMAL_KEY => {
  return c.kind === "successor" && c.value.length === 0;
};

export const isMinimal = (c: Key): c is typeof MINIMAL_KEY => {
  return c.kind === "predecessor" && c.value.length === 0;
};

export const isExact = (c: Key): c is ExactKey => {
  return c.kind === "exact";
};

export type Key = {
  kind: "successor" | "predecessor";
  value: IndexPrefix;
} |
  ExactKey;

export type IndexRangeBounds = {
  lowerBound: IndexPrefix;
  lowerBoundInclusive: boolean;
  upperBound: IndexPrefix;
  upperBoundInclusive: boolean;
};
