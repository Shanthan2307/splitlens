import { describe, expect, it } from "vitest";
import { exceededLimit, RECEIPT_RATE_LIMITS } from "./rate-limit";

describe("exceededLimit", () => {
  it("allows usage under every limit", () => {
    expect(exceededLimit([0, 0])).toBeNull();
    expect(exceededLimit([9, 99])).toBeNull();
  });
  it("reports the first exceeded window", () => {
    expect(exceededLimit([10, 10])).toBe(RECEIPT_RATE_LIMITS[0]);
    expect(exceededLimit([3, 100])).toBe(RECEIPT_RATE_LIMITS[1]);
  });
});
