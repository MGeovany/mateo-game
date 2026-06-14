/* Engine smoke test: node test/engine.test.js */
const { createGame } = require('../server/game');

const Game = createGame();
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
// burned slot becomes a hole; the other cards keep their positions
console.assert(S.players[1].hand[0]===null,'burned card leaves an empty slot');
console.assert(S.players[1].hand.length===4 && S.players[1].hand.filter(Boolean).length===3,'positions kept, 3 cards remain');
console.assert(S.eliminated.length===2,'both cards eliminated from the game');
console.assert(S.fresh===null,'fresh discard gone');
console.assert(Game.takeDiscard()===null,'next player cannot take a burned discard');

// no chaining: once a card is burned the target is cleared, so nobody can
// burn that same card again (not even the burner holding another 2)
console.assert(S.burnTarget===null,'burn target cleared after a burn');
S.players[1].hand[0] = {rank:'2',suit:'♦'};
console.assert(!Game.startBurn(1),'cannot burn again — there is no target');
console.assert(S.phase==='turn','still p1 turn, burn was not allowed');
// give p1 a replacement card so later hand-size expectations hold
S.players[1].hand.push({rank:'5',suit:'♠'});

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
console.assert(res.type==='combineOk','combine ok');
// the two matched cards leave holes; positions are kept, 2 cards remain
console.assert(S.players[3].hand[0]===null && S.players[3].hand[1]===null,'combined cards leave empty slots');
console.assert(S.players[3].hand.filter(Boolean).length===2,'2 cards remain after combine');
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

// ---- points scoring: a Mateo call always ends the round ----
S.phase = 'turn'; S.current = 2;
S.players.forEach((p) => { p.score = 0; });
S.players[0].hand = [{rank:'K',suit:'♠'}]; // 13
S.players[1].hand = [{rank:'5',suit:'♠'}]; // 5
S.players[2].hand = [{rank:'2',suit:'♠'}]; // 2  (caller, strictly lowest)
S.players[3].hand = [{rank:'9',suit:'♠'}]; // 9
res = Game.declareMateo();
console.assert(S.phase==='roundEnd','mateo ends the round');
console.assert(res.callerWon===true,'caller had the lowest value → won');
console.assert(res.rows[2].points===0 && S.players[2].score===0,'winning caller scores 0');
console.assert(res.rows[0].points===13 && res.rows[1].points===5 && res.rows[3].points===9,'others bank their card value');

// next round: starter rotates, table resets, but SCORES persist
Game.nextRound();
console.assert(S.round===2 && S.phase==='peek' && S.current===1,'round 2, starter rotated');
console.assert(S.eliminated.length===0 && S.fresh===null,'piles reset');
console.assert(S.players[0].score===13,'scores accumulate across rounds');
[0,1,2,3].forEach(i=>Game.setReady(i));

// failed Mateo: caller is not the strictly-lowest → card value + 15 penalty
S.phase = 'turn'; S.current = 1;
S.players[0].hand = [{rank:'3',suit:'♠'}]; // 3 (lowest)
S.players[1].hand = [{rank:'7',suit:'♠'}]; // 7 caller → 7+15 = 22
S.players[2].hand = [{rank:'8',suit:'♠'}];
S.players[3].hand = [{rank:'8',suit:'♣'}];
const total1Before = S.players[1].score;
res = Game.declareMateo();
console.assert(res.callerWon===false && res.rows[1].points===22,'failed mateo: card value + 15');
console.assert(S.players[1].score===total1Before+22,'penalty added to the total');

// tie at the lowest value → caller did NOT win (penalty still applies)
Game.nextRound();
[0,1,2,3].forEach(i=>Game.setReady(i));
S.phase = 'turn'; S.current = 0;
S.players[0].hand = [{rank:'4',suit:'♠'}]; // 4 caller
S.players[1].hand = [{rank:'4',suit:'♥'}]; // 4 ties the caller
S.players[2].hand = [{rank:'9',suit:'♠'}];
S.players[3].hand = [{rank:'9',suit:'♣'}];
res = Game.declareMateo();
console.assert(res.callerWon===false && res.rows[0].points===4+15,'tie at lowest is not a win');

// empty hand scores -10 regardless of who called
Game.nextRound();
[0,1,2,3].forEach(i=>Game.setReady(i));
S.phase = 'turn'; S.current = 1;
S.players[0].hand = [];                     // emptied
S.players[1].hand = [{rank:'5',suit:'♠'}];  // caller
S.players[2].hand = [{rank:'6',suit:'♠'}];
S.players[3].hand = [{rank:'7',suit:'♠'}];
res = Game.declareMateo();
console.assert(res.rows[0].points===-10,'empty hand scores -10');

// Q♥ wildcard is worth 0
Game.nextRound();
[0,1,2,3].forEach(i=>Game.setReady(i));
S.phase = 'turn'; S.current = 0;
S.players[0].hand = [{rank:'Q',suit:'♥'}];   // wildcard → 0
S.players[1].hand = [{rank:'Q',suit:'♠'}];   // 12
res = Game.declareMateo();
console.assert(res.rows[0].points===0 && res.rows[0].sum===0,'Q♥ is worth 0');

// reaching 100 ends the game: highest total loses, lowest wins
Game.nextRound();
[0,1,2,3].forEach(i=>Game.setReady(i));
S.phase = 'turn'; S.current = 2;
S.players.forEach((p, i) => { p.score = i === 2 ? 95 : 0; });
S.players[0].hand = [{rank:'A',suit:'♠'}]; // 1 (lowest)
S.players[1].hand = [{rank:'2',suit:'♠'}];
S.players[2].hand = [{rank:'K',suit:'♠'}]; // caller fails → 13+15 = 28 → 95+28 = 123
S.players[3].hand = [{rank:'3',suit:'♠'}];
res = Game.declareMateo();
console.assert(S.phase==='gameOver','reaching 100 ends the game');
console.assert(S.gameOver.loser==='Maria','highest total loses');
console.assert(S.gameOver.winner==='Jennifer','lowest total wins');

console.log('ALL ENGINE TESTS PASSED');
