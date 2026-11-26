import test from 'node:test';
import assert from 'node:assert/strict';
import {questionIntent} from '../public/intent.js';

test('a guest comparison keeps both assets and requests AI sign-in rather than a single quote',()=>{
 const q=questionIntent('Compare AAPL and NVDA');assert.equal(q.kind,'signin');assert.equal(q.text,'Compare AAPL and NVDA');
 assert.equal(questionIntent('AAPL vs NVDA').kind,'signin');
});
test('guest direct reads and explicit watch plans remain available without creating an AI call',()=>{
 assert.equal(questionIntent('NVDA price').kind,'plan');
 assert.equal(questionIntent('Read RH network gas').kind,'plan');
 assert.equal(questionIntent('Alert me when NVDA goes below $150',{signedIn:true,aiConfigured:true}).kind,'plan');
});
test('ordinary questions have an explicit path and unavailable AI does not become an unrelated quote',()=>{
 assert.equal(questionIntent('What changed on Robinhood Chain?').kind,'signin');
 assert.equal(questionIntent('Compare AAPL and NVDA',{signedIn:true,aiConfigured:true}).kind,'research');
 assert.equal(questionIntent('Compare AAPL and NVDA',{signedIn:true}).kind,'unavailable');
 assert.equal(questionIntent('   ').kind,'empty');
});
