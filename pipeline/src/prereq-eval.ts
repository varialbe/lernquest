import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildLearningPaths, KnowledgeGraph, type KnowledgeGraph as Graph, type ModuleId } from '@lernquest/shared';
import { config } from './config.ts';
import { buildPrereqsGraph, hasCanonicalPrereqCycle, isGenericWhy, moduleKnowledge, reaches, type RawLinks } from './prereqs.ts';

type GoldEntry = {
  id: string;
  mustEssential: string[];
  allowedEssential: string[];
  mustNotEssential: string[];
  note: string;
};
type Gold = {
  entries: GoldEntry[];
  expectedDuplicatePairs: { ids: [string, string]; note: string }[];
  orderConstraints: { before: string; after: string; note: string }[];
  mustEssentialChains: { ids: string[]; note: string }[];
};
type Metrics = {
  precision: number;
  recall: number;
  rawPrecision: number;
  rawRecall: number;
  missing: number;
  unnecessary: number;
  duplicateFound: number;
  duplicateExpected: number;
  cycles: number;
  invalid: number;
  orderViolations: number;
  coreLength: number;
  extendedLength: number;
  coreDepth: number;
  extendedDepth: number;
  chainsPreserved: number;
  chainsExpected: number;
};

const goldFile = join(config.root, 'pipeline/eval/prereqs/gold.json');
const readJson = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;
const zero = (): Metrics => ({ precision: 0, recall: 0, rawPrecision: 0, rawRecall: 0, missing: 0, unnecessary: 0, duplicateFound: 0, duplicateExpected: 0, cycles: 0, invalid: 0, orderViolations: 0, coreLength: 0, extendedLength: 0, coreDepth: 0, extendedDepth: 0, chainsPreserved: 0, chainsExpected: 0 });
const resolveAlias = (id: string, aliases: Record<string, string>) => {
  const seen = new Set<string>();
  let result = id;
  while (aliases[result] && !seen.has(result)) { seen.add(result); result = aliases[result]!; }
  return result;
};

function readGraphDir(dir: string, module: ModuleId): Graph {
  const candidates = [
    join(dir, module.toLowerCase(), '_voraussetzungen.json'),
    join(dir, 'wissen', module.toLowerCase(), '_voraussetzungen.json'),
  ];
  for (const file of candidates) if (existsSync(file)) return KnowledgeGraph.parse(readJson(file));
  throw new Error(`${dir}: Graphdatei für ${module} nicht gefunden.`);
}

/** Ein Migrationstrockenlauf wird aus den gespeicherten LLM-Antworten im Speicher zusammengesetzt. */
function readMigrationDir(dir: string, modules: ModuleId[]): Map<ModuleId, Graph> | null {
  const manifestFile = join(dir, 'manifest.json');
  if (!existsSync(manifestFile)) return null;
  const manifest = readJson<{ unitIds: string[]; baselineGraphHashes?: Record<string, string>; idsByModule?: Record<string, string[]> }>(manifestFile);
  const results = new Map<ModuleId, Graph>();
  for (const module of modules) {
    const units = moduleKnowledge(module);
    const graphFile = join(config.knowledgeDir, module.toLowerCase(), '_voraussetzungen.json');
    const graphBytes = readFileSync(graphFile, 'utf8');
    const currentHash = createHash('sha256').update(graphBytes).digest('hex');
    if (manifest.baselineGraphHashes?.[module] && manifest.baselineGraphHashes[module] !== currentHash) throw new Error(`${module}: Baseline-Graph wurde seit dem Trockenlauf verändert.`);
    const currentIds = units.flatMap((unit) => unit.entries.map((entry) => entry.id)).sort();
    if (manifest.idsByModule?.[module] && JSON.stringify(manifest.idsByModule[module]) !== JSON.stringify(currentIds)) throw new Error(`${module}: Eintrags-IDs änderten sich seit dem Trockenlauf.`);
    let graph = KnowledgeGraph.parse(JSON.parse(graphBytes));
    for (const unitId of manifest.unitIds) {
      const unit = units.find((item) => item.unitId === unitId);
      if (!unit) continue;
      const proposal = readJson<{ raw: RawLinks }>(join(dir, `${unitId}.json`));
      graph = buildPrereqsGraph(graph, unit, proposal.raw, units).graph;
    }
    results.set(module, graph);
  }
  return results;
}

function graphIssues(graph: Graph, module: ModuleId, ids: Set<string>, unitOf: Map<string, number>) {
  let cycles = 0;
  let invalid = 0;
  for (const [id, links] of Object.entries(graph.requires)) {
    const unique = new Set<string>();
    for (const link of links) {
      if (unique.has(link.id) || !ids.has(link.id) || !ids.has(id) || unitOf.get(link.id)! > (unitOf.get(id) ?? Infinity)) invalid++;
      unique.add(link.id);
      if (!link.legacy && isGenericWhy(link.why)) invalid++;
      if (link.type !== 'related' && reaches(graph.requires, link.id, id)) cycles++;
    }
    if (links.filter((link) => link.type === 'essential').length > 5 && !links.every((link) => link.legacy)) invalid++;
    if (links.filter((link) => link.type === 'background').length > 4 || links.filter((link) => link.type === 'related').length > 4) invalid++;
  }
  for (const [alias, canonical] of Object.entries(graph.aliases)) {
    if (!ids.has(alias) || !ids.has(canonical)) invalid++;
    else if (unitOf.get(canonical)! > unitOf.get(alias)!) invalid++;
    const seen = new Set<string>();
    let current = alias;
    while (graph.aliases[current]) {
      if (seen.has(current)) { invalid++; break; }
      seen.add(current);
      current = graph.aliases[current]!;
    }
  }
  if (hasCanonicalPrereqCycle(graph.requires, graph.aliases)) cycles++;
  return { cycles, invalid };
}

export function evaluateGraphs(graphs: Map<ModuleId, Graph>, gold: Gold): Metrics {
  const metrics = zero();
  let essentialPredicted = 0;
  let acceptedPredicted = 0;
  let requiredPredicted = 0;
  let requiredTotal = 0;
  let rawPredicted = 0;
  let rawAccepted = 0;
  let rawRequiredPredicted = 0;
  let rawRequiredTotal = 0;
  const modules = ['DS', 'EIP', 'ERA'] as ModuleId[];
  const allUnits = modules.flatMap((module) => moduleKnowledge(module));
  const unitsByModule = new Map(modules.map((module) => [module, allUnits.filter((unit) => unit.module === module)]));
  const idsByModule = new Map<ModuleId, Set<string>>();
  const unitOfByModule = new Map<ModuleId, Map<string, number>>();
  for (const module of modules) {
    const units = unitsByModule.get(module)!;
    const ids = new Set(units.flatMap((unit) => unit.entries.map((entry) => entry.id)));
    const unitOf = new Map(units.flatMap((unit) => unit.entries.map((entry) => [entry.id, unit.unitNumber] as const)));
    idsByModule.set(module, ids);
    unitOfByModule.set(module, unitOf);
    const issues = graphIssues(graphs.get(module)!, module, ids, unitOf);
    metrics.cycles += issues.cycles;
    metrics.invalid += issues.invalid;
  }
  for (const item of gold.entries) {
    const module = item.id.split('-')[0]!.toUpperCase() as ModuleId;
    const graph = graphs.get(module)!;
    const raw = (graph.requires[item.id] ?? []).filter((link) => link.type === 'essential').map((link) => link.id);
    rawPredicted += raw.length;
    rawAccepted += raw.filter((id) => item.allowedEssential.includes(id) && !item.mustNotEssential.includes(id)).length;
    rawRequiredPredicted += item.mustEssential.filter((id) => raw.includes(id)).length;
    rawRequiredTotal += item.mustEssential.length;
    const canonical = (id: string) => resolveAlias(id, graph.aliases);
    const predicted = [...new Set(raw.map(canonical))];
    const accepted = new Set(item.allowedEssential.map(canonical));
    const required = [...new Set(item.mustEssential.map(canonical))];
    const forbidden = new Set(item.mustNotEssential.map(canonical));
    essentialPredicted += predicted.length;
    acceptedPredicted += predicted.filter((id) => accepted.has(id) && !forbidden.has(id)).length;
    requiredTotal += required.length;
    requiredPredicted += required.filter((id) => predicted.includes(id)).length;
    metrics.missing += required.filter((id) => !predicted.includes(id)).length;
    metrics.unnecessary += predicted.filter((id) => !accepted.has(id) || forbidden.has(id)).length;
  }
  const expectedPairs = gold.expectedDuplicatePairs;
  metrics.duplicateExpected = expectedPairs.length;
  for (const pair of expectedPairs) {
    const module = pair.ids[0].split('-')[0]!.toUpperCase() as ModuleId;
    const aliases = graphs.get(module)!.aliases;
    if (resolveAlias(pair.ids[0], aliases) === resolveAlias(pair.ids[1], aliases)) metrics.duplicateFound++;
  }
  for (const constraint of gold.orderConstraints) {
    const module = constraint.before.split('-')[0]!.toUpperCase() as ModuleId;
    const graph = graphs.get(module)!;
    const units = unitsByModule.get(module)!;
    const entries = units.flatMap((unit) => unit.entries.map((entry, order) => ({ id: entry.id, unitNumber: unit.unitNumber, order, requires: graph.requires[entry.id] ?? [] })));
    const path = buildLearningPaths(constraint.after, entries, graph.aliases).core.ids;
    if (path.indexOf(resolveAlias(constraint.before, graph.aliases)) < 0 || path.indexOf(resolveAlias(constraint.after, graph.aliases)) < 0 || path.indexOf(resolveAlias(constraint.before, graph.aliases)) > path.indexOf(resolveAlias(constraint.after, graph.aliases))) metrics.orderViolations++;
  }
  metrics.chainsExpected = gold.mustEssentialChains.length;
  for (const chain of gold.mustEssentialChains) {
    const module = chain.ids[0].split('-')[0]!.toUpperCase() as ModuleId;
    const graph = graphs.get(module)!;
    const units = unitsByModule.get(module)!;
    const entries = units.flatMap((unit) => unit.entries.map((entry, order) => ({ id: entry.id, unitNumber: unit.unitNumber, order, requires: graph.requires[entry.id] ?? [] })));
    const path = buildLearningPaths(chain.ids.at(-1)!, entries, graph.aliases).core.ids;
    const positions = chain.ids.map((id) => path.indexOf(resolveAlias(id, graph.aliases)));
    if (positions.every((position) => position >= 0) && positions.every((position, i) => i === 0 || position > positions[i - 1]!)) metrics.chainsPreserved++;
  }
  const targetPaths = gold.entries.map((item) => {
    const module = item.id.split('-')[0]!.toUpperCase() as ModuleId;
    const graph = graphs.get(module)!;
    const units = unitsByModule.get(module)!;
    const entries = units.flatMap((unit) => unit.entries.map((entry, order) => ({ id: entry.id, unitNumber: unit.unitNumber, order, requires: graph.requires[entry.id] ?? [] })));
    return buildLearningPaths(item.id, entries, graph.aliases);
  });
  metrics.coreLength = targetPaths.reduce((n, path) => n + path.core.ids.length, 0) / targetPaths.length;
  metrics.extendedLength = targetPaths.reduce((n, path) => n + path.extended.ids.length, 0) / targetPaths.length;
  metrics.coreDepth = targetPaths.reduce((n, path) => n + path.core.depth, 0) / targetPaths.length;
  metrics.extendedDepth = targetPaths.reduce((n, path) => n + path.extended.depth, 0) / targetPaths.length;
  metrics.precision = essentialPredicted ? acceptedPredicted / essentialPredicted : 1;
  metrics.recall = requiredTotal ? requiredPredicted / requiredTotal : 1;
  metrics.rawPrecision = rawPredicted ? rawAccepted / rawPredicted : 1;
  metrics.rawRecall = rawRequiredTotal ? rawRequiredPredicted / rawRequiredTotal : 1;
  return metrics;
}

function table(rows: { name: string; metrics: Metrics }[]) {
  const lines = [
    '| Graph | Essential P/R (Aliase) | Roh-ID P/R | Fehlend | Unnötig | Alias-Paare | Zyklen / Validierung | Reihenfolge | Kernpfad Ø / Tiefe | Erweitert Ø / Tiefe | Ketten erhalten |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of rows) {
    const m = row.metrics;
    lines.push(`| ${row.name} | ${(m.precision * 100).toFixed(1)}% / ${(m.recall * 100).toFixed(1)}% | ${(m.rawPrecision * 100).toFixed(1)}% / ${(m.rawRecall * 100).toFixed(1)}% | ${m.missing} | ${m.unnecessary} | ${m.duplicateFound}/${m.duplicateExpected} | ${m.cycles} / ${m.invalid} | ${m.orderViolations} | ${m.coreLength.toFixed(1)} / ${m.coreDepth.toFixed(1)} | ${m.extendedLength.toFixed(1)} / ${m.extendedDepth.toFixed(1)} | ${m.chainsPreserved}/${m.chainsExpected} |`);
  }
  return lines.join('\n');
}

export function evaluatePrereqs(graphDir?: string) {
  const gold = readJson<Gold>(goldFile);
  const modules = ['DS', 'EIP', 'ERA'] as ModuleId[];
  const baseline = new Map<ModuleId, Graph>(modules.map((module) => [module, KnowledgeGraph.parse(readJson(join(config.knowledgeDir, module.toLowerCase(), '_voraussetzungen.json')))]));
  const rows = [{ name: 'Aktuell (Baseline)', metrics: evaluateGraphs(baseline, gold) }];
  if (graphDir) {
    const dir = resolve(config.root, graphDir);
    const migration = readMigrationDir(dir, modules);
    const candidate = migration ?? new Map<ModuleId, Graph>(modules.map((module) => [module, readGraphDir(dir, module)]));
    rows.push({ name: `Vergleich (${graphDir})`, metrics: evaluateGraphs(candidate, gold) });
  }
  return { text: table(rows), rows };
}
