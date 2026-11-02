import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { KnowledgeGraph, MODULE_INFO, normalizeMathDelimiters, UnitKnowledge, type ModuleId, type PrereqLink } from '@lernquest/shared';
import { codexJson } from './codex.ts';
import { config } from './config.ts';
import { fill, fixLatexEscapes, template } from './generate.ts';

/**
 * Voraussetzungs-Graph der Wissenssammlung (wissen/<modul>/_voraussetzungen.json).
 * Codex schlägt pro Unit direkte Voraussetzungen vor; hier wird deterministisch geprüft:
 * nur existierende Einträge, nur dieselbe/frühere Units, keine Selbstbezüge, keine Zyklen, max. 6.
 */
export const graphFile = (module: ModuleId) => join(config.knowledgeDir, module.toLowerCase(), '_voraussetzungen.json');

export function readGraph(module: ModuleId): KnowledgeGraph {
  const f = graphFile(module);
  if (existsSync(f)) {
    try {
      return KnowledgeGraph.parse(JSON.parse(readFileSync(f, 'utf8')));
    } catch {
      /* kaputt → neu aufbauen */
    }
  }
  return { schemaVersion: 1, module, units: {}, requires: {} };
}

function writeGraph(g: KnowledgeGraph) {
  const f = graphFile(g.module);
  mkdirSync(dirname(f), { recursive: true });
  // stabil sortiert, damit Git-Diffs lesbar bleiben
  const sorted = { ...g, units: Object.fromEntries(Object.entries(g.units).sort()), requires: Object.fromEntries(Object.entries(g.requires).sort()) };
  writeFileSync(f, JSON.stringify(sorted, null, 2) + '\n');
  return f;
}

/** Alle Wissenssammlungen eines Moduls, nach Unit-Nummer */
export function moduleKnowledge(module: ModuleId): UnitKnowledge[] {
  const dir = join(config.knowledgeDir, module.toLowerCase());
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[a-z]+-\d{2}\.json$/.test(f))
    .flatMap((f) => {
      try {
        return [UnitKnowledge.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')))];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.unitNumber - b.unitNumber);
}

/** Fehlt der Graph für diese Fassung der Wissenssammlung? */
export const prereqsStale = (k: UnitKnowledge, g = readGraph(k.module)) => g.units[k.unitId]?.knowledgeAt !== k.generator.generatedAt;

type RawLinks = { links: { id: string; requires: { id: string; why: string }[] }[] };

/** Würde die Kante from → to einen Zyklus schließen? (to erreicht from) */
function reaches(requires: Record<string, PrereqLink[]>, start: string, goal: string): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === goal) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const l of requires[cur] ?? []) stack.push(l.id);
  }
  return false;
}

/**
 * Prüft die Vorschläge für eine Unit und trägt sie in den Graphen ein (synchron: read → merge → write,
 * damit parallele Läufe desselben Moduls sich nicht überschreiben).
 */
export function applyPrereqs(target: UnitKnowledge, raw: RawLinks, all: UnitKnowledge[], model = config.codexModel): { file: string; edges: number; dropped: string[] } {
  const g = readGraph(target.module);
  const unitOf = new Map<string, number>();
  for (const k of all) for (const e of k.entries) unitOf.set(e.id, k.unitNumber);
  const own = new Set(target.entries.map((e) => e.id));
  // Wurde die Wissenssammlung dieser Unit neu erzeugt, bedeuten ihre IDs evtl. andere Begriffe:
  // spätere Units, die auf sie verweisen, als veraltet markieren → werden beim nächsten Lauf neu verknüpft
  const before = g.units[target.unitId]?.knowledgeAt;
  if (before && before !== target.generator.generatedAt) {
    for (const [id, links] of Object.entries(g.requires)) {
      const unit = id.replace(/-k\d+$/, '');
      if (unit !== target.unitId && links.some((l) => l.id.startsWith(`${target.unitId}-k`))) delete g.units[unit];
    }
  }
  // alte Kanten dieser Unit raus; Kanten auf nicht (mehr) existierende Einträge ebenso
  const requires: Record<string, PrereqLink[]> = {};
  for (const [id, links] of Object.entries(g.requires)) {
    if (own.has(id) || id.startsWith(`${target.unitId}-k`) || !unitOf.has(id)) continue;
    requires[id] = links.filter((l) => unitOf.has(l.id));
  }
  const dropped: string[] = [];
  const proposed = new Map((raw.links ?? []).map((l) => [l.id, l.requires ?? []]));
  // Position jedes Eintrags im Modul (Unit, Reihenfolge) – „rückwärts“ = auf früher Eingeführtes
  const pos = new Map<string, number>();
  for (const k of all) k.entries.forEach((e, i) => pos.set(e.id, k.unitNumber * 1000 + i));
  for (const e of target.entries) requires[e.id] = [];
  const candidates: { from: string; to: string; why: string; backward: boolean }[] = [];
  for (const e of target.entries) {
    for (const r of proposed.get(e.id) ?? []) {
      const why = normalizeMathDelimiters(fixLatexEscapes(r.why ?? '')).trim().slice(0, 240);
      if (r.id === e.id) dropped.push(`${e.id}: verweist auf sich selbst`);
      else if (!unitOf.has(r.id)) dropped.push(`${e.id} → ${r.id}: unbekannter Eintrag`);
      else if (unitOf.get(r.id)! > target.unitNumber) dropped.push(`${e.id} → ${r.id}: spätere Unit`);
      else if (!candidates.some((c) => c.from === e.id && c.to === r.id)) candidates.push({ from: e.id, to: r.id, why, backward: pos.get(r.id)! < pos.get(e.id)! });
    }
  }
  // erst Kanten auf früher Eingeführtes, dann die übrigen → bei Zyklen gewinnt die „natürliche“ Richtung
  let edges = 0;
  for (const c of [...candidates.filter((x) => x.backward), ...candidates.filter((x) => !x.backward)]) {
    const out = requires[c.from]!;
    if (out.length >= 6) dropped.push(`${c.from} → ${c.to}: mehr als 6`);
    else if (reaches(requires, c.to, c.from)) dropped.push(`${c.from} → ${c.to}: Zyklus`);
    else {
      out.push({ id: c.to, why: c.why });
      edges++;
    }
  }
  // Ausgabe in Vorschlags-Reihenfolge
  for (const e of target.entries) {
    const order = (proposed.get(e.id) ?? []).map((r) => r.id);
    requires[e.id]!.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  g.requires = requires;
  g.units[target.unitId] = { knowledgeAt: target.generator.generatedAt, generatedAt: new Date().toISOString(), model };
  // Units, die es nicht mehr gibt, aus der Übersicht entfernen
  for (const u of Object.keys(g.units)) if (!all.some((k) => k.unitId === u)) delete g.units[u];
  return { file: writeGraph(KnowledgeGraph.parse(g)), edges, dropped };
}

export async function generatePrereqs(target: UnitKnowledge, all: UnitKnowledge[], workDir: string, log: (m: string) => void) {
  const candidates = all.filter((k) => k.unitNumber <= target.unitNumber);
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').slice(0, 160);
  const vars = {
    MODULE: target.module,
    MODULE_NAME: MODULE_INFO[target.module].name,
    UNIT_NUMBER: String(target.unitNumber),
    UNIT_TITLE: target.unitTitle,
    TARGETS: target.entries.map((e) => `- \`${e.id}\` ${e.term} (${e.kind}) – ${oneLine(e.short)}`).join('\n'),
    CANDIDATES: candidates.flatMap((k) => k.entries.map((e) => `- \`${e.id}\` · U${k.unitNumber} · ${e.term} – ${oneLine(e.short)}`)).join('\n'),
  };
  mkdirSync(workDir, { recursive: true });
  log(`  → Voraussetzungen ${target.unitId} (effort ${config.codexEffort})`);
  const r = await codexJson({ prompt: fill(template('prereqs.md'), vars), effort: config.codexEffort, workDir, label: `prereqs-${target.unitId}`, log, schema: config.prereqSchemaFile });
  const applied = applyPrereqs(target, r.data as RawLinks, all);
  log(`  ✓ Voraussetzungen ${target.unitId}: ${applied.edges} Kanten${applied.dropped.length ? `, ${applied.dropped.length} verworfen` : ''}`);
  return { ...applied, tokens: r.tokens };
}

/**
 * Prüft, ob Wissenssammlung und Voraussetzungs-Graph zu allen Units passen (pnpm pipeline wissen-check).
 * Liefert eine Liste von Problemen; leer = alles aktuell.
 */
export function checkKnowledge(units: { id: string; module: ModuleId; source: { sha256: string } }[]): string[] {
  const problems: string[] = [];
  for (const module of [...new Set(units.map((u) => u.module))]) {
    const all = moduleKnowledge(module);
    const byUnit = new Map(all.map((k) => [k.unitId, k]));
    const g = readGraph(module);
    const unitOf = new Map<string, number>();
    for (const k of all) for (const e of k.entries) unitOf.set(e.id, k.unitNumber);
    for (const u of units.filter((x) => x.module === module)) {
      const k = byUnit.get(u.id);
      if (!k) problems.push(`${u.id}: keine Wissenssammlung`);
      else if (k.sourceSha !== u.source.sha256) problems.push(`${u.id}: Wissenssammlung stammt von einer älteren Fassung der Unit`);
      else if (prereqsStale(k, g)) problems.push(`${u.id}: Voraussetzungen fehlen oder passen nicht zur aktuellen Wissenssammlung`);
      else for (const e of k.entries) if (!(e.id in g.requires)) problems.push(`${e.id} (${e.term}): kein Eintrag im Voraussetzungs-Graph`);
    }
    for (const [id, links] of Object.entries(g.requires)) {
      if (!unitOf.has(id)) problems.push(`${module}: Graph enthält unbekannten Eintrag ${id}`);
      for (const l of links) {
        if (!unitOf.has(l.id)) problems.push(`${id} → ${l.id}: Voraussetzung existiert nicht`);
        else if (unitOf.get(l.id)! > (unitOf.get(id) ?? Infinity)) problems.push(`${id} → ${l.id}: Voraussetzung aus späterer Unit`);
      }
    }
    for (const id of Object.keys(g.requires)) for (const l of g.requires[id]!) if (reaches(g.requires, l.id, id)) problems.push(`${id} → ${l.id}: Zyklus`);
  }
  return problems;
}
