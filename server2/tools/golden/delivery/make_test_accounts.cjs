'use strict';
// Public RFC7515 A.2 key only. Never discover or read a service credential.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
if(process.version!=='v16.20.2'||process.argv.length!==3)throw Error('Node16.20.2 and exact checkout root required');
const root=fs.realpathSync(process.argv[2]);
const input=path.join(root,'server2/tests/delivery/fixtures/rfc7515-a2-key.pkcs8.b64');
const bytes=fs.readFileSync(input);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(sha(bytes)!=='57ea5536a0a770d015812a7c2bb2c82d829b8a7c564bdf64d82f93629a844149')throw Error('public RFC fixture identity');
const key=crypto.createPrivateKey({key:Buffer.from(bytes.toString().trim(),'base64'),type:'pkcs8',format:'der'});
const publicKey=crypto.createPublicKey(key).export({type:'spki',format:'der'});
const pem=key.export({type:'pkcs8',format:'pem'});
const files={};
for(const [product,project] of [['todayWeather','tw-oracle'],['todayAir','ta-oracle']]){
 const file=path.join(root,'server2/tools/golden/delivery/fcm-test-'+product+'.json');
 const data=Buffer.from(JSON.stringify({type:'service_account',project_id:project,private_key_id:'oracle',private_key:pem,client_email:'oracle@'+project+'.iam.gserviceaccount.com'}));
 fs.writeFileSync(file,data,{flag:'wx',mode:0o600});files[path.relative(root,file)]=sha(data);
}
process.stdout.write(JSON.stringify({public_fixture_sha256:sha(bytes),public_spki_sha256:sha(publicKey),files})+'\n');
