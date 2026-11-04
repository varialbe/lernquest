import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, PETS, SHOP_ITEMS, THEMES, QUESTS, LEAGUES, MODULE_INFO, KNOWLEDGE_KIND_LABEL } from '@lernquest/shared';
import { gameTextEn } from '../../apps/web/src/i18n/catalog.ts';
import { commonEn } from '../../apps/web/src/i18n/common.ts';
import { pageEn } from '../../apps/web/src/i18n/pages.ts';
import { de, detectLocale, en, formatNumber } from '../../apps/web/src/i18n/index.tsx';

describe('locale selection', () => {
  it.each([
    ['de-AT', 'de'],
    ['de_CH', 'de'],
    ['DE-de', 'de'],
    ['de', 'de'],
    ['en-US', 'en'],
    ['fr', 'en'],
    ['', 'en'],
  ] as const)('maps %s to %s', (input, expected) => expect(detectLocale(input)).toBe(expected));

  it('uses the first preferred device language and defaults empty devices to English', () => {
    expect(detectLocale(['en-US', 'de-DE'])).toBe('en');
    expect(detectLocale(['de-AT', 'en-US'])).toBe('de');
    expect(detectLocale([])).toBe('en');
    expect(detectLocale(null)).toBe('en');
  });

  it('has an English value for every German dictionary key and formats numbers per locale', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
  });
});


describe('English display catalogues', () => {
  it('covers every shared catalogue name and description', () => {
    const strings = [
      ...PETS.flatMap(pet => [pet.name, pet.blurb, ...pet.stageNames]),
      ...SHOP_ITEMS.flatMap(item => [item.name, item.description]),
      ...ACHIEVEMENTS.flatMap(item => [item.name, item.description]),
      ...Object.values(THEMES).map(theme => theme.name),
      ...QUESTS.map(quest => quest.title),
      ...LEAGUES,
      ...Object.values(MODULE_INFO).map(module => module.name),
      ...Object.values(KNOWLEDGE_KIND_LABEL),
    ];
    expect([...new Set(strings)].filter(text => !(text in gameTextEn))).toEqual([]);
  });

  it('does not contain empty English UI translations', () => {
    for (const dictionary of [en, commonEn, pageEn, gameTextEn]) {
      expect(Object.values(dictionary).filter(text => !text.trim())).toEqual([]);
    }
  });
});
