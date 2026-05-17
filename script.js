/* ================================================================
   NEXUS ANALYTICS v5 — Full Automated Data Analysis Pipeline
   6 Stages: Overview → Quality → Cleaning → Stats → Viz → Regression
   Compatible with ANY CSV. No column names hardcoded.
   ================================================================ */

'use strict';

// ═══════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════
const APP = {
  rawData:    [],
  cleanData:  [],
  filtered:   [],
  schema:     [],       // [{name,type,uniques,missing,sample,topValues,numMin,numMax,numMean,numStd}]
  cleanSchema:[],
  stats:      {},       // {colName: {mean,median,std,min,max,range,cv,q1,q3,iqr}}
  corrMatrix: {},       // {colA: {colB: r}}
  regression: null,     // {target,features,intercept,coeffs,r2,mse,rmse,adjR2}
  cleanLog:   [],
  quality:    {},       // {missingInfo, dupCount, outlierInfo}
  page: 1,
  pageSize: 15,
  sortCol: null,
  sortDir: 1,
  visibleCols: [],
  filters: {},
  charts: {},
  totalRaw: 0,
  truncated: false,
  MAX_ROWS: 20000,
  SAMPLE_N: 3000
};

// ═══════════════════════════════════════════════════════════════
// CHART PALETTE & DEFAULTS
// ═══════════════════════════════════════════════════════════════
const PALETTE = [
  [0,240,255],[168,85,247],[244,114,182],[0,255,170],
  [251,191,36],[249,115,22],[99,102,241],[20,184,166],
  [236,72,153],[132,204,22],[251,113,133],[34,211,238]
];
const rgba  = (i,a=0.7) => { const [r,g,b]=PALETTE[i%PALETTE.length]; return `rgba(${r},${g},${b},${a})`; };
const CD = {
  font : { family:'Syne,sans-serif', size:10 },
  tick : { color:'#445577' },
  grid : { color:'rgba(255,255,255,0.04)' }
};
const chartOpts = (extra={}) => ({
  responsive:true, maintainAspectRatio:false,
  animation:{ duration:600 },
  plugins:{ legend:{ labels:{ color:'#8ba4c8', font:CD.font, boxWidth:12, padding:10 } } },
  scales:{
    x:{ ticks:{ color:CD.tick.color, font:CD.font, maxRotation:40 }, grid:{ color:CD.grid.color } },
    y:{ ticks:{ color:CD.tick.color, font:CD.font }, grid:{ color:CD.grid.color } }
  },
  ...extra
});

// ═══════════════════════════════════════════════════════════════
// MATH UTILITIES
// ═══════════════════════════════════════════════════════════════
const sum      = a => a.reduce((s,x)=>s+x, 0);
const mean     = a => a.length ? sum(a)/a.length : NaN;
const median   = a => { if(!a.length)return NaN; const s=[...a].sort((p,q)=>p-q),m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const variance = a => { const m=mean(a); return mean(a.map(x=>(x-m)**2)); };
const stddev   = a => Math.sqrt(variance(a));
const quantile = (a,q) => {
  const s=[...a].sort((p,q)=>p-q), pos=(s.length-1)*q;
  const lo=Math.floor(pos),hi=Math.ceil(pos);
  return s[lo]+(s[hi]-s[lo])*(pos-lo);
};
const pearson  = (xs,ys) => {
  if(xs.length<3)return 0;
  const mx=mean(xs),my=mean(ys);
  const n=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
  const d=Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));
  return d<1e-10?0:n/d;
};
const clamp    = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

// ═══════════════════════════════════════════════════════════════
// FORMAT / ESCAPE UTILITIES
// ═══════════════════════════════════════════════════════════════
function fmtN(n, d=2) {
  if(n===null||n===undefined||isNaN(n))return '—';
  const abs=Math.abs(n);
  if(abs>=1e9) return (n/1e9).toFixed(1)+'B';
  if(abs>=1e6) return (n/1e6).toFixed(1)+'M';
  if(abs>=1e3) return (n/1e3).toFixed(1)+'k';
  if(abs<0.001&&abs>0) return n.toExponential(2);
  return Number(n).toFixed(d);
}
const escH = s => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const tick = (ms=10) => new Promise(r=>setTimeout(r,ms));
const dl   = (name,content,mime) => {
  const b=new Blob([content],{type:mime}),u=URL.createObjectURL(b),a=document.createElement('a');
  a.href=u;a.download=name;document.body.appendChild(a);a.click();
  document.body.removeChild(a);URL.revokeObjectURL(u);
};

// ═══════════════════════════════════════════════════════════════
// DATE DETECTION
// ═══════════════════════════════════════════════════════════════
const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}/,
  /^\d{2}\/\d{2}\/\d{4}/,
  /^\d{2}-\d{2}-\d{4}/,
  /^\d{4}\/\d{2}\/\d{2}/,
  /^\d{4}$/,
  /^\d{4}-\d{2}$/,
  /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}/
];
const isDateStr = v => {
  const s = String(v).trim();
  if(!DATE_PATTERNS.some(p=>p.test(s))) return false;
  const d = /^\d{4}$/.test(s) ? new Date(+s,0,1) : new Date(s);
  return !isNaN(d.getTime());
};
const parseDate = v => {
  const s=String(v).trim();
  return /^\d{4}$/.test(s) ? new Date(+s,0,1) : new Date(s);
};

// ═══════════════════════════════════════════════════════════════
// UI HELPERS — Toast / Progress / Status
// ═══════════════════════════════════════════════════════════════
function toast(type,title,msg){
  const tc=document.getElementById('toast-container');
  const icons={error:'⚠',success:'✓',info:'ℹ',warn:'⚡'};
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<span class="toast-icon">${icons[type]||'ℹ'}</span>
    <div class="toast-body">
      <div class="toast-title">${escH(title)}</div>
      <div class="toast-msg">${escH(msg)}</div>
    </div>`;
  tc.appendChild(el);
  setTimeout(()=>{
    el.style.cssText='opacity:0;transform:translateX(20px);transition:.3s';
    setTimeout(()=>el.remove(),320);
  },4200);
}
function setStatus(state,text){
  document.getElementById('status-dot').className='status-dot '+state;
  document.getElementById('status-text').textContent=text;
}
function setProgress(pct,label){
  document.getElementById('progress-fill').style.width=pct+'%';
  document.getElementById('progress-label').textContent=label;
}
function destroyChart(id){
  if(APP.charts[id]){APP.charts[id].destroy();delete APP.charts[id];}
}
function destroyAll(){
  Object.keys(APP.charts).forEach(destroyChart);
}

// ═══════════════════════════════════════════════════════════════
// STAGE 1A — CSV / ARFF-like dirty CSV parser
// Supports:
// % comments, @RELATION, @ATTRIBUTE, @DATA, ?, nan, single quotes
// ═══════════════════════════════════════════════════════════════
const MISSING_TOKENS = new Set(['', '?', 'na', 'n/a', 'null', 'none', 'nan']);

function normalizeCell(v){
  if(v === null || v === undefined) return '';
  let s = String(v).trim();

  if(
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ){
    s = s.slice(1, -1).trim();
  }

  return MISSING_TOKENS.has(s.toLowerCase()) ? '' : s;
}

function normalizeRows(rows){
  return rows
    .filter(r => r && Object.keys(r).length)
    .map(row => {
      const clean = {};
      Object.entries(row).forEach(([k, v]) => {
        const key = String(k || '').trim();
        if(key) clean[key] = normalizeCell(v);
      });
      return clean;
    })
    .filter(r => Object.values(r).some(v => String(v).trim() !== ''));
}

function parseAttributeName(line){
  const match = line.match(/^@attribute\s+('.*?'|".*?"|\S+)/i);
  if(!match) return null;
  return normalizeCell(match[1]);
}

function looksLikeARFF(text){
  return /(^|\n)\s*@data\b/i.test(text) && /(^|\n)\s*@attribute\b/i.test(text);
}

function parseARFFLike(text){
  return new Promise((resolve, reject) => {
    const lines = text.split(/\r?\n/);
    const columns = [];
    let dataStart = -1;
    let relation = '';

    for(let i = 0; i < lines.length; i++){
      const line = lines[i].trim();

      if(!line || line.startsWith('%')) continue;

      if(line.toLowerCase().startsWith('@relation')){
        relation = line.replace(/^@relation\s+/i, '').trim();
      }

      if(line.toLowerCase().startsWith('@attribute')){
        const name = parseAttributeName(line);
        if(name) columns.push(name);
      }

      if(line.toLowerCase().startsWith('@data')){
        dataStart = i + 1;
        break;
      }
    }

    if(dataStart < 0 || !columns.length){
      reject('ARFF structure detected, but @ATTRIBUTE or @DATA section is invalid.');
      return;
    }

    const dataLines = lines
      .slice(dataStart)
      .filter(line => {
        const s = line.trim();
        return s && !s.startsWith('%');
      });

    const csvText = dataLines.join('\n');

    Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false,
      quoteChar: "'",
      complete: result => {
        if(result.errors && result.errors.length){
          console.warn('ARFF parse warnings:', result.errors);
        }

        const data = result.data
          .filter(row => Array.isArray(row) && row.length)
          .map(row => {
            const obj = {};
            columns.forEach((col, i) => {
              obj[col] = normalizeCell(row[i]);
            });
            return obj;
          })
          .filter(row => Object.values(row).some(v => String(v).trim() !== ''));

        resolve({
          data,
          meta: {
            format: 'ARFF-like CSV',
            relation,
            columns
          }
        });
      },
      error: e => reject(e.message)
    });
  });
}

function parseCSV(text){
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: h => String(h || '').trim(),
      complete: result => {
        if(result.errors && result.errors.length){
          console.warn('CSV parse warnings:', result.errors);
        }

        resolve({
          data: normalizeRows(result.data),
          meta: {
            format: 'CSV',
            relation: '',
            columns: result.meta?.fields || []
          }
        });
      },
      error: e => reject(e.message)
    });
  });
}

function parseDataFile(text){
  return looksLikeARFF(text) ? parseARFFLike(text) : parseCSV(text);
}

// ═══════════════════════════════════════════════════════════════
// STAGE 1B — inferColumnTypes
// Returns array of column descriptors with type detection
// ═══════════════════════════════════════════════════════════════
function inferColumnTypes(data){
  if(!data.length) return [];

  // Sample for type inference (performance)
  const step = data.length>APP.SAMPLE_N ? Math.ceil(data.length/APP.SAMPLE_N) : 1;
  const sdata = data.filter((_,i)=>i%step===0);
  const N = data.length;

  return Object.keys(data[0]).map(name=>{
    const raw   = sdata.map(r=>r[name]);
    const vals  = raw.filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='');
    const total = sdata.length;
    const missingCount = total - vals.length;
    const missingPct   = missingCount/total;

    if(!vals.length) return {
      name, type:'empty', missing:1, uniques:0,
      sample:[], topValues:[], numMin:null, numMax:null, numMean:null, numStd:null
    };

    // --- numeric check ---
    const numParsed = vals.map(v=>parseFloat(String(v).replace(/,/g,''))).filter(v=>!isNaN(v)&&isFinite(v));
    const numericRatio = numParsed.length/vals.length;

    // --- date check ---
    const dateParsed = vals.filter(v=>isDateStr(v));
    const dateRatio  = dateParsed.length/vals.length;

    // --- unique count ---
    const uniqSet   = new Set(vals.map(v=>String(v).trim().toLowerCase()));
    const uniqCount = uniqSet.size;
    const uniqRatio = uniqCount / N;

    // --- text complexity ---
    const avgLen   = mean(vals.map(v=>String(v).length));
    const avgWords = mean(vals.map(v=>String(v).trim().split(/\s+/).length));

    // --- type decision ---
    let type;
    const colNameLower = name.trim().toLowerCase();

    // World Bank year-column pattern
    if(/^\d{4}$/.test(name.trim()) && numericRatio>=0.4) {
      type = 'year_col';
    }
    // ID-like columns
    else if(
      (colNameLower==='unnamed: 0'||colNameLower==='index'||colNameLower==='id') ||
      (uniqRatio>0.95 && numericRatio>=0.9 && N>100)
    ){
      type = 'id';
    }
    // Numeric
    else if(numericRatio>=0.70){
      type = 'numeric';
    }
    // Date
    else if(dateRatio>=0.55){
      type = 'date';
    }
    // Categorical (low cardinality)
    else if(uniqCount<=Math.min(50, 0.15*N+10)){
      type = 'categorical';
    }
    // Long text
    else if(avgLen>25 && avgWords>3){
      type = 'text';
    }
    // Default: treat as categorical if low uniq, else text
    else {
      type = uniqCount<=100 ? 'categorical' : 'text';
    }

    // --- frequency table ---
    const freq = {};
    vals.forEach(v=>{ const k=String(v).trim(); freq[k]=(freq[k]||0)+1; });
    const topValues = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,25);

    // --- numeric stats (fast) ---
    const numArr = (type==='numeric')
      ? vals.map(v=>parseFloat(String(v).replace(/,/g,''))).filter(v=>!isNaN(v))
      : [];

    return {
      name, type,
      missing: missingPct,
      uniques: uniqCount,
      sample:  vals.slice(0,5).map(v=>String(v).slice(0,35)),
      topValues,
      numMin:  numArr.length ? Math.min(...numArr) : null,
      numMax:  numArr.length ? Math.max(...numArr) : null,
      numMean: numArr.length ? mean(numArr) : null,
      numStd:  numArr.length ? stddev(numArr) : null
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// STAGE 1C — renderOverview
// ═══════════════════════════════════════════════════════════════
function renderOverview(data, schema){
  const numCols  = schema.filter(c=>c.type==='numeric').length;
  const catCols  = schema.filter(c=>c.type==='categorical').length;
  const dateCols = schema.filter(c=>c.type==='date').length;
  const textCols = schema.filter(c=>c.type==='text').length;
  const idCols   = schema.filter(c=>c.type==='id'||c.type==='year_col').length;
  const totalMissing = schema.reduce((s,c)=>s+Math.round(c.missing*data.length),0);

  const kpis = [
    {icon:'⬡', val:data.length.toLocaleString(), label:'Total Rows',       cls:''},
    {icon:'◈', val:schema.length,                label:'Total Columns',    cls:''},
    {icon:'◇', val:numCols,                      label:'Numeric Cols',     cls:'kv-g'},
    {icon:'○', val:catCols,                      label:'Categorical Cols', cls:'kv-p'},
    {icon:'★', val:dateCols,                     label:'Date Cols',        cls:''},
    {icon:'◻', val:totalMissing.toLocaleString(),label:'Missing Cells',    cls:'kv-w'},
  ];

  document.getElementById('kpi-grid').innerHTML = kpis.map((k,i)=>`
    <div class="kpi-card glass-card" style="animation-delay:${i*0.05}s">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-value ${k.cls}">${k.val}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');

  // Schema table
  const typeColors = {
    numeric:'type-numeric',categorical:'type-categorical',
    date:'type-date',text:'type-text',id:'type-id',
    year_col:'type-id',empty:'type-id'
  };
  document.getElementById('schema-body').innerHTML = schema.map(c=>`
    <tr>
      <td><strong style="color:var(--t1)">${escH(c.name)}</strong></td>
      <td><span class="type-badge ${typeColors[c.type]||'type-id'}">${c.type}</span></td>
      <td style="font-family:var(--fd);color:var(--ac);font-size:.75rem">${c.uniques.toLocaleString()}</td>
      <td style="color:var(--t3);font-size:.76rem">${c.sample.map(escH).join(', ')}</td>
    </tr>`).join('');

  // First-5-rows preview (limit to 10 columns max for readability)
  const previewCols = schema.filter(c=>c.type!=='year_col').slice(0,10);
  document.getElementById('preview-head').innerHTML =
    '<tr>'+previewCols.map(c=>`<th>${escH(c.name)}</th>`).join('')+'</tr>';
  document.getElementById('preview-body').innerHTML = data.slice(0,5).map(r=>'<tr>'+
    previewCols.map(c=>{
      const v=r[c.name];
      const s=v===null||v===undefined||String(v).trim()===''
        ? '<span style="color:var(--t3)">—</span>'
        : escH(String(v).slice(0,55))+(String(v).length>55?'…':'');
      return `<td>${s}</td>`;
    }).join('')+'</tr>').join('');
}

// ═══════════════════════════════════════════════════════════════
// STAGE 2 — assessDataQuality
// ═══════════════════════════════════════════════════════════════
function assessDataQuality(data, schema){
  const N = data.length;

  // Missing per column
  const missingInfo = schema.map(c=>{
    const count = data.filter(r=>{
      const v=r[c.name];
      return v===null||v===undefined||String(v).trim()==='';
    }).length;
    return { name:c.name, type:c.type, count, pct:(count/N*100).toFixed(1) };
  }).sort((a,b)=>b.count-a.count);

  // Duplicate rows
  const seen = new Set(); let dupCount=0;
  data.forEach(r=>{
    const key=JSON.stringify(Object.values(r));
    if(seen.has(key)) dupCount++;
    else seen.add(key);
  });

  // IQR Outliers for numeric cols
  const numCols = schema.filter(c=>c.type==='numeric');
  const outlierInfo = numCols.map(c=>{
    const vals = data.map(r=>parseFloat(String(r[c.name]||'').replace(/,/g,''))).filter(v=>!isNaN(v));
    if(vals.length<4) return {name:c.name,q1:'—',q3:'—',iqr:'—',count:0,lo:null,hi:null};
    const q1=quantile(vals,.25), q3=quantile(vals,.75), iqr=q3-q1;
    const lo=q1-1.5*iqr, hi=q3+1.5*iqr;
    const count=vals.filter(v=>v<lo||v>hi).length;
    return {name:c.name, q1:fmtN(q1), q3:fmtN(q3), iqr:fmtN(iqr), count, lo, hi};
  });

  const totalMissing = missingInfo.reduce((s,m)=>s+m.count,0);
  const totalOutliers = outlierInfo.reduce((s,o)=>s+o.count,0);

  // Quality KPIs
  document.getElementById('quality-grid').innerHTML = [
    {icon:'◻',val:totalMissing.toLocaleString(),label:'Total Missing',cls:'kv-w'},
    {icon:'◈',val:dupCount.toLocaleString(),label:'Duplicate Rows',cls:dupCount?'kv-w':'kv-g'},
    {icon:'◇',val:totalOutliers.toLocaleString(),label:'Outlier Cells (IQR)',cls:'kv-p'},
    {icon:'⬡',val:((totalMissing/(N*schema.length))*100).toFixed(1)+'%',label:'Overall Missing %',cls:''},
  ].map((k,i)=>`
    <div class="kpi-card glass-card" style="animation-delay:${i*0.05}s">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-value ${k.cls}">${k.val}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');

  // Missing table
  document.getElementById('missing-body').innerHTML = missingInfo.map(m=>{
    const barW = Math.min(100, parseFloat(m.pct));
    const clr  = barW>30?'var(--ar)':barW>10?'var(--aw)':'var(--ag)';
    return `<tr>
      <td style="color:var(--t1)">${escH(m.name)}</td>
      <td style="font-family:var(--fd);color:${m.count?'var(--aw)':'var(--ag)'}">${m.count.toLocaleString()}</td>
      <td style="font-family:var(--fd);color:var(--t2)">${m.pct}%</td>
      <td><div class="miss-bar-wrap"><div class="miss-bar-fill" style="width:${barW}%;background:${clr}"></div></div></td>
    </tr>`;
  }).join('');

  // Outlier table
  document.getElementById('outlier-body').innerHTML = outlierInfo.map(o=>`
    <tr>
      <td style="color:var(--t1)">${escH(o.name)}</td>
      <td style="color:var(--t2);font-size:.78rem">${o.q1}</td>
      <td style="color:var(--t2);font-size:.78rem">${o.q3}</td>
      <td style="color:var(--t2);font-size:.78rem">${o.iqr}</td>
      <td><span class="outlier-badge ${o.count===0?'none':''}">${o.count} rows</span></td>
    </tr>`).join('');

  APP.quality = { missingInfo, dupCount, outlierInfo };
  return APP.quality;
}

// ═══════════════════════════════════════════════════════════════
// STAGE 3 — cleanData
// ═══════════════════════════════════════════════════════════════
function cleanData(rawData, schema){
  APP.cleanLog = [];
  let data = rawData.map(r=>({...r}));   // shallow copy rows

  // 1. Drop index-like / id columns
  const dropCols = schema.filter(c=>{
    const n = c.name.trim().toLowerCase();
    return c.type==='id' ||
           n==='unnamed: 0' || n==='' ||
           (n==='index' && c.uniques===rawData.length);
  });
  if(dropCols.length){
    dropCols.forEach(c=>data.forEach(r=>delete r[c.name]));
    APP.cleanLog.push(`<span class="log-warn">⚠ Dropped ${dropCols.length} index/id column(s): ${dropCols.map(c=>escH(c.name)).join(', ')}</span>`);
  }
  const cleanSchema = schema.filter(c=>!dropCols.includes(c));

  // 2. Fill numeric NaN → column median
  let numFilled = 0;
  cleanSchema.filter(c=>c.type==='numeric').forEach(col=>{
    const vals = data.map(r=>parseFloat(String(r[col.name]||'').replace(/,/g,''))).filter(v=>!isNaN(v));
    if(!vals.length) return;
    const med = median(vals);
    data.forEach(r=>{
      const v=r[col.name];
      if(v===null||v===undefined||String(v).trim()===''){
        r[col.name] = med;
        numFilled++;
      }
    });
  });
  if(numFilled) APP.cleanLog.push(`<span class="log-ok">✓ Filled ${numFilled.toLocaleString()} missing numeric values with column median</span>`);
  else APP.cleanLog.push(`<span class="log-ok">✓ No missing numeric values found</span>`);

  // 3. Fill categorical NaN → mode
  let catFilled = 0;
  cleanSchema.filter(c=>c.type==='categorical').forEach(col=>{
    const freq = {};
    data.forEach(r=>{ const v=String(r[col.name]||'').trim(); if(v) freq[v]=(freq[v]||0)+1; });
    const mode = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0]?.[0];
    if(!mode) return;
    data.forEach(r=>{
      if(!r[col.name]||String(r[col.name]).trim()===''){
        r[col.name]=mode; catFilled++;
      }
    });
  });
  if(catFilled) APP.cleanLog.push(`<span class="log-ok">✓ Filled ${catFilled.toLocaleString()} missing categorical values with mode</span>`);

  // 4. Remove duplicates
  const seenKeys = new Set();
  const before = data.length;
  data = data.filter(r=>{
    const k = JSON.stringify(Object.values(r));
    if(seenKeys.has(k)) return false;
    seenKeys.add(k); return true;
  });
  const dupsRemoved = before - data.length;
  if(dupsRemoved) APP.cleanLog.push(`<span class="log-warn">⚠ Removed ${dupsRemoved.toLocaleString()} duplicate rows</span>`);
  else APP.cleanLog.push(`<span class="log-ok">✓ No duplicate rows found</span>`);

  APP.cleanLog.push(`<span class="log-info">◈ Clean dataset: ${data.length.toLocaleString()} rows × ${cleanSchema.length} columns</span>`);

  // Render cleaning KPIs
  document.getElementById('cleaning-grid').innerHTML = [
    {icon:'✓', val:numFilled+catFilled, label:'Values Imputed',    cls:'kv-g'},
    {icon:'◻', val:dupsRemoved,         label:'Duplicates Removed', cls:dupsRemoved?'kv-w':'kv-g'},
    {icon:'◈', val:dropCols.length,     label:'Columns Dropped',   cls:dropCols.length?'kv-w':''},
    {icon:'⬡', val:data.length.toLocaleString(), label:'Final Row Count', cls:'kv-g'},
  ].map((k,i)=>`
    <div class="kpi-card glass-card" style="animation-delay:${i*0.05}s">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-value ${k.cls}">${k.val}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');

  document.getElementById('cleaning-log').innerHTML =
    APP.cleanLog.map(l=>`<div style="padding:.15rem 0">${l}</div>`).join('');

  return { data, schema: cleanSchema };
}

// ═══════════════════════════════════════════════════════════════
// STAGE 4A — computeStatistics
// ═══════════════════════════════════════════════════════════════
function computeStatistics(data, schema){
  const numCols = schema.filter(c=>c.type==='numeric');
  const stats   = {};

  numCols.forEach(col=>{
    const vals = data.map(r=>parseFloat(String(r[col.name]||'').replace(/,/g,''))).filter(v=>!isNaN(v));
    if(!vals.length) return;
    const m=mean(vals), med=median(vals), sd=stddev(vals);
    const mn=Math.min(...vals), mx=Math.max(...vals);
    const q1=quantile(vals,.25), q3=quantile(vals,.75);
    stats[col.name] = {
      mean:m, median:med, std:sd,
      min:mn, max:mx, range:mx-mn,
      cv: Math.abs(m)>1e-10 ? sd/Math.abs(m)*100 : NaN,
      q1, q3, iqr:q3-q1, count:vals.length
    };
  });

  // Render stats table
  const allMeans = Object.values(stats).map(s=>s.mean).filter(v=>!isNaN(v));
  const maxMean  = allMeans.length ? Math.max(...allMeans) : Infinity;
  const minSD    = Object.values(stats).map(s=>s.std).filter(v=>!isNaN(v));
  const lowestSD = minSD.length ? Math.min(...minSD) : -Infinity;

  document.getElementById('stats-body').innerHTML = Object.entries(stats).map(([name,s])=>`
    <tr>
      <td style="color:var(--t1);font-weight:500;max-width:140px;overflow:hidden;text-overflow:ellipsis" title="${escH(name)}">${escH(name)}</td>
      <td style="color:${s.mean===maxMean?'var(--ag)':'var(--t2)'};font-family:var(--fd);font-size:.78rem">${fmtN(s.mean)}</td>
      <td style="color:var(--t2);font-size:.78rem">${fmtN(s.median)}</td>
      <td style="color:${s.std===lowestSD?'var(--ag)':'var(--t2)'};font-size:.78rem">${fmtN(s.std)}</td>
      <td style="color:var(--ar);font-size:.78rem">${fmtN(s.min)}</td>
      <td style="color:var(--ag);font-size:.78rem">${fmtN(s.max)}</td>
      <td style="color:var(--t2);font-size:.78rem">${fmtN(s.range)}</td>
      <td style="color:${isNaN(s.cv)?'var(--t3)':s.cv>100?'var(--ar)':s.cv>50?'var(--aw)':'var(--ag)'};font-size:.78rem">${isNaN(s.cv)?'—':fmtN(s.cv,1)+'%'}</td>
    </tr>`).join('');

  return stats;
}

// ═══════════════════════════════════════════════════════════════
// STAGE 4B — computeCorrelation
// ═══════════════════════════════════════════════════════════════
function computeCorrelation(data, schema){
  const numCols = schema.filter(c=>c.type==='numeric').slice(0,12); // limit for performance
  const section = document.getElementById('corr-section');

  if(numCols.length<2){ section.style.display='none'; return {}; }
  section.style.display='block';

  // Build numeric value arrays
  const arrays = {};
  numCols.forEach(c=>{
    arrays[c.name] = data.map(r=>parseFloat(String(r[c.name]||'').replace(/,/g,''))).filter(v=>!isNaN(v));
  });

  // Compute pairwise (aligned)
  const matrix = {};
  numCols.forEach(ci=>{
    matrix[ci.name]={};
    numCols.forEach(cj=>{
      const pairs = data.map(r=>({
        x:parseFloat(String(r[ci.name]||'').replace(/,/g,'')),
        y:parseFloat(String(r[cj.name]||'').replace(/,/g,''))
      })).filter(p=>!isNaN(p.x)&&!isNaN(p.y));
      matrix[ci.name][cj.name] = pairs.length>=3
        ? pearson(pairs.map(p=>p.x), pairs.map(p=>p.y))
        : null;
    });
  });

  // Render heatmap
  const names = numCols.map(c=>c.name);
  const short  = n => n.length>11 ? n.slice(0,11)+'…' : n;

  const corrColor = v => {
    if(v===null) return 'rgba(10,16,40,0.9)';
    const a = clamp(Math.abs(v),0,1);
    return v>=0
      ? `rgba(0,240,255,${0.08+a*0.78})`
      : `rgba(244,114,182,${0.08+a*0.78})`;
  };

  let html = `<table class="corr-table">
    <thead><tr><th></th>${names.map(n=>`<th title="${escH(n)}">${escH(short(n))}</th>`).join('')}</tr></thead>
    <tbody>`;
  names.forEach(ni=>{
    html+=`<tr><th style="text-align:right;padding-right:.55rem;color:var(--t3);white-space:nowrap">${escH(short(ni))}</th>`;
    names.forEach(nj=>{
      const v  = matrix[ni][nj];
      const d  = v===null ? '—' : v===1 ? '1.00' : v.toFixed(2);
      const tc = v!==null&&Math.abs(v)>0.5 ? 'var(--t1)' : 'var(--t2)';
      html+=`<td title="${escH(ni)} vs ${escH(nj)}: ${d}">
        <div class="corr-cell" style="background:${corrColor(v)};color:${tc}">${d}</div>
      </td>`;
    });
    html+='</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('corr-matrix').innerHTML = html;

  return matrix;
}

// ═══════════════════════════════════════════════════════════════
// STAGE 5 — generateCharts
// 4+ chart types, purely data-driven
// ═══════════════════════════════════════════════════════════════
function generateCharts(data, schema){
  const grid = document.getElementById('charts-grid');
  grid.innerHTML = '';
  Object.keys(APP.charts).filter(k=>k!=='reg-chart').forEach(destroyChart);

  const numCols  = schema.filter(c=>c.type==='numeric').sort((a,b)=>a.missing-b.missing);
  const catCols  = schema.filter(c=>c.type==='categorical'&&c.uniques>=2&&c.uniques<=50).sort((a,b)=>a.uniques-b.uniques);
  const dateCols = schema.filter(c=>c.type==='date').sort((a,b)=>a.missing-b.missing);

  function addCard(id, title, wide=false){
    const card = document.createElement('div');
    card.className = 'chart-card glass-card' + (wide?' chart-wide':'');
    card.innerHTML = `<div class="chart-title">${escH(title)}</div>
      <div class="chart-wrap"><canvas id="${id}"></canvas></div>`;
    grid.appendChild(card);
    return document.getElementById(id);
  }

  // ── CHART 1: Histogram (first numeric col) ──────────────────
  if(numCols.length>=1){
    const col = numCols[0];
    const canvas = addCard('ch-hist', `${col.name} — Distribution (Histogram)`);
    const vals = data.map(r=>parseFloat(String(r[col.name]||'').replace(/,/g,''))).filter(v=>!isNaN(v));

    if(vals.length && canvas){
      const bins=25, mn=Math.min(...vals), mx=Math.max(...vals), step=(mx-mn)/bins||1;
      const counts = new Array(bins).fill(0);
      vals.forEach(v=>{ let b=Math.floor((v-mn)/step); if(b>=bins)b=bins-1; counts[b]++; });
      const labels = Array.from({length:bins},(_,i)=>fmtN(mn+i*step,1));

      // Color bins by frequency
      const maxC = Math.max(...counts);
      const bgColors = counts.map(c=>{
        const ratio = c/maxC;
        return `rgba(0,240,255,${0.2+ratio*0.65})`;
      });

      APP.charts['ch-hist'] = new Chart(canvas.getContext('2d'),{
        type:'bar',
        data:{labels,datasets:[{
          data:counts, backgroundColor:bgColors,
          borderColor:'rgba(0,240,255,0.5)', borderWidth:1,
          borderRadius:2, barPercentage:.96, categoryPercentage:1
        }]},
        options: chartOpts({ plugins:{legend:{display:false}} })
      });
    }
  }

  // ── CHART 2: Scatter Plot (first two numeric cols) ──────────
  if(numCols.length>=2){
    const cx = numCols[0], cy = numCols[1];
    const canvas = addCard('ch-scatter',`${cx.name} vs ${cy.name} — Scatter`);

    let pts = data.map(r=>({
      x: parseFloat(String(r[cx.name]||'').replace(/,/g,'')),
      y: parseFloat(String(r[cy.name]||'').replace(/,/g,''))
    })).filter(p=>!isNaN(p.x)&&!isNaN(p.y));

    // Sample if too many points
    if(pts.length>2000){
      const step=Math.ceil(pts.length/2000);
      pts=pts.filter((_,i)=>i%step===0);
    }

    if(pts.length && canvas){
      APP.charts['ch-scatter'] = new Chart(canvas.getContext('2d'),{
        type:'scatter',
        data:{datasets:[{
          label:`n=${pts.length.toLocaleString()}`,
          data:pts,
          backgroundColor:'rgba(168,85,247,0.4)',
          pointRadius:3, pointHoverRadius:5,
          borderColor:'rgba(168,85,247,0.7)', borderWidth:0.5
        }]},
        options: chartOpts({
          plugins:{ legend:{ labels:{ color:'#8ba4c8', font:CD.font } } },
          scales:{
            x:{ title:{display:true, text:cx.name, color:'#8ba4c8', font:CD.font},
                ticks:{color:CD.tick.color,font:CD.font}, grid:{color:CD.grid.color} },
            y:{ title:{display:true, text:cy.name, color:'#8ba4c8', font:CD.font},
                ticks:{color:CD.tick.color,font:CD.font}, grid:{color:CD.grid.color} }
          }
        })
      });
    }
  }

  // ── CHART 3: Bar Chart (best categorical col) ───────────────
  const bestCat = catCols.find(c=>c.uniques>=2&&c.uniques<=20) || catCols[0];
  if(bestCat){
    const canvas = addCard('ch-bar',`${bestCat.name} — Category Counts`);
    const freq={};
    data.forEach(r=>{ const v=String(r[bestCat.name]||'').trim(); if(v) freq[v]=(freq[v]||0)+1; });
    const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,12);

    if(sorted.length && canvas){
      APP.charts['ch-bar'] = new Chart(canvas.getContext('2d'),{
        type:'bar',
        data:{
          labels: sorted.map(([k])=>k.length>20?k.slice(0,18)+'…':k),
          datasets:[{
            label:'Count',
            data: sorted.map(([,v])=>v),
            backgroundColor: sorted.map((_,i)=>rgba(i,.72)),
            borderColor:     sorted.map((_,i)=>rgba(i,.9)),
            borderWidth:1, borderRadius:5
          }]
        },
        options: chartOpts({plugins:{legend:{display:false}}})
      });
    }
  }

  // ── CHART 4: Time Series OR Numeric Range Chart ─────────────
  if(dateCols.length && numCols.length){
    const dc=dateCols[0], nc=numCols[0];
    const canvas = addCard('ch-ts',`${nc.name} over time (${dc.name})`, true);
    const byMonth={};
    data.forEach(r=>{
      const d=parseDate(r[dc.name]);
      if(isNaN(d.getTime()))return;
      const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      if(!byMonth[k]) byMonth[k]=[];
      const v=parseFloat(String(r[nc.name]||'').replace(/,/g,''));
      if(!isNaN(v)) byMonth[k].push(v);
    });
    const labels=Object.keys(byMonth).sort();
    const avgs=labels.map(k=>mean(byMonth[k]));

    if(labels.length && canvas){
      APP.charts['ch-ts'] = new Chart(canvas.getContext('2d'),{
        type:'line',
        data:{labels, datasets:[{
          label:`Avg ${nc.name}`,
          data:avgs,
          borderColor:'rgba(0,240,255,.9)',
          backgroundColor:'rgba(0,240,255,.07)',
          fill:true, tension:.35, pointRadius:2.5,
          pointBackgroundColor:'rgba(0,240,255,1)'
        }]},
        options: chartOpts({
          plugins:{legend:{labels:{color:'#8ba4c8',font:CD.font}}},
          scales:{
            x:{ticks:{color:CD.tick.color,font:CD.font,maxTicksLimit:12},grid:{color:CD.grid.color}},
            y:{ticks:{color:CD.tick.color,font:CD.font},grid:{color:CD.grid.color}}
          }
        })
      });
    }
  } else if(numCols.length>=2 && catCols.length){
    // Grouped bar: avg of second numeric col by best categorical
    const nc=numCols.find(c=>c.name!==numCols[0].name)||numCols[1]||numCols[0];
    const gc=catCols.find(c=>c.uniques>=2&&c.uniques<=15)||catCols[0];
    const canvas = addCard('ch-grouped',`${nc.name} by ${gc.name} — Range`);
    const groups={};
    data.forEach(r=>{
      const g=String(r[gc.name]||'Other').trim().slice(0,20);
      const v=parseFloat(String(r[nc.name]||'').replace(/,/g,''));
      if(!isNaN(v)){ if(!groups[g]) groups[g]=[]; groups[g].push(v); }
    });
    const labels=Object.keys(groups).slice(0,12);
    if(labels.length && canvas){
      APP.charts['ch-grouped'] = new Chart(canvas.getContext('2d'),{
        type:'bar',
        data:{labels, datasets:[
          { label:'Avg',  data:labels.map(g=>mean(groups[g])),          backgroundColor:labels.map((_,i)=>rgba(i,.65)), borderRadius:4, order:1 },
          { label:'Min',  data:labels.map(g=>Math.min(...groups[g])),  type:'line', borderColor:'rgba(0,255,170,.6)', backgroundColor:'transparent', pointRadius:3, borderDash:[4,2], order:0 },
          { label:'Max',  data:labels.map(g=>Math.max(...groups[g])),  type:'line', borderColor:'rgba(244,114,182,.6)', backgroundColor:'transparent', pointRadius:3, borderDash:[4,2], order:0 }
        ]},
        options: chartOpts({ plugins:{ legend:{ labels:{ color:'#8ba4c8',font:CD.font,boxWidth:12 } } } })
      });
    }
  } else if(numCols.length>=1){
    // Five-number summary bar for first numeric col
    const col=numCols[0];
    const canvas=addCard('ch-summary',`${col.name} — Five-Number Summary`);
    const vals=data.map(r=>parseFloat(String(r[col.name]||'').replace(/,/g,''))).filter(v=>!isNaN(v));
    if(vals.length && canvas){
      const sumVals=[Math.min(...vals),quantile(vals,.25),median(vals),mean(vals),quantile(vals,.75),Math.max(...vals)];
      APP.charts['ch-summary']=new Chart(canvas.getContext('2d'),{
        type:'bar',
        data:{
          labels:['Min','Q1','Median','Mean','Q3','Max'],
          datasets:[{data:sumVals,backgroundColor:['rgba(0,240,255,.5)','rgba(0,255,170,.4)','rgba(168,85,247,.6)','rgba(251,191,36,.6)','rgba(0,255,170,.4)','rgba(244,114,182,.55)'],borderRadius:4}]
        },
        options:chartOpts({plugins:{legend:{display:false}}})
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// STAGE 6 — runRegression (OLS via Normal Equation)
// Target = highest-variance numeric col
// Features = top-3 correlated numeric cols
// ═══════════════════════════════════════════════════════════════
function runRegression(data, schema, corrMatrix){
  const numCols = schema.filter(c=>c.type==='numeric');
  const sec = document.getElementById('sec-regression');

  if(numCols.length<3){ sec.style.display='none'; return null; }
  sec.style.display='block';

  // Pick target: highest variance numeric col
  let bestTarget=null, bestVar=0;
  numCols.forEach(c=>{
    const vals=data.map(r=>parseFloat(String(r[c.name]||'').replace(/,/g,''))).filter(v=>!isNaN(v));
    if(!vals.length) return;
    const v=variance(vals);
    if(v>bestVar){ bestVar=v; bestTarget=c; }
  });
  if(!bestTarget){ sec.style.display='none'; return null; }

  const targetName = bestTarget.name;

  // Pick features: top 3 correlated (by absolute r) with target, excluding target itself
  const others = numCols.filter(c=>c.name!==targetName);
  const ranked = others.map(c=>({
    name: c.name,
    r: Math.abs((corrMatrix[targetName]?.[c.name]) ?? 0)
  })).sort((a,b)=>b.r-a.r);
  const features = ranked.slice(0,Math.min(3,ranked.length)).map(c=>c.name);

  if(!features.length){ sec.style.display='none'; return null; }

  // Build complete-cases dataset
  const rows = data.map(r=>{
    const y = parseFloat(String(r[targetName]||'').replace(/,/g,''));
    const xs = features.map(f=>parseFloat(String(r[f]||'').replace(/,/g,'')));
    return (!isNaN(y) && !xs.some(isNaN)) ? {y, xs} : null;
  }).filter(Boolean);

  if(rows.length<10){ sec.style.display='none'; return null; }

  const n  = rows.length;
  const nf = features.length;

  // Standardize features & target
  const yVals  = rows.map(r=>r.y);
  const yMean_ = mean(yVals), yStd_ = stddev(yVals)||1;

  const fStats = features.map((_,fi)=>{
    const v = rows.map(r=>r.xs[fi]);
    return { m:mean(v), s:stddev(v)||1 };
  });

  // Design matrix X (n × nf+1) with bias column, normalized
  const X = rows.map(r=>[1, ...r.xs.map((v,fi)=>(v-fStats[fi].m)/fStats[fi].s)]);
  const Y = rows.map(r=>(r.y-yMean_)/yStd_);

  // Normal equation: w = (X'X)^-1 X'y
  // X' (transpose)
  const Xt = Array.from({length:nf+1},(_,ci)=>X.map(row=>row[ci]));

  // X'X (square matrix)
  const XtX = Xt.map(row=>Xt[0].map((_,ci)=>row.reduce((s,_,ri)=>s+row[ri]*X[ri][ci],0)));

  // X'y
  const Xty = Xt.map(row=>row.reduce((s,v,i)=>s+v*Y[i],0));

  // Invert X'X using Gauss-Jordan
  const inv = gaussJordanInvert(XtX);
  if(!inv){ sec.style.display='none'; return null; }

  // Weights in normalized space
  const w = inv.map(row=>row.reduce((s,v,ci)=>s+v*Xty[ci],0));

  // Predictions (de-normalized)
  const preds = rows.map((r,i)=>{
    const yHatNorm = w[0] + r.xs.reduce((s,v,fi)=>s+w[fi+1]*(v-fStats[fi].m)/fStats[fi].s, 0);
    return yHatNorm*yStd_+yMean_;
  });

  // Metrics
  const yMeanA = mean(yVals);
  const ssTot  = yVals.reduce((s,y)=>s+(y-yMeanA)**2,0);
  const ssRes  = yVals.reduce((s,y,i)=>s+(y-preds[i])**2,0);
  const r2     = ssTot>0 ? 1-ssRes/ssTot : 0;
  const adjR2  = 1-(1-r2)*(n-1)/(n-nf-1);
  const mse    = ssRes/n;
  const rmse   = Math.sqrt(mse);

  // Real-space coefficients (slope per feature unit)
  const coeffs = features.map((_,fi)=>w[fi+1]*(yStd_/fStats[fi].s));
  const intercept = yMean_ - features.reduce((s,_,fi)=>s+coeffs[fi]*fStats[fi].m,0);

  // Render Regression KPIs
  document.getElementById('reg-kpi-grid').innerHTML = [
    {icon:'◈', val:r2.toFixed(4),     label:'R² Score',    cls:r2>0.7?'kv-g':r2>0.4?'kv-w':''},
    {icon:'◇', val:adjR2.toFixed(4),  label:'Adjusted R²', cls:''},
    {icon:'○', val:fmtN(rmse),        label:'RMSE',        cls:''},
    {icon:'⬡', val:n.toLocaleString(),label:'Samples',     cls:''},
  ].map((k,i)=>`
    <div class="kpi-card glass-card" style="animation-delay:${i*0.05}s">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-value ${k.cls}">${k.val}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');

  // Render model details table
  document.getElementById('reg-details').innerHTML = `
    <div class="reg-metric"><span>Target variable</span><span class="reg-val">${escH(targetName)}</span></div>
    <div class="reg-metric"><span>Features</span><span class="reg-val" style="font-size:.75rem">${features.map(escH).join(', ')}</span></div>
    <div class="reg-metric"><span>Intercept (β₀)</span><span class="reg-val">${fmtN(intercept,4)}</span></div>
    ${features.map((f,i)=>`<div class="reg-metric"><span>β(${escH(f)})</span><span class="reg-val">${fmtN(coeffs[i],4)}</span></div>`).join('')}
    <div class="reg-metric" style="margin-top:.5rem;padding-top:.5rem;border-top:1px solid rgba(0,240,255,.1)">
      <span>Interpretation</span>
      <span style="font-size:.72rem;color:var(--t3)">${r2>0.7?'Strong model':'r2>0.4?Moderate model:Weak model — more features may help'}</span>
    </div>`;

  // Scatter: Actual vs Predicted
  destroyChart('reg-chart');
  const sampleIdx = preds.length>600
    ? Array.from({length:600},(_,i)=>Math.floor(i*preds.length/600))
    : Array.from({length:preds.length},(_,i)=>i);
  const pts = sampleIdx.map(i=>({x:yVals[i], y:preds[i]}));
  const allV = [...yVals, ...preds];
  const rMin = Math.min(...allV), rMax = Math.max(...allV);

  const regCtx = document.getElementById('reg-chart')?.getContext('2d');
  if(regCtx){
    APP.charts['reg-chart'] = new Chart(regCtx, {
      type:'scatter',
      data:{datasets:[
        { label:`Predicted (n=${pts.length})`, data:pts,
          backgroundColor:'rgba(0,240,255,0.45)', pointRadius:3.5,
          borderColor:'rgba(0,240,255,0.8)', borderWidth:0.5 },
        { label:'Perfect fit', data:[{x:rMin,y:rMin},{x:rMax,y:rMax}],
          type:'line', borderColor:'rgba(244,114,182,0.7)',
          borderDash:[5,3], pointRadius:0, fill:false }
      ]},
      options: chartOpts({
        plugins:{legend:{labels:{color:'#8ba4c8',font:CD.font,boxWidth:12}}},
        scales:{
          x:{ title:{display:true,text:'Actual',color:'#8ba4c8',font:CD.font},
              ticks:{color:CD.tick.color,font:CD.font}, grid:{color:CD.grid.color} },
          y:{ title:{display:true,text:'Predicted',color:'#8ba4c8',font:CD.font},
              ticks:{color:CD.tick.color,font:CD.font}, grid:{color:CD.grid.color} }
        }
      })
    });
  }

  return { target:targetName, features, intercept, coeffs, r2, adjR2, mse, rmse, n };
}

// Gauss-Jordan matrix inversion (in-place on copy)
function gaussJordanInvert(M){
  const n=M.length;
  const A=M.map(r=>[...r]);
  const I=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0));

  for(let col=0;col<n;col++){
    // Find pivot
    let pivot=-1, best=0;
    for(let row=col;row<n;row++){
      if(Math.abs(A[row][col])>best){ best=Math.abs(A[row][col]); pivot=row; }
    }
    if(pivot<0||best<1e-12) return null;  // singular
    [A[col],A[pivot]]=[A[pivot],A[col]];
    [I[col],I[pivot]]=[I[pivot],I[col]];

    const sc=A[col][col];
    A[col]=A[col].map(v=>v/sc);
    I[col]=I[col].map(v=>v/sc);

    for(let row=0;row<n;row++){
      if(row===col) continue;
      const f=A[row][col];
      A[row]=A[row].map((v,ci)=>v-f*A[col][ci]);
      I[row]=I[row].map((v,ci)=>v-f*I[col][ci]);
    }
  }
  return I;
}

// ═══════════════════════════════════════════════════════════════
// AUTO INSIGHTS — Human-readable sentences
// ═══════════════════════════════════════════════════════════════
function generateInsights(data, schema, corrMatrix, stats, regression){
  const list = document.getElementById('insights-list');
  const ins  = [];

  if(!data.length){
    list.innerHTML='<div class="insight-item"><span class="insight-icon">⚡</span><span class="insight-text">No data to analyze.</span></div>';
    return;
  }

  // 1. Strongest correlation pair
  const numNames = Object.keys(corrMatrix);
  let bestR=0, bestPair=null;
  numNames.forEach((a,i)=>numNames.forEach((b,j)=>{
    if(j<=i) return;
    const r=Math.abs(corrMatrix[a]?.[b]??0);
    if(r>bestR){ bestR=r; bestPair=[a,b]; }
  }));
  if(bestPair){
    const raw = corrMatrix[bestPair[0]][bestPair[1]];
    const dir = raw>=0 ? 'positive' : 'negative';
    const strength = bestR>0.7?'strong':bestR>0.4?'moderate':'weak';
    ins.push(`The strongest correlation is a <strong>${strength} ${dir} relationship</strong> between <strong>${escH(bestPair[0])}</strong> and <strong>${escH(bestPair[1])}</strong> (r = ${raw.toFixed(3)}).`);
  }

  // 2. Highest-mean variable
  if(Object.keys(stats).length){
    const top = Object.entries(stats).filter(([,s])=>!isNaN(s.mean)).sort((a,b)=>b[1].mean-a[1].mean)[0];
    if(top) ins.push(`<strong>${escH(top[0])}</strong> has the highest average value in the dataset (mean = <strong>${fmtN(top[1].mean)}</strong>, std = ${fmtN(top[1].std)}).`);
  }

  // 3. Most frequent category
  const catCols = schema.filter(c=>c.type==='categorical');
  if(catCols.length){
    const bc = catCols.find(c=>c.uniques>=2&&c.uniques<=20) || catCols[0];
    const freq={};
    data.forEach(r=>{ const v=String(r[bc.name]||'').trim(); if(v) freq[v]=(freq[v]||0)+1; });
    const top = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];
    if(top){
      const pct = ((top[1]/data.length)*100).toFixed(1);
      ins.push(`The most frequent <strong>${escH(bc.name)}</strong> is <strong>"${escH(top[0])}"</strong> with ${top[1].toLocaleString()} occurrences (${pct}% of all rows).`);
    }
  }

  // 4. Distribution observation (mean vs median skewness proxy)
  if(Object.keys(stats).length){
    const col = Object.entries(stats)[0];
    const s   = col[1];
    if(s.std>0){
      const skew = (s.mean-s.median)/s.std; // Pearson's 2nd skewness coefficient approx
      if(Math.abs(skew)>0.5){
        const dir = skew>0 ? 'right-skewed (positive skew — long tail towards high values)' : 'left-skewed (negative skew — long tail towards low values)';
        ins.push(`The distribution of <strong>${escH(col[0])}</strong> appears <strong>${dir}</strong>. Mean: ${fmtN(s.mean)}, Median: ${fmtN(s.median)}.`);
      } else {
        ins.push(`<strong>${escH(col[0])}</strong> has a roughly symmetric distribution (mean ≈ median: ${fmtN(s.mean)} vs ${fmtN(s.median)}).`);
      }
    }
  }

  // 5. Missing data assessment
  const missCols = schema.filter(c=>c.missing>0.05).sort((a,b)=>b.missing-a.missing);
  if(missCols.length){
    ins.push(`Column <strong>${escH(missCols[0].name)}</strong> had the most missing data (${(missCols[0].missing*100).toFixed(1)}% missing) — values were imputed during cleaning.`);
  } else {
    ins.push(`✓ All columns had less than 5% missing values — the dataset is high quality.`);
  }

  // 6. Outlier insight
  if(APP.quality?.outlierInfo){
    const topOut = APP.quality.outlierInfo.filter(o=>o.count>0).sort((a,b)=>b.count-a.count)[0];
    if(topOut) ins.push(`Column <strong>${escH(topOut.name)}</strong> has <strong>${topOut.count} outlier rows</strong> detected by IQR method (Q1=${topOut.q1}, Q3=${topOut.q3}, IQR=${topOut.iqr}).`);
  }

  // 7. Regression insight
  if(regression){
    const quality = regression.r2>0.8?'excellent':regression.r2>0.6?'good':regression.r2>0.4?'moderate':'limited';
    ins.push(`The linear regression model predicts <strong>${escH(regression.target)}</strong> using [${regression.features.map(escH).join(', ')}] with <strong>R² = ${regression.r2.toFixed(4)}</strong> — ${quality} predictive fit. RMSE = ${fmtN(regression.rmse)}.`);
  }

  // 8. Dataset size note
  if(APP.truncated){
    ins.push(`⚠ The uploaded file contained <strong>${APP.totalRaw.toLocaleString()}</strong> rows. Analysis was performed on the first <strong>${data.length.toLocaleString()}</strong> rows for performance.`);
  } else {
    ins.push(`Dataset contains <strong>${data.length.toLocaleString()}</strong> rows and <strong>${schema.length}</strong> columns. All rows were analyzed.`);
  }

  list.innerHTML = ins.map((t,i)=>`
    <div class="insight-item" style="animation-delay:${i*0.07}s">
      <span class="insight-icon">◆</span>
      <span class="insight-text">${t}</span>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// FILTER UI
// ═══════════════════════════════════════════════════════════════
function buildFilterUI(schema){
  const grid = document.getElementById('dynamic-filters');
  grid.innerHTML = '';
  APP.filters = {};

  // Categorical dropdowns
  schema.filter(c=>c.type==='categorical').forEach(col=>{
    APP.filters[col.name] = 'ALL';
    const div = document.createElement('div');
    div.className = 'filter-item';
    const opts = col.topValues.slice(0,30).map(([v])=>`<option value="${escH(v)}">${escH(String(v).slice(0,40))}</option>`).join('');
    div.innerHTML = `<label class="filter-label">${escH(col.name)}</label>
      <select class="filter-select" data-col="${escH(col.name)}">
        <option value="ALL">All</option>${opts}
      </select>`;
    grid.appendChild(div);
    div.querySelector('select').addEventListener('change',e=>{
      APP.filters[col.name]=e.target.value; debounceFilter();
    });
  });

  // Numeric range sliders
  schema.filter(c=>c.type==='numeric'&&c.numMin!==null).forEach(col=>{
    const mn=Math.floor(col.numMin), mx=Math.ceil(col.numMax);
    APP.filters[col.name]={min:mn,max:mx};
    const safeId = col.name.replace(/[^a-z0-9]/gi,'_');
    const div = document.createElement('div');
    div.className = 'filter-item';
    div.innerHTML = `<label class="filter-label">${escH(col.name)}: <span id="fll-${safeId}">${fmtN(mn)} – ${fmtN(mx)}</span></label>
      <div class="range-wrap">
        <input type="range" class="range-slider" data-col="${escH(col.name)}" data-which="min" min="${mn}" max="${mx}" value="${mn}"/>
        <input type="range" class="range-slider" data-col="${escH(col.name)}" data-which="max" min="${mn}" max="${mx}" value="${mx}"/>
      </div>`;
    grid.appendChild(div);
    div.querySelectorAll('.range-slider').forEach(sl=>{
      sl.addEventListener('input',()=>{
        const minV=parseFloat(div.querySelector('[data-which="min"]').value);
        const maxV=parseFloat(div.querySelector('[data-which="max"]').value);
        APP.filters[col.name]={min:minV,max:maxV};
        const lbl=document.getElementById('fll-'+safeId);
        if(lbl) lbl.textContent=`${fmtN(minV)} – ${fmtN(maxV)}`;
        debounceFilter();
      });
    });
  });

  if(!Object.keys(APP.filters).length){
    grid.innerHTML='<div style="color:var(--t3);font-size:.78rem;padding:.4rem 0">No filterable columns detected.</div>';
  }
}

function resetFilters(schema){
  document.getElementById('global-search').value='';
  APP.filters={};
  schema.filter(c=>c.type==='categorical').forEach(c=>{
    APP.filters[c.name]='ALL';
    const el=document.querySelector(`select[data-col="${CSS.escape(c.name)}"]`);
    if(el) el.value='ALL';
  });
  schema.filter(c=>c.type==='numeric'&&c.numMin!==null).forEach(c=>{
    const mn=Math.floor(c.numMin), mx=Math.ceil(c.numMax);
    APP.filters[c.name]={min:mn,max:mx};
    const safeId=c.name.replace(/[^a-z0-9]/gi,'_');
    ['min','max'].forEach(w=>{
      const el=document.querySelector(`input[data-col="${CSS.escape(c.name)}"][data-which="${w}"]`);
      if(el) el.value=w==='min'?mn:mx;
    });
    const lbl=document.getElementById('fll-'+safeId);
    if(lbl) lbl.textContent=`${fmtN(mn)} – ${fmtN(mx)}`;
  });
  applyFilters();
}

let _filterTimer;
function debounceFilter(){ clearTimeout(_filterTimer); _filterTimer=setTimeout(applyFilters,220); }

function applyFilters(){
  const kw     = document.getElementById('global-search').value.trim().toLowerCase();
  const schema = APP.cleanSchema.filter(c=>c.type!=='year_col');

  APP.filtered = APP.cleanData.filter(row=>{
    // Categorical
    for(const col of schema.filter(c=>c.type==='categorical')){
      const fv=APP.filters[col.name];
      if(fv&&fv!=='ALL'&&String(row[col.name]||'').trim()!==fv) return false;
    }
    // Numeric
    for(const col of schema.filter(c=>c.type==='numeric')){
      const fr=APP.filters[col.name];
      if(fr){
        const v=parseFloat(String(row[col.name]||'').replace(/,/g,''));
        if(!isNaN(v)&&(v<fr.min||v>fr.max)) return false;
      }
    }
    // Global search
    if(kw && !Object.values(row).join(' ').toLowerCase().includes(kw)) return false;
    return true;
  });

  APP.page=1;
  renderTable(APP.filtered, schema);
}

// ═══════════════════════════════════════════════════════════════
// TABLE
// ═══════════════════════════════════════════════════════════════
function renderColToggles(schema){
  const wrap=document.getElementById('col-toggle-wrap');
  wrap.innerHTML='';
  APP.visibleCols=schema.filter(c=>c.type!=='id'&&c.type!=='year_col').map(c=>c.name);
  schema.filter(c=>c.type!=='year_col').forEach(col=>{
    const active=APP.visibleCols.includes(col.name);
    const btn=document.createElement('button');
    btn.className='col-toggle'+(active?' active':'');
    btn.textContent=col.name.slice(0,15);
    btn.title=`${col.name} (${col.type})`;
    btn.addEventListener('click',()=>{
      if(APP.visibleCols.includes(col.name)) APP.visibleCols=APP.visibleCols.filter(n=>n!==col.name);
      else APP.visibleCols.push(col.name);
      btn.classList.toggle('active');
      renderTable(APP.filtered, schema);
    });
    wrap.appendChild(btn);
  });
}

function renderTable(data, schema){
  const cols=schema.filter(c=>APP.visibleCols.includes(c.name));
  const total=data.length;
  document.getElementById('table-count-label').textContent=`Showing ${Math.min(total,APP.pageSize).toLocaleString()} of ${total.toLocaleString()} rows`;

  // Sort
  let sorted=[...data];
  if(APP.sortCol){
    sorted.sort((a,b)=>{
      const av=String(a[APP.sortCol]??''), bv=String(b[APP.sortCol]??'');
      const an=parseFloat(av.replace(/,/g,'')), bn=parseFloat(bv.replace(/,/g,''));
      if(!isNaN(an)&&!isNaN(bn)) return APP.sortDir*(an-bn);
      return APP.sortDir*av.localeCompare(bv);
    });
  }

  const pages=Math.max(1,Math.ceil(total/APP.pageSize));
  APP.page=Math.min(APP.page,pages);
  const start=(APP.page-1)*APP.pageSize;
  const slice=sorted.slice(start,start+APP.pageSize);

  // Head
  const thead=document.getElementById('table-head');
  thead.innerHTML='<tr>'+cols.map(c=>{
    const sc=APP.sortCol===c.name?(APP.sortDir===1?' sort-asc':' sort-desc'):'';
    return `<th class="${sc}" data-col="${escH(c.name)}" title="${escH(c.name)}">${escH(c.name.slice(0,20))}</th>`;
  }).join('')+'</tr>';
  thead.querySelectorAll('th').forEach(th=>{
    th.addEventListener('click',()=>{
      if(APP.sortCol===th.dataset.col) APP.sortDir*=-1;
      else{ APP.sortCol=th.dataset.col; APP.sortDir=1; }
      renderTable(APP.filtered,schema);
    });
  });

  // Body
  document.getElementById('table-body').innerHTML=slice.map(r=>'<tr>'+cols.map(c=>{
    const v=r[c.name];
    const empty=v===null||v===undefined||String(v).trim()==='';
    const disp=empty?'<span style="color:var(--t3)">—</span>':escH(String(v).slice(0,80))+(String(v||'').length>80?'…':'');
    return `<td>${disp}</td>`;
  }).join('')+'</tr>').join('');

  // Pagination
  const pag=document.getElementById('pagination');
  pag.innerHTML='';
  const show=Math.min(pages,9);
  const half=Math.floor(show/2);
  let start_=Math.max(1, APP.page-half);
  let end_  =Math.min(pages, start_+show-1);
  if(end_-start_<show-1) start_=Math.max(1,end_-show+1);

  if(start_>1){ const b=mkPageBtn(1); pag.appendChild(b); if(start_>2) pag.appendChild(mkEllipsis()); }
  for(let p=start_;p<=end_;p++) pag.appendChild(mkPageBtn(p));
  if(end_<pages){ if(end_<pages-1) pag.appendChild(mkEllipsis()); pag.appendChild(mkPageBtn(pages)); }

  function mkPageBtn(p){
    const b=document.createElement('button');
    b.className='page-btn'+(p===APP.page?' active':'');
    b.textContent=p;
    b.onclick=()=>{ APP.page=p; renderTable(APP.filtered,schema); };
    return b;
  }
  function mkEllipsis(){
    const s=document.createElement('span');
    s.textContent='…'; s.style.cssText='font-size:.7rem;color:var(--t3);align-self:center;padding:0 4px';
    return s;
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════
function exportCSV(){
  const data=APP.cleanData;
  if(!data.length){ toast('error','Error','No clean data available.'); return; }
  const schema=APP.cleanSchema.filter(c=>c.type!=='year_col');
  const cols=schema.map(c=>c.name);
  const header=cols.map(c=>`"${c.replace(/"/g,'""')}"`).join(',');
  const rows=data.map(r=>cols.map(c=>{
    const v=r[c]===null||r[c]===undefined?'':String(r[c]);
    return `"${v.replace(/"/g,'""')}"`;
  }).join(','));
  dl('nexus_cleaned.csv',[header,...rows].join('\n'),'text/csv');
  toast('success','CSV Exported',`${data.length.toLocaleString()} rows, ${cols.length} columns.`);
}

function exportJSON(){
  const schema=APP.cleanSchema;
  const report={
    generated_at: new Date().toISOString(),
    pipeline: 'Nexus Analytics v5 — 6-Stage Automated Analysis',
    dataset:{
      rows: APP.cleanData.length,
      columns: schema.length,
      truncated: APP.truncated,
      original_rows: APP.totalRaw
    },
    schema: schema.map(c=>({
      name:c.name, type:c.type,
      missing: (c.missing*100).toFixed(1)+'%',
      unique_values: c.uniques
    })),
    cleaning_summary: APP.cleanLog.map(l=>l.replace(/<[^>]+>/g,'')),
    descriptive_statistics: Object.fromEntries(
      Object.entries(APP.stats).map(([k,v])=>[k,{
        mean:+v.mean.toFixed(4), median:+v.median.toFixed(4),
        std:+v.std.toFixed(4), min:v.min, max:v.max,
        range:+v.range.toFixed(4), cv:isNaN(v.cv)?null:+v.cv.toFixed(2),
        q1:+v.q1.toFixed(4), q3:+v.q3.toFixed(4)
      }])
    ),
    correlation_matrix: Object.fromEntries(
      Object.entries(APP.corrMatrix).map(([k,v])=>[k,
        Object.fromEntries(Object.entries(v).map(([k2,v2])=>[k2, v2!=null?+v2.toFixed(4):null]))
      ])
    ),
    regression: APP.regression ? {
      target:     APP.regression.target,
      features:   APP.regression.features,
      intercept:  +APP.regression.intercept.toFixed(4),
      coefficients: Object.fromEntries(APP.regression.features.map((f,i)=>[f,+APP.regression.coeffs[i].toFixed(4)])),
      r2:    +APP.regression.r2.toFixed(4),
      adj_r2:+APP.regression.adjR2.toFixed(4),
      mse:   +APP.regression.mse.toFixed(4),
      rmse:  +APP.regression.rmse.toFixed(4),
      n_samples: APP.regression.n
    } : null
  };
  dl('nexus_analysis_report.json', JSON.stringify(report,null,2), 'application/json');
  toast('success','JSON Report Exported','Complete analysis report downloaded.');
}

// ═══════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════
function resetToUpload(){
  destroyAll();
  Object.assign(APP,{
    rawData:[],cleanData:[],filtered:[],schema:[],cleanSchema:[],
    stats:{},corrMatrix:{},regression:null,cleanLog:[],quality:{},
    page:1,sortCol:null,sortDir:1,filters:{},visibleCols:[],
    totalRaw:0,truncated:false
  });
  document.getElementById('upload-section').style.display='flex';
  document.getElementById('dashboard').style.display='none';
  document.getElementById('progress-wrap').style.display='none';
  document.getElementById('file-name-display').textContent='Choose CSV File';
  document.getElementById('csv-input').value='';
  document.getElementById('load-btn').disabled=true;
  document.getElementById('mode-badge').style.display='none';
  document.getElementById('logo-sub').textContent='Universal Data Analysis Pipeline';
  setStatus('idle','Awaiting Data');
}

// ═══════════════════════════════════════════════════════════════
// MAIN — DOMContentLoaded
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded',()=>{
  const csvInput = document.getElementById('csv-input');
  const loadBtn  = document.getElementById('load-btn');
  let selectedFile = null;

  csvInput.addEventListener('change',e=>{
    selectedFile=e.target.files[0];
    if(selectedFile){
      document.getElementById('file-name-display').textContent=selectedFile.name;
      loadBtn.disabled=false;
    }
  });

  document.getElementById('reload-btn').addEventListener('click',resetToUpload);
  document.getElementById('export-csv-btn').addEventListener('click',exportCSV);
  document.getElementById('export-json-btn').addEventListener('click',exportJSON);
  document.getElementById('global-search').addEventListener('input',debounceFilter);
  document.getElementById('reset-filters-btn').addEventListener('click',
    ()=>resetFilters(APP.cleanSchema.filter(c=>c.type!=='year_col'))
  );

  // ── ANALYSIS PIPELINE ──────────────────────────────────────
  loadBtn.addEventListener('click', async()=>{
    if(!selectedFile) return;
    loadBtn.disabled=true;
    setStatus('loading','Running pipeline...');
    document.getElementById('progress-wrap').style.display='block';

    try {
      // ── STAGE 1: Parse + Type Inference ──────────────────
      setProgress(5,'Stage 1 › Reading file...');
      await tick();
      const text = await selectedFile.text();

      setProgress(10,'Stage 1 › Parsing CSV / ARFF...');
await tick();

const parsed = await parseDataFile(text);
const parsedData = parsed.data;

if(!parsedData || !parsedData.length){
  throw 'File is empty or has no valid rows.';
}

APP.totalRaw  = parsedData.length;
APP.truncated = parsedData.length > APP.MAX_ROWS;
const rawData = APP.truncated ? parsedData.slice(0, APP.MAX_ROWS) : parsedData;
      if(APP.truncated)
        toast('warn','Large Dataset',`File has ${APP.totalRaw.toLocaleString()} rows. Analyzing first ${APP.MAX_ROWS.toLocaleString()}.`);
      APP.rawData = rawData;

      setProgress(18,'Stage 1 › Inferring column types...');
      await tick();
      const schema = inferColumnTypes(rawData);
      APP.schema = schema;

      setProgress(25,'Stage 1 › Building overview...');
      await tick();
      renderOverview(rawData, schema);

      // ── STAGE 2: Data Quality ─────────────────────────────
      setProgress(33,'Stage 2 › Assessing data quality...');
      await tick();
      assessDataQuality(rawData, schema);

      // ── STAGE 3: Data Cleaning ────────────────────────────
      setProgress(43,'Stage 3 › Cleaning data...');
      await tick();
      const {data:cleaned, schema:cleanSchema} = cleanData(rawData, schema);
      APP.cleanData   = cleaned;
      APP.cleanSchema = cleanSchema;

      // ── STAGE 4: Descriptive Statistics + Correlation ──────
      setProgress(54,'Stage 4 › Computing statistics...');
      await tick();
      APP.stats = computeStatistics(cleaned, cleanSchema);

      setProgress(62,'Stage 4 › Computing correlation matrix...');
      await tick();
      APP.corrMatrix = computeCorrelation(cleaned, cleanSchema);

      // ── STAGE 5: Visualizations ───────────────────────────
      setProgress(70,'Stage 5 › Generating charts...');
      await tick();
      generateCharts(cleaned, cleanSchema);

      // ── STAGE 6: Regression ───────────────────────────────
      setProgress(80,'Stage 6 › Running linear regression...');
      await tick();
      APP.regression = runRegression(cleaned, cleanSchema, APP.corrMatrix);

      // ── INSIGHTS ──────────────────────────────────────────
      setProgress(88,'Generating auto-insights...');
      await tick();
      generateInsights(cleaned, cleanSchema, APP.corrMatrix, APP.stats, APP.regression);

      // ── FILTER + TABLE ────────────────────────────────────
      setProgress(94,'Building filter & explore panel...');
      await tick();
      const displaySchema = cleanSchema.filter(c=>c.type!=='year_col');
      APP.filtered = [...cleaned];
      buildFilterUI(displaySchema);
      renderColToggles(displaySchema);
      renderTable(cleaned, displaySchema);

      // ── DONE ──────────────────────────────────────────────
      setProgress(100,'✓ Pipeline complete!');
      await tick(350);

      document.getElementById('upload-section').style.display='none';
      document.getElementById('dashboard').style.display='block';

      // Header info bar
      const nNum = cleanSchema.filter(c=>c.type==='numeric').length;
      const nCat = cleanSchema.filter(c=>c.type==='categorical').length;
      document.getElementById('dataset-info-text').textContent =
        `${cleaned.length.toLocaleString()} rows × ${cleanSchema.length} cols  ·  ${nNum} numeric  ·  ${nCat} categorical`+
        (APP.regression ? `  ·  R² = ${APP.regression.r2.toFixed(3)}` : '');

      const badge = document.getElementById('mode-badge');
      badge.style.display='block';
      badge.className='mode-badge mode-generic';
      badge.textContent='6-STAGE PIPELINE';
      document.getElementById('logo-sub').textContent='Automated Data Analysis';

      setStatus('active',`${cleaned.length.toLocaleString()} rows analyzed`);
      toast('success','Pipeline Complete',
        `6 stages done. R²=${APP.regression?APP.regression.r2.toFixed(4):'N/A'} · `+
        `${nNum} numeric cols · ${nCat} categorical cols`
      );

    } catch(err) {
      setStatus('error','Error');
      document.getElementById('progress-wrap').style.display='none';
      loadBtn.disabled=false;
      toast('error','Pipeline Failed', String(err).slice(0,200));
      console.error('Nexus pipeline error:', err);
    }
  });
});