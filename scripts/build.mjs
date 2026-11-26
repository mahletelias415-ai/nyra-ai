import {readFile}from'node:fs/promises';
const html=await readFile('public/index.html','utf8');if(!html.includes('Nyra')||!html.includes('research-form'))throw Error('Missing Nyra application shell.');
console.log('Nyra static assets and Node API ready.');
