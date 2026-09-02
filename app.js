(function(){
  "use strict";
  var M=window.RhythmModel;
  if(!M) throw new Error('RhythmModel is required');
  var CHK='<svg viewBox="0 0 24 24"><path d="M4 12l6 6L20 5"/></svg>';
  var SKIP='<span class="skipmark">×</span>';
  var DAYS=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  var PALETTE=['#5E9E3E','#C08A2A','#3E7CB1','#7E5AA8','#2E9A82','#C4703A','#4A6785','#B5484B','#4F8FA6','#8A6D3B'];

  function pad(n){return (n<10?'0':'')+n;}
  var key=M.key, parseKey=M.parseKey, wdIdx=M.wdIdx, addDays=M.addDays;
  function mondayOf(d){var x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-wdIdx(x));return x;}
  function sameDay(a,b){return key(a)===key(b);}
  function escapeHtml(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function uid(prefix){ return prefix+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

  // ---- durable storage with explicit error reporting ----
  var STORE='habit_tracker_v1';
  var state={version:2,habits:[],days:{},notes:{},journal:{},subState:{}};
  var memStore={};
  var hasWinStorage=(typeof window!=='undefined' && window.storage && typeof window.storage.get==='function');
  var hasLS=(function(){ try{ var k='__rhythm_t'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; }catch(e){ return false; } })();
  async function rawGet(k){
    if(hasWinStorage){ try{ var r=await window.storage.get(k); if(r&&r.value!=null) return r.value; }catch(e){} }
    if(hasLS){ try{ return localStorage.getItem(k); }catch(e){} }
    return (k in memStore)?memStore[k]:null;
  }
  async function rawSet(k,v){
    if(hasWinStorage){ try{ await window.storage.set(k,v); return; }catch(e){} }
    if(hasLS){ try{ localStorage.setItem(k,v); return; }catch(e){} }
    memStore[k]=v;
    throw new Error('Постоянное хранилище недоступно');
  }
  async function load(){
    try{
      var v=await rawGet(STORE);
      state=M.normalizeState(v?JSON.parse(v):state,todayKey);
    }catch(e){ showToast('Не удалось прочитать сохранённые данные. Создана пустая сессия.'); }
  }
  var saving=false,pending=false;
  async function save(){
    if(saving){ pending=true; return; }
    saving=true;
    try{ await rawSet(STORE, JSON.stringify(state)); }
    catch(e){ showToast('Не удалось сохранить данные. Экспортируйте резервную копию.'); }
    saving=false;
    if(pending){ pending=false; save(); }
  }
  var tTimer; function saveSoon(){ clearTimeout(tTimer); tTimer=setTimeout(save,400); }

  function showToast(message){
    var toast=document.getElementById('toast');
    if(!toast) return;
    toast.textContent=message; toast.hidden=false;
    clearTimeout(showToast.timer); showToast.timer=setTimeout(function(){ toast.hidden=true; },4500);
  }
  function stateOf(dk,id){ return M.stateOf(state,dk,id); }
  function setDayState(dk,id,val){
    if(dk>todayKey){ showToast('Будущие даты нельзя отмечать заранее.'); return; }
    var d=state.days[dk]; if(!d){ d={}; state.days[dk]=d; }
    if(val==='done') d[id]=true; else if(val==='skip') d[id]='skip'; else delete d[id];
    if(Object.keys(d).length===0) delete state.days[dk];
    save();
  }
  function cycleDayState(dk,id){
    var cur=stateOf(dk,id);
    setDayState(dk,id, cur==='none'?'done':(cur==='done'?'skip':'none'));
  }
  function findHabit(id){ for(var i=0;i<state.habits.length;i++) if(state.habits[i].id===id) return state.habits[i]; return null; }

  var todayD=new Date(), todayKey=key(todayD), todayWd=wdIdx(todayD), todayTicks={};

  function afterStateChange(dk,id){
    if(dk===todayKey && todayTicks[id]) todayTicks[id].refresh();
    updateTodayProgress(); renderWeek(); renderProgress();
  }
  function applyGridTickVisual(el,st){
    el.setAttribute('data-state',st);
    el.setAttribute('aria-checked', st==='done'?'true':(st==='skip'?'mixed':'false'));
  }

  function scheduledOn(h,d){ return M.scheduledOn(h,d); }
  function dayStats(d){ return M.dayStats(state,d); }

  function buildToday(){
    document.getElementById('todayDate').textContent =
      todayD.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
    var hasHabits=state.habits.length>0;
    document.getElementById('emptyState').hidden=hasHabits;
    var items=hasHabits?state.habits.slice():[];
    items.sort(function(a,b){ return Number(scheduledOn(b,todayD))-Number(scheduledOn(a,todayD)); });
    var scheduledCount=items.filter(function(h){return scheduledOn(h,todayD);}).length;
    document.getElementById('todayProgressBlock').hidden=scheduledCount===0;
    var ul=document.getElementById('todayList');
    ul.innerHTML=''; todayTicks={};
    ul.hidden = !hasHabits;
    document.getElementById('noneToday').hidden = !(hasHabits && scheduledCount===0);

    items.forEach(function(h){
      var isScheduled=scheduledOn(h,todayD);
      var li=document.createElement('li'); li.className='item'+(isScheduled?'':' unscheduled');

      var group=document.createElement('div'); group.className='tickgroup';
      var doneBtn,skipBtn;
      if(isScheduled){
        doneBtn=document.createElement('button'); doneBtn.type='button'; doneBtn.className='tickbtn done';
        doneBtn.innerHTML='<span class="box">'+CHK+'</span><span class="cap">сделано</span>';
        doneBtn.setAttribute('aria-pressed','false');
        doneBtn.setAttribute('aria-label','«'+h.name+'»: отметить как сделано');
        doneBtn.querySelector('.box').style.setProperty('--dot',h.color);
        skipBtn=document.createElement('button'); skipBtn.type='button'; skipBtn.className='tickbtn skip';
        skipBtn.innerHTML='<span class="box">'+SKIP+'</span><span class="cap">пропуск</span>';
        skipBtn.setAttribute('aria-pressed','false');
        skipBtn.setAttribute('aria-label','«'+h.name+'»: отметить как осознанный пропуск');
      }else{
        var offday=document.createElement('span'); offday.className='offday-badge'; offday.textContent='не сегодня';
        group.appendChild(offday);
      }

      function refresh(){
        if(!isScheduled)return;
        var st=stateOf(todayKey,h.id);
        doneBtn.classList.toggle('active', st==='done');
        doneBtn.setAttribute('aria-pressed', st==='done'?'true':'false');
        skipBtn.classList.toggle('active', st==='skip');
        skipBtn.setAttribute('aria-pressed', st==='skip'?'true':'false');
        li.classList.toggle('done', st==='done');
        li.classList.toggle('skipped', st==='skip');
      }
      if(isScheduled){
        doneBtn.addEventListener('click',function(){
          setDayState(todayKey,h.id, stateOf(todayKey,h.id)==='done'?'none':'done');
          refresh(); updateTodayProgress(); renderWeek(); renderProgress();
        });
        skipBtn.addEventListener('click',function(){
          setDayState(todayKey,h.id, stateOf(todayKey,h.id)==='skip'?'none':'skip');
          refresh(); updateTodayProgress(); renderWeek(); renderProgress();
        });
        todayTicks[h.id]={refresh:refresh};
        group.appendChild(doneBtn); group.appendChild(skipBtn);
      }

      var body=document.createElement('div'); body.className='it-body';
      var title=document.createElement('button'); title.type='button'; title.className='it-title'; title.setAttribute('aria-expanded','false');
      title.innerHTML='<span class="t">'+escapeHtml(h.name)+'</span> <span class="chev"></span>';
      body.appendChild(title);
      if(h.subtitle){ var desc=document.createElement('div'); desc.className='it-desc'; desc.textContent=h.subtitle; body.appendChild(desc); }

      var edit=document.createElement('button'); edit.type='button'; edit.className='rowedit'; edit.innerHTML='✎';
      edit.setAttribute('aria-label','Изменить привычку «'+h.name+'»');
      edit.addEventListener('click',function(e){ e.stopPropagation(); openHabitSheet(h); });

      li.appendChild(group); li.appendChild(body); li.appendChild(edit);

      var det=makeExpandDetail(h,todayKey); li.appendChild(det);
      title.addEventListener('click',function(){
        var open=det.classList.toggle('open'); title.setAttribute('aria-expanded',open?'true':'false');
      });

      refresh();
      ul.appendChild(li);
    });
    updateTodayProgress();
  }
  function updateTodayProgress(){
    var s=dayStats(todayD);
    document.getElementById('todayDone').textContent=s.done;
    document.getElementById('todayTotal').textContent=s.required;
    document.getElementById('todayBar').style.width=(s.required>0?Math.round(s.done/s.required*100):(s.closed?100:0))+'%';
    document.getElementById('allDone').classList.toggle('show', s.closed);
  }
  function makeExpandDetail(h,dk){
    var det=document.createElement('div'); det.className='detail';
    if(h.subitems && h.subitems.length){
      var subLab=document.createElement('div'); subLab.className='dlabel'; subLab.textContent='Подразделы';
      det.appendChild(subLab);
      var ul=document.createElement('ul'); ul.className='sublist';
      h.subitems.forEach(function(s){
        var li=document.createElement('li'); li.className='subitem';
        var cb=document.createElement('button'); cb.type='button'; cb.className='subcheck'; cb.setAttribute('role','checkbox');
        var checked=!!(state.subState[dk] && state.subState[dk][h.id] && state.subState[dk][h.id][s.id]);
        cb.setAttribute('aria-checked', checked?'true':'false');
        cb.classList.toggle('on',checked);
        cb.innerHTML=CHK;
        cb.style.setProperty('--dot',h.color);
        cb.setAttribute('aria-label',s.text);
        cb.addEventListener('click',function(){
          if(!state.subState[dk]) state.subState[dk]={};
          if(!state.subState[dk][h.id]) state.subState[dk][h.id]={};
          var cur=!!state.subState[dk][h.id][s.id];
          if(cur){ delete state.subState[dk][h.id][s.id]; } else { state.subState[dk][h.id][s.id]=true; }
          if(Object.keys(state.subState[dk][h.id]).length===0) delete state.subState[dk][h.id];
          if(Object.keys(state.subState[dk]).length===0) delete state.subState[dk];
          cb.classList.toggle('on', !cur); cb.setAttribute('aria-checked', !cur?'true':'false');
          saveSoon();
        });
        var txt=document.createElement('span'); txt.className='subtext'; txt.textContent=s.text;
        li.appendChild(cb); li.appendChild(txt); ul.appendChild(li);
      });
      det.appendChild(ul);
    }
    var lab=document.createElement('div'); lab.className='dlabel'; lab.textContent='Заметка на сегодня (необязательно)';
    var ta=document.createElement('textarea'); ta.className='tinput'; ta.rows=3; ta.placeholder='Коротко: как прошло, что заметил…';
    ta.value=(state.notes[dk] && state.notes[dk][h.id])||'';
    ta.addEventListener('input',function(){
      if(ta.value){ if(!state.notes[dk]) state.notes[dk]={}; state.notes[dk][h.id]=ta.value; }
      else if(state.notes[dk]){ delete state.notes[dk][h.id]; if(!Object.keys(state.notes[dk]).length)delete state.notes[dk]; }
      saveSoon();
    });
    det.appendChild(lab); det.appendChild(ta);
    return det;
  }

  function bindReflect(){
    var ta=document.getElementById('dayReflect');
    ta.value=state.journal[todayKey]||'';
    ta.addEventListener('input',function(){ if(ta.value)state.journal[todayKey]=ta.value; else delete state.journal[todayKey]; saveSoon(); });
  }

  var viewMonday=mondayOf(todayD);
  function weekRangeLabel(monday){
    var end=addDays(monday,6);
    var mo=function(d){return d.toLocaleDateString('ru-RU',{month:'short'}).replace('.','');};
    return monday.getDate()+' '+mo(monday)+' — '+end.getDate()+' '+mo(end);
  }
  function renderWeek(){
    document.getElementById('weekLbl').textContent=weekRangeLabel(viewMonday);
    var g=document.getElementById('weekGrid');
    if(state.habits.length===0){
      g.hidden=true; g.innerHTML='';
      document.getElementById('weekEmpty').hidden=false;
      document.getElementById('weekBarWrap').hidden=true;
      return;
    }
    g.hidden=false;
    document.getElementById('weekEmpty').hidden=true;
    document.getElementById('weekBarWrap').hidden=false;
    g.innerHTML='';
    var dates=[]; for(var i=0;i<7;i++) dates.push(addDays(viewMonday,i));
    var caption=document.createElement('caption'); caption.className='sr-only'; caption.textContent='Отметки привычек за '+weekRangeLabel(viewMonday); g.appendChild(caption);
    var thead=document.createElement('thead'), hr=document.createElement('tr');
    var corner=document.createElement('th'); corner.className='hlabel'; hr.appendChild(corner);
    dates.forEach(function(d){
      var th=document.createElement('th'); if(sameDay(d,todayD)) th.className='col-today';
      th.innerHTML=DAYS[wdIdx(d)]+'<span class="dn">'+d.getDate()+'</span>'; hr.appendChild(th);
    });
    thead.appendChild(hr); g.appendChild(thead);
    var tb=document.createElement('tbody');
    state.habits.forEach(function(h){
      var tr=document.createElement('tr');
      var lab=document.createElement('th'); lab.className='hlabel'; lab.scope='row';
      var hc=document.createElement('div'); hc.className='hcell';
      var dot=document.createElement('span'); dot.className='hdot'; dot.style.background=h.color;
      var nm=document.createElement('span'); nm.className='hname'; nm.textContent=h.name;
      hc.appendChild(dot); hc.appendChild(nm); lab.appendChild(hc); tr.appendChild(lab);
      dates.forEach(function(d){
        var td=document.createElement('td'); if(sameDay(d,todayD)) td.className='gtd';
        var dk=key(d);
        if(d>todayD){ var future=document.createElement('span'); future.className='gtick na future'; future.setAttribute('aria-label','Будущая дата'); td.appendChild(future); }
        else if(!scheduledOn(h,d)){ var na=document.createElement('span'); na.className='gtick na'; na.setAttribute('aria-label','Не запланировано'); td.appendChild(na); }
        else{
          var st=stateOf(dk,h.id);
          var b=document.createElement('button'); b.type='button'; b.className='gtick'; b.setAttribute('role','checkbox');
          b.setAttribute('aria-label',h.name+' · '+d.toLocaleDateString('ru-RU'));
          b.style.setProperty('--dot',h.color); b.innerHTML=CHK+SKIP; applyGridTickVisual(b,st);
          (function(dk,id){ b.addEventListener('click',function(){ cycleDayState(dk,id); afterStateChange(dk,id); }); })(dk,h.id);
          td.appendChild(b);
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    g.appendChild(tb);
    var totals=M.weekStats(state,viewMonday,todayD);
    document.getElementById('weekBar').style.width=(totals.required>0?Math.round(totals.done/totals.required*100):0)+'%';
    document.getElementById('weekNum').textContent=(totals.required>0?Math.round(totals.done/totals.required*100)+'%':'—');
  }
  function closedStreak(){ return M.closedStreak(state,todayD); }
  function habitStreak(id){ return M.habitStreak(state,id,todayD); }

  function renderProgress(){
    var hasHabits=state.habits.length>0;
    document.getElementById('progressEmpty').hidden=hasHabits;
    document.getElementById('progressContent').hidden=!hasHabits;
    if(!hasHabits) return;

    var totals=M.rangeStats(state,todayD), recorded=Object.keys(state.days).filter(function(dk){return dk<=todayKey;});
    document.getElementById('stOverall').textContent=(totals.required>0?Math.round(totals.done/totals.required*100)+'%':'—');
    document.getElementById('stClosed').textContent=totals.closed;
    document.getElementById('stStreak').textContent=closedStreak();
    document.getElementById('stBest').textContent=M.bestClosedStreak(state,todayD);

    var box=document.getElementById('habitBreak'); box.innerHTML='';
    state.habits.forEach(function(h){
      var done=0, skip=0, planned=0;
      for(var hd=parseKey(h.createdAt);hd<=todayD;hd=addDays(hd,1)){
        if(!scheduledOn(h,hd)) continue;
        planned++; var v=stateOf(key(hd),h.id); if(v==='done')done++; else if(v==='skip')skip++;
      }
      var row=document.createElement('div'); row.className='hrow';
      var dot=document.createElement('span'); dot.className='hdot'; dot.style.background=h.color;
      var nm=document.createElement('span'); nm.className='nm'; nm.textContent=h.name;
      var val=document.createElement('span'); val.className='val';
      val.innerHTML='<b>'+done+'</b> из '+planned+(skip?' · '+skip+' проп.':'')+' · серия <b>'+habitStreak(h.id)+'</b>';
      row.appendChild(dot); row.appendChild(nm); row.appendChild(val); box.appendChild(row);
    });
  }

  function buildReport(){
    var L=[];
    L.push('Ты — трезвый, честный коуч по привычкам и продуктивности. Ниже — данные из моего трекера привычек «Rhythm».');
    L.push('Задача: дай короткий честный разбор — что реально работает, что проседает, на что обратить внимание в первую очередь. Без воды ради воды. Осознанный пропуск — это не провал, это учтённый отдых.');
    L.push('');
    if(!state.habits.length){ L.push('Пока не добавлено ни одной привычки.'); return L.join('\n'); }

    L.push('== ПРИВЫЧКИ (текущий список) ==');
    state.habits.forEach(function(h){
      var days=h.days.map(function(v,i){return v?DAYS[i]:null;}).filter(Boolean).join(', ')||'нет дней';
      var subs=(h.subitems&&h.subitems.length)?(' · подразделы: '+h.subitems.map(function(s){return s.text;}).join(', ')):'';
      L.push('- '+h.name+(h.subtitle?' — '+h.subtitle:'')+' · дни: '+days+subs);
    });
    L.push('');
    L.push('== ИТОГО ==');
    var recorded=Object.keys(state.days).filter(function(dk){return dk<=todayKey;}).sort();
    var firstCreated=state.habits.map(function(h){return h.createdAt;}).sort()[0];
    var totals=M.rangeStats(state,todayD);
    if(!recorded.length) L.push('Пока нет ни одной отметки. Неотмеченные запланированные дни учитываются как невыполненные.');
    if(firstCreated){
      L.push('Период: '+firstCreated+' … '+key(todayD)+' (дней с отметками: '+recorded.length+')');
      L.push('Общее выполнение: '+(totals.required>0?Math.round(totals.done/totals.required*100):0)+'%  ·  дней закрыто полностью: '+totals.closed);
      L.push('Серия закрытых дней подряд: текущая '+closedStreak());
      L.push('');
      L.push('== ПО ПРИВЫЧКАМ (выполнено / пропущено / серия) ==');
      state.habits.forEach(function(h){
        var done=0,skip=0; recorded.forEach(function(dk){ var v=stateOf(dk,h.id); if(v==='done')done++; else if(v==='skip')skip++; });
        L.push('- '+h.name+': '+done+' / '+skip+' / '+habitStreak(h.id));
      });
      L.push('');
      L.push('== ПО НЕДЕЛЯМ (выполнение) ==');
      var m0=mondayOf(parseKey(firstCreated)), mNow=mondayOf(todayD), weeks=[];
      for(var wm=new Date(m0); wm<=mNow; wm=addDays(wm,7)){
        var wReq=0,wDone=0;
        for(var i=0;i<7;i++){ var d=addDays(wm,i); if(d>todayD) break; var s=dayStats(d); wReq+=s.required; wDone+=s.done; }
        weeks.push('нед. '+wm.getDate()+'.'+pad(wm.getMonth()+1)+': '+(wReq>0?Math.round(wDone/wReq*100):0)+'%');
      }
      weeks.slice(-8).forEach(function(x){ L.push(x); });
      L.push('');
      L.push('== ЗАМЕТКИ (последние дни) ==');
      var shown=0;
      for(var n=0;n<21 && shown<7;n++){
        var d=addDays(todayD,-n), dk=key(d), parts=[];
        var notesForDay=state.notes[dk];
        if(notesForDay){
          Object.keys(notesForDay).forEach(function(hid){
            var h=findHabit(hid), txt=notesForDay[hid];
            if(h && txt && txt.trim()) parts.push(h.name+': '+txt.trim());
          });
        }
        var journal=state.journal[dk];
        if(journal && journal.trim()) parts.push('итог дня: '+journal.trim());
        if(parts.length){ L.push('['+dk+'] '+parts.join(' | ')); shown++; }
      }
      if(!shown) L.push('(записей пока нет)');
    }
    L.push('');
    L.push('== RAW (резервная копия, не разбирай) ==');
    L.push(JSON.stringify(state));
    return L.join('\n');
  }
  function fillReport(){ document.getElementById('reportOut').value=buildReport(); }
  function selectFallback(ta){ ta.focus(); ta.select(); try{ document.execCommand('copy'); }catch(e){} }
  function copyReport(){
    var ta=document.getElementById('reportOut'), status=document.getElementById('copied');
    if(!ta.value.trim()) ta.value=buildReport();
    var txt=ta.value;
    var ok=function(){ status.classList.add('show'); setTimeout(function(){ status.classList.remove('show'); },2500); };
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(txt).then(ok, function(){ selectFallback(ta); ok(); });
      } else { selectFallback(ta); ok(); }
    }catch(e){ selectFallback(ta); ok(); }
  }

  async function importBackup(){
    var input=document.getElementById('backupFile'), errorBox=document.getElementById('importError');
    errorBox.hidden=true;
    if(!input.files || !input.files[0]){ errorBox.textContent='Сначала выберите файл отчёта или JSON.'; errorBox.hidden=false; return; }
    try{
      var imported=M.parseBackup(await input.files[0].text(),todayKey);
      if(!confirm('Заменить текущие данные содержимым резервной копии?')) return;
      state=imported;
      await save();
      document.getElementById('dayReflect').value=state.journal[todayKey]||'';
      document.getElementById('reportOut').value='';
      renderAll();
      input.value='';
      showToast('Резервная копия восстановлена.');
    }catch(error){ errorBox.textContent=error.message||'Не удалось импортировать файл.'; errorBox.hidden=false; }
  }

  // ---- add / edit / delete habit sheet ----
  var sheetEditingId=null, sheetSubitems=[], sheetTrigger=null;
  (function(){
    var dp=document.getElementById('dayPicker');
    DAYS.forEach(function(lbl,i){
      var b=document.createElement('button'); b.type='button'; b.className='daychip'; b.dataset.d=i; b.textContent=lbl;
      b.setAttribute('aria-pressed','false');
      b.addEventListener('click',function(){ var on=!b.classList.contains('on'); b.classList.toggle('on',on); b.setAttribute('aria-pressed',on?'true':'false'); document.getElementById('dayError').hidden=true; });
      dp.appendChild(b);
    });
  })();
  function renderSubitemRows(){
    var box=document.getElementById('subitemsList'); box.innerHTML='';
    sheetSubitems.forEach(function(s,idx){
      var row=document.createElement('div'); row.className='subrow';
      var inp=document.createElement('input'); inp.className='finput'; inp.type='text'; inp.placeholder='Например: Разминка'; inp.maxLength=40; inp.value=s.text;
      inp.addEventListener('input',function(){ s.text=inp.value; });
      var rm=document.createElement('button'); rm.type='button'; rm.className='subrm'; rm.textContent='×';
      rm.setAttribute('aria-label','Удалить подраздел');
      rm.addEventListener('click',function(){ sheetSubitems.splice(idx,1); renderSubitemRows(); });
      row.appendChild(inp); row.appendChild(rm); box.appendChild(row);
    });
  }
  document.getElementById('addSubitem').addEventListener('click',function(){
    sheetSubitems.push({id:uid('s'),text:''});
    renderSubitemRows();
    var inputs=document.querySelectorAll('#subitemsList .finput');
    if(inputs.length) inputs[inputs.length-1].focus();
  });
  function openHabitSheet(h){
    sheetTrigger=document.activeElement;
    sheetEditingId=h?h.id:null;
    document.getElementById('sheetTitle').textContent=h?'Изменить привычку':'Новая привычка';
    document.getElementById('habitName').value=h?h.name:'';
    document.getElementById('habitSubtitle').value=h?(h.subtitle||''):'';
    document.querySelectorAll('#dayPicker .daychip').forEach(function(c){
      var d=+c.dataset.d, on=h?!!h.days[d]:true;
      c.classList.toggle('on',on); c.setAttribute('aria-pressed',on?'true':'false');
    });
    sheetSubitems=(h && h.subitems)?h.subitems.map(function(s){return {id:s.id,text:s.text};}):[];
    renderSubitemRows();
    document.getElementById('dayError').hidden=true;
    document.getElementById('habitDelete').style.display=h?'inline-block':'none';
    document.getElementById('sheetBackdrop').classList.add('open');
    document.body.classList.add('modal-open');
    document.getElementById('habitName').focus();
  }
  function closeSheet(){
    document.getElementById('sheetBackdrop').classList.remove('open'); document.body.classList.remove('modal-open'); sheetEditingId=null;
    if(sheetTrigger && typeof sheetTrigger.focus==='function') sheetTrigger.focus();
  }
  function renderHabitManager(){
    var list=document.getElementById('habitManager'), empty=document.getElementById('managerEmpty');
    list.innerHTML=''; empty.hidden=state.habits.length>0;
    state.habits.forEach(function(h){
      var item=document.createElement('li'); item.className='manager-item';
      var dot=document.createElement('span'); dot.className='hdot'; dot.style.background=h.color;
      var info=document.createElement('div'); info.className='manager-info';
      var name=document.createElement('div'); name.className='manager-name'; name.textContent=h.name;
      var schedule=document.createElement('div'); schedule.className='manager-schedule';
      schedule.textContent=h.days.map(function(v,i){return v?DAYS[i]:null;}).filter(Boolean).join(', ');
      var edit=document.createElement('button'); edit.type='button'; edit.className='navbtn manager-edit'; edit.textContent='Изменить';
      edit.setAttribute('aria-label','Изменить привычку «'+h.name+'»'); edit.addEventListener('click',function(){openHabitSheet(h);});
      info.appendChild(name); info.appendChild(schedule); item.appendChild(dot); item.appendChild(info); item.appendChild(edit); list.appendChild(item);
    });
  }
  function renderAll(){ buildToday(); renderWeek(); renderProgress(); renderHabitManager(); }

  document.getElementById('habitSave').addEventListener('click',function(){
    var name=document.getElementById('habitName').value.trim();
    if(!name){ document.getElementById('habitName').focus(); return; }
    var subtitle=document.getElementById('habitSubtitle').value.trim();
    var days=[0,1,2,3,4,5,6].map(function(i){ return document.querySelector('#dayPicker .daychip[data-d="'+i+'"]').classList.contains('on'); });
    if(!days.some(Boolean)){ document.getElementById('dayError').hidden=false; document.querySelector('#dayPicker .daychip').focus(); return; }
    var subitems=sheetSubitems.map(function(s){ return {id:s.id,text:(s.text||'').trim()}; }).filter(function(s){ return s.text; });
    if(sheetEditingId){
      var h=findHabit(sheetEditingId);
      if(h){
        var retained={}; subitems.forEach(function(s){retained[s.id]=true;});
        Object.keys(state.subState).forEach(function(dk){
          var values=state.subState[dk]&&state.subState[dk][h.id]; if(!values)return;
          Object.keys(values).forEach(function(id){if(!retained[id])delete values[id];});
          if(!Object.keys(values).length)delete state.subState[dk][h.id];
          if(!Object.keys(state.subState[dk]).length)delete state.subState[dk];
        });
        h.name=name; h.subtitle=subtitle; h.subitems=subitems; M.setSchedule(h,days,todayKey);
      }
    } else {
      state.habits.push({
        id:uid('h'), name:name, subtitle:subtitle,
        color:PALETTE[state.habits.length%PALETTE.length],
        days:days, schedules:[{from:todayKey,days:days.slice()}], subitems:subitems, createdAt:todayKey
      });
    }
    save(); closeSheet(); renderAll();
  });
  document.getElementById('habitDelete').addEventListener('click',function(){
    if(!sheetEditingId) return;
    var h=findHabit(sheetEditingId); if(!h) return;
    if(!confirm('Удалить привычку «'+h.name+'»? История отметок по ней тоже удалится.')) return;
    state.habits=state.habits.filter(function(x){return x.id!==sheetEditingId;});
    Object.keys(state.days).forEach(function(dk){
      if(state.days[dk][h.id]!==undefined){ delete state.days[dk][h.id]; if(Object.keys(state.days[dk]).length===0) delete state.days[dk]; }
    });
    Object.keys(state.notes).forEach(function(dk){
      if(state.notes[dk] && state.notes[dk][h.id]!==undefined){ delete state.notes[dk][h.id]; if(Object.keys(state.notes[dk]).length===0) delete state.notes[dk]; }
    });
    Object.keys(state.subState).forEach(function(dk){
      if(state.subState[dk] && state.subState[dk][h.id]!==undefined){ delete state.subState[dk][h.id]; if(Object.keys(state.subState[dk]).length===0) delete state.subState[dk]; }
    });
    save(); closeSheet(); renderAll();
  });
  document.getElementById('sheetClose').addEventListener('click',closeSheet);
  document.getElementById('sheetBackdrop').addEventListener('click',function(e){ if(e.target===this) closeSheet(); });
  document.getElementById('headerAddBtn').addEventListener('click',function(){ openHabitSheet(null); });
  document.getElementById('emptyAddBtn').addEventListener('click',function(){ openHabitSheet(null); });
  document.getElementById('managerAddBtn').addEventListener('click',function(){ openHabitSheet(null); });
  document.getElementById('importBackup').addEventListener('click',importBackup);

  document.getElementById('sheetBackdrop').addEventListener('keydown',function(e){
    if(e.key==='Escape'){ e.preventDefault(); closeSheet(); return; }
    if(e.key!=='Tab') return;
    var focusable=Array.from(this.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled])'));
    if(!focusable.length) return;
    var first=focusable[0], last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });

  var tabs=document.querySelectorAll('.tab');
  function activateTab(tab,moveFocus){
    tabs.forEach(function(x){ var active=x===tab; x.setAttribute('aria-selected',active?'true':'false'); x.tabIndex=active?0:-1; });
    document.querySelectorAll('.panel').forEach(function(p){ var active=p.id==='p-'+tab.dataset.tab; p.classList.toggle('active',active); p.hidden=!active; });
    if(moveFocus) tab.focus();
  }
  tabs.forEach(function(t){
    t.addEventListener('click',function(){ activateTab(t,false); });
    t.addEventListener('keydown',function(e){
      var index=Array.prototype.indexOf.call(tabs,t), next=index;
      if(e.key==='ArrowRight') next=(index+1)%tabs.length;
      else if(e.key==='ArrowLeft') next=(index-1+tabs.length)%tabs.length;
      else if(e.key==='Home') next=0;
      else if(e.key==='End') next=tabs.length-1;
      else return;
      e.preventDefault(); activateTab(tabs[next],true);
    });
  });
  document.getElementById('prevWeek').addEventListener('click',function(){ viewMonday=addDays(viewMonday,-7); renderWeek(); });
  document.getElementById('nextWeek').addEventListener('click',function(){ viewMonday=addDays(viewMonday,7); renderWeek(); });
  document.getElementById('thisWeek').addEventListener('click',function(){ viewMonday=mondayOf(new Date()); renderWeek(); });
  document.getElementById('buildReport').addEventListener('click',fillReport);
  document.getElementById('copyReport').addEventListener('click',copyReport);

  if('serviceWorker' in navigator){
    window.addEventListener('load',function(){ navigator.serviceWorker.register('sw.js').catch(function(){ showToast('Офлайн-режим не удалось включить.'); }); });
  }

  load().then(function(){ renderAll(); bindReflect(); });
})();

