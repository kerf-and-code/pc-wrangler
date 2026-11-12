// tests/push-id.test.ts (push 44): the time in a Roll20 chat message id
import { describe, expect, it } from "vitest";
import { pushIdTime } from "@/lib/vtt/push-id";

describe("pushIdTime", () => {
  it("reads the time from real Roll20 message ids", () => {
    expect(new Date(pushIdTime("-P6DCMtQdQv71tOt0F9w")!).toISOString()).toBe("2026-11-12T05:22:54.683Z");
    expect(new Date(pushIdTime("-P6DCh2rCU4ckzTRskQR")!).toISOString()).toBe("2026-11-12T05:24:21.367Z");
  });
  it("is null for anything that is not a push id", () => {
    expect(pushIdTime("h:abc")).toBeNull();
    expect(pushIdTime("-P6DCMtQdQv71tOt0F9")).toBeNull();
    expect(pushIdTime("-P6DCMtQdQv71tOt0F9!")).toBeNull();
    expect(pushIdTime("00000000000000000000")).toBeNull();
    expect(pushIdTime(null)).toBeNull();
  });
});
