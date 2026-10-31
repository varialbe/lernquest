#!/usr/bin/env node
/**
 * Erzeugt das Asset-Set (Maskottchen, Pets × 3 Stufen, Items, Abzeichen, App-Icon) mit dem Imagegen-Tool von Codex CLI.
 * - ein gemeinsamer Style-Guide-Prompt für alle Bilder (gleicher Stil, Perspektive, transparenter Hintergrund, quadratisch)
 * - sequentiell, überspringt vorhandene Dateien (erneut ausführen = nur fehlende nachholen; FORCE=name1,name2 zum Neuerzeugen)
 * - Codex legt Bilder unter ~/.codex/generated_images ab; das neueste Bild nach dem Aufruf wird übernommen
 * - Ausgabe: public/assets/<name>.webp (512 px bzw. 256 px für Icons) + Kontaktabzüge in .tmp/contact-*.png zur Sichtprüfung
 *
 *   node scripts/gen-assets.mjs [filter]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const OUT = resolve(import.meta.dirname, '../public/assets');
const RAW = resolve(import.meta.dirname, '../../../.tmp/assets-raw');
const GEN = join(homedir(), '.codex/generated_images');
mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });

const STYLE = `Art style guide (follow exactly, identical for the whole asset set):
cute chibi sticker illustration for a playful mobile learning game; thick soft dark-brown outline; flat vibrant saturated colors with subtle cel shading and one soft highlight;
rounded friendly shapes; big expressive glossy eyes for characters; front-facing 3/4 view; subject centered with generous padding, fully visible, nothing cropped;
TRANSPARENT background (alpha), no ground shadow, no scenery, no border, no frame, NO TEXT, no letters, no numbers, no watermark; square 1024x1024.`;

const MASCOT = 'Lumo, the original mascot: a round, soft, lavender-purple (#7c5cff) cube-shaped creature with rounded edges, a small sprout-like antenna with a glowing mint tip, big friendly eyes, rosy cheeks, tiny stubby arms and feet';

/** name → [Motiv, Größe] */
const ASSETS = {
  // Maskottchen
  'mascot-happy': [`${MASCOT}, standing and smiling warmly, waving one hand`, 512],
  'mascot-cheer': [`${MASCOT}, jumping with both arms raised in joy, eyes closed happily, small sparkles and confetti pieces around`, 512],
  'mascot-sad': [`${MASCOT}, looking a bit sad but encouraging, small sweat drop, hands together`, 512],
  'mascot-think': [`${MASCOT}, thinking with one hand on its chin, looking up, a small light-bulb glow near its antenna`, 512],
  'mascot-sleep': [`${MASCOT}, sleeping peacefully curled up, small floating Z-shaped cloud bubbles (no letters, just soft swirls)`, 512],
  'mascot-book': [`${MASCOT}, holding and reading an open book, curious expression`, 512],
  // Pets (Stufe 1–3)
  'pet-bit-1': ['Bit: a tiny sky-blue (#38bdf8) electric fox kit with oversized ears and small spark-shaped fur tufts', 512],
  'pet-bit-2': ['Bit evolved: a young sky-blue electric fox with glowing circuit-line patterns in its fur and a lightning-tipped tail', 512],
  'pet-bit-3': ['Bit final form: a majestic sky-blue electric fox with three flowing tails crackling with gentle lightning, glowing circuit patterns, proud pose', 512],
  'pet-pixel-1': ['Pixel: a tiny pink (#f472b6) kitten with little square pixel patches on its fur and a heart-shaped nose', 512],
  'pet-pixel-2': ['Pixel evolved: a playful pink cat with a sparkling mane made of small square pixels and glitter', 512],
  'pet-pixel-3': ['Pixel final form: an elegant pink cat surrounded by floating glowing pixel cubes, starry eyes, graceful sitting pose', 512],
  'pet-knoten-1': ['Knoten: a baby lime-green (#a3e635) moss dragon peeking out of a cracked egg shell, tiny wings', 512],
  'pet-knoten-2': ['Knoten evolved: a small lime-green moss dragon whose wings show a pattern of dots connected by lines like a graph', 512],
  'pet-knoten-3': ['Knoten final form: a big friendly lime-green moss dragon with glowing graph constellations (dots and connecting lines) across its wings and back', 512],
  'pet-lambda-1': ['Lambda: a tiny violet (#c084fc) baby chameleon with a curly tail and a small crest shaped like a stylized lambda symbol', 512],
  'pet-lambda-2': ['Lambda evolved: a violet chameleon with color-shifting stripes and a curled tail, holding a tiny glowing orb', 512],
  'pet-lambda-3': ['Lambda final form: a wise violet chameleon with shimmering iridescent scales, swirling spiral tail and a glowing crest', 512],
  'pet-register-1': ['Register: a tiny orange (#fb923c) baby armadillo with smooth shell plates that look like little computer chips', 512],
  'pet-register-2': ['Register evolved: an orange armadillo with armor plates made of shiny circuit-board chips and small glowing LEDs', 512],
  'pet-register-3': ['Register final form: a large mighty orange armadillo colossus with layered chip armor, glowing cooling vents and a heat-sink crest', 512],
  'pet-menge-1': ['Menge: a tiny yellow (#facc15) jellyfish with short wavy tentacles and a small bubble inside its bell', 512],
  'pet-menge-2': ['Menge evolved: a yellow jellyfish whose translucent bell contains several small colorful floating bubbles', 512],
  'pet-menge-3': ['Menge final form: a large radiant yellow jellyfish containing nested bubbles within bubbles, long flowing tentacles', 512],
  'pet-stack-1': ['Stack: a tiny green (#4ade80) baby turtle with a smooth rounded shell', 512],
  'pet-stack-2': ['Stack evolved: a green turtle with a smaller baby turtle stacked on top of its shell', 512],
  'pet-stack-3': ['Stack final form: a tall tower of three stacked green turtles, the bottom one big and strong, all smiling', 512],
  'pet-quanti-1': ['Quanti: a tiny cyan (#22d3ee) floating ghost wisp with a soft glow', 512],
  'pet-quanti-2': ['Quanti evolved: a cyan floating ghost with two thin glowing orbit rings around it', 512],
  'pet-quanti-3': ['Quanti final form: a cyan ghost shown in superposition as two overlapping translucent copies, with glowing orbit rings and sparkles', 512],
  // Accessoires & Items (Icons, freigestellt)
  'acc-party_hat': ['a single colorful striped cone party hat with a pompom, object only', 256],
  'acc-grad_cap': ['a single black graduation mortarboard cap with a golden tassel, object only', 256],
  'acc-glasses': ['a single pair of round thick-rimmed nerdy glasses, front view, object only', 256],
  'acc-headphones': ['a single pair of mint-and-purple over-ear headphones, front view, object only', 256],
  'acc-crown': ['a single golden crown with three rounded points and gems, object only', 256],
  'acc-scarf': ['a single cozy knitted blue-and-white striped scarf, object only', 256],
  'item-streak_freeze': ['a single translucent blue ice cube with a small orange flame frozen inside, object only', 256],
  'item-coin': ['a single shiny golden coin with a star embossed on it, object only', 256],
  'item-xp': ['a single glowing purple lightning-bolt gem, object only', 256],
  'item-flame': ['a single cheerful orange-yellow flame with a cute smiling face, object only', 256],
  'item-chest': ['a single small wooden treasure chest, slightly open, golden glow and coins inside, object only', 256],
  // Abzeichen (rund, Medaillen-Look)
  'badge-first': ['a round achievement medal badge with a single footprint symbol in the center, teal ribbon', 256],
  'badge-perfect': ['a round achievement medal badge with a big shining star in the center, gold ribbon', 256],
  'badge-boss': ['a round achievement medal badge with a crossed sword and shield in the center, red ribbon', 256],
  'badge-streak': ['a round achievement medal badge with a flame in the center, orange ribbon', 256],
  'badge-xp': ['a round achievement medal badge with a purple lightning gem in the center, purple ribbon', 256],
  'badge-practice': ['a round achievement medal badge with an open book and circular arrows in the center, blue ribbon', 256],
  'badge-evolve': ['a round achievement medal badge with a hatching egg and sparkles in the center, green ribbon', 256],
  'badge-collector': ['a round achievement medal badge with three small paw prints in the center, pink ribbon', 256],
  'badge-module': ['a round achievement medal badge with a golden trophy cup in the center, gold ribbon', 256],
};

const ICON_PROMPT = `App icon artwork, square 1024x1024, NOT transparent: a soft purple-to-violet gradient background filling the whole square, with the face and upper body of ${MASCOT} centered and large, smiling. Same sticker art style as described. No text.`;

const newestImage = (since) => {
  let best = null;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(png|webp|jpe?g)$/i.test(f) && st.mtimeMs > since && (!best || st.mtimeMs > best.mtimeMs)) best = { p, mtimeMs: st.mtimeMs };
    }
  };
  walk(GEN);
  return best?.p ?? null;
};

function generate(name, prompt) {
  const since = Date.now();
  const r = spawnSync(
    'codex',
    ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-m', process.env.CODEX_MODEL || 'gpt-5.6-luna', '-c', 'model_reasoning_effort="low"', '-'],
    { input: `Use your image generation tool to create exactly one image. Do not write any code. Reply only with "done".\n\n${prompt}`, encoding: 'utf8', timeout: 10 * 60_000, cwd: RAW },
  );
  if (/rate.?limit|usage limit|429/i.test(`${r.stdout}${r.stderr}`)) throw new Error('Codex-Rate-Limit');
  const img = newestImage(since);
  if (!img) throw new Error(`kein Bild erzeugt (exit ${r.status}): ${(r.stderr || '').slice(-300)}`);
  return img;
}

const filter = process.argv[2];
const force = new Set((process.env.FORCE || '').split(',').filter(Boolean));
const jobs = [...Object.entries(ASSETS).map(([n, [subject, size]]) => ({ name: n, prompt: `${STYLE}\n\nSubject: ${subject}.`, size, icon: false })), { name: 'app-icon', prompt: ICON_PROMPT, size: 1024, icon: true }];

for (const job of jobs) {
  if (filter && !job.name.includes(filter)) continue;
  const out = join(OUT, job.icon ? `${job.name}.png` : `${job.name}.webp`);
  if (existsSync(out) && !force.has(job.name)) continue;
  const t0 = Date.now();
  try {
    const src = generate(job.name, job.prompt);
    const img = sharp(src);
    if (job.icon) await img.resize(1024, 1024, { fit: 'cover' }).flatten({ background: '#7c5cff' }).png().toFile(out);
    else
      await img
        .trim({ threshold: 5 })
        .resize(Math.round(job.size * 0.92), Math.round(job.size * 0.92), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extend({ top: Math.round(job.size * 0.04), bottom: Math.round(job.size * 0.04), left: Math.round(job.size * 0.04), right: Math.round(job.size * 0.04), background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 86, alphaQuality: 90 })
        .toFile(out);
    await sharp(src).png().toFile(join(RAW, `${job.name}.png`));
    console.log(`✓ ${job.name} (${Math.round((Date.now() - t0) / 1000)} s)`);
  } catch (e) {
    console.log(`✗ ${job.name}: ${e.message}`);
    if (e.message.includes('Rate-Limit')) process.exit(2);
  }
}

// Kontaktabzüge (je 12 Bilder) zur Sichtprüfung
const files = readdirSync(OUT).filter((f) => f.endsWith('.webp')).sort();
for (let i = 0; i < files.length; i += 12) {
  const chunk = files.slice(i, i + 12);
  const tiles = await Promise.all(chunk.map((f) => sharp(join(OUT, f)).resize(240, 240, { fit: 'contain', background: '#e9e4ff' }).flatten({ background: '#e9e4ff' }).png().toBuffer()));
  await sharp({ create: { width: 4 * 250, height: Math.ceil(chunk.length / 4) * 250, channels: 3, background: '#ffffff' } })
    .composite(tiles.map((input, k) => ({ input, left: (k % 4) * 250 + 5, top: Math.floor(k / 4) * 250 + 5 })))
    .png()
    .toFile(resolve(RAW, `../contact-${String(i / 12 + 1).padStart(2, '0')}.png`));
}
console.log(`Kontaktabzüge: ${Math.ceil(files.length / 12)} in .tmp/`);
