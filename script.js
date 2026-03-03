/* =============================================
   NEXUS ANALYTICS — script.js
   Full modular analytics engine
   ============================================= */

// =================== STATE ===================
const APP = {
  rawData: [],
  filtered: [],
  currentPage: 1,
  pageSize: 10,
  charts: {},
  globalMetrics: null,
  wcMin: 0, wcMax: 0,
  sentMin: -1, sentMax: 1
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
  'affordable','value','worth','pleased','glad','thankful','grateful','magnificent',
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
  'dangerous','unsafe','dirty','messy','noisy','stressful','painful','awful',
  'dreadful','dismal','inferior','mediocre','subpar','deficient','inadequate',
  'unacceptable','unsatisfactory','regret','regretful','avoid','never','not',
  'problem','issue','error','bug','crash','fail','failed','failure','wrong',
  'incorrect','inaccurate','mislead','deceptive','false','negative','reject'
]);

// =================== UTILS ===================
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(t => t.length > 1);
}

function computeSentiment(tokens) {
  let pos = 0, neg = 0;
  tokens.forEach(t => {
    if (POS_WORDS.has(t)) pos++;
    if (NEG_WORDS.has(t)) neg++;
  });
  return (pos - neg) / Math.max(1, tokens.length);
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m-1] + s[m]) / 2;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a,b) => a+b, 0) / arr.length;
}

function fmt(n, d=2) {
  if (Math.abs(n) >= 1000) return (n/1000).toFixed(1) + 'k';
  return Number(n).toFixed(d);
}

function getClassColor(i, alpha=0.8) {
  const palette = [
    `rgba(0,240,255,${alpha})`,`rgba(168,85,247,${alpha})`,`rgba(244,114,182,${alpha})`,
    `rgba(0,255,170,${alpha})`,`rgba(251,191,36,${alpha})`,`rgba(249,115,22,${alpha})`,
    `rgba(99,102,241,${alpha})`,`rgba(20,184,166,${alpha})`,`rgba(236,72,153,${alpha})`,
    `rgba(132,204,22,${alpha})`
  ];
  return palette[i % palette.length];
}

// =================== TOAST ===================
function showToast(type, title, msg) {
  const tc = document.getElementById('toast-container');
  const icon = type === 'error' ? '⚠' : type === 'success' ? '✓' : 'ℹ';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icon}</span><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div>`;
  tc.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(20px)'; el.style.transition='0.3s'; setTimeout(()=>el.remove(), 300); }, 3500);
}

// =================== PROGRESS ===================
function setProgress(pct, label) {
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = label;
}

// =================== STATUS ===================
function setStatus(state, text) {
  const dot = document.querySelector('.status-dot');
  dot.className = 'status-dot ' + state;
  document.getElementById('status-text').textContent = text;
}

// =================== PARSE DATA ===================
function parseData(csvText) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          reject('Empty file'); return;
        }
        const cols = Object.keys(results.data[0]).map(c => c.trim().toLowerCase());
        if (!cols.includes('class') || !cols.includes('text')) {
          reject('Missing columns: CSV must have "class" and "text" columns'); return;
        }
        // Normalize
        const rows = results.data
          .filter(r => r.class && r.text && r.class.trim() && r.text.trim())
          .map(r => {
            const tokens = tokenize(r.text);
            const wc = tokens.length;
            const sentiment = computeSentiment(tokens);
            return {
              class: r.class.trim(),
              text: r.text.trim(),
              tokens,
              wc,
              sentiment
            };
          });
        if (!rows.length) { reject('No valid rows found'); return; }
        resolve(rows);
      },
      error: (err) => reject(err.message)
    });
  });
}

// =================== COMPUTE METRICS ===================
function computeMetrics(data) {
  const classes = [...new Set(data.map(r => r.class))].sort();
  const wcs = data.map(r => r.wc);
  const sents = data.map(r => r.sentiment);

  const classCounts = {};
  const classWC = {};
  const classSent = {};

  classes.forEach(c => {
    const rows = data.filter(r => r.class === c);
    classCounts[c] = rows.length;
    classWC[c] = { vals: rows.map(r => r.wc) };
    classWC[c].avg = mean(classWC[c].vals);
    classWC[c].min = Math.min(...classWC[c].vals);
    classWC[c].max = Math.max(...classWC[c].vals);
    classSent[c] = mean(rows.map(r => r.sentiment));
  });

  return {
    total: data.length,
    classes,
    numClasses: classes.length,
    avgWords: mean(wcs),
    medianWords: median(wcs),
    avgSentiment: mean(sents),
    classCounts,
    classWC,
    classSent,
    wcMin: Math.min(...wcs),
    wcMax: Math.max(...wcs),
    sentMin: Math.min(...sents),
    sentMax: Math.max(...sents),
    wcs, sents
  };
}

// =================== APPLY FILTERS ===================
function applyFilters() {
  const cls = document.getElementById('filter-class').value;
  const kw = document.getElementById('filter-search').value.trim().toLowerCase();
  const wcMin = parseInt(document.getElementById('wc-min').value);
  const wcMax = parseInt(document.getElementById('wc-max').value);
  const sMin = parseInt(document.getElementById('sent-min').value) / 100;
  const sMax = parseInt(document.getElementById('sent-max').value) / 100;

  APP.filtered = APP.rawData.filter(r => {
    if (cls !== 'ALL' && r.class !== cls) return false;
    if (kw && !r.text.toLowerCase().includes(kw)) return false;
    if (r.wc < wcMin || r.wc > wcMax) return false;
    if (r.sentiment < sMin || r.sentiment > sMax) return false;
    return true;
  });

  APP.currentPage = 1;
  renderAll();
}

function renderAll() {
  const metrics = computeMetrics(APP.filtered);
  renderKPIs(metrics);
  renderCharts(metrics);
  renderTopTerms(APP.filtered);
  renderTable();
  generateInsights(metrics, APP.filtered);
}

// =================== RENDER KPIs ===================
function renderKPIs(m) {
  document.getElementById('kpi-total-val').textContent = m.total.toLocaleString();
  document.getElementById('kpi-classes-val').textContent = m.numClasses;
  document.getElementById('kpi-avgwords-val').textContent = m.avgWords.toFixed(1);
  document.getElementById('kpi-median-val').textContent = m.medianWords.toFixed(0);
  const sv = m.avgSentiment;
  const sentEl = document.getElementById('kpi-sentiment-val');
  sentEl.textContent = sv.toFixed(4);
  sentEl.style.color = sv > 0.01 ? '#00ffaa' : sv < -0.01 ? '#f472b6' : '#8ba4c8';
}

// =================== RENDER CHARTS ===================
function destroyChart(id) {
  if (APP.charts[id]) { APP.charts[id].destroy(); delete APP.charts[id]; }
}

const CHART_DEFAULTS = {
  color: '#8ba4c8',
  font: { family: 'Syne, sans-serif', size: 11 },
  grid: { color: 'rgba(255,255,255,0.05)' },
  tick: { color: '#445577' }
};

function renderCharts(m) {
  renderClassDist(m);
  renderWCDist(m);
  renderWCClass(m);
  renderSentimentClass(m);
}

function renderClassDist(m) {
  destroyChart('classDist');
  const ctx = document.getElementById('chart-class-dist').getContext('2d');
  const labels = m.classes;
  const vals = labels.map(c => m.classCounts[c]);
  const colors = labels.map((_,i) => getClassColor(i, 0.75));
  APP.charts.classDist = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Count', data: vals, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: t => ' ' + t.raw.toLocaleString() } } },
      scales: {
        x: { ticks: { color: CHART_DEFAULTS.tick.color, font: CHART_DEFAULTS.font, maxRotation: 40 }, grid: { color: CHART_DEFAULTS.grid.color } },
        y: { ticks: { color: CHART_DEFAULTS.tick.color, font: CHART_DEFAULTS.font }, grid: { color: CHART_DEFAULTS.grid.color } }
      }
    }
  });
}

function renderWCDist(m) {
  destroyChart('wcDist');
  const ctx = document.getElementById('chart-wc-dist').getContext('2d');
  const bins = 20;
  const wcs = m.wcs;
  const min = Math.min(...wcs), max = Math.max(...wcs);
  const step = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  wcs.forEach(v => {
    let b = Math.floor((v - min) / step);
    if (b >= bins) b = bins - 1;
    counts[b]++;
  });
  const labels = Array.from({length: bins}, (_, i) => Math.round(min + i * step));
  APP.charts.wcDist = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Reviews', data: counts, backgroundColor: 'rgba(0,240,255,0.45)', borderRadius: 2, barPercentage: 0.95, categoryPercentage: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_DEFAULTS.tick.color, font: CHART_DEFAULTS.font, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: CHART_DEFAULTS.tick.color, font: CHART_DEFAULTS.font }, grid: { color: CHART_DEFAULTS.grid.color } }
      }
    }
  });
}

function renderWCClass(m) {
  destroyChart('wcClass');
  const ctx = document.getElementById('chart-wc-class').getContext('2d');
  const labels = m.classes;
  const avgs = labels.map(c => m.classWC[c].avg);
  const mins = labels.map(c => m.classWC[c].min);
  const maxs = labels.map(c => m.classWC[c].max);
  const colors = labels.map((_,i) => getClassColor(i, 0.7));

  APP.charts.wcClass = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Avg WC', data: avgs, backgroundColor: colors, borderRadius: 4, order: 1 },
        { label: 'Min', data: mins, type: 'line', borderColor: 'rgba(0,255,170,0.5)', backgroundColor: 'transparent', pointRadius: 3, pointBackgroundColor: 'rgba(0,255,170,0.8)', borderDash: [4,2], order: 0 },
        { label: 'Max', data: maxs, type: 'line', borderColor: 'rgba(244,114,182,0.5)', backgroundColor: 'transparent', pointRadius: 3, pointBackgroundColor: 'rgba(244,114,182,0.8)', borderDash: [4,2], order: 0 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8ba4c8', font: CHART_DEFAULTS.font, boxWidth: 10 } } },
      scales: {
        x: { ticks: { color: CHART_DEFAULTS.tick.color, font: CHART_DEFAULTS.font, maxRotation: 40 }, grid: { color: CHART_DEFAULTS.grid.color } },
        y: { ticks: { color: CHART_DEFAULTS.tick.color, font: CHART_DEFAULTS.font }, grid: { color: CHART_DEFAULTS.grid.color } }
      }
    }
  });
}

function renderSentimentClass(m) {
  destroyChart('sentClass');
  const ctx = document.getElementById('chart-sentiment-class').getContext('2d');
  const labels = m.classes;
  const vals = labels.map(c => parseFloat(m.classSent[c].toFixed(5)));
  const colors = vals.map(v => v > 0 ? 'rgba(0,255,170,0.65)' : 'rgba(244,114,182,0.65)');

  APP.charts.sentClass = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Avg Sentiment', data: vals, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_DEFAULTS.tick.color, font: CHART_DEFAULTS.font, maxRotation: 40 }, grid: { color: CHART_DEFAULTS.grid.color } },
        y: { ticks: { color: CHART_DEFAULTS.tick.color, font: CHART_DEFAULTS.font }, grid: { color: CHART_DEFAULTS.grid.color } }
      }
    }
  });
}

// =================== TOP TERMS ===================
function renderTopTerms(data) {
  const wordFreq = {};
  const bigramFreq = {};

  data.forEach(r => {
    const filtered = r.tokens.filter(t => !STOPWORDS.has(t) && t.length > 2);
    filtered.forEach(t => { wordFreq[t] = (wordFreq[t]||0) + 1; });
    for (let i = 0; i < filtered.length - 1; i++) {
      const bg = filtered[i] + ' ' + filtered[i+1];
      bigramFreq[bg] = (bigramFreq[bg]||0) + 1;
    }
  });

  renderTermList('top-words-list', wordFreq, 20);
  renderTermList('top-bigrams-list', bigramFreq, 20);
}

function renderTermList(elId, freq, topN) {
  const el = document.getElementById(elId);
  const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, topN);
  if (!sorted.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;">No data</div>'; return; }
  const maxVal = sorted[0][1];
  el.innerHTML = sorted.map(([word, count], i) => `
    <div class="term-item" style="animation-delay:${i*0.03}s">
      <span class="term-rank">${i+1}</span>
      <div class="term-bar-wrap">
        <div class="term-bar" style="width:${(count/maxVal*100).toFixed(1)}%"></div>
      </div>
      <span class="term-word">${word}</span>
      <span class="term-count">${count.toLocaleString()}</span>
    </div>
  `).join('');
}

// =================== TABLE ===================
function renderTable() {
  const data = APP.filtered;
  const total = data.length;
  const pages = Math.ceil(total / APP.pageSize);
  const start = (APP.currentPage - 1) * APP.pageSize;
  const slice = data.slice(start, start + APP.pageSize);

  document.getElementById('table-count').textContent = total.toLocaleString();

  const tbody = document.getElementById('table-body');
  tbody.innerHTML = slice.map((r, i) => {
    const sentClass = r.sentiment > 0.01 ? 'sent-pos' : r.sentiment < -0.01 ? 'sent-neg' : 'sent-neu';
    const sentEmoji = r.sentiment > 0.01 ? '▲' : r.sentiment < -0.01 ? '▼' : '●';
    return `<tr>
      <td class="td-num">${start+i+1}</td>
      <td class="td-class">${escHtml(r.class)}</td>
      <td style="color:var(--text-secondary);line-height:1.5;">${escHtml(r.text.slice(0,120))}${r.text.length>120?'…':''}</td>
      <td class="td-num">${r.wc}</td>
      <td class="td-num ${sentClass}">${sentEmoji} ${r.sentiment.toFixed(4)}</td>
    </tr>`;
  }).join('');

  // Pagination
  const pag = document.getElementById('pagination');
  pag.innerHTML = '';
  const maxPages = Math.min(pages, 10);
  for (let p = 1; p <= maxPages; p++) {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (p === APP.currentPage ? ' active' : '');
    btn.textContent = p;
    btn.onclick = () => { APP.currentPage = p; renderTable(); };
    pag.appendChild(btn);
  }
  if (pages > 10) {
    const span = document.createElement('span');
    span.style.cssText = 'font-size:0.72rem;color:var(--text-muted);align-self:center;';
    span.textContent = `... ${pages} pages total`;
    pag.appendChild(span);
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// =================== INSIGHTS ===================
function generateInsights(m, data) {
  const list = document.getElementById('insights-list');
  const insights = [];

  if (!data.length) {
    list.innerHTML = '<div class="insight-item"><span class="insight-icon">⚡</span><div class="insight-text">No data matches current filters.</div></div>';
    return;
  }

  // 1. Largest class
  const topClass = m.classes.reduce((a,b) => m.classCounts[a] > m.classCounts[b] ? a : b);
  const topPct = ((m.classCounts[topClass] / m.total) * 100).toFixed(1);
  insights.push(`The class <strong>${topClass}</strong> is the largest group, representing ${topPct}% of filtered reviews (${m.classCounts[topClass].toLocaleString()} entries).`);

  // 2. Sentiment leader (most positive)
  if (m.numClasses > 1) {
    const posCls = m.classes.reduce((a,b) => m.classSent[a] > m.classSent[b] ? a : b);
    const negCls = m.classes.reduce((a,b) => m.classSent[a] < m.classSent[b] ? a : b);
    insights.push(`<strong>${posCls}</strong> has the most positive average sentiment (${m.classSent[posCls].toFixed(4)}), while <strong>${negCls}</strong> is the most negative (${m.classSent[negCls].toFixed(4)}).`);
  }

  // 3. Longest reviews class
  const longCls = m.classes.reduce((a,b) => m.classWC[a].avg > m.classWC[b].avg ? a : b);
  insights.push(`Reviews in class <strong>${longCls}</strong> are on average the longest, with ${m.classWC[longCls].avg.toFixed(1)} words per review.`);

  // 4. Top bigram
  const bgFreq = {};
  data.forEach(r => {
    const ft = r.tokens.filter(t => !STOPWORDS.has(t) && t.length > 2);
    for (let i = 0; i < ft.length - 1; i++) { const bg = ft[i]+' '+ft[i+1]; bgFreq[bg]=(bgFreq[bg]||0)+1; }
  });
  const topBg = Object.entries(bgFreq).sort((a,b)=>b[1]-a[1])[0];
  if (topBg) insights.push(`The most frequent bigram in this view is <strong>"${topBg[0]}"</strong>, appearing ${topBg[1].toLocaleString()} times.`);

  // 5. Word count spread
  const spread = m.wcMax - m.wcMin;
  insights.push(`Word count ranges widely — from <strong>${m.wcMin}</strong> to <strong>${Math.max(...m.wcs)}</strong> words (spread: ${spread}), with a median of <strong>${m.medianWords.toFixed(0)}</strong>.`);

  list.innerHTML = insights.map(txt => `
    <div class="insight-item">
      <span class="insight-icon">◆</span>
      <span class="insight-text">${txt}</span>
    </div>
  `).join('');
}

// =================== EXPORT CSV ===================
function exportCSV() {
  if (!APP.filtered.length) { showToast('error','Export Failed','No data to export'); return; }
  const rows = [['class','text','word_count','sentiment']];
  APP.filtered.forEach(r => rows.push([`"${r.class.replace(/"/g,'""')}"`, `"${r.text.replace(/"/g,'""')}"`, r.wc, r.sentiment.toFixed(6)]));
  const csv = rows.map(r => r.join(',')).join('\n');
  download('filtered_reviews.csv', csv, 'text/csv');
  showToast('success','CSV Exported',`${APP.filtered.length.toLocaleString()} rows downloaded.`);
}

// =================== EXPORT JSON ===================
function exportJSON() {
  if (!APP.filtered.length) { showToast('error','Export Failed','No data to export'); return; }
  const m = computeMetrics(APP.filtered);

  const wFreq = {};
  const bgFreq = {};
  APP.filtered.forEach(r => {
    const ft = r.tokens.filter(t => !STOPWORDS.has(t) && t.length > 2);
    ft.forEach(t => { wFreq[t]=(wFreq[t]||0)+1; });
    for (let i=0;i<ft.length-1;i++){const bg=ft[i]+' '+ft[i+1];bgFreq[bg]=(bgFreq[bg]||0)+1;}
  });

  const topWords = Object.entries(wFreq).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([w,c])=>({word:w,count:c}));
  const topBigrams = Object.entries(bgFreq).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([bg,c])=>({bigram:bg,count:c}));

  const summary = {
    generated_at: new Date().toISOString(),
    kpi: {
      total_reviews: m.total,
      num_classes: m.numClasses,
      avg_words: parseFloat(m.avgWords.toFixed(2)),
      median_words: parseFloat(m.medianWords.toFixed(2)),
      avg_sentiment: parseFloat(m.avgSentiment.toFixed(6))
    },
    class_distribution: m.classCounts,
    class_avg_wordcount: Object.fromEntries(m.classes.map(c=>[c, parseFloat(m.classWC[c].avg.toFixed(2))])),
    class_avg_sentiment: Object.fromEntries(m.classes.map(c=>[c, parseFloat(m.classSent[c].toFixed(6))])),
    top_words: topWords,
    top_bigrams: topBigrams
  };

  download('summary.json', JSON.stringify(summary, null, 2), 'application/json');
  showToast('success','JSON Exported','Summary downloaded.');
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// =================== FILTER UI SETUP ===================
function setupFilterUI(metrics) {
  // Class dropdown
  const sel = document.getElementById('filter-class');
  sel.innerHTML = '<option value="ALL">All Classes</option>';
  metrics.classes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });

  // WC range sliders
  const wcMinEl = document.getElementById('wc-min');
  const wcMaxEl = document.getElementById('wc-max');
  wcMinEl.min = wcMaxEl.min = metrics.wcMin;
  wcMinEl.max = wcMaxEl.max = metrics.wcMax;
  wcMinEl.value = metrics.wcMin;
  wcMaxEl.value = metrics.wcMax;
  APP.wcMin = metrics.wcMin; APP.wcMax = metrics.wcMax;

  // Sentiment sliders (scaled *100)
  const sMin = document.getElementById('sent-min');
  const sMax = document.getElementById('sent-max');
  sMin.min = sMax.min = Math.floor(metrics.sentMin * 100) - 1;
  sMin.max = sMax.max = Math.ceil(metrics.sentMax * 100) + 1;
  sMin.value = sMin.min; sMax.value = sMax.max;

  updateRangeLabels();
}

function updateRangeLabels() {
  const wcMin = document.getElementById('wc-min').value;
  const wcMax = document.getElementById('wc-max').value;
  document.getElementById('wc-range-label').textContent = `${wcMin} – ${wcMax}`;
  const sMin = (parseInt(document.getElementById('sent-min').value)/100).toFixed(2);
  const sMax = (parseInt(document.getElementById('sent-max').value)/100).toFixed(2);
  document.getElementById('sent-range-label').textContent = `${sMin} – ${sMax}`;
}

// =================== INIT ===================
document.addEventListener('DOMContentLoaded', () => {
  const csvInput  = document.getElementById('csv-input');
  const loadBtn   = document.getElementById('load-btn');
  const fileLabel = document.getElementById('file-name-display');

  let selectedFile = null;

  csvInput.addEventListener('change', (e) => {
    selectedFile = e.target.files[0];
    if (selectedFile) {
      fileLabel.textContent = selectedFile.name;
      loadBtn.disabled = false;
    }
  });

  loadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    loadBtn.disabled = true;
    setStatus('loading', 'Parsing...');
    document.getElementById('progress-wrap').style.display = 'block';
    setProgress(10, 'Reading file...');

    try {
      const text = await selectedFile.text();
      setProgress(30, 'Parsing CSV...');
      await new Promise(r => setTimeout(r, 50));

      const data = await parseData(text);
      setProgress(60, 'Computing metrics...');
      await new Promise(r => setTimeout(r, 50));

      APP.rawData = data;
      APP.filtered = [...data];
      const metrics = computeMetrics(data);
      APP.globalMetrics = metrics;

      setProgress(75, 'Setting up filters...');
      setupFilterUI(metrics);

      setProgress(88, 'Rendering dashboard...');
      await new Promise(r => setTimeout(r, 50));

      renderKPIs(metrics);
      renderCharts(metrics);
      renderTopTerms(data);
      renderTable();
      generateInsights(metrics, data);

      setProgress(100, 'Done!');
      await new Promise(r => setTimeout(r, 300));

      document.getElementById('upload-section').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
      setStatus('active', `${data.length.toLocaleString()} Reviews Loaded`);
      showToast('success', 'Data Loaded', `${data.length.toLocaleString()} reviews across ${metrics.numClasses} classes.`);

    } catch (err) {
      setStatus('idle', 'Error');
      document.getElementById('progress-wrap').style.display = 'none';
      loadBtn.disabled = false;
      showToast('error', 'Load Failed', String(err));
    }
  });

  // Filter listeners
  let filterTimer;
  const debouncedFilter = () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilters, 200); };

  document.getElementById('filter-class').addEventListener('change', applyFilters);
  document.getElementById('filter-search').addEventListener('input', debouncedFilter);
  document.getElementById('wc-min').addEventListener('input', () => { updateRangeLabels(); debouncedFilter(); });
  document.getElementById('wc-max').addEventListener('input', () => { updateRangeLabels(); debouncedFilter(); });
  document.getElementById('sent-min').addEventListener('input', () => { updateRangeLabels(); debouncedFilter(); });
  document.getElementById('sent-max').addEventListener('input', () => { updateRangeLabels(); debouncedFilter(); });

  document.getElementById('reset-filters-btn').addEventListener('click', () => {
    document.getElementById('filter-class').value = 'ALL';
    document.getElementById('filter-search').value = '';
    if (APP.globalMetrics) {
      const m = APP.globalMetrics;
      const wcMinEl = document.getElementById('wc-min');
      const wcMaxEl = document.getElementById('wc-max');
      wcMinEl.value = m.wcMin; wcMaxEl.value = m.wcMax;
      document.getElementById('sent-min').value = document.getElementById('sent-min').min;
      document.getElementById('sent-max').value = document.getElementById('sent-max').max;
      updateRangeLabels();
    }
    applyFilters();
  });

  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('export-json-btn').addEventListener('click', exportJSON);
});