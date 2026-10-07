/* Pure household operations shared by the browser and sync tests. */
(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
function error(message,status=400){let e=new Error(message);e.status=status;throw e}
function id(x){if(typeof x!=='string'||! /^[A-Za-z0-9_.:-]{1,200}$/.test(x)||['__proto__','constructor','prototype'].includes(x))error('Invalid record identifier.');return x}
function positive(x){if(typeof x!=='number'||!Number.isFinite(x)||x<=0)error('Enter a positive quantity.');return x}
function unit(x){text(x);if(!x.trim()||/[<>"'`\\]/.test(x))error('Use a plain unit such as g, ml, each, can or cup.');return x}
function text(x){if(typeof x!=='string')error('Invalid text in household records.');return x}
function validateState(raw,initial){
 if(!raw||typeof raw!=='object')error('Backup has no household records.');
 let s=copy(initial);
 for(let key of Object.keys(s))if(key!=='version'&&raw[key]!==undefined){if(Array.isArray(s[key])!==Array.isArray(raw[key])||!raw[key]||typeof raw[key]!=='object')error('Invalid backup section: '+key);s[key]=copy(raw[key])}
 let catalog=new Set();for(let i of s.catalog){id(i.id);if(catalog.has(i.id))error('Duplicate ingredient.');catalog.add(i.id);text(i.name);unit(i.unit);if(!i.name.trim()||!i.unit.trim())error('Ingredient needs a name and unit.');positive(i.pack||1);for(let key of ['aisle','location'])text(i[key]||'');if(i.reference){positive(i.reference.grams);for(let key of ['item','size','source'])text(i.reference[key]);if(!/^https?:\/\//.test(i.reference.source))error('Invalid reference link.')}}
 const ref=k=>{if(!catalog.has(k))error('Unknown ingredient in backup.')};let ids=new Set();
 for(let r of [...s.recipes,...s.deletedRecipes]){id(r.id);if(ids.has(r.id))error('Duplicate recipe.');ids.add(r.id);validateRecipe(s,r)}
 for(let [key,value] of Object.entries(s.pantry)){ref(key);if(typeof value!=='number'||!Number.isFinite(value)||value<0)error('Invalid pantry amount.')}
 for(let [key,entries] of Object.entries(s.unmeasured)){ref(key);if(!Array.isArray(entries))error('Invalid package list.');for(let entry of entries){id(entry.id);positive(entry.quantity);unit(entry.unit)}}
 for(let key of Object.keys(s.estimated))ref(key);for(let [key,value] of Object.entries(s.notes)){ref(key);text(value)}
 for(let [date,plan] of Object.entries(s.plans)){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))error('Invalid dinner date.');if(plan.recipeId&&!ids.has(plan.recipeId))error('Unknown dinner recipe.');positive(plan.servings);text(plan.note||'');if(typeof plan.cooked!=='boolean')error('Invalid dinner status.')}
 let groceries=new Set();for(let g of [...s.groceries,...s.completed]){id(g.id);if(groceries.has(g.id))error('Duplicate grocery.');groceries.add(g.id);ref(g.ingredientId);positive(g.quantity);unit(g.unit);if(g.factor!==null&&g.factor!==undefined)positive(g.factor)}
 s.purchasedIds=[...new Set([...s.purchasedIds,...s.completed.map(g=>g.id)])];s.purchasedIds.forEach(id);if(s.groceries.some(g=>s.purchasedIds.includes(g.id)))error('Purchased grocery is also pending.');for(let h of s.history)for(let key of ['message','by','at'])text(h[key]||'');s.version=0;return s;
}
function validateRecipe(s,r){
 id(r.id);positive(r.servings);for(let key of ['name','cuisine','type','source','sourceUrl','equipment','notes','photo'])text(r[key]||'');if(!r.name.trim()||!Array.isArray(r.steps)||!r.steps.length||!Array.isArray(r.ingredients)||!r.ingredients.length)error('A recipe needs a name, ingredients and method.');r.steps.forEach(text);(r.tags||[]).forEach(text);
 if(r.sourceUrl&&!/^https?:\/\//.test(r.sourceUrl))error('Invalid recipe source link.');if(r.photo&&!/^data:image\/(jpeg|png|webp);base64,/.test(r.photo))error('Recipe cover must be a stored image.');
 for(let key of ['prep','active','cook','wait','total'])if(r[key]!==undefined&&(typeof r[key]!=='number'||!Number.isFinite(r[key])||r[key]<0))error('Invalid recipe time.');let rating=r.rating||0;if(!Number.isInteger(rating)||rating<0||rating>5)error('Choose a rating from 0 to 5 stars.');
 for(let ing of r.ingredients){let i=s.catalog.find(i=>i.id===ing.ingredientId);if(!i)error('Unknown recipe ingredient.');if(!ing.optional||ing.quantity!=null)positive(ing.quantity);if(ing.unit!==i.unit)error('Recipe ingredient units must match the pantry.');text(ing.prep||'');text(ing.raw||'')}
}
function apply(state,op,actor,initial,demos=[]){
 let s=copy(state),p=op.payload||{},kind=op.type;id(op.id);text(actor);text(op.at||'');
 const item=k=>{let i=s.catalog.find(i=>i.id===k);if(!i)error('Ingredient no longer exists.');return i};
 const conflict=m=>error(m,409);const history=m=>{s.history.unshift({message:m,by:actor,at:op.at||''});s.history=s.history.slice(0,300)};
 if(kind==='importBackup'){
  if(s.version!==0)conflict('Import into a new, untouched notebook. Existing records will not be replaced.');
  if(p.backup?.format!=='Kitchen Notebook backup v1')error('Choose a Kitchen Notebook backup JSON file.');s=validateState(p.backup.state,initial);
 }else{
 if(['saveRecipe','addGrocery','addIngredient'].includes(kind))for(let n of (kind==='addIngredient'?[p.item]:p.newItems||[])){id(n.id);positive(n.pack||1);text(n.name);unit(n.unit);if(!n.name.trim()||!n.unit.trim())error('Ingredient name and unit are required.');if(s.catalog.some(i=>i.id===n.id))continue;if(s.catalog.some(i=>i.name.trim().toLowerCase()===n.name.trim().toLowerCase()))conflict('This ingredient was added on another device. Reopen the form and select it.');s.catalog.push(copy(n))}
 switch(kind){
 case 'addIngredient':break;
 case 'saveRecipe':{let r=copy(p.recipe);validateRecipe(s,r);if(s.deletedRecipes.some(x=>x.id===r.id))conflict('This recipe was deleted. Restore it before editing.');let old=s.recipes.find(x=>x.id===r.id);if(old&&(old.revision||0)!==(p.expectedRevision||0))conflict('Recipe changed on another device. Reload before editing.');r.revision=(old?.revision||0)+1;r.rating=r.rating||0;r.favorite=!!r.favorite;s.recipes=s.recipes.filter(x=>x.id!==r.id);s.recipes.push(r);history('Saved recipe: '+r.name);break}
 case 'favoriteRecipe':{let r=s.recipes.find(x=>x.id===p.id);if(!r)conflict('Recipe no longer exists.');r.favorite=!!p.favorite;break}
 case 'deleteRecipe':{if(Object.values(s.plans).some(x=>x.recipeId===p.id&&!x.cooked))error('Remove the recipe from planned dinners first.');let r=s.recipes.find(x=>x.id===p.id);if(r){s.deletedRecipes.push(r);s.recipes=s.recipes.filter(x=>x.id!==p.id);history('Moved recipe to deleted recipes: '+r.name)}break}
 case 'restoreRecipe':{let r=s.deletedRecipes.find(x=>x.id===p.id);if(r){s.recipes.push(r);s.deletedRecipes=s.deletedRecipes.filter(x=>x.id!==p.id);history('Restored recipe: '+r.name)}break}
 case 'plan':{let old=s.plans[p.date];if(old?.cooked)error('This dinner is already cooked.');if(JSON.stringify(old||null)!==JSON.stringify(p.expected||null))conflict('Dinner changed on another device. Review the selection.');if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date))error('Invalid dinner date.');if(p.recipeId&&!s.recipes.some(r=>r.id===p.recipeId))error('Recipe no longer exists.');positive(p.servings);text(p.note||'');s.plans[p.date]={recipeId:p.recipeId,servings:p.servings,note:p.note||'',cooked:false};break}
 case 'addGrocery':{let g=p.grocery;id(g.id);item(g.ingredientId);positive(g.quantity);unit(g.unit);if(g.factor!=null)positive(g.factor);if(![...s.groceries,...s.completed].some(x=>x.id===g.id)&&!s.purchasedIds.includes(g.id))s.groceries.push({...copy(g),addedBy:actor});break}
 case 'editGrocery':{let g=s.groceries.find(x=>x.id===p.id);if(!g||g.quantity!==p.expected)conflict('Grocery changed or was already purchased.');g.quantity=positive(p.quantity);break}
 case 'removeGrocery':s.groceries=s.groceries.filter(g=>g.id!==p.id);break;
 case 'purchase':{if(s.purchasedIds.includes(p.id))break;let g=s.groceries.find(x=>x.id===p.id)||p.grocery;if(!g)break;if(g.id!==p.id)error('Purchase identifier does not match.');if(p.expected!==undefined&&g.quantity!==p.expected)conflict('Purchase quantity changed.');let i=item(g.ingredientId),q=positive(g.quantity),f=g.factor===undefined?1:g.factor;if(f===null)(s.unmeasured[i.id]??=[]).push({id:g.id,quantity:q,unit:g.unit});else{s.pantry[i.id]=(s.pantry[i.id]||0)+q*positive(f);if(g.estimated)s.estimated[i.id]=true}s.completed.push({...copy(g),name:i.name,boughtBy:actor,boughtAt:op.at||''});s.purchasedIds.push(p.id);s.groceries=s.groceries.filter(x=>x.id!==p.id);history('Bought '+q+' '+g.unit+' '+i.name);break}
 case 'clearPurchased':{let ids=new Set(p.ids);s.completed=s.completed.filter(g=>!ids.has(g.id));break}
 case 'setStock':{let i=item(p.ingredientId),q=p.quantity;if(!Number.isFinite(q)||q<0)error('Stock cannot be negative.');if(Math.abs((s.pantry[i.id]||0)-p.expected)>1e-7)conflict('Pantry changed on another device. Review the amount.');s.pantry[i.id]=q;s.estimated[i.id]=!!p.estimated;history('Adjusted '+i.name+' to '+q+' '+i.unit);break}
 case 'removeStock':{let i=item(p.ingredientId);if((s.pantry[i.id]||0)!==p.expected)conflict('Pantry changed. Review before removing.');s.pantry[i.id]=0;s.unmeasured[i.id]=[];history('Removed '+i.name+' from pantry');break}
 case 'resolvePackage':{let i=item(p.ingredientId),entry=(s.unmeasured[i.id]||[]).find(x=>x.id===p.id);if(entry){s.pantry[i.id]=(s.pantry[i.id]||0)+entry.quantity*positive(p.factor);s.unmeasured[i.id]=s.unmeasured[i.id].filter(x=>x.id!==p.id);s.estimated[i.id]=!!p.estimated;history('Confirmed package contents: '+i.name)}break}
 case 'note':item(p.ingredientId);s.notes[p.ingredientId]=text(p.note).slice(0,1000);break;
 case 'cook':{let plan=s.plans[p.date];if(!plan?.recipeId)error('Choose a recipe first.');if(plan.cooked)break;if(p.expectedPlan&&JSON.stringify(plan)!==JSON.stringify(p.expectedPlan))conflict('Dinner changed before it was marked cooked. Review the selection.');let r=s.recipes.find(x=>x.id===plan.recipeId);if(!r)error('Recipe not found.');if(p.expectedRecipeRevision!==undefined&&(r.revision||0)!==p.expectedRecipeRevision)conflict('Recipe changed before this dinner was cooked. Review the ingredients.');let needs={};for(let i of r.ingredients)if(!i.optional)needs[i.ingredientId]=(needs[i.ingredientId]||0)+i.quantity*plan.servings/r.servings;let missing=Object.keys(needs).filter(k=>(s.pantry[k]||0)+1e-7<needs[k]);if(missing.length)error('Update or buy these ingredients first: '+missing.map(k=>item(k).name).join(', '));for(let [k,q] of Object.entries(needs))s.pantry[k]=Math.max(0,(s.pantry[k]||0)-q);plan.cooked=true;history('Cooked '+r.name);break}
 case 'demo':if(s.version||s.recipes.length||Object.values(s.pantry).some(q=>q>0))error('Samples can only be added to an empty notebook.');s.recipes=copy(demos);s.pantry={rice:400,tomato:1,onion:1,oil:180,peas:1,spinach:100};history('Added demonstration recipes and pantry stock');break;
 default:error('Unknown household change.');
 }}
 s.version++;return s;
}
function replay(base,events,initial,demos){
 let state=validateState(base,initial),rejected=[],seen=new Set(),clock=0;
 events=[...events].sort((a,b)=>a.clock-b.clock||(String(a.operation?.id)<String(b.operation?.id)?-1:String(a.operation?.id)>String(b.operation?.id)?1:0));
 for(let event of events){try{if(event.format!=='Kitchen Notebook change v1'||!Number.isSafeInteger(event.clock)||event.clock<1)error('Invalid household change file.');let key=id(event.operation.id);clock=Math.max(clock,event.clock);if(seen.has(key))continue;seen.add(key);state=apply(state,event.operation,event.actor,initial,demos)}catch(e){rejected.push({op:event.operation||{id:'unknown',type:'unknown'},error:e.message})}}
 return {state,rejected,clock};
}
let api={apply,replay,validateState,validateRecipe};if(typeof module!=='undefined')module.exports=api;else root.KitchenDomain=api;
})(typeof window!=='undefined'?window:globalThis);
