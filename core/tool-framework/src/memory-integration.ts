import type { MemoryManager } from "@ryper/memory-system";
import type { ToolResult } from "./types.js";

const FAVORITE_TAG = "tool_favorite";
const HISTORY_TAG = "tool_history";
const SETTING_TAG_PREFIX = "tool_setting:";

/**
 * Everything the brief's Memory Integration section asks for — frequently
 * used tools, invocation history, preferred settings, favorites — layered
 * entirely on `MemoryManager`'s public API (`createMemoryAuto`,
 * `filterMemories`). No new persistence mechanism, no direct
 * `MemoryStore`/`MemoryIndex` access.
 */
export class ToolMemoryIntegration {
  constructor(private readonly memory: MemoryManager) {}

  async recordInvocation(
    toolId: string,
    result: ToolResult,
    actor = "tool-framework",
  ): Promise<void> {
    await this.memory.createMemoryAuto(
      toolId,
      { type: "task", tags: [HISTORY_TAG], metadata: { status: result.status } },
      actor,
    );
  }

  /** Ranks tools by how many `tool_history`-tagged memories mention them — a simple frequency count. */
  frequentlyUsedTools(limit = 5): readonly { toolId: string; count: number }[] {
    const records = this.memory.filterMemories({ tag: HISTORY_TAG });
    const counts = new Map<string, number>();
    for (const record of records) {
      counts.set(record.content, (counts.get(record.content) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([toolId, count]) => ({ toolId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async markFavorite(toolId: string, actor = "user"): Promise<void> {
    await this.memory.createMemoryAuto(toolId, { type: "preference", tags: [FAVORITE_TAG] }, actor);
  }

  isFavorite(toolId: string): boolean {
    return this.memory
      .filterMemories({ type: "preference", tag: FAVORITE_TAG })
      .some((record) => record.content === toolId);
  }

  favorites(): readonly string[] {
    return this.memory
      .filterMemories({ type: "preference", tag: FAVORITE_TAG })
      .map((record) => record.content);
  }

  async rememberSetting(toolId: string, key: string, value: string, actor = "user"): Promise<void> {
    await this.memory.createMemoryAuto(
      value,
      { type: "preference", tags: [`${SETTING_TAG_PREFIX}${toolId}:${key}`] },
      actor,
    );
  }

  getSetting(toolId: string, key: string): string | undefined {
    const matches = this.memory.filterMemories({
      type: "preference",
      tag: `${SETTING_TAG_PREFIX}${toolId}:${key}`,
    });
    const [latest] = [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return latest?.content;
  }
}

export function createToolMemoryIntegration(memory: MemoryManager): ToolMemoryIntegration {
  return new ToolMemoryIntegration(memory);
}
