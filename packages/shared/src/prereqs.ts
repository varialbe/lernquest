import type { KnowledgeEntry, PrereqLink, PrereqType } from './knowledge.ts';

export type PathEntry = { id: string; unitNumber: number; order: number; requires: PrereqLink[] };
export type LearningPaths = {
  core: { ids: string[]; depth: number };
  extended: { ids: string[]; backgroundIds: string[]; depth: number };
};

/** Folgt Alias-Ketten defensiv; fehlerhafte Zyklen enden stabil an der ersten ID. */
export function canonicalEntryId(id: string, aliases: Record<string, string> = {}): string {
  const seen = new Set<string>();
  let current = id;
  while (aliases[current] && !seen.has(current)) {
    seen.add(current);
    current = aliases[current]!;
  }
  return current;
}

/**
 * Liefert Kernpfad und erweiterten Pfad als topologische Reihenfolge.
 * Kanten zeigen vom Ziel auf seine Voraussetzung, daher stehen prerequisites zuerst.
 */
export function buildLearningPaths(
  target: string,
  entries: PathEntry[],
  aliases: Record<string, string> = {},
): LearningPaths {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const canonical = (id: string) => canonicalEntryId(id, aliases);
  const closure = (include: (type: PrereqType) => boolean) => {
    const found = new Set<string>();
    const visit = (rawId: string) => {
      const id = canonical(rawId);
      if (found.has(id) || !byId.has(id)) return;
      found.add(id);
      for (const link of byId.get(id)!.requires) if (include(link.type)) visit(link.id);
    };
    visit(target);
    return found;
  };
  const coreSet = closure((type) => type === 'essential');
  const extendedSet = closure((type) => type === 'essential' || type === 'background');
  const compare = (a: string, b: string) => {
    const x = byId.get(a)!;
    const y = byId.get(b)!;
    return x.unitNumber - y.unitNumber || x.order - y.order || a.localeCompare(b);
  };
  const topological = (included: Set<string>, include: (type: PrereqType) => boolean) => {
    const needs = new Map<string, Set<string>>();
    const dependents = new Map<string, string[]>();
    for (const id of included) {
      const prerequisites = new Set(
        byId.get(id)!.requires
          .filter((l) => include(l.type))
          .map((l) => canonical(l.id))
          .filter((p) => included.has(p) && byId.has(p) && p !== id),
      );
      needs.set(id, prerequisites);
      for (const prereq of prerequisites) dependents.set(prereq, [...(dependents.get(prereq) ?? []), id]);
    }
    const ready = [...included].filter((id) => (needs.get(id)?.size ?? 0) === 0).sort(compare);
    const out: string[] = [];
    while (ready.length) {
      const id = ready.shift()!;
      out.push(id);
      for (const dependent of dependents.get(id) ?? []) {
        const remaining = needs.get(dependent)!;
        remaining.delete(id);
        if (!remaining.size) {
          ready.push(dependent);
          ready.sort(compare);
        }
      }
    }
    // Zyklus-Schutz beim Rendern; wissen-check meldet die eigentliche Datenverletzung.
    for (const id of [...included].sort(compare)) if (!out.includes(id)) out.push(id);
    const depth = new Map<string, number>();
    for (const id of out) {
      const prereqs = byId.get(id)!.requires
        .filter((l) => include(l.type) && canonical(l.id) !== id && included.has(canonical(l.id)))
        .map((l) => depth.get(canonical(l.id)) ?? 0);
      depth.set(id, (prereqs.length ? Math.max(...prereqs) : 0) + 1);
    }
    return { ids: out, depth: Math.max(0, ...depth.values()) };
  };
  const core = topological(coreSet, (type) => type === 'essential');
  const extended = topological(extendedSet, (type) => type === 'essential' || type === 'background');
  return {
    core,
    extended: { ...extended, backgroundIds: extended.ids.filter((id) => !coreSet.has(id)) },
  };
}

/** Konservative Kandidatensuche; diese Vorschläge werden erst nach LLM-Bestätigung zu Aliasen. */
export function suggestSemanticDuplicates(entries: Pick<KnowledgeEntry, 'id' | 'term'>[]): { left: string; right: string; score: number }[] {
  const normalize = (term: string) => term.toLocaleLowerCase('de').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = (term: string) => new Set(
    normalize(term)
      .split(/\s+/)
      .filter((token) => token.length > 2 && !['und', 'der', 'die', 'das', 'von', 'für', 'mit', 'the', 'and'].includes(token)),
  );
  const out: { left: string; right: string; score: number }[] = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const left = tokens(entries[i]!.term);
    const right = tokens(entries[j]!.term);
    if (normalize(entries[i]!.term) && normalize(entries[i]!.term) === normalize(entries[j]!.term)) {
      out.push({ left: entries[i]!.id, right: entries[j]!.id, score: 1 });
      continue;
    }
    if (left.size < 2 || right.size < 2) continue;
    const overlap = [...left].filter((token) => right.has(token)).length;
    const score = overlap / Math.min(left.size, right.size);
    if (score >= 0.9 && overlap >= 1) out.push({ left: entries[i]!.id, right: entries[j]!.id, score });
  }
  return out;
}
