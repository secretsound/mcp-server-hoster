import {
  allowsServer,
  allowsTool,
  FULL_ACCESS,
  isSubsetOf,
  normalizeGrants,
} from "../src/auth/scopes.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const ceiling = normalizeGrants([
  { serverId: "mealie", tools: ["*"] },
  { serverId: "time", tools: ["get_current_time"] },
]);

assert(isSubsetOf([{ serverId: "mealie", tools: ["search"] }], ceiling), "mealie subset");
assert(
  isSubsetOf([{ serverId: "time", tools: ["get_current_time"] }], ceiling),
  "time tool subset",
);
assert(
  !isSubsetOf([{ serverId: "time", tools: ["*"] }], ceiling),
  "time * exceeds ceiling",
);
assert(
  !isSubsetOf([{ serverId: "other", tools: ["*"] }], ceiling),
  "other server not allowed",
);
assert(isSubsetOf(ceiling, FULL_ACCESS), "full access covers all");
assert(allowsTool(ceiling, "mealie", "anything"), "mealie *");
assert(allowsTool(ceiling, "time", "get_current_time"), "time tool");
assert(!allowsTool(ceiling, "time", "other"), "time other denied");
assert(allowsServer(ceiling, "mealie"), "mealie server grant");
assert(allowsServer(ceiling, "time"), "time server grant");
assert(!allowsServer(ceiling, "other"), "other server denied");
assert(allowsServer(FULL_ACCESS, "anything"), "full access server");

console.log("scopes OK");
