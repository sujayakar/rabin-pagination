import { IndexRangeBounds } from "./types";


export type Query = {
  count: number;
  indexRangeBounds: IndexRangeBounds;
  order: "asc" | "desc";
};

export type QueryResult = {
  kind: "loaded";
  status: "success";
  value: any[];
} |
{
  kind: "loaded";
  status: "error";
  error: any;
} |
{ kind: "loading"; };
