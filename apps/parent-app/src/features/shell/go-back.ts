// Back behaviour shared by every Stack_Route header: go back when there is somewhere to go
// back to, otherwise land on Home (Req 3.5, 4.7).
//
// `screen-header.tsx` keeps its own copy of this four-line function, because Req 1.3 bars edits
// to an existing kit component. The duplication is recorded in the Design_System_Doc.

import { router } from "expo-router";

import { ROUTE_PATH } from "./routes";

export function goBack(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(ROUTE_PATH.home);
}
