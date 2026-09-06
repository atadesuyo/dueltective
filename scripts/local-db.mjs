import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const directory='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
if(!existsSync(directory))throw new Error('Start npm run dev and visit the app before initializing the local database.');
const filename=readdirSync(directory).find(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite');
if(!filename)throw new Error('Visit the local app once to create its D1 database.');
const db=new DatabaseSync(join(directory,filename));
db.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()){
 if(db.prepare('SELECT name FROM local_migrations WHERE name=?').get(file))continue;
 // The initial migration was applied while bootstrapping this development checkout.
 const initial=file.startsWith('0000_')&&db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rooms'").get();
 if(!initial)db.exec(readFileSync(join('drizzle',file),'utf8'));
 db.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(file);
}
db.close();console.log('Local database is ready.');
