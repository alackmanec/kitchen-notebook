'use strict';
const DriveRecipeReader={
 clean(html){let doc=new DOMParser().parseFromString(String(html),'text/html');doc.querySelectorAll('script,style').forEach(n=>n.remove());return (doc.body.textContent||'').trim()},
 findRecipe(value){if(Array.isArray(value)){for(let entry of value){let found=this.findRecipe(entry);if(found)return found}}else if(value&&typeof value==='object'){let types=Array.isArray(value['@type'])?value['@type']:[value['@type']];if(types.includes('Recipe'))return value;for(let key of ['@graph','mainEntity','itemListElement','item'])if(value[key]){let found=this.findRecipe(value[key]);if(found)return found}}return null},
 fromHTML(html,url){
  let doc=new DOMParser().parseFromString(html,'text/html'),recipe=null;
  for(let script of doc.querySelectorAll('script[type="application/ld+json"]'))try{recipe=this.findRecipe(JSON.parse(script.textContent));if(recipe)break}catch(ignore){}
  if(recipe){
   let steps=[];const add=value=>{if(typeof value==='string')steps.push(this.clean(value));else if(Array.isArray(value))value.forEach(add);else if(value&&typeof value==='object'){if(value.itemListElement)add(value.itemListElement);else if(value.text)add(value.text)}};add(recipe.recipeInstructions);
   if(!recipe.recipeIngredient?.length||!steps.length)throw Error('This page does not expose its full recipe. Import the recipe text, PDF or photos you can access.');
   let authors=Array.isArray(recipe.author)?recipe.author:[recipe.author],author=authors.filter(Boolean).map(a=>typeof a==='string'?a:a.name).filter(Boolean).join(', ');
   const duration=value=>{let m=String(value||'').match(/^P(?:(\d+)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/);return m?Number(m[1]||0)*1440+Number(m[2]||0)*60+Number(m[3]||0)+Number(m[4]||0)/60:0};
   let yieldText=String(Array.isArray(recipe.recipeYield)?recipe.recipeYield[0]:recipe.recipeYield||''),servings=Number(yieldText.match(/\d+(?:\.\d+)?/)?.[0])||2;
   let result=parseTextOffline([this.clean(recipe.name||'Imported recipe'),'Servings: '+servings,'Ingredients',...recipe.recipeIngredient.map(x=>this.clean(x)),'Method',...steps.map((s,i)=>(i+1)+'. '+s)].join('\n'));
   result.prep=duration(recipe.prepTime);result.cook=duration(recipe.cookTime);result.total=duration(recipe.totalTime)||result.prep+result.cook;result.cuisine=Array.isArray(recipe.recipeCuisine)?recipe.recipeCuisine.join(', '):recipe.recipeCuisine||'';result.type=Array.isArray(recipe.recipeCategory)?recipe.recipeCategory[0]:recipe.recipeCategory||'Dinner';result.source=author||new URL(url).hostname;result.sourceUrl=url;result.notes=this.clean(recipe.description||'');result.warnings=['Review imported quantities, units and method before saving.'];return result;
  }
  doc.querySelectorAll('script,style,nav,header,footer,form,noscript').forEach(n=>n.remove());let region=doc.querySelector('article')||doc.querySelector('main')||doc.body;
  let text=[...region.querySelectorAll('h1,h2,h3,p,li,tr')].map(n=>(n.textContent||'').trim()).filter(Boolean).join('\n'),result=parseTextOffline(text);if(!result.ingredients.length||!result.steps.length)throw Error('The full recipe could not be read from this page. Use accessible recipe text, a PDF or photos.');result.sourceUrl=url;result.source||=new URL(url).hostname;return result;
 },
 async read(url){
  let parsed;try{parsed=new URL(url)}catch(e){throw Error('Enter a valid recipe URL.')}if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('Use a public https recipe link.');
  let html;
  try{let response=await fetch(parsed.href,{credentials:'omit',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Page did not load.');html=await response.text();if(html.length>2_000_000)throw Error('Recipe page is too large.')}catch(e){
   let reader=DriveStore.config().recipeReaderUrl;if(!reader)throw Error('Web link reading needs the optional Google recipe reader. Add its address in Connection settings. Photos, PDFs and pasted text work now.');
   if(!/^https:\/\/script.google.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(reader))throw Error('Use the deployed Google recipe-reader /exec address.');
   html=await new Promise((resolve,reject)=>{let name='kitchenRecipe_'+crypto.randomUUID().replace(/-/g,''),script=document.createElement('script'),timer;const cleanup=()=>{clearTimeout(timer);script.remove();delete window[name]};window[name]=result=>{cleanup();result.error?reject(Error(result.error)):resolve(result.html)};script.src=reader+'?'+new URLSearchParams({url:parsed.href,callback:name});script.onerror=()=>{cleanup();reject(Error('Unable to reach the Google recipe reader. Check its deployment access and address.'))};timer=setTimeout(()=>{cleanup();reject(Error('The recipe reader did not respond. Try again or import the recipe text.'))},30000);document.head.append(script)});
  }
  return this.fromHTML(html,parsed.href);
 }
};
