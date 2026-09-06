import { describe, expect, it } from "vitest";
import { floatTo16BitPcm, resamplePcm16 } from "../src/audio/resample.js";

describe("resamplePcm16", () => {
  it("returns the same array (by identity) when the rates already match", () => {
    const input = new Int16Array([1, 2, 3]);
    expect(resamplePcm16(input, 48000, 48000)).toBe(input);
  });

  it("downsamples 48000Hz -> 16000Hz to roughly a third of the samples", () => {
    const input = new Int16Array(4800).fill(1000);
    const output = resamplePcm16(input, 48000, 16000);
    expect(output.length).toBe(1600);
  });

  it("upsamples 16000Hz -> 48000Hz to roughly three times the samples", () => {
    const input = new Int16Array(1600).fill(1000);
    const output = resamplePcm16(input, 16000, 48000);
    expect(output.length).toBe(4800);
  });

  it("preserves a constant signal's amplitude through resampling", () => {
    const input = new Int16Array(4800).fill(12345);
    const output = resamplePcm16(input, 48000, 16000);
    for (const sample of output) expect(sample).toBe(12345);
  });

  it("interpolates linearly between two known sample values", () => {
    // fromRate=4, toRate=2: output[i] samples at input index 2*i.
    const input = new Int16Array([0, 100, 200, 300]);
    const output = resamplePcm16(input, 4, 2);
    expect(Array.from(output)).toEqual([0, 200]);
  });

  it("clamps interpolated values to the valid Int16 range", () => {
    const input = new Int16Array([32767, 32767]);
    const output = resamplePcm16(input, 2, 2);
    expect(output[0]).toBeLessThanOrEqual(32767);
    expect(output[0]).toBeGreaterThanOrEqual(-32768);
  });

  it("handles an empty input without throwing", () => {
    expect(resamplePcm16(new Int16Array(0), 48000, 16000)).toEqual(new Int16Array(0));
  });

  it("throws for non-positive sample rates rather than producing garbage", () => {
    expect(() => resamplePcm16(new Int16Array([1]), 0, 16000)).toThrow();
    expect(() => resamplePcm16(new Int16Array([1]), 16000, -1)).toThrow();
  });
});

describe("floatTo16BitPcm", () => {
  it("maps the full [-1, 1] float range onto the Int16 range", () => {
    const output = floatTo16BitPcm(new Float32Array([1, -1, 0]));
    expect(output[0]).toBe(32767);
    expect(output[1]).toBe(-32768);
    expect(output[2]).toBe(0);
  });

  it("clamps out-of-range float samples instead of overflowing", () => {
    const output = floatTo16BitPcm(new Float32Array([2.5, -3.7]));
    expect(output[0]).toBe(32767);
    expect(output[1]).toBe(-32768);
  });

  it("preserves array length", () => {
    const output = floatTo16BitPcm(new Float32Array(4096));
    expect(output.length).toBe(4096);
  });
});
