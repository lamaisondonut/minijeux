/* Module de présentation fourni par GOAT Agence, adapté au moteur Noël.
 * Ce module ne valide ni score ni gain. Seule l'API serveur décide des modes.
 */
(() => {
 'use strict';
 if(window.BorealRewardMenu)return;
 const $=id=>document.getElementById(id),home=$('home'),panel=home?.querySelector('.panel');
 if(!panel)return;
 document.documentElement.classList.add('boreal-menu-enabled');
 const style=document.createElement('style');
 style.textContent=`
 :root{--boreal-dark:#2D351E;--boreal-olive:#666C37;--boreal-gold:#EFCD7A;--boreal-white:#FFFFFF}
 #home{align-items:flex-start;padding:16px 18px;background:linear-gradient(#17241a14,#18231b6e 65%,#17231ae8)}
 #home .panel{justify-content:flex-start;align-self:auto;min-height:100%;height:auto;max-width:430px;padding:0 12px 24px;gap:0}
 #home .brand{position:relative;top:auto;left:auto;right:auto;height:116px;display:flex;align-items:flex-start;justify-content:center;margin:0 0 72px;letter-spacing:0}
 .boreal-brand-logo{display:block;width:104px;height:104px;object-fit:contain;background:#fff;border:1px solid #efcd7a7a;border-radius:12px;box-shadow:0 5px 24px #14211444}
 #home h1{font-size:clamp(38px,10vw,48px);margin:0 0 12px;line-height:.94;width:max-content;max-width:100%;color:#fff}
 #home h1 em{color:var(--boreal-gold)}#home .noelEdition{color:var(--boreal-gold);border-color:#efcd7a99;margin:0 0 12px}
 #home .panel>p:first-of-type,#home .tips{display:none}
 #home button{min-height:44px;margin-top:7px;font-size:12px;border-radius:11px}
 #home button.primary{background:var(--boreal-gold);color:var(--boreal-dark);border-color:#fff0b9;box-shadow:0 4px 18px #0004}
 #home button.alt{background:#2d351edb;border-color:#efcd7a88;color:#fff}
 .boreal-reward-info{border:1px solid #efcd7a99;border-radius:13px;background:#2d351ee8;padding:12px;margin:0 0 4px;color:#fff;text-align:left}
 .boreal-reward-info h3{font-size:14px;margin:0 0 7px;color:var(--boreal-gold);letter-spacing:.025em}
 #home .boreal-reward-info p{font-size:12px;line-height:1.45;margin:5px 0;max-width:none;text-align:left}
 .boreal-reward-tiers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:9px 0}
 .boreal-reward-tiers span{padding:7px 3px;border:1px solid #efcd7a33;border-radius:9px;background:#666c3744;text-align:center;font-size:10px;line-height:1.4}
 .boreal-reward-tiers strong{display:block;color:var(--boreal-gold);font-size:18px}
 .boreal-reward-tiers .unavailable{opacity:.62;background:#ffffff0a}.boreal-reward-tiers small{display:block;font-size:9px}
 .boreal-menu-notice:empty{display:none}#home .boreal-menu-notice{font-size:12px;color:var(--boreal-gold);text-align:left;margin:6px 0}
 .boreal-credit{display:flex;align-items:center;justify-content:center;gap:7px;margin:12px 0 0;color:#fff;font-size:10px;line-height:1.5;flex-wrap:wrap}
 .boreal-credit img{display:block;width:72px;height:28px;object-fit:contain;background:#fff;padding:4px;border-radius:6px}
 #home .panel>p:last-of-type{font-size:10px;margin:10px 0 0;color:#fff}
 .boreal-rules-dialog{position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;background:#1a2419ef;padding:18px}
 .boreal-rules-dialog.open{display:flex}.boreal-rules-content{width:min(100%,480px);max-height:85vh;overflow:auto;background:#2D351E;color:#fff;border:1px solid #EFCD7A;border-radius:16px;padding:22px;text-align:left}
 .boreal-rules-content h2{font-size:25px;color:#EFCD7A}.boreal-rules-content p{max-width:none;font-size:14px}.boreal-rules-content a{color:#EFCD7A}
 @media(max-height:650px){#home .brand{height:90px;margin-bottom:28px}.boreal-brand-logo{width:80px;height:80px}#home h1{font-size:38px}#home .panel{padding-bottom:15px}#home .boreal-reward-info{padding:9px;margin-top:40px}#home .boreal-reward-info p{font-size:11px}.boreal-credit{margin-top:9px}}
 @media(max-height:500px) and (orientation:landscape){#home .panel{min-height:0}#home .brand{height:75px;margin-bottom:20px}.boreal-brand-logo{width:66px;height:66px}}
 `;
 document.head.appendChild(style);
 const layout=()=>requestAnimationFrame(()=>window.dispatchEvent(new Event('boreal:menu-layout')));
 const oldBox=panel.querySelector('.boreal-reward-info');if(oldBox)oldBox.remove();
 const box=document.createElement('section');box.className='boreal-reward-info';box.setAttribute('aria-live','polite');
 const heading=document.createElement('h3');heading.id='boreal-reward-heading';
 const description=document.createElement('div');description.id='boreal-reward-description';box.append(heading,description);
 const start=$('start');panel.insertBefore(box,start||null);home.querySelector('.noelEdition').textContent='ÉDITION DE NOËL';
 const rules=document.createElement('button');rules.type='button';rules.className='alt boreal-rules-button';rules.textContent='RÈGLEMENT ET CONDITIONS';rules.id='boreal-open-rules';panel.insertBefore(rules,start||null);
 const notice=document.createElement('p');notice.className='boreal-menu-notice';notice.id='boreal-menu-notice';notice.setAttribute('role','status');panel.insertBefore(notice,start||null);
 const credit=document.createElement('div');credit.className='boreal-credit';const signature=document.createElement('span');signature.textContent='Un jeu imaginé et développé par GOAT Agence';
 const goat=new Image();goat.src='assets/branding/goat-wordmark.png';goat.alt='GOAT Agence';credit.append(signature,goat);panel.append(credit);
 const logo=new Image();logo.src='assets/branding/borealistes-logo.png';logo.alt='Les Boréalistes — Buvette locale';logo.className='boreal-brand-logo';logo.onload=()=>{const brand=home.querySelector('.brand');if(brand){brand.textContent='';brand.append(logo)}layout()};
 const dialog=document.createElement('section');dialog.className='boreal-rules-dialog';dialog.id='boreal-rules';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Règlement et conditions');
 dialog.innerHTML='<div class="boreal-rules-content"><h2>Règlement du Défi Boréal</h2><p>En mode récompenses, les paliers et le plafond proposé sont annoncés avant le départ et réservés pour cette partie. Une seule récompense est attribuée : le plus haut palier atteint parmi ceux proposés.</p><p>Une seule récompense par personne tous les 30 jours, contrôlée au moyen d’un numéro vérifié. Utiliser plusieurs numéros pour contourner cette règle est interdit. Une vérification par SMS est demandée uniquement pour réclamer un gain. Aucun compte n’est requis pour jouer.</p><p>Le code GOAT confirmé doit être présenté aux Boréalistes dans les 30 jours. Ce délai concerne la réclamation du prix, et non la durée de validité de la carte-cadeau émise manuellement dans Lightspeed.</p><p>En mode Défi extrême ou lorsque les récompenses sont en préparation, aucune récompense monétaire n’est offerte.</p><p><a href="reglement.html" target="_blank" rel="noopener">Lire le règlement complet et la confidentialité</a></p><button type="button" id="boreal-close-rules" class="primary">FERMER</button></div>';
 $('app').append(dialog);rules.setAttribute('aria-controls',dialog.id);let previousFocus;
 const close=()=>{dialog.classList.remove('open');previousFocus?.focus()};
 rules.onclick=()=>{previousFocus=document.activeElement;dialog.classList.add('open');dialog.querySelector('a,button').focus()};dialog.querySelector('#boreal-close-rules').onclick=close;
 dialog.addEventListener('click',event=>{if(event.target===dialog)close()});dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close()}if(event.key==='Tab'){const nodes=[...dialog.querySelectorAll('a,button')];if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus()}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus()}}});
 let current=Object.freeze({mode:'pending',rewardsEnabled:false,capCents:0,policyVersion:'',tiers:[]}),busy=false;
 const tierDefinitions=[{score:5000,valueCents:500},{score:7500,valueCents:1000},{score:10000,valueCents:2000}];
 const paragraph=text=>{const p=document.createElement('p');p.textContent=text;description.append(p)};
 function renderStatus(raw){
  const cap=Number(raw?.capCents),enabled=raw?.mode==='rewards'&&raw?.rewardsEnabled===true&&[500,1000,2000].includes(cap);
  const mode=enabled?'rewards':raw?.mode==='extreme'?'extreme':'pending';
  current=Object.freeze({mode,rewardsEnabled:enabled,capCents:enabled?cap:0,policyVersion:typeof raw?.policyVersion==='string'?raw.policyVersion:'',turnstileSiteKey:typeof raw?.turnstileSiteKey==='string'?raw.turnstileSiteKey:'',tiers:tierDefinitions.map(t=>({...t,available:enabled&&t.valueCents<=cap}))});
  description.replaceChildren();home.dataset.gameMode=mode;
  if(enabled){heading.textContent='Mode récompenses';paragraph('Une carte-cadeau pouvant atteindre '+cap/100+' $ est proposée pour cette partie, après validation du score et de votre admissibilité.');const tiers=document.createElement('div');tiers.className='boreal-reward-tiers';for(const t of current.tiers){const span=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=t.valueCents/100+' $';span.append(strong,document.createTextNode(t.score.toLocaleString('fr-CA')+' pts'));if(!t.available){span.className='unavailable';small.textContent='Non proposé pour cette partie';span.append(small)}tiers.append(span)}description.append(tiers);paragraph('Le plafond sera fixé au départ. Un seul prix par personne tous les 30 jours, vérification SMS après la partie.');}
  else if(mode==='extreme'){heading.textContent='Défi extrême — sans carte-cadeau';paragraph('Aucune récompense monétaire dans ce mode. Le rythme est plus rapide et les obstacles plus rapprochés : bats ton record !');}
  else{heading.textContent='Récompenses en préparation';paragraph('Aucune carte-cadeau n’est attribuée actuellement. Joue librement pour battre ton record.');}
  if(enabled)paragraph('Réservation valable 30 minutes, pauses comprises ; 15 minutes de jeu effectif maximum. Confirme ton gain par SMS dans les 10 minutes suivant la fin, avant l’expiration de la réservation.');
  layout();return current;
 }
 async function refresh(){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const response=await fetch('/api/rewards/status',{cache:'no-store',credentials:'same-origin',signal:controller.signal});if(!response.ok)throw new Error('Statut indisponible');return renderStatus(await response.json())}catch{return renderStatus(null)}finally{clearTimeout(timer)}}
 function setBusy(value){busy=!!value;if(start){start.disabled=busy||$('game')?.dataset.ready!=='true';start.setAttribute('aria-busy',String(busy));if(!busy)start.textContent='COMMENCER À JOUER'}layout()}
 function notify(text){notice.textContent=String(text||'');layout()}
 if(start){start.textContent='COMMENCER À JOUER';new MutationObserver(()=>{if(!busy&&start.textContent==='JOUER →')start.textContent='COMMENCER À JOUER'}).observe(start,{childList:true,characterData:true,subtree:true})}
 renderStatus(null);const ready=refresh();window.BorealRewardMenu=Object.freeze({ready,refresh,getStatus:()=>current,renderStatus,setBusy,notify});
})();
