/* =============================================================
   NEXUS ANALYTICS v3 — Universal CSV Dashboard Engine
   Auto schema detection + Generic mode + Special modes
   ============================================================= */

// ===================== GLOBAL STATE =====================
const APP = {
  raw: [],           // full parsed rows (object array), max 100k
  filtered: [],      // after filters applied
  schema: null,      // { columns: [{name, type, uniques, missing, sample}] }
  mode: 'generic',   // 'generic' | 'text_reviews' | 'world_bank'
  page: 1, pageSize: 15,
  sortCol: null, sortDir: 1,
  visibleCols: [],
  filters: {},       // { colName: value/range }
  charts: {},        // chart instances keyed by id
  wbLong: [],        // World Bank long format
  wbFiltered: [],
  wbPage: 1,
  totalRows: 0,      // including truncated
  truncated: false
};

// ===================== CONSTANTS =====================
const MAX_ROWS = 100000;
const SAMPLE_N = 100000;
const DATE_FORMATS = [
  /^\d{4}-\d{2}-\d{2}/,   // YYYY-MM-DD
  /^\d{2}\/\d{2}\/\d{4}/,  // DD/MM/YYYY or MM/DD/YYYY
  /^\d{2}-\d{2}-\d{4}/,
  /^\d{4}\/\d{2}\/\d{2}/,
  /^\d{4}$/,               // just a year
  /^\d{4}-\d{2}$/          // YYYY-MM
];

// ===================== SENTIMENT LEXICON =====================
const POS = new Set(['good','great','excellent','amazing','wonderful','fantastic','outstanding','superb','brilliant','awesome','perfect','love','best','beautiful','nice','happy','pleased','satisfied','impressive','delightful','positive','enjoy','enjoyed','helpful','reliable','efficient','effective','quality','comfortable','convenient','clean','friendly','fast','quick','easy','smooth','safe','secure','affordable','worth','glad','thankful','grateful','exceptional','terrific','incredible','fabulous','stunning','innovative','smart','professional','courteous','pleasant','polite','honest','fair','trustworthy','consistent','dependable','robust','stylish','elegant','modern','fresh']);
const NEG = new Set(['bad','terrible','awful','horrible','poor','worst','hate','ugly','sad','disappointed','disappointing','unhappy','dissatisfied','frustrating','frustrated','annoying','annoyed','broken','defective','faulty','damaged','overpriced','expensive','slow','difficult','complicated','confusing','misleading','unreliable','inconsistent','unprofessional','rude','unfriendly','dishonest','fake','scam','fraud','waste','useless','pointless','ineffective','inefficient','uncomfortable','dangerous','unsafe','dirty','messy','noisy','stressful','painful','dreadful','inferior','mediocre','subpar','inadequate','unacceptable','unsatisfactory','regret','avoid','problem','issue','error','bug','crash','fail','failed','failure','wrong','incorrect','deceptive','false','negative','reject']);

const STOPWORDS = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','by','from','up','about','into','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','can','it','its','this','that','these','those','i','me','my','we','our','you','your','he','him','his','she','her','they','them','their','what','which','who','when','where','why','how','all','each','every','no','not','only','so','than','too','very','just','also','us','like','just','after','before','between','against','never','always','often','sometimes','get','got','go','make','made','know','think','take','see','look','want','give','use','find','tell','ask','feel','try','keep','put','come','came','said','say']);

// ===================== UTILS =====================
function mean(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  const m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x=>(x-m)**2)));
}
function pearson(xs, ys) {
  const n=xs.length; if(!n) return 0;
  const mx=mean(xs),my=mean(ys);
  const num=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
  const d=Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));
  return d===0 ? 0 : num/d;
}
function sample(arr, n) {
  if (arr.length <= n) return arr;
  const step = Math.floor(arr.length/n);
  return arr.filter((_,i) => i%step===0).slice(0,n);
}
function tokenize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(t=>t.length>1);
}
function sentiment(tokens) {
  let p=0,n=0; tokens.forEach(t=>{if(POS.has(t))p++;if(NEG.has(t))n++;});
  return (p-n)/Math.max(1,tokens.length);
}
function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtNum(n) {
  if(Math.abs(n)>=1e6) return (n/1e6).toFixed(1)+'M';
  if(Math.abs(n)>=1000) return (n/1000).toFixed(1)+'k';
  return Number(n).toFixed(2).replace(/\.?0+$/,'');
}
function download(name, content, mime) {
  const b=new Blob([content],{type:mime}), u=URL.createObjectURL(b);
  const a=document.createElement('a'); a.href=u; a.download=name; a.click(); URL.revokeObjectURL(u);
}
function isDateStr(v) {
  const s = String(v).trim();
  return DATE_FORMATS.some(re=>re.test(s)) && !isNaN(Date.parse(s.length===4 ? s+'-01-01' : s));
}
function parseDate(v) {
  const s=String(v).trim();
  if(/^\d{4}$/.test(s)) return new Date(parseInt(s),0,1);
  return new Date(s);
}
function getColor(i, alpha=0.75) {
  const p=[`rgba(0,240,255,${alpha})`,`rgba(168,85,247,${alpha})`,`rgba(244,114,182,${alpha})`,`rgba(0,255,170,${alpha})`,`rgba(251,191,36,${alpha})`,`rgba(249,115,22,${alpha})`,`rgba(99,102,241,${alpha})`,`rgba(20,184,166,${alpha})`,`rgba(236,72,153,${alpha})`,`rgba(132,204,22,${alpha})`];
  return p[i%p.length];
}

// ===================== TOAST / STATUS / PROGRESS =====================
function toast(type, title, msg) {
  const tc=document.getElementById('toast-container');
  const icon=type==='error'?'⚠':type==='success'?'✓':'ℹ';
  const el=document.createElement('div'); el.className=`toast ${type}`;
  el.innerHTML=`<span class="toast-icon">${icon}</span><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div>`;
  tc.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(16px)';el.style.transition='.3s';setTimeout(()=>el.remove(),300);},3500);
}
function setStatus(state, text) {
  document.getElementById('status-dot').className='status-dot '+state;
  document.getElementById('status-text').textContent=text;
}
function setProgress(pct, label) {
  document.getElementById('progress-fill').style.width=pct+'%';
  document.getElementById('progress-label').textContent=label;
}
function destroyChart(id) { if(APP.charts[id]){APP.charts[id].destroy();delete APP.charts[id];} }


// ===================== SCHEMA INFERENCE =====================
function inferColumnTypes(data) {
  if (!data.length) return [];
  const sdata = sample(data, SAMPLE_N);
  const cols = Object.keys(data[0]);
  const totalRows = data.length;

  return cols.map(name => {
    const vals = sdata.map(r => r[name]).filter(v => v !== null && v !== undefined && v !== '');
    const total = sdata.length;
    const missing = sdata.filter(r => r[name]===null||r[name]===undefined||r[name]==='').length;
    const missingPct = missing/total;

    if (!vals.length) return { name, type:'empty', missing:1, uniques:0, sample:[] };

    // numeric test
    const numericCount = vals.filter(v => !isNaN(parseFloat(v)) && isFinite(v)).length;
    const numericRatio = numericCount / vals.length;

    // date test
    const dateCount = vals.filter(v => isDateStr(v)).length;
    const dateRatio = dateCount / vals.length;

    // uniques
    const uniqSet = new Set(vals.map(v=>String(v).trim()));
    const uniqRatio = uniqSet.size / totalRows;
    const uniqCount = uniqSet.size;

    // avg length
    const avgLen = mean(vals.map(v=>String(v).length));
    const wordCount = mean(vals.map(v=>String(v).trim().split(/\s+/).length));

    let type;

    // year-column detection (World Bank pattern: col name is 4-digit year)
    if (/^\d{4}$/.test(name.trim()) && numericRatio >= 0.5) {
      type = 'year_col';
    } else if (numericRatio >= 0.70) {
      type = 'numeric';
    } else if (dateRatio >= 0.60) {
      type = 'date';
    } else if (avgLen > 20 && wordCount > 3) {
      type = 'text';
    } else if (uniqRatio > 0.95 && numericRatio < 0.7) {
      type = 'id';
    } else if (uniqCount <= Math.min(50, 0.2 * totalRows)) {
      type = 'categorical';
    } else {
      type = 'text';
    }

    const numVals = type==='numeric' ? vals.map(v=>parseFloat(v)).filter(v=>!isNaN(v)) : [];

    return {
      name, type, missing: missingPct,
      uniques: uniqCount,
      sample: vals.slice(0,5),
      numMin: numVals.length ? Math.min(...numVals) : null,
      numMax: numVals.length ? Math.max(...numVals) : null,
      numMean: numVals.length ? mean(numVals) : null,
      topValues: type==='categorical' ? getTopValues(sdata, name, 15) : []
    };
  });
}

function getTopValues(data, col, n) {
  const freq = {};
  data.forEach(r => { const v=String(r[col]||'').trim(); if(v) freq[v]=(freq[v]||0)+1; });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

function detectSpecialMode(schema) {
  const names = schema.map(c=>c.name.trim().toLowerCase());
  // World Bank: Country Name + Indicator Name + year columns
  const hasCountryName = names.some(n=>n==='country name');
  const hasIndicatorName = names.some(n=>n==='indicator name');
  const hasYearCols = schema.some(c=>c.type==='year_col');
  if (hasCountryName && hasIndicatorName && hasYearCols) return 'world_bank';

  // Text Reviews: at least one text col + one categorical col (2-30 uniques)
  const textCols = schema.filter(c=>c.type==='text');
  const catCols = schema.filter(c=>c.type==='categorical' && c.uniques>=2 && c.uniques<=30);
  if (textCols.length>=1 && catCols.length>=1) return 'text_reviews';

  return 'generic';
}


// ===================== KPI RENDER =====================
function renderKPIs(data, schema) {
  const numCols = schema.filter(c=>c.type==='numeric').length;
  const catCols = schema.filter(c=>c.type==='categorical').length;
  const dateCols = schema.filter(c=>c.type==='date').length;
  const textCols = schema.filter(c=>c.type==='text').length;
  const totalCells = data.length * schema.length;
  const missingCells = schema.reduce((s,c)=>s+Math.round(c.missing*data.length),0);
  const missingPct = totalCells ? ((missingCells/totalCells)*100).toFixed(1) : '0';

  const kpis = [
    {icon:'⬡', val: data.length.toLocaleString(), label:'Rows (filtered)', cls:''},
    {icon:'◈', val: schema.length, label:'Columns', cls:''},
    {icon:'◻', val: missingPct+'%', label:'Missing Values', cls:'kv-w'},
    {icon:'◇', val: numCols, label:'Numeric Cols', cls:'kv-g'},
    {icon:'○', val: catCols, label:'Categorical Cols', cls:'kv-p'},
    {icon:'★', val: dateCols, label:'Date Cols', cls:''},
    {icon:'◎', val: textCols, label:'Text Cols', cls:''},
  ];

  document.getElementById('kpi-grid').innerHTML = kpis.map((k,i) =>
    `<div class="kpi-card glass-card" style="animation-delay:${i*0.04}s">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-value ${k.cls}">${k.val}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');
}

// ===================== FILTER UI =====================
function buildFilterUI(schema) {
  const grid = document.getElementById('dynamic-filters');
  grid.innerHTML = '';
  APP.filters = {};

  const catCols = schema.filter(c=>c.type==='categorical');
  const numCols = schema.filter(c=>c.type==='numeric');
  const dateCols = schema.filter(c=>c.type==='date');

  catCols.forEach(col => {
    APP.filters[col.name] = 'ALL';
    const div = document.createElement('div');
    div.className = 'filter-item';
    const topVals = col.topValues.slice(0,30);
    div.innerHTML = `<label class="filter-label">${escH(col.name)}</label>
      <select class="filter-select" data-col="${escH(col.name)}" data-type="cat">
        <option value="ALL">All</option>
        ${topVals.map(([v])=>`<option value="${escH(v)}">${escH(v)}</option>`).join('')}
      </select>`;
    grid.appendChild(div);
    div.querySelector('select').addEventListener('change', e => {
      APP.filters[col.name] = e.target.value; debounceFilter();
    });
  });

  numCols.forEach(col => {
    if (col.numMin === null) return;
    const mn = Math.floor(col.numMin), mx = Math.ceil(col.numMax);
    APP.filters[col.name] = {min:mn, max:mx};
    const div = document.createElement('div');
    div.className = 'filter-item';
    div.innerHTML = `<label class="filter-label">${escH(col.name)}: <span id="fl-${escH(col.name)}">${fmtNum(mn)} – ${fmtNum(mx)}</span></label>
      <div class="range-wrap">
        <input type="range" class="range-slider" data-col="${escH(col.name)}" data-which="min" min="${mn}" max="${mx}" value="${mn}"/>
        <input type="range" class="range-slider" data-col="${escH(col.name)}" data-which="max" min="${mn}" max="${mx}" value="${mx}"/>
      </div>`;
    grid.appendChild(div);
    div.querySelectorAll('.range-slider').forEach(sl => {
      sl.addEventListener('input', () => {
        const minV = parseFloat(div.querySelector('[data-which="min"]').value);
        const maxV = parseFloat(div.querySelector('[data-which="max"]').value);
        APP.filters[col.name] = {min:minV, max:maxV};
        document.getElementById('fl-'+col.name).textContent = `${fmtNum(minV)} – ${fmtNum(maxV)}`;
        debounceFilter();
      });
    });
  });

  if (!catCols.length && !numCols.length && !dateCols.length) {
    grid.innerHTML = '<div style="color:var(--t3);font-size:.78rem;padding:.5rem 0;">No filterable columns detected.</div>';
  }
}

function resetFilters(schema) {
  document.getElementById('global-search').value = '';
  APP.filters = {};
  schema.forEach(col => {
    if (col.type === 'categorical') {
      APP.filters[col.name] = 'ALL';
      const el = document.querySelector(`select[data-col="${CSS.escape(col.name)}"]`);
      if (el) el.value = 'ALL';
    }
    if (col.type === 'numeric' && col.numMin !== null) {
      APP.filters[col.name] = {min:Math.floor(col.numMin), max:Math.ceil(col.numMax)};
      const minEl = document.querySelector(`input[data-col="${CSS.escape(col.name)}"][data-which="min"]`);
      const maxEl = document.querySelector(`input[data-col="${CSS.escape(col.name)}"][data-which="max"]`);
      if (minEl) minEl.value = Math.floor(col.numMin);
      if (maxEl) maxEl.value = Math.ceil(col.numMax);
      const lbl = document.getElementById('fl-'+col.name);
      if (lbl) lbl.textContent = `${fmtNum(col.numMin)} – ${fmtNum(col.numMax)}`;
    }
  });
  applyFilters();
}

let filterTimer;
function debounceFilter() { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilters, 220); }

function applyFilters() {
  const kw = document.getElementById('global-search').value.trim().toLowerCase();
  const schema = APP.schema;

  APP.filtered = APP.raw.filter(row => {
    // categorical filters
    for (const col of schema.filter(c=>c.type==='categorical')) {
      const fv = APP.filters[col.name];
      if (fv && fv !== 'ALL' && String(row[col.name]||'').trim() !== fv) return false;
    }
    // numeric range filters
    for (const col of schema.filter(c=>c.type==='numeric')) {
      const fr = APP.filters[col.name];
      if (fr) {
        const v = parseFloat(row[col.name]);
        if (!isNaN(v) && (v < fr.min || v > fr.max)) return false;
      }
    }
    // global search
    if (kw) {
      const allVals = Object.values(row).join(' ').toLowerCase();
      if (!allVals.includes(kw)) return false;
    }
    return true;
  });

  APP.page = 1;
  renderAll();
}


// ===================== CHARTS =====================
const CD = { font:{family:'Syne,sans-serif',size:10}, tick:{color:'#445577'}, grid:{color:'rgba(255,255,255,0.045)'} };

function renderCharts(data, schema) {
  const grid = document.getElementById('charts-grid');
  grid.innerHTML = '';
  destroyAllCharts();

  const catCols = schema.filter(c=>c.type==='categorical' && c.uniques>=2 && c.uniques<=50).sort((a,b)=>a.uniques-b.uniques);
  const numCols = schema.filter(c=>c.type==='numeric').sort((a,b)=>a.missing-b.missing);
  const dateCols = schema.filter(c=>c.type==='date').sort((a,b)=>a.missing-b.missing);

  // A) Categorical bar chart (best col: 2-20 uniques)
  const bestCat = catCols.find(c=>c.uniques>=2&&c.uniques<=20) || catCols[0];
  if (bestCat) {
    addChart(grid,'cat-dist',`${bestCat.name} — Distribution`);
    renderCatDist(data, bestCat.name, 'cat-dist');
  }

  // B) Numeric histogram (best 1-2)
  const histCols = numCols.slice(0,2);
  histCols.forEach((col,i) => {
    addChart(grid,'hist-'+i,`${col.name} — Histogram`);
    renderHistogram(data, col.name, 'hist-'+i);
  });

  // C) Date + numeric time series OR date frequency
  if (dateCols.length) {
    const dc = dateCols[0];
    const nc = numCols[0];
    addChart(grid,'date-chart', nc ? `${nc.name} over time (${dc.name})` : `${dc.name} — Frequency`,'chart-wide');
    if (nc) renderTimeSeries(data, dc.name, nc.name, 'date-chart');
    else renderDateFreq(data, dc.name, 'date-chart');
  }

  // D) Min/Avg/Max bar (if numeric cols exist)
  if (numCols.length >= 1 && !dateCols.length) {
    const col = numCols[0];
    addChart(grid,'minmaxavg',`${col.name} — Range Summary`);
    renderMinMaxAvg(data, col.name, 'minmaxavg', schema, catCols);
  }
}

function addChart(grid, id, title, extraClass='') {
  const card = document.createElement('div');
  card.className = 'chart-card glass-card ' + extraClass;
  card.innerHTML = `<div class="chart-title">${escH(title)}</div><div class="chart-wrap"><canvas id="${id}"></canvas></div>`;
  grid.appendChild(card);
}

function renderCatDist(data, colName, canvasId) {
  destroyChart(canvasId);
  const freq = {};
  data.forEach(r => { const v=String(r[colName]||'').trim(); if(v) freq[v]=(freq[v]||0)+1; });
  const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  APP.charts[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{labels:sorted.map(([k])=>k), datasets:[{data:sorted.map(([,v])=>v),backgroundColor:sorted.map((_,i)=>getColor(i)),borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxRotation:35},grid:{color:CD.grid.color}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}
  });
}

function renderHistogram(data, colName, canvasId) {
  destroyChart(canvasId);
  const vals = data.map(r=>parseFloat(r[colName])).filter(v=>!isNaN(v));
  if (!vals.length) return;
  const bins=20, mn=Math.min(...vals), mx=Math.max(...vals), step=(mx-mn)/bins||1;
  const counts=new Array(bins).fill(0);
  vals.forEach(v=>{let b=Math.floor((v-mn)/step);if(b>=bins)b=bins-1;counts[b]++;});
  const labels=Array.from({length:bins},(_,i)=>(mn+i*step).toFixed(1));
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  APP.charts[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{labels,datasets:[{data:counts,backgroundColor:'rgba(0,240,255,0.4)',borderRadius:2,barPercentage:.95,categoryPercentage:1}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxTicksLimit:8},grid:{display:false}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}
  });
}

function renderTimeSeries(data, dateColin, numColin, canvasId) {
  destroyChart(canvasId);
  const byMonth = {};
  data.forEach(r => {
    const d = parseDate(r[dateColin]);
    if (isNaN(d.getTime())) return;
    const key = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    if (!byMonth[key]) byMonth[key]=[];
    const v=parseFloat(r[numColin]);
    if (!isNaN(v)) byMonth[key].push(v);
  });
  const sorted = Object.keys(byMonth).sort();
  if (!sorted.length) return;
  const avgs = sorted.map(k=>mean(byMonth[k]));
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  APP.charts[canvasId] = new Chart(ctx, {
    type:'line',
    data:{labels:sorted,datasets:[{label:'Avg '+numColin,data:avgs,borderColor:'rgba(0,240,255,.85)',backgroundColor:'rgba(0,240,255,.06)',fill:true,tension:.3,pointRadius:1.5,pointBackgroundColor:'rgba(0,240,255,.9)'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:CD.tick.color,font:CD.font}}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxTicksLimit:10},grid:{color:CD.grid.color}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}
  });
}

function renderDateFreq(data, dateColin, canvasId) {
  destroyChart(canvasId);
  const byMonth={};
  data.forEach(r=>{
    const d=parseDate(r[dateColin]);
    if(isNaN(d.getTime()))return;
    const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    byMonth[k]=(byMonth[k]||0)+1;
  });
  const sorted=Object.keys(byMonth).sort();
  const ctx=document.getElementById(canvasId)?.getContext('2d');
  if(!ctx)return;
  APP.charts[canvasId]=new Chart(ctx,{
    type:'bar',
    data:{labels:sorted,datasets:[{data:sorted.map(k=>byMonth[k]),backgroundColor:'rgba(168,85,247,.5)',borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxTicksLimit:10},grid:{display:false}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}
  });
}

function renderMinMaxAvg(data, colName, canvasId, schema, catCols) {
  destroyChart(canvasId);
  // if there's a best categorical col, group by it; otherwise show single bar
  const gc = catCols.find(c=>c.uniques>=2&&c.uniques<=20);
  const ctx=document.getElementById(canvasId)?.getContext('2d');
  if(!ctx)return;

  if (gc) {
    const groups={};
    data.forEach(r=>{
      const g=String(r[gc.name]||'Other').trim();
      const v=parseFloat(r[colName]);
      if(!isNaN(v)){if(!groups[g])groups[g]=[];groups[g].push(v);}
    });
    const labels=Object.keys(groups).slice(0,10);
    const avgs=labels.map(g=>mean(groups[g]));
    const mins=labels.map(g=>Math.min(...groups[g]));
    const maxs=labels.map(g=>Math.max(...groups[g]));
    APP.charts[canvasId]=new Chart(ctx,{
      type:'bar',
      data:{labels,datasets:[
        {label:'Avg',data:avgs,backgroundColor:labels.map((_,i)=>getColor(i,.7)),borderRadius:4,order:1},
        {label:'Min',data:mins,type:'line',borderColor:'rgba(0,255,170,.5)',backgroundColor:'transparent',pointRadius:3,borderDash:[4,2],order:0},
        {label:'Max',data:maxs,type:'line',borderColor:'rgba(244,114,182,.5)',backgroundColor:'transparent',pointRadius:3,borderDash:[4,2],order:0}
      ]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:CD.tick.color,font:CD.font,boxWidth:10}}},
        scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxRotation:35},grid:{color:CD.grid.color}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}
    });
  } else {
    const vals=data.map(r=>parseFloat(r[colName])).filter(v=>!isNaN(v));
    if(!vals.length)return;
    APP.charts[canvasId]=new Chart(ctx,{
      type:'bar',
      data:{labels:['Min','Mean','Median','Max'],datasets:[{data:[Math.min(...vals),mean(vals),median(vals),Math.max(...vals)],backgroundColor:['rgba(0,240,255,.5)','rgba(0,255,170,.5)','rgba(168,85,247,.5)','rgba(244,114,182,.5)'],borderRadius:4}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
        scales:{x:{ticks:{color:CD.tick.color,font:CD.font}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}
    });
  }
}

function destroyAllCharts() {
  Object.keys(APP.charts).forEach(id=>destroyChart(id));
}


// ===================== CORRELATION MATRIX =====================
function renderCorrelation(data, schema) {
  const numCols = schema.filter(c=>c.type==='numeric').sort((a,b)=>a.missing-b.missing).slice(0,6);
  const sec = document.getElementById('corr-section');
  if (numCols.length < 2) { sec.style.display='none'; return; }
  sec.style.display='block';

  const names = numCols.map(c=>c.name);
  const matrix = names.map(a => names.map(b => {
    const xs=[], ys=[];
    data.forEach(r=>{const x=parseFloat(r[a]),y=parseFloat(r[b]);if(!isNaN(x)&&!isNaN(y)){xs.push(x);ys.push(y);}});
    return xs.length > 5 ? pearson(xs,ys) : null;
  }));

  const corrColor = v => {
    if (v === null) return '#1a2040';
    const abs = Math.abs(v);
    if (v > 0) return `rgba(0,240,255,${0.15+abs*0.7})`;
    return `rgba(244,114,182,${0.15+abs*0.7})`;
  };

  let html = `<table class="corr-table"><thead><tr><th></th>${names.map(n=>`<th title="${escH(n)}">${escH(n.slice(0,10)+'...')}</th>`).join('')}</tr></thead><tbody>`;
  matrix.forEach((row,i)=>{
    html+=`<tr><th style="text-align:right;padding-right:.6rem;">${escH(names[i].slice(0,12))}</th>`;
    row.forEach((v,j)=>{
      const disp = v===null?'—':(v===1?'1.00':v.toFixed(2));
      html+=`<td><div class="corr-cell" style="background:${corrColor(v)};color:${v&&Math.abs(v)>.5?'var(--t1)':'var(--t2)'};">${disp}</div></td>`;
    });
    html+='</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('corr-matrix').innerHTML = html;
}

// ===================== INSIGHTS =====================
function generateInsights(data, schema, filtered) {
  const list = document.getElementById('insights-list');
  const ins = [];
  if (!filtered.length) {
    list.innerHTML='<div class="insight-item"><span class="insight-icon">⚡</span><span class="insight-text">No data matches current filters.</span></div>';
    return;
  }

  // Most missing col
  const missCol = schema.filter(c=>c.missing>0).sort((a,b)=>b.missing-a.missing)[0];
  if (missCol) ins.push(`Column <strong>${missCol.name}</strong> has the highest missing rate (${(missCol.missing*100).toFixed(1)}%).`);

  // Largest category
  const catCols = schema.filter(c=>c.type==='categorical');
  if (catCols.length) {
    const bc = catCols.find(c=>c.uniques>=2&&c.uniques<=20)||catCols[0];
    const freq={};
    filtered.forEach(r=>{const v=String(r[bc.name]||'').trim();if(v)freq[v]=(freq[v]||0)+1;});
    const top=Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];
    if(top) ins.push(`The most common <strong>${bc.name}</strong> is <strong>${top[0]}</strong> with ${top[1].toLocaleString()} records (${((top[1]/filtered.length)*100).toFixed(1)}%).`);
  }

  // Outlier hint
  const numCols = schema.filter(c=>c.type==='numeric');
  if (numCols.length) {
    const col=numCols[0];
    const vals=filtered.map(r=>parseFloat(r[col.name])).filter(v=>!isNaN(v));
    if(vals.length){
      const m=mean(vals),sd=stddev(vals),mx=Math.max(...vals);
      if(sd>0&&mx>m+3*sd) ins.push(`<strong>${col.name}</strong> may have outliers — max value ${fmtNum(mx)} is ${((mx-m)/sd).toFixed(1)}σ above the mean (${fmtNum(m)}).`);
      else ins.push(`<strong>${col.name}</strong>: mean=${fmtNum(m)}, median=${fmtNum(median(vals))}, max=${fmtNum(mx)}.`);
    }
  }

  // Date range
  const dateCols = schema.filter(c=>c.type==='date');
  if (dateCols.length) {
    const dc=dateCols[0];
    const dates=filtered.map(r=>parseDate(r[dc.name])).filter(d=>!isNaN(d.getTime())).sort((a,b)=>a-b);
    if(dates.length>=2) ins.push(`Date column <strong>${dc.name}</strong> spans from <strong>${dates[0].toLocaleDateString()}</strong> to <strong>${dates[dates.length-1].toLocaleDateString()}</strong>.`);
  }

  // Correlation
  const nc=numCols.slice(0,6);
  if(nc.length>=2){
    let bestR=0,bestPair=null;
    for(let i=0;i<nc.length;i++)for(let j=i+1;j<nc.length;j++){
      const xs=[],ys=[];
      filtered.forEach(r=>{const x=parseFloat(r[nc[i].name]),y=parseFloat(r[nc[j].name]);if(!isNaN(x)&&!isNaN(y)){xs.push(x);ys.push(y);}});
      if(xs.length>5){const r=Math.abs(pearson(xs,ys));if(r>bestR){bestR=r;bestPair=[nc[i].name,nc[j].name];}}
    }
    if(bestPair) ins.push(`Strongest correlation: <strong>${bestPair[0]}</strong> and <strong>${bestPair[1]}</strong> (r = ${bestR.toFixed(3)}).`);
  }

  // Dataset size note
  if (APP.truncated) ins.push(`⚠ Dataset was truncated to <strong>100,000 rows</strong> for performance. Full file had <strong>${APP.totalRows.toLocaleString()}</strong> rows.`);

  list.innerHTML = ins.map(t=>`<div class="insight-item"><span class="insight-icon">◆</span><span class="insight-text">${t}</span></div>`).join('');
}


// ===================== TABLE =====================
function renderTable(data, schema) {
  const cols = schema.filter(c=>APP.visibleCols.includes(c.name));
  const total = data.length;
  document.getElementById('table-count-label').textContent = `${total.toLocaleString()} rows`;

  // Sort
  let sorted = [...data];
  if (APP.sortCol) {
    sorted.sort((a,b)=>{
      const av=a[APP.sortCol]||'',bv=b[APP.sortCol]||'';
      const an=parseFloat(av),bn=parseFloat(bv);
      if(!isNaN(an)&&!isNaN(bn)) return APP.sortDir*(an-bn);
      return APP.sortDir*String(av).localeCompare(String(bv));
    });
  }

  const pages = Math.ceil(total/APP.pageSize);
  const start = (APP.page-1)*APP.pageSize;
  const slice = sorted.slice(start,start+APP.pageSize);

  // Head
  const thead = document.getElementById('table-head');
  thead.innerHTML = '<tr>' + cols.map(c=>{
    const sc = APP.sortCol===c.name ? (APP.sortDir===1?' sort-asc':' sort-desc') : '';
    return `<th class="${sc}" data-col="${escH(c.name)}">${escH(c.name)}</th>`;
  }).join('') + '</tr>';
  thead.querySelectorAll('th').forEach(th=>{
    th.addEventListener('click',()=>{
      if(APP.sortCol===th.dataset.col) APP.sortDir*=-1;
      else { APP.sortCol=th.dataset.col; APP.sortDir=1; }
      renderTable(APP.filtered, APP.schema);
    });
  });

  // Body
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = slice.map(r => '<tr>'+cols.map(c=>{
    const v = r[c.name];
    const disp = v===null||v===undefined||v==='' ? '<span style="color:var(--t3)">—</span>' : escH(String(v).slice(0,80))+(String(v).length>80?'…':'');
    return `<td>${disp}</td>`;
  }).join('')+'</tr>').join('');

  renderPagination('pagination', pages, APP.page, p=>{ APP.page=p; renderTable(APP.filtered, APP.schema); });
}

function renderColToggles(schema) {
  const wrap = document.getElementById('col-toggle-wrap');
  wrap.innerHTML = '';
  APP.visibleCols = schema.filter(c=>c.type!=='id').map(c=>c.name); // default: show non-id
  schema.forEach(col => {
    const btn = document.createElement('button');
    const active = APP.visibleCols.includes(col.name);
    btn.className = 'col-toggle'+(active?' active':'');
    btn.textContent = col.name.slice(0,14);
    btn.title = col.name + ' ('+col.type+')';
    btn.addEventListener('click',()=>{
      if(APP.visibleCols.includes(col.name)) APP.visibleCols=APP.visibleCols.filter(n=>n!==col.name);
      else APP.visibleCols.push(col.name);
      btn.classList.toggle('active');
      renderTable(APP.filtered, APP.schema);
    });
    wrap.appendChild(btn);
  });
}

function renderPagination(elId, pages, current, onPage) {
  const pag = document.getElementById(elId);
  if (!pag) return;
  pag.innerHTML='';
  const show=Math.min(pages,10);
  for(let p=1;p<=show;p++){
    const btn=document.createElement('button');
    btn.className='page-btn'+(p===current?' active':'');
    btn.textContent=p; btn.onclick=()=>onPage(p);
    pag.appendChild(btn);
  }
  if(pages>10){const s=document.createElement('span');s.style.cssText='font-size:.68rem;color:var(--t3);align-self:center;';s.textContent=`…${pages} pages`;pag.appendChild(s);}
}


// ===================== TEXT REVIEWS SPECIAL MODE =====================
function renderTextReviewsPanel(data, schema) {
  const textCol = schema.find(c=>c.type==='text');
  const catCol = schema.find(c=>c.type==='categorical' && c.uniques>=2 && c.uniques<=30);
  if (!textCol || !catCol) return;

  const panel = document.getElementById('special-panel');
  const title = document.getElementById('special-panel-title');
  const content = document.getElementById('special-panel-content');
  panel.style.display='block';
  title.innerHTML='<span class="accent-c">▸</span> Text Reviews Analysis';

  // compute
  const enriched = data.map(r => {
    const tokens = tokenize(r[textCol.name]||'');
    return { ...r, _tokens:tokens, _wc:tokens.length, _sentiment:sentiment(tokens) };
  });

  const categories = [...new Set(enriched.map(r=>r[catCol.name]))].sort();
  const catSentiment = {};
  categories.forEach(c=>{
    const rows=enriched.filter(r=>r[catCol.name]===c);
    catSentiment[c]=mean(rows.map(r=>r._sentiment));
  });

  // word freq
  const wf={},bf={};
  enriched.forEach(r=>{
    const ft=r._tokens.filter(t=>!STOPWORDS.has(t)&&t.length>2);
    ft.forEach(t=>{wf[t]=(wf[t]||0)+1;});
    for(let i=0;i<ft.length-1;i++){const bg=ft[i]+' '+ft[i+1];bf[bg]=(bf[bg]||0)+1;}
  });

  const avgWC = mean(enriched.map(r=>r._wc));
  const avgSent = mean(enriched.map(r=>r._sentiment));

  content.innerHTML=`
  <div class="special-panel-inner">
    <div class="glass-card" style="padding:1rem;text-align:center;">
      <div class="kpi-icon">◎</div>
      <div class="kpi-value" style="font-size:1.3rem;">${avgWC.toFixed(1)}</div>
      <div class="kpi-label">Avg Words / Review</div>
    </div>
    <div class="glass-card" style="padding:1rem;text-align:center;">
      <div class="kpi-icon">★</div>
      <div class="kpi-value" style="font-size:1.3rem;color:${avgSent>0.01?'var(--ag)':avgSent<-0.01?'var(--ar)':'var(--t2)'};">${avgSent.toFixed(4)}</div>
      <div class="kpi-label">Avg Sentiment</div>
    </div>
    <div class="terms-card glass-card"><div class="terms-header">Top 20 Words</div><div id="tr-words" class="terms-list"></div></div>
    <div class="terms-card glass-card"><div class="terms-header">Top 20 Bigrams</div><div id="tr-bigrams" class="terms-list"></div></div>
  </div>
  <div style="margin-top:1.1rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:1.1rem;">
    <div class="chart-card glass-card"><div class="chart-title">Sentiment by ${escH(catCol.name)}</div><div class="chart-wrap"><canvas id="tr-sent-chart"></canvas></div></div>
    <div class="chart-card glass-card"><div class="chart-title">Word Count Distribution</div><div class="chart-wrap"><canvas id="tr-wc-chart"></canvas></div></div>
  </div>`;

  renderTermList2('tr-words',wf,20);
  renderTermList2('tr-bigrams',bf,20);

  // sentiment by category chart
  destroyChart('tr-sent-chart');
  const sentVals=categories.map(c=>catSentiment[c]);
  const sCtx=document.getElementById('tr-sent-chart')?.getContext('2d');
  if(sCtx) APP.charts['tr-sent-chart']=new Chart(sCtx,{type:'bar',
    data:{labels:categories,datasets:[{data:sentVals,backgroundColor:sentVals.map(v=>v>0?'rgba(0,255,170,.6)':'rgba(244,114,182,.6)'),borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxRotation:35},grid:{color:CD.grid.color}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}});

  // WC histogram
  destroyChart('tr-wc-chart');
  const wcs=enriched.map(r=>r._wc);
  const bins=20,mn=Math.min(...wcs),mx=Math.max(...wcs),step=(mx-mn)/bins||1;
  const cnts=new Array(bins).fill(0);
  wcs.forEach(v=>{let b=Math.floor((v-mn)/step);if(b>=bins)b=bins-1;cnts[b]++;});
  const wCtx=document.getElementById('tr-wc-chart')?.getContext('2d');
  if(wCtx) APP.charts['tr-wc-chart']=new Chart(wCtx,{type:'bar',
    data:{labels:Array.from({length:bins},(_,i)=>Math.round(mn+i*step)),datasets:[{data:cnts,backgroundColor:'rgba(168,85,247,.45)',borderRadius:2,barPercentage:.95,categoryPercentage:1}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxTicksLimit:8},grid:{display:false}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}});
}

function renderTermList2(elId, freq, n) {
  const el=document.getElementById(elId); if(!el) return;
  const sorted=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,n);
  if(!sorted.length){el.innerHTML='<span style="color:var(--t3);font-size:.78rem;">No data</span>';return;}
  const mx=sorted[0][1];
  el.innerHTML=sorted.map(([w,c],i)=>`<div class="term-item" style="animation-delay:${i*.025}s">
    <span class="term-rank">${i+1}</span>
    <div class="term-bar-wrap"><div class="term-bar" style="width:${(c/mx*100).toFixed(1)}%"></div></div>
    <span class="term-word">${escH(w)}</span>
    <span class="term-count">${c.toLocaleString()}</span>
  </div>`).join('');
}


// ===================== WORLD BANK SPECIAL MODE =====================
function renderWorldBankPanel(rawData, schema) {
  const panel = document.getElementById('special-panel');
  const title = document.getElementById('special-panel-title');
  const content = document.getElementById('special-panel-content');
  panel.style.display='block';
  title.innerHTML='<span class="accent-p">▸</span> World Bank WDI Analysis';

  // Melt
  const yearCols = schema.filter(c=>c.type==='year_col').map(c=>c.name);
  const DEFAULT_YEAR = APP.wbAllYears ? 0 : 1990;
  const activeYears = yearCols.filter(y=>parseInt(y)>=DEFAULT_YEAR);

  const long=[];
  rawData.forEach(r=>{
    const country=String(r['Country Name']||'').trim();
    const cc=String(r['Country Code']||'').trim();
    const indicator=String(r['Indicator Name']||'').trim();
    const ic=String(r['Indicator Code']||'').trim();
    if(!country||!indicator)return;
    activeYears.forEach(y=>{
      const v=parseFloat(r[y]);
      if(!isNaN(v)) long.push({country,countryCode:cc,indicator,indicatorCode:ic,year:parseInt(y),value:v});
    });
  });

  if(!long.length){content.innerHTML='<div class="glass-card" style="padding:1.5rem;color:var(--t3);">No numeric values found. Try enabling "Include all years".</div>';return;}

  APP.wbLong=long; APP.wbFiltered=[...long];

  const countries=[...new Set(long.map(r=>r.country))].sort();
  const indicators=[...new Set(long.map(r=>r.indicator))].sort();
  const years=[...new Set(long.map(r=>r.year))].sort((a,b)=>a-b);

  content.innerHTML=`
  <div class="filters-card glass-card" style="margin-bottom:1.1rem;">
    <div class="filters-grid">
      <div class="filter-item" style="grid-column:span 2;">
        <label class="filter-label">Indicator</label>
        <select id="wb2-ind" class="filter-select">
          <option value="ALL">All Indicators</option>
          ${indicators.slice(0,200).map(i=>`<option value="${escH(i)}">${escH(i.slice(0,90))}</option>`).join('')}
        </select>
      </div>
      <div class="filter-item">
        <label class="filter-label">Country</label>
        <select id="wb2-country" class="filter-select">
          <option value="ALL">All Countries</option>
          ${countries.slice(0,200).map(c=>`<option value="${escH(c)}">${escH(c)}</option>`).join('')}
        </select>
      </div>
      <div class="filter-item">
        <label class="filter-label">Year Range: <span id="wb2-yr-lbl">${years[0]}–${years[years.length-1]}</span></label>
        <div class="range-wrap">
          <input type="range" id="wb2-yr-min" class="range-slider" min="${years[0]}" max="${years[years.length-1]}" value="${years[0]}"/>
          <input type="range" id="wb2-yr-max" class="range-slider" min="${years[0]}" max="${years[years.length-1]}" value="${years[years.length-1]}"/>
        </div>
      </div>
      <div class="filter-item" style="justify-content:flex-end;">
        <div class="toggle-wrap">
          <label class="toggle-lbl">All years</label>
          <label class="toggle-sw"><input type="checkbox" id="wb2-all-yrs" ${APP.wbAllYears?'checked':''}/><span class="toggle-sl"></span></label>
        </div>
      </div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:1.1rem;" id="wb2-charts"></div>
  <div style="margin-top:1.1rem;">
    <div class="table-card glass-card">
      <div class="table-info">WB Records: <span id="wb2-count">0</span></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Country</th><th>Indicator</th><th>Year</th><th>Value</th></tr></thead>
        <tbody id="wb2-tbody"></tbody>
      </table></div>
      <div class="pagination" id="wb2-pag"></div>
    </div>
  </div>`;

  renderWBCharts2(APP.wbFiltered, years[years.length-1]);
  renderWBTable2();

  // Listeners
  let wbTimer;
  const dWB=()=>{clearTimeout(wbTimer);wbTimer=setTimeout(()=>{applyWBFilters2();},220);};
  document.getElementById('wb2-ind').addEventListener('change',dWB);
  document.getElementById('wb2-country').addEventListener('change',dWB);
  document.getElementById('wb2-yr-min').addEventListener('input',()=>{updateWB2Lbl();dWB();});
  document.getElementById('wb2-yr-max').addEventListener('input',()=>{updateWB2Lbl();dWB();});
  document.getElementById('wb2-all-yrs').addEventListener('change',e=>{APP.wbAllYears=e.target.checked;toast('info','Reloading','Re-parsing with updated year setting…');setTimeout(()=>resetToUpload(),500);});
}

function updateWB2Lbl(){
  const a=document.getElementById('wb2-yr-min')?.value, b=document.getElementById('wb2-yr-max')?.value;
  if(a&&b) document.getElementById('wb2-yr-lbl').textContent=`${a}–${b}`;
}

function applyWBFilters2(){
  const ind=document.getElementById('wb2-ind')?.value||'ALL';
  const cou=document.getElementById('wb2-country')?.value||'ALL';
  const yMin=parseInt(document.getElementById('wb2-yr-min')?.value||0);
  const yMax=parseInt(document.getElementById('wb2-yr-max')?.value||9999);
  APP.wbFiltered=APP.wbLong.filter(r=>{
    if(ind!=='ALL'&&r.indicator!==ind)return false;
    if(cou!=='ALL'&&r.country!==cou)return false;
    if(r.year<yMin||r.year>yMax)return false;
    return true;
  });
  APP.wbPage=1;
  const years=[...new Set(APP.wbLong.map(r=>r.year))].sort((a,b)=>a-b);
  renderWBCharts2(APP.wbFiltered,yMax);
  renderWBTable2();
}

function renderWBCharts2(data, latestYear) {
  const gc=document.getElementById('wb2-charts'); if(!gc) return;
  gc.innerHTML='';
  ['wb2-trend','wb2-top','wb2-ts'].forEach(id=>destroyChart(id));

  // Global avg trend
  const tCard=document.createElement('div'); tCard.className='chart-card glass-card chart-wide';
  tCard.innerHTML='<div class="chart-title">Global Average by Year</div><div class="chart-wrap"><canvas id="wb2-trend"></canvas></div>';
  gc.appendChild(tCard);
  const byYear={};
  data.forEach(r=>{if(!byYear[r.year])byYear[r.year]=[];byYear[r.year].push(r.value);});
  const yrs=Object.keys(byYear).map(Number).sort((a,b)=>a-b);
  const ctx1=tCard.querySelector('canvas')?.getContext('2d');
  if(ctx1) APP.charts['wb2-trend']=new Chart(ctx1,{type:'line',
    data:{labels:yrs,datasets:[{label:'Avg',data:yrs.map(y=>mean(byYear[y])),borderColor:'rgba(168,85,247,.9)',backgroundColor:'rgba(168,85,247,.07)',fill:true,tension:.3,pointRadius:1.5}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font,maxTicksLimit:12},grid:{color:CD.grid.color}},y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}}}});

  // Top 10 countries latest year
  const tpCard=document.createElement('div'); tpCard.className='chart-card glass-card';
  tpCard.innerHTML=`<div class="chart-title">Top 10 Countries (${latestYear})</div><div class="chart-wrap"><canvas id="wb2-top"></canvas></div>`;
  gc.appendChild(tpCard);
  const byC={};
  data.filter(r=>r.year===latestYear).forEach(r=>{if(!byC[r.country])byC[r.country]=[];byC[r.country].push(r.value);});
  const topC=Object.entries(byC).map(([c,v])=>({c,avg:mean(v)})).sort((a,b)=>b.avg-a.avg).slice(0,10);
  const ctx2=tpCard.querySelector('canvas')?.getContext('2d');
  if(ctx2) APP.charts['wb2-top']=new Chart(ctx2,{type:'bar',
    data:{labels:topC.map(d=>d.c),datasets:[{data:topC.map(d=>d.avg),backgroundColor:topC.map((_,i)=>getColor(i,.7)),borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}},y:{ticks:{color:CD.tick.color,font:{family:'Syne,sans-serif',size:9}},grid:{display:false}}}}});
}

function renderWBTable2(){
  const data=APP.wbFiltered;
  document.getElementById('wb2-count').textContent=data.length.toLocaleString();
  const ps=15, pages=Math.ceil(data.length/ps), start=(APP.wbPage-1)*ps;
  const tbody=document.getElementById('wb2-tbody'); if(!tbody) return;
  tbody.innerHTML=data.slice(start,start+ps).map(r=>`<tr>
    <td style="color:var(--ac);font-family:var(--fd);font-size:.68rem;">${escH(r.country)}</td>
    <td style="font-size:.78rem;">${escH(r.indicator.slice(0,70))}${r.indicator.length>70?'…':''}</td>
    <td style="font-family:var(--fd);font-size:.72rem;color:var(--t3);">${r.year}</td>
    <td style="font-family:var(--fd);font-size:.75rem;">${r.value.toLocaleString(undefined,{maximumFractionDigits:3})}</td>
  </tr>`).join('');
  renderPagination('wb2-pag',pages,APP.wbPage,p=>{APP.wbPage=p;renderWBTable2();});
}


// ===================== EXPORT =====================
function exportCSV() {
  const data=APP.filtered; if(!data.length){toast('error','Export Failed','No data');return;}
  const schema=APP.schema;
  const cols=schema.map(c=>c.name);
  const rows=[cols.map(c=>`"${c.replace(/"/g,'""')}"`)];
  data.forEach(r=>rows.push(cols.map(c=>{const v=r[c]===null||r[c]===undefined?'':String(r[c]);return `"${v.replace(/"/g,'""')}"`;} )));
  download('filtered.csv',rows.map(r=>r.join(',')).join('\n'),'text/csv');
  toast('success','CSV Exported',`${data.length.toLocaleString()} rows.`);
}

function exportJSON() {
  const data=APP.filtered; if(!data.length){toast('error','Export Failed','No data');return;}
  const schema=APP.schema;
  const numCols=schema.filter(c=>c.type==='numeric');
  const summary={
    generated_at:new Date().toISOString(),
    mode:APP.mode, filters:APP.filters,
    kpi:{rows:data.length,cols:schema.length,missing_pct:((schema.reduce((s,c)=>s+c.missing,0)/schema.length)*100).toFixed(1)},
    columns:schema.map(c=>({name:c.name,type:c.type,missing:(c.missing*100).toFixed(1)+'%',uniques:c.uniques})),
    numeric_stats:Object.fromEntries(numCols.map(c=>{
      const vals=data.map(r=>parseFloat(r[c.name])).filter(v=>!isNaN(v));
      return [c.name,{min:Math.min(...vals),max:Math.max(...vals),mean:+mean(vals).toFixed(4),median:+median(vals).toFixed(4)}];
    }))
  };
  download('summary.json',JSON.stringify(summary,null,2),'application/json');
  toast('success','JSON Exported','Summary downloaded.');
}

// ===================== MAIN RENDER =====================
function renderAll() {
  const schema = APP.schema;
  const filtered = APP.filtered;
  renderKPIs(filtered, schema);
  renderCharts(filtered, schema);
  renderCorrelation(filtered, schema);
  renderTable(filtered, schema);
  generateInsights(APP.raw, schema, filtered);
  // special mode re-render on filter
  if (APP.mode === 'text_reviews') renderTextReviewsPanel(filtered, schema);
}

// ===================== INIT =====================
function resetToUpload() {
  destroyAllCharts();
  APP.raw=[]; APP.filtered=[]; APP.schema=null;
  APP.wbLong=[]; APP.wbFiltered=[]; APP.mode='generic';
  APP.page=1; APP.sortCol=null; APP.filters={};
  document.getElementById('upload-section').style.display='flex';
  document.getElementById('dashboard').style.display='none';
  document.getElementById('progress-wrap').style.display='none';
  document.getElementById('file-name-display').textContent='Choose CSV File';
  document.getElementById('csv-input').value='';
  document.getElementById('load-btn').disabled=true;
  document.getElementById('mode-badge').style.display='none';
  document.getElementById('special-panel').style.display='none';
  document.getElementById('logo-sub').textContent='Universal CSV Intelligence';
  setStatus('idle','Awaiting Data');
}

document.addEventListener('DOMContentLoaded', () => {
  const csvInput=document.getElementById('csv-input');
  const loadBtn=document.getElementById('load-btn');

  let selectedFile=null;
  csvInput.addEventListener('change',e=>{
    selectedFile=e.target.files[0];
    if(selectedFile){document.getElementById('file-name-display').textContent=selectedFile.name;loadBtn.disabled=false;}
  });

  document.getElementById('reload-btn').addEventListener('click',resetToUpload);
  document.getElementById('export-csv-btn').addEventListener('click',exportCSV);
  document.getElementById('export-json-btn').addEventListener('click',exportJSON);
  document.getElementById('global-search').addEventListener('input',()=>debounceFilter());
  document.getElementById('reset-filters-btn').addEventListener('click',()=>resetFilters(APP.schema));

  // ---- LOAD BUTTON ----
  loadBtn.addEventListener('click', async () => {
    if(!selectedFile)return;
    loadBtn.disabled=true;
    setStatus('loading','Parsing...');
    document.getElementById('progress-wrap').style.display='block';
    setProgress(5,'Reading file...');

    try {
      const text=await selectedFile.text();
      setProgress(15,'Parsing CSV...');
      await tick();

      const result = await new Promise((res,rej)=>Papa.parse(text,{
        header:true, skipEmptyLines:true, dynamicTyping:false,
        transformHeader:h=>h.trim(),
        worker:false,  // worker:true breaks in some environments
        complete:res, error:e=>rej(e.message)
      }));

      if(!result.data||!result.data.length) throw 'File is empty or has no valid rows.';

      // Truncate if huge
      APP.totalRows=result.data.length;
      APP.truncated=result.data.length>MAX_ROWS;
      const rawData = APP.truncated ? result.data.slice(0,MAX_ROWS) : result.data;
      if(APP.truncated) toast('info','Large Dataset',`Loaded first ${MAX_ROWS.toLocaleString()} of ${APP.totalRows.toLocaleString()} rows.`);

      setProgress(35,'Inferring schema...');
      await tick();

      const schema = inferColumnTypes(rawData);
      // Filter out year_col from schema for World Bank meta-cols only
      const displaySchema = schema.filter(c=>c.type!=='year_col'||true); // keep all for now
      APP.schema = schema;
      APP.raw = rawData;
      APP.filtered = [...rawData];

      setProgress(55,'Detecting mode...');
      await tick();

      const mode = detectSpecialMode(schema);
      APP.mode = mode;

      setProgress(68,'Building UI...');
      await tick();

      // Visible cols: exclude year_col and id cols by default
      APP.visibleCols = schema.filter(c=>c.type!=='year_col'&&c.type!=='id').map(c=>c.name);
      if(!APP.visibleCols.length) APP.visibleCols=schema.slice(0,8).map(c=>c.name);

      buildFilterUI(schema.filter(c=>c.type!=='year_col'));
      renderColToggles(schema.filter(c=>c.type!=='year_col'));

      setProgress(82,'Rendering...');
      await tick();

      renderKPIs(rawData, schema);
      renderCharts(rawData, schema.filter(c=>c.type!=='year_col'));
      renderCorrelation(rawData, schema.filter(c=>c.type!=='year_col'));
      renderTable(rawData, schema.filter(c=>c.type!=='year_col'));
      generateInsights(rawData, schema.filter(c=>c.type!=='year_col'), rawData);

      if(mode==='text_reviews') renderTextReviewsPanel(rawData, schema);
      if(mode==='world_bank') renderWorldBankPanel(rawData, schema);

      setProgress(100,'Done!');
      await tick(200);

      document.getElementById('upload-section').style.display='none';
      document.getElementById('dashboard').style.display='block';

      // dataset info
      document.getElementById('dataset-info-text').textContent=
        `${rawData.length.toLocaleString()} rows × ${schema.length} cols | Mode: ${mode.replace('_',' ').toUpperCase()}`;

      // mode badge
      const badge=document.getElementById('mode-badge');
      badge.style.display='block';
      badge.className='mode-badge mode-'+mode.split('_')[0];
      badge.textContent=mode==='text_reviews'?'TEXT REVIEWS':mode==='world_bank'?'WORLD BANK':'GENERIC';

      document.getElementById('logo-sub').textContent=
        mode==='text_reviews'?'Text Reviews Mode':mode==='world_bank'?'World Bank WDI Mode':'Generic CSV Mode';

      setStatus('active',`${rawData.length.toLocaleString()} rows loaded`);
      toast('success','Data Loaded',`${rawData.length.toLocaleString()} rows, ${schema.length} columns. Mode: ${mode.replace(/_/g,' ')}.`);

    } catch(err) {
      setStatus('error','Error');
      document.getElementById('progress-wrap').style.display='none';
      loadBtn.disabled=false;
      toast('error','Load Failed',String(err));
      console.error('Load error:',err);
    }
  });
});

function tick(ms=10) { return new Promise(r=>setTimeout(r,ms)); }