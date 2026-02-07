import picomatch from "picomatch";
import { z } from "zod";

export type PermissionOp = "read" | "write" | "exec" | "network";
export type PermissionDecision = "allow" | "deny" | "ask";

const decisionSchema = z.enum(["allow", "deny", "ask"]);
const decisionMapSchema = z.record(z.string(), decisionSchema);

export const PermissionPolicySchema = z.record(
  z.string(),
  z.union([decisionSchema, decisionMapSchema]),
);

export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;

export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  "*": "ask",
  read: "allow",
  write: "ask",
  exec: "ask",
  network: "ask",
};

export function normalizePolicy(input?: unknown): PermissionPolicy {
  if (!input) return { ...DEFAULT_PERMISSION_POLICY };
  const parsed = PermissionPolicySchema.parse(input);
  return { ...DEFAULT_PERMISSION_POLICY, ...parsed };
}

function applyPatternMap(
  decisionMap: Record<string, PermissionDecision>,
  target: string,
  initial: PermissionDecision,
): PermissionDecision {
  let result = initial;
  if ("*" in decisionMap) {
    result = decisionMap["*"];
  }

  for (const [pattern, decision] of Object.entries(decisionMap)) {
    if (pattern === "*") continue;
    if (pattern === target || picomatch.isMatch(target, pattern)) result = decision;
  }
  return result;
}

export function evaluatePermission(input: {
  policy: PermissionPolicy;
  op: PermissionOp;
  subject?: string;
  target?: string;
}): PermissionDecision {
  const { policy, op, subject, target } = input;
  const effectiveTarget = target ?? subject ?? "*";

  const root = policy["*"];
  let result: PermissionDecision = typeof root === "string" ? root : "ask";

  const opRule = policy[op];
  if (typeof opRule === "string") {
    result = opRule;
  } else if (opRule) {
    result = applyPatternMap(opRule, effectiveTarget, result);
  }

  if (subject) {
    const subjectRule = policy[subject];
    if (typeof subjectRule === "string") {
      result = subjectRule;
    } else if (subjectRule) {
      result = applyPatternMap(subjectRule, effectiveTarget, result);
    }
  }

  return result;
}

export function appendPolicyRule(input: {
  policy: PermissionPolicy;
  key: string;
  pattern: string;
  decision: PermissionDecision;
}): PermissionPolicy {
  const { policy, key, pattern, decision } = input;
  const next: PermissionPolicy = { ...policy };

  const existing = next[key];
  if (!existing) {
    next[key] = { [pattern]: decision };
    return next;
  }

  if (typeof existing === "string") {
    next[key] = {
      "*": existing,
      [pattern]: decision,
    };
    return next;
  }

  next[key] = {
    ...existing,
    [pattern]: decision,
  };
  return next;
}
