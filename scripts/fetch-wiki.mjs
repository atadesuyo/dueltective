// 从 fandom wiki 抓取守望先锋与街霸6的角色词条纯文本，存为 lib/server/wiki-cache.json。
// 在你自己的电脑上联网运行（本开发沙箱无法访问 fandom）：
//   node scripts/fetch-wiki.mjs
// 生成的数据可用于人工核对并合并进 lib/server/knowledge.ts。
import { writeFileSync } from 'node:fs';

const WIKIS = {
  overwatch: 'https://overwatch.fandom.com/api.php',
  'street-fighter-6': 'https://streetfighter.fandom.com/api.php',
};

const TITLES = {
  overwatch: [
    'Ana',
    'Ashe',
    'Baptiste',
    'Bastion',
    'Brigitte',
    'Cassidy',
    'D.Va',
    'Doomfist',
    'Echo',
    'Freja',
    'Genji',
    'Hanzo',
    'Hazard',
    'Illari',
    'Junker Queen',
    'Junkrat',
    'Juno',
    'Kiriko',
    'Lifeweaver',
    'Lúcio',
    'Mauga',
    'Mei',
    'Mercy',
    'Moira',
    'Orisa',
    'Pharah',
    'Ramattra',
    'Reaper',
    'Reinhardt',
    'Roadhog',
    'Sigma',
    'Sojourn',
    'Soldier: 76',
    'Sombra',
    'Symmetra',
    'Torbjörn',
    'Tracer',
    'Venture',
    'Widowmaker',
    'Winston',
    'Wrecking Ball',
    'Zarya',
    'Zenyatta',
  ],
  'street-fighter-6': [
    'Luke',
    'Jamie',
    'Manon',
    'Kimberly',
    'Marisa',
    'Lily',
    'JP',
    'Juri',
    'Dee Jay',
    'Cammy',
    'Ryu',
    'E. Honda',
    'Blanka',
    'Guile',
    'Ken',
    'Chun-Li',
    'Zangief',
    'Dhalsim',
    'Rashid',
    'A.K.I.',
    'Ed',
    'Akuma',
    'M. Bison',
    'Terry',
    'Mai',
    'Elena',
    'Sagat',
    'C. Viper',
    'Alex',
    'Ingrid',
  ],
};

async function fetchExtracts(api, titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    const url = new URL(api);
    url.search = new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      explaintext: '1',
      exlimit: 'max',
      format: 'json',
      formatversion: '2',
      redirects: '1',
      titles: chunk.join('|'),
    }).toString();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${api}`);
    }
    const json = await response.json();
    for (const page of json?.query?.pages ?? []) {
      out[page.title] = page.extract ?? '';
    }
  }
  return out;
}

const result = { generatedAt: new Date().toISOString(), categories: {} };
for (const [category, api] of Object.entries(WIKIS)) {
  result.categories[category] = await fetchExtracts(api, TITLES[category]);
  console.log(
    `fetched ${category}: ${Object.keys(result.categories[category]).length} pages`,
  );
}
const target = 'lib/server/wiki-cache.json';
writeFileSync(target, JSON.stringify(result, null, 2));
console.log(`saved ${target}`);
