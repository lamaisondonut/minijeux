/* Module de présentation fourni par GOAT Agence, adapté au moteur Noël.
 * Ce module ne valide ni score ni gain. Seule l'API serveur décide des modes.
 */
(() => {
 'use strict';
 if(window.BorealRewardMenu)return;
 const $=id=>document.getElementById(id),home=$('home'),panel=home?.querySelector('.panel');
 if(!panel)return;
 document.documentElement.classList.add('boreal-menu-enabled');
 const layout=()=>requestAnimationFrame(()=>window.dispatchEvent(new Event('boreal:menu-layout')));
 // Only the home presentation is rearranged. Existing buttons retain their handlers.
 panel.classList.add('boreal-home-shell');
 const brand=panel.querySelector('.brand'),title=panel.querySelector('h1'),edition=panel.querySelector('.noelEdition'),intro=panel.querySelector('p'),tips=panel.querySelector('.tips'),record=$('homebest').parentElement,start=$('start'),how=$('how');
 panel.querySelector('.orn')?.remove();
 const copy=document.createElement('div');copy.className='boreal-home-copy';
 const scene=document.createElement('div');scene.className='boreal-home-scene';scene.setAttribute('role','img');scene.setAttribute('aria-label','Jacques en tenue de Noël, sous les aurores boréales et le traîneau à six rennes.');
 const actions=document.createElement('div');actions.className='boreal-home-actions';
 const secondary=document.createElement('div');secondary.className='boreal-home-secondary';
 const recover=$('rewardRecover')||document.createElement('button');recover.type='button';recover.id='rewardRecover';recover.className='alt';recover.textContent='Retrouver mon code';
 how.textContent='Comment jouer';secondary.append(how,recover);actions.append(start,secondary);
 const rules=document.createElement('button');rules.type='button';rules.className='boreal-rules-button';rules.textContent='Règlement';rules.id='boreal-open-rules';
 const privacy=document.createElement('a');privacy.id='boreal-privacy-link';privacy.href='https://lesborealistes.ca/';privacy.target='_blank';privacy.rel='noopener noreferrer';privacy.textContent='Politique de confidentialité';
 const links=document.createElement('div');links.className='boreal-home-links';links.append(rules,privacy);actions.append(links);
 const summary=document.createElement('div');summary.className='boreal-home-status';summary.setAttribute('aria-live','polite');
 const modeLabel=document.createElement('strong');modeLabel.id='boreal-home-mode';
 const offer=title;offer.id='boreal-home-offer';summary.append(modeLabel);
 const prizes=document.createElement('div');prizes.className='boreal-home-prizes';prizes.setAttribute('aria-label','Paliers proposés pour cette partie');
 const eligibility=document.createElement('ul');eligibility.className='boreal-home-conditions';eligibility.id='boreal-home-conditions';
 for(const text of ['Code unique valide 30 jours.','Une récompense par personne tous les 30 jours.','Rabais applicable sur les aliments seulement.','Quantités limitées.']){const li=document.createElement('li');li.textContent=text;eligibility.append(li)}
 const notice=document.createElement('p');notice.className='boreal-menu-notice';notice.id='boreal-menu-notice';notice.setAttribute('role','status');
 edition.textContent='LE DÉFI BORÉAL · ÉDITION DE NOËL';intro.className='boreal-home-intro';intro.textContent='La forêt s’illumine. L’aventure t’attend.';
 tips.querySelectorAll('.tip').forEach((tip,index)=>{const icon=tip.querySelector('b');tip.replaceChildren(icon,document.createTextNode(['Double saut','Récolte les cadeaux','Évite les obstacles'][index]))});
 record.className='boreal-home-record';record.removeAttribute('style');
 actions.insertBefore(eligibility,secondary);copy.append(edition,title,intro,tips,summary,prizes,notice,actions,record);
 const credit=document.createElement('div');credit.className='boreal-credit';credit.textContent='Un jeu imaginé et développé par GOAT Agence';
 panel.replaceChildren(brand,copy,scene,credit);
 const box=document.createElement('section');box.className='boreal-reward-info';
 const heading=document.createElement('h3');heading.id='boreal-reward-heading';
 const description=document.createElement('div');description.id='boreal-reward-description';box.append(heading,description);
 const dialog=document.createElement('section');dialog.className='boreal-rules-dialog';dialog.id='boreal-rules';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','boreal-rules-title');
 dialog.innerHTML='<div class="boreal-rules-content"><h2 id="boreal-rules-title" tabindex="-1">Règlement et récompenses</h2><p>Applicable exclusivement aux aliments vendus au restaurant Les Boréalistes. Aucun rabais direct ou indirect sur les boissons alcooliques. Une facture mixte est admissible pour sa portion alimentaire seulement ; une facture contenant uniquement de l’alcool ne l’est pas. Le rabais est limité à la valeur des aliments admissibles. Toute portion inutilisée est perdue, sans échange contre de l’argent.</p><p>En mode récompenses, les paliers offerts sont annoncés avant le départ. Une seule récompense est attribuée : le plus haut palier atteint parmi ceux proposés, après vérification du score et de l’admissibilité.</p><p>Une seule récompense par numéro de téléphone tous les 30 jours. Après une partie admissible, le joueur saisit son nom complet et son téléphone pour obtenir son code. Aucun SMS n’est requis au lancement et le numéro n’est pas vérifié. Utiliser plusieurs numéros pour contourner cette règle est interdit. Aucun compte n’est requis pour jouer.</p><p>La partie peut durer au plus 15 minutes de jeu et reste admissible pendant 30 minutes, pauses comprises. La demande de gain doit être terminée dans les 10 minutes suivant la fin et avant cette limite de 30 minutes.</p><p>Le code de récompense confirmé doit être présenté en personne aux Boréalistes dans les 30 jours. Après validation du code, le personnel applique le rabais correspondant sur ta facture. Ce code est à usage unique.</p><p>Le mode libre et le Défi extrême permettent de jouer pour battre son record, sans récompense monétaire. Le Défi extrême est plus rapide, avec des obstacles plus rapprochés. Le mode est annoncé avant le départ et reste le même pendant la partie.</p><p><a href="reglement.html" target="_blank" rel="noopener">Lire le règlement complet</a></p><button type="button" id="boreal-close-rules" class="primary">FERMER</button></div>';
 dialog.querySelector('h2').after(box);$('app').append(dialog);rules.setAttribute('aria-controls',dialog.id);let previousFocus;
 const close=()=>{dialog.classList.remove('open');rules.setAttribute('aria-expanded','false');home.inert=false;previousFocus?.focus()};
 rules.setAttribute('aria-expanded','false');rules.onclick=()=>{previousFocus=document.activeElement;home.inert=true;dialog.classList.add('open');rules.setAttribute('aria-expanded','true');dialog.querySelector('.boreal-rules-content').scrollTop=0;dialog.querySelector('h2').focus()};dialog.querySelector('#boreal-close-rules').onclick=close;
 dialog.addEventListener('click',event=>{if(event.target===dialog)close()});dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close()}if(event.key==='Tab'){const nodes=[...dialog.querySelectorAll('a,button')];if(event.shiftKey&&(document.activeElement===nodes[0]||!nodes.includes(document.activeElement))){event.preventDefault();nodes.at(-1).focus()}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus()}}});
 let current=Object.freeze({mode:'pending',rewardsEnabled:false,capCents:0,policyVersion:'',tiers:[]}),busy=false;
 const tierDefinitions=[{score:5000,valueCents:500},{score:7500,valueCents:1000},{score:10000,valueCents:2000}];
 const paragraph=text=>{const p=document.createElement('p');p.textContent=text;description.append(p)};
 function renderStatus(raw){
  const cap=Number(raw?.capCents),enabled=raw?.mode==='rewards'&&raw?.rewardsEnabled===true&&[500,1000,2000].includes(cap)&&typeof raw?.turnstileSiteKey==='string'&&raw.turnstileSiteKey.trim().length>0;
  const mode=enabled?'rewards':raw?.mode==='extreme'&&raw?.rewardsEnabled===true&&cap===0?'extreme':'pending';
  current=Object.freeze({mode,rewardsEnabled:enabled,capCents:enabled?cap:0,policyVersion:typeof raw?.policyVersion==='string'?raw.policyVersion:'',turnstileSiteKey:typeof raw?.turnstileSiteKey==='string'?raw.turnstileSiteKey:'',phoneVerificationMode:raw?.phoneVerificationMode==='sms'?'sms':'unverified',notificationSmsEnabled:raw?.notificationSmsEnabled===true,tiers:tierDefinitions.map(t=>({...t,available:enabled&&t.valueCents<=cap}))});
  description.replaceChildren();home.dataset.gameMode=mode;
  paragraph('🎁 À toi de jouer !');paragraph('Accumule des points et cours la chance de remporter un rabais de 5 $, 10 $ ou 20 $ chez Les Boréalistes !');paragraph('Une seule récompense par personne tous les 30 jours. Tu peux toutefois jouer aussi souvent que tu le souhaites !');paragraph('Récompenses offertes jusqu’à épuisement du budget mensuel. Certaines conditions s’appliquent.');
  if(enabled){heading.textContent='Mode récompenses';paragraph('Applicable exclusivement aux aliments vendus au restaurant Les Boréalistes. Aucun rabais direct ou indirect sur les boissons alcooliques. Une facture mixte est admissible pour sa portion alimentaire seulement ; une facture contenant uniquement de l’alcool ne l’est pas. Le rabais est limité à la valeur des aliments admissibles. Toute portion inutilisée est perdue, sans échange contre de l’argent.');paragraph('Atteins un palier pour obtenir un code à présenter en personne aux Boréalistes. Le personnel appliquera le rabais sur ta facture après validation du code.');const tiers=document.createElement('div');tiers.className='boreal-reward-tiers';for(const t of current.tiers){const span=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=t.valueCents/100+' $';span.append(strong,document.createTextNode(t.score.toLocaleString('fr-CA')+' pts'));if(!t.available){span.className='unavailable';small.textContent='Non proposé pour cette partie';span.append(small)}tiers.append(span)}description.append(tiers);paragraph('Une seule récompense : le meilleur palier offert atteint. Maximum annoncé : '+cap/100+' $. Une récompense par numéro tous les 30 jours. Nom et téléphone demandés seulement après un gain admissible.');}
  else if(mode==='extreme'){heading.textContent='Défi extrême — sans récompense';paragraph('Aucune récompense monétaire dans ce mode. Le rythme est plus rapide et les obstacles plus rapprochés : bats ton record !');}
  else{heading.textContent='Mode libre — sans récompense';paragraph('Joue sans compte pour battre ton record. Aucune récompense monétaire n’est offerte pour cette partie.');}
  if(enabled){paragraph(current.phoneVerificationMode==='sms'?'Vérification SMS après un score admissible.':'Aucun SMS requis. Le téléphone fourni n’est pas vérifié. Ton code s’affiche directement après confirmation du gain.');paragraph('Partie admissible pendant 30 minutes, pauses comprises ; 15 minutes de jeu maximum. Termine ta demande dans les 10 minutes suivant la fin, avant la limite de 30 minutes. Présente ton code confirmé dans les 30 jours.');}
  modeLabel.textContent=enabled?'Mode récompenses · jusqu’à '+cap/100+' $ pour cette partie':heading.textContent;
  offer.replaceChildren(document.createTextNode(enabled?'Joue et remporte ':mode==='extreme'?'Relève le ':'La forêt '));
  const emphasis=document.createElement('em');emphasis.textContent=enabled?'ton rabais !':mode==='extreme'?'Défi extrême !':'t’attend !';offer.append(emphasis);
  prizes.replaceChildren();prizes.hidden=!enabled;
  if(enabled)for(const tier of current.tiers){const card=document.createElement('article'),value=document.createElement('strong'),points=document.createElement('span'),availability=document.createElement('small');card.className='boreal-home-prize'+(tier.available?'':' unavailable');value.textContent=tier.valueCents/100+' $';points.textContent=tier.score.toLocaleString('fr-CA')+' points';availability.textContent=tier.available?'Rabais alimentaire':'Non proposé';card.append(value,points,availability);prizes.append(card)}
  layout();window.dispatchEvent(new Event('boreal:rewards-status'));return current;
 }
 async function refresh(){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const response=await fetch('/api/rewards/status',{cache:'no-store',credentials:'same-origin',signal:controller.signal});if(!response.ok)throw new Error('Statut indisponible');return renderStatus(await response.json())}catch{return renderStatus(null)}finally{clearTimeout(timer)}}
 function setBusy(value){busy=!!value;if(start){start.disabled=busy||$('game')?.dataset.ready!=='true';start.setAttribute('aria-busy',String(busy));if(!busy)start.textContent='JOUER'}layout()}
 function notify(text){notice.textContent=String(text||'');layout()}
 if(start){const label=()=>{if(!busy&&start.textContent!=='JOUER')start.textContent='JOUER'};label();new MutationObserver(label).observe(start,{childList:true,characterData:true,subtree:true})}
 new MutationObserver(()=>{if(recover.textContent!=='Retrouver mon code')recover.textContent='Retrouver mon code'}).observe(recover,{childList:true,characterData:true,subtree:true});
 renderStatus(null);const ready=refresh();window.BorealRewardMenu=Object.freeze({ready,refresh,getStatus:()=>current,renderStatus,setBusy,notify});
})();
