// Append GSC JWT assertion test (UTF-8 safe).
import {readFileSync,writeFileSync} from 'node:fs';
const p='test/analysis.test.mjs';
let t=readFileSync(p,'utf8');
if(t.includes('gscAssertion')){console.log('already present');process.exit(0);}
t=t.replace("import {Store,nextRunAtFor} from '../store.js';","import {Store,nextRunAtFor} from '../store.js';import {gscAssertion} from '../syncers.js';import {generateKeyPairSync,createVerify} from 'node:crypto';");
t+=`
test('GSC service-account assertion is a verifiable RS256 JWT',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const sa={client_email:'seo-bot@project.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})};
  const jwt=gscAssertion(sa,1700000000);
  const [h,c,sig]=jwt.split('.');
  const header=JSON.parse(Buffer.from(h,'base64url').toString());
  const claim=JSON.parse(Buffer.from(c,'base64url').toString());
  assert.equal(header.alg,'RS256');
  assert.equal(claim.iss,sa.client_email);
  assert.equal(claim.scope,'https://www.googleapis.com/auth/webmasters.readonly');
  assert.equal(claim.aud,'https://oauth2.googleapis.com/token');
  assert.equal(claim.exp-claim.iat,3600);
  const v=createVerify('RSA-SHA256');v.update(h+'.'+c);v.end();
  assert.ok(v.verify(publicKey,sig,'base64url'));
});
`;
writeFileSync(p,t);
console.log('appended');
