import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalEntryId, KnowledgeGraph, MODULE_INFO, normalizeMathDelimiters, UnitKnowledge, type KnowledgeGraph as Graph, type ModuleId, type PrereqLink, type PrereqType } from '@lernquest/shared';
import { codexJson } from './codex.ts';
import { config } from './config.ts';
import { fill, fixLatexEscapes, template } from './generate.ts';

/** Neue Semantik der Voraussetzungskanten. */
export const PREREQS_PROMPT_VERSION = 'p2';
export const graphFile = (module: ModuleId) => join(config.knowledgeDir, module.toLowerCase(), '_voraussetzungen.json');

export function readGraph(module: ModuleId): Graph {
  const f = graphFile(module);
  if (existsSync(f)) {
    try {
      return KnowledgeGraph.parse(JSON.parse(readFileSync(f, 'utf8')));
    } catch {
      /* fehlerhafte Datei wird beim nächsten deterministischen Lauf neu aufgebaut */
    }
  }
  return { schemaVersion: 2, module, units: {}, requires: {}, aliases: {} };
}

function writeGraph(g: Graph) {
  const f = graphFile(g.module);
  mkdirSync(dirname(f), { recursive: true });
  const sorted = {
    ...g,
    units: Object.fromEntries(Object.entries(g.units).sort()),
    requires: Object.fromEntries(Object.entries(g.requires).sort()),
    aliases: Object.fromEntries(Object.entries(g.aliases).sort()),
  };
  writeFileSync(f, JSON.stringify(sorted, null, 2) + '\n');
  return f;
}

/** Alle Wissenssammlungen eines Moduls, nach Unit-Nummer. */
export function moduleKnowledge(module: ModuleId): UnitKnowledge[] {
  const dir = join(config.knowledgeDir, module.toLowerCase());
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[a-z]+-\d{2}\.json$/.test(f))
    .flatMap((f) => {
      try { return [UnitKnowledge.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')))]; }
      catch { return []; }
    })
    .sort((a, b) => a.unitNumber - b.unitNumber);
}

/** Fehlt der Graph für diese Fassung der Wissenssammlung? */
export const prereqsStale = (k: UnitKnowledge, g = readGraph(k.module)) => g.units[k.unitId]?.knowledgeAt !== k.generator.generatedAt;

type RawPrereq = { id: string; type?: PrereqType; why: string };
export type RawLinks = {
  links: { id: string; requires: RawPrereq[] }[];
  aliases?: { id: string; canonicalId: string; confirmed: boolean }[];
};

/** Fehlende Zielobjekte sind keine bestätigte Entscheidung für leere Voraussetzungen. */
export function validatePrereqTargets(target: UnitKnowledge, raw: RawLinks): void {
  const expected = new Set(target.entries.map((entry) => entry.id));
  const seen = new Set<string>();
  for (const item of raw.links ?? []) {
    if (!expected.has(item.id) || seen.has(item.id)) throw new Error(`${target.unitId}: unbekannter oder doppelter Ziel-Eintrag ${item.id}.`);
    seen.add(item.id);
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`${target.unitId}: Klassifikation fehlt für ${missing.join(', ')}.`);
}

/** Zyklusprüfung für essential/background; related darf absichtlich zyklisch sein. */
export function reaches(requires: Record<string, PrereqLink[]>, start: string, goal: string, includeRelated = false): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === goal) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const link of requires[cur] ?? []) if (includeRelated || link.type !== 'related') stack.push(link.id);
  }
  return false;
}

/** Alias-Auflösung darf keinen Zyklus in dem tatsächlich angezeigten Lernpfad erzeugen. */
export function hasCanonicalPrereqCycle(requires: Record<string, PrereqLink[]>, aliases: Record<string, string>): boolean {
  const active = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (active.has(id)) return true;
    if (done.has(id)) return false;
    active.add(id);
    for (const link of requires[id] ?? []) {
      const next = canonicalEntryId(link.id, aliases);
      if (link.type !== 'related' && next !== id && visit(next)) return true;
    }
    active.delete(id);
    done.add(id);
    return false;
  };
  return Object.keys(requires).some((id) => visit(canonicalEntryId(id, aliases)));
}

const GENERIC_WHY = [
  /\bgrundlage für\b/i, /\bbildet die grundlage\b/i, /\bbaut darauf auf\b/i,
  /\bhängt (thematisch )?zusammen\b/i, /\bsteht (?:im|in) zusammenhang\b/i,
  /\bist (?:eng )?verwandt(?: mit)?\b/i, /\bwird (?:hier )?(?:dafür )?benötigt\b/i,
  /\bwird vorausgesetzt\b/i, /\bhilft (?:beim|zum) verstehen\b/i,
  /\bist wichtig für\b/i, /\bgehört zum thema\b/i,
];
export const isGenericWhy = (why: string) => {
  const text = why.trim();
  return text.length < 16 || GENERIC_WHY.some((pattern) => pattern.test(text)) || /^(weil|da) es eine wichtige (grundlage|voraussetzung) ist\.?$/i.test(text);
};

const STOP = new Set(['und', 'der', 'die', 'das', 'ein', 'eine', 'einer', 'eines', 'für', 'von', 'mit', 'ist', 'sind', 'wird', 'werden', 'als', 'bei', 'auf', 'zu', 'den', 'dem', 'des', 'dass', 'weil', 'damit', 'sich', 'zur', 'zum', 'the', 'and', 'of', 'to', 'in']);
const reasonTokens = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{4,}/g)?.filter((x) => !STOP.has(x)) ?? []);

function addsIndependentReason(why: string, pathWhys: string[]) {
  if (isGenericWhy(why)) return false;
  const own = reasonTokens(why);
  if (!own.size) return false;
  const path = new Set(pathWhys.flatMap((x) => [...reasonTokens(x)]));
  const novel = [...own].filter((x) => !path.has(x));
  return novel.length >= 2 || novel.length / own.size >= 0.5;
}

/** Validiert und merged deterministisch, ohne Dateizugriff; genutzt von Pipeline, Migration und Tests. */
export function buildPrereqsGraph(base: Graph, target: UnitKnowledge, raw: RawLinks, all: UnitKnowledge[], model = config.codexModel) {
  const g = structuredClone(base) as Graph;
  const unitOf = new Map<string, number>();
  const entryOf = new Map<string, UnitKnowledge['entries'][number]>();
  for (const k of all) for (const entry of k.entries) { unitOf.set(entry.id, k.unitNumber); entryOf.set(entry.id, entry); }
  const own = new Set(target.entries.map((entry) => entry.id));
  const previous = g.units[target.unitId]?.knowledgeAt;
  if (previous && previous !== target.generator.generatedAt) {
    for (const [alias, canonical] of Object.entries(g.aliases)) {
      if (alias.startsWith(`${target.unitId}-k`) || canonical.startsWith(`${target.unitId}-k`)) delete g.aliases[alias];
    }
    for (const [id, links] of Object.entries(g.requires)) {
      const linkedToChangedUnit = links.some((link) => link.id.startsWith(`${target.unitId}-k`));
      const dependentUnit = id.replace(/-k\d+$/, '');
      if (dependentUnit !== target.unitId && linkedToChangedUnit) delete g.units[dependentUnit];
    }
  }

  const requires: Record<string, PrereqLink[]> = {};
  for (const [id, links] of Object.entries(g.requires)) {
    if (own.has(id) || id.startsWith(`${target.unitId}-k`) || !unitOf.has(id)) continue;
    requires[id] = links.filter((link) => unitOf.has(link.id));
  }
  const dropped: string[] = [];
  const proposed = new Map<string, RawPrereq[]>();
  for (const link of raw.links ?? []) if (!proposed.has(link.id)) proposed.set(link.id, link.requires ?? []);
  const pos = new Map<string, number>();
  for (const k of all) k.entries.forEach((entry, i) => pos.set(entry.id, k.unitNumber * 1000 + i));

  for (const entry of target.entries) {
    const locked = (base.requires[entry.id] ?? []).filter((link) => link.locked && unitOf.has(link.id));
    requires[entry.id] = [...locked];
  }

  const candidates: { from: string; to: string; type: PrereqType; why: string; backward: boolean }[] = [];
  for (const entry of target.entries) {
    if ((base.requires[entry.id] ?? []).some((link) => link.locked)) continue;
    for (const r of proposed.get(entry.id) ?? []) {
      const why = normalizeMathDelimiters(fixLatexEscapes(r.why ?? '')).trim().slice(0, 240);
      const type = r.type ?? 'essential';
      if (r.id === entry.id) dropped.push(`${entry.id}: verweist auf sich selbst`);
      else if (!unitOf.has(r.id)) dropped.push(`${entry.id} → ${r.id}: unbekannter Eintrag`);
      else if (unitOf.get(r.id)! > target.unitNumber) dropped.push(`${entry.id} → ${r.id}: spätere Unit`);
      else if (candidates.some((c) => c.from === entry.id && c.to === r.id) || (requires[entry.id] ?? []).some((x) => x.id === r.id)) dropped.push(`${entry.id} → ${r.id}: doppelte Kante`);
      else if (isGenericWhy(why)) dropped.push(`${entry.id} → ${r.id}: generische Begründung`);
      else candidates.push({ from: entry.id, to: r.id, type, why, backward: pos.get(r.id)! < pos.get(entry.id)! });
    }
  }

  const limits: Record<PrereqType, number> = { essential: 5, background: 4, related: 4 };
  const rank: Record<PrereqType, number> = { essential: 0, background: 1, related: 2 };
  candidates.sort((a, b) => Number(b.backward) - Number(a.backward) || rank[a.type] - rank[b.type] || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const counts = new Map<string, Record<PrereqType, number>>();
  for (const [id, links] of Object.entries(requires)) counts.set(id, {
    essential: links.filter((x) => x.type === 'essential').length,
    background: links.filter((x) => x.type === 'background').length,
    related: links.filter((x) => x.type === 'related').length,
  });
  for (const c of candidates) {
    const out = requires[c.from]!;
    const count = counts.get(c.from)!;
    if (count[c.type] >= limits[c.type]) dropped.push(`${c.from} → ${c.to}: mehr als ${limits[c.type]} ${c.type}-Kanten`);
    else if (c.type !== 'related' && reaches(requires, c.to, c.from)) dropped.push(`${c.from} → ${c.to}: Zyklus`);
    else if (c.type !== 'related' && hasCanonicalPrereqCycle({ ...requires, [c.from]: [...out, { id: c.to, type: c.type, why: c.why, legacy: false, locked: false }] }, g.aliases)) dropped.push(`${c.from} → ${c.to}: Alias erzeugt Lernpfad-Zyklus`);
    else {
      out.push({ id: c.to, type: c.type, why: c.why, legacy: false, locked: false });
      count[c.type]++;
    }
  }

  // Transitive essential-Kanten bleiben als hilfreicher Kontext erhalten, aber nicht im Kernpfad.
  for (const [from, links] of Object.entries(requires)) {
    if (!own.has(from)) continue;
    for (const edge of links) {
      if (edge.type !== 'essential' || edge.locked || edge.legacy) continue;
      const alternatives = links.filter((x) => x.id !== edge.id && x.type === 'essential');
      const pathWhy: string[] = [];
      let redundant = false;
      const walk = (id: string, seen = new Set<string>()) => {
        if (id === edge.id) { redundant = true; return; }
        if (seen.has(id)) return;
        seen.add(id);
        for (const next of requires[id] ?? []) if (next.type === 'essential') { pathWhy.push(next.why); walk(next.id, seen); }
      };
      for (const first of alternatives) { pathWhy.push(first.why); walk(first.id); }
      if (redundant && !addsIndependentReason(edge.why, pathWhy)) {
        if (links.filter((link) => link.type === 'background').length < limits.background) edge.type = 'background';
        else {
          links.splice(links.indexOf(edge), 1);
          dropped.push(`${from} → ${edge.id}: transitive essential-Kante entfernt (background-Limit erreicht)`);
        }
      }
    }
  }

  // Gesperrte manuelle Kanten werden übernommen und nie durch eine Modellantwort ersetzt.
  for (const entry of target.entries) {
    const order = (proposed.get(entry.id) ?? []).map((link) => link.id);
    requires[entry.id]!.sort((a, b) => Number(b.locked) - Number(a.locked) || rank[a.type] - rank[b.type] || order.indexOf(a.id) - order.indexOf(b.id));
  }

  const aliases = { ...g.aliases };
  for (const alias of raw.aliases ?? []) {
    if (!alias.confirmed) continue;
    if (alias.id === alias.canonicalId) { dropped.push(`${alias.id}: Alias verweist auf sich selbst`); continue; }
    if (!unitOf.has(alias.id) || !unitOf.has(alias.canonicalId)) { dropped.push(`${alias.id} → ${alias.canonicalId}: unbekannter Alias-Eintrag`); continue; }
    if (unitOf.get(alias.id)! > target.unitNumber || unitOf.get(alias.canonicalId)! > target.unitNumber) { dropped.push(`${alias.id} → ${alias.canonicalId}: Alias verweist auf spätere Unit`); continue; }
    if (pos.get(alias.canonicalId)! > pos.get(alias.id)!) { dropped.push(`${alias.id} → ${alias.canonicalId}: kanonischer Eintrag muss früher stehen`); continue; }
    if (aliases[alias.id] && aliases[alias.id] !== alias.canonicalId) { dropped.push(`${alias.id}: widersprüchlicher Alias`); continue; }
    let canonical = alias.canonicalId;
    const aliasSeen = new Set<string>([alias.id]);
    while (aliases[canonical]) {
      if (aliasSeen.has(canonical)) break;
      aliasSeen.add(canonical);
      canonical = aliases[canonical]!;
    }
    if (aliasSeen.has(canonical)) {
      dropped.push(`${alias.id} → ${alias.canonicalId}: Alias-Zyklus`);
      continue;
    }
    const nextAliases = { ...aliases, [alias.id]: canonical };
    if (hasCanonicalPrereqCycle(requires, nextAliases)) {
      dropped.push(`${alias.id} → ${canonical}: Alias erzeugt Lernpfad-Zyklus`);
      continue;
    }
    aliases[alias.id] = canonical;
  }
  for (const id of Object.keys(aliases)) if (!unitOf.has(id) || !unitOf.has(aliases[id]!)) delete aliases[id];
  g.schemaVersion = 2;
  g.requires = requires;
  g.aliases = aliases;
  g.units[target.unitId] = { knowledgeAt: target.generator.generatedAt, generatedAt: new Date().toISOString(), model, promptVersion: PREREQS_PROMPT_VERSION };
  for (const unitId of Object.keys(g.units)) if (!all.some((k) => k.unitId === unitId)) delete g.units[unitId];
  const targetEdges = target.entries.reduce((count, entry) => count + (requires[entry.id]?.length ?? 0), 0);
  return { graph: KnowledgeGraph.parse(g), edges: targetEdges, dropped };
}

/** Persistiert einen validierten Graphen für eine Wissens-Unit. */
export function applyPrereqs(target: UnitKnowledge, raw: RawLinks, all: UnitKnowledge[], model = config.codexModel) {
  const built = buildPrereqsGraph(readGraph(target.module), target, raw, all, model);
  return { file: writeGraph(built.graph), edges: built.edges, dropped: built.dropped };
}

export function semanticDuplicateCandidates(entries: UnitKnowledge['entries']) {
  const normalize = (term: string) => term.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = (term: string) => new Set(normalize(term).split(/\s+/).filter((x) => x.length > 2));
  const out: { left: string; right: string; score: number }[] = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    if (normalize(entries[i]!.term) && normalize(entries[i]!.term) === normalize(entries[j]!.term)) {
      out.push({ left: entries[i]!.id, right: entries[j]!.id, score: 1 });
      continue;
    }
    const a = tokens(entries[i]!.term), b = tokens(entries[j]!.term);
    const overlap = [...a].filter((token) => b.has(token)).length;
    const score = a.size && b.size ? overlap / Math.min(a.size, b.size) : 0;
    if (overlap >= 1 && score >= 0.9) out.push({ left: entries[i]!.id, right: entries[j]!.id, score });
  }
  return out;
}

/** Neue Kanten werden typisiert vorgeschlagen; Alias-Kandidaten müssen im LLM-Schritt bestätigt werden. */
export async function generatePrereqs(target: UnitKnowledge, all: UnitKnowledge[], workDir: string, log: (m: string) => void) {
  const candidates = all.filter((k) => k.unitNumber <= target.unitNumber);
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').slice(0, 160);
  const existing = readGraph(target.module);
  const vars = {
    MODULE: target.module,
    MODULE_NAME: MODULE_INFO[target.module].name,
    UNIT_NUMBER: String(target.unitNumber),
    UNIT_TITLE: target.unitTitle,
    TARGETS: target.entries.map((e) => `- \`${e.id}\` ${e.term} (${e.kind}) – ${oneLine(e.short)}`).join('\n'),
    CANDIDATES: candidates.flatMap((k) => k.entries.map((e) => `- \`${e.id}\` · U${k.unitNumber} · ${e.term} – ${oneLine(e.short)}`)).join('\n'),
    EXISTING: target.entries.flatMap((e) => (existing.requires[e.id] ?? []).map((link) => `- \`${e.id}\` → \`${link.id}\` [${link.type}] ${link.why}`)).join('\n') || '_(keine)_',
    DUPLICATES: JSON.stringify(semanticDuplicateCandidates(candidates.flatMap((k) => k.entries))),
  };
  mkdirSync(workDir, { recursive: true });
  log(`  → Voraussetzungen ${target.unitId} (effort ${config.codexEffort})`);
  const r = await codexJson({ prompt: fill(template('prereqs.md'), vars), effort: config.codexEffort, workDir, label: `prereqs-${target.unitId}`, log, schema: config.prereqSchemaFile });
  validatePrereqTargets(target, r.data as RawLinks);
  const applied = applyPrereqs(target, r.data as RawLinks, all);
  log(`  ✓ Voraussetzungen ${target.unitId}: ${applied.edges} Kanten${applied.dropped.length ? `, ${applied.dropped.length} verworfen` : ''}`);
  return { ...applied, tokens: r.tokens };
}

export function knowledgeWarnings(units: { id: string; module: ModuleId }[]) {
  const warnings: string[] = [];
  for (const module of [...new Set(units.map((unit) => unit.module))]) {
    const graph = readGraph(module);
    for (const unit of units.filter((item) => item.module === module)) {
      const metadata = graph.units[unit.id];
      const hasLegacyEdges = Object.entries(graph.requires).some(([id, links]) => id.startsWith(`${unit.id}-k`) && links.some((link) => link.legacy));
      if (metadata?.promptVersion !== PREREQS_PROMPT_VERSION || hasLegacyEdges) {
        warnings.push(`${unit.id}: semantische Graph-Migration ausstehend (pnpm pipeline prereqs-migrate --module ${module.toLowerCase()} --dry-run)`);
      }
    }
  }
  return warnings;
}

/** Prüft Sammlungen und Graph, ohne ausstehende Semantik-Migration als Fehler zu werten. */
export function checkKnowledge(units: { id: string; module: ModuleId; source: { sha256: string } }[]): string[] {
  const problems: string[] = [];
  for (const module of [...new Set(units.map((u) => u.module))]) {
    const all = moduleKnowledge(module);
    const byUnit = new Map(all.map((k) => [k.unitId, k]));
    const graph = readGraph(module);
    const unitOf = new Map<string, number>();
    for (const k of all) for (const e of k.entries) unitOf.set(e.id, k.unitNumber);
    for (const unit of units.filter((x) => x.module === module)) {
      const knowledge = byUnit.get(unit.id);
      if (!knowledge) problems.push(`${unit.id}: keine Wissenssammlung`);
      else if (knowledge.sourceSha !== unit.source.sha256) problems.push(`${unit.id}: Wissenssammlung stammt von einer älteren Fassung der Unit`);
      else if (prereqsStale(knowledge, graph)) problems.push(`${unit.id}: Voraussetzungen fehlen oder passen nicht zur aktuellen Wissenssammlung`);
      else for (const entry of knowledge.entries) if (!(entry.id in graph.requires)) problems.push(`${entry.id} (${entry.term}): kein Eintrag im Voraussetzungs-Graph`);
    }
    for (const [id, links] of Object.entries(graph.requires)) {
      if (!unitOf.has(id)) problems.push(`${module}: Graph enthält unbekannten Eintrag ${id}`);
      const seen = new Set<string>();
      const counts = { essential: 0, background: 0, related: 0 };
      for (const link of links) {
        counts[link.type]++;
        if (seen.has(link.id)) problems.push(`${id} → ${link.id}: doppelte Kante`);
        seen.add(link.id);
        if (!unitOf.has(link.id)) problems.push(`${id} → ${link.id}: Voraussetzung existiert nicht`);
        else if (unitOf.get(link.id)! > (unitOf.get(id) ?? Infinity)) problems.push(`${id} → ${link.id}: Voraussetzung aus späterer Unit`);
        if (!link.legacy && isGenericWhy(link.why)) problems.push(`${id} → ${link.id}: generische Begründung`);
        if (link.type !== 'related' && reaches(graph.requires, link.id, id)) problems.push(`${id} → ${link.id}: Zyklus`);
      }
      const legacyOnly = links.length > 0 && links.every((link) => link.legacy);
      if ((!legacyOnly && counts.essential > 5) || counts.background > 4 || counts.related > 4) problems.push(`${id}: Kantenlimit pro Typ überschritten`);
    }
    for (const [alias, canonical] of Object.entries(graph.aliases)) {
      if (!unitOf.has(alias) || !unitOf.has(canonical)) problems.push(`${alias} → ${canonical}: Alias-Eintrag existiert nicht`);
      else if (unitOf.get(canonical)! > unitOf.get(alias)!) problems.push(`${alias} → ${canonical}: kanonischer Eintrag aus späterer Unit`);
      const seen = new Set<string>();
      let current = alias;
      while (graph.aliases[current]) {
        if (seen.has(current)) { problems.push(`${alias} → ${canonical}: Alias-Zyklus`); break; }
        seen.add(current);
        current = graph.aliases[current]!;
      }
    }
    if (hasCanonicalPrereqCycle(graph.requires, graph.aliases)) problems.push(`${module}: Alias erzeugt Lernpfad-Zyklus`);
  }
  return problems;
}
