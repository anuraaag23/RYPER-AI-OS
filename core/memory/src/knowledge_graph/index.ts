export interface Entity {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
}

export interface Relation {
  readonly from: string; // entity id
  readonly to: string; // entity id
  readonly type: string;
}

/**
 * Small in-memory entity/relation graph. Populated incrementally from
 * conversations and documents (extraction logic lives in the RAG package);
 * this class owns only storage and traversal.
 */
export class KnowledgeGraph {
  private readonly entities = new Map<string, Entity>();
  private readonly relations: Relation[] = [];

  upsertEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
  }

  addRelation(relation: Relation): void {
    if (!this.entities.has(relation.from) || !this.entities.has(relation.to)) {
      throw new Error("both entities in a relation must already exist in the graph");
    }
    this.relations.push(relation);
  }

  neighbors(entityId: string): Entity[] {
    const neighborIds = new Set<string>();
    for (const rel of this.relations) {
      if (rel.from === entityId) neighborIds.add(rel.to);
      if (rel.to === entityId) neighborIds.add(rel.from);
    }
    return [...neighborIds]
      .map((id) => this.entities.get(id))
      .filter((e): e is Entity => e !== undefined);
  }

  relationsOf(entityId: string): readonly Relation[] {
    return this.relations.filter((r) => r.from === entityId || r.to === entityId);
  }

  getEntity(entityId: string): Entity | undefined {
    return this.entities.get(entityId);
  }

  size(): { entities: number; relations: number } {
    return { entities: this.entities.size, relations: this.relations.length };
  }
}
