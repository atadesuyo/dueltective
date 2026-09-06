import type { Answer, GameCategory } from '../game-types';
import { categoryQuestions } from './rosters';

export type Secret = {
  name: string;
  aliases: string[];
  facts: string;
  category: GameCategory;
  yes?: number[];
};

const pack: Record<GameCategory, Secret[]> = {
  overwatch: [
    {
      name: 'Tracer',
      aliases: ['猎空', '闪光'],
      facts: '英国输出英雄；使用脉冲双枪；能闪回时间。',
      category: 'overwatch',
      yes: [2],
    },
    {
      name: 'Mercy',
      aliases: ['天使', '安吉拉·齐格勒'],
      facts: '瑞士支援英雄；能治疗与复活队友。',
      category: 'overwatch',
      yes: [0, 1],
    },
    {
      name: 'Winston',
      aliases: ['温斯顿', '猩猩'],
      facts: '月球出生的重装英雄；是一只经过基因改造的大猩猩。',
      category: 'overwatch',
      yes: [],
    },
  ],
  'street-fighter-6': [
    {
      name: 'Ryu',
      aliases: ['隆'],
      facts: '日本格斗家；使用波动拳；初代街霸角色。',
      category: 'street-fighter-6',
      yes: [0, 1],
    },
    {
      name: 'Chun-Li',
      aliases: ['春丽'],
      facts: '中国格斗家；擅长腿技；系列经典角色。',
      category: 'street-fighter-6',
      yes: [1],
    },
    {
      name: 'Kimberly',
      aliases: ['金伯莉'],
      facts: '美国忍者；首次成为可操控角色于街霸 6。',
      category: 'street-fighter-6',
      yes: [2],
    },
  ],
  'pokemon-151': [
    {
      name: '皮卡丘',
      aliases: ['Pikachu'],
      facts: '电属性；全国图鉴 025；可进化为雷丘。',
      category: 'pokemon-151',
      yes: [1, 2],
    },
    {
      name: '杰尼龟',
      aliases: ['Squirtle'],
      facts: '水属性；全国图鉴 007；可进化。',
      category: 'pokemon-151',
      yes: [0, 1, 2],
    },
    {
      name: '超梦',
      aliases: ['Mewtwo'],
      facts: '超能力属性；全国图鉴 150；不能进化。',
      category: 'pokemon-151',
      yes: [],
    },
  ],
};

export function questionsFor(category: GameCategory) {
  return categoryQuestions[category];
}

export function demoSecret(category: GameCategory, excluded: string[] = []) {
  const options = pack[category].filter(
    (secret) => !excluded.includes(secret.name),
  );
  const pool = options.length ? options : pack[category];
  return structuredClone(
    pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length],
  );
}

export function demoAnswer(secret: Secret, question: string): Answer {
  const normalize = (value: string) => value.replace(/[？?\s]/g, '');
  const index = questionsFor(secret.category).findIndex(
    (candidate) => normalize(candidate) === normalize(question),
  );
  if (index < 0) return 'UNKNOWN';
  return secret.yes?.includes(index) ? 'YES' : 'NO';
}
