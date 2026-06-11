/* Engine smoke test: node test/engine.test.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ console, setTimeout });
for (const f of ['cards.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}

vm.runInContext(`
const S = Game.state;
Game.setup(['Jennifer','Geovany','Maria','Ileana']);
console.assert(S.phase==='peek' && S.players.every(p=>p.hand.length===4) && S.deck.length===36, 'deal');

console.assert(Game.peekCard(0,0) && Game.peekCard(0,1) && !Game.peekCard(0,2), 'peek limit');
[0,1,2].forEach(i=>Game.setReady(i));
console.assert(S.phase==='peek','not started yet');
console.assert(Game.setReady(3)==='allReady' && S.phase==='turn','all ready');

const drawn = Game.drawFromDeck();
console.assert(drawn.rank && S.phase==='drawn','drawn');
const sw = Game.swapWithDrawn(2);
console.assert(S.players[0].hand[2]===drawn && Game.discardTop()===sw.replaced && S.current===1 && S.phase==='turn','swap+advance');

const taken = Game.takeDiscard();
console.assert(taken===sw.replaced && S.phase==='swapDiscard','take discard');
Game.swapWithDrawn(0);
console.assert(S.current===2,'advance to p2');

const top = Game.discardTop();
S.players[3].hand[1] = { rank: top.rank, suit: '♣' };
console.assert(Game.startBurn(3) && S.phase==='burn','burn start');
let res = Game.burnPick(1);
console.assert(res.type==='burnOk' && S.players[3].hand.length===3 && Game.discardTop().rank===top.rank,'burn ok');

const t2 = Game.discardTop();
S.players[1].hand[0] = { rank: t2.rank==='A'?'2':'A', suit:'♠' };
Game.startBurn(1);
res = Game.burnPick(0);
console.assert(res.type==='burnFail' && S.players[1].hand.length===5,'burn fail penalty');

const d2 = Game.drawFromDeck();
S.players[2].hand[0] = { rank: d2.rank, suit:'♠' };
S.players[2].hand[1] = { rank: d2.rank, suit:'♣' };
Game.startCombine();
Game.combinePick(0);
res = Game.combinePick(1);
console.assert(res.type==='combineOk' && S.players[2].hand.length===2,'combine ok');

console.assert(S.current===3 && S.phase==='turn','p3 turn');
S.deck.push({rank:'7',suit:'♦'});
Game.drawFromDeck();
console.assert(Game.canUsePower(),'power available');
Game.usePower();
console.assert(S.phase==='power7','power7 phase');
res = Game.powerTarget(3,0);
console.assert(res.type==='peekOwn' && Game.discardTop().rank==='7' && S.current===0,'power7 done');

S.deck.push({rank:'9',suit:'♦'});
Game.drawFromDeck(); Game.usePower();
const mine = S.players[0].hand[0], theirs = S.players[1].hand[0];
Game.powerTarget(0,0);
res = Game.powerTarget(1,0);
console.assert(res.type==='blindSwap' && S.players[0].hand[0]===theirs && S.players[1].hand[0]===mine,'9 swap');

console.assert(S.current===1,'p1 turn');
res = Game.declareMateo();
console.assert(res.reason==='mateo' && res.success===false,'mateo fail');
console.assert(res.rows[1].roundScore >= 15,'penalty applied');
console.assert(S.phase==='roundEnd'||S.phase==='gameOver','round ended');

if (S.phase==='roundEnd'){ Game.nextRound(); console.assert(S.round===2 && S.phase==='peek' && S.current===1,'round 2 dealt, starter rotated'); }

console.assert(cardValue({rank:'Q',suit:'♥'})===0 && cardValue({rank:'Q',suit:'♠'})===12 && cardValue({rank:'K',suit:'♣'})===13,'values');
console.log('ALL ENGINE TESTS PASSED');
`, ctx, { filename: 'test-body' });
