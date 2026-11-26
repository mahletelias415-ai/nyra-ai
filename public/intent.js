import {parseOrder} from './plan-core.js';

export function questionIntent(value,{signedIn=false,aiConfigured=false}={}){
 const text=String(value||'').trim();
 if(!text)return {kind:'empty',text,message:'Type a question or choose a quick start below.'};
 if(text.length>1600)return {kind:'empty',text,message:'Keep your question within 1,600 characters.'};
 let plan;try{plan=parseOrder(text);}catch{}
 const scout=/\bscout\b|скаут|мисси/iu.test(text)||(/\b(projects?|builders?|launches?|tokens?)\b|проект|токен/iu.test(text)&&/liquidity|github|public code|creator|volume|market cap|bonded|graduated|last \d+ days|ликвид|гитхаб|разработ|объем|объём|код|бонд|свеж/iu.test(text));
 if(scout)return signedIn?(aiConfigured?{kind:'research',text}:{kind:'unavailable',text,message:'The AI connection is unavailable. You can still use the manual Scout builder.'}):{kind:'signin',text};
 const watch=/\b(watch|alert|notify|tell me when|let me know|keep an eye)\b/i.test(text);
 const symbols=new Set(text.toUpperCase().match(/\b(NVDA|AAPL|TSLA|MSFT|GOOGL|AMZN|SPY|QQQ)\b/g)||[]);
 const research=symbols.size>1||/\b(compare|versus|vs|why|how|what|explain|research|analyse|analyze|summary|summarize|difference)\b/i.test(text);
 if(watch&&plan?.canWatch&&symbols.size<=1)return {kind:'plan',text};
 if(signedIn&&aiConfigured)return {kind:'research',text};
 if(plan&&!research)return {kind:'plan',text};
 return signedIn?{kind:'unavailable',text,message:'The AI connection is unavailable. Live source readings still work.'}:{kind:'signin',text};
}
