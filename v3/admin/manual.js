/* Manager actions remain authenticated and authorized by the server. */
(() => {
  'use strict';
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const money=value=>new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD'}).format(value/100);
  async function api(path,body) {
    const response=await fetch('/api/admin/'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(response.status===401||response.status===403)document.dispatchEvent(new CustomEvent('boreal:admin-expired',{detail:{status:response.status}}));
    const data=await response.json();if(!response.ok){const e=Error(data.message||'Opération indisponible');e.status=response.status;throw e;}return data;
  }
  let currentSection=null,generation=0;
  document.addEventListener('boreal:admin-session',event=>{
    const epoch=++generation;currentSection?.remove();currentSection=null;
    const {employee}=event.detail||{},notificationSmsEnabled=employee?.notificationSmsEnabled;

    if(employee?.role!=='manager')return;
    const section=node('section');section.className='surface manual-panel';section.style.padding='24px';section.style.marginBottom='24px';
    section.append(node('h2','Créer un bon manuellement'),node('p','Réservé au gestionnaire. Le bon est à usage unique, valable 30 jours et applicable aux aliments seulement. Le téléphone déclaré sert au contrôle des 30 jours et n’est pas vérifié par SMS.'));
    const form=node('form');form.className='manual-form';
    const inputs={};
    for(const [id,label,type] of [['firstName','Prénom','text'],['lastName','Nom','text'],['phone','Téléphone du bénéficiaire','tel'],['reason','Justification de l’émission manuelle','text']]) {
      const l=node('label',label);l.className='field';const input=node('input');input.type=type;input.name=id;input.required=true;input.maxLength=id==='reason'?500:80;if(id==='reason')input.minLength=8;l.append(input);form.append(l);inputs[id]=input;
    }
    const valueLabel=node('label','Valeur du bon');valueLabel.className='field';const value=node('select');value.name='valueCents';for(const cents of [500,1000,2000]){const option=node('option',money(cents));option.value=cents;value.append(option);}valueLabel.append(value);form.append(valueLabel);
    const quoteButton=node('button','Vérifier le budget et les exceptions');quoteButton.type='submit';quoteButton.className='button secondary';form.append(quoteButton);section.append(form);
    const review=node('div'),message=node('p');message.setAttribute('role','status');section.append(review,message);
    currentSection=section;section.id='manual-reward-panel';document.querySelector('.budget-panel').after(section);
    let quoted=null,operation=null,busy=false;
    const clear=()=>{if(operation)return;quoted=null;review.replaceChildren();};form.addEventListener('input',clear);
    function lock(locked){for(const input of form.elements)input.disabled=locked;}
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||operation)return;busy=true;lock(true);message.textContent='Vérification…';
      try {
        quoted=await api('manual-rewards/quote',{phone:inputs.phone.value,valueCents:Number(value.value)});if(epoch!==generation)return;review.replaceChildren();
        for(const text of ['Plafond mensuel normal : '+money(quoted.budgetCents),'Déjà attribué : '+money(quoted.usedCents),'Réservé pour les parties : '+money(quoted.reservedCents),'Nouveau bon : '+money(quoted.valueCents),'Dépassement total après émission : '+money(quoted.projectedOverrunCents),'Part exceptionnelle de ce nouveau bon : '+money(quoted.additionalExceptionalCents)])review.append(node('p',text));
        review.append(node('p','Cette opération ne change pas le plafond mensuel configuré. Les dépenses exceptionnelles restent comptabilisées dans le mois.'));
        const confirmations={};
        for(const [required,key,text] of [[quoted.projectedOverrunCents>0,'budget','J’autorise explicitement ce dépassement du budget mensuel.'],[quoted.cooldownRequired,'cooldown','J’autorise explicitement une nouvelle récompense avant la fin du délai de 30 jours.']]) {
          if(!required)continue;const label=node('label'),check=node('input');check.type='checkbox';label.append(check,document.createTextNode(text));const why=node('textarea');why.minLength=8;why.maxLength=500;why.placeholder='Justification obligatoire (8 caractères minimum)';why.setAttribute('aria-label','Justification '+key);review.append(label,why);confirmations[key]={check,why};
        }
        const confirm=node('button','Confirmer et générer le code unique');confirm.type='button';confirm.className='button primary';confirm.disabled=!quoted.manualRewardsEnabled;review.append(confirm);
        if(!quoted.manualRewardsEnabled)message.textContent='Émissions manuelles désactivées avant configuration et validation réglementaire.';else message.textContent='Vérifiez les montants et les exceptions avant de confirmer.';
        confirm.addEventListener('click',async()=>{
          if(busy)return;
          if(!operation){
            for(const item of Object.values(confirmations))if(!item.check.checked||item.why.value.trim().length<8){message.textContent='Chaque exception exige sa confirmation et une justification d’au moins 8 caractères.';return;}
            operation={requestId:crypto.randomUUID().replaceAll('-',''),firstName:inputs.firstName.value,lastName:inputs.lastName.value,phone:inputs.phone.value,valueCents:Number(value.value),reason:inputs.reason.value,quote:quoted.quote,authorizeBudgetOverrun:Boolean(confirmations.budget),budgetReason:confirmations.budget?.why.value||'',authorizeCooldown:Boolean(confirmations.cooldown),cooldownReason:confirmations.cooldown?.why.value||''};
          }
          busy=true;lock(true);confirm.disabled=true;for(const c of review.querySelectorAll('input,textarea'))c.disabled=true;
          try {
            const data=await api('manual-rewards',operation);if(epoch!==generation)return;const reward=data.reward;review.replaceChildren(node('h3','Bon créé : '+money(reward.valueCents)),node('p','Code : '+reward.code),node('p','Valable jusqu’au '+new Date(reward.claimBy).toLocaleString('fr-CA')),node('p','Applicable exclusivement aux aliments. Aucun rabais sur les boissons alcooliques. Portion inutilisée perdue, sans échange contre de l’argent.'));
            message.textContent=notificationSmsEnabled===true?(data.notification?.status==='accepted'?'SMS pris en charge par le fournisseur.':'Code enregistré. Vérifiez les messages avant tout renvoi.'): 'Code enregistré. Le client peut le conserver par capture d’écran.';
            operation=null;quoted=null;form.reset();document.dispatchEvent(new Event('boreal:admin-changed'));
          } catch(error) {
            if(epoch!==generation)return;
            message.textContent=error.message;
            if(error.status===409){operation=null;quoted=null;review.replaceChildren();message.textContent+=' Recalculez puis confirmez la nouvelle proposition.';}
            else {confirm.textContent='Réessayer la même émission';message.textContent+=' Réessayez la même émission : la clé conservée empêche un second code.';confirm.disabled=false;}
          } finally {busy=false;if(!operation)lock(false);}
        });
      } catch(error){if(epoch!==generation)return;message.textContent=error.message;}finally{busy=false;if(!operation)lock(false);}
    });
  });
  document.dispatchEvent(new Event('boreal:admin-session-request'));
})();
