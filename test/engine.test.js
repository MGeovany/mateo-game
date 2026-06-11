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

// p0 draws a rigged 2 and discards it -> it becomes the fresh discard
S.deck.push({rank:'2',suit:'♠'});
const d0 = Game.drawFromDeck();
console.assert(d0.rank==='2' && S.phase==='drawn','drew rigged 2');
Game.discardDrawn();
console.assert(S.fresh && S.fresh.rank==='2' && S.current===1,'fresh discard, p1 turn');

// p1 burns their rigged 2 -> both cards eliminated, take right lost
S.players[1].hand[0] = {rank:'2',suit:'♥'};
console.assert(Game.startBurn(1),'burn start');
let res = Game.burnPick(0);
console.assert(res.type==='burnOk','burn ok');
console.assert(S.players[1].hand.length===3,'burner hand shrank');
console.assert(S.eliminated.length===2,'both cards eliminated from the game');
console.assert(S.fresh===null,'fresh discard gone');
console.assert(Game.takeDiscard()===null,'next player cannot take a burned discard');
console.assert(!Game.startBurn(2),'cannot burn the same discard twice');

// p1 normal turn: draw + swap -> the replaced card becomes fresh, p2 takes it
Game.drawFromDeck();
res = Game.swapWithDrawn(1);
console.assert(S.fresh===res.replaced && S.current===2,'swap leaves a fresh discard');
const taken = Game.takeDiscard();
console.assert(taken===res.replaced && S.phase==='swapDiscard','next player takes the fresh discard');
Game.swapWithDrawn(0);
console.assert(S.current===3,'turn advanced to p3');

// burn fail by p0: wrong rank -> +1 penalty card, discard stays takeable
const wrong = S.fresh.rank==='A' ? '2' : 'A';
S.players[0].hand[0] = {rank:wrong,suit:'♣'};
Game.startBurn(0);
res = Game.burnPick(0);
console.assert(res.type==='burnFail' && S.players[0].hand.length===5,'burn fail penalty');
console.assert(S.fresh,'failed burn keeps the discard in play');

// p3: combine a rigged trio
const d3 = Game.drawFromDeck();
S.players[3].hand[0]={rank:d3.rank,suit:'♠'};
S.players[3].hand[1]={rank:d3.rank,suit:'♣'};
Game.startCombine(); Game.combinePick(0); res = Game.combinePick(1);
console.assert(res.type==='combineOk' && S.players[3].hand.length===2,'combine ok');
console.assert(S.fresh && S.fresh.rank===d3.rank,'trio leaves the drawn card fresh');

// p0: power 7
console.assert(S.current===0,'p0 turn');
S.deck.push({rank:'7',suit:'♦'});
Game.drawFromDeck();
console.assert(Game.canUsePower(),'power available');
Game.usePower();
console.assert(S.phase==='power7','power7 phase');
res = Game.powerTarget(0,0);
console.assert(res.type==='peekOwn' && S.current===1,'power7 done');

// p1: power 9 blind swap with p2
S.deck.push({rank:'9',suit:'♦'});
Game.drawFromDeck(); Game.usePower();
const mine = S.players[1].hand[0], theirs = S.players[2].hand[0];
Game.powerTarget(1,0);
res = Game.powerTarget(2,0);
console.assert(res.type==='blindSwap' && S.players[1].hand[0]===theirs && S.players[2].hand[0]===mine,'9 swap');

// p2 mateo fail: p3 has fewest cards -> p2 loses a star, round continues
console.assert(S.current===2,'p2 turn');
S.players[2].stars = 1;
res = Game.declareMateo();
console.assert(res.type==='mateoFail' && S.players[2].stars===0,'mateo fail loses a star');
console.assert(S.phase==='turn' && S.current===3,'round continues, call consumed the turn');

// p3 mateo win: strictly fewest cards -> star + round end
res = Game.declareMateo();
console.assert(res.type==='mateoWin' && S.players[3].stars===1 && S.phase==='roundEnd','mateo win earns a star');
console.assert(S.roundResult.rows[3].stars===1,'round result carries stars');

// next round: starter rotates, table resets
Game.nextRound();
console.assert(S.round===2 && S.phase==='peek' && S.current===1,'round 2, starter rotated');
console.assert(S.eliminated.length===0 && S.fresh===null,'piles reset');

// mateo tie: same minimum count -> nobody gains or loses, round continues
[0,1,2,3].forEach(i=>Game.setReady(i));
const starsBefore = S.players[1].stars;
res = Game.declareMateo();
console.assert(res.type==='mateoTie' && S.players[1].stars===starsBefore,'tie changes nothing');
console.assert(S.phase==='turn' && S.current===2,'round continues after tie');

// third star wins the game
S.players[3].stars = 2;
S.players[3].hand = S.players[3].hand.slice(0,2);
S.current = 3;
res = Game.declareMateo();
console.assert(res.type==='mateoWin' && S.phase==='gameOver' && S.gameOver.winner==='Ileana','3 stars wins the game');

console.log('ALL ENGINE TESTS PASSED');
`, ctx, { filename: 'test-body' });
