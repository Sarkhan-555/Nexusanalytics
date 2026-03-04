/* =================================================================
   NEXUS ANALYTICS — script.js  v2.0
   Dual-mode: Text Reviews  +  World Bank WDI
   ================================================================= */

// =================== GLOBAL STATE ===================
const APP = {
  mode: null,          // 'text' | 'worldbank'
  // --- Text mode ---
  rawData: [], filtered: [],
  currentPage: 1, pageSize: 10,
  globalMetrics: null,
  // --- World Bank mode ---
  wbRawLong: [],        // full long-format array after melt
  wbFiltered: [],       // after WB filters
  wbMeta: null,         // { countries, indicators, years, missingRate }
  wbPage: 1, wbPageSize: 10,
  wbAllYears: false,    // toggle
  wbGlobalMetrics: null,
  // --- Shared ---
  charts: {}
};

// =================== STOP WORDS ===================
const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','up','about','into','through','during','is','are','was','were','be',
  'been','being','have','has','had','do','does','did','will','would','could',
  'should','may','might','shall','can','need','dare','ought','used','it','its',
  'this','that','these','those','i','me','my','myself','we','our','ours','ourselves',
  'you','your','yours','yourself','yourselves','he','him','his','himself','she',
  'her','hers','herself','they','them','their','theirs','themselves','what','which',
  'who','whom','when','where','why','how','all','each','every','both','few','more',
  'most','other','some','such','no','not','only','own','same','so','than','too',
  'very','just','because','as','until','while','although','if','then','else','also',
  'again','further','once','here','there','any','am','get','got','go','goes',
  'went','come','came','said','say','make','made','know','think','take','see','look',
  'want','give','use','find','tell','ask','seem','feel','try','leave','call','keep',
  'let','put','show','set','turn','move','live','play','run','buy','hold','bring',
  'now','well','over','back','even','much','good','new','first','last','long','great',
  'little','own','right','big','high','different','small','large','old','next','early',
  'young','important','public','private','real','best','free','able','however','still',
  'us','him','has','been','its','like','just','after','before','between','against',
  'off','out','up','down','under','above','never','always','often','sometimes'
]);

// =================== SENTIMENT LEXICON ===================
const POS_WORDS = new Set([
  'good','great','excellent','amazing','wonderful','fantastic','outstanding','superb',
  'brilliant','awesome','perfect','love','loved','best','beautiful','nice','happy',
  'pleased','satisfied','impressive','delightful','positive','recommend','enjoy',
  'enjoyed','helpful','reliable','efficient','effective','quality','comfortable',
  'convenient','clean','friendly','fast','quick','easy','smooth','safe','secure',
  'affordable','value','worth','glad','thankful','grateful','magnificent',
  'exceptional','marvelous','splendid','terrific','incredible','fabulous','stunning',
  'extraordinary','innovative','creative','intelligent','smart','professional',
  'courteous','pleasant','polite','kind','generous','honest','fair','trustworthy',
  'consistent','dependable','robust','durable','stylish','elegant','modern','fresh'
]);
const NEG_WORDS = new Set([
  'bad','terrible','awful','horrible','poor','worst','hate','hated','ugly','sad',
  'disappointed','disappointing','unhappy','dissatisfied','frustrating','frustrated',
  'annoying','annoyed','broken','defective','faulty','damaged','cheap','overpriced',
  'expensive','slow','difficult','complicated','confusing','misleading','unreliable',
  'inconsistent','unprofessional','rude','unfriendly','dishonest','fake','scam',
  'fraud','waste','useless','pointless','ineffective','inefficient','uncomfortable',
  'dangerous','unsafe','dirty','messy','noisy','stressful','painful',
  'dreadful','dismal','inferior','mediocre','subpar','deficient','inadequate',
  'unacceptable','unsatisfactory','regret','regretful','avoid','not',
  'problem','issue','error','bug','crash','fail','failed','failure','wrong',
  'incorrect','inaccurate','mislead','deceptive','false','negative','reject'
]);

// =================== SHARED UTILS ===================
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(t=>t.length>1);
}
function computeSentiment(tokens) {
  let pos=0,neg=0;
  tokens.forEach(t=>{if(POS_WORDS.has(t))pos++;if(NEG_WORDS.has(t))neg++;});
  return (pos-neg)/Math.max(1,tokens.length);
}
function median(arr){
  if(!arr.length)return 0;
  const s=[...arr].sort((a,b)=>a-b);const m=Math.floor(s.length/2);
  return s.length%2!==0?s[m]:(s[m-1]+s[m])/2;
}
function mean(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;}
function getClassColor(i,alpha=0.8){
  const p=[`rgba(0,240,255,${alpha})`,`rgba(168,85,247,${alpha})`,`rgba(244,114,182,${alpha})`,
    `rgba(0,255,170,${alpha})`,`rgba(251,191,36,${alpha})`,`rgba(249,115,22,${alpha})`,
    `rgba(99,102,241,${alpha})`,`rgba(20,184,166,${alpha})`,`rgba(236,72,153,${alpha})`,`rgba(132,204,22,${alpha})`];
  return p[i%p.length];
}
function escHtml(str){return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function download(filename,content,mime){
  const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

// =================== TOAST / PROGRESS / STATUS ===================
function showToast(type,title,msg){
  const tc=document.getElementById('toast-container');
  const icon=type==='error'?'⚠':type==='success'?'✓':'ℹ';
  const el=document.createElement('div');el.className=`toast ${type}`;
  el.innerHTML=`<span class="toast-icon">${icon}</span><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div>`;
  tc.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(20px)';el.style.transition='0.3s';setTimeout(()=>el.remove(),300);},3500);
}
function setProgress(pct,label){
  document.getElementById('progress-fill').style.width=pct+'%';
  document.getElementById('progress-label').textContent=label;
}
function setStatus(state,text){
  document.querySelector('.status-dot').className='status-dot '+state;
  document.getElementById('status-text').textContent=text;
}
function destroyChart(id){if(APP.charts[id]){APP.charts[id].destroy();delete APP.charts[id];}}

const CD={font:{family:'Syne,sans-serif',size:11},grid:{color:'rgba(255,255,255,0.05)'},tick:{color:'#445577'}};

// ================================================================
//  SCHEMA DETECTION
// ================================================================
function detectSchema(results) {
  if (!results.data || results.data.length === 0) return 'empty';
  // Find first row that has non-empty keys
  const firstRow = results.data[0];
  const keys = Object.keys(firstRow).map(k => k.trim().toLowerCase());

  const hasClass = keys.includes('class');
  const hasText  = keys.includes('text');
  if (hasClass && hasText) return 'text';

  const hasCountry   = keys.some(k => k.includes('country name'));
  const hasIndicator = keys.some(k => k.includes('indicator name'));
  const hasYearCol   = keys.some(k => /^(19|20)\d{2}$/.test(k.trim()));
  if (hasCountry && hasIndicator && hasYearCol) return 'worldbank';

  return 'unknown';
}

// ================================================================
//  TEXT REVIEWS  — parse / metrics / filters / render
// ================================================================
function parseTextData(csvText) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      complete: (results) => {
        if (!results.data || !results.data.length) { reject('Empty file'); return; }
        const cols = Object.keys(results.data[0]).map(c=>c.toLowerCase());
        if (!cols.includes('class') || !cols.includes('text')) {
          reject('Missing columns: CSV must have "class" and "text" columns'); return;
        }
        const rows = results.data
          .filter(r => r.class && r.text && r.class.trim() && r.text.trim())
          .map(r => {
            const tokens = tokenize(r.text);
            return { class: r.class.trim(), text: r.text.trim(), tokens, wc: tokens.length, sentiment: computeSentiment(tokens) };
          });
        if (!rows.length) { reject('No valid rows found'); return; }
        resolve(rows);
      },
      error: err => reject(err.message)
    });
  });
}

function computeMetrics(data) {
  const classes=[...new Set(data.map(r=>r.class))].sort();
  const wcs=data.map(r=>r.wc), sents=data.map(r=>r.sentiment);
  const classCounts={}, classWC={}, classSent={};
  classes.forEach(c=>{
    const rows=data.filter(r=>r.class===c);
    classCounts[c]=rows.length;
    const vals=rows.map(r=>r.wc);
    classWC[c]={vals,avg:mean(vals),min:Math.min(...vals),max:Math.max(...vals)};
    classSent[c]=mean(rows.map(r=>r.sentiment));
  });
  return {
    total:data.length, classes, numClasses:classes.length,
    avgWords:mean(wcs), medianWords:median(wcs), avgSentiment:mean(sents),
    classCounts, classWC, classSent,
    wcMin:Math.min(...wcs), wcMax:Math.max(...wcs),
    sentMin:Math.min(...sents), sentMax:Math.max(...sents),
    wcs, sents
  };
}

function applyFilters() {
  const cls=document.getElementById('filter-class').value;
  const kw=document.getElementById('filter-search').value.trim().toLowerCase();
  const wcMin=parseInt(document.getElementById('wc-min').value);
  const wcMax=parseInt(document.getElementById('wc-max').value);
  const sMin=parseInt(document.getElementById('sent-min').value)/100;
  const sMax=parseInt(document.getElementById('sent-max').value)/100;
  APP.filtered=APP.rawData.filter(r=>{
    if(cls!=='ALL'&&r.class!==cls)return false;
    if(kw&&!r.text.toLowerCase().includes(kw))return false;
    if(r.wc<wcMin||r.wc>wcMax)return false;
    if(r.sentiment<sMin||r.sentiment>sMax)return false;
    return true;
  });
  APP.currentPage=1;
  renderTextAll();
}

function renderTextAll() {
  const m=computeMetrics(APP.filtered);
  renderKPIs(m); renderCharts(m); renderTopTerms(APP.filtered);
  renderTable(); generateInsights(m, APP.filtered);
}

function renderKPIs(m) {
  document.getElementById('kpi-total-val').textContent=m.total.toLocaleString();
  document.getElementById('kpi-classes-val').textContent=m.numClasses;
  document.getElementById('kpi-avgwords-val').textContent=m.avgWords.toFixed(1);
  document.getElementById('kpi-median-val').textContent=m.medianWords.toFixed(0);
  const sv=m.avgSentiment, el=document.getElementById('kpi-sentiment-val');
  el.textContent=sv.toFixed(4);
  el.style.color=sv>0.01?'#00ffaa':sv<-0.01?'#f472b6':'#8ba4c8';
}

function renderCharts(m) { renderClassDist(m); renderWCDist(m); renderWCClass(m); renderSentimentClass(m); }

function renderClassDist(m) {
  destroyChart('classDist');
  const ctx=document.getElementById('chart-class-dist').getContext('2d');
  APP.charts.classDist=new Chart(ctx,{type:'bar',
    data:{labels:m.classes,datasets:[{label:'Count',data:m.classes.map(c=>m.classCounts[c]),backgroundColor:m.classes.map((_,i)=>getClassColor(i,0.75)),borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:t=>' '+t.raw.toLocaleString()}}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxRotation:40},grid:{color:CD.grid.color}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}});
}

function renderWCDist(m) {
  destroyChart('wcDist');
  const ctx=document.getElementById('chart-wc-dist').getContext('2d');
  const bins=20,wcs=m.wcs,mn=Math.min(...wcs),mx=Math.max(...wcs),step=(mx-mn)/bins||1;
  const counts=new Array(bins).fill(0);
  wcs.forEach(v=>{let b=Math.floor((v-mn)/step);if(b>=bins)b=bins-1;counts[b]++;});
  const labels=Array.from({length:bins},(_,i)=>Math.round(mn+i*step));
  APP.charts.wcDist=new Chart(ctx,{type:'bar',
    data:{labels,datasets:[{label:'Reviews',data:counts,backgroundColor:'rgba(0,240,255,0.45)',borderRadius:2,barPercentage:0.95,categoryPercentage:1}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxTicksLimit:8},grid:{display:false}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}});
}

function renderWCClass(m) {
  destroyChart('wcClass');
  const ctx=document.getElementById('chart-wc-class').getContext('2d');
  APP.charts.wcClass=new Chart(ctx,{type:'bar',
    data:{labels:m.classes,datasets:[
      {label:'Avg WC',data:m.classes.map(c=>m.classWC[c].avg),backgroundColor:m.classes.map((_,i)=>getClassColor(i,0.7)),borderRadius:4,order:1},
      {label:'Min',data:m.classes.map(c=>m.classWC[c].min),type:'line',borderColor:'rgba(0,255,170,0.5)',backgroundColor:'transparent',pointRadius:3,pointBackgroundColor:'rgba(0,255,170,0.8)',borderDash:[4,2],order:0},
      {label:'Max',data:m.classes.map(c=>m.classWC[c].max),type:'line',borderColor:'rgba(244,114,182,0.5)',backgroundColor:'transparent',pointRadius:3,pointBackgroundColor:'rgba(244,114,182,0.8)',borderDash:[4,2],order:0}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8ba4c8',font:CD.font,boxWidth:10}}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxRotation:40},grid:{color:CD.grid.color}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}});
}

function renderSentimentClass(m) {
  destroyChart('sentClass');
  const ctx=document.getElementById('chart-sentiment-class').getContext('2d');
  const vals=m.classes.map(c=>parseFloat(m.classSent[c].toFixed(5)));
  APP.charts.sentClass=new Chart(ctx,{type:'bar',
    data:{labels:m.classes,datasets:[{label:'Avg Sentiment',data:vals,backgroundColor:vals.map(v=>v>0?'rgba(0,255,170,0.65)':'rgba(244,114,182,0.65)'),borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxRotation:40},grid:{color:CD.grid.color}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}});
}

function renderTopTerms(data) {
  const wf={}, bf={};
  data.forEach(r=>{
    const ft=r.tokens.filter(t=>!STOPWORDS.has(t)&&t.length>2);
    ft.forEach(t=>{wf[t]=(wf[t]||0)+1;});
    for(let i=0;i<ft.length-1;i++){const bg=ft[i]+' '+ft[i+1];bf[bg]=(bf[bg]||0)+1;}
  });
  renderTermList('top-words-list',wf,20);
  renderTermList('top-bigrams-list',bf,20);
}

function renderTermList(elId,freq,topN) {
  const el=document.getElementById(elId);
  const sorted=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,topN);
  if(!sorted.length){el.innerHTML='<div style="color:var(--text-muted);font-size:0.8rem;">No data</div>';return;}
  const mx=sorted[0][1];
  el.innerHTML=sorted.map(([word,count],i)=>`
    <div class="term-item" style="animation-delay:${i*0.03}s">
      <span class="term-rank">${i+1}</span>
      <div class="term-bar-wrap"><div class="term-bar" style="width:${(count/mx*100).toFixed(1)}%"></div></div>
      <span class="term-word">${word}</span>
      <span class="term-count">${count.toLocaleString()}</span>
    </div>`).join('');
}

function renderTable() {
  const data=APP.filtered, total=data.length;
  const pages=Math.ceil(total/APP.pageSize), start=(APP.currentPage-1)*APP.pageSize;
  document.getElementById('table-count').textContent=total.toLocaleString();
  const tbody=document.getElementById('table-body');
  tbody.innerHTML=data.slice(start,start+APP.pageSize).map((r,i)=>{
    const sc=r.sentiment>0.01?'sent-pos':r.sentiment<-0.01?'sent-neg':'sent-neu';
    const se=r.sentiment>0.01?'▲':r.sentiment<-0.01?'▼':'●';
    return `<tr>
      <td class="td-num">${start+i+1}</td>
      <td class="td-class">${escHtml(r.class)}</td>
      <td style="color:var(--text-secondary);line-height:1.5;">${escHtml(r.text.slice(0,120))}${r.text.length>120?'…':''}</td>
      <td class="td-num">${r.wc}</td>
      <td class="td-num ${sc}">${se} ${r.sentiment.toFixed(4)}</td></tr>`;
  }).join('');
  renderPagination('pagination',pages,APP.currentPage,p=>{APP.currentPage=p;renderTable();});
}

function renderPagination(elId,pages,current,onPage) {
  const pag=document.getElementById(elId);
  pag.innerHTML='';
  const maxShow=Math.min(pages,10);
  for(let p=1;p<=maxShow;p++){
    const btn=document.createElement('button');
    btn.className='page-btn'+(p===current?' active':'');
    btn.textContent=p;
    btn.onclick=()=>onPage(p);
    pag.appendChild(btn);
  }
  if(pages>10){
    const sp=document.createElement('span');
    sp.style.cssText='font-size:0.72rem;color:var(--text-muted);align-self:center;';
    sp.textContent=`... ${pages} pages`;
    pag.appendChild(sp);
  }
}

function generateInsights(m,data) {
  const list=document.getElementById('insights-list');
  if(!data.length){list.innerHTML='<div class="insight-item"><span class="insight-icon">⚡</span><div class="insight-text">No data matches current filters.</div></div>';return;}
  const ins=[];
  const topCls=m.classes.reduce((a,b)=>m.classCounts[a]>m.classCounts[b]?a:b);
  ins.push(`The class <strong>${topCls}</strong> is the largest group, representing ${((m.classCounts[topCls]/m.total)*100).toFixed(1)}% of filtered reviews.`);
  if(m.numClasses>1){
    const pos=m.classes.reduce((a,b)=>m.classSent[a]>m.classSent[b]?a:b);
    const neg=m.classes.reduce((a,b)=>m.classSent[a]<m.classSent[b]?a:b);
    ins.push(`<strong>${pos}</strong> has the most positive sentiment (${m.classSent[pos].toFixed(4)}), while <strong>${neg}</strong> is the most negative (${m.classSent[neg].toFixed(4)}).`);
  }
  const longCls=m.classes.reduce((a,b)=>m.classWC[a].avg>m.classWC[b].avg?a:b);
  ins.push(`Reviews in class <strong>${longCls}</strong> are on average the longest with ${m.classWC[longCls].avg.toFixed(1)} words.`);
  const bf={};
  data.forEach(r=>{const ft=r.tokens.filter(t=>!STOPWORDS.has(t)&&t.length>2);for(let i=0;i<ft.length-1;i++){const bg=ft[i]+' '+ft[i+1];bf[bg]=(bf[bg]||0)+1;}});
  const topBg=Object.entries(bf).sort((a,b)=>b[1]-a[1])[0];
  if(topBg)ins.push(`The most frequent bigram is <strong>"${topBg[0]}"</strong>, appearing ${topBg[1].toLocaleString()} times.`);
  ins.push(`Word count ranges from <strong>${m.wcMin}</strong> to <strong>${Math.max(...m.wcs)}</strong> with median <strong>${m.medianWords.toFixed(0)}</strong>.`);
  list.innerHTML=ins.map(t=>`<div class="insight-item"><span class="insight-icon">◆</span><span class="insight-text">${t}</span></div>`).join('');
}

function exportCSV() {
  if(!APP.filtered.length){showToast('error','Export Failed','No data to export');return;}
  const rows=[['class','text','word_count','sentiment']];
  APP.filtered.forEach(r=>rows.push([`"${r.class.replace(/"/g,'""')}"`,`"${r.text.replace(/"/g,'""')}"`,r.wc,r.sentiment.toFixed(6)]));
  download('filtered_reviews.csv',rows.map(r=>r.join(',')).join('\n'),'text/csv');
  showToast('success','CSV Exported',`${APP.filtered.length.toLocaleString()} rows.`);
}

function exportJSON() {
  if(!APP.filtered.length){showToast('error','Export Failed','No data to export');return;}
  const m=computeMetrics(APP.filtered);
  const wf={},bf={};
  APP.filtered.forEach(r=>{const ft=r.tokens.filter(t=>!STOPWORDS.has(t)&&t.length>2);ft.forEach(t=>{wf[t]=(wf[t]||0)+1;});for(let i=0;i<ft.length-1;i++){const bg=ft[i]+' '+ft[i+1];bf[bg]=(bf[bg]||0)+1;}});
  const summary={generated_at:new Date().toISOString(),kpi:{total_reviews:m.total,num_classes:m.numClasses,avg_words:+m.avgWords.toFixed(2),median_words:+m.medianWords.toFixed(2),avg_sentiment:+m.avgSentiment.toFixed(6)},
    class_distribution:m.classCounts,
    class_avg_wordcount:Object.fromEntries(m.classes.map(c=>[c,+m.classWC[c].avg.toFixed(2)])),
    class_avg_sentiment:Object.fromEntries(m.classes.map(c=>[c,+m.classSent[c].toFixed(6)])),
    top_words:Object.entries(wf).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([w,c])=>({word:w,count:c})),
    top_bigrams:Object.entries(bf).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([bg,c])=>({bigram:bg,count:c}))};
  download('summary.json',JSON.stringify(summary,null,2),'application/json');
  showToast('success','JSON Exported','Summary downloaded.');
}

function setupTextFilterUI(metrics) {
  const sel=document.getElementById('filter-class');
  sel.innerHTML='<option value="ALL">All Classes</option>';
  metrics.classes.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o);});
  const wMin=document.getElementById('wc-min'),wMax=document.getElementById('wc-max');
  wMin.min=wMax.min=metrics.wcMin; wMin.max=wMax.max=metrics.wcMax;
  wMin.value=metrics.wcMin; wMax.value=metrics.wcMax;
  const sMin=document.getElementById('sent-min'),sMax=document.getElementById('sent-max');
  sMin.min=sMax.min=Math.floor(metrics.sentMin*100)-1;
  sMin.max=sMax.max=Math.ceil(metrics.sentMax*100)+1;
  sMin.value=sMin.min; sMax.value=sMax.max;
  updateTextRangeLabels();
}

function updateTextRangeLabels() {
  document.getElementById('wc-range-label').textContent=`${document.getElementById('wc-min').value} – ${document.getElementById('wc-max').value}`;
  document.getElementById('sent-range-label').textContent=`${(parseInt(document.getElementById('sent-min').value)/100).toFixed(2)} – ${(parseInt(document.getElementById('sent-max').value)/100).toFixed(2)}`;
}

// ================================================================
//  WORLD BANK — parse / metrics / filters / render
// ================================================================

function parseWorldBank(csvText) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      transformHeader: h => h.trim(),
      complete: (results) => {
        if (!results.data || !results.data.length) { reject('Empty file'); return; }

        // Find rows that have Country Name filled (skip metadata rows)
        const isYearKey = k => /^(19|20)\d{2}$/.test(k.trim());
        const allKeys = results.meta.fields || Object.keys(results.data[0]);
        const yearCols = allKeys.filter(isYearKey);

        if (!yearCols.length) { reject('No year columns found in World Bank CSV'); return; }

        // Filter valid rows: must have Country Name and Indicator Name
        const validRows = results.data.filter(r => {
          const cn = r['Country Name'] || r['country name'] || r['COUNTRY NAME'];
          const ind = r['Indicator Name'] || r['indicator name'];
          return cn && String(cn).trim() && ind && String(ind).trim()
            && !/^data source$/i.test(String(cn).trim())
            && !/^last updated/i.test(String(cn).trim())
            && String(cn).trim().length > 1;
        });

        if (!validRows.length) { reject('No valid country rows found. Check CSV format.'); return; }

        // Count total wide cells for missing rate
        const totalWide = validRows.length * yearCols.length;
        let missingWide = 0;

        // Default: only 1990+ unless toggle set
        const yearThreshold = APP.wbAllYears ? 0 : 1990;
        const activeYears = yearCols.filter(y => parseInt(y) >= yearThreshold);

        // Melt: wide → long
        const longData = [];
        validRows.forEach(r => {
          const country = String(r['Country Name'] || r['country name'] || '').trim();
          const countryCode = String(r['Country Code'] || r['country code'] || '').trim();
          const indicator = String(r['Indicator Name'] || r['indicator name'] || '').trim();
          const indicatorCode = String(r['Indicator Code'] || r['indicator code'] || '').trim();

          yearCols.forEach(y => {
            const rawVal = r[y];
            if (rawVal === null || rawVal === undefined || rawVal === '' || rawVal !== rawVal) {
              missingWide++;
              return; // skip missing
            }
            const val = parseFloat(rawVal);
            if (isNaN(val)) { missingWide++; return; }
            const yr = parseInt(y);
            if (yr < yearThreshold) return;
            longData.push({ country, countryCode, indicator, indicatorCode, year: yr, value: val });
          });
        });

        if (!longData.length) { reject('No numeric values found after melt. Try "Include all years" toggle.'); return; }

        const missingRate = ((missingWide / totalWide) * 100).toFixed(1);
        resolve({ longData, missingRate, yearCols, validRowCount: validRows.length });
      },
      error: err => reject(err.message)
    });
  });
}

function computeWorldBankMetrics(longData, missingRate) {
  const countries = [...new Set(longData.map(r => r.country))].sort();
  const indicators = [...new Set(longData.map(r => r.indicator))].sort();
  const years = [...new Set(longData.map(r => r.year))].sort((a,b)=>a-b);
  return {
    total: longData.length,
    countries, numCountries: countries.length,
    indicators, numIndicators: indicators.length,
    years, minYear: years[0], maxYear: years[years.length-1],
    missingRate
  };
}

function setupWorldBankFilterUI(meta) {
  // Indicators
  const indSel = document.getElementById('wb-filter-indicator');
  indSel.innerHTML = '<option value="ALL">All Indicators</option>';
  meta.indicators.slice(0,200).forEach(ind => {
    const o = document.createElement('option');
    o.value = ind; o.textContent = ind.length > 80 ? ind.slice(0,80)+'…' : ind;
    indSel.appendChild(o);
  });

  // Countries (max 200)
  const cSel = document.getElementById('wb-filter-country');
  cSel.innerHTML = '<option value="ALL">All Countries</option>';
  meta.countries.slice(0,200).forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    cSel.appendChild(o);
  });

  // Year sliders
  const yMin = document.getElementById('wb-year-min');
  const yMax = document.getElementById('wb-year-max');
  yMin.min = yMax.min = meta.minYear;
  yMin.max = yMax.max = meta.maxYear;
  yMin.value = meta.minYear;
  yMax.value = meta.maxYear;
  updateWBYearLabel();
}

function updateWBYearLabel() {
  document.getElementById('wb-year-label').textContent =
    `${document.getElementById('wb-year-min').value} – ${document.getElementById('wb-year-max').value}`;
}

function applyWorldBankFilters() {
  const ind = document.getElementById('wb-filter-indicator').value;
  const country = document.getElementById('wb-filter-country').value;
  const yMin = parseInt(document.getElementById('wb-year-min').value);
  const yMax = parseInt(document.getElementById('wb-year-max').value);

  APP.wbFiltered = APP.wbRawLong.filter(r => {
    if (ind !== 'ALL' && r.indicator !== ind) return false;
    if (country !== 'ALL' && r.country !== country) return false;
    if (r.year < yMin || r.year > yMax) return false;
    return true;
  });

  APP.wbPage = 1;
  renderWorldBankAll();
}

function renderWorldBankAll() {
  const m = computeWorldBankMetrics(APP.wbFiltered, APP.wbGlobalMetrics.missingRate);
  renderWorldBankKPIs(m);
  renderWorldBankCharts(m, APP.wbFiltered);
  renderWorldBankTable();
  generateWBInsights(m, APP.wbFiltered);
}

function renderWorldBankKPIs(m) {
  document.getElementById('wb-kpi-records').textContent = m.total.toLocaleString();
  document.getElementById('wb-kpi-countries').textContent = m.numCountries.toLocaleString();
  document.getElementById('wb-kpi-indicators').textContent = m.numIndicators.toLocaleString();
  document.getElementById('wb-kpi-years').textContent = `${m.minYear}–${m.maxYear}`;
  document.getElementById('wb-kpi-missing').textContent = APP.wbGlobalMetrics.missingRate + '%';
}

function renderWorldBankCharts(m, data) {
  const selInd = document.getElementById('wb-filter-indicator').value;
  const selCountry = document.getElementById('wb-filter-country').value;
  const activeInd = selInd !== 'ALL' ? selInd : (m.indicators[0] || '');
  const activeCountry = selCountry !== 'ALL' ? selCountry : (m.countries[0] || '');

  // Update subtitles
  const short = s => s.length > 40 ? s.slice(0,40)+'…' : s;
  document.getElementById('wb-chart1-sub').textContent = activeInd ? '— ' + short(activeInd) : '';
  document.getElementById('wb-chart2-sub').textContent = activeInd ? '— ' + short(activeInd) : '';
  document.getElementById('wb-chart3-sub').textContent = activeCountry ? '— ' + activeCountry : '';

  renderWBGlobalTrend(data, activeInd);
  renderWBTopCountries(data, activeInd, m.maxYear);
  renderWBCountryTS(data, activeCountry, activeInd);
  renderWBMissing(data, m.years);
}

function renderWBGlobalTrend(data, indicator) {
  destroyChart('wbTrend');
  const ctx = document.getElementById('wb-chart-global-trend').getContext('2d');
  const subset = indicator ? data.filter(r => r.indicator === indicator) : data;
  const byYear = {};
  subset.forEach(r => { if (!byYear[r.year]) byYear[r.year] = []; byYear[r.year].push(r.value); });
  const years = Object.keys(byYear).map(Number).sort((a,b)=>a-b);
  const avgs = years.map(y => mean(byYear[y]));
  APP.charts.wbTrend = new Chart(ctx, {
    type: 'line',
    data: { labels: years, datasets: [{ label: 'Global Avg', data: avgs,
      borderColor: 'rgba(168,85,247,0.9)', backgroundColor: 'rgba(168,85,247,0.08)',
      fill: true, tension: 0.3, pointRadius: 2, pointBackgroundColor: 'rgba(168,85,247,0.9)' }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8ba4c8', font: CD.font } } },
      scales: {
        x: { ticks: { color: CD.tick.color, font: CD.font, maxTicksLimit: 12 }, grid: { color: CD.grid.color } },
        y: { ticks: { color: CD.tick.color, font: CD.font }, grid: { color: CD.grid.color } }
      }}
  });
}

function renderWBTopCountries(data, indicator, latestYear) {
  destroyChart('wbTopCountries');
  const ctx = document.getElementById('wb-chart-top-countries').getContext('2d');
  const subset = data.filter(r => r.year === latestYear && (indicator ? r.indicator === indicator : true));
  // aggregate by country
  const byCountry = {};
  subset.forEach(r => { if (!byCountry[r.country]) byCountry[r.country] = []; byCountry[r.country].push(r.value); });
  const sorted = Object.entries(byCountry).map(([c,vals])=>({country:c,avg:mean(vals)})).sort((a,b)=>b.avg-a.avg).slice(0,10);
  APP.charts.wbTopCountries = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(d=>d.country), datasets: [{ label: `Avg (${latestYear})`, data: sorted.map(d=>d.avg),
      backgroundColor: sorted.map((_,i)=>getClassColor(i,0.7)), borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CD.tick.color, font: CD.font }, grid: { color: CD.grid.color } },
        y: { ticks: { color: CD.tick.color, font: { family: 'Syne,sans-serif', size: 10 } }, grid: { display: false } }
      }}
  });
}

function renderWBCountryTS(data, country, indicator) {
  destroyChart('wbCountryTS');
  const ctx = document.getElementById('wb-chart-country-ts').getContext('2d');
  const subset = data.filter(r => r.country === country && (indicator ? r.indicator === indicator : true));
  const byYear = {};
  subset.forEach(r => { if (!byYear[r.year]) byYear[r.year] = []; byYear[r.year].push(r.value); });
  const years = Object.keys(byYear).map(Number).sort((a,b)=>a-b);
  const vals = years.map(y => mean(byYear[y]));
  APP.charts.wbCountryTS = new Chart(ctx, {
    type: 'line',
    data: { labels: years, datasets: [{ label: country || 'Country', data: vals,
      borderColor: 'rgba(0,240,255,0.9)', backgroundColor: 'rgba(0,240,255,0.06)',
      fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: 'rgba(0,240,255,0.9)' }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8ba4c8', font: CD.font } } },
      scales: {
        x: { ticks: { color: CD.tick.color, font: CD.font, maxTicksLimit: 10 }, grid: { color: CD.grid.color } },
        y: { ticks: { color: CD.tick.color, font: CD.font }, grid: { color: CD.grid.color } }
      }}
  });
}

function renderWBMissing(data, years) {
  destroyChart('wbMissing');
  const ctx = document.getElementById('wb-chart-missing').getContext('2d');
  // Approximate missing: years with very few records compared to max
  const byYear = {};
  data.forEach(r => { byYear[r.year] = (byYear[r.year] || 0) + 1; });
  const allYears = years.slice(-30); // last 30 shown
  const maxCount = Math.max(...allYears.map(y => byYear[y] || 0), 1);
  const coveragePct = allYears.map(y => {
    const cnt = byYear[y] || 0;
    return parseFloat((100 - (cnt / maxCount * 100)).toFixed(1));
  });
  APP.charts.wbMissing = new Chart(ctx, {
    type: 'bar',
    data: { labels: allYears, datasets: [{ label: 'Missing %', data: coveragePct,
      backgroundColor: coveragePct.map(v => v > 50 ? 'rgba(244,114,182,0.6)' : v > 20 ? 'rgba(251,191,36,0.6)' : 'rgba(0,240,255,0.4)'),
      borderRadius: 2 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CD.tick.color, font: CD.font, maxTicksLimit: 10 }, grid: { display: false } },
        y: { min: 0, max: 100, ticks: { color: CD.tick.color, font: CD.font, callback: v => v + '%' }, grid: { color: CD.grid.color } }
      }}
  });
}

function renderWorldBankTable() {
  const data = APP.wbFiltered;
  const total = data.length;
  const pages = Math.ceil(total / APP.wbPageSize);
  const start = (APP.wbPage - 1) * APP.wbPageSize;
  document.getElementById('wb-table-count').textContent = total.toLocaleString();
  const vals = data.map(r => r.value);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const tbody = document.getElementById('wb-table-body');
  tbody.innerHTML = data.slice(start, start + APP.wbPageSize).map((r, i) => {
    const pct = mx > mn ? (r.value - mn) / (mx - mn) : 0.5;
    const vc = pct > 0.66 ? 'val-high' : pct < 0.33 ? 'val-low' : 'val-mid';
    return `<tr>
      <td class="td-num">${start+i+1}</td>
      <td class="td-class">${escHtml(r.country)}</td>
      <td style="color:var(--text-secondary);font-size:0.8rem;line-height:1.4;">${escHtml(r.indicator.slice(0,80))}${r.indicator.length>80?'…':''}</td>
      <td class="td-num">${r.year}</td>
      <td class="td-num ${vc}">${r.value.toLocaleString(undefined,{maximumFractionDigits:3})}</td></tr>`;
  }).join('');
  renderPagination('wb-pagination', pages, APP.wbPage, p => { APP.wbPage = p; renderWorldBankTable(); });
}

function generateWBInsights(m, data) {
  const list = document.getElementById('wb-insights-list');
  if (!data.length) {
    list.innerHTML = '<div class="insight-item"><span class="insight-icon">⚡</span><div class="insight-text">No data matches current filters.</div></div>';
    return;
  }
  const ins = [];

  // Most records country
  const byCountry = {};
  data.forEach(r => { byCountry[r.country] = (byCountry[r.country] || 0) + 1; });
  const topCountry = Object.entries(byCountry).sort((a,b)=>b[1]-a[1])[0];
  if (topCountry) ins.push(`<strong>${topCountry[0]}</strong> has the most data records in this view (${topCountry[1].toLocaleString()} entries).`);

  // Highest average value country
  const cVals = {};
  data.forEach(r => { if (!cVals[r.country]) cVals[r.country] = []; cVals[r.country].push(r.value); });
  const cAvgs = Object.entries(cVals).map(([c,v]) => ({ country: c, avg: mean(v) })).sort((a,b) => b.avg - a.avg);
  if (cAvgs.length) ins.push(`<strong>${cAvgs[0].country}</strong> has the highest average indicator value (${cAvgs[0].avg.toLocaleString(undefined,{maximumFractionDigits:2})}), while <strong>${cAvgs[cAvgs.length-1].country}</strong> has the lowest.`);

  // Trend direction
  const byYear = {};
  data.forEach(r => { if (!byYear[r.year]) byYear[r.year] = []; byYear[r.year].push(r.value); });
  const yrs = Object.keys(byYear).map(Number).sort((a,b)=>a-b);
  if (yrs.length >= 2) {
    const first = mean(byYear[yrs[0]]), last = mean(byYear[yrs[yrs.length-1]]);
    const pct = (((last - first) / Math.abs(first)) * 100).toFixed(1);
    const dir = last > first ? '▲ increased' : '▼ decreased';
    ins.push(`Global average ${dir} by <strong>${Math.abs(pct)}%</strong> from ${yrs[0]} to ${yrs[yrs.length-1]}.`);
  }

  // Year coverage
  ins.push(`This view covers <strong>${yrs.length}</strong> years (${yrs[0]}–${yrs[yrs.length-1]}) across <strong>${m.numCountries}</strong> countries and <strong>${m.numIndicators}</strong> indicator(s).`);

  // Missing rate
  ins.push(`Overall raw data missing rate is <strong>${APP.wbGlobalMetrics.missingRate}%</strong> (including all year columns before melt).`);

  list.innerHTML = ins.map(t => `<div class="insight-item"><span class="insight-icon">◆</span><span class="insight-text">${t}</span></div>`).join('');
}

function exportWorldBankCSV() {
  if (!APP.wbFiltered.length) { showToast('error','Export Failed','No data to export'); return; }
  const rows = [['country','country_code','indicator','indicator_code','year','value']];
  APP.wbFiltered.forEach(r => rows.push([
    `"${r.country.replace(/"/g,'""')}"`, `"${r.countryCode}"`,
    `"${r.indicator.replace(/"/g,'""')}"`, `"${r.indicatorCode}"`,
    r.year, r.value
  ]));
  download('wb_filtered.csv', rows.map(r=>r.join(',')).join('\n'), 'text/csv');
  showToast('success','CSV Exported', `${APP.wbFiltered.length.toLocaleString()} rows.`);
}

function exportWorldBankJSON() {
  if (!APP.wbFiltered.length) { showToast('error','Export Failed','No data to export'); return; }
  const m = computeWorldBankMetrics(APP.wbFiltered, APP.wbGlobalMetrics.missingRate);
  const selInd = document.getElementById('wb-filter-indicator').value;
  const activeInd = selInd !== 'ALL' ? selInd : (m.indicators[0] || '');

  // Top 10 countries latest year
  const latestYear = m.maxYear;
  const subset = APP.wbFiltered.filter(r => r.year === latestYear && r.indicator === activeInd);
  const byC = {};
  subset.forEach(r => { if (!byC[r.country]) byC[r.country] = []; byC[r.country].push(r.value); });
  const topCountries = Object.entries(byC).map(([c,v])=>({country:c,avg:mean(v)})).sort((a,b)=>b.avg-a.avg).slice(0,10);

  const byYear = {};
  APP.wbFiltered.filter(r => r.indicator === activeInd).forEach(r => {
    if (!byYear[r.year]) byYear[r.year] = []; byYear[r.year].push(r.value);
  });
  const trendData = Object.keys(byYear).map(Number).sort((a,b)=>a-b).map(y => ({ year: y, avg: mean(byYear[y]) }));

  const summary = {
    generated_at: new Date().toISOString(),
    active_indicator: activeInd,
    kpi: { total_records: m.total, num_countries: m.numCountries, num_indicators: m.numIndicators, year_range: `${m.minYear}-${m.maxYear}`, missing_rate: m.missingRate + '%' },
    top_countries_latest_year: topCountries,
    global_trend: trendData
  };
  download('wb_summary.json', JSON.stringify(summary, null, 2), 'application/json');
  showToast('success','JSON Exported','Summary downloaded.');
}

// ================================================================
//  MAIN INIT
// ================================================================
function showDashboard(mode) {
  document.getElementById('upload-section').style.display = 'none';
  document.getElementById('dashboard-text').style.display = mode === 'text' ? 'block' : 'none';
  document.getElementById('dashboard-wb').style.display = mode === 'worldbank' ? 'block' : 'none';
  document.getElementById('logo-sub-text').textContent =
    mode === 'text' ? 'Text Reviews Mode' : 'World Bank WDI Mode';
}

function resetToUpload() {
  // Destroy all charts
  Object.keys(APP.charts).forEach(id => destroyChart(id));
  APP.mode = null; APP.rawData = []; APP.filtered = [];
  APP.wbRawLong = []; APP.wbFiltered = [];
  document.getElementById('upload-section').style.display = 'flex';
  document.getElementById('dashboard-text').style.display = 'none';
  document.getElementById('dashboard-wb').style.display = 'none';
  document.getElementById('progress-wrap').style.display = 'none';
  document.getElementById('file-name-display').textContent = 'Choose CSV File';
  document.getElementById('load-btn').disabled = true;
  document.getElementById('csv-input').value = '';
  setStatus('idle', 'Awaiting Data');
  document.getElementById('logo-sub-text').textContent = 'Intelligence Platform';
}

document.addEventListener('DOMContentLoaded', () => {
  const csvInput = document.getElementById('csv-input');
  const loadBtn  = document.getElementById('load-btn');

  let selectedFile = null;

  csvInput.addEventListener('change', e => {
    selectedFile = e.target.files[0];
    if (selectedFile) { document.getElementById('file-name-display').textContent = selectedFile.name; loadBtn.disabled = false; }
  });

  // Reload buttons
  document.getElementById('text-reload-btn').addEventListener('click', resetToUpload);
  document.getElementById('wb-reload-btn').addEventListener('click', resetToUpload);

  // ---- LOAD BUTTON ----
  loadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    loadBtn.disabled = true;
    setStatus('loading', 'Parsing...');
    document.getElementById('progress-wrap').style.display = 'block';
    setProgress(10, 'Reading file...');

    try {
      const text = await selectedFile.text();
      setProgress(25, 'Detecting schema...');
      await new Promise(r => setTimeout(r, 30));

      // Quick schema detection pass
      const sniffResult = await new Promise(res => {
        Papa.parse(text.slice(0, 8000), { header: true, skipEmptyLines: true, transformHeader: h => h.trim(), complete: res });
      });
      const schema = detectSchema(sniffResult);

      if (schema === 'empty') throw 'File appears to be empty.';
      if (schema === 'unknown') throw 'Unsupported CSV format. Expected "class,text" (Reviews) or World Bank WDI columns.';

      setProgress(40, `Schema detected: ${schema === 'text' ? 'Text Reviews' : 'World Bank WDI'}`);
      await new Promise(r => setTimeout(r, 40));
      APP.mode = schema;

      // ---- TEXT MODE ----
      if (schema === 'text') {
        const data = await parseTextData(text);
        setProgress(65, 'Computing metrics...'); await new Promise(r => setTimeout(r, 40));
        APP.rawData = data; APP.filtered = [...data];
        const metrics = computeMetrics(data);
        APP.globalMetrics = metrics;
        setProgress(80, 'Setting up UI...'); await new Promise(r => setTimeout(r, 30));
        setupTextFilterUI(metrics);
        renderKPIs(metrics); renderCharts(metrics); renderTopTerms(data); renderTable(); generateInsights(metrics, data);
        setProgress(100, 'Done!'); await new Promise(r => setTimeout(r, 250));
        showDashboard('text');
        setStatus('active', `${data.length.toLocaleString()} Reviews Loaded`);
        showToast('success','Data Loaded',`${data.length.toLocaleString()} reviews across ${metrics.numClasses} classes.`);

      // ---- WORLD BANK MODE ----
      } else {
        setProgress(45, 'Melting wide→long format...');
        const { longData, missingRate } = await parseWorldBank(text);
        setProgress(70, 'Computing WB metrics...'); await new Promise(r => setTimeout(r, 40));
        APP.wbRawLong = longData; APP.wbFiltered = [...longData];
        const meta = computeWorldBankMetrics(longData, missingRate);
        APP.wbGlobalMetrics = meta;
        setProgress(82, 'Setting up WB UI...'); await new Promise(r => setTimeout(r, 30));
        setupWorldBankFilterUI(meta);
        renderWorldBankKPIs(meta);
        renderWorldBankCharts(meta, longData);
        renderWorldBankTable();
        generateWBInsights(meta, longData);
        setProgress(100, 'Done!'); await new Promise(r => setTimeout(r, 250));
        showDashboard('worldbank');
        setStatus('active', `${longData.length.toLocaleString()} WB Records`);
        showToast('success','World Bank Data Loaded',`${longData.length.toLocaleString()} records, ${meta.numCountries} countries, ${meta.numIndicators} indicators.`);
      }

    } catch (err) {
      setStatus('idle', 'Error');
      document.getElementById('progress-wrap').style.display = 'none';
      loadBtn.disabled = false;
      showToast('error','Load Failed', String(err));
    }
  });

  // ---- TEXT FILTER LISTENERS ----
  let ftTimer;
  const debounceText = () => { clearTimeout(ftTimer); ftTimer = setTimeout(applyFilters, 200); };
  document.getElementById('filter-class').addEventListener('change', applyFilters);
  document.getElementById('filter-search').addEventListener('input', debounceText);
  document.getElementById('wc-min').addEventListener('input', () => { updateTextRangeLabels(); debounceText(); });
  document.getElementById('wc-max').addEventListener('input', () => { updateTextRangeLabels(); debounceText(); });
  document.getElementById('sent-min').addEventListener('input', () => { updateTextRangeLabels(); debounceText(); });
  document.getElementById('sent-max').addEventListener('input', () => { updateTextRangeLabels(); debounceText(); });
  document.getElementById('reset-filters-btn').addEventListener('click', () => {
    document.getElementById('filter-class').value = 'ALL';
    document.getElementById('filter-search').value = '';
    if (APP.globalMetrics) {
      const m = APP.globalMetrics;
      document.getElementById('wc-min').value = m.wcMin;
      document.getElementById('wc-max').value = m.wcMax;
      document.getElementById('sent-min').value = document.getElementById('sent-min').min;
      document.getElementById('sent-max').value = document.getElementById('sent-max').max;
      updateTextRangeLabels();
    }
    applyFilters();
  });
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('export-json-btn').addEventListener('click', exportJSON);

  // ---- WORLD BANK FILTER LISTENERS ----
  let wbTimer;
  const debounceWB = () => { clearTimeout(wbTimer); wbTimer = setTimeout(applyWorldBankFilters, 250); };
  document.getElementById('wb-filter-indicator').addEventListener('change', applyWorldBankFilters);
  document.getElementById('wb-filter-country').addEventListener('change', applyWorldBankFilters);
  document.getElementById('wb-year-min').addEventListener('input', () => { updateWBYearLabel(); debounceWB(); });
  document.getElementById('wb-year-max').addEventListener('input', () => { updateWBYearLabel(); debounceWB(); });
  document.getElementById('wb-all-years').addEventListener('change', e => {
    APP.wbAllYears = e.target.checked;
    if (APP.mode === 'worldbank') {
      showToast('info','Reloading','Re-parsing with updated year range...');
      resetToUpload();
    }
  });
  document.getElementById('wb-reset-btn').addEventListener('click', () => {
    document.getElementById('wb-filter-indicator').value = 'ALL';
    document.getElementById('wb-filter-country').value = 'ALL';
    if (APP.wbGlobalMetrics) {
      document.getElementById('wb-year-min').value = APP.wbGlobalMetrics.minYear;
      document.getElementById('wb-year-max').value = APP.wbGlobalMetrics.maxYear;
      updateWBYearLabel();
    }
    applyWorldBankFilters();
  });
  document.getElementById('wb-export-csv-btn').addEventListener('click', exportWorldBankCSV);
  document.getElementById('wb-export-json-btn').addEventListener('click', exportWorldBankJSON);
});