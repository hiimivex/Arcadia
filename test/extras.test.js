const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),http=require('http');
const X=require('../src/extras');
const t=fs.mkdtempSync(path.join(os.tmpdir(),'ex-'));
const z=path.join(t,'zero.3ds'); fs.writeFileSync(z,Buffer.alloc(4<<20));
const r=path.join(t,'ok.3ds'); const b=Buffer.alloc(4<<20); b.write('NCSD',0x100); fs.writeFileSync(r,b);
assert.equal(X.looksEmpty(z),true); assert.equal(X.looksEmpty(r),false);
const store=path.join(t,'arcadia.json'); fs.writeFileSync(store,'{"a":1}');
X.backupStore(store,path.join(t,'bk')); assert.equal(X.listStoreBackups(path.join(t,'bk')).length,1);
// captures prises pendant une session
const exe=path.join(t,'PPSSPP'),sd=path.join(exe,'memstick','PSP','SCREENSHOT'); fs.mkdirSync(sd,{recursive:true});
const a=path.join(sd,'in.png'),o=path.join(sd,'out.png'); fs.writeFileSync(a,'x'); fs.writeFileSync(o,'x');
const now=Date.now()/1000; fs.utimesSync(a,now,now); fs.utimesSync(o,now-86400,now-86400);
const shots=X.sessionShots('ppsspp',{exeDir:exe,documents:t,appData:t,localAppData:t},null,[{start:Date.now()-600000,end:Date.now()}]);
assert.deepEqual(shots.map(s=>path.basename(s.path)),['in.png']);
// télécommande
const rem=new X.Remote({getGames:()=>[{id:'g1',title:'Mario <b>',console:'SWITCH'}],coverOf:()=>null,launch:id=>({ok:id==='g1'}),port:7799});
rem.start().then(async()=>{
  const get=(p,m='GET')=>new Promise(res=>{const q=http.request({host:'127.0.0.1',port:7799,path:p,method:m},s=>{let d='';s.on('data',c=>d+=c);s.on('end',()=>res([s.statusCode,d]))});q.end();});
  assert.equal((await get('/'))[0],403);
  const [c,html]=await get('/?t='+rem.token); assert.equal(c,200); assert(html.includes('Mario &lt;b&gt;'));
  assert.equal(JSON.parse((await get('/play/g1?t='+rem.token,'POST'))[1]).ok,true);
  rem.stop(); console.log('extras: OK');
});
