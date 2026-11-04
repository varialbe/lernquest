import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildLearningPaths, KnowledgeGraph, MODULE_INFO, type KnowledgeGraph as Graph, type ModuleId, type UnitKnowledge } from '@lernquest/shared';
import { codexJson } from './codex.ts';
import { config } from './config.ts';
import { fill, template } from './generate.ts';
import { buildPrereqsGraph, graphFile, moduleKnowledge, readGraph, semanticDuplicateCandidates, validatePrereqTargets, type RawLinks } from './prereqs.ts';

type Proposal = {
  unitId: string;
  module: ModuleId;
  inputIds: string[];
  raw: RawLinks;
  preview: { requires: Graph['requires']; aliases: Graph['aliases'] };
};
type MigrationManifest = {
  schemaVersion: 1;
  stamp: string;
  modules: ModuleId[];
  unitIds: string[];
  idsByModule: Record<string, string[]>;
  baselineGraphHashes: Record<string, string>;
  createdAt: string;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (file: string, value: unknown) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const moduleDir = (module: ModuleId) => join(config.knowledgeDir, module.toLowerCase());
const migrationDir = (stamp: string) => join(config.dataDir, 'prereq-migration', stamp);
const proposalFile = (stamp: string, unitId: string) => join(migrationDir(stamp), `${unitId}.json`);
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const graphBytesHash = (module: ModuleId) => existsSync(graphFile(module)) ? hash(readFileSync(graphFile(module), 'utf8')) : 'missing';
const allIds = (units: UnitKnowledge[]) => units.flatMap((unit) => unit.entries.map((entry) => entry.id)).sort();

export type MigrationOptions = { module?: ModuleId; unit?: string; stamp?: string; dryRun?: boolean; apply?: boolean; resume?: boolean; rollback?: string };
export type MigrationClassify = (unit: UnitKnowledge, all: UnitKnowledge[], graph: Graph) => Promise<RawLinks>;

async function classifyWithCodex(target: UnitKnowledge, all: UnitKnowledge[], graph: Graph): Promise<RawLinks> {
  const candidates = all.filter((unit) => unit.unitNumber <= target.unitNumber);
  const oneLine = (text: string) => text.replace(/\s+/g, ' ').slice(0, 160);
  const vars = {
    MODULE: target.module,
    MODULE_NAME: MODULE_INFO[target.module].name,
    UNIT_NUMBER: String(target.unitNumber),
    UNIT_TITLE: target.unitTitle,
    TARGETS: target.entries.map((entry) => `- \`${entry.id}\` ${entry.term} (${entry.kind}) – ${oneLine(entry.short)}`).join('\n'),
    CANDIDATES: candidates.flatMap((unit) => unit.entries.map((entry) => `- \`${entry.id}\` · U${unit.unitNumber} · ${entry.term} – ${oneLine(entry.short)}`)).join('\n'),
    EXISTING: target.entries.flatMap((entry) => (graph.requires[entry.id] ?? []).map((link) => `- \`${entry.id}\` → \`${link.id}\` [${link.type}] ${link.why}`)).join('\n') || '_(keine)_',
    DUPLICATES: JSON.stringify(semanticDuplicateCandidates(candidates.flatMap((unit) => unit.entries))),
  };
  const workDir = join(config.dataDir, 'work', `prereqs-migrate-${target.unitId}`);
  mkdirSync(workDir, { recursive: true });
  const result = await codexJson({
    prompt: fill(template('prereqs.md'), vars),
    effort: config.codexEffort,
    workDir,
    label: `prereqs-migrate-${target.unitId}`,
    log: (message) => console.log(message),
    schema: config.prereqSchemaFile,
  });
  return result.data as RawLinks;
}

function viewForGraph(graph: Graph, units: UnitKnowledge[]) {
  const entries = units.flatMap((unit) => unit.entries.map((entry, order) => ({
    id: entry.id, unitNumber: unit.unitNumber, order,
    requires: graph.requires[entry.id] ?? [],
  })));
  return { entries, aliases: graph.aliases };
}

function linkLines(graph: Graph, unit: UnitKnowledge) {
  return unit.entries.flatMap((entry) => (graph.requires[entry.id] ?? []).map((link) => `- \`${entry.id}\` → \`${link.id}\` **${link.type}**: ${link.why}${link.locked ? ' _(gesperrt)_' : ''}`));
}

function reportFor(stamp: string, units: UnitKnowledge[], allModuleUnits: UnitKnowledge[], oldGraph: Graph, newGraph: Graph, proposals: Proposal[]) {
  const out = [`# Voraussetzungen-Migration ${stamp}`, '', 'Vergleich der bestehenden und vorgeschlagenen Kanten. Wissenssammlungen wurden nicht verändert.', ''];
  const aliasChanges = Object.entries(newGraph.aliases).filter(([alias, canonical]) => oldGraph.aliases[alias] !== canonical);
  out.push('## Bestätigte Alias-Beziehungen', '', ...(aliasChanges.length ? aliasChanges.map(([alias, canonical]) => `- \`${alias}\` → kanonisch \`${canonical}\``) : ['- Keine neuen Alias-Beziehungen']), '');
  for (const unit of units) {
    const proposal = proposals.find((item) => item.unitId === unit.unitId);
    if (!proposal) continue;
    out.push(`## ${unit.unitId} · ${unit.unitTitle}`, '', '### Kanten vorher', ...(linkLines(oldGraph, unit).length ? linkLines(oldGraph, unit) : ['- _(keine)_']), '', '### Kanten nachher', ...(linkLines(newGraph, unit).length ? linkLines(newGraph, unit) : ['- _(keine)_']), '');
    const before = new Map(unit.entries.flatMap((entry) => (oldGraph.requires[entry.id] ?? []).map((link) => [`${entry.id}\0${link.id}`, link] as const)));
    const after = new Map(unit.entries.flatMap((entry) => (newGraph.requires[entry.id] ?? []).map((link) => [`${entry.id}\0${link.id}`, link] as const)));
    const changes: string[] = [];
    for (const [key, oldLink] of before) {
      const newLink = after.get(key);
      if (!newLink) changes.push(`- Entfernt: ${key.replace('\0', ' → ')}`);
      else if (newLink.type !== oldLink.type) changes.push(`- Typwechsel: ${key.replace('\0', ' → ')} ${oldLink.type} → ${newLink.type}`);
      else if (newLink.why !== oldLink.why) changes.push(`- Begründung aktualisiert: ${key.replace('\0', ' → ')}`);
    }
    for (const key of after.keys()) if (!before.has(key)) changes.push(`- Neu: ${key.replace('\0', ' → ')}`);
    out.push('### Änderungen', '', ...(changes.length ? changes : ['- Keine']), '', '### Pfadlängen pro Zielbegriff', '');
    for (const entry of unit.entries) {
      const oldPath = buildLearningPaths(entry.id, viewForGraph(oldGraph, allModuleUnits).entries, oldGraph.aliases);
      const newPath = buildLearningPaths(entry.id, viewForGraph(newGraph, allModuleUnits).entries, newGraph.aliases);
      out.push(`- \`${entry.id}\` ${entry.term}: Kern ${oldPath.core.ids.length} → ${newPath.core.ids.length} Einträge (Tiefe ${oldPath.core.depth} → ${newPath.core.depth}); erweitert ${oldPath.extended.ids.length} → ${newPath.extended.ids.length}`);
    }
  }
  return out.join('\n') + '\n';
}

function readManifest(stamp: string): MigrationManifest {
  const file = join(migrationDir(stamp), 'manifest.json');
  if (!existsSync(file)) throw new Error(`Migrationslauf ${stamp} nicht gefunden.`);
  return readJson<MigrationManifest>(file);
}

function rollback(stamp: string) {
  const root = migrationDir(stamp);
  const backup = readJson<{ modules: { module: ModuleId; existed: boolean }[] }>(join(root, 'backup', 'manifest.json'));
  for (const item of backup.modules) {
    const destination = graphFile(item.module);
    const source = join(root, 'backup', item.module.toLowerCase(), '_voraussetzungen.json');
    if (item.existed) {
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    } else if (existsSync(destination)) {
      unlinkSync(destination);
    }
  }
  const marker = join(root, 'applied.json');
  if (existsSync(marker)) {
    unlinkSync(marker);
  }
  return `Rollback ${stamp} abgeschlossen.`;
}

export async function runPrereqMigration(options: MigrationOptions, classify: MigrationClassify = classifyWithCodex) {
  if (options.rollback) return { message: rollback(options.rollback) };
  const stamp = options.stamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  const root = migrationDir(stamp);
  const all = options.module ? moduleKnowledge(options.module) : (['DS', 'EIP', 'ERA'] as ModuleId[]).flatMap((module) => moduleKnowledge(module));
  const selected = all.filter((unit) => (!options.module || unit.module === options.module) && (!options.unit || unit.unitId === options.unit)).sort((a, b) => a.module.localeCompare(b.module) || a.unitNumber - b.unitNumber);
  if (!selected.length) throw new Error('Keine Wissens-Units für diese Auswahl gefunden.');
  if (options.apply) return applyMigration(stamp);

  const modules = [...new Set(selected.map((unit) => unit.module))];
  const prior = existsSync(join(root, 'manifest.json')) ? readManifest(stamp) : null;
  const manifest: MigrationManifest = prior ?? {
    schemaVersion: 1,
    stamp,
    modules,
    unitIds: selected.map((unit) => unit.unitId),
    idsByModule: Object.fromEntries(modules.map((module) => [module, allIds(all.filter((unit) => unit.module === module))])),
    baselineGraphHashes: Object.fromEntries(modules.map((module) => [module, graphBytesHash(module)])),
    createdAt: new Date().toISOString(),
  };
  if (prior && (JSON.stringify(prior.unitIds) !== JSON.stringify(selected.map((unit) => unit.unitId)) || JSON.stringify(prior.modules) !== JSON.stringify(modules))) {
    throw new Error('Auswahl passt nicht zum vorhandenen Migrationslauf; verwende denselben Modul-/Unit-Umfang.');
  }
  for (const module of modules) {
    if (manifest.baselineGraphHashes[module] !== graphBytesHash(module)) throw new Error(`${module}: Baseline-Graph wurde seit dem Trockenlauf verändert.`);
    if (JSON.stringify(manifest.idsByModule[module]) !== JSON.stringify(allIds(all.filter((unit) => unit.module === module)))) throw new Error(`${module}: Eintrags-IDs änderten sich seit dem Trockenlauf.`);
  }
  // Der Resume-Schutz muss auch nach einem Abbruch des ersten Modellaufrufs existieren.
  json(join(root, 'manifest.json'), manifest);
  const baselineGraphs = new Map<ModuleId, Graph>(modules.map((module) => [module, readGraph(module)]));
  const rawByUnit = new Map<string, RawLinks>();
  let next = 0;
  const worker = async () => {
    while (next < selected.length) {
      const target = selected[next++]!;
      const file = proposalFile(stamp, target.unitId);
      const ids = allIds(all.filter((unit) => unit.module === target.module));
      if (options.resume && existsSync(file)) {
        const saved = readJson<Proposal>(file);
        if (JSON.stringify(saved.inputIds) !== JSON.stringify(ids)) throw new Error(`${target.unitId}: Eintrags-IDs änderten sich seit dem gespeicherten Vorschlag.`);
        validatePrereqTargets(target, saved.raw);
        rawByUnit.set(target.unitId, saved.raw);
        continue;
      }
      const raw = await classify(target, all.filter((unit) => unit.module === target.module), baselineGraphs.get(target.module)!);
      validatePrereqTargets(target, raw);
      rawByUnit.set(target.unitId, raw);
      // Sofortiger Checkpoint: bei Abbruch muss diese Unit nicht nochmals zum Modell.
      json(file, { unitId: target.unitId, module: target.module, inputIds: ids, raw, preview: { requires: {}, aliases: baselineGraphs.get(target.module)!.aliases } });
      console.log(`${target.unitId}: Vorschlag gespeichert.`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  let workingByModule = new Map<ModuleId, Graph>(modules.map((module) => [module, baselineGraphs.get(module)!]));
  const proposals: Proposal[] = [];
  for (const target of selected) {
    const before = workingByModule.get(target.module)!;
    const raw = rawByUnit.get(target.unitId)!;
    const built = buildPrereqsGraph(before, target, raw, all.filter((unit) => unit.module === target.module));
    const proposal: Proposal = {
      unitId: target.unitId,
      module: target.module,
      inputIds: allIds(all.filter((unit) => unit.module === target.module)),
      raw,
      preview: { requires: Object.fromEntries(target.entries.map((entry) => [entry.id, built.graph.requires[entry.id] ?? []])), aliases: built.graph.aliases },
    };
    json(proposalFile(stamp, target.unitId), proposal);
    proposals.push(proposal);
    workingByModule.set(target.module, built.graph);
  }
  json(join(root, 'manifest.json'), manifest);
  for (const module of modules) {
    const moduleUnits = selected.filter((unit) => unit.module === module);
    const allModuleUnits = all.filter((unit) => unit.module === module);
    const startGraph = baselineGraphs.get(module)!;
    const endGraph = workingByModule.get(module)!;
    writeFileSync(join(root, `${module.toLowerCase()}-report.md`), reportFor(stamp, moduleUnits, allModuleUnits, startGraph, endGraph, proposals.filter((proposal) => proposal.module === module)));
  }
  return { stamp, directory: root, reportFiles: modules.map((module) => join(root, `${module.toLowerCase()}-report.md`)), unitCount: selected.length };
}

function applyMigration(stamp: string) {
  const root = migrationDir(stamp);
  const manifest = readManifest(stamp);
  const appliedFile = join(root, 'applied.json');
  if (existsSync(appliedFile)) {
    const applied = readJson<{ finalHashes: Record<string, string> }>(appliedFile);
    if (manifest.modules.every((module) => graphBytesHash(module) === applied.finalHashes[module])) return { message: `Migration ${stamp} ist bereits angewandt; keine Änderungen.` };
    throw new Error('Graph wurde nach diesem Apply verändert; Rollback oder neuen Trockenlauf verwenden.');
  }
  for (const module of manifest.modules) {
    if (graphBytesHash(module) !== manifest.baselineGraphHashes[module]) throw new Error(`${module}: Graph ist seit dem Trockenlauf verändert.`);
    const currentIds = allIds(moduleKnowledge(module));
    if (JSON.stringify(currentIds) !== JSON.stringify(manifest.idsByModule[module])) throw new Error(`${module}: Eintrags-IDs haben sich seit dem Trockenlauf geändert.`);
  }
  for (const unitId of manifest.unitIds) if (!existsSync(proposalFile(stamp, unitId))) throw new Error(`Vorschlag für ${unitId} fehlt; Trockenlauf fortsetzen.`);
  const backupItems: { module: ModuleId; existed: boolean }[] = [];
  for (const module of manifest.modules) {
    const source = graphFile(module);
    const exists = existsSync(source);
    backupItems.push({ module, existed: exists });
    if (exists) {
      const destination = join(root, 'backup', module.toLowerCase(), '_voraussetzungen.json');
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
  }
  json(join(root, 'backup', 'manifest.json'), { modules: backupItems });
  const unitsById = new Map((['DS', 'EIP', 'ERA'] as ModuleId[]).flatMap((module) => moduleKnowledge(module)).map((unit) => [unit.unitId, unit]));
  const final = new Map<ModuleId, Graph>(manifest.modules.map((module) => [module, readGraph(module)]));
  for (const unitId of manifest.unitIds) {
    const proposal = readJson<Proposal>(proposalFile(stamp, unitId));
    const unit = unitsById.get(unitId);
    if (!unit) throw new Error(`${unitId}: Wissenssammlung fehlt beim Apply.`);
    const moduleUnits = moduleKnowledge(proposal.module);
    final.set(proposal.module, buildPrereqsGraph(final.get(proposal.module)!, unit, proposal.raw, moduleUnits).graph);
  }
  for (const [module, graph] of final) writeFileSync(graphFile(module), JSON.stringify(graph, null, 2) + '\n');
  json(appliedFile, { appliedAt: new Date().toISOString(), finalHashes: Object.fromEntries(manifest.modules.map((module) => [module, graphBytesHash(module)])) });
  return { message: `Migration ${stamp} angewandt; Graph-Backups liegen in ${join(root, 'backup')}.` };
}

export function parseMigrationOptions(args: string[]): MigrationOptions {
  const get = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const module = get('--module')?.toUpperCase() as ModuleId | undefined;
  const rollbackStamp = get('--rollback');
  return {
    module,
    unit: get('--unit'),
    stamp: get('--stamp'),
    dryRun: args.includes('--dry-run'),
    apply: args.includes('--apply'),
    resume: args.includes('--resume'),
    rollback: rollbackStamp,
  };
}

