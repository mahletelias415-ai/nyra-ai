import {database} from './database.js';
import {askAgent} from './agent-service.js';
import {confirmScoutDraft,cancelScoutDraft,scoutDraftView} from './scout-drafts.js';
import {conditionsText} from './scout-core.mjs';
import {BillingError} from './payment-core.mjs';
type Row=Record<string,any>;
const db=database;
const removeKeyboard={remove_keyboard:true};
const ru=(s:string)=>/[а-яё]/i.test(s);
const code=(d:Row)=>d.id.slice(0,8);
function keyboard(rows:string[][]){return {keyboard:rows.map(r=>r.map(text=>({text}))),resize_keyboard:true,one_time_keyboard:true};}
function review(d:Row,russian:boolean){
 const unresolved=d.questions.length||d.unsupported.length,token=code(d);
 const text=[russian?(d.targetMissionId?'Изменения миссии · не применены':'Черновик Scout · не запущен'):(d.targetMissionId?'Mission changes · not applied':'Scout draft · not running'),d.title,'',...d.description.map((s:string)=>'• '+s),!d.description.length?(russian?'Дополнительные фильтры не заданы.':'No optional filters specified.'):'',russian?'Датированные Token Check обязательны.':'Dated Token Check evidence is always required.',...d.questions.flatMap((s:string)=>['',s]),...(d.unsupported.length?['',russian?'Не можем проверить:':'Cannot check:',...d.unsupported.map((s:string)=>'• '+s)]:[]),'',unresolved?(russian?'Уточни условия обычным сообщением. Запуск заблокирован, пока вопросы не решены.':'Describe revised conditions. Confirmation is blocked until these requirements are resolved.'):(russian?'Проверь все условия. Подтверди кнопкой ниже или напиши «Запустить '+token+'».':'Review every condition. Use the button below or type “Start '+token+'”.'),russian?'До подтверждения действующая миссия не меняется. Черновик действует 1 час.':'Your existing mission stays unchanged until confirmation. This draft expires in one hour.',russian?'После запуска: каждый час, до 12 кандидатов за скан, новые совпадения сюда. Один watch-слот. Подготовка и уточнение используют по одному ИИ-запросу.':'After confirmation: hourly, up to 12 candidates per scan, new matches here. One watch slot. Each preparation/refinement uses one AI request.','https://nyraagent.online/#scout'].filter(Boolean).join('\n');
 return {text,markup:keyboard([...(unresolved?[]:[[(russian?'Запустить ':'Start ')+token]]),[(russian?'Уточнить ':'Refine ')+token,(russian?'Отменить ':'Cancel ')+token],[(russian?'Новая миссия':'New mission')]])};
}
export async function telegramScout(user:string,chat:string,text:string,updateId:number){
 const at=Date.now(),lease=crypto.randomUUID();
 await db().prepare('INSERT OR IGNORE INTO nyra_telegram_scout_context(user_id,chat_id) VALUES(?,?)').bind(user,chat).run();
 const ctx=await db().prepare('UPDATE nyra_telegram_scout_context SET chat_id=?,lease=?,lease_until=?,last_update_id=? WHERE user_id=? AND last_update_id<=? AND (lease_until IS NULL OR lease_until<?) AND EXISTS(SELECT 1 FROM nyra_profiles WHERE user_id=? AND telegram_chat_id=?) RETURNING *').bind(chat,lease,at+150000,updateId,user,updateId,at,user,chat).first<Row>();
 if(!ctx){const latest=await db().prepare('SELECT last_update_id FROM nyra_telegram_scout_context WHERE user_id=?').bind(user).first<Row>();if(Number(latest?.last_update_id)>updateId)return {silent:true};throw new BillingError(503,'Another Telegram request is still processing.');}
 const russian=ru(text),t=text.trim(),lower=t.toLowerCase().replace(/[.!]+$/,'');
 const active=()=>db().prepare('SELECT user_id FROM nyra_profiles WHERE user_id=? AND telegram_chat_id=?').bind(user,chat).first();
 const save=async(draftId:string|null,missionId:string|null,revision:number|null,choices=ctx.choices,pending:string|null=null)=>{const changed=await db().prepare('UPDATE nyra_telegram_scout_context SET draft_id=?,mission_id=?,mission_revision=?,choices=?,pending_prompt=? WHERE user_id=? AND lease=? AND EXISTS(SELECT 1 FROM nyra_profiles WHERE user_id=? AND telegram_chat_id=?)').bind(draftId,missionId,revision,choices,pending,user,lease,user,chat).run();if(!changed.meta.changes)throw new BillingError(409,'This Telegram connection changed.');};
 const missions=async()=>{const r=await db().prepare('SELECT * FROM nyra_scout_missions WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC').bind(user).all<Row>();return r.results;};
 const choose=async(pending:string|null=null)=>{const all=await missions();await save(null,null,null,JSON.stringify(all.map(m=>({id:m.id,revision:m.revision}))),pending);return {text:[russian?'Выбери миссию для изменения:':'Choose a mission to edit:',...all.slice(0,12).map((m,i)=>`${i+1}. ${m.title} · ${m.paused?'paused':'active'}\n${conditionsText(JSON.parse(m.conditions)).join(' · ')}`),all.length>12?'More missions: https://nyraagent.online/#scout':'',russian?'Например: «Измени 1: ликвидность от $10k».':'For example: “Edit 1: liquidity at least $10k”.'].filter(Boolean).join('\n\n'),markup:keyboard(all.slice(0,6).map((_,i)=>[(russian?'Изменить ':'Edit ')+(i+1)]).concat([[russian?'Новая миссия':'New mission']]))};};
 try{
  if(t==='/missions'||lower==='миссии'||lower==='my missions')return await choose();
  if(['new mission','новая миссия','/new'].includes(lower)){await save(null,null,null);return {text:russian?'Напиши условия нового поиска: открытый GitHub, срок обновления, минимальная ликвидность и другие фильтры. Сначала покажу черновик.':'Describe your new project search: public GitHub, update window, minimum liquidity or other filters. I will show a draft first.',markup:removeKeyboard};}
  let row=ctx.draft_id?await db().prepare('SELECT * FROM nyra_scout_drafts WHERE id=? AND user_id=?').bind(ctx.draft_id,user).first<Row>():null;
  let d=row?scoutDraftView(row):null;
  const control=lower.match(/^(yes|да|start|confirm|apply|запустить|запускай|запусти|подтверждаю|подтвердить|применить|применяй|да[ ,]+запускай|refine|уточнить|cancel|отменить|отмена)(?:\s+([a-f0-9]{8}))?$/i);
  if(control){
   if(!d||control[2]&&control[2]!==code(d))return {text:russian?'Эта кнопка относится к другому черновику. Открой /missions или создай новый поиск.':'This control belongs to another draft. Open /missions or create a new search.',markup:removeKeyboard};
   if(/^(cancel|отмен)/.test(control[1])){await cancelScoutDraft(user,{id:d.id,revision:d.revision});await save(null,null,null);return {text:russian?'Черновик отменён. Действующая миссия не изменена.':'Draft cancelled. Your existing mission is unchanged.',markup:removeKeyboard};}
   if(/^(refine|уточнить)/.test(control[1]))return {text:russian?'Напиши, что поменять. Остальные условия сохраню и покажу новый черновик.':'Tell me what to change. I will keep the other conditions and show another draft.',markup:removeKeyboard};
   if(d.questions.length||d.unsupported.length)return review(d,russian);
   const result=await confirmScoutDraft(user,{id:d.id,revision:d.revision,title:d.title,conditions:d.conditions},{telegramChatId:chat});
   const mission=await db().prepare('SELECT revision,paused FROM nyra_scout_missions WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(result.id,user).first<Row>();
   await save(null,result.id,Number(mission?.revision||0));
   return {text:[russian?(result.updated?'Условия миссии сохранены.':'Scout-миссия сохранена.'):(result.updated?'Mission conditions saved.':'Scout mission saved.'),d.title,...d.description.map((s:string)=>'• '+s),mission?.paused?(russian?'Миссия остаётся на паузе. Возобновить можно в кабинете.':'The mission remains paused. Resume it in your workspace.'):result.applied?(russian?'Проверки каждый час, новые совпадения придут сюда. Первая проверка начинается сейчас.':'Checks run hourly; new matches arrive here. The first check starts now.'):(russian?'Эти условия уже применены. Повторный запуск не создан.':'These conditions were already applied. No duplicate was created.'),'https://nyraagent.online/#scout'].join('\n'),markup:removeKeyboard,...(result.applied&&!mission?.paused?{scanId:result.id}:{} )};
  }
  if(d?.status==='confirmed'&&d.missionId){const m=await db().prepare('SELECT id,revision FROM nyra_scout_missions WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(d.missionId,user).first<Row>();ctx.mission_id=m?.id||null;ctx.mission_revision=m?.revision||null;await save(null,ctx.mission_id,ctx.mission_revision);d=null;}
  const select=t.match(/^(?:edit|change|измени|изменить|редактировать|поменяй)(?:\s+(?:mission|миссию))?\s+(\d+)(?:(?:\s*[:—-]\s*|\s+)(.+))?$/i);
  let target=ctx.mission_id,targetRevision=ctx.mission_revision,prompt=t;
  if(select){const choices=JSON.parse(ctx.choices),choice=choices[Number(select[1])-1];if(!choice)return await choose();const m=await db().prepare('SELECT * FROM nyra_scout_missions WHERE id=? AND user_id=? AND revision=? AND deleted_at IS NULL').bind(choice.id,user,choice.revision).first<Row>();if(!m)return await choose();target=m.id;targetRevision=m.revision;d=null;await save(null,target,targetRevision);prompt=select[2]||ctx.pending_prompt||'';if(!prompt)return {text:[m.title,...conditionsText(JSON.parse(m.conditions)).map((s:string)=>'• '+s),'',russian?'Что поменять? Напиши обычным сообщением. До подтверждения поиск остаётся прежним.':'What should change? Send a message. The existing search stays unchanged until confirmation.'].join('\n'),markup:removeKeyboard};}
  else if(/^(?:edit|change|измени|поменяй|изменить)(?:\s|$)/i.test(t)&&!d&&!target){const all=await missions();if(all.length===1){target=all[0].id;targetRevision=all[0].revision;}else return await choose(t);}
  if(/^(?:find|search|create|new|найди|ищи|создай|новая|новый)(?:\s|$)/i.test(t)&&!select){d=null;target=null;targetRevision=null;}
  if(d?.status==='cancelled')d=null;
  if(d){target=d.targetMissionId;targetRevision=d.targetRevision;}
  if(prompt.length>1600)return {text:russian?'Сократи сообщение до 1600 символов. ИИ-запрос не потрачен.':'Use up to 1,600 characters. No AI request was used.',markup:removeKeyboard};
  if(!await active())throw new BillingError(403,'This Telegram chat is no longer connected.');
  const response=await askAgent(user,{prompt,scoutDraftId:d?.id},{scoutOnly:true,requestKey:'telegram:'+updateId,telegramChatId:chat,...(target?{targetMissionId:target,targetRevision:Number(targetRevision)}:{})});
  const result=await response.json();if(!response.ok)throw new BillingError(response.status,result.error||'This AI request is still processing. Try again shortly.');
  const prepared=await db().prepare('SELECT * FROM nyra_scout_drafts WHERE run_id=? AND user_id=?').bind(result.run?.id||'',user).first<Row>();
  if(!prepared||result.run.status!=='complete')return {text:result.run?.error||'A Scout draft could not be prepared. Send a fresh message to retry.',markup:removeKeyboard};
  const next=scoutDraftView(prepared);await save(next.id,next.targetMissionId,next.targetRevision);return review(next,russian);
 }finally{await db().prepare('UPDATE nyra_telegram_scout_context SET lease=NULL,lease_until=NULL WHERE user_id=? AND lease=?').bind(user,lease).run();}
}
