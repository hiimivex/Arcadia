const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
const S=require('../src/saves');
const t=fs.mkdtempSync(path.join(os.tmpdir(),'sv-'));
const ctx=(exeDir)=>({exeDir,appData:path.join(t,'ad'),localAppData:t,documents:path.join(t,'doc')});
// PPSSPP : deux jeux dans SAVEDATA, on ne copie que celui demandé
const pp=path.join(t,'emu','PPSSPP'); const sd=path.join(pp,'memstick','PSP','SAVEDATA');
for(const id of ['ULES00151','ULUS10497']){fs.mkdirSync(path.join(sd,id+'DATA00'),{recursive:true});fs.writeFileSync(path.join(sd,id+'DATA00','DATA.BIN'),id);}
const dir=S.gameDir(path.join(t,'saves'),'PSP','GTA LCS');
let r=S.backup({dir,emuId:'ppsspp',ctx:ctx(pp),gameTitle:'GTA LCS',key:{serial:'ULES00151'}});
assert.equal(r.count,1,'un seul jeu copié');
assert.equal(S.backup({dir,emuId:'ppsspp',ctx:ctx(pp),gameTitle:'GTA LCS',key:{serial:'ULES00151'}}).skipped,'rien de nouveau');
fs.writeFileSync(path.join(sd,'ULES00151DATA00','DATA.BIN'),'CHANGED');
assert.equal(S.restore(S.list(dir)[0].file,{emuId:'ppsspp',ctx:ctx(pp)}).count,1);
assert.equal(fs.readFileSync(path.join(sd,'ULES00151DATA00','DATA.BIN'),'utf8'),'ULES00151');
// Eden : filtre par Title ID
const ed=path.join(t,'emu','Eden'); const save=path.join(ed,'user','nand','user','save','0000000000000000','AB12');
for(const id of ['0100C9C00E25C000','01006F8002326000']){fs.mkdirSync(path.join(save,id),{recursive:true});fs.writeFileSync(path.join(save,id,'s.bin'),id);}
const d2=S.gameDir(path.join(t,'saves'),'SWITCH','Mario Golf');
assert.equal(S.backup({dir:d2,emuId:'eden',ctx:ctx(ed),gameTitle:'Mario Golf',key:{titleId:'0100C9C00E25C000'}}).count,1);
// melonDS : fichier .sav voisin de la ROM
const rom=path.join(t,'lib','DS','Mario Kart DS.nds'); fs.mkdirSync(path.dirname(rom),{recursive:true}); fs.writeFileSync(rom,'x'); fs.writeFileSync(rom.replace('.nds','.sav'),'SAVE1');
const d3=S.gameDir(path.join(t,'saves'),'DS','Mario Kart DS');
assert(S.backup({dir:d3,emuId:'melonds',ctx:ctx(t),romPath:rom,gameTitle:'Mario Kart DS'}).file);
fs.writeFileSync(rom.replace('.nds','.sav'),'SAVE2');
S.restore(S.list(d3)[0].file,{emuId:'melonds',ctx:ctx(t),romPath:rom});
assert.equal(fs.readFileSync(rom.replace('.nds','.sav'),'utf8'),'SAVE1');
// sessions
S.logSession(d3,{start:1,end:61,seconds:60}); S.logSession(d3,{start:100,end:400,seconds:300});
assert.equal(S.sessions(d3).length,2);
console.log('saves: OK');
