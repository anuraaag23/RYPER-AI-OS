import { describe, expect, it } from "vitest";
import type { ToolSpec } from "@ryper/ai-engine";
import { createDesktopToolSelector } from "../electron/desktop-tool-selector.js";

const mockAllTools: ToolSpec[] = [
  { name: "open_application", description: "Opens an application", parameters: { type: "object", properties: {} } },
  { name: "close_application", description: "Closes an application", parameters: { type: "object", properties: {} } },
  { name: "open_folder", description: "Opens a folder", parameters: { type: "object", properties: {} } },
  { name: "open_file", description: "Opens a file", parameters: { type: "object", properties: {} } },
  { name: "get_power_status", description: "Checks battery", parameters: { type: "object", properties: {} } },
  { name: "shutdown", description: "Powers off", parameters: { type: "object", properties: {} } },
  { name: "set_volume", description: "Sets volume", parameters: { type: "object", properties: {} } },
  { name: "mute", description: "Mutes volume", parameters: { type: "object", properties: {} } },
  { name: "inspect_registry_key", description: "Registry", parameters: { type: "object", properties: {} } },
  { name: "list_services", description: "Services", parameters: { type: "object", properties: {} } },
];

describe("createDesktopToolSelector", () => {
  const selector = createDesktopToolSelector();

  it("returns zero tools for conversational greetings and general knowledge questions", () => {
    expect(selector("hello", mockAllTools, [])).toEqual([]);
    expect(selector("Hi, who are you?", mockAllTools, [])).toEqual([]);
    expect(selector("Why is the sky blue?", mockAllTools, [])).toEqual([]);
    expect(selector("Tell me a funny joke about programming", mockAllTools, [])).toEqual([]);
    expect(selector("Explain how neural networks learn", mockAllTools, [])).toEqual([]);
  });

  it("returns application tools when asking to open or launch an app", () => {
    const result = selector("open notepad", mockAllTools, []);
    const names = result.map((t) => t.name);
    expect(names).toContain("open_application");
    expect(names).toContain("close_application");
    expect(names).not.toContain("inspect_registry_key");
  });

  it("returns folder and file tools when asking to open a directory or folder", () => {
    const result = selector("open Downloads", mockAllTools, []);
    const names = result.map((t) => t.name);
    expect(names).toContain("open_folder");
    expect(names).toContain("open_file");
    expect(names).not.toContain("inspect_registry_key");
  });

  it("returns power tools when asking for battery or power status", () => {
    const result = selector("what is my battery level?", mockAllTools, []);
    const names = result.map((t) => t.name);
    expect(names).toContain("get_power_status");
    expect(names).toContain("shutdown");
    expect(names).not.toContain("open_folder");
  });

  it("returns audio tools when asking to change volume or mute", () => {
    const result = selector("mute sound", mockAllTools, []);
    const names = result.map((t) => t.name);
    expect(names).toContain("mute");
    expect(names).toContain("set_volume");
  });

  it("returns tools when follow-up keyword 'again' is used", () => {
    const result = selector("again", mockAllTools, []);
    expect(result.length).toBeGreaterThan(0);
    const names = result.map((t) => t.name);
    expect(names).toContain("open_application");
    expect(names).toContain("open_folder");
  });

  it("handles Hinglish volume and power queries", () => {
    const volumeResult = selector("awaj kam karo", mockAllTools, []);
    expect(volumeResult.map((t) => t.name)).toContain("set_volume");

    const powerResult = selector("laptop band karo", mockAllTools, []);
    expect(powerResult.map((t) => t.name)).toContain("shutdown");
  });
});
