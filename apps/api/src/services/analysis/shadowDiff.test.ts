import { describe, expect, test } from "bun:test";
import { diffResponses } from "./shadowDiff";

describe("diffResponses", () => {
  test("identical payloads have no divergences", () => {
    const a = { score: { value: 90, components: [{ key: "resource", points: 45 }] } };
    expect(diffResponses(a, structuredClone(a))).toEqual([]);
  });

  test("score.value carries +-0.5 slack", () => {
    expect(diffResponses({ score: { value: 90 } }, { score: { value: 90.4 } })).toEqual([]);
    expect(diffResponses({ score: { value: 90 } }, { score: { value: 91 } })).toHaveLength(1);
  });

  test("other floats compare within abs/rel 1e-6", () => {
    expect(diffResponses({ aoi: { areaKm2: 25.1105 } }, { aoi: { areaKm2: 25.1105 + 1e-7 } })).toEqual([]);
    const big = diffResponses({ aoi: { areaKm2: 25.1105 } }, { aoi: { areaKm2: 25.111 } });
    expect(big).toHaveLength(1);
    expect(big[0]!.path).toBe("aoi.areaKm2");
  });

  test("flags missing and extra keys", () => {
    const miss = diffResponses({ a: 1, b: 2 }, { a: 1 });
    expect(miss).toEqual([{ path: "b", legacy: 2, service: "<MISSING>" }]);
    const extra = diffResponses({ a: 1 }, { a: 1, b: 2 });
    expect(extra).toEqual([{ path: "b", legacy: "<ABSENT>", service: 2 }]);
  });

  test("array length mismatch is one divergence", () => {
    expect(diffResponses({ xs: [1, 2, 3] }, { xs: [1, 2] })).toHaveLength(1);
  });

  test("strings, booleans and null compare exactly", () => {
    expect(diffResponses({ s: "ok", b: true, n: null }, { s: "ok", b: true, n: null })).toEqual([]);
    expect(diffResponses({ s: "ok" }, { s: "unavailable" })).toHaveLength(1);
    expect(diffResponses({ b: true }, { b: false })).toHaveLength(1);
  });

  test("walks nested sections", () => {
    const legacy = { sections: { resource: { status: "ok", data: { meanSpeed: 9.72 } } } };
    const service = { sections: { resource: { status: "ok", data: { meanSpeed: 9.73 } } } };
    const d = diffResponses(legacy, service);
    expect(d).toHaveLength(1);
    expect(d[0]!.path).toBe("sections.resource.data.meanSpeed");
  });
});
