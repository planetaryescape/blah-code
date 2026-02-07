import { describe, expect, it } from "bun:test";
import {
  appendPolicyRule,
  evaluatePermission,
  normalizePolicy,
} from "./index";

describe("policy", () => {
  it("defaults read allow, write ask", () => {
    const policy = normalizePolicy();
    expect(evaluatePermission({ policy, op: "read", subject: "read_file" })).toBe(
      "allow",
    );
    expect(
      evaluatePermission({ policy, op: "write", subject: "write_file" }),
    ).toBe("ask");
  });

  it("supports pattern map per op", () => {
    const policy = normalizePolicy({
      exec: {
        "git status": "allow",
        "*": "ask",
      },
    });

    expect(
      evaluatePermission({ policy, op: "exec", target: "git status" }),
    ).toBe("allow");
    expect(
      evaluatePermission({ policy, op: "exec", target: "rm -rf /" }),
    ).toBe("ask");
  });

  it("append rule converts scalar to map", () => {
    const policy = normalizePolicy({ exec: "ask" });
    const next = appendPolicyRule({
      policy,
      key: "exec",
      pattern: "npm test",
      decision: "allow",
    });

    expect(
      evaluatePermission({ policy: next, op: "exec", target: "npm test" }),
    ).toBe("allow");
  });
});
