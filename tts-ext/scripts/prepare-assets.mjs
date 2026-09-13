import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets-manifest.json'),'utf8'));
const hash=p=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');fs.createReadStream(p).on('data',b=>h.update(b)).on('end',()=>resolve(h.digest('hex'))).on('error',reject);});
for(const asset of manifest.assets){
 const dest=path.join(root,'src/public',asset.path);fs.mkdirSync(path.dirname(dest),{recursive:true});
 if(fs.existsSync(dest)){
  if(await hash(dest)!==asset.sha256)throw Error('Existing asset differs from the pinned version; preserve/check it before replacing: '+asset.path);
  console.log('Verified installed asset:',asset.path);continue;
 }
 const temporary=dest+'.download';
 try{
  if(asset.packageSource){fs.copyFileSync(path.join(root,asset.packageSource),temporary);}
  else{console.log('One-time download:',asset.path);const response=await fetch(asset.url);if(!response.ok||!response.body)throw Error('Asset download failed: '+response.status);await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(temporary));}
  if(fs.statSync(temporary).size!==asset.bytes||await hash(temporary)!==asset.sha256)throw Error('Asset size/hash mismatch: '+asset.path);
  fs.renameSync(temporary,dest);
 }catch(error){if(fs.existsSync(temporary))fs.unlinkSync(temporary);throw error;}
}
fs.writeFileSync(path.join(root,'src/public/ASSET_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('All speech assets are installed. Inference uses extension URLs, not network downloads.');
