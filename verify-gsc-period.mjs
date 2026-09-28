import {readFile} from 'node:fs/promises';import {seoScope} from './seo-reports.js';
const s=JSON.parse(await readFile('../monitor-v3/state.json','utf8'));
const r=seoScope(s,{site:'dshdesktop.com',sources:['gsc'],from:'2026-09-20',to:'2026-09-25',coverage:'actual'});
console.log(JSON.stringify({count:r.count,sources:r.sources,records:r.records.map(x=>({id:x.id,periodFrom:x.periodFrom,periodTo:x.periodTo,clicks:x.clicks,impressions:x.impressions,position:x.position}))},null,2));