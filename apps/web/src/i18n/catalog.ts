import type { Locale } from './index.tsx';
import { ACHIEVEMENTS, KNOWLEDGE_KIND_LABEL, MODULE_INFO, PETS, SHOP_ITEMS, THEMES, type KnowledgeKind, type ModuleId, type PetDef } from '@lernquest/shared';

/** IDs and game rules remain language independent; only catalogue display text changes. */
export const gameTextEn = {
  "10 Fehler-Übungen abgeschlossen.": "Complete 10 review rounds.",
  "2500 XP gesammelt.": "Earn 2,500 XP.",
  "3 Tage Streak.": "3-day streak.",
  "30 Tage Streak.": "30-day streak.",
  "500 XP gesammelt.": "Earn 500 XP.",
  "7 Tage Streak.": "7-day streak.",
  "Accessoires": "Accessories",
  "Alle Farben auf einmal.": "All the colours at once.",
  "Allzeit": "All time",
  "Allzeit-XP": "All-time XP",
  "Aus Fehlern lernen": "Learn from Mistakes",
  "Beantworte 15 Fragen richtig": "Answer 15 questions correctly",
  "Beantworte 5 Praxis-Fragen": "Answer 5 real-world questions",
  "Begriff": "Definition",
  "Beispiel": "Example",
  "Besiege einen Boss.": "Defeat a boss.",
  "Besitze 4 Pets.": "Own 4 pets.",
  "Bestehe einen Klausur-Check.": "Pass an exam check.",
  "Bit": "Bit",
  "Bossbezwinger": "Boss Slayer",
  "Box 1": "Box 1",
  "Box 2": "Box 2",
  "Box 3": "Box 3",
  "Box 4": "Box 4",
  "Box 5": "Box 5",
  "Bronze": "Bronze",
  "Byte": "Byte",
  "Cache-Koloss": "Cache Colossus",
  "Diamant": "Diamond",
  "Diskrete Strukturen": "Discrete Structures",
  "Doktorhut": "Graduation Cap",
  "Duellant": "Duelist",
  "Ein Moos-Drache, der Graphen liebt.": "A moss dragon that loves graphs.",
  "Ein Panzer-Gürteltier aus Silizium.": "An armoured silicon armadillo.",
  "Ein funktionales Chamäleon.": "A functional chameleon.",
  "Ein neugieriger Elektro-Fuchs.": "A curious electric fox.",
  "Ein schwebender Quanten-Geist.": "A floating quantum ghost.",
  "Ein stapelnder Schildkröten-Turm.": "A stacking tower of turtles.",
  "Eine Qualle, die alles enthält.": "A jellyfish that contains everything.",
  "Eine bunte Glitzer-Katze.": "A colourful glitter cat.",
  "Einführung in die Informatik und Programmierung": "Introduction to Computer Science and Programming",
  "Einführung in die Rechnerarchitektur": "Introduction to Computer Architecture",
  "Erster Schritt": "First Step",
  "Evolution": "Evolution",
  "Farbschemata": "Colour themes",
  "Fehlerfrei": "Flawless",
  "Fleißig": "Hard Worker",
  "Für echte ERA-Fans.": "For true ERA fans.",
  "Für jede bestandene Klausur.": "For every exam you pass.",
  "Gemeistert": "Mastered",
  "Gewinne ein Duell.": "Win a duel.",
  "Glänzt im Leaderboard.": "Shines on the leaderboard.",
  "Gold": "Gold",
  "Goldrahmen": "Gold Frame",
  "Graphzilla": "Graphzilla",
  "Heap-Hüter": "Heap Guardian",
  "Klausurreif": "Exam Ready",
  "Knoten": "Node",
  "Knötchen": "Nodling",
  "Konzept": "Concept",
  "Kopfhörer": "Headphones",
  "Krone": "Crown",
  "Kühles Blau.": "Cool blue.",
  "Lambda": "Lambda",
  "Lambdi": "Lambdi",
  "Lass ein Pet sich entwickeln.": "Evolve a pet.",
  "LernQuest": "LernQuest",
  "Liga": "League",
  "Lo-fi beats to study to.": "Lo-fi beats to study to.",
  "Längste Streaks": "Longest streaks",
  "Mach eine Wiederholungsrunde": "Complete a review round",
  "Mach einen Klausur-Check": "Complete an exam check",
  "Megabyte": "Megabyte",
  "Mengchen": "Little Set",
  "Menge": "Set",
  "Modul gemeistert": "Module Master",
  "Nerd-Brille": "Nerd Glasses",
  "Neu": "New",
  "Notation": "Notation",
  "Nur für Liga-Könige.": "For league champions only.",
  "Ozean": "Ocean",
  "Partyhut": "Party Hat",
  "Pets": "Pets",
  "Pink & verspielt.": "Pink and playful.",
  "Pixel": "Pixel",
  "Platine": "Circuit Board",
  "Plus 10 auf Konzentration.": "+10 concentration.",
  "Potenzmenge": "Power Set",
  "Power-ups": "Power-ups",
  "Profilrahmen": "Profile frames",
  "Quanti": "Quanti",
  "Qubit": "Qubit",
  "Regenbogen": "Rainbow",
  "Reggi": "Reggi",
  "Register": "Register",
  "Rettet deinen Streak, wenn du einen Tag verpasst. Max. 2.": "Saves your streak if you miss a day. Maximum 2.",
  "Rubin": "Ruby",
  "Ruhiges Grün.": "Calm green.",
  "Sammle 40 XP": "Earn 40 XP",
  "Sammler": "Collector",
  "Saphir": "Sapphire",
  "Satz/Regel": "Theorem/Rule",
  "Schließe 2 Level ab": "Complete 2 levels",
  "Schließe alle Units eines Moduls ab.": "Complete every unit in a module.",
  "Schließe dein erstes Level ab.": "Complete your first level.",
  "Schließe ein Level mit 100 % ab.": "Complete a level with 100% accuracy.",
  "Shader": "Shader",
  "Sieht klüger aus, als es ist.": "Looks smarter than it is.",
  "Silber": "Silver",
  "Sonnenuntergang": "Sunset",
  "Spiel ein Duell": "Play a duel",
  "Sprite": "Sprite",
  "Stack": "Stack",
  "Streak-Freeze": "Streak Freeze",
  "Streaks": "Streaks",
  "Streber": "High Achiever",
  "Stäckchen": "Little Stack",
  "Superposition": "Superposition",
  "TUM-Schal": "TUM Scarf",
  "Triff 2 Schätzfragen": "Get 2 estimation questions right",
  "Unaufhaltsam": "Unstoppable",
  "Unbekannt": "Unknown",
  "Verfahren": "Method",
  "Wald": "Forest",
  "Warm durch den Garchinger Winter.": "Stay warm through the Garching winter.",
  "Warmes Orange.": "Warm orange.",
  "Warmgelaufen": "Warmed Up",
  "Wochenkrieger": "Week Warrior",
  "Y-Kombinator": "Y Combinator",
  "Zuckerwatte": "Candy Floss"
} as const;

export function translateGameText(text: string, locale: Locale): string {
  if (locale === 'de') return text;
  const translated = (gameTextEn as Readonly<Record<string, string>>)[text];
  if (translated !== undefined) return translated;
  if (text.endsWith('-Liga')) return `${translateGameText(text.slice(0, -5), locale)} League`;
  return text;
}

export const knowledgeKindLabel = (kind: KnowledgeKind, locale: Locale) => translateGameText(KNOWLEDGE_KIND_LABEL[kind], locale);
export const moduleName = (module: ModuleId, locale: Locale) => translateGameText(MODULE_INFO[module].name, locale);

/** ID-based helpers for screens that already use catalogue objects. */
export function localizedPet(petId: string, locale: Locale): PetDef | undefined {
  const pet = PETS.find((item) => item.id === petId);
  if (!pet || locale === 'de') return pet;
  return { ...pet, name: translateGameText(pet.name, locale), blurb: translateGameText(pet.blurb, locale), stageNames: pet.stageNames.map((name) => translateGameText(name, locale)) as PetDef['stageNames'] };
}

export function localizedShopItem(itemId: string, locale: Locale) {
  const item = SHOP_ITEMS.find((entry) => entry.id === itemId);
  return item ? { ...item, name: translateGameText(item.name, locale), description: translateGameText(item.description, locale) } : undefined;
}

export function localizedAchievement(id: string, locale: Locale) {
  const item = ACHIEVEMENTS.find((entry) => entry.id === id);
  return item ? { ...item, name: translateGameText(item.name, locale), description: translateGameText(item.description, locale) } : undefined;
}

export function themeName(id: string, locale: Locale) {
  const name = THEMES[id]?.name;
  return name === undefined ? undefined : translateGameText(name, locale);
}
